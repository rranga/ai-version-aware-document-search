"""SQLite metadata store: documents -> versions -> chunks.

Chunks are content-addressed (unique sha256), so text that is unchanged
between versions is stored and embedded exactly once. ``version_chunks``
records where each chunk appears in each version (ordinal, page, heading).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('file', 'url')),
    source_ref  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents (source_type, source_ref);

CREATE TABLE IF NOT EXISTS versions (
    id              INTEGER PRIMARY KEY,
    document_id     INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    number          INTEGER NOT NULL,
    label           TEXT,
    content_hash    TEXT NOT NULL,
    source_name     TEXT NOT NULL,
    mime            TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    text            TEXT NOT NULL,
    chunk_count     INTEGER NOT NULL,
    new_chunk_count INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    UNIQUE (document_id, number)
);

CREATE TABLE IF NOT EXISTS chunks (
    id   INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS version_chunks (
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    ordinal    INTEGER NOT NULL,
    chunk_id   INTEGER NOT NULL REFERENCES chunks (id),
    page       INTEGER,
    heading    TEXT,
    PRIMARY KEY (version_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_version_chunks_chunk ON version_chunks (chunk_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5 (text, tokenize = 'porter unicode61');
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    return conn


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
