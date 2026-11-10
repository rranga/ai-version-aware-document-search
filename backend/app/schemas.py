from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, model_validator


class VersionOut(BaseModel):
    id: int
    number: int
    label: str | None
    source_name: str
    mime: str
    size_bytes: int
    chunk_count: int
    new_chunk_count: int
    created_at: str


class DocumentOut(BaseModel):
    id: int
    title: str
    source_type: Literal["file", "url"]
    source_ref: str
    created_at: str
    updated_at: str
    version_count: int
    latest_version: int


class DocumentDetail(DocumentOut):
    versions: list[VersionOut]


class IngestResult(BaseModel):
    status: Literal["created", "new_version", "unchanged"]
    document: DocumentOut
    version: VersionOut
    new_chunks: int
    reused_chunks: int


class UrlIngestRequest(BaseModel):
    url: HttpUrl
    title: str | None = None
    document_id: int | None = None
    label: str | None = None


class VersionLabelUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=80)


class Scope(BaseModel):
    """Which documents and versions a search covers.

    - latest: newest version of each selected document (default)
    - all: every version of each selected document
    - version: one exact version (requires exactly one document)
    - range: versions ``version_from``..``version_to`` (requires exactly one document)
    """

    document_ids: list[int] | None = None
    mode: Literal["latest", "all", "version", "range"] = "latest"
    version: int | None = None
    version_from: int | None = None
    version_to: int | None = None

    @model_validator(mode="after")
    def _check(self) -> Scope:
        if self.mode in ("version", "range") and (not self.document_ids or len(self.document_ids) != 1):
            raise ValueError(f"mode '{self.mode}' requires exactly one document_id")
        if self.mode == "version" and self.version is None:
            raise ValueError("mode 'version' requires 'version'")
        if self.mode == "range":
            if self.version_from is None or self.version_to is None:
                raise ValueError("mode 'range' requires 'version_from' and 'version_to'")
            if self.version_from > self.version_to:
                self.version_from, self.version_to = self.version_to, self.version_from
        return self


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    scope: Scope = Field(default_factory=Scope)
    k: int | None = Field(default=None, ge=1, le=50)


class AskRequest(SearchRequest):
    model: str | None = None


class DocRef(BaseModel):
    id: int
    title: str


class HitVersion(BaseModel):
    number: int
    label: str | None
    page: int | None
    heading: str | None


class SearchHit(BaseModel):
    chunk_id: int
    text: str
    score: float
    vector_score: float | None
    keyword_match: bool
    document: DocRef
    versions: list[HitVersion]


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]
