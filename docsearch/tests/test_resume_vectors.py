import numpy as np
from PIL import Image

import docsearch.vectors as vectors
from docsearch.app import App
from tests.conftest import test_settings as make_settings


def test_resume_mid_document(tmp_path):
    folder = tmp_path / "docs"
    folder.mkdir()
    pages = [Image.new("RGB", (600, 800), "white") for _ in range(3)]
    pages[0].save(folder / "three.pdf", "PDF", save_all=True, append_images=pages[1:])
    app = App(tmp_path / "home", make_settings())
    app.add_folder(str(folder))
    app.ingestor.scan()
    doc_id = app.db.one("SELECT id FROM documents")["id"]

    app.ingestor._stop.set()  # stop requested: exactly one page is committed, then it yields
    app.ingestor.process(doc_id)
    assert app.db.one("SELECT COUNT(*) n FROM pages")["n"] == 1
    assert app.db.one("SELECT state FROM documents")["state"] == "pending"

    app.ingestor._stop.clear()
    app.ingestor.run()
    assert app.db.one("SELECT COUNT(*) n FROM pages")["n"] == 3
    assert app.db.one("SELECT state FROM documents")["state"] == "done"


def test_vector_store_exact_and_binary_agree(tmp_path, monkeypatch):
    rng = np.random.default_rng(0)
    data = rng.normal(size=(3000, 384)).astype(np.float32)
    data /= np.linalg.norm(data, axis=1, keepdims=True)
    store = vectors.VectorStore(tmp_path, 384)
    assert store.append(data[:1000]) == 0 and store.append(data[1000:]) == 1000
    q = data[1234] + 0.05 * rng.normal(size=384).astype(np.float32)
    exact = store.search(q, 5)
    assert exact[0][0] == 1234
    monkeypatch.setattr(vectors, "EXACT_LIMIT", 0)
    assert store.search(q, 5)[0][0] == 1234
    reopened = vectors.VectorStore(tmp_path, 384)  # survives a restart
    assert reopened.count == 3000 and reopened.search(q, 1)[0][0] == 1234
