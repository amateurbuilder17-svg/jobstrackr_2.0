"""Builds a small mixed corpus: a text PDF, a scanned PDF, a DOCX, an XLSX and a duplicate."""
import glob
import shutil
from pathlib import Path

import pytest

from docsearch.app import App
from docsearch.config import Settings

NEW_CIRCULAR = [
    "CIRCULAR No. HR/2023/045",
    "Date: 12 March 2023",
    "Subject: Revision of travel allowance limits",
    "1. Purpose",
    "This circular revises the limits for local travel claims made by staff of all branches.",
    "It applies to every employee on the regular rolls of the organisation from the effective date.",
    "2. Limits",
    "2.1 The sanction limit for local travel is Rs. 50,000 per quarter for officers in Grade A.",
    "2.2 Claims above the limit require written approval of the Regional Manager before payment.",
    "2.3 Claims must be submitted within 30 days of completing the journey with original receipts.",
    "3. Supersession",
    "This circular supersedes Circular No. HR/2021/017 with effect from 01/04/2023.",
]
OLD_CIRCULAR = [
    "CIRCULAR No. HR/2021/017",
    "Date: 05 January 2021",
    "Subject: Travel allowance limits",
    "1. Limits",
    "1.1 The sanction limit for local travel is Rs. 30,000 per quarter for officers in Grade A.",
    "1.2 Claims must be submitted within 45 days of completing the journey with original receipts.",
    "1.3 The Branch Manager shall verify each claim against the attendance register before forwarding it.",
]


def _font(size):
    from PIL import ImageFont

    known = ["C:/Windows/Fonts/arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"]
    fonts = sorted(glob.glob("/usr/share/fonts/**/DejaVuSans.ttf", recursive=True)) or \
        [f for f in known if Path(f).exists()] or sorted(glob.glob("/usr/share/fonts/**/*.ttf", recursive=True))
    return ImageFont.truetype(fonts[0], size) if fonts else ImageFont.load_default(size)


def make_scanned_pdf(path: Path, lines: list[str]) -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (1654, 2339), "white")
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((150, 220 + i * 95), line, fill="black", font=_font(32))
    img.save(path, "PDF", resolution=200)


def make_text_pdf(path: Path, lines: list[str]) -> None:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    for line in lines:
        pdf.multi_cell(0, 9, line, new_x="LMARGIN", new_y="NEXT")
    pdf.output(str(path))


def make_docx(path: Path) -> None:
    import docx

    d = docx.Document()
    d.add_heading("Standard Operating Procedure: Cash Handling", 0)
    d.add_paragraph("SOP No. OPS/SOP/012")
    d.add_heading("Opening the vault", 1)
    d.add_paragraph("The vault must be opened jointly by two custodians, each holding one key. "
                    "The opening time is recorded in the vault register and signed by both custodians.")
    d.add_heading("Cash retention limits", 1)
    d.add_paragraph("The following retention limits apply to each category of branch at close of business.")
    t = d.add_table(rows=3, cols=2)
    for r, (a, b) in enumerate([("Branch category", "Retention limit"), ("Rural", "Rs. 5,00,000"), ("Urban", "Rs. 20,00,000")]):
        t.cell(r, 0).text, t.cell(r, 1).text = a, b
    d.add_heading("Closing", 1)
    d.add_paragraph("Excess cash above the retention limit is remitted to the currency chest on the next working day. "
                    "The custodians count the closing balance together and record it in the cash book before locking.")
    d.save(str(path))


def make_xlsx(path: Path) -> None:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Escalation"
    ws.append(["Issue", "First contact", "Escalate after"])
    ws.append(["ATM cash out", "Branch Manager", "2 hours"])
    ws.append(["Network outage", "IT Helpdesk", "30 minutes"])
    wb.save(str(path))


@pytest.fixture(scope="session")
def corpus(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("corpus")
    make_text_pdf(root / "HR-2023-045 travel allowance.pdf", NEW_CIRCULAR)
    make_scanned_pdf(root / "scan_0007.pdf", OLD_CIRCULAR)
    make_docx(root / "SOP cash handling.docx")
    make_xlsx(root / "escalation matrix.xlsx")
    (root / "sub").mkdir()
    shutil.copy(root / "SOP cash handling.docx", root / "sub" / "copy of SOP.docx")
    (root / "old memo.doc").write_bytes(b"legacy")
    return root


def test_settings() -> Settings:
    return Settings(embed_model="hash", rerank_model="lexical")


@pytest.fixture(scope="session")
def app(corpus, tmp_path_factory) -> App:
    a = App(tmp_path_factory.mktemp("home"), test_settings())
    a.add_folder(str(corpus))
    a.ingestor.run()
    assert not a.ingestor.progress["last_error"], a.ingestor.progress["last_error"]
    return a
