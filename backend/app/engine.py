"""Core service: versioned ingestion, scoped hybrid search, version diffs."""

from __future__ import annotations

import hashlib
import re
import sqlite3
import threading
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

from .config import Settings
from .db import connect, get_meta, set_meta
from .diff import changes_for_prompt, diff_texts
from .embeddings import Embedder, build_embedder
from .ingest.chunker import chunk_sections
from .ingest.fetch import Fetched, fetch_url
from .ingest.loaders import KIND_MIME, IngestError, Limits, load_document
from .rag import build_diff_messages, build_llm
from .safety import redact_pii
from .schemas import (
    DocRef,
    DocumentDetail,
    DocumentOut,
    HitVersion,
    IngestResult,
    Scope,
    SearchHit,
    VersionOut,
)
from .vectorstore import VectorIndex

RRF_K = 60
_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "do",
    "does",
    "for",
    "from",
    "how",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "the",
    "to",
    "was",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "this",
    "that",
    "about",
    "can",
    "i",
    "me",
    "my",
}


class NotFound(LookupError):
    pass


class StorageFull(Exception):
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _placeholders(n: int) -> str:
    return ",".join("?" * n)


def _batched(items: list[Any], size: int = 500) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def fts_query(text: str) -> str:
    tokens = [t for t in re.findall(r"\w+", text.lower()) if len(t) > 1 and t not in _STOPWORDS]
    seen: list[str] = []
    for t in tokens:
        if t not in seen:
            seen.append(t)
    return " OR ".join(f'"{t}"' for t in seen[:32])


class Engine:
    def __init__(
        self,
        settings: Settings,
        embedder: Embedder | None = None,
        llm: Any | None = None,
        fetcher: Callable[..., Fetched] = fetch_url,
    ) -> None:
        self.settings = settings
        self.lock = threading.RLock()
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.db = connect(settings.data_dir / "aavanam.db")
        self.embedder = embedder or build_embedder(settings)
        self.llm = llm or build_llm(settings)
        self.fetcher = fetcher
        self.index = VectorIndex(settings.data_dir / "chunks.faiss", self.embedder.dim)
        self._sync_index()

    # ------------------------------------------------------------------ index

    def _sync_index(self) -> None:
        """Rebuild FAISS from SQLite if the embedding model changed or the
        index file is missing/out of sync. SQLite is the source of truth."""
        with self.lock:
            count = self.db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
            model = get_meta(self.db, "embedding_model")
            if model == self.embedder.name and self.index.size == count:
                return
            self.index.reset()
            rows = self.db.execute("SELECT id, text FROM chunks ORDER BY id").fetchall()
            for batch in _batched(rows, 256):
                vectors = self.embedder.embed_documents([r["text"] for r in batch])
                self.index.add([r["id"] for r in batch], vectors)
            set_meta(self.db, "embedding_model", self.embedder.name)
            self.db.commit()
            self.index.save()

    @property
    def limits(self) -> Limits:
        s = self.settings
        return Limits(
            max_unpacked_bytes=s.max_unpacked_mb * 1024 * 1024,
            max_pages=s.max_pages,
            timeout_s=s.parse_timeout_s,
            max_text_chars=s.max_text_chars,
        )

    def _out(self, text: str) -> str:
        """Text leaving the engine (API responses, LLM prompts): PII-masked if enabled."""
        return redact_pii(text) if self.settings.redact_pii else text

    def stats(self) -> dict[str, int]:
        with self.lock:
            q = self.db.execute
            return {
                "documents": q("SELECT COUNT(*) FROM documents").fetchone()[0],
                "versions": q("SELECT COUNT(*) FROM versions").fetchone()[0],
                "chunks": q("SELECT COUNT(*) FROM chunks").fetchone()[0],
                "vectors": self.index.size,
            }

    # -------------------------------------------------------------- documents

    _DOC_SQL = """
        SELECT d.*, COUNT(v.id) AS version_count, MAX(v.number) AS latest_version
        FROM documents d JOIN versions v ON v.document_id = d.id
    """

    @staticmethod
    def _doc(row: sqlite3.Row) -> DocumentOut:
        return DocumentOut(**{k: row[k] for k in DocumentOut.model_fields})

    @staticmethod
    def _version(row: sqlite3.Row) -> VersionOut:
        return VersionOut(**{k: row[k] for k in VersionOut.model_fields})

    def list_documents(self) -> list[DocumentOut]:
        with self.lock:
            rows = self.db.execute(self._DOC_SQL + " GROUP BY d.id ORDER BY d.updated_at DESC, d.id DESC").fetchall()
        return [self._doc(r) for r in rows]

    def get_document(self, document_id: int) -> DocumentDetail:
        with self.lock:
            row = self.db.execute(self._DOC_SQL + " WHERE d.id = ? GROUP BY d.id", (document_id,)).fetchone()
            if row is None:
                raise NotFound(f"Document {document_id} not found")
            versions = self.db.execute(
                "SELECT * FROM versions WHERE document_id = ? ORDER BY number DESC", (document_id,)
            ).fetchall()
        return DocumentDetail(**self._doc(row).model_dump(), versions=[self._version(v) for v in versions])

    def _version_row(self, document_id: int, number: int) -> sqlite3.Row:
        row = self.db.execute(
            "SELECT * FROM versions WHERE document_id = ? AND number = ?", (document_id, number)
        ).fetchone()
        if row is None:
            raise NotFound(f"Version v{number} of document {document_id} not found")
        return row

    def version_text(self, document_id: int, number: int) -> dict[str, Any]:
        with self.lock:
            row = self._version_row(document_id, number)
        return {"version": self._version(row), "text": self._out(row["text"])}

    def set_version_label(self, document_id: int, number: int, label: str | None) -> VersionOut:
        with self.lock:
            row = self._version_row(document_id, number)
            self.db.execute("UPDATE versions SET label = ? WHERE id = ?", ((label or "").strip() or None, row["id"]))
            self.db.commit()
            return self._version(self._version_row(document_id, number))

    def rename_document(self, document_id: int, title: str) -> DocumentDetail:
        with self.lock:
            cur = self.db.execute("UPDATE documents SET title = ? WHERE id = ?", (title.strip(), document_id))
            if cur.rowcount == 0:
                raise NotFound(f"Document {document_id} not found")
            self.db.commit()
        return self.get_document(document_id)

    def _collect_garbage(self, candidate_chunk_ids: list[int]) -> None:
        orphans: list[int] = []
        for batch in _batched(candidate_chunk_ids):
            orphans += [
                r[0]
                for r in self.db.execute(
                    f"SELECT id FROM chunks WHERE id IN ({_placeholders(len(batch))}) "
                    "AND NOT EXISTS (SELECT 1 FROM version_chunks vc WHERE vc.chunk_id = chunks.id)",
                    batch,
                )
            ]
        for batch in _batched(orphans):
            ph = _placeholders(len(batch))
            self.db.execute(f"DELETE FROM chunks WHERE id IN ({ph})", batch)
            self.db.execute(f"DELETE FROM chunks_fts WHERE rowid IN ({ph})", batch)
        self.index.remove(orphans)

    def delete_document(self, document_id: int) -> None:
        with self.lock:
            if not self.db.execute("SELECT 1 FROM documents WHERE id = ?", (document_id,)).fetchone():
                raise NotFound(f"Document {document_id} not found")
            chunk_ids = [
                r[0]
                for r in self.db.execute(
                    "SELECT DISTINCT vc.chunk_id FROM version_chunks vc "
                    "JOIN versions v ON v.id = vc.version_id WHERE v.document_id = ?",
                    (document_id,),
                )
            ]
            self.db.execute("DELETE FROM documents WHERE id = ?", (document_id,))
            self._collect_garbage(chunk_ids)
            self.db.commit()
            self.index.save()

    def delete_version(self, document_id: int, number: int) -> None:
        with self.lock:
            row = self._version_row(document_id, number)
            count = self.db.execute("SELECT COUNT(*) FROM versions WHERE document_id = ?", (document_id,)).fetchone()[0]
            if count == 1:
                self.delete_document(document_id)
                return
            chunk_ids = [
                r[0]
                for r in self.db.execute(
                    "SELECT DISTINCT chunk_id FROM version_chunks WHERE version_id = ?", (row["id"],)
                )
            ]
            self.db.execute("DELETE FROM versions WHERE id = ?", (row["id"],))
            self._collect_garbage(chunk_ids)
            self.db.commit()
            self.index.save()

    # ---------------------------------------------------------------- ingest

    def ingest(
        self,
        data: bytes,
        filename: str,
        content_type: str | None = None,
        *,
        title: str | None = None,
        document_id: int | None = None,
        label: str | None = None,
        source_type: str = "file",
        source_ref: str | None = None,
    ) -> IngestResult:
        if len(data) > self.settings.max_upload_bytes:
            raise IngestError(f"File is larger than {self.settings.max_upload_mb} MB.")
        filename = PurePosixPath(filename.replace("\\", "/")).name or "document"
        sections, kind, title_hint = load_document(data, filename, content_type, self.limits)
        chunks = chunk_sections(sections, self.settings.chunk_size, self.settings.chunk_overlap)
        file_hash = hashlib.sha256(data).hexdigest()
        source_ref = source_ref or filename
        label = (label or "").strip() or None

        with self.lock:
            # Which document does this belong to? Explicit id, else same file name / URL.
            if document_id is not None:
                doc = self.db.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
                if doc is None:
                    raise NotFound(f"Document {document_id} not found")
            else:
                doc = self.db.execute(
                    "SELECT * FROM documents WHERE source_type = ? AND source_ref = ? ORDER BY id LIMIT 1",
                    (source_type, source_ref),
                ).fetchone()

            latest = None
            if doc is not None:
                latest = self.db.execute(
                    "SELECT * FROM versions WHERE document_id = ? ORDER BY number DESC LIMIT 1",
                    (doc["id"],),
                ).fetchone()
                if latest is not None and latest["content_hash"] == file_hash:
                    return IngestResult(
                        status="unchanged",
                        document=self.list_one(doc["id"]),
                        version=self._version(latest),
                        new_chunks=0,
                        reused_chunks=latest["chunk_count"],
                    )

            cap = self.settings.max_storage_mb * 1024 * 1024
            if cap:
                used = self.db.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM versions").fetchone()[0]
                if used + len(data) > cap:
                    raise StorageFull(
                        f"Storage limit reached ({self.settings.max_storage_mb} MB). "
                        "Delete old documents or versions to make room."
                    )

            # Content-addressed chunk reuse: only unseen text gets embedded.
            unique: dict[str, str] = {}
            for c in chunks:
                unique.setdefault(c.hash, c.text)
            existing: dict[str, int] = {}
            hashes = list(unique)
            for batch in _batched(hashes):
                for r in self.db.execute(
                    f"SELECT id, hash FROM chunks WHERE hash IN ({_placeholders(len(batch))})", batch
                ):
                    existing[r["hash"]] = r["id"]
            new_hashes = [h for h in hashes if h not in existing]
            new_set = set(new_hashes)
            vectors = self.embedder.embed_documents([unique[h] for h in new_hashes])

            new_ids: list[int] = []
            try:
                for h in new_hashes:
                    cur = self.db.execute("INSERT INTO chunks (hash, text) VALUES (?, ?)", (h, unique[h]))
                    existing[h] = cur.lastrowid
                    new_ids.append(cur.lastrowid)
                    self.db.execute("INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)", (cur.lastrowid, unique[h]))

                now = _now()
                if doc is None:
                    doc_title = (title or title_hint or PurePosixPath(filename).stem or filename).strip()
                    cur = self.db.execute(
                        "INSERT INTO documents (title, source_type, source_ref, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (doc_title, source_type, source_ref, now, now),
                    )
                    doc_id = cur.lastrowid
                    status = "created"
                else:
                    doc_id = doc["id"]
                    status = "new_version"
                    if title:
                        self.db.execute("UPDATE documents SET title = ? WHERE id = ?", (title.strip(), doc_id))
                    self.db.execute("UPDATE documents SET updated_at = ? WHERE id = ?", (now, doc_id))

                number = (latest["number"] + 1) if latest is not None else 1
                cur = self.db.execute(
                    "INSERT INTO versions (document_id, number, label, content_hash, source_name, mime, "
                    "size_bytes, text, chunk_count, new_chunk_count, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        doc_id,
                        number,
                        label,
                        file_hash,
                        filename,
                        KIND_MIME[kind],
                        len(data),
                        "\n\n".join(s.text for s in sections),
                        len(chunks),
                        len(new_hashes),
                        now,
                    ),
                )
                version_id = cur.lastrowid
                self.db.executemany(
                    "INSERT INTO version_chunks (version_id, ordinal, chunk_id, page, heading) VALUES (?, ?, ?, ?, ?)",
                    [(version_id, c.ordinal, existing[c.hash], c.page, c.heading) for c in chunks],
                )
                self.index.add(new_ids, vectors)
                self.db.commit()
            except Exception:
                self.db.rollback()
                self.index.remove(new_ids)
                raise
            self.index.save()

            return IngestResult(
                status=status,
                document=self.list_one(doc_id),
                version=self._version(self._version_row(doc_id, number)),
                new_chunks=len(new_hashes),
                reused_chunks=sum(1 for c in chunks if c.hash not in new_set),
            )

    def list_one(self, document_id: int) -> DocumentOut:
        row = self.db.execute(self._DOC_SQL + " WHERE d.id = ? GROUP BY d.id", (document_id,)).fetchone()
        if row is None:
            raise NotFound(f"Document {document_id} not found")
        return self._doc(row)

    def ingest_url(
        self,
        url: str,
        *,
        title: str | None = None,
        document_id: int | None = None,
        label: str | None = None,
    ) -> IngestResult:
        fetched = self.fetcher(
            url,
            max_bytes=self.settings.max_upload_bytes,
            allow_private=self.settings.allow_private_urls,
        )
        return self.ingest(
            fetched.data,
            fetched.filename,
            fetched.content_type,
            title=title,
            document_id=document_id,
            label=label,
            source_type="url",
            source_ref=url,
        )

    def refresh(self, document_id: int, label: str | None = None) -> IngestResult:
        with self.lock:
            doc = self.db.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        if doc is None:
            raise NotFound(f"Document {document_id} not found")
        if doc["source_type"] != "url":
            raise IngestError("Only documents added from a link can be refreshed. Upload a new file instead.")
        return self.ingest_url(doc["source_ref"], document_id=document_id, label=label)

    # ---------------------------------------------------------------- search

    def resolve_scope(self, scope: Scope) -> list[int]:
        where, params = [], []
        if scope.document_ids:
            where.append(f"v.document_id IN ({_placeholders(len(scope.document_ids))})")
            params += scope.document_ids
        if scope.mode == "latest":
            where.append("v.number = (SELECT MAX(number) FROM versions WHERE document_id = v.document_id)")
        elif scope.mode == "version":
            where.append("v.number = ?")
            params.append(scope.version)
        elif scope.mode == "range":
            where.append("v.number BETWEEN ? AND ?")
            params += [scope.version_from, scope.version_to]
        sql = "SELECT v.id FROM versions v" + (" WHERE " + " AND ".join(where) if where else "")
        with self.lock:
            ids = [r[0] for r in self.db.execute(sql, params)]
        if not ids and scope.mode == "version":
            raise NotFound(f"Version v{scope.version} not found")
        return ids

    def search(self, query: str, scope: Scope, k: int | None = None) -> list[SearchHit]:
        k = k or self.settings.default_top_k
        version_ids = self.resolve_scope(scope)
        if not version_ids:
            return []
        qvec = self.embedder.embed_query(query)
        vph = _placeholders(len(version_ids))

        with self.lock:
            allowed = [
                r[0]
                for r in self.db.execute(
                    f"SELECT DISTINCT chunk_id FROM version_chunks WHERE version_id IN ({vph})", version_ids
                )
            ]
            vector_hits = self.index.search(qvec, k * 4, allowed)

            keyword_ids: list[int] = []
            match = fts_query(query)
            if match:
                keyword_ids = [
                    r[0]
                    for r in self.db.execute(
                        f"SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? AND rowid IN "
                        f"(SELECT chunk_id FROM version_chunks WHERE version_id IN ({vph})) "
                        "ORDER BY bm25(chunks_fts) LIMIT ?",
                        [match, *version_ids, k * 4],
                    )
                ]

            # Reciprocal-rank fusion of semantic + keyword rankings
            fused: dict[int, float] = {}
            vector_score = dict(vector_hits)
            for rank, (cid, _) in enumerate(vector_hits):
                fused[cid] = fused.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
            for rank, cid in enumerate(keyword_ids):
                fused[cid] = fused.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
            top = sorted(fused, key=fused.__getitem__, reverse=True)[:k]
            if not top:
                return []

            tph = _placeholders(len(top))
            texts = {
                r["id"]: r["text"] for r in self.db.execute(f"SELECT id, text FROM chunks WHERE id IN ({tph})", top)
            }
            occurrences = self.db.execute(
                f"""SELECT vc.chunk_id, vc.page, vc.heading, v.number, v.label, d.id AS doc_id, d.title
                    FROM version_chunks vc
                    JOIN versions v ON v.id = vc.version_id
                    JOIN documents d ON d.id = v.document_id
                    WHERE vc.chunk_id IN ({tph}) AND vc.version_id IN ({vph})
                    ORDER BY v.number, vc.ordinal""",
                [*top, *version_ids],
            ).fetchall()

        grouped: dict[tuple[int, int], dict[str, Any]] = {}
        for o in occurrences:
            key = (o["chunk_id"], o["doc_id"])
            entry = grouped.setdefault(key, {"title": o["title"], "versions": {}})
            entry["versions"].setdefault(
                o["number"],
                HitVersion(
                    number=o["number"],
                    label=o["label"],
                    page=o["page"],
                    heading=self._out(o["heading"]) if o["heading"] else None,
                ),
            )

        max_score = max(fused[c] for c in top)
        keyword_set = set(keyword_ids)
        hits: list[SearchHit] = []
        for cid in top:
            for (chunk_id, doc_id), entry in grouped.items():
                if chunk_id != cid:
                    continue
                versions = sorted(entry["versions"].values(), key=lambda v: v.number, reverse=True)
                hits.append(
                    SearchHit(
                        chunk_id=cid,
                        text=self._out(texts[cid]),
                        score=round(fused[cid] / max_score, 4),
                        vector_score=round(vector_score[cid], 4) if cid in vector_score else None,
                        keyword_match=cid in keyword_set,
                        document=DocRef(id=doc_id, title=entry["title"]),
                        versions=versions,
                    )
                )
        return hits

    def relevant(self, hits: list[SearchHit]) -> list[SearchHit]:
        """Hits good enough to show the LLM: a keyword match, or semantic
        similarity at or above ``min_relevance``. Fusion always returns the top
        k, even for an unrelated question; this stops weak matches being passed
        off as grounding."""
        floor = self.settings.min_relevance
        if floor <= 0:
            return hits
        return [h for h in hits if h.keyword_match or (h.vector_score is not None and h.vector_score >= floor)]

    # ------------------------------------------------------------------ diff

    def diff(self, document_id: int, old: int, new: int) -> dict[str, Any]:
        with self.lock:
            doc = self.list_one(document_id)
            a = self._version_row(document_id, old)
            b = self._version_row(document_id, new)
            chunk_sets = {}
            for row in (a, b):
                chunk_sets[row["id"]] = {
                    r[0]
                    for r in self.db.execute("SELECT chunk_id FROM version_chunks WHERE version_id = ?", (row["id"],))
                }
        result = diff_texts(self._out(a["text"]), self._out(b["text"]))
        sa, sb = chunk_sets[a["id"]], chunk_sets[b["id"]]
        return {
            "document": doc,
            "old": self._version(a),
            "new": self._version(b),
            "stats": result["stats"],
            "chunk_stats": {"shared": len(sa & sb), "only_old": len(sa - sb), "only_new": len(sb - sa)},
            "blocks": result["blocks"],
        }

    def diff_messages(self, document_id: int, old: int, new: int) -> list[tuple[str, str]]:
        d = self.diff(document_id, old, new)

        def label(v: VersionOut) -> str:
            return f"v{v.number}" + (f" ({v.label})" if v.label else "")

        return build_diff_messages(d["document"].title, label(d["old"]), label(d["new"]), changes_for_prompt(d))
