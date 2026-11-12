import json
from pathlib import Path

from docsearch.answer import verify_statement
from docsearch.chunking import chunk_pages, heading_of, is_table_like
from docsearch.metadata import extract_metadata, find_dates
from docsearch.textutil import facts, squash


def doc(app, name):
    return app.db.one("SELECT * FROM documents WHERE path LIKE ?", (f"%{name}",))


# ---------------------------------------------------------------- units

def test_headings():
    assert heading_of("2.1 The sanction limit is Rs. 50,000.")[0] == 3
    assert heading_of("3. Supersession") == (2, "3. Supersession")
    assert heading_of("12 March 2023") is None
    assert heading_of("ANNEXURE A - Rates")[0] == 1
    assert heading_of("GENERAL CONDITIONS")[0] == 1
    assert heading_of("This is an ordinary sentence.") is None


def test_dates():
    assert find_dates("Date: 12 March 2023")[0][1] == "2023-03-12"
    assert find_dates("w.e.f. 01/04/2023")[0][1] == "2023-04-01"
    assert find_dates("on 01/04/2023", "MDY")[0][1] == "2023-01-04"
    assert find_dates("March 5, 2022")[0][1] == "2022-03-05"
    assert find_dates("31/02/2023") == []


def test_facts_normalise():
    assert facts("Rs. 50,000 per quarter") == facts("rs 50000 per quarter")
    assert "n:60000" not in facts("limit is Rs. 50,000")
    assert "i:hr2023045" in facts("Circular HR/2023/045 dated 12 March 2023")
    assert squash("sanc-\ntion limit") == "sanctionlimit"


def test_metadata():
    lines = ["CIRCULAR No. HR/2023/045", "Date: 12 March 2023", "Subject: Revision of travel allowance limits",
             "This circular supersedes Circular No. HR/2021/017 with effect from 01/04/2023."]
    m = extract_metadata(Path("x.pdf"), lines)
    assert m["doc_type"] == "Circular" and m["doc_number"] == "HR/2023/045"
    assert m["issue_date"] == "2023-03-12" and m["effective_date"] == "2023-04-01"
    assert m["supersedes"] == ["HR2021017"] and m["title"] == "Revision of travel allowance limits"


def test_chunk_spans_and_size():
    lines = [[f"{i}. Clause {i} " + "word " * 30, None, None, None, None, 1.0, 0] for i in range(1, 30)]
    chunks = chunk_pages([{"page_no": 1, "source": "text", "lines": lines}], "T", max_words=120, min_words=30)
    assert len(chunks) > 5 and all(c.n_words <= 120 for c in chunks)
    assert chunks[0].spans()[0][0] == 1 and chunks[0].heading == "T > 1"


# ---------------------------------------------------------------- ingestion

def test_ingest_states(app):
    states = {Path(r["path"]).name: r["state"] for r in app.db.q("SELECT path,state FROM documents")}
    assert states["HR-2023-045 travel allowance.pdf"] == "done"
    assert states["scan_0007.pdf"] == "done"
    assert states["old memo.doc"] == "unsupported"
    assert sorted([states["SOP cash handling.docx"], states["copy of SOP.docx"]]) == ["done", "duplicate"]
    c = app.counts()
    assert c["passages"] > 0 and c["embedded"] == c["passages"]


def test_text_pdf_not_ocrd_and_scan_is(app):
    new, old = doc(app, "HR-2023-045 travel allowance.pdf"), doc(app, "scan_0007.pdf")
    assert new["ocr_pages"] == 0 and old["ocr_pages"] == 1
    assert old["mean_conf"] > 0.8
    assert old["doc_number"] == "HR/2021/017" and old["issue_date"] == "2021-01-05"


def test_supersession(app):
    new, old = doc(app, "HR-2023-045 travel allowance.pdf"), doc(app, "scan_0007.pdf")
    assert new["status"] == "active"
    assert old["status"] == "superseded" and old["superseded_by"] == new["id"]


def test_docx_table_and_headings(app):
    d = doc(app, "SOP cash handling.docx") if doc(app, "SOP cash handling.docx")["state"] == "done" else doc(app, "copy of SOP.docx")
    assert d["doc_type"] == "SOP" and d["doc_number"] == "OPS/SOP/012"
    texts = [r["text"] for r in app.db.q("SELECT text FROM chunks WHERE doc_id=?", (d["id"],))]
    assert any("Rural   Rs. 5,00,000" in t for t in texts)
    heads = [r["heading"] for r in app.db.q("SELECT heading FROM chunks WHERE doc_id=?", (d["id"],))]
    assert d["title"] == "Standard Operating Procedure: Cash Handling"
    assert any(h.endswith("> Closing") for h in heads)


def test_rerun_is_noop(app):
    before = app.counts()
    app.ingestor.run()
    assert app.counts() == before


# ---------------------------------------------------------------- retrieval + refusal

def test_finds_current_limit_not_superseded(app):
    res = app.answerer.ask("What is the sanction limit for local travel?")
    assert res["mode"] == "passages"
    top = res["sources"][0]
    assert "50,000" in top["text"] and top["file"].startswith("HR-2023-045")
    assert not any(s["superseded"] for s in res["sources"])
    assert all("30,000" not in s["text"] for s in res["sources"])


def test_include_superseded(app):
    res = app.answerer.ask("What is the sanction limit for local travel?", include_superseded=True)
    assert any(s["superseded"] and s["scanned"] for s in res["sources"])


def test_asking_by_number_reaches_superseded_doc(app):
    res = app.answerer.ask("What does circular HR/2021/017 say about the sanction limit for travel?")
    assert any(s["doc_number"] == "HR/2021/017" for s in res["sources"])


def test_not_found(app):
    res = app.answerer.ask("What is the maternity leave entitlement for contract staff?")
    assert res["mode"] == "not_found" and res["sources"] == [] and res["statements"] == []


def test_xlsx(app):
    res = app.answerer.ask("Who is the first contact for a network outage?")
    assert any("IT Helpdesk" in s["text"] for s in res["sources"])


# ---------------------------------------------------------------- answer verification

class FakeLLM:
    name = "fake"

    def __init__(self, out):
        self.out = out

    def complete_json(self, system, user, schema, max_tokens=500):
        return self.out(user) if callable(self.out) else self.out


def ask_with(app, out, q="What is the sanction limit for local travel?"):
    app.models._cache["generator"] = FakeLLM(out)
    try:
        return app.answerer.ask(q)
    finally:
        app.models._cache.pop("generator", None)


GOOD_QUOTE = "The sanction limit for local travel is Rs. 50,000 per quarter"


def test_verified_answer(app):
    res = ask_with(app, {"answerable": True, "statements": [
        {"text": "The sanction limit for local travel is Rs. 50,000 per quarter for Grade A officers.", "source": 1, "quote": GOOD_QUOTE}]})
    assert res["mode"] == "answer" and len(res["statements"]) == 1


def test_wrong_number_rejected(app):
    res = ask_with(app, {"answerable": True, "statements": [
        {"text": "The sanction limit for local travel is Rs. 60,000 per quarter.", "source": 1, "quote": GOOD_QUOTE}]})
    assert res["mode"] == "passages" and not res["statements"] and res["rejected"]


def test_invented_quote_rejected(app):
    res = ask_with(app, {"answerable": True, "statements": [
        {"text": "The sanction limit for local travel is Rs. 50,000.", "source": 1,
         "quote": "The sanction limit for local travel is fifty thousand rupees each month"}]})
    assert res["mode"] == "passages" and not res["statements"]


def test_unsupported_claim_rejected(app):
    res = ask_with(app, {"answerable": True, "statements": [
        {"text": "Employees may also claim international airfare and hotel upgrades without approval.", "source": 1, "quote": GOOD_QUOTE}]})
    assert not res["statements"]


def test_bad_source_index_and_garbage(app):
    assert not ask_with(app, {"answerable": True, "statements": [{"text": "x", "source": 99, "quote": GOOD_QUOTE}]})["statements"]
    assert ask_with(app, ["nonsense"])["mode"] == "passages"
    assert ask_with(app, {"answerable": False, "statements": []})["mode"] == "passages"


def test_partial_answer_keeps_only_verified(app):
    res = ask_with(app, {"answerable": True, "statements": [
        {"text": "The sanction limit for local travel is Rs. 50,000 per quarter.", "source": 1, "quote": GOOD_QUOTE},
        {"text": "The limit rises to Rs. 75,000 in 2024.", "source": 1, "quote": GOOD_QUOTE}]})
    assert res["mode"] == "answer" and len(res["statements"]) == 1 and len(res["rejected"]) == 1


def test_llm_not_called_when_nothing_found(app):
    def boom(_):
        raise AssertionError("generator must not run without evidence")
    res = ask_with(app, boom, q="What is the maternity leave entitlement for contract staff?")
    assert res["mode"] == "not_found"


def test_scanned_table_never_answered():
    from docsearch.retrieve import Hit

    text = "Grade   Limit   Period\nA   50,000   Quarter\nB   30,000   Quarter\nC   10,000   Quarter"
    assert is_table_like(text)
    h = Hit(1, 1, "T", text, 1, 1, [], 0.99, True, "/x.pdf", "T", "Circular", None, None, None, "active", None)
    ok, why = verify_statement({"text": "Grade A limit is 50,000 per Quarter.", "source": 1, "quote": "A   50,000   Quarter"}, [h])
    assert not ok and "table" in why


# ---------------------------------------------------------------- adopted from similar projects

class FakeChecker:
    name = "fake-checker"

    def __init__(self, bad_word):
        self.bad_word = bad_word

    def unsupported(self, passage, question, statement):
        return [self.bad_word] if self.bad_word in statement else []


def test_checker_model_can_veto(app):
    out = {"answerable": True, "statements": [
        {"text": "The sanction limit for local travel is Rs. 50,000 per quarter for officers.", "source": 1, "quote": GOOD_QUOTE}]}
    app.models._cache["checker"] = FakeChecker("officers")
    try:
        res = ask_with(app, out)
        assert res["mode"] == "passages" and "checker model" in res["rejected"][0]["reason"]
        app.models._cache["checker"] = FakeChecker("zzz")
        assert ask_with(app, out)["mode"] == "answer"
    finally:
        app.models._cache.pop("checker", None)


def test_near_duplicate_passages_removed(app):
    from docsearch.retrieve import Hit

    def hit(i, text, score):
        h = Hit(i, i, "T", text, 1, 1, [], 1.0, False, f"/{i}.pdf", "T", "Circular", None, None, None, "active", None)
        h.score = score
        return h
    base = "The sanction limit for local travel is Rs. 50,000 per quarter for officers in Grade A of all branches"
    ranked = [hit(1, base, 0.9), hit(2, base.replace("branches", "branchcs"), 0.8), hit(3, "Vault opening needs two custodians", 0.7)]
    assert [h.chunk_id for h in app.retriever.drop_copies(ranked)] == [1, 3]
