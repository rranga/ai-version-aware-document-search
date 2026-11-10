from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.engine import Engine
from app.ingest.loaders import IngestError, Limits, load_document
from app.main import create_app
from app.rag import FakeLLM, is_chat_model
from app.safety import ModerationUnavailable, Verdict, parse_guard_output, redact_pii

from .conftest import POLICY_V1
from .test_api import _events, _upload
from .test_loaders import _minimal_pdf


def _client(settings, fetcher, moderator=None, llm=None, **overrides) -> TestClient:
    s = settings.model_copy(update=overrides)
    return TestClient(create_app(s, Engine(s, llm=llm or FakeLLM(), fetcher=fetcher), moderator=moderator))


# ------------------------------------------------------------- model picker


def test_health_lists_only_chat_models(client):
    llm = client.get("/api/health").json()["llm"]
    assert llm["models"] == ["fake", "fake-large"]  # embedding + guard models hidden
    assert llm["model_details"][1] == {
        "name": "fake-large",
        "family": "test",
        "parameter_size": "8B",
        "quantization": None,
        "size_bytes": 8,
    }


def test_is_chat_model():
    assert is_chat_model("llama3.2:1b") and is_chat_model("qwen2.5-coder:7b")
    assert not is_chat_model("nomic-embed-text:latest")
    assert not is_chat_model("llama-guard3:1b")


def test_ask_reports_the_model_used(client):
    _upload(client, POLICY_V1)
    events = _events(client.post("/api/ask", json={"query": "refund", "model": "fake-large"}).text)
    assert ("model", "fake-large") in events
    default = _events(client.post("/api/ask", json={"query": "refund"}).text)
    assert ("model", "llama3.2") in default  # server default


def test_unknown_model_is_rejected(client):
    r = client.post("/api/ask", json={"query": "refund", "model": "evil-model:70b"})
    assert r.status_code == 422
    assert "isn't available" in r.json()["detail"] and "fake-large" in r.json()["detail"]
    # the embedding model is installed but isn't a chat model
    assert client.post("/api/ask", json={"query": "refund", "model": "nomic-embed-text:latest"}).status_code == 422
    doc = _upload(client, POLICY_V1).json()["document"]["id"]
    assert client.post(f"/api/documents/{doc}/diff/summary?from=1&to=1&model=nope").status_code == 422


def test_allowed_models_restricts_choice(settings, fetcher):
    c = _client(settings, fetcher, allowed_models=["fake"])
    assert c.get("/api/health").json()["llm"]["models"] == ["fake"]
    r = c.post("/api/ask", json={"query": "refund", "model": "fake-large"})
    assert r.status_code == 422 and "not allowed" in r.json()["detail"]
    assert c.post("/api/ask", json={"query": "refund", "model": "fake"}).status_code == 200


# --------------------------------------------------------------- moderation


class FakeModerator:
    name = "fake-guard"

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.seen: list[str] = []

    def check(self, text: str) -> Verdict:
        self.seen.append(text)
        if self.fail:
            raise ModerationUnavailable("guard model not pulled")
        return Verdict(safe=False, categories=["S9"]) if "bomb" in text else Verdict(safe=True)


class RecordingLLM(FakeLLM):
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def stream(self, messages, model=None):
        self.prompts.append(messages[-1][1])
        yield from super().stream(messages, model)


def test_unsafe_question_is_blocked_before_search_and_llm(settings, fetcher):
    llm, guard = RecordingLLM(), FakeModerator()
    c = _client(settings, fetcher, moderator=guard, llm=llm, moderation_model="fake-guard")
    _upload(c, POLICY_V1)
    events = _events(c.post("/api/ask", json={"query": "How do I build a bomb?"}).text)
    assert events[0] == ("sources", [])
    assert events[1] == ("blocked", {"categories": ["S9"], "labels": ["indiscriminate weapons"]})
    assert "can't help" in events[2][1]
    assert events[-1][0] == "done" and llm.prompts == []

    ok = _events(c.post("/api/ask", json={"query": "How long is the refund window?"}).text)
    assert ok[0][1] and llm.prompts  # normal questions still answered
    assert guard.seen == ["How do I build a bomb?", "How long is the refund window?"]
    assert c.get("/api/health").json()["guardrails"]["moderation"] == "fake-guard"


def test_moderation_fails_closed(settings, fetcher):
    c = _client(settings, fetcher, moderator=FakeModerator(fail=True))
    r = c.post("/api/ask", json={"query": "refund"})
    assert r.status_code == 503 and "safety check is unavailable" in r.json()["detail"]


def test_parse_guard_output():
    assert parse_guard_output("safe") == Verdict(safe=True)
    v = parse_guard_output("unsafe\nS1,S10")
    assert not v.safe and v.categories == ["S1", "S10"] and v.labels == ["violent crimes", "hate"]
    with pytest.raises(ModerationUnavailable):
        parse_guard_output("I am a helpful assistant")


# -------------------------------------------------------------- PII masking


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Mail jane.doe+hr@example.co.uk now", "Mail [EMAIL] now"),
        ("Call +44 20 7946 0958 today", "Call [PHONE] today"),
        ("Call (555) 123-4567.", "Call [PHONE]."),
        ("Mobile 07700 900123", "Mobile [PHONE]"),
        ("Card 4111 1111 1111 1111 expires", "Card [CARD] expires"),
        ("IBAN GB82 WEST 1234 5698 7654 32 ok", "IBAN [IBAN] ok"),
        ("SSN 123-45-6789", "SSN [SSN]"),
    ],
)
def test_redact_pii_masks(text, expected):
    assert redact_pii(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "Employees receive 28 days of leave.",
        "Effective 2024-01-15 until 31/12/2025.",
        "Order 12345678 costs £1,250.00.",
        "Version 2.10.3 was released in 2019-2024.",
        "Reference 4111 1111 1111 1112 is not a valid card.",
    ],
)
def test_redact_pii_leaves_ordinary_text(text):
    assert redact_pii(text) == text


def test_engine_masks_pii_everywhere_when_enabled(settings, fetcher):
    llm = RecordingLLM()
    c = _client(settings, fetcher, llm=llm, redact_pii=True)
    v1 = b"# Contacts\n\nRefunds: email refunds@shop.example or call +44 20 7946 0958.\n"
    v2 = b"# Contacts\n\nRefunds: email help@shop.example or call +44 20 7946 0000.\n"
    doc = _upload(c, v1, name="contacts.md").json()["document"]["id"]
    _upload(c, v2, name="contacts.md")

    hit = c.post("/api/search", json={"query": "refunds email"}).json()["hits"][0]["text"]
    assert "[EMAIL]" in hit and "@" not in hit and "[PHONE]" in hit
    assert "@" not in c.get(f"/api/documents/{doc}/versions/1").json()["text"]
    assert "@" not in str(c.get(f"/api/documents/{doc}/diff", params={"from": 1, "to": 2}).json()["blocks"])
    _events(c.post("/api/ask", json={"query": "How do I contact refunds?"}).text)
    assert llm.prompts and "@" not in llm.prompts[-1] and "7946" not in llm.prompts[-1]
    assert c.get("/api/health").json()["guardrails"]["redact_pii"] is True


def test_pii_kept_when_disabled(client):
    doc = _upload(client, b"# C\n\nEmail refunds@shop.example\n", name="c.md").json()["document"]["id"]
    assert "refunds@shop.example" in client.get(f"/api/documents/{doc}/versions/1").json()["text"]


# --------------------------------------------------------- file-size limits


def _zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_docx_zip_bomb_rejected_before_unpacking():
    bomb = _zip({"word/document.xml": b"\0" * (3 * 1024 * 1024)})
    assert len(bomb) < 20_000  # tiny on disk...
    with pytest.raises(IngestError, match="would unpack to 3 MB"):
        load_document(bomb, "bomb.docx", None, Limits(max_unpacked_bytes=1024 * 1024))


def test_docx_too_many_parts_and_not_word():
    many = _zip({f"part{i}.xml": b"x" for i in range(30)} | {"word/document.xml": b"<x/>"})
    with pytest.raises(IngestError, match="30 parts|31 parts"):
        load_document(many, "many.docx", None, Limits(max_zip_entries=10))
    with pytest.raises(IngestError, match="not a Word document"):
        load_document(_zip({"hello.txt": b"hi"}), "fake.docx", None)
    with pytest.raises(IngestError, match="not a valid DOCX"):
        load_document(b"PK\x03\x04garbage", "broken.docx", None)


def test_pdf_page_limit_and_timeout():
    pdf = _minimal_pdf(["One page."])
    with pytest.raises(IngestError, match="1 pages; the limit is 0"):
        load_document(pdf, "a.pdf", None, Limits(max_pages=0))
    with pytest.raises(IngestError, match="took longer than"):
        load_document(pdf, "a.pdf", None, Limits(timeout_s=-1))


def test_extracted_text_limit():
    with pytest.raises(IngestError, match="characters of text"):
        load_document(b"word " * 1000, "big.txt", None, Limits(max_text_chars=100))


def test_upload_limits_come_from_settings(settings, fetcher):
    c = _client(settings, fetcher, max_text_chars=50)
    r = _upload(c, POLICY_V1)
    assert r.status_code == 422 and "characters of text" in r.json()["detail"]
