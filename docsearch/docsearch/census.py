"""Census: what is in a folder, before committing to a long ingestion run."""
from __future__ import annotations

import time
from collections import Counter, defaultdict
from pathlib import Path

from . import extract as ex
from .ingest import file_hash


def census(root: Path, settings, hash_files: bool = True, ocr_samples: int = 3, progress=None) -> dict:
    files = [p for p in sorted(root.rglob("*")) if p.is_file() and not p.name.startswith(("~$", "."))]
    by_ext: dict[str, dict] = defaultdict(lambda: {"files": 0, "bytes": 0})
    hashes: Counter[str] = Counter()
    pdf_pages = text_pages = scan_pages = image_pages = unreadable = 0
    scanned_examples: list[tuple[Path, int]] = []
    for n, path in enumerate(files, 1):
        if progress and n % 50 == 0:
            progress(n, len(files))
        ext = path.suffix.lower() or "(none)"
        by_ext[ext]["files"] += 1
        by_ext[ext]["bytes"] += path.stat().st_size
        if ext not in ex.SUPPORTED:
            continue
        if hash_files:
            try:
                hashes[file_hash(path)] += 1
            except OSError:
                pass
        try:
            if ext in ex.PDF_EXT:
                import pypdfium2 as pdfium

                pdf = pdfium.PdfDocument(str(path))
                try:
                    for i in range(len(pdf)):
                        page = pdf[i]
                        tp = page.get_textpage()
                        w, h = page.get_size()
                        has_text = len(tp.get_text_range().strip()) >= settings.min_text_chars
                        if has_text and not ex._has_full_page_image(page, w, h):
                            text_pages += 1
                        else:
                            scan_pages += 1
                            if len(scanned_examples) < ocr_samples * 4:
                                scanned_examples.append((path, i + 1))
                        pdf_pages += 1
                        tp.close()
                        page.close()
                finally:
                    pdf.close()
            elif ext in ex.IMAGE_EXT:
                n_img = ex.page_count(path)
                image_pages += n_img
                if len(scanned_examples) < ocr_samples * 4:
                    scanned_examples.append((path, 1))
        except Exception:
            unreadable += 1

    # Time a few real scanned pages on this machine to project the OCR run.
    sec_per_page = None
    if scanned_examples and ocr_samples:
        from .ocr import ocr_image

        step = max(1, len(scanned_examples) // ocr_samples)
        sample = scanned_examples[::step][:ocr_samples]
        ocr_image(ex.page_image(sample[0][0], sample[0][1], settings.ocr_dpi))  # warm-up, loads the models
        t0 = time.time()
        for path, page_no in sample:
            ocr_image(ex.page_image(path, page_no, settings.ocr_dpi))
        sec_per_page = (time.time() - t0) / len(sample)

    to_ocr = scan_pages + image_pages
    dup_files = sum(c - 1 for c in hashes.values() if c > 1)
    supported = sum(v["files"] for e, v in by_ext.items() if e in ex.SUPPORTED)
    return {
        "root": str(root), "files": len(files), "supported_files": supported,
        "total_gb": round(sum(v["bytes"] for v in by_ext.values()) / 1e9, 2),
        "by_extension": {e: {"files": v["files"], "mb": round(v["bytes"] / 1e6, 1)}
                         for e, v in sorted(by_ext.items(), key=lambda kv: -kv[1]["bytes"])},
        "needs_conversion": {e: v["files"] for e, v in by_ext.items() if e in ex.UNSUPPORTED_OFFICE},
        "pdf_pages": pdf_pages, "pdf_text_pages": text_pages, "pdf_scanned_pages": scan_pages,
        "image_pages": image_pages, "pages_to_ocr": to_ocr, "unreadable_files": unreadable,
        "exact_duplicate_files": dup_files if hash_files else None,
        "ocr_seconds_per_page": round(sec_per_page, 2) if sec_per_page else None,
        "ocr_hours_estimate": round(to_ocr * sec_per_page / 3600, 1) if sec_per_page else None,
    }


def format_report(r: dict) -> str:
    out = [f"Folder: {r['root']}", f"Files: {r['files']} ({r['total_gb']} GB), readable by DocSearch: {r['supported_files']}", ""]
    out.append("By type:")
    for ext, v in r["by_extension"].items():
        out.append(f"  {ext:<8} {v['files']:>7} files  {v['mb']:>10.1f} MB")
    out += ["", f"PDF pages: {r['pdf_pages']}  (with text: {r['pdf_text_pages']}, scanned: {r['pdf_scanned_pages']})",
            f"Image pages: {r['image_pages']}", f"Pages needing OCR: {r['pages_to_ocr']}"]
    if r["ocr_seconds_per_page"]:
        out.append(f"OCR speed on this machine: {r['ocr_seconds_per_page']} s/page -> about {r['ocr_hours_estimate']} hours for the whole folder")
    if r["exact_duplicate_files"] is not None:
        out.append(f"Exact duplicate files: {r['exact_duplicate_files']}")
    if r["needs_conversion"]:
        out.append("Needs converting to PDF/DOCX/XLSX first: " + ", ".join(f"{n} {e}" for e, n in r["needs_conversion"].items()))
    if r["unreadable_files"]:
        out.append(f"Files that could not be opened: {r['unreadable_files']}")
    return "\n".join(out)
