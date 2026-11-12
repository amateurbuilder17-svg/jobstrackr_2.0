"""Answering with verification.

The answer model may only restate what the retrieved passages say. Every
statement it produces is checked in code against the passage it cites; anything
that fails is dropped, and if nothing survives the user is shown the passages
themselves instead of a generated answer.
"""
from __future__ import annotations

from pathlib import Path

from .chunking import is_table_like
from .retrieve import Hit, Retriever
from .textutil import content_terms, facts, flat, sentences, squash

SYSTEM = (
    "You answer questions about office documents (SOPs, circulars, instructions) using ONLY the numbered "
    "sources provided. Rules: 1) Use only facts stated in the sources. Never use outside knowledge. "
    "2) Each statement must be supported by exactly one source; give its number. "
    "3) For each statement copy, word for word, the sentence or phrase from that source that supports it as 'quote'. "
    "4) Copy every number, amount, date, name and reference code exactly as written in the source. "
    "5) If the sources do not contain the answer, set answerable to false and give no statements. "
    "Keep statements short and factual."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "answerable": {"type": "boolean"},
        "statements": {
            "type": "array", "maxItems": 6,
            "items": {
                "type": "object",
                "properties": {"text": {"type": "string"}, "source": {"type": "integer"}, "quote": {"type": "string"}},
                "required": ["text", "source", "quote"],
            },
        },
    },
    "required": ["answerable", "statements"],
}


def build_prompt(question: str, hits: list[Hit]) -> str:
    parts = []
    for i, h in enumerate(hits, 1):
        parts.append(f"[Source {i}] {h.heading}\n{flat(h.text)}")
    return "\n\n".join(parts) + f"\n\nQuestion: {question}\nAnswer as JSON."


def verify_statement(st: dict, hits: list[Hit]) -> tuple[bool, str]:
    """Return (ok, reason). All checks must pass for a statement to be shown."""
    text, quote, src = str(st.get("text", "")).strip(), str(st.get("quote", "")).strip(), st.get("source")
    if not text or not isinstance(src, int) or not 1 <= src <= len(hits):
        return False, "no valid source"
    h = hits[src - 1]
    passage = h.text
    context = f"{h.heading}\n{h.title}\n{h.doc_number or ''}\n{passage}"
    q = squash(quote)
    if len(q) < 12 or q not in squash(passage):
        return False, "quote not found in the cited passage"
    missing = facts(text) - facts(context)
    if missing:
        return False, "contains a figure, date or reference not in the cited passage"
    terms = set(content_terms(text))
    if terms:
        support = len(terms & set(content_terms(context))) / len(terms)
        if support < 0.6:
            return False, "wording is not supported by the cited passage"
    if h.ocr and is_table_like(passage):
        return False, "source is a scanned table"
    return True, ""


def best_sentence(question: str, text: str) -> str:
    q = set(content_terms(question))
    best, best_score = "", 0.0
    for s in sentences(text):
        terms = set(content_terms(s))
        score = len(q & terms) / (len(q) or 1)
        if score > best_score:
            best, best_score = s, score
    return best


class Answerer:
    def __init__(self, retriever: Retriever, settings, models):
        self.retriever, self.settings, self.models = retriever, settings, models

    def source_dict(self, n: int, h: Hit, question: str) -> dict:
        low = h.ocr and h.min_conf < self.settings.ocr_low_conf
        return {
            "n": n, "chunk_id": h.chunk_id, "doc_id": h.doc_id, "file": Path(h.path).name, "path": h.path,
            "title": h.title, "doc_type": h.doc_type, "doc_number": h.doc_number, "issue_date": h.issue_date,
            "effective_date": h.effective_date, "heading": h.heading, "text": h.text,
            "page_start": h.page_start, "page_end": h.page_end, "score": round(h.score, 3),
            "scanned": h.ocr, "ocr_conf": round(h.min_conf, 2), "low_conf": low,
            "table": is_table_like(h.text), "superseded": h.status == "superseded",
            "highlight": best_sentence(question, h.text),
        }

    def ask(self, question: str, include_superseded: bool | None = None, use_llm: bool = True) -> dict:
        question = question.strip()
        s = self.settings
        hits = self.retriever.search(question, include_superseded) if question else []
        threshold = self.retriever.threshold()
        good = [h for h in hits if h.score >= threshold][: s.final_k]
        notices: list[str] = []
        if getattr(self.models.reranker, "is_fallback", False) and s.rerank_model != "lexical":
            notices.append("The reranker model is not installed; relevance is judged by keyword overlap only.")
        if self.models.embedder is None:
            notices.append("The embedding model is not installed; only keyword search is active.")

        if not good:
            related = [self.source_dict(i, h, question) for i, h in enumerate(hits[:3], 1)]
            return {"mode": "not_found", "question": question, "statements": [], "sources": [],
                    "related": related, "notices": notices, "threshold": threshold}

        sources = [self.source_dict(i, h, question) for i, h in enumerate(good, 1)]
        result = {"mode": "passages", "question": question, "statements": [], "sources": sources,
                  "related": [], "notices": notices, "threshold": threshold, "rejected": []}
        if any(src["superseded"] for src in sources):
            notices.append("Some passages come from documents marked as superseded.")
        if any(src["low_conf"] for src in sources):
            notices.append("Some passages come from scans that were hard to read. Check figures against the page image.")
        elif any(src["scanned"] for src in sources):
            # OCR confidence is not proof of a correct reading: a blurred "8" can be
            # read as "3" with high confidence. Scanned sources always get this note.
            notices.append("Some passages were read from scanned pages. Scanned text can contain misread characters; check figures against the page image.")

        gen = self.models.generator if use_llm else None
        if gen is None:
            if use_llm:
                notices.append("No answer model is installed, so the matching passages are shown as they appear in the documents.")
            return result
        try:
            out = gen.complete_json(SYSTEM, build_prompt(question, good), SCHEMA)
        except Exception as exc:
            notices.append(f"The answer model failed ({type(exc).__name__}); showing the passages instead.")
            return result
        if not isinstance(out, dict):
            out = {}
        statements = out.get("statements") or []
        if not out.get("answerable") or not statements:
            notices.append("The answer model judged that these passages do not answer the question directly. They are shown for reference.")
            return result
        for st in statements:
            if not isinstance(st, dict):
                continue
            ok, why = verify_statement(st, good)
            if ok:
                result["statements"].append({"text": st["text"].strip(), "source": st["source"], "quote": st["quote"].strip()})
            else:
                result["rejected"].append({"text": str(st.get("text", "")), "reason": why})
        if result["statements"]:
            result["mode"] = "answer"
            if result["rejected"]:
                notices.append("Part of the generated answer failed verification against the source and was removed.")
        else:
            notices.append("The generated answer could not be verified against the source text, so it is not shown. The passages below are the exact document text.")
        return result
