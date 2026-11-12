"""Split a document into passages along its own structure (sections, clauses)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .textutil import MONTHS

_NUMBERED = re.compile(r"^\(?(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+(\S.*)$")
_NUMBERED_STRICT = re.compile(r"^(?:\d{1,2}(?:\.\d{1,2}){1,3}[.)]?|\d{1,2}[.)]|\(\d{1,2}\))\s")
_KEYWORD = re.compile(
    r"^(section|chapter|part|annexure|annex|appendix|schedule|clause|article)\s+([0-9]+|[ivxlc]+|[a-z])\b[\s:.\-]*(.*)$",
    re.I,
)


@dataclass
class Chunk:
    heading: str
    lines: list[tuple[int, int, str, float]] = field(default_factory=list)  # page, line index, text, conf
    ocr: bool = False

    @property
    def text(self) -> str:
        return "\n".join(ln[2] for ln in self.lines)

    @property
    def n_words(self) -> int:
        return sum(len(ln[2].split()) for ln in self.lines)

    def spans(self) -> list[list[int]]:
        out: list[list[int]] = []
        for page, idx, _, _ in self.lines:
            if out and out[-1][0] == page and out[-1][2] == idx - 1:
                out[-1][2] = idx
            else:
                out.append([page, idx, idx])
        return out


def heading_of(text: str, hlevel: int = 0) -> tuple[int, str] | None:
    """Return (level, label) if the line starts a section or clause, else None."""
    text = text.strip()
    if not text:
        return None
    if hlevel:
        return hlevel, text[:120]
    m = _KEYWORD.match(text)
    if m and len(text) <= 120:
        return 1, text
    m = _NUMBERED.match(text)
    if m:
        number, rest = m.group(1), m.group(2)
        depth = number.count(".") + 1
        first = re.sub(r"[^a-z]", "", rest.split()[0].lower()) if rest.split() else ""
        strict = bool(_NUMBERED_STRICT.match(text))
        looks_like_date = first in MONTHS or re.match(r"^\d", rest) is not None
        if not looks_like_date and (strict or (rest[:1].isupper() and len(text) <= 80 and not text.endswith("."))):
            label = text if len(text) <= 90 else number
            return depth + 1, label
    letters = [c for c in text if c.isalpha()]
    if 3 <= len(text) <= 70 and len(letters) >= 3 and text.upper() == text and not text.endswith((".", ",", ";")):
        if len(text.split()) <= 10 and sum(c.isalpha() for c in text) / len(text) > 0.6:
            return 1, text
    return None


def chunk_pages(pages: list[dict], title: str, max_words: int = 220, min_words: int = 40) -> list[Chunk]:
    """pages: [{page_no, source, lines}] in order. Returns passages with heading paths."""
    stack: list[tuple[int, str]] = []
    chunks: list[Chunk] = []

    def path() -> str:
        parts = [title] + [label for _, label in stack if label.strip().lower() != title.strip().lower()]
        return " > ".join(p for p in parts if p)

    cur = Chunk(heading=path())

    def flush(carry: bool = False) -> None:
        nonlocal cur
        tail = cur.lines[-2:] if carry else []
        if cur.lines:
            chunks.append(cur)
        cur = Chunk(heading=path(), lines=list(tail), ocr=bool(tail) and chunks[-1].ocr)

    for page in pages:
        is_ocr = page["source"] == "ocr"
        for idx, line in enumerate(page["lines"]):
            text, conf, hlevel = line[0], line[5], line[6] if len(line) > 6 else 0
            head = heading_of(text, hlevel)
            if head:
                level, label = head
                if cur.n_words >= min_words:
                    flush()
                while stack and stack[-1][0] >= level:
                    stack.pop()
                stack.append((level, label))
                if not cur.lines:
                    cur.heading = path()
            n = len(text.split())
            if cur.lines and cur.n_words + n > max_words:
                flush(carry=True)
            cur.lines.append((page["page_no"], idx, text, conf))
            cur.ocr = cur.ocr or is_ocr
    flush()
    # A short trailing fragment reads better attached to the passage before it.
    if len(chunks) >= 2 and chunks[-1].n_words < min_words // 2 and chunks[-2].n_words + chunks[-1].n_words <= max_words:
        last = chunks.pop()
        seen = {(p, i) for p, i, _, _ in chunks[-1].lines}
        chunks[-1].lines.extend(ln for ln in last.lines if (ln[0], ln[1]) not in seen)
        chunks[-1].ocr = chunks[-1].ocr or last.ocr
    return chunks


def is_table_like(text: str) -> bool:
    """Rows of cells were joined with three spaces during extraction."""
    rows = [ln for ln in text.split("\n") if ln.strip()]
    if len(rows) < 3:
        return False
    cells = sum(1 for ln in rows if "   " in ln.strip())
    return cells >= 3 and cells / len(rows) >= 0.4
