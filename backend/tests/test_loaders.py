from __future__ import annotations

import io

import pytest

from app.ingest.fetch import fetch_url
from app.ingest.loaders import IngestError, load_document


def _minimal_pdf(lines: list[str]) -> bytes:
    content = "BT /F1 12 Tf 72 720 Td " + " ".join(f"({line}) Tj 0 -16 Td" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n{obj}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def test_pdf_pages():
    sections, kind, _ = load_document(_minimal_pdf(["Warranty lasts two years."]), "w.pdf", None)
    assert kind == "pdf"
    assert sections[0].page == 1
    assert "Warranty lasts two years." in sections[0].text


def test_docx_headings_and_tables():
    from docx import Document

    doc = Document()
    doc.add_heading("Leave Policy", level=1)
    doc.add_paragraph("Employees get 25 days of leave.")
    table = doc.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Sick leave"
    table.rows[0].cells[1].text = "10 days"
    buf = io.BytesIO()
    doc.save(buf)

    sections, kind, _ = load_document(buf.getvalue(), "hr.docx", None)
    assert kind == "docx"
    assert sections[0].heading == "Leave Policy"
    assert "25 days" in sections[0].text
    assert "Sick leave | 10 days" in sections[0].text


def test_markdown_ignores_hashes_in_code_blocks():
    md = b"# Title\n\nIntro.\n\n```\n# not a heading\n```\n\n## Next\n\nBody."
    sections, _, _ = load_document(md, "x.md", None)
    assert [s.heading for s in sections] == ["Title", "Next"]


def test_html_strips_chrome():
    html = b"<html><head><title>T</title><script>evil()</script></head><body><nav>Menu</nav><main><h1>H</h1><p>Real text.</p></main></body></html>"
    sections, kind, title = load_document(html, "page", "text/html")
    assert kind == "html" and title == "T"
    joined = " ".join(s.text for s in sections)
    assert "Real text." in joined and "Menu" not in joined and "evil" not in joined


def test_fetch_blocks_private_addresses():
    with pytest.raises(IngestError, match="private or local"):
        fetch_url("http://127.0.0.1:8000/secret", max_bytes=1000, allow_private=False)


def test_fetch_rejects_non_http():
    with pytest.raises(IngestError):
        fetch_url("file:///etc/passwd", max_bytes=1000, allow_private=False)
