from fastapi.testclient import TestClient

from docsearch.server import create_api


def test_api(app):
    client = TestClient(create_api(app))
    st = client.get("/api/status").json()
    assert st["counts"]["passages"] > 0 and st["folders"]
    assert "DocSearch" in client.get("/").text

    res = client.post("/api/ask", json={"question": "What is the sanction limit for local travel?"}).json()
    src = res["sources"][0]
    img = client.get("/api/page-image", params={"doc_id": src["doc_id"], "page": src["page_start"], "chunk_id": src["chunk_id"]})
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and len(img.content) > 5000

    docs = client.get("/api/documents").json()
    assert docs["total"] >= 5
    sup = client.get("/api/documents", params={"state": "superseded"}).json()
    assert sup["total"] == 1
    doc_id = sup["items"][0]["id"]
    assert client.post(f"/api/documents/{doc_id}/status", json={"status": "active"}).json()["ok"]
    assert client.get("/api/documents", params={"state": "superseded"}).json()["total"] == 0
    # A manual choice survives re-linking.
    app.ingestor.resolve_supersession(doc_id)
    assert client.get("/api/documents", params={"state": "superseded"}).json()["total"] == 0
    client.post(f"/api/documents/{doc_id}/status", json={"status": "superseded"})

    assert client.post("/api/ask", json={"question": " "}).status_code == 400
    assert client.post("/api/folders", json={"path": "/no/such/folder"}).status_code == 400
    assert client.post("/api/settings", json={"final_k": 4}).json()["final_k"] == 4
    assert isinstance(client.get("/api/review").json(), list)
