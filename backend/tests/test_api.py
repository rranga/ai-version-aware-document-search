from __future__ import annotations

import json

from .conftest import POLICY_V1, POLICY_V2


def _upload(client, data: bytes, name="policy.md", **form):
    return client.post("/api/documents", files={"file": (name, data, "text/markdown")}, data=form)


def _events(body: str) -> list[tuple[str, object]]:
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["llm"]["reachable"] is True
    assert body["embedding_model"] == "hash-384"


def test_upload_versions_and_list(client):
    r1 = _upload(client, POLICY_V1)
    assert r1.status_code == 201 and r1.json()["status"] == "created"
    doc_id = r1.json()["document"]["id"]
    r2 = _upload(client, POLICY_V2, label="v2 draft")
    assert r2.json()["version"]["number"] == 2

    docs = client.get("/api/documents").json()
    assert len(docs) == 1 and docs[0]["latest_version"] == 2

    detail = client.get(f"/api/documents/{doc_id}").json()
    assert [v["number"] for v in detail["versions"]] == [2, 1]

    text = client.get(f"/api/documents/{doc_id}/versions/1").json()["text"]
    assert "30 days" in text


def test_explicit_document_id_versions_a_differently_named_file(client):
    doc_id = _upload(client, POLICY_V1, name="policy-2024.md").json()["document"]["id"]
    r = _upload(client, POLICY_V2, name="policy-2025.md", document_id=str(doc_id))
    assert r.json()["document"]["id"] == doc_id
    assert r.json()["version"]["number"] == 2


def test_search_scope_validation(client):
    r = client.post("/api/search", json={"query": "refund", "scope": {"mode": "version", "version": 1}})
    assert r.status_code == 422


def test_search_and_diff(client):
    doc_id = _upload(client, POLICY_V1).json()["document"]["id"]
    _upload(client, POLICY_V2)

    r = client.post(
        "/api/search",
        json={"query": "refund", "scope": {"document_ids": [doc_id], "mode": "version", "version": 1}},
    )
    assert "30 days" in r.json()["hits"][0]["text"]

    d = client.get(f"/api/documents/{doc_id}/diff", params={"from": 1, "to": 2}).json()
    assert d["stats"]["modified"] == 1


def test_ask_streams_sources_then_tokens(client):
    _upload(client, POLICY_V1)
    r = client.post("/api/ask", json={"query": "How long do I have to get a refund?"})
    assert r.headers["content-type"].startswith("text/event-stream")
    events = _events(r.text)
    assert events[0][0] == "sources" and events[0][1]
    assert any(e == "token" for e, _ in events)
    assert events[-1][0] == "done"


def test_ask_without_documents(client):
    events = _events(client.post("/api/ask", json={"query": "anything"}).text)
    assert events[0] == ("sources", [])
    assert "couldn't find" in events[1][1]


def test_diff_summary_stream(client):
    doc_id = _upload(client, POLICY_V1).json()["document"]["id"]
    _upload(client, POLICY_V2)
    events = _events(client.post(f"/api/documents/{doc_id}/diff/summary?from=1&to=2").text)
    assert [e for e, _ in events][-1] == "done"
    assert "updated" in "".join(d for e, d in events if e == "token")


def test_errors(client):
    assert client.get("/api/documents/999").status_code == 404
    bad = client.post("/api/documents", files={"file": ("x.png", b"\x89PNG....", "image/png")})
    assert bad.status_code == 422
    assert client.post("/api/documents/url", json={"url": "not a url"}).status_code == 422


def test_label_and_delete(client):
    doc_id = _upload(client, POLICY_V1).json()["document"]["id"]
    _upload(client, POLICY_V2)
    r = client.patch(f"/api/documents/{doc_id}/versions/2", json={"label": "Final"})
    assert r.json()["label"] == "Final"
    assert client.delete(f"/api/documents/{doc_id}/versions/1").status_code == 204
    assert client.get(f"/api/documents/{doc_id}").json()["version_count"] == 1
    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    assert client.get("/api/documents").json() == []
