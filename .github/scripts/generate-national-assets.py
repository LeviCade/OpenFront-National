#!/usr/bin/env python3
"""Generate original NATIONAL placeholder artwork without upstream proprietary assets.

All generated assets are authored by this project, reproducible with stdlib,
and live under /resources (see that folder's CC BY-SA 4.0 asset terms).
This is a migration bootstrap, NOT a copy/tracing of OpenFront icons or marks.
"""
from pathlib import Path
import math
import struct
import zlib

BASE = Path("resources")
(BASE / "images").mkdir(parents=True, exist_ok=True)
(BASE / "icons").mkdir(parents=True, exist_ok=True)

mark = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="NATIONAL crown">
<rect width="160" height="160" rx="22" fill="#101b33"/>
<path d="M27 55 L49 85 L80 42 L111 85 L133 55 L124 119 L36 119 Z" fill="#e6b95b"/>
<path d="M37 129 H123" stroke="#f7db98" stroke-width="8" stroke-linecap="round"/>
</svg>
"""
logo = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 150" role="img" aria-label="OpenFront NATIONAL">
<rect width="600" height="150" rx="16" fill="#101b33"/>
<path d="M24 50 L43 77 L69 34 L95 77 L114 50 L107 111 L31 111 Z" fill="#e6b95b"/>
<path d="M34 120 H104" stroke="#f7db98" stroke-width="6" stroke-linecap="round"/>
<text x="137" y="88" fill="#f6e7c6" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="53">NATIONAL</text>
<text x="140" y="117" fill="#e6b95b" font-family="Arial,Helvetica,sans-serif" font-size="19" letter-spacing="3">THE AGE OF SOVEREIGNTY</text>
</svg>
"""
(BASE / "images/NationalMark.svg").write_text(mark, encoding="utf-8")
(BASE / "images/NationalLogo.svg").write_text(logo, encoding="utf-8")

# Entirely original crown silhouette: antialiased boundaries are a later UX task.
crown = ((116, 215), (166, 271), (256, 154), (346, 271), (396, 215), (370, 367), (142, 367))
def inside(px, py, polygon):
    contained = False
    x0, y0 = polygon[-1]
    for x1, y1 in polygon:
        if (y1 > py) != (y0 > py):
            ix = (x0 - x1) * (py - y1) / (y0 - y1) + x1
            if px < ix:
                contained = not contained
        x0, y0 = x1, y1
    return contained

def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

def make_png(filename, rounded):
    rows = bytearray()
    for y in range(512):
        rows.append(0)  # per-row PNG "none" filter
        for x in range(512):
            corner = min(x, 511-x), min(y, 511-y)
            if rounded and corner[0] < 60 and corner[1] < 60 and (60-corner[0])**2 + (60-corner[1])**2 > 60**2:
                rows.extend((0, 0, 0, 0))
            elif inside(x, y, crown) or (142 <= x <= 370 and 380 <= y <= 400):
                rows.extend((230, 185, 91, 255))
            else:
                rows.extend((16, 27, 51, 255))
    data = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 512, 512, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, level=9))
            + chunk(b"IEND", b""))
    (BASE / "icons" / filename).write_bytes(data)
    print(f"Created {filename}: {len(data)} bytes")

make_png("icon512_maskable.png", False)
make_png("icon512_rounded.png", True)
