"""Read document type, number, dates and supersession from the first pages."""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path

from .textutil import MONTHS, norm_ref

_TYPES = [
    ("SOP", re.compile(r"\bstandard\s+operating\s+procedure|\bS\.?O\.?P\b", re.I)),
    ("Circular", re.compile(r"\bcircular", re.I)),
    ("TLI", re.compile(r"\bT\.?L\.?I\b")),
    ("Office Order", re.compile(r"\boffice\s+order\b", re.I)),
    ("Notification", re.compile(r"\bnotification\b", re.I)),
    ("Memorandum", re.compile(r"\bmemorandum\b|\bmemo\b", re.I)),
    ("Policy", re.compile(r"\bpolicy\b", re.I)),
    ("Guideline", re.compile(r"\bguidelines?\b", re.I)),
    ("Manual", re.compile(r"\bmanual\b", re.I)),
]
_REF_TOKEN = r"[A-Za-z0-9][A-Za-z0-9/\-_.()]{2,40}"
# OCR often drops spaces ("CIRCULARNo.HR/2021/017"), so "No" glued to the word
# before it is accepted when punctuation follows.
_DOC_NO = re.compile(
    r"(?:(?i:(?<![a-z])(?:no|number|ref|reference)\b)|(?<=[A-Za-z])N[oO](?=\s*[.:]))"
    r"\s*[.:#\-]*\s*(" + _REF_TOKEN + ")")
_SUPERSEDE = re.compile(r"\b(supersed\w*|supersession\s+of|in\s+place\s+of|replaces|rescind\w*|cancels|withdraws)\b", re.I)
_CODE = re.compile(r"[A-Za-z0-9]+(?:[/\-_.][A-Za-z0-9]+)+")
_MONTH_RE = "|".join(sorted(MONTHS, key=len, reverse=True))
_DATE_PATTERNS = [
    ("ymd", re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")),
    ("num", re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b")),
    ("dmy", re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.,]*(" + _MONTH_RE + r")[\s\-.,]*(\d{4})\b", re.I)),
    ("mdy", re.compile(r"\b(" + _MONTH_RE + r")\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b", re.I)),
]


def find_dates(text: str, order: str = "DMY") -> list[tuple[int, str]]:
    """All dates in text as (position, ISO date), in reading order."""
    found = []
    for kind, pat in _DATE_PATTERNS:
        for m in pat.finditer(text):
            try:
                if kind == "ymd":
                    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                elif kind == "num":
                    a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
                    if y < 100:
                        y += 2000 if y < 50 else 1900
                    d, mo = (b, a) if order == "MDY" else (a, b)
                    if mo > 12 >= d:
                        d, mo = mo, d
                elif kind == "dmy":
                    d, mo, y = int(m.group(1)), MONTHS[m.group(2).lower()], int(m.group(3))
                else:
                    mo, d, y = MONTHS[m.group(1).lower()], int(m.group(2)), int(m.group(3))
                if not 1900 <= y <= 2100:
                    continue
                found.append((m.start(), dt.date(y, mo, d).isoformat()))
            except (ValueError, KeyError):
                continue
    found.sort()
    return found


def _clean_ref(ref: str) -> str:
    ref = ref.strip().rstrip(".,;:)(-_/")
    return ref


def _is_ref(ref: str) -> bool:
    return len(ref) >= 3 and any(c.isdigit() for c in ref) and not re.fullmatch(r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}", ref)


def extract_metadata(path: Path, first_lines: list[str], order: str = "DMY", title_hint: str | None = None) -> dict:
    """first_lines: the text lines of roughly the first two pages."""
    head = "\n".join(first_lines[:40])
    body = "\n".join(first_lines)
    name = path.stem

    doc_type = "Document"
    for label, pat in _TYPES:
        if pat.search(name) or pat.search(head):
            doc_type = label
            break

    doc_number = None
    for m in _DOC_NO.finditer(head):
        ref = _clean_ref(m.group(1))
        if _is_ref(ref):
            doc_number = ref
            break

    title = None
    for i, ln in enumerate(first_lines[:40]):
        m = re.match(r"^\s*(?:subject|sub|title|re)\s*[:\-.]\s*(.+)$", ln, re.I)
        if m and len(m.group(1).strip()) > 3:
            title = m.group(1).strip()
            break
    if not title and title_hint:
        title = title_hint.strip()
    if not title:
        title = re.sub(r"[_\-]+", " ", name).strip()

    dates = find_dates(head, order)
    issue_date = None
    m = re.search(r"\bdate[d]?\b\s*[:.\-]?\s*", head, re.I)
    if m:
        after = [d for pos, d in dates if pos >= m.end() - 1 and pos - m.end() < 40]
        if after:
            issue_date = after[0]
    if not issue_date and dates:
        issue_date = dates[0][1]

    effective_date = None
    m = re.search(r"\b(?:with\s+effect\s+from|effective\s+(?:from|date)|w\.?\s?e\.?\s?f\.?|comes?\s+into\s+(?:force|effect)\s+(?:on|from))", body, re.I)
    if m:
        after = find_dates(body[m.end(): m.end() + 60], order)
        if after:
            effective_date = after[0][1]

    supersedes: list[str] = []
    flat_body = re.sub(r"\s+", " ", body)
    own = norm_ref(doc_number) if doc_number else ""
    for m in _SUPERSEDE.finditer(flat_body):
        window = flat_body[m.end(): m.end() + 200]
        stop = re.search(r"(?<![Nn]o)(?<![Nn]os)(?<![Rr]ef)(?<![Dd]t)\.\s+[A-Z]", window)
        if stop:
            window = window[: stop.start() + 1]
        for c in _CODE.finditer(window):
            ref = _clean_ref(c.group())
            if _is_ref(ref) and any(ch.isalpha() for ch in ref):
                n = norm_ref(ref)
                if n and n != own and n not in supersedes:
                    supersedes.append(n)

    return {
        "title": title[:200], "doc_type": doc_type, "doc_number": doc_number,
        "doc_number_norm": norm_ref(doc_number) if doc_number else None,
        "issue_date": issue_date, "effective_date": effective_date, "supersedes": supersedes,
    }
