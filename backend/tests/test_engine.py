from __future__ import annotations

import pytest

from app.engine import Engine, NotFound, fts_query
from app.ingest.loaders import IngestError
from app.schemas import Scope

from .conftest import POLICY_V1, POLICY_V2


def _ingest_two_versions(engine: Engine):
    r1 = engine.ingest(POLICY_V1, "policy.md", "text/markdown")
    r2 = engine.ingest(POLICY_V2, "policy.md", "text/markdown", label="2025-Q2")
    return r1, r2


def test_same_filename_becomes_new_version(engine):
    r1, r2 = _ingest_two_versions(engine)
    assert r1.status == "created" and r1.version.number == 1
    assert r2.status == "new_version" and r2.version.number == 2
    assert r2.document.id == r1.document.id
    assert r2.version.label == "2025-Q2"
    assert engine.get_document(r1.document.id).version_count == 2


def test_unchanged_content_does_not_create_version(engine):
    engine.ingest(POLICY_V1, "policy.md")
    again = engine.ingest(POLICY_V1, "policy.md")
    assert again.status == "unchanged"
    assert again.version.number == 1


def test_only_changed_chunks_are_embedded(engine):
    r1, r2 = _ingest_two_versions(engine)
    assert r1.new_chunks == r1.version.chunk_count
    # Only the refund section changed; shipping + support are reused
    assert r2.new_chunks == 1
    assert r2.reused_chunks == r2.version.chunk_count - 1
    assert engine.index.size == engine.stats()["chunks"]


def test_search_is_scoped_to_version(engine):
    r1, _ = _ingest_two_versions(engine)
    doc = r1.document.id

    latest = engine.search("refund days", Scope(document_ids=[doc]))
    assert "14 days" in latest[0].text
    assert all("30 days" not in h.text for h in latest)

    v1 = engine.search("refund days", Scope(document_ids=[doc], mode="version", version=1))
    assert "30 days" in v1[0].text
    assert all("14 days" not in h.text for h in v1)

    everything = engine.search("refund days", Scope(document_ids=[doc], mode="all"), k=10)
    texts = " ".join(h.text for h in everything)
    assert "30 days" in texts and "14 days" in texts


def test_shared_chunk_reports_all_versions(engine):
    r1, _ = _ingest_two_versions(engine)
    hits = engine.search("express shipping", Scope(document_ids=[r1.document.id], mode="all"))
    shipping = next(h for h in hits if "Express" in h.text)
    assert [v.number for v in shipping.versions] == [2, 1]
    assert shipping.versions[0].heading == "Shipping"


def test_range_scope(engine):
    engine.ingest(POLICY_V1, "p.md")
    engine.ingest(POLICY_V2, "p.md")
    r3 = engine.ingest(POLICY_V2.replace(b"14 days", b"7 days"), "p.md")
    doc = r3.document.id
    hits = engine.search("refund", Scope(document_ids=[doc], mode="range", version_from=2, version_to=3), k=10)
    text = " ".join(h.text for h in hits)
    assert "30 days" not in text
    assert "14 days" in text and "7 days" in text


def test_missing_version_raises(engine):
    r1 = engine.ingest(POLICY_V1, "policy.md")
    with pytest.raises(NotFound):
        engine.search("x", Scope(document_ids=[r1.document.id], mode="version", version=9))


def test_diff_between_versions(engine):
    r1, _ = _ingest_two_versions(engine)
    d = engine.diff(r1.document.id, 1, 2)
    assert d["stats"]["modified"] == 1
    modified = next(b for b in d["blocks"] if b["type"] == "modified")
    inserted = "".join(s["text"] for s in modified["segments"] if s["op"] == "insert")
    deleted = "".join(s["text"] for s in modified["segments"] if s["op"] == "delete")
    assert "14" in inserted and "30" in deleted
    assert d["chunk_stats"]["only_new"] == 1


def test_delete_version_garbage_collects_chunks(engine):
    r1, _ = _ingest_two_versions(engine)
    before = engine.stats()["chunks"]
    engine.delete_version(r1.document.id, 1)
    after = engine.stats()
    assert after["chunks"] == before - 1  # the old refund chunk
    assert after["vectors"] == after["chunks"]
    hits = engine.search("refund", Scope(mode="all"), k=10)
    assert all("30 days" not in h.text for h in hits)


def test_delete_document(engine):
    r1, _ = _ingest_two_versions(engine)
    engine.delete_document(r1.document.id)
    assert engine.list_documents() == []
    assert engine.stats() == {"documents": 0, "versions": 0, "chunks": 0, "vectors": 0}


def test_identical_text_shared_across_documents(engine):
    a = engine.ingest(POLICY_V1, "a.md")
    b = engine.ingest(POLICY_V1, "b.md")
    assert a.document.id != b.document.id
    assert b.new_chunks == 0
    engine.delete_document(a.document.id)
    assert engine.stats()["chunks"] == b.version.chunk_count


def test_url_ingest_and_refresh(engine, fetcher):
    url = "https://example.com/terms.html"
    fetcher.pages[url] = (
        b"<html><title>Terms</title><main><h2>Fees</h2><p>The fee is 10 EUR.</p></main></html>",
        "text/html",
    )
    r1 = engine.ingest_url(url)
    assert r1.document.title == "Terms" and r1.document.source_type == "url"

    assert engine.refresh(r1.document.id).status == "unchanged"

    fetcher.pages[url] = (
        b"<html><title>Terms</title><main><h2>Fees</h2><p>The fee is 12 EUR.</p></main></html>",
        "text/html",
    )
    r2 = engine.refresh(r1.document.id, label="price change")
    assert r2.status == "new_version" and r2.version.number == 2


def test_refresh_rejects_file_documents(engine):
    r1 = engine.ingest(POLICY_V1, "policy.md")
    with pytest.raises(IngestError):
        engine.refresh(r1.document.id)


def test_index_rebuilt_when_missing(settings, fetcher):
    e1 = Engine(settings, fetcher=fetcher)
    _ingest_two_versions(e1)
    chunks = e1.stats()["chunks"]
    (settings.data_dir / "chunks.faiss").unlink()
    e2 = Engine(settings, fetcher=fetcher)
    assert e2.index.size == chunks
    assert e2.search("express shipping", Scope())


def test_rejects_unsupported_and_empty(engine):
    with pytest.raises(IngestError):
        engine.ingest(b"\x01\x02binary", "image.png", "image/png")
    with pytest.raises(IngestError):
        engine.ingest(b"", "empty.txt")


def test_fts_query_sanitises_operators():
    # quotes/parens/operators can't leak into FTS5 syntax; stopwords are dropped
    assert fts_query('what is "refund" AND (policy)*?') == '"refund" OR "policy"'
    assert fts_query("the of a") == ""
