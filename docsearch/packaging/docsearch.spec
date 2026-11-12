# PyInstaller spec. Build from the docsearch/ project folder:
#   pyinstaller packaging/docsearch.spec --noconfirm
# Output: dist/DocSearch/ (Windows, Linux) and dist/DocSearch.app (macOS).
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files

root = Path(SPECPATH).parent
datas = [(str(root / "docsearch" / "ui"), "docsearch/ui")]
binaries, hidden = [], []
# Packages that ship model files, native libraries or data that PyInstaller
# does not find by itself. Optional ones are skipped when not installed.
for pkg in ("rapidocr", "onnxruntime", "fastembed", "tokenizers", "pypdfium2", "pypdfium2_raw", "llama_cpp", "webview"):
    try:
        d, b, h = collect_all(pkg)
    except Exception:
        continue
    datas += d
    binaries += b
    hidden += h
datas += collect_data_files("docx")

a = Analysis(
    [str(root / "packaging" / "run_docsearch.py")],
    pathex=[str(root)],
    datas=datas, binaries=binaries, hiddenimports=hidden + ["uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
                                                               "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on"],
    excludes=["tkinter", "matplotlib", "pytest", "fpdf", "IPython"],
)
pyz = PYZ(a.pure)
# Two launchers over the same files: the windowed app, and a console one for
# the census / ingest / eval commands (a windowed program cannot print on Windows).
gui = EXE(pyz, a.scripts, exclude_binaries=True, name="DocSearch", console=False)
cli = EXE(pyz, a.scripts, exclude_binaries=True, name="docsearch-cli", console=True)
coll = COLLECT(gui, cli, a.binaries, a.datas, name="DocSearch")
if sys.platform == "darwin":
    app = BUNDLE(coll, name="DocSearch.app", bundle_identifier="local.docsearch.app",
                 info_plist={"NSHighResolutionCapable": True, "CFBundleShortVersionString": "0.1.0"})
