#!/usr/bin/env python3
"""Generates icons/icon16.png, icon48.png, icon128.png without any dependencies."""
import struct, zlib, os

def crc32(data):
    return zlib.crc32(data) & 0xFFFFFFFF

def chunk(tag, data):
    tag = tag.encode('ascii')
    length = struct.pack('>I', len(data))
    crc = struct.pack('>I', crc32(tag + data))
    return length + tag + data + crc

def make_png(size):
    # Draw a green circle on transparent background (RGBA)
    pixels = []
    cx = cy = size / 2
    r_outer = size / 2 - 0.5

    for y in range(size):
        row = []
        for x in range(size):
            dx = x - cx + 0.5
            dy = y - cy + 0.5
            dist = (dx*dx + dy*dy) ** 0.5

            if dist <= r_outer:
                # Green circle background
                row += [26, 127, 55, 255]  # #1a7f37 opaque
            else:
                row += [0, 0, 0, 0]  # transparent

        # Simple PR icon (white lines) drawn on top
        # We'll add small white dots for the nodes
        dot_positions = []
        if size >= 48:
            s = size / 128
            dot_positions = [
                (int(42*s), int(32*s), int(9*s)),   # top node
                (int(42*s), int(96*s), int(9*s)),   # bottom node
                (int(86*s), int(50*s), int(9*s)),   # right node
            ]

        pixels.append(row)

    # Draw the PR icon overlay
    s = size / 128.0
    def set_pixel(px_list, px, py, rgba):
        if 0 <= py < size and 0 <= px < size:
            px_list[py][px*4:px*4+4] = list(rgba)

    def draw_circle(px_list, cx2, cy2, radius, rgba):
        for dy2 in range(-int(radius)-1, int(radius)+2):
            for dx2 in range(-int(radius)-1, int(radius)+2):
                if dx2*dx2 + dy2*dy2 <= radius*radius:
                    set_pixel(px_list, int(cx2)+dx2, int(cy2)+dy2, rgba)

    def draw_line(px_list, x0, y0, x1, y1, thickness, rgba):
        # Bresenham with thickness
        dx2 = abs(x1-x0); dy2 = abs(y1-y0)
        steps = max(dx2, dy2, 1)
        for i in range(steps+1):
            t = i / steps
            fx = x0 + t*(x1-x0)
            fy = y0 + t*(y1-y0)
            draw_circle(px_list, fx, fy, thickness/2, rgba)

    if size >= 16:
        lw = max(1, int(7*s))
        nr = max(2, int(9*s))
        white = (255, 255, 255, 255)

        topX = int(42*s); topY = int(32*s)
        botX = int(42*s); botY = int(96*s)
        rtX = int(86*s); rtY = int(50*s)

        draw_line(pixels, topX, topY+nr, botX, botY-nr, lw, white)
        draw_line(pixels, topX+nr, topY, rtX, rtY-nr, lw, white)
        draw_circle(pixels, topX, topY, nr, white)
        draw_circle(pixels, botX, botY, nr, white)
        draw_circle(pixels, rtX, rtY, nr, white)

    # Build PNG IDAT raw data (filter byte 0 = None per scanline)
    raw = b''
    for row in pixels:
        raw += b'\x00' + bytes(row)

    compressed = zlib.compress(raw, 9)

    ihdr_data = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = (
        b'\x89PNG\r\n\x1a\n' +
        chunk('IHDR', ihdr_data) +
        chunk('IDAT', compressed) +
        chunk('IEND', b'')
    )
    return png

os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    data = make_png(size)
    path = f'icons/icon{size}.png'
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Wrote {path} ({len(data)} bytes)')
