"""Local HTTP API and UI host."""
from __future__ import annotations

import io
import os
import subprocess
import sys
import threading
from functools import lru_cache
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__
from . import extract as ex
from .app import App
from .db import unpack_lines


def ui_dir() -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).parent.parent))  # PyInstaller unpack dir
    for cand in (base / "docsearch" / "ui", Path(__file__).parent / "ui"):
        if cand.is_dir():
            return cand
    raise RuntimeError("UI files not found")


def create_api(app: App) -> FastAPI:
    api = FastAPI(title="DocSearch", docs_url=None, redoc_url=None, openapi_url=None)
    ui = ui_dir()

    def local_only(request: Request) -> None:
        """Changing folders, settings or models is only allowed from this computer."""
        host = request.client.host if request.client else ""
        if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
            raise HTTPException(403, "This action is only available on the computer running DocSearch.")

    @api.get("/")
    def index():
        return FileResponse(ui / "index.html", headers={"Cache-Control": "no-store"})

    @api.get("/api/status")
    def status():
        return {"version": __version__, "home": str(app.home), "counts": app.counts(),
                "ingest": dict(app.ingestor.progress), "models": app.models.status(),
                "folders": [r["path"] for r in app.db.q("SELECT path FROM folders ORDER BY path")]}

    @api.post("/api/ask")
    def ask(body: dict = Body(...)):
        question = str(body.get("question", "")).strip()
        if not question:
            raise HTTPException(400, "Type a question first.")
        return app.answerer.ask(question, include_superseded=body.get("include_superseded"))

    # ---- sources
    @lru_cache(maxsize=24)
    def render(path: str, mtime: float, page_no: int) -> "object":
        return ex.page_image(Path(path), page_no, dpi=110)

    @api.get("/api/page-image")
    def page_image(doc_id: int, page: int, chunk_id: int | None = None):
        doc = app.db.one("SELECT path FROM documents WHERE id=?", (doc_id,))
        if not doc:
            raise HTTPException(404, "Unknown document.")
        path = Path(doc["path"])
        if not path.exists():
            raise HTTPException(404, "The original file has been moved or deleted.")
        if not ex.has_page_image(path):
            raise HTTPException(404, "This file type has no page image.")
        from PIL import Image, ImageDraw

        try:
            img = render(str(path), path.stat().st_mtime, page).copy()
        except Exception as exc:
            raise HTTPException(404, f"Could not render the page: {exc}")
        if img.width > 1400:
            img = img.resize((1400, int(img.height * 1400 / img.width)))
        if chunk_id is not None:
            ch = app.db.one("SELECT spans FROM chunks WHERE id=? AND doc_id=?", (chunk_id, doc_id))
            pg = app.db.one("SELECT lines FROM pages WHERE doc_id=? AND page_no=?", (doc_id, page))
            if ch and pg:
                import json

                lines = unpack_lines(pg["lines"])
                overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
                draw = ImageDraw.Draw(overlay)
                for p, first, last in json.loads(ch["spans"] or "[]"):
                    if p != page:
                        continue
                    for ln in lines[first:last + 1]:
                        if ln[1] is None:
                            continue
                        x0, y0, x1, y1 = ln[1] * img.width, ln[2] * img.height, ln[3] * img.width, ln[4] * img.height
                        draw.rectangle([x0 - 3, y0 - 2, x1 + 3, y1 + 2], fill=(255, 214, 0, 80))
                img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=82)
        return Response(buf.getvalue(), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})

    @api.post("/api/documents/{doc_id}/open")
    def open_file(doc_id: int, request: Request):
        local_only(request)
        doc = app.db.one("SELECT path FROM documents WHERE id=?", (doc_id,))
        if not doc or not Path(doc["path"]).exists():
            raise HTTPException(404, "The original file has been moved or deleted.")
        path = doc["path"]
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606 - opening the user's own document
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
        return {"ok": True}

    # ---- library
    @api.get("/api/documents")
    def documents(q: str = "", state: str = "", limit: int = 100, offset: int = 0):
        where, args = ["1=1"], []
        if q:
            where.append("(path LIKE ? OR title LIKE ? OR doc_number LIKE ?)")
            args += [f"%{q}%"] * 3
        if state == "superseded":
            where.append("state='done' AND status='superseded'")
        elif state == "lowconf":
            where.append("state='done' AND ocr_pages>0 AND mean_conf < ?")
            args.append(app.settings.ocr_low_conf)
        elif state:
            where.append("state=?")
            args.append(state)
        sql = " FROM documents WHERE " + " AND ".join(where)
        total = app.db.one("SELECT COUNT(*) n" + sql, args)["n"]
        rows = app.db.q(
            "SELECT id,path,state,error,title,doc_type,doc_number,issue_date,effective_date,status,status_source,"
            "superseded_by,duplicate_of,n_pages,ocr_pages,mean_conf" + sql + " ORDER BY path LIMIT ? OFFSET ?",
            args + [min(limit, 500), offset])
        return {"total": total, "items": [dict(r) | {"file": Path(r["path"]).name} for r in rows]}

    @api.post("/api/documents/{doc_id}/status")
    def set_status(doc_id: int, request: Request, body: dict = Body(...)):
        local_only(request)
        status = body.get("status")
        if status not in ("active", "superseded"):
            raise HTTPException(400, "status must be 'active' or 'superseded'")
        app.db.x("UPDATE documents SET status=?,status_source='manual',superseded_by=NULL WHERE id=?", (status, doc_id))
        return {"ok": True}

    @api.get("/api/review")
    def review(limit: int = 200):
        rows = app.db.q(
            "SELECT p.doc_id,p.page_no,p.conf,p.n_chars,d.path FROM pages p JOIN documents d ON d.id=p.doc_id "
            "WHERE p.source='ocr' AND (p.conf < ? OR p.n_chars < 20) AND d.state='done' ORDER BY p.conf LIMIT ?",
            (app.settings.ocr_low_conf, limit))
        return [dict(r) | {"file": Path(r["path"]).name} for r in rows]

    @api.post("/api/folders")
    def add_folder(request: Request, body: dict = Body(...)):
        local_only(request)
        try:
            app.add_folder(str(body.get("path", "")))
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"ok": True}

    @api.post("/api/folders/remove")
    def remove_folder(request: Request, body: dict = Body(...)):
        local_only(request)
        path = str(body.get("path", ""))
        app.db.x("DELETE FROM folders WHERE path=?", (path,))
        prefix = path.rstrip("/\\") + os.sep
        for row in app.db.q("SELECT id,path FROM documents"):
            if row["path"].startswith(prefix):
                app.db.clear_document(row["id"])
                app.db.x("DELETE FROM documents WHERE id=?", (row["id"],))
        return {"ok": True}

    @api.post("/api/ingest/start")
    def ingest_start(request: Request):
        local_only(request)
        return {"started": app.ingestor.start()}

    @api.post("/api/ingest/stop")
    def ingest_stop(request: Request):
        local_only(request)
        app.ingestor.stop()
        return {"ok": True}

    @api.post("/api/ingest/retry-errors")
    def retry_errors(request: Request):
        local_only(request)
        app.db.x("UPDATE documents SET state='pending',error=NULL WHERE state='error'")
        return {"started": app.ingestor.start()}

    # ---- settings and models
    @api.get("/api/settings")
    def get_settings():
        from dataclasses import asdict

        return asdict(app.settings)

    @api.post("/api/settings")
    def set_settings(request: Request, body: dict = Body(...)):
        local_only(request)
        before = (app.settings.embed_model, app.settings.rerank_model, app.settings.llm_file)
        try:
            app.settings.update(body)
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, f"Invalid value: {exc}")
        app.settings.save(app.home)
        if before != (app.settings.embed_model, app.settings.rerank_model, app.settings.llm_file):
            app.models.reset()
        return get_settings()

    @api.post("/api/models/download")
    def download(request: Request):
        local_only(request)
        if app.models.download["running"]:
            return {"started": False}
        threading.Thread(target=app.models.download_models, daemon=True).start()
        return {"started": True}

    api.mount("/", StaticFiles(directory=ui), name="ui")
    return api
