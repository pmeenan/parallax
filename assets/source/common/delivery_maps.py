# Shared helpers for kit delivery map stages: exact PNG IO, occupancy-weighted resampling, push-pull
# fill, full normals, horizon AO, mip chains and the maps.json records that pack.mjs reads.
# Copied from the K1 walls delivery's maps.py (d1-walls/proof-2026-09-26/delivery), which keeps its
# own copy so its accepted outputs stay reproducible; the K2 roof delivery imports this module.
# Every array has row 0 at v = 0 (Blender's UV origin); rows flip on the way out.
import hashlib
import math
import os
import struct
import zlib

import numpy as np


def read_png(path, sha256=None):
    """Exact decoder for the builders' PNGs (filter 0, no interlace). Row 0 is v = 0."""
    raw = open(path, 'rb').read()
    if sha256 is not None:
        assert hashlib.sha256(raw).hexdigest() == sha256, path
    p, idat = 8, []
    while p < len(raw):
        ln, = struct.unpack('>I', raw[p:p + 4])
        kind = raw[p + 4:p + 8]
        body = raw[p + 8:p + 8 + ln]
        if kind == b'IHDR':
            w, h, bits, ctype = struct.unpack('>IIBB', body[:10])
        elif kind == b'IDAT':
            idat.append(body)
        p += 12 + ln
    ch = {0: 1, 2: 3, 6: 4}[ctype]
    bpc = bits // 8
    data = np.frombuffer(zlib.decompress(b''.join(idat)), np.uint8).reshape(h, 1 + w * ch * bpc)
    assert (data[:, 0] == 0).all(), 'unexpected PNG filter'
    px = data[:, 1:]
    if bpc == 2:
        px = px.reshape(h, w * ch, 2).astype(np.uint16)
        px = (px[..., 0] << 8) | px[..., 1]
    arr = px.reshape(h, w, ch) if ch > 1 else px.reshape(h, w)
    return arr[::-1]


def srgb2lin(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def write_png(path, arr):
    arr = np.asarray(arr, np.uint8)
    h, w = arr.shape[:2]
    ch = 1 if arr.ndim == 2 else arr.shape[2]
    raw = np.concatenate([np.zeros((h, 1), np.uint8), arr[::-1].reshape(h, -1)], 1).tobytes()

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, {1: 0, 3: 2, 4: 6}[ch], 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


# ---------------------------------------------------------------- resampling
def pool(x, f, w=None):
    """f x f block mean, weighted by w (occupancy) when given; returns (mean, any-weight)."""
    if f == 1:
        return (x, None if w is None else w > 0)
    h, wd = x.shape[:2]
    assert h % f == 0 and wd % f == 0, (x.shape, f)
    shp = (h // f, f, wd // f, f) + x.shape[2:]
    if w is None:
        return x.reshape(shp).mean((1, 3)), None
    ww = w.astype(np.float32).reshape(h // f, f, wd // f, f)
    s = ww.sum((1, 3))
    xs = (x.reshape(shp) * (ww[..., None] if x.ndim == 3 else ww)).sum((1, 3))
    return xs / np.maximum(s, 1e-12)[..., None] if x.ndim == 3 else xs / np.maximum(s, 1e-12), s > 0


def resize(x, h2, w2, wrap=False):
    """Separable linear resample by texel centres (area-preserving enough for small ratios)."""
    def axis(a, n2, ax):
        n = a.shape[ax]
        c = (np.arange(n2) + 0.5) * n / n2 - 0.5
        i0 = np.floor(c).astype(int)
        t = (c - i0).astype(np.float32)
        i1 = i0 + 1
        if wrap:
            i0, i1 = i0 % n, i1 % n
        else:
            i0, i1 = np.clip(i0, 0, n - 1), np.clip(i1, 0, n - 1)
        a0, a1 = np.take(a, i0, ax), np.take(a, i1, ax)
        sh = [1] * a.ndim
        sh[ax] = n2
        return a0 * (1 - t.reshape(sh)) + a1 * t.reshape(sh)
    return axis(axis(x, h2, 0), w2, 1).astype(np.float32)


def to_blocks(x, wrap=False):
    """Block-compressed textures need base dimensions in whole 4 x 4 blocks."""
    h, w = x.shape[:2]
    h2, w2 = -(-h // 4) * 4, -(-w // 4) * 4
    return x if (h2, w2) == (h, w) else resize(x, h2, w2, wrap)


def push_pull(x, known):
    """Fill unknown texels from a known-weighted pyramid, so mips never mix in empty texels."""
    if known.all():
        return x
    levels = [(x, known.astype(np.float32))]
    while min(levels[-1][0].shape[:2]) > 1:
        a, k = levels[-1]
        h, w = a.shape[:2]
        h2, w2 = h - h % 2, w - w % 2
        if h2 == 0 or w2 == 0:
            break
        a, k = a[:h2, :w2], k[:h2, :w2]
        kk = k.reshape(h2 // 2, 2, w2 // 2, 2)
        s = kk.sum((1, 3))
        aa = (a.reshape(h2 // 2, 2, w2 // 2, 2, *a.shape[2:]) * (kk[..., None] if a.ndim == 3 else kk)).sum((1, 3))
        aa = aa / np.maximum(s, 1e-12)[..., None] if a.ndim == 3 else aa / np.maximum(s, 1e-12)
        levels.append((aa.astype(np.float32), np.minimum(s, 1.0)))
    filled = levels[-1][0]
    for a, k in reversed(levels[:-1]):
        up = resize(filled, a.shape[0], a.shape[1])
        kk = k[..., None] if a.ndim == 3 else k
        filled = a * kk + up * (1 - kk)
    return filled.astype(np.float32)


# ---------------------------------------------------------------- normals and AO
def full_normal(H, detail_rgb, pu, pv):
    """Low-pass height slopes (edge-clamped central differences) plus the approved detail normal."""
    Hp = np.pad(H, 1, mode='edge')
    gx = (Hp[1:-1, 2:] - Hp[1:-1, :-2]) / (2 * pu)
    gy = (Hp[2:, 1:-1] - Hp[:-2, 1:-1]) / (2 * pv)
    n = detail_rgb.astype(np.float32) / 127.5 - 1.0
    nz = np.maximum(n[..., 2], 0.05)
    sx = gx - n[..., 0] / nz
    sy = gy - n[..., 1] / nz
    N = np.stack([-sx, -sy, np.ones_like(sx)], -1)
    return (N / np.linalg.norm(N, axis=-1, keepdims=True)).astype(np.float32)


def height_ao(height, ids, pu, pv, radius, directions, steps, wrap=False, falloff=True):
    """Horizon AO of a height field (paving method). Samples on another island (ids differ) or
    past a clamped edge never occlude, so islands do not shade each other. Each direction blocks
    sin^2 of its horizon angle: the cosine-weighted share of sky below it. `falloff` fades
    occluders toward the radius; without it the estimate is the geometric one."""
    blocked = np.zeros_like(height)
    for k in range(directions):
        angle = 2 * math.pi * (k + 0.5) / directions
        horizon = np.zeros_like(height)
        seen = set()
        for s in range(1, steps + 1):
            reach = radius * (s / steps) ** 1.5
            dx = int(round(math.cos(angle) * reach / pu))
            dy = int(round(math.sin(angle) * reach / pv))
            if (dx, dy) == (0, 0) or (dx, dy) in seen:
                continue
            seen.add((dx, dy))
            distance = math.hypot(dx * pu, dy * pv)
            if wrap:
                other = np.roll(height, (-dy, -dx), (0, 1))
                same = True if ids is None else np.roll(ids, (-dy, -dx), (0, 1)) == ids
            else:
                hp = np.pad(height, ((abs(dy), abs(dy)), (abs(dx), abs(dx))), mode='edge')
                other = hp[abs(dy) + dy:abs(dy) + dy + height.shape[0], abs(dx) + dx:abs(dx) + dx + height.shape[1]]
                if ids is None:
                    same = True
                else:
                    ip = np.pad(ids, ((abs(dy), abs(dy)), (abs(dx), abs(dx))), mode='constant', constant_values=-2)
                    same = ip[abs(dy) + dy:abs(dy) + dy + height.shape[0], abs(dx) + dx:abs(dx) + dx + height.shape[1]] == ids
            rise = np.where(same, np.maximum(other - height, 0), 0)
            sine2 = rise * rise / (rise * rise + distance * distance)
            horizon = np.maximum(horizon, sine2 * (1 - (distance / radius) ** 2) if falloff else sine2)
        blocked += horizon
    return (1 - blocked / directions).astype(np.float32)


# ---------------------------------------------------------------- mip chains and records
def reduce2(x):
    h, w = x.shape[:2]
    if h == 1 and w == 1:
        return x
    if h == 1:
        w2 = w - w % 2
        return 0.5 * (x[:, 0:w2:2] + x[:, 1:w2:2])
    if w == 1:
        h2 = h - h % 2
        return 0.5 * (x[0:h2:2] + x[1:h2:2])
    h2, w2 = h - h % 2, w - w % 2
    x = x[:h2, :w2]
    return 0.25 * (x[0::2, 0::2] + x[1::2, 0::2] + x[0::2, 1::2] + x[1::2, 1::2])


def chain(level0, encode):
    lv = [level0]
    while lv[-1].shape[0] > 1 or lv[-1].shape[1] > 1:
        lv.append(reduce2(lv[-1]))
    return [encode(x) for x in lv]


def enc_color(x):
    return np.concatenate([np.round(lin2srgb(x) * 255), np.full(x.shape[:2] + (1,), 255)], -1).astype(np.uint8)


def enc_normal(x):
    n = x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-6)
    return np.concatenate([np.round((n * 0.5 + 0.5) * 255), np.full(x.shape[:2] + (1,), 255)], -1).astype(np.uint8)


def enc_orm(x):
    rgb = np.round(np.clip(x, 0, 1) * 255)
    return np.concatenate([rgb, np.full(x.shape[:2] + (1,), 255)], -1).astype(np.uint8)


class Emitter:
    """Writes mip chains under <out>/mips and collects the maps.json records and material facts."""

    def __init__(self, out):
        self.out = out
        self.records = []
        self.materials = {}
        os.makedirs(os.path.join(out, 'mips'), exist_ok=True)

    def emit(self, material, slot, level0, note, **extra):
        enc = {'basecolor': enc_color, 'normal': enc_normal, 'orm': enc_orm, 'detail': enc_orm}[slot]
        role = '%s-%s' % (material, slot)
        files = []
        for lv, rgba in enumerate(chain(level0, enc)):
            path = os.path.join(self.out, 'mips', '%s-%02d.rgba' % (role, lv))
            data = np.ascontiguousarray(rgba[::-1]).tobytes()  # KTX2 rows are top-down
            with open(path, 'wb') as f:
                f.write(data)
            files.append(dict(file='mips/' + os.path.basename(path), width=rgba.shape[1], height=rgba.shape[0],
                              sha256=hashlib.sha256(data).hexdigest()))
            if lv == 0 and max(rgba.shape[:2]) <= 8192:
                write_png(os.path.join(self.out, role + '.png'), rgba[..., :3])
        self.records.append(dict(material=material, slot=slot, role=role, srgb=slot == 'basecolor', note=note,
                                 levels=files, **extra))
        print('emit', role, level0.shape[1], 'x', level0.shape[0], flush=True)

    def orm(self, material, occlusion, rough, height, note, texel_mm, address='clamp-to-edge', metallic=0.0):
        if height is None:
            # Lite multiplies the metallic factor by ORM.B; surfaces without height carry 1 there.
            orm_b, extra = np.full_like(rough, 1.0 if metallic > 0 else 0.0), {}
        else:
            lo, hi = float(height.min()), float(height.max())
            orm_b, extra = (height - lo) / (hi - lo), dict(ormHeightRangeMetres=[lo, hi])
        self.emit(material, 'orm', np.stack([occlusion, rough, orm_b], -1), note, **extra)
        ao = dict(mean=float(occlusion.mean()), p01=float(np.percentile(occlusion, 1)),
                  minimum=float(occlusion.min()))
        self.materials[material] = dict(self.materials.get(material, {}), ormTexelMm=texel_mm,
                                        textureAddressMode=address, ambientOcclusion=ao, **extra)
