"""Command line: python -m docsearch [command]. No command opens the desktop app."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="docsearch", description="Offline question answering over office documents.")
    ap.add_argument("--home", help="data folder (index, models, settings)")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="run without a window; open the printed address in a browser")
    s.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to let other PCs on the network ask questions")
    s.add_argument("--port", type=int, default=8765)
    c = sub.add_parser("census", help="report what a folder contains and how long OCR will take")
    c.add_argument("folder")
    c.add_argument("--no-hash", action="store_true", help="skip duplicate detection (faster)")
    c.add_argument("--json", help="also write the report to this file")
    i = sub.add_parser("ingest", help="read a folder into the index (resumable)")
    i.add_argument("folder", nargs="?")
    a = sub.add_parser("ask", help="ask one question")
    a.add_argument("question")
    a.add_argument("--json", action="store_true")
    e = sub.add_parser("eval", help="score retrieval and refusal on a question file")
    e.add_argument("file")
    e.add_argument("--llm", action="store_true", help="also run the answer model")
    sub.add_parser("download-models", help="fetch the models (needs internet once)")
    sub.add_parser("status", help="show index and model status")
    args = ap.parse_args(argv)

    if args.cmd is None:
        from .desktop import main as desktop

        desktop(args.home)
        return 0
    if args.cmd == "serve":
        from .desktop import main as desktop

        desktop(args.home, host=args.host, port=args.port, window=False)
        return 0

    from .app import App

    app = App(args.home)
    if args.cmd == "census":
        from .census import census, format_report

        def prog(n, total):
            print(f"\r  scanned {n}/{total} files", end="", file=sys.stderr)
        report = census(Path(args.folder), app.settings, hash_files=not args.no_hash, progress=prog)
        print(file=sys.stderr)
        print(format_report(report))
        if args.json:
            Path(args.json).write_text(json.dumps(report, indent=2), "utf-8")
    elif args.cmd == "ingest":
        if args.folder:
            app.add_folder(args.folder)
        app.ingestor.start()
        p = app.ingestor.progress
        try:
            while app.ingestor._thread.is_alive():
                print(f"\r  {p['phase']:<9} {p['docs_done']}/{p['docs_total']} files  {p['file'][:40]:<40} "
                      f"page {p['page']}/{p['pages']}  {p['pages_per_min']} pages/min   ", end="", file=sys.stderr)
                time.sleep(1)
        except KeyboardInterrupt:
            app.ingestor.stop()
            app.ingestor._thread.join()
            print("\nStopped. Run the same command again to resume.", file=sys.stderr)
        print(file=sys.stderr)
        print(json.dumps(app.counts(), indent=2))
        if p["last_error"]:
            print("Last error:", p["last_error"])
    elif args.cmd == "ask":
        res = app.answerer.ask(args.question)
        if args.json:
            print(json.dumps(res, indent=2))
            return 0
        if res["mode"] == "not_found":
            print("Not found in the documents.")
        for st in res["statements"]:
            print(f"- {st['text']} [{st['source']}]")
        for src in res["sources"]:
            print(f"\n[{src['n']}] {src['file']} p.{src['page_start']}  {src['heading']}  (score {src['score']})")
            print("    " + src["text"].replace("\n", "\n    "))
        for n in res["notices"]:
            print("Note:", n)
    elif args.cmd == "eval":
        from .evalset import format_eval, run_eval

        print(format_eval(run_eval(app, Path(args.file), use_llm=args.llm)))
    elif args.cmd == "download-models":
        app.models.download_models()
        d = app.models.download
        print("Failed: " + d["error"] if d["error"] else f"Models are in {app.models.path}")
        return 1 if d["error"] else 0
    elif args.cmd == "status":
        print(json.dumps({"home": str(app.home), "counts": app.counts(), "models": app.models.status()}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
