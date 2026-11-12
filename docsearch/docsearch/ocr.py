"""OCR for scanned pages. Returns text rows with position and confidence."""
from __future__ import annotations

import logging
import threading

import numpy as np

_lock = threading.Lock()
_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        from rapidocr import RapidOCR

        logging.getLogger("RapidOCR").setLevel(logging.ERROR)
        _engine = RapidOCR()
        logging.getLogger("RapidOCR").setLevel(logging.ERROR)
    return _engine


def group_rows(boxes: list[tuple[str, float, float, float, float, float]]) -> list[list]:
    """Merge boxes that sit on the same visual row (table cells, split lines).

    Input and output coordinates are fractions of the page. Cells on one row are
    joined with three spaces so table rows stay readable and detectable.
    Output rows: [text, x0, y0, x1, y1, conf, 0].
    """
    if not boxes:
        return []
    heights = sorted(b[4] - b[2] for b in boxes)
    med_h = heights[len(heights) // 2] or 0.01
    boxes = sorted(boxes, key=lambda b: ((b[2] + b[4]) / 2, b[1]))
    rows: list[list[tuple]] = []
    for b in boxes:
        yc = (b[2] + b[4]) / 2
        if rows:
            last = rows[-1]
            ryc = sum((r[2] + r[4]) / 2 for r in last) / len(last)
            if abs(yc - ryc) < 0.5 * med_h:
                last.append(b)
                continue
        rows.append([b])
    out = []
    for row in rows:
        row.sort(key=lambda b: b[1])
        parts = [row[0][0]]
        for prev, cur in zip(row, row[1:]):
            gap = cur[1] - prev[3]
            parts.append(("   " if gap > 1.5 * med_h else " ") + cur[0])
        out.append([
            "".join(parts).strip(),
            round(min(b[1] for b in row), 4), round(min(b[2] for b in row), 4),
            round(max(b[3] for b in row), 4), round(max(b[4] for b in row), 4),
            round(min(b[5] for b in row), 3), 0,
        ])
    return [r for r in out if r[0]]


def ocr_image(image) -> list[list]:
    """OCR a PIL image. Returns rows as produced by group_rows()."""
    img = np.asarray(image.convert("RGB"))
    h, w = img.shape[:2]
    with _lock:
        res = _get_engine()(img)
    if res is None or res.txts is None or res.boxes is None:
        return []
    boxes = []
    for txt, score, quad in zip(res.txts, res.scores, res.boxes):
        txt = (txt or "").strip()
        if not txt:
            continue
        xs = [float(p[0]) for p in quad]
        ys = [float(p[1]) for p in quad]
        boxes.append((txt, min(xs) / w, min(ys) / h, max(xs) / w, max(ys) / h, float(score)))
    return group_rows(boxes)
