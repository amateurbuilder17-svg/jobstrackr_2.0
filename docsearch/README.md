# DocSearch

Offline question answering over office documents (SOPs, circulars, instructions,
scanned or digital). Every answer is checked against the document text and shown
with the passage and page it came from. When the documents do not contain an
answer, it says so.

## How it avoids wrong answers

1. **Retrieval first.** Keyword search and meaning search are combined, then a
   reranker scores each passage against the question. If nothing scores above the
   refusal threshold, the result is "Not found" and the answer model is never run.
2. **Constrained answer.** The answer model sees only the retrieved passages and
   must give, for each statement, the source number and a word-for-word quote.
3. **Verification in code** (`docsearch/answer.py`). A statement is shown only if
   the quote exists in the cited passage, every number, month and reference code
   in it also appears there, and most of its wording is supported by that passage.
   Anything else is dropped; if nothing survives, the exact passages are shown.
4. **Scans.** Each scanned passage carries its OCR confidence. Hard-to-read ones
   get a warning, scanned tables are never turned into a generated answer, and the
   page image is shown beside the text so figures can be checked by eye.
5. **Superseded documents** are detected from phrases such as "supersedes Circular
   No. X" and left out of search unless asked for. This can be overridden per
   document in the Library tab.

OCR can still misread a digit on a poor scan, and the check in step 3 compares
against the OCR text. The page image is the final authority for scanned sources.

## Ideas taken from similar projects

| Project | Taken | Left out |
|---|---|---|
| [LettuceDetect](https://github.com/KRLabsOrg/LettuceDetect) (MIT) | TinyLettuce, a 17M-parameter model trained to mark unsupported words in an answer, as an optional extra veto after the built-in checks | Its LLM-judge and data-generation parts |
| [hushdoc](https://github.com/fangyuan025/hushdoc) (MIT) | Dropping near-copies among the top passages and trimming passages far weaker than the best | LangChain/Chroma stack, Docling layout models (too heavy for 8 GB and a large scan archive), voice, chat history |
| [kotaemon](https://github.com/Cinnamon/kotaemon) (Apache-2.0) | Short verbatim evidence quotes, which small models copy more reliably | Agent-style reasoning pipelines, GraphRAG, multi-user server |
| [LARS](https://github.com/abgulati/LARS) (AGPL) | Nothing: its scan OCR depends on a cloud service and its licence restricts reuse | |

The answer checker needs `pip install lettucedetect` (which installs PyTorch) and
its model in `models/checker/`; it is not part of the packaged desktop build yet.

## Running from source

    python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    pip install llama-cpp-python                      # optional: written answers
    python -m docsearch                               # opens the app

Commands (packaged app: `docsearch-cli` instead of `python -m docsearch`):

    python -m docsearch census  "D:\Documents"       # what is there, OCR time estimate
    python -m docsearch ingest  "D:\Documents"       # read everything; Ctrl+C and rerun to resume
    python -m docsearch ask     "question"
    python -m docsearch eval    questions.jsonl      # score retrieval and refusal
    python -m docsearch download-models               # needs internet once
    python -m docsearch serve --host 0.0.0.0          # let other PCs on the network ask

With `serve --host 0.0.0.0` other PCs can ask questions and view pages from a
browser; adding folders, changing settings and opening files stay limited to the
PC running the app. There is no login, so use it only on a trusted office network.

## Models

| Role | Default | Size |
|---|---|---|
| OCR | PP-OCR (bundled with `rapidocr`) | in the app |
| Embedding | `BAAI/bge-small-en-v1.5` | ~70 MB |
| Reranker | `Xenova/ms-marco-MiniLM-L-12-v2` | ~120 MB |
| Answer model | Phi-4-mini-instruct, Q4 GGUF | ~2.5 GB |

Models live in the `models` folder inside the data folder (shown at the bottom of
Settings). For a PC without internet, download on one PC and copy that folder.
Without the answer model the app still works and shows the matching passages.
Any other `.gguf` chat model can be dropped into the folder instead.

## Supported files

PDF (text or scanned), PNG/JPG/TIFF, DOCX, XLSX, TXT. Old `.doc`, `.xls`, `.ppt`
files are listed as "Unsupported type" and need converting first.

## Tuning with your own questions

Write 50-100 real questions in a file, one JSON object per line, including some
the documents cannot answer:

    {"question": "What is the sanction limit for local travel?", "expect_file": "HR-2023-045", "expect_text": "50,000"}
    {"question": "What is the canteen menu on Friday?", "answerable": false}

`eval` reports how often the right passage was returned, how often it refused
correctly, and the score gap between the two groups, which is what the refusal
threshold in Settings should sit inside.

## Building the desktop packages

`.github/workflows/docsearch-build.yml` builds Windows and macOS (Apple Silicon)
packages with PyInstaller and uploads them as workflow artifacts. Locally:

    pip install pyinstaller && pyinstaller packaging/docsearch.spec --noconfirm

The macOS build is unsigned: on first launch right-click the app and choose Open.

## Tests

    pip install -r requirements-dev.txt && python -m pytest -q
