# Shared procedural-authoring field toolkit (numeric helpers, periodic noise grids, normals and
# file writers). Copied unchanged from the accepted K1 wall builder
# (d1-walls/proof-2026-09-25/build.py, candidate 20), whose own inline copy stays frozen with its
# accepted source. New builders import this module instead of copying it again.
import json, math, struct, zlib

import numpy as np


# ================================================================= numeric helpers
def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def srgb2lin(c):
    c = np.asarray(c, np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def mix(a, b, w):
    w = np.asarray(w, np.float32)
    if w.ndim and w.shape[-1] != 1:
        w = w[..., None]
    return a * (1 - w) + b * w


class Grid:
    """Periodic Gaussian-filtered noise on an ny x nx texel grid (rows y, columns x)."""

    def __init__(self, ny, nx, px, seed):
        self.ny, self.nx, self.px = ny, nx, px
        self.ky2 = (np.fft.fftfreq(ny, d=px) ** 2).astype(np.float32)[:, None]
        self.kx2 = (np.fft.rfftfreq(nx, d=px) ** 2).astype(np.float32)[None, :]
        self.rng = np.random.default_rng(seed)

    def blur(self, a, sy, sx=None):
        sx = sy if sx is None else sx
        k = np.exp(np.float32(-2 * math.pi ** 2) * (np.float32(sy * sy) * self.ky2 + np.float32(sx * sx) * self.kx2))
        return np.fft.irfft2(np.fft.rfft2(a) * k, s=a.shape).astype(np.float32)

    def noise(self, sy, sx=None):
        w = self.rng.standard_normal((self.ny, self.nx), dtype=np.float32)
        o = self.blur(w, sy, sx)
        o -= o.mean()
        o /= o.std() + 1e-12
        return o

    def fbm(self, pairs):
        o = np.zeros((self.ny, self.nx), np.float32)
        tw = 0.0
        for sig, w in pairs:
            sy, sx = sig if isinstance(sig, tuple) else (sig, sig)
            o += w * self.noise(sy, sx)
            tw += w * w
        return o / math.sqrt(tw)

    def worley(self, cell, jitter=0.9):
        H, W = self.ny * self.px, self.nx * self.px
        ncy, ncx = max(1, int(round(H / cell))), max(1, int(round(W / cell)))
        cy, cx = H / ncy, W / ncx
        P = ((self.rng.random((ncy, ncx, 2), dtype=np.float32) - 0.5) * jitter + 0.5).astype(np.float32)
        u = ((np.arange(self.nx, dtype=np.float32) + 0.5) * self.px / cx)
        v = ((np.arange(self.ny, dtype=np.float32) + 0.5) * self.px / cy)
        iu, iv = np.floor(u).astype(np.int32), np.floor(v).astype(np.int32)
        fu, fv = u - iu, v - iv
        F1 = np.full((self.ny, self.nx), 9.0, np.float32)
        F2 = np.full((self.ny, self.nx), 9.0, np.float32)
        ID = np.zeros((self.ny, self.nx), np.int32)
        for dy in (-1, 0, 1):
            yy = (iv + dy) % ncy
            for dx in (-1, 0, 1):
                xx = (iu + dx) % ncx
                pp = P[yy[:, None], xx[None, :]]
                ddx = (dx + pp[..., 0] - fu[None, :]) * cx
                ddy = (dy + pp[..., 1] - fv[:, None]) * cy
                d = np.sqrt(ddx * ddx + ddy * ddy)
                cid = yy[:, None] * ncx + xx[None, :]
                closer = d < F1
                F2 = np.where(closer, F1, np.minimum(F2, d))
                ID = np.where(closer, cid, ID)
                F1 = np.where(closer, d, F1)
        return F1, F2, ID, ncy * ncx


def tangent_normal(D, px_x, px_y):
    dx = (np.roll(D, -1, 1) - np.roll(D, 1, 1)) / (2 * px_x)
    dy = (np.roll(D, -1, 0) - np.roll(D, 1, 0)) / (2 * px_y)
    nz = 1.0 / np.sqrt(1 + dx * dx + dy * dy)
    return np.stack([-dx * nz, -dy * nz, nz], -1)


# ---------------------------------------------------------------- file writers (from the paving builder)
def dump_json(obj, width=100):
    def scalar(v):
        s = json.dumps(v)
        if isinstance(v, float) and 'e' in s:
            mant, exp = s.split('e')
            s = mant + 'e' + ('-' if exp.startswith('-') else '') + (exp.lstrip('+-').lstrip('0') or '0')
        return s

    def fmt(v, ind, used):
        pad = ' ' * ind
        if isinstance(v, dict):
            if not v:
                return '{}'
            keys = [pad + '  ' + json.dumps(k) + ': ' for k in v]
            return '{\n' + ',\n'.join(k + fmt(x, ind + 2, len(k)) for k, x in zip(keys, v.values())) + '\n' + pad + '}'
        if isinstance(v, list):
            if not v:
                return '[]'
            flat = all(not isinstance(x, (dict, list)) for x in v)
            inner = [scalar(x) for x in v] if flat else [fmt(x, ind + 2, ind + 2) for x in v]
            one = '[' + ', '.join(inner) + ']'
            if '\n' not in one and used + len(one) + 1 <= width:
                return one
            if flat and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v):
                lines, cur = [], ''
                for p in inner:
                    if cur and ind + 2 + len(cur) + 2 + len(p) + 1 > width:
                        lines.append(cur + ',')
                        cur = p
                    else:
                        cur = cur + ', ' + p if cur else p
                return '[\n' + '\n'.join(pad + '  ' + l_ for l_ in lines + [cur]) + '\n' + pad + ']'
            return '[\n' + ',\n'.join(pad + '  ' + s for s in inner) + '\n' + pad + ']'
        return scalar(v)

    return fmt(obj, 0, 0) + '\n'


def write_json(path, obj):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(dump_json(obj))


def write_png(path, arr, bits=8):
    arr = np.asarray(arr)
    h, w = arr.shape[:2]
    ch = 1 if arr.ndim == 2 else arr.shape[2]
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    flip = arr[::-1]  # PNG rows are top-down; row 0 here is v = 0 (bottom)
    if bits == 16:
        data = np.ascontiguousarray(flip.astype('>u2')).reshape(h, w * ch).view(np.uint8)
    else:
        data = np.ascontiguousarray(flip.astype(np.uint8)).reshape(h, w * ch)
    raw = np.concatenate([np.zeros((h, 1), np.uint8), data.reshape(h, -1)], axis=1).tobytes()

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, bits, ctype, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
