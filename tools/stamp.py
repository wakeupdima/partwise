#!/usr/bin/env python3
"""Append ?v=<content hash> to local CSS/JS references in index.html (and src/index.html)
so browsers and the GitHub Pages cache always fetch the current files after an update.
Usage: python3 tools/stamp.py"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def stamp(html_path):
    s = html_path.read_text()

    def repl(m):
        attr, path = m.group(1), m.group(2)
        f = ROOT / path
        if not f.is_file():
            return m.group(0)
        v = hashlib.md5(f.read_bytes()).hexdigest()[:8]
        return f'{attr}="{path}?v={v}"'

    s2 = re.sub(r'(href|src)="((?:css|js)/[^"?]+)(?:\?v=[0-9a-f]+)?"', repl, s)
    html_path.write_text(s2)
    return s2 != s


for p in (ROOT / "index.html", ROOT / "src" / "index.html"):
    if p.exists():
        print(p.relative_to(ROOT), "updated" if stamp(p) else "unchanged")
