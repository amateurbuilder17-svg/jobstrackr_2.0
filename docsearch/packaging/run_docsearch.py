"""Entry point for the packaged app."""
import multiprocessing
import sys

from docsearch.__main__ import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.exit(main())
