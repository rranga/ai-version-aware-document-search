"""Turn raw bytes (PDF, DOCX, TXT, Markdown, HTML) into ordered sections.

A section is a run of text with optional page number and heading. Headings
are kept as the first line of a section's text so they are searchable and
show up in version diffs.
"""

from __future__ import annotations

import io
import re
import time
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath


class IngestError(ValueError):
    """The document could not be read or contained no extractable text."""


@dataclass(frozen=True)
class Limits:
    """Safety limits for parsing untrusted files."""

    max_unpacked_bytes: int = 200 * 1024 * 1024
    max_pages: int = 2000
    timeout_s: float = 120.0
    max_text_chars: int = 5_000_000
    max_zip_entries: int = 5000


DEFAULT_LIMITS = Limits()


class _Deadline:
    def __init__(self, seconds: float) -> None:
        self.end = time.monotonic() + seconds
        self.seconds = seconds

    def check(self) -> None:
        if time.monotonic() > self.end:
            raise IngestError(f"Reading the file took longer than {self.seconds:g} s and was stopped.")


@dataclass
class Section:
    text: str
    page: int | None = None
    heading: str | None = None


SUPPORTED_KINDS = ("pdf", "docx", "txt", "md", "html")

_EXT_KIND = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".txt": "txt",
    ".text": "txt",
    ".md": "md",
    ".markdown": "md",
    ".html": "html",
    ".htm": "html",
}

_MIME_KIND = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/x-markdown": "md",
    "text/html": "html",
    "application/xhtml+xml": "html",
}

KIND_MIME = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "md": "text/markdown",
    "html": "text/html",
}


def detect_kind(filename: str, content_type: str | None, data: bytes) -> str:
    ext = PurePosixPath(filename.lower()).suffix
    if ext in _EXT_KIND:
        return _EXT_KIND[ext]
    mime = (content_type or "").split(";")[0].strip().lower()
    if mime in _MIME_KIND:
        return _MIME_KIND[mime]
    head = data[:512].lstrip().lower()
    if head.startswith(b"%pdf"):
        return "pdf"
    if head.startswith((b"<!doctype html", b"<html")):
        return "html"
    if data[:2] == b"PK":
        return "docx"
    raise IngestError(f"Unsupported file type for '{filename}'. Supported: PDF, DOCX, TXT, Markdown, HTML.")


def _clean(text: str) -> str:
    """Collapse whitespace inside paragraphs, keep blank-line paragraph breaks."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    paragraphs = re.split(r"\n\s*\n", text)
    cleaned = [" ".join(p.split()) for p in paragraphs]
    return "\n\n".join(p for p in cleaned if p)


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def load_pdf(data: bytes, limits: Limits = DEFAULT_LIMITS) -> list[Section]:
    # pypdf also caps how much a single compressed stream may inflate to
    # (filters.ZLIB_MAX_OUTPUT_LENGTH), which stops classic PDF "bombs".
    from pypdf import PdfReader

    deadline = _Deadline(limits.timeout_s)
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise IngestError("This PDF is password-protected.")
        page_count = len(reader.pages)
    except IngestError:
        raise
    except Exception as exc:  # pypdf raises many types
        raise IngestError(f"Could not read PDF: {exc}") from exc
    if page_count > limits.max_pages:
        raise IngestError(f"PDF has {page_count} pages; the limit is {limits.max_pages}.")
    sections = []
    for number, page in enumerate(reader.pages, start=1):
        deadline.check()
        # Keep line breaks inside a page as paragraph hints for diffs
        try:
            raw = page.extract_text() or ""
        except Exception as exc:
            raise IngestError(f"Could not read page {number} of the PDF: {exc}") from exc
        text = _clean(re.sub(r"\n(?=\S)", "\n\n", raw))
        if text:
            sections.append(Section(text=text, page=number))
    return sections


def check_zip(data: bytes, limits: Limits = DEFAULT_LIMITS) -> None:
    """Reject zip "bombs" before anything is decompressed. Python's zipfile
    never inflates an entry beyond its declared size, so checking the declared
    sizes bounds the real work."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise IngestError("This file is not a valid DOCX (not a zip archive).") from exc
    infos = zf.infolist()
    if len(infos) > limits.max_zip_entries:
        raise IngestError(f"DOCX contains {len(infos)} parts; the limit is {limits.max_zip_entries}.")
    unpacked = sum(i.file_size for i in infos)
    if unpacked > limits.max_unpacked_bytes:
        raise IngestError(
            f"DOCX would unpack to {unpacked // (1024 * 1024)} MB; the limit is "
            f"{limits.max_unpacked_bytes // (1024 * 1024)} MB."
        )
    if "word/document.xml" not in zf.namelist():
        raise IngestError("This file is not a Word document (word/document.xml is missing).")


def load_docx(data: bytes, limits: Limits = DEFAULT_LIMITS) -> list[Section]:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    check_zip(data, limits)
    deadline = _Deadline(limits.timeout_s)
    try:
        doc = Document(io.BytesIO(data))
    except Exception as exc:
        raise IngestError(f"Could not read DOCX: {exc}") from exc

    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []

    def flush() -> None:
        if buf:
            sections.append(Section(text=_clean("\n\n".join(buf)), heading=heading))
            buf.clear()

    for child in doc.element.body.iterchildren():
        deadline.check()
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, doc)
            text = para.text.strip()
            if not text:
                continue
            style = (para.style.name if para.style is not None else "") or ""
            if style.startswith(("Heading", "Title")):
                flush()
                heading = text
            buf.append(text)
        elif tag == "tbl":
            table = Table(child, doc)
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells]
                # merged cells repeat; drop consecutive duplicates
                deduped = [c for i, c in enumerate(cells) if c and (i == 0 or c != cells[i - 1])]
                if deduped:
                    buf.append(" | ".join(deduped))
    flush()
    return [s for s in sections if s.text]


def load_text(data: bytes, markdown: bool) -> list[Section]:
    text = _decode(data)
    if not markdown:
        cleaned = _clean(text)
        return [Section(text=cleaned)] if cleaned else []

    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []
    in_code = False
    for line in text.splitlines():
        if line.strip().startswith("```"):
            in_code = not in_code
        match = None if in_code else re.match(r"^(#{1,6})\s+(.*)$", line)
        if match:
            if "".join(buf).strip():
                sections.append(Section(text=_clean("\n".join(buf)), heading=heading))
            heading = match.group(2).strip()
            buf = [heading, ""]
        else:
            buf.append(line)
    if "".join(buf).strip():
        sections.append(Section(text=_clean("\n".join(buf)), heading=heading))
    return [s for s in sections if s.text]


_BLOCK_TAGS = ["h1", "h2", "h3", "h4", "p", "li", "pre", "blockquote", "td", "th", "dt", "dd"]
_LEAF_PARENTS = ["p", "li", "pre", "blockquote", "td", "th", "dt", "dd"]


def load_html(data: bytes) -> tuple[list[Section], str | None]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(_decode(data), "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else None
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg"]):
        tag.decompose()
    root = soup.find("main") or soup.find("article") or soup.body or soup

    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []

    def flush() -> None:
        if buf:
            sections.append(Section(text=_clean("\n\n".join(buf)), heading=heading))
            buf.clear()

    for el in root.find_all(_BLOCK_TAGS):
        if el.find_parent(_LEAF_PARENTS):
            continue
        text = " ".join(el.get_text(" ").split())
        if not text:
            continue
        if el.name in ("h1", "h2", "h3", "h4"):
            flush()
            heading = text
        buf.append(text)
    flush()

    if not sections:
        fallback = _clean(root.get_text("\n\n"))
        if fallback:
            sections = [Section(text=fallback)]
    return [s for s in sections if s.text], title


def load_document(
    data: bytes, filename: str, content_type: str | None, limits: Limits = DEFAULT_LIMITS
) -> tuple[list[Section], str, str | None]:
    """Return (sections, kind, title_hint)."""
    if not data:
        raise IngestError("The file is empty.")
    kind = detect_kind(filename, content_type, data)
    title: str | None = None
    if kind == "pdf":
        sections = load_pdf(data, limits)
    elif kind == "docx":
        sections = load_docx(data, limits)
    elif kind == "html":
        sections, title = load_html(data)
    else:
        sections = load_text(data, markdown=kind == "md")

    if not sections:
        hint = " (scanned/image-only PDFs need OCR, which is not supported)" if kind == "pdf" else ""
        raise IngestError(f"No extractable text found in '{filename}'{hint}.")
    chars = sum(len(s.text) for s in sections)
    if chars > limits.max_text_chars:
        raise IngestError(
            f"'{filename}' contains {chars:,} characters of text; the limit is {limits.max_text_chars:,}."
        )
    return sections, kind, title
