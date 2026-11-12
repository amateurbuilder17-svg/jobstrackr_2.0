"""Evaluate retrieval and refusal against a file of test questions.

One JSON object per line:
  {"question": "...", "expect_file": "HR-2023-045", "expect_text": "50,000"}
  {"question": "...", "answerable": false}
expect_file matches the file name or document number (substring, case-insensitive);
expect_text must appear in a returned passage. Either may be omitted.
"""
from __future__ import annotations

import json
from pathlib import Path

from .textutil import squash


def run_eval(app, path: Path, use_llm: bool = False) -> dict:
    cases = [json.loads(ln) for ln in path.read_text("utf-8").splitlines() if ln.strip() and not ln.startswith("#")]
    rows = []
    for case in cases:
        answerable = case.get("answerable", True)
        res = app.answerer.ask(case["question"], use_llm=use_llm)
        refused = res["mode"] == "not_found"
        shown = res["sources"] or res["related"]
        top_score = max((s["score"] for s in shown), default=0.0)
        hit = None
        if answerable:
            hit = False
            for s in res["sources"]:
                ok_file = True
                if case.get("expect_file"):
                    want = case["expect_file"].lower()
                    ok_file = want in s["file"].lower() or want in (s["doc_number"] or "").lower()
                ok_text = squash(case["expect_text"]) in squash(s["text"]) if case.get("expect_text") else True
                if ok_file and ok_text:
                    hit = True
                    break
        rows.append({"question": case["question"], "answerable": answerable, "refused": refused, "hit": hit,
                     "top_score": round(top_score, 3), "mode": res["mode"]})
    ans = [r for r in rows if r["answerable"]]
    un = [r for r in rows if not r["answerable"]]
    return {
        "cases": len(rows), "threshold": app.retriever.threshold(),
        "answerable": len(ans), "found_correct_passage": sum(1 for r in ans if r["hit"]),
        "wrongly_refused": sum(1 for r in ans if r["refused"]),
        "unanswerable": len(un), "correctly_refused": sum(1 for r in un if r["refused"]),
        "lowest_score_answerable": min((r["top_score"] for r in ans if r["hit"]), default=None),
        "highest_score_unanswerable": max((r["top_score"] for r in un), default=None),
        "rows": rows,
    }


def format_eval(r: dict) -> str:
    out = [f"{r['cases']} questions, refusal threshold {r['threshold']}"]
    if r["answerable"]:
        out.append(f"Answerable: correct passage returned for {r['found_correct_passage']}/{r['answerable']}, "
                   f"wrongly refused {r['wrongly_refused']}")
    if r["unanswerable"]:
        out.append(f"Unanswerable: correctly refused {r['correctly_refused']}/{r['unanswerable']}")
    lo, hi = r["lowest_score_answerable"], r["highest_score_unanswerable"]
    if lo is not None and hi is not None:
        out.append(f"Lowest score on a correct hit: {lo}; highest score on an unanswerable question: {hi}")
        out.append("A threshold between those two separates them cleanly." if hi < lo
                   else "These overlap, so no threshold separates them perfectly; inspect the failures below.")
    for row in r["rows"]:
        bad = (row["answerable"] and not row["hit"]) or (not row["answerable"] and not row["refused"])
        if bad:
            out.append(f"  FAIL [{row['mode']}, score {row['top_score']}] {row['question']}")
    return "\n".join(out)
