#!/usr/bin/env python3
"""Generate the extension icons without third-party dependencies."""

import math
import struct
import zlib
from pathlib import Path

BG = (17, 24, 39)
RING = (34, 197, 94)
FACE = (249, 250, 251)
HAND = (17, 24, 39)


def rounded_rect(x, y, size, radius):
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= radius * radius


def sample(x, y, size):
    if not rounded_rect(x, y, size, size * 0.22):
        return (0, 0, 0, 0)

    cx = cy = size / 2
    distance = math.hypot(x - cx, y - cy)
    if distance > size * 0.30:
        return (*BG, 255)
    if distance > size * 0.235:
        return (*RING, 255)

    color = (*FACE, 255)
    if abs(x - cx) <= size * 0.04 and cy - size * 0.15 <= y <= cy:
        color = (*HAND, 255)
    if abs(y - cy) <= size * 0.04 and cx <= x <= cx + size * 0.11:
        color = (*HAND, 255)
    if distance <= size * 0.05:
        color = (*HAND, 255)
    return color


def render(size, supersample=4):
    rows = []
    total = supersample * supersample
    for py in range(size):
        row = []
        for px in range(size):
            red = green = blue = alpha = 0
            for sy in range(supersample):
                for sx in range(supersample):
                    x = px + (sx + 0.5) / supersample
                    y = py + (sy + 0.5) / supersample
                    cr, cg, cb, ca = sample(x, y, size)
                    red += cr * ca
                    green += cg * ca
                    blue += cb * ca
                    alpha += ca
            if alpha == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append(
                    (red // alpha, green // alpha, blue // alpha, alpha // total)
                )
        rows.append(row)
    return rows


def write_png(path, rows):
    size = len(rows)
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for red, green, blue, alpha in row:
            raw.extend((red, green, blue, alpha))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(out / f"icon{size}.png", render(size))
    print(f"wrote 4 icons to {out}")


if __name__ == "__main__":
    main()
