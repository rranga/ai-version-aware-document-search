from __future__ import annotations

import hashlib
from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter

from .loaders import Section


@dataclass
class Chunk:
    ordinal: int
    text: str
    hash: str
    page: int | None
    heading: str | None


def content_hash(text: str) -> str:
    """Whitespace-insensitive fingerprint, so re-flowed but identical text
    in a new version maps to the same chunk (and is not re-embedded)."""
    return hashlib.sha256(" ".join(text.split()).encode("utf-8")).hexdigest()


def chunk_sections(sections: list[Section], chunk_size: int, chunk_overlap: int) -> list[Chunk]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks: list[Chunk] = []
    # Splitting per section keeps an edit in one section from shifting the
    # chunk boundaries (and therefore hashes) of every later section.
    for section in sections:
        for piece in splitter.split_text(section.text):
            piece = piece.strip()
            if not piece:
                continue
            chunks.append(
                Chunk(
                    ordinal=len(chunks),
                    text=piece,
                    hash=content_hash(piece),
                    page=section.page,
                    heading=section.heading,
                )
            )
    return chunks
