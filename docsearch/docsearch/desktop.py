"""Desktop entry point: runs the local server and shows it in a native window."""
from __future__ import annotations

import socket
import threading
import time
import urllib.request
import webbrowser

from .app import App
from .server import create_api


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(app: App, host: str, port: int) -> None:
    import uvicorn

    uvicorn.run(create_api(app), host=host, port=port, log_level="warning")


def wait_ready(url: str, timeout: float = 30) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url + "/api/status", timeout=2).read()
            return True
        except Exception:
            time.sleep(0.2)
    return False


class JsApi:
    """Functions the page can call when running inside the native window."""

    def pick_folder(self):
        import webview

        dialog = getattr(getattr(webview, "FileDialog", None), "FOLDER", None) or webview.FOLDER_DIALOG
        result = webview.windows[0].create_file_dialog(dialog)
        return result[0] if result else None


def main(home=None, host: str = "127.0.0.1", port: int = 0, window: bool = True) -> None:
    app = App(home)
    port = port or free_port()
    url = f"http://127.0.0.1:{port}"
    if not window:
        print(f"DocSearch is running at {url}  (Ctrl+C to stop)")
        serve(app, host, port)
        return
    threading.Thread(target=serve, args=(app, host, port), daemon=True).start()
    if not wait_ready(url):
        raise SystemExit("DocSearch could not start its local server.")
    try:
        import webview
    except Exception:
        webbrowser.open(url)
        print(f"DocSearch is running at {url}  (Ctrl+C to stop)")
        threading.Event().wait()
        return
    webview.create_window("DocSearch", url, js_api=JsApi(), width=1280, height=860, min_size=(900, 600))
    webview.start()
    app.ingestor.stop()
