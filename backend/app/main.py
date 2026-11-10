from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from . import __version__
from .config import Settings, get_settings
from .engine import Engine, NotFound, StorageFull
from .guardrails import RateLimiter, auth_dependencies, check_citations, rate_limit
from .ingest.loaders import IngestError
from .rag import is_chat_model
from .safety import ModerationUnavailable, Moderator, build_moderator
from .schemas import (
    AskRequest,
    DocumentDetail,
    DocumentOut,
    IngestResult,
    SearchRequest,
    SearchResponse,
    UrlIngestRequest,
    VersionLabelUpdate,
    VersionOut,
)

log = logging.getLogger("docsearch")


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def create_app(
    settings: Settings | None = None, engine: Engine | None = None, moderator: Moderator | None = None
) -> FastAPI:
    settings = settings or get_settings()
    moderator = moderator or build_moderator(settings)
    app = FastAPI(
        title="AI Version-Aware Document Search API",
        version=__version__,
        description="Version-aware document search: upload or link documents, search a specific "
        "version, compare versions, and ask questions answered by a local LLM.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    state: dict[str, Engine] = {}
    init_lock = threading.Lock()

    def eng() -> Engine:
        # Lazy so importing the app (and loading a large embedding model) only
        # happens on first use; tests inject their own engine. The lock stops
        # concurrent first requests from loading the model twice in parallel,
        # which crashes torch ("Cannot copy out of meta tensor").
        if "engine" not in state:
            with init_lock:
                if "engine" not in state:
                    state["engine"] = engine or Engine(settings)
        return state["engine"]

    # ----------------------------------------------------------- guardrails

    require_write, require_read = auth_dependencies(settings)
    limiter = RateLimiter()
    limit_ask = rate_limit(
        limiter,
        "ask",
        lambda: [
            ("client", settings.rate_limit_ask_per_minute, 60),
            ("global", settings.rate_limit_ask_global_per_minute, 60),
        ],
    )
    limit_search = rate_limit(limiter, "search", lambda: [("client", settings.rate_limit_search_per_minute, 60)])
    limit_ingest = rate_limit(limiter, "upload", lambda: [("client", settings.rate_limit_ingest_per_hour, 3600)])
    read = [Depends(require_read)]
    write = [Depends(require_write)]
    if not settings.api_key:
        log.warning("AT_API_KEY is not set: anyone who can reach this API can add and delete documents.")

    # ------------------------------------------------------- model catalogue

    catalogue: dict[str, Any] = {"at": -1e9}

    def models() -> dict[str, Any]:
        """Chat models users may pick, cached briefly so every request
        doesn't hit Ollama. Embedding/safety models and anything outside
        AT_ALLOWED_MODELS are left out."""
        if time.monotonic() - catalogue["at"] < 30:
            return catalogue["data"]
        try:
            details = [m for m in eng().llm.model_details() if is_chat_model(m["name"])]
            if settings.allowed_models is not None:
                details = [m for m in details if m["name"] in settings.allowed_models]
            data: dict[str, Any] = {"reachable": True, "details": details}
        except Exception as exc:  # Ollama not running is a normal state
            data = {"reachable": False, "details": [], "error": str(exc)}
        catalogue.update(at=time.monotonic(), data=data)
        return data

    def resolve_model(requested: str | None) -> str:
        """The model to use, or 422 if the requested one isn't offered."""
        name = (requested or "").strip()
        if not name or name == settings.ollama_model:
            return settings.ollama_model
        if settings.allowed_models is not None and name not in settings.allowed_models:
            raise HTTPException(422, f"Model '{name}' is not allowed on this server.")
        cat = models()
        names = [m["name"] for m in cat["details"]]
        if name in names:
            return name
        if not cat["reachable"]:
            raise HTTPException(503, f"Can't check model '{name}': Ollama isn't reachable.")
        choices = ", ".join([settings.ollama_model, *[n for n in names if n != settings.ollama_model]])
        raise HTTPException(422, f"Model '{name}' isn't available. Choose one of: {choices}.")

    @app.exception_handler(StorageFull)
    async def _storage_full(_: Request, exc: StorageFull) -> JSONResponse:
        return JSONResponse(status_code=507, content={"detail": str(exc)})

    @app.exception_handler(NotFound)
    async def _not_found(_: Request, exc: NotFound) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(IngestError)
    async def _ingest_error(_: Request, exc: IngestError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    # ----------------------------------------------------------------- meta

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        e = eng()
        cat = models()
        llm: dict[str, Any] = {
            "provider": settings.llm_provider,
            "default_model": settings.ollama_model,
            "reachable": cat["reachable"],
            "models": [m["name"] for m in cat["details"]],
            "model_details": cat["details"],
        }
        if "error" in cat:
            llm["error"] = cat["error"]
        return {
            "status": "ok",
            "version": __version__,
            "embedding_model": e.embedder.name,
            "llm": llm,
            "stats": e.stats(),
            "guardrails": {"moderation": settings.moderation_model, "redact_pii": settings.redact_pii},
            "limits": {"max_upload_mb": settings.max_upload_mb, "max_storage_mb": settings.max_storage_mb},
            "auth": {"write": bool(settings.api_key), "read": bool(settings.api_key and settings.protect_reads)},
        }

    @app.get("/api/auth/check", status_code=204, response_class=Response, response_model=None, dependencies=write)
    def auth_check() -> None:
        """204 if the supplied X-API-Key allows changes (or no key is configured)."""

    # ------------------------------------------------------------ documents

    @app.get("/api/documents", response_model=list[DocumentOut], dependencies=read)
    def list_documents() -> list[DocumentOut]:
        return eng().list_documents()

    @app.post(
        "/api/documents", response_model=IngestResult, status_code=201, dependencies=[*write, Depends(limit_ingest)]
    )
    async def upload_document(
        file: Annotated[UploadFile, File()],
        title: Annotated[str | None, Form()] = None,
        document_id: Annotated[int | None, Form()] = None,
        label: Annotated[str | None, Form()] = None,
    ) -> IngestResult:
        data = await file.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, f"File is larger than {settings.max_upload_mb} MB.")
        return eng().ingest(
            data,
            file.filename or "document",
            file.content_type,
            title=title or None,
            document_id=document_id,
            label=label,
        )

    @app.post(
        "/api/documents/url",
        response_model=IngestResult,
        status_code=201,
        dependencies=[*write, Depends(limit_ingest)],
    )
    def add_url(req: UrlIngestRequest) -> IngestResult:
        return eng().ingest_url(str(req.url), title=req.title, document_id=req.document_id, label=req.label)

    @app.get("/api/documents/{document_id}", response_model=DocumentDetail, dependencies=read)
    def get_document(document_id: int) -> DocumentDetail:
        return eng().get_document(document_id)

    @app.patch("/api/documents/{document_id}", response_model=DocumentDetail, dependencies=write)
    def rename_document(document_id: int, body: dict[str, str]) -> DocumentDetail:
        title = (body.get("title") or "").strip()
        if not title:
            raise HTTPException(400, "title is required")
        return eng().rename_document(document_id, title)

    @app.delete(
        "/api/documents/{document_id}",
        status_code=204,
        response_class=Response,
        response_model=None,
        dependencies=write,
    )
    def delete_document(document_id: int) -> None:
        eng().delete_document(document_id)

    @app.post(
        "/api/documents/{document_id}/refresh",
        response_model=IngestResult,
        dependencies=[*write, Depends(limit_ingest)],
    )
    def refresh_document(document_id: int, label: str | None = None) -> IngestResult:
        return eng().refresh(document_id, label=label)

    @app.get("/api/documents/{document_id}/versions/{number}", dependencies=read)
    def version_text(document_id: int, number: int) -> dict[str, Any]:
        return eng().version_text(document_id, number)

    @app.patch("/api/documents/{document_id}/versions/{number}", response_model=VersionOut, dependencies=write)
    def update_version(document_id: int, number: int, body: VersionLabelUpdate) -> VersionOut:
        return eng().set_version_label(document_id, number, body.label)

    @app.delete(
        "/api/documents/{document_id}/versions/{number}",
        status_code=204,
        response_class=Response,
        response_model=None,
        dependencies=write,
    )
    def delete_version(document_id: int, number: int) -> None:
        eng().delete_version(document_id, number)

    @app.get("/api/documents/{document_id}/diff", dependencies=read)
    def diff(
        document_id: int,
        old: Annotated[int, Query(alias="from")],
        new: Annotated[int, Query(alias="to")],
    ) -> dict[str, Any]:
        return eng().diff(document_id, old, new)

    @app.post("/api/documents/{document_id}/diff/summary", dependencies=[*read, Depends(limit_ask)])
    def diff_summary(
        document_id: int,
        old: Annotated[int, Query(alias="from")],
        new: Annotated[int, Query(alias="to")],
        model: str | None = None,
    ) -> StreamingResponse:
        e = eng()
        name = resolve_model(model)
        messages = e.diff_messages(document_id, old, new)
        return _stream(e, messages, name, prelude=[])

    # --------------------------------------------------------------- search

    @app.post("/api/search", response_model=SearchResponse, dependencies=[*read, Depends(limit_search)])
    def search(req: SearchRequest) -> SearchResponse:
        return SearchResponse(query=req.query, hits=eng().search(req.query, req.scope, req.k))

    @app.post("/api/ask", dependencies=[*read, Depends(limit_ask)])
    def ask(req: AskRequest) -> StreamingResponse:
        from .rag import build_answer_messages, suspicious_sources

        e = eng()
        name = resolve_model(req.model)
        if moderator is not None:
            try:
                verdict = moderator.check(req.query)
            except ModerationUnavailable as exc:
                log.warning("Moderation failed: %s", exc)
                raise HTTPException(503, f"The safety check is unavailable, so questions are paused. {exc}") from exc
            if not verdict.safe:
                labels = ", ".join(verdict.labels) or "unsafe content"
                return _stream(
                    e,
                    None,
                    name,
                    [
                        _sse("sources", []),
                        _sse("blocked", {"categories": verdict.categories, "labels": verdict.labels}),
                        _sse("token", f"I can't help with that request. The safety check flagged it ({labels})."),
                    ],
                )
        hits = e.relevant(e.search(req.query, req.scope, req.k))
        prelude = [_sse("sources", [h.model_dump() for h in hits])]
        if not hits:
            prelude.append(_sse("token", "I couldn't find anything relevant in the selected documents and versions."))
            return _stream(e, None, name, prelude)
        return _stream(
            e,
            build_answer_messages(req.query, hits),
            name,
            prelude,
            cite_sources=len(hits),
            suspicious=suspicious_sources(hits),
        )

    def _stream(
        e: Engine,
        messages: list[tuple[str, str]] | None,
        model: str,
        prelude: list[str],
        cite_sources: int | None = None,
        suspicious: list[int] | None = None,
    ) -> StreamingResponse:
        def gen() -> Iterator[str]:
            yield from prelude
            if messages is not None:
                answer: list[str] = []
                yield _sse("model", model)
                try:
                    for token in e.llm.stream(messages, model=model):
                        answer.append(token)
                        yield _sse("token", token)
                    if cite_sources is not None:
                        # Flag citations to sources that don't exist, or an answer with none
                        check = check_citations("".join(answer), cite_sources)
                        check["suspicious_sources"] = suspicious or []
                        yield _sse("check", check)
                except Exception as exc:
                    log.warning("LLM failed: %s", exc)
                    yield _sse(
                        "error",
                        f"The language model is unavailable ({exc}). Search results above are still valid. "
                        f"Make sure Ollama is running at {settings.ollama_base_url} and the model is pulled.",
                    )
            yield _sse("done", {})

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()
