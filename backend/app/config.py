from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every field can be set with an ``AT_`` env var,
    e.g. ``AT_OLLAMA_MODEL=mistral`` or ``AT_CORS_ORIGINS='["*"]'``."""

    model_config = SettingsConfigDict(env_prefix="AT_", env_file=".env", extra="ignore")

    data_dir: Path = Path("data")

    # "sentence-transformers" = real semantic embeddings (needs requirements-ml.txt)
    # "hash" = tiny deterministic keyword-hash embedder, used by tests/CI
    embedding_provider: Literal["sentence-transformers", "hash"] = "sentence-transformers"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"

    # "ollama" = local/self-hosted LLM; "fake" = canned answers for tests
    llm_provider: Literal["ollama", "fake"] = "ollama"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"
    llm_temperature: float = 0.2

    chunk_size: int = 1000
    chunk_overlap: int = 150
    default_top_k: int = 6

    max_upload_mb: int = 25
    # Total size of all stored versions; new uploads are refused beyond this (0 = no limit)
    max_storage_mb: int = 1000
    # Block fetching links that resolve to private/loopback addresses (SSRF guard)
    allow_private_urls: bool = False

    # --- Guardrails -------------------------------------------------------
    # When set, changes (upload, link, refresh, rename, label, delete) need the
    # header ``X-API-Key: <key>``. With ``protect_reads`` reads and search need it too.
    api_key: str | None = None
    protect_reads: bool = False

    # Per-client request limits (0 disables a limit). Ask covers /ask and diff summaries.
    rate_limit_ask_per_minute: int = 10
    rate_limit_search_per_minute: int = 60
    rate_limit_ingest_per_hour: int = 30
    # Backstop across all clients so the LLM can't be monopolised
    rate_limit_ask_global_per_minute: int = 60

    # Passages sent to the LLM must match a query keyword or reach this cosine
    # similarity; if none qualify the model isn't called (0 = send all hits).
    min_relevance: float = 0.25

    # Models users may pick. Unset = any chat model installed in Ollama
    # (embedding and safety models are never offered).
    allowed_models: list[str] | None = None

    # Optional safety check of questions with a Llama Guard model in Ollama,
    # e.g. "llama-guard3:1b". Unset = off. If set but unreachable, asks are refused.
    moderation_model: str | None = None

    # Mask emails, phone numbers, card numbers, IBANs and SSNs in everything
    # returned by the API and everything sent to the model.
    redact_pii: bool = False

    # File-parsing safety limits
    max_unpacked_mb: int = 200  # DOCX (zip) contents after decompression
    max_pages: int = 2000  # PDF pages
    parse_timeout_s: int = 120  # wall-clock budget for extracting text
    max_text_chars: int = 5_000_000  # extracted text per version

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://rranga.github.io",
    ]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
