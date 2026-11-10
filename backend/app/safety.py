"""Content safety: personal-data masking and optional Llama Guard moderation."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from .config import Settings

# ------------------------------------------------------------ PII masking

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
# 13–19 digits, optionally grouped by spaces or dashes; confirmed with Luhn
_CARD = re.compile(r"(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])")
# Phone-like: optional +, then 9–15 digits with common separators
# (can't start or end in the middle of a longer digit-group run like "4111 1111 …")
_PHONE = re.compile(
    r"(?<![\w+])(?<!\d[ .-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,5}\)[ .-]?)?\d[\d .-]{6,16}\d(?!\w)(?![ .-]\d)"
)
_DATE_LIKE = re.compile(r"^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$")


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
    return total % 10 == 0


def _card(m: re.Match[str]) -> str:
    digits = re.sub(r"\D", "", m.group(0))
    return "[CARD]" if 13 <= len(digits) <= 19 and _luhn(digits) else m.group(0)


def _phone(m: re.Match[str]) -> str:
    raw = m.group(0)
    digits = re.sub(r"\D", "", raw)
    if not 9 <= len(digits) <= 15 or _DATE_LIKE.match(raw.strip()):
        return raw
    # A plain run of digits without + or separators is more likely an ID or amount
    if raw.isdigit() and len(digits) < 10:
        return raw
    return "[PHONE]"


def redact_pii(text: str) -> str:
    """Mask common personal data. Deliberately conservative: it targets
    well-structured identifiers and leaves names and addresses alone."""
    text = _EMAIL.sub("[EMAIL]", text)
    text = _IBAN.sub("[IBAN]", text)
    text = _SSN.sub("[SSN]", text)
    text = _CARD.sub(_card, text)
    return _PHONE.sub(_phone, text)


# ------------------------------------------------------------- moderation

# Llama Guard 3 hazard taxonomy (MLCommons)
HAZARDS = {
    "S1": "violent crimes",
    "S2": "non-violent crimes",
    "S3": "sex-related crimes",
    "S4": "child sexual exploitation",
    "S5": "defamation",
    "S6": "specialized advice",
    "S7": "privacy",
    "S8": "intellectual property",
    "S9": "indiscriminate weapons",
    "S10": "hate",
    "S11": "suicide and self-harm",
    "S12": "sexual content",
    "S13": "elections",
    "S14": "code interpreter abuse",
}


@dataclass
class Verdict:
    safe: bool
    categories: list[str] = field(default_factory=list)

    @property
    def labels(self) -> list[str]:
        return [HAZARDS.get(c, c) for c in self.categories]


class ModerationUnavailable(RuntimeError):
    pass


class Moderator(Protocol):
    name: str

    def check(self, text: str) -> Verdict: ...


def parse_guard_output(output: str) -> Verdict:
    lines = [ln.strip() for ln in output.strip().splitlines() if ln.strip()]
    if not lines:
        raise ModerationUnavailable("The safety model returned an empty response.")
    if lines[0].lower().startswith("safe"):
        return Verdict(safe=True)
    if lines[0].lower().startswith("unsafe"):
        cats = re.findall(r"S\d{1,2}", " ".join(lines[1:])) if len(lines) > 1 else []
        return Verdict(safe=False, categories=cats)
    raise ModerationUnavailable(f"Unexpected safety model output: {lines[0][:80]!r}")


class LlamaGuard:
    """Classifies a user message with a Llama Guard model served by Ollama."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.name = settings.moderation_model or ""

    def check(self, text: str) -> Verdict:
        try:
            resp = httpx.post(
                f"{self.settings.ollama_base_url.rstrip('/')}/api/chat",
                json={
                    "model": self.name,
                    "messages": [{"role": "user", "content": text}],
                    "stream": False,
                    "options": {"temperature": 0},
                },
                timeout=60,
            )
            resp.raise_for_status()
            output = resp.json()["message"]["content"]
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise ModerationUnavailable(f"Safety model '{self.name}' is unavailable ({exc}).") from exc
        return parse_guard_output(output)


def build_moderator(settings: Settings) -> Moderator | None:
    return LlamaGuard(settings) if settings.moderation_model else None
