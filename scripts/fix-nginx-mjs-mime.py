#!/usr/bin/env python3
"""Ensure nginx serves .mjs as application/javascript."""
from pathlib import Path

mime_path = Path("/etc/nginx/mime.types")
text = mime_path.read_text(encoding="utf-8")
old = "application/javascript                           js;"
new = "application/javascript                           js mjs;"
if new not in text:
    if old not in text:
        raise SystemExit(f"Expected line not found in {mime_path}")
    mime_path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("Updated mime.types: added mjs")
else:
    print("mime.types already includes mjs")
