"""Turn a file into pages of text lines.

Each page is a dict: {page_no, source: 'text'|'ocr', conf, lines}. A line is
[text, x0, y0, x1, y1, conf, heading_level]; coordinates are page fractions from
the top-left, or None when the format has no layout (DOCX, XLSX, TXT).
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable, Iterator

PDF_EXT = {".pdf"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
DOCX_EXT = {".docx"}
XLSX_EXT = {".xlsx", ".xlsm"}
TEXT_EXT = {".txt", ".md"}
SUPPORTED = PDF_EXT | IMAGE_EXT | DOCX_EXT | XLSX_EXT | TEXT_EXT
# Recognised office formats we cannot read directly; reported so they can be converted.
UNSUPPORTED_OFFICE = {".doc", ".xls", ".ppt", ".pptx", ".rtf", ".odt", ".ods", ".msg", ".eml"}


def page_count(path: Path) -> int:
    ext = path.suffix.lower()
    if ext in PDF_EXT:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(str(path))
        try:
            return len(pdf)
        finally:
            pdf.close()
    if ext in IMAGE_EXT:
        from PIL import Image

        with Image.open(path) as im:
            return getattr(im, "n_frames", 1)
    return 1


def _page(page_no: int, source: str, lines: list[list]) -> dict:
    confs = [ln[5] for ln in lines] or [1.0]
    return {
        "page_no": page_no, "source": source, "lines": lines,
        "conf": round(sum(confs) / len(confs), 3),
        "n_chars": sum(len(ln[0]) for ln in lines),
    }


# ---------------------------------------------------------------- PDF

def _pdf_text_lines(textpage, width: float, height: float) -> list[list]:
    full = textpage.get_text_range()
    indexed = len(full) == textpage.count_chars()
    lines = []
    for m in re.finditer(r"[^\r\n]+", full):
        text = m.group().replace("\x02", "-").replace("￾", "-").strip()
        if not text:
            continue
        box = [None, None, None, None]
        if indexed and width and height:
            raw = m.group()
            first = m.start() + (len(raw) - len(raw.lstrip()))
            last = m.end() - 1 - (len(raw) - len(raw.rstrip()))
            try:
                l1, b1, r1, t1 = textpage.get_charbox(first, loose=True)
                l2, b2, r2, t2 = textpage.get_charbox(last, loose=True)
                x0, x1 = min(l1, l2) / width, max(r1, r2) / width
                y0, y1 = 1 - max(t1, t2) / height, 1 - min(b1, b2) / height
                if 0 <= x0 < x1 <= 1.05 and 0 <= y0 < y1 <= 1.05:
                    box = [round(x0, 4), round(y0, 4), round(min(x1, 1), 4), round(min(y1, 1), 4)]
            except Exception:
                pass
        lines.append([text, *box, 1.0, 0])
    return lines


def _has_full_page_image(page, width: float, height: float) -> bool:
    """True for a scan that carries an embedded OCR text layer from the scanner."""
    try:
        import pypdfium2.raw as pdfium_c

        for obj in page.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,), max_depth=2):
            left, bottom, right, top = obj.get_bounds()
            if (right - left) * (top - bottom) >= 0.7 * width * height:
                return True
    except Exception:
        return False
    return False


def render_pdf_page(path: Path, page_no: int, dpi: int):
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(path))
    try:
        page = pdf[page_no - 1]
        return page.render(scale=dpi / 72).to_pil().convert("RGB")
    finally:
        pdf.close()


def _extract_pdf(path: Path, settings, skip: set[int]) -> Iterator[dict]:
    import pypdfium2 as pdfium

    from .ocr import ocr_image

    pdf = pdfium.PdfDocument(str(path))
    try:
        for i in range(len(pdf)):
            page_no = i + 1
            if page_no in skip:
                continue
            page = pdf[i]
            width, height = page.get_size()
            textpage = page.get_textpage()
            lines = _pdf_text_lines(textpage, width, height)
            n_chars = sum(len(ln[0]) for ln in lines)
            # A scanner's own text layer has no confidence scores and is often
            # poor, so scans are always re-read with our OCR.
            scanned = n_chars < settings.min_text_chars or _has_full_page_image(page, width, height)
            if scanned:
                image = page.render(scale=settings.ocr_dpi / 72).to_pil().convert("RGB")
                ocr_lines = ocr_image(image)
                if ocr_lines or n_chars < settings.min_text_chars:
                    yield _page(page_no, "ocr", ocr_lines)
                else:
                    yield _page(page_no, "text", lines)
            else:
                yield _page(page_no, "text", lines)
            textpage.close()
            page.close()
    finally:
        pdf.close()


# ---------------------------------------------------------------- images

def _extract_image(path: Path, settings, skip: set[int]) -> Iterator[dict]:
    from PIL import Image, ImageSequence

    from .ocr import ocr_image

    with Image.open(path) as im:
        for i, frame in enumerate(ImageSequence.Iterator(im)):
            if i + 1 in skip:
                continue
            yield _page(i + 1, "ocr", ocr_image(frame.convert("RGB")))


def load_image_page(path: Path, page_no: int):
    from PIL import Image, ImageSequence

    with Image.open(path) as im:
        for i, frame in enumerate(ImageSequence.Iterator(im)):
            if i + 1 == page_no:
                return frame.convert("RGB")
    raise IndexError(page_no)


# ---------------------------------------------------------------- DOCX / XLSX / TXT

def _extract_docx(path: Path) -> Iterator[dict]:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = docx.Document(str(path))
    lines: list[list] = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, doc)
            text = para.text.strip()
            if not text:
                continue
            level = 0
            style = (para.style.name or "") if para.style is not None else ""
            m = re.match(r"Heading (\d)", style)
            if m:
                level = int(m.group(1))
            elif style == "Title":
                level = 1
            lines.append([text, None, None, None, None, 1.0, level])
        elif tag == "tbl":
            for row in Table(child, doc).rows:
                cells, seen = [], set()
                for cell in row.cells:
                    if id(cell._tc) in seen:  # merged cells repeat
                        continue
                    seen.add(id(cell._tc))
                    cells.append(" ".join(cell.text.split()))
                if any(cells):
                    lines.append(["   ".join(cells), None, None, None, None, 1.0, 0])
    yield _page(1, "text", lines)


def _extract_xlsx(path: Path) -> Iterator[dict]:
    import openpyxl

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    try:
        for n, ws in enumerate(wb.worksheets, 1):
            lines = [[f"Sheet: {ws.title}", None, None, None, None, 1.0, 1]]
            for row in ws.iter_rows(values_only=True):
                cells = ["" if v is None else str(v).strip() for v in row]
                while cells and not cells[-1]:
                    cells.pop()
                if any(cells):
                    lines.append(["   ".join(cells), None, None, None, None, 1.0, 0])
            yield _page(n, "text", lines)
    finally:
        wb.close()


def _extract_text(path: Path) -> Iterator[dict]:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    lines = [[ln.strip(), None, None, None, None, 1.0, 0] for ln in text.splitlines() if ln.strip()]
    yield _page(1, "text", lines)


def extract(path: Path, settings, skip_pages: set[int] | None = None) -> Iterator[dict]:
    """Yield pages of a document, skipping page numbers already stored."""
    skip = skip_pages or set()
    ext = path.suffix.lower()
    if ext in PDF_EXT:
        yield from _extract_pdf(path, settings, skip)
    elif ext in IMAGE_EXT:
        yield from _extract_image(path, settings, skip)
    elif ext in DOCX_EXT:
        if 1 not in skip:
            yield from _extract_docx(path)
    elif ext in XLSX_EXT:
        yield from (p for p in _extract_xlsx(path) if p["page_no"] not in skip)
    elif ext in TEXT_EXT:
        if 1 not in skip:
            yield from _extract_text(path)
    else:
        raise ValueError(f"unsupported file type: {ext}")


def has_page_image(path: Path) -> bool:
    return path.suffix.lower() in PDF_EXT | IMAGE_EXT


def page_image(path: Path, page_no: int, dpi: int = 110):
    if path.suffix.lower() in PDF_EXT:
        return render_pdf_page(path, page_no, dpi)
    return load_image_page(path, page_no)
