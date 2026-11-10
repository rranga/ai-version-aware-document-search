"""Paragraph-level diff between two document versions, with word-level
detail for modified paragraphs."""

from __future__ import annotations

import difflib
import re
from typing import Any

# Paragraphs that are this similar are shown as "modified" with inline word
# changes; below it they are shown as a separate removal + addition.
MODIFIED_THRESHOLD = 0.4


def split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _word_segments(old: str, new: str) -> tuple[list[dict[str, str]], float]:
    a = re.findall(r"\S+\s*", old)
    b = re.findall(r"\S+\s*", new)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    segments: list[dict[str, str]] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            segments.append({"op": "equal", "text": "".join(a[i1:i2])})
        else:
            if i2 > i1:
                segments.append({"op": "delete", "text": "".join(a[i1:i2])})
            if j2 > j1:
                segments.append({"op": "insert", "text": "".join(b[j1:j2])})
    return segments, sm.ratio()


def diff_texts(old_text: str, new_text: str) -> dict[str, Any]:
    old = split_paragraphs(old_text)
    new = split_paragraphs(new_text)
    sm = difflib.SequenceMatcher(None, old, new, autojunk=False)

    blocks: list[dict[str, Any]] = []
    stats = {"added": 0, "removed": 0, "modified": 0, "unchanged": 0}

    def add(kind: str, **fields: Any) -> None:
        blocks.append({"type": kind, **fields})
        stats[kind if kind != "equal" else "unchanged"] += len(fields["paragraphs"]) if kind == "equal" else 1

    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            add("equal", paragraphs=old[i1:i2])
        elif op == "delete":
            for p in old[i1:i2]:
                add("removed", old=p)
        elif op == "insert":
            for p in new[j1:j2]:
                add("added", new=p)
        else:  # replace: pair paragraphs positionally, extras are add/remove
            olds, news = old[i1:i2], new[j1:j2]
            for k in range(max(len(olds), len(news))):
                o = olds[k] if k < len(olds) else None
                n = news[k] if k < len(news) else None
                if o is not None and n is not None:
                    segments, ratio = _word_segments(o, n)
                    if ratio >= MODIFIED_THRESHOLD:
                        add("modified", old=o, new=n, similarity=round(ratio, 3), segments=segments)
                        continue
                if o is not None:
                    add("removed", old=o)
                if n is not None:
                    add("added", new=n)

    return {"blocks": blocks, "stats": stats}


def changes_for_prompt(diff: dict[str, Any], limit_chars: int = 12000) -> str:
    """Compact textual rendering of a diff for the LLM summary prompt."""
    lines: list[str] = []
    for block in diff["blocks"]:
        if block["type"] == "removed":
            lines.append(f"REMOVED: {block['old']}")
        elif block["type"] == "added":
            lines.append(f"ADDED: {block['new']}")
        elif block["type"] == "modified":
            lines.append(f"CHANGED FROM: {block['old']}\nCHANGED TO: {block['new']}")
    text = "\n\n".join(lines)
    if len(text) > limit_chars:
        text = text[:limit_chars] + "\n\n[... further changes truncated ...]"
    return text
