"""Shared text helpers: normalisation, tokenising, fact extraction."""
from __future__ import annotations

import re

STOPWORDS = frozenset("""
a an the and or but if then else of to in on at by for from with without into onto over under about as is are was were be
been being it its this that these those there here which who whom whose what when where why how do does did done can could
shall should will would may might must not no nor so than too very such per via any all each every both either neither
i we you he she they them his her their our your my me us am have has had having also only just more most other some
tell give show find please explain describe list state mention say according regarding
""".split())

_WORD = re.compile(r"[A-Za-z0-9]+")
MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5,
    "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}


def flat(text: str) -> str:
    """Join wrapped lines: undo end-of-line hyphenation and collapse whitespace."""
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    return re.sub(r"\s+", " ", text).strip()


def squash(text: str) -> str:
    """Lower-case letters and digits only. Used for exact-quote comparison."""
    return re.sub(r"[^a-z0-9]+", "", flat(text).lower())


def words(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text)]


def stem(word: str) -> str:
    """A deliberately crude stemmer; only used to compare word overlap."""
    for suf in ("ations", "ation", "ments", "ment", "ingly", "ings", "ing", "ied", "ies", "edly", "ed", "es", "ly", "s"):
        if word.endswith(suf) and len(word) - len(suf) >= 3:
            return word[: -len(suf)]
    return word


def content_terms(text: str) -> list[str]:
    return [stem(w) for w in words(text) if w not in STOPWORDS and (len(w) > 1 or w.isdigit())]


_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
_IDENT = re.compile(r"[A-Za-z0-9]+(?:[/\-_.][A-Za-z0-9]+)+")


def _norm_num(tok: str) -> str:
    tok = tok.replace(",", "")
    if "." in tok:
        tok = tok.rstrip("0").rstrip(".")
    tok = tok.lstrip("0") or "0"
    return tok


def facts(text: str) -> set[str]:
    """Checkable facts in a text: numbers, month names and reference codes.

    An answer may only contain facts that also occur in the passage it cites.
    """
    text = flat(text)
    out: set[str] = set()
    for m in _NUM.finditer(text):
        out.add("n:" + _norm_num(m.group()))
    for w in words(text):
        if w in MONTHS and w != "may":
            out.add("m:%d" % MONTHS[w])
    for m in _IDENT.finditer(text):
        tok = m.group().strip("./-_")
        if any(ch.isdigit() for ch in tok) and any(ch.isalpha() for ch in tok):
            out.add("i:" + re.sub(r"[^a-z0-9]", "", tok.lower()))
    return out


def norm_ref(ref: str) -> str:
    """Normalise a document number so 'HR/2021/017' and 'hr-2021-017.' compare equal."""
    return re.sub(r"[^A-Z0-9]", "", ref.upper())


_NO_BREAK = re.compile(r"(?:\b(?:Rs|No|Nos|Dt|Ref|Sr|Mr|Ms|Mrs|Dr|viz|etc|w\.e\.f)|^\(?\d{1,2}(?:\.\d{1,2})*)\.$", re.I)


def sentences(text: str) -> list[str]:
    """Split into sentences, line by line so headings stay separate."""
    out: list[str] = []
    for line in re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text).split("\n"):
        parts = [p.strip() for p in re.split(r"(?<=[.;?!])\s+(?=[A-Z0-9(\"'])", line) if p.strip()]
        merged: list[str] = []
        for part in parts:
            if merged and _NO_BREAK.search(merged[-1]):
                merged[-1] += " " + part
            else:
                merged.append(part)
        out.extend(merged)
    return out
