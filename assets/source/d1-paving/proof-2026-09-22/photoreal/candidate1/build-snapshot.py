# Photoreal D1 cobble paving — procedural tileable source.
# Run: blender -b --factory-startup --python build.py -- --out candidateN [--save-blend] [--views ...]
import argparse, hashlib, json, math, os, struct, sys, time, zlib

import bmesh
import bpy
import numpy as np
from mathutils import Vector, noise as mnoise

T0 = time.perf_counter()


def log(*a):
    print('[pav %6.1fs]' % (time.perf_counter() - T0), *a, flush=True)


argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--res', type=int, default=4096)
ap.add_argument('--grid', type=int, default=200)
ap.add_argument('--subdiv', type=int, default=3)
ap.add_argument('--samples', type=int, default=128)
ap.add_argument('--views', default='walking')
ap.add_argument('--scale', type=float, default=1.0)
ap.add_argument('--seed', type=int, default=11)
ap.add_argument('--save-blend', action='store_true')
ap.add_argument('--force', action='store_true')
ap.add_argument('--sunk', type=float, default=1.0)
ap.add_argument('--skyk', type=float, default=1.0)
A = ap.parse_args(argv)
OUT = os.path.abspath(A.out)
if os.path.isdir(OUT) and os.listdir(OUT) and not A.force:
    sys.exit('refusing to overwrite existing output %s (use --force)' % OUT)
os.makedirs(OUT, exist_ok=True)
MAPS = os.path.join(OUT, 'maps')
os.makedirs(MAPS, exist_ok=True)

TILE = 4.0
N = A.res
PX = TILE / N
_sc = [A.seed * 1000]


def nseed():
    _sc[0] += 1
    return _sc[0]


RNG = np.random.default_rng(A.seed)

# ---------------------------------------------------------------- noise helpers (all periodic on the tile)
KX = np.fft.rfftfreq(N, d=PX).astype(np.float32)
KY = np.fft.fftfreq(N, d=PX).astype(np.float32)
K2 = (KY[:, None] ** 2 + KX[None, :] ** 2).astype(np.float32)


def _gk(sigma):
    return np.exp(np.float32(-2.0 * math.pi ** 2 * sigma * sigma) * K2)


def blur(a, sigma):
    return np.fft.irfft2(np.fft.rfft2(a) * _gk(sigma), s=a.shape).astype(np.float32)


def gnoise(sigma):
    w = np.random.default_rng(nseed()).standard_normal((N, N), dtype=np.float32)
    o = blur(w, sigma)
    o -= o.mean()
    o /= o.std() + 1e-12
    return o


def fbm(pairs):
    o = np.zeros((N, N), np.float32)
    tw = 0.0
    for s, w in pairs:
        o += w * gnoise(s)
        tw += w * w
    return o / math.sqrt(tw)


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def worley(cell_m, jitter=0.9):
    r = np.random.default_rng(nseed())
    n = max(2, int(round(TILE / cell_m)))
    c = TILE / n
    P = ((r.random((n, n, 2), dtype=np.float32) - 0.5) * jitter + 0.5).astype(np.float32)
    u = ((np.arange(N, dtype=np.float32) + 0.5) * PX / c).astype(np.float32)
    iu = np.floor(u).astype(np.int32)
    fu = (u - iu).astype(np.float32)
    F1 = np.full((N, N), 9.0, np.float32)
    F2 = np.full((N, N), 9.0, np.float32)
    ID = np.zeros((N, N), np.int32)
    for dy in (-1, 0, 1):
        cy = (iu + dy) % n
        for dx in (-1, 0, 1):
            cx = (iu + dx) % n
            pp = P[cy[:, None], cx[None, :]]
            ddx = dx + pp[..., 0] - fu[None, :]
            ddy = dy + pp[..., 1] - fu[:, None]
            d = np.sqrt(ddx * ddx + ddy * ddy)
            cid = cy[:, None] * n + cx[None, :]
            closer = d < F1
            F2 = np.where(closer, F1, np.minimum(F2, d))
            ID = np.where(closer, cid, ID)
            F1 = np.where(closer, d, F1)
    return F1 * c, F2 * c, ID, n * n


def srgb2lin(c):
    c = np.asarray(c, np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


# ---------------------------------------------------------------- PNG writer (exact bytes, no colour management)
def write_png(path, arr, bits=8):
    arr = np.asarray(arr)
    h, w = arr.shape[:2]
    ch = 1 if arr.ndim == 2 else arr.shape[2]
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    flip = arr[::-1]  # PNG rows are top-down; our row 0 is y=0 (bottom)
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


# ================================================================= 1. layout (periodic coursed setts)
def make_layout(rng):
    depths = []
    y = 0.0
    while True:
        d = rng.uniform(0.24, 0.36)
        if y + d > TILE - 0.1:
            break
        depths.append(d)
        y += d
    depths = np.array(depths) * (TILE / sum(depths))
    rects = []
    prev = first = None

    def mind(a, b):
        dd = np.abs(a[:, None] - b[None, :])
        return np.minimum(dd, TILE - dd).min()

    y0 = 0.0
    for ci, d in enumerate(depths):
        best = None
        for _ in range(400):
            start = rng.uniform(0, TILE)
            Ls = []
            tot = 0.0
            while tot < TILE - 0.2:
                L = rng.uniform(0.24, 0.52) if rng.random() < 0.82 else rng.uniform(0.17, 0.24)
                Ls.append(L)
                tot += L
            Ls = np.array(Ls) * (TILE / tot)
            joints = (start + np.concatenate([[0.0], np.cumsum(Ls)[:-1]])) % TILE
            sc = mind(joints, prev) if prev is not None else 1.0
            if ci == len(depths) - 1 and first is not None:
                sc = min(sc, mind(joints, first))
            if best is None or sc > best[0]:
                best = (sc, start, Ls, joints)
            if sc > 0.085:
                break
        sc, start, Ls, joints = best
        if prev is None:
            first = joints
        prev = joints
        x = start
        for L in Ls:
            r = rng.random()
            if r < 0.07 and L > 0.3:  # 2x2 small setts
                fx, fy = rng.uniform(0.42, 0.58), rng.uniform(0.42, 0.58)
                rects += [(x, y0, L * fx, d * fy), (x + L * fx, y0, L * (1 - fx), d * fy),
                          (x, y0 + d * fy, L * fx, d * (1 - fy)), (x + L * fx, y0 + d * fy, L * (1 - fx), d * (1 - fy))]
            elif r < 0.17 and L > 0.36:  # split along course
                f = rng.uniform(0.38, 0.62)
                rects += [(x, y0, L * f, d), (x + L * f, y0, L * (1 - f), d)]
            elif r < 0.24 and L < 0.34:  # two half-depth pieces
                f = rng.uniform(0.44, 0.56)
                rects += [(x, y0, L, d * f), (x, y0 + d * f, L, d * (1 - f))]
            else:
                rects.append((x, y0, L, d))
            x += L
        y0 += d
    return rects


PH = RNG.uniform(0, 2 * math.pi, 4)


def warp(x, y):
    # gentle periodic bend so courses are not ruler-straight
    return (x + 0.035 * math.sin(2 * math.pi * y / TILE + PH[0]) + 0.012 * math.sin(4 * math.pi * y / TILE + PH[1]),
            y + 0.03 * math.sin(2 * math.pi * x / TILE + PH[2]) + 0.01 * math.sin(4 * math.pi * x / TILE + PH[3]))


PALETTE = [  # sRGB base tones for limestone (cream, warm tan, light grey-beige, ochre-cream, pale)
    (196, 178, 146), (186, 164, 128), (178, 168, 150), (198, 174, 134), (206, 190, 160), (168, 150, 120)]
PAL_W = np.array([0.28, 0.2, 0.16, 0.16, 0.1, 0.1])


def make_stones(rects, rng):
    stones = []
    for (x, y, w, h) in rects:
        gl, gr, gb, gt = rng.uniform(0.005, 0.014, 4)
        c = np.array([[x + gl, y + gb], [x + w - gr, y + gb], [x + w - gr, y + h - gt], [x + gl, y + h - gt]])
        c += rng.normal(0, 0.0035, (4, 2))
        ctr = c.mean(0)
        a = rng.normal(0, 0.012)
        R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
        c = (c - ctr) @ R.T + ctr
        c = np.array([warp(*p) for p in c])
        mn = min(w, h)
        pal = rng.choice(len(PALETTE), p=PAL_W)
        stones.append(dict(
            corners=c.tolist(),
            r=float(min(rng.uniform(0.012, 0.035), 0.3 * mn)),
            z0=float(rng.normal(0, 0.0022)),
            tilt=rng.normal(0, 0.006, 2).tolist(),
            R=float(rng.uniform(0.006, 0.014)),
            crown=float(rng.uniform(0.0, 0.0008)),
            pal=int(pal),
            bright=float(rng.normal(1.0, 0.05)),
            patch=float(rng.uniform(-1.1, 0.8)),
            pscale=float(rng.random()),
            pits=float(rng.uniform(0.25, 1.3)),
            chips=float(rng.uniform(0.2, 1.0)),
            cracks=float(rng.random() < 0.3),
        ))
    return stones


def inset_poly(C, r):
    n = len(C)
    out = []
    for i in range(n):
        a0, b0 = C[i - 1], C[i]
        a1, b1 = C[i], C[(i + 1) % n]
        e0 = (b0 - a0) / np.linalg.norm(b0 - a0)
        e1 = (b1 - a1) / np.linalg.norm(b1 - a1)
        n0 = np.array([-e0[1], e0[0]])
        n1 = np.array([-e1[1], e1[0]])
        M = np.array([n0, n1])
        rhs = np.array([n0 @ a0 + r, n1 @ a1 + r])
        out.append(np.linalg.solve(M, rhs))
    return np.array(out)


def poly_sdf(X, Y, Q):
    d2 = np.full(X.shape, 1e9, np.float32)
    inside = np.ones(X.shape, bool)
    for i in range(len(Q)):
        ax, ay = Q[i]
        bx, by = Q[(i + 1) % len(Q)]
        ex, ey = bx - ax, by - ay
        wx, wy = X - ax, Y - ay
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1)
        dx, dy = wx - ex * t, wy - ey * t
        d2 = np.minimum(d2, dx * dx + dy * dy)
        inside &= (ex * wy - ey * wx) > 0
    d = np.sqrt(d2)
    return np.where(inside, -d, d).astype(np.float32)


# ================================================================= 2. fields
t_layout = time.perf_counter()
rects = make_layout(RNG)
stones = make_stones(rects, RNG)
log('layout', len(stones), 'stones')

F_out = fbm([(0.012, 1.0), (0.004, 0.45)])          # outline wobble
F_R = sstep(-1.5, 1.5, gnoise(0.02))                 # shoulder radius modulation 0..1
F_und = fbm([(0.035, 1.0), (0.012, 0.35)])           # broad top undulation
F_chip = fbm([(0.007, 1.0), (0.0025, 0.35)])         # spall regions
F_side = fbm([(0.003, 1.0), (0.0012, 0.5)])          # rough split sides
F_shoulder = fbm([(0.004, 1.0), (0.0018, 0.6), (0.0008, 0.35)])  # chunky edge erosion

ZST = np.full((N, N), -1.0, np.float32)
SID = np.full((N, N), -1, np.int32)
DIN = np.full((N, N), -1.0, np.float32)
SDFMIN = np.full((N, N), 1.0, np.float32)
TOPREF = np.zeros((N, N), np.float32)
CHIP = np.zeros((N, N), np.float32)

for si, s in enumerate(stones):
    C = np.array(s['corners'])
    Q = inset_poly(C, s['r'])
    mnx, mny = C.min(0) - 0.035
    mxx, mxy = C.max(0) + 0.035
    j0, j1 = int(math.floor(mnx / PX)), int(math.ceil(mxx / PX))
    i0, i1 = int(math.floor(mny / PX)), int(math.ceil(mxy / PX))
    cols = np.arange(j0, j1)
    rows = np.arange(i0, i1)
    X = ((cols + 0.5) * PX).astype(np.float32)[None, :]
    Y = ((rows + 0.5) * PX).astype(np.float32)[:, None]
    X, Y = np.broadcast_to(X, (len(rows), len(cols))), np.broadcast_to(Y, (len(rows), len(cols)))
    ix = np.ix_(rows % N, cols % N)
    sd = poly_sdf(X, Y, Q) - s['r'] + F_out[ix] * 0.0028
    din = -sd
    Rl = s['R'] * (0.55 + 0.9 * F_R[ix])
    t = np.clip(din / Rl, 0, 1)
    drop_in = Rl * (1 - np.sqrt(np.clip(1 - (1 - t) ** 2, 0, 1)))
    drop = np.where(din >= 0, drop_in, Rl + (-din) * 2.2)
    ctr = C.mean(0)
    # local frame along first edge for crown
    e = C[1] - C[0]
    e /= np.linalg.norm(e)
    lx = (X - ctr[0]) * e[0] + (Y - ctr[1]) * e[1]
    ly = -(X - ctr[0]) * e[1] + (Y - ctr[1]) * e[0]
    hx = 0.5 * np.linalg.norm(C[1] - C[0])
    hy = 0.5 * np.linalg.norm(C[3] - C[0])
    top = (s['z0'] + s['tilt'][0] * (X - ctr[0]) + s['tilt'][1] * (Y - ctr[1])
           - s['crown'] * ((lx / hx) ** 2 + (ly / hy) ** 2) + 0.0017 * F_und[ix])
    edge = 1 - sstep(0.004, 0.045, din)
    ext = 0.012 + 0.018 * F_R[ix]
    chip = sstep(0.5, 0.64, F_chip[ix] + 0.9 * edge - 0.9 + 0.35 * s['chips']) * (1 - sstep(0.0, ext, din))
    side = 1 - sstep(-0.002, 0.006, din)
    shoulder = np.clip(1 - din / (1.6 * Rl), 0, 1)
    z = (top - drop - chip * (0.002 + 0.0025 * sstep(0.3, 1.5, F_chip[ix])) + side * 0.0012 * F_side[ix]
         + shoulder * 0.0009 * F_shoulder[ix])
    cur = ZST[ix]
    win = z > cur
    ZST[ix] = np.where(win, z, cur)
    SID[ix] = np.where(win, si, SID[ix])
    DIN[ix] = np.where(win, din, DIN[ix])
    TOPREF[ix] = np.where(win, top, TOPREF[ix])
    CHIP[ix] = np.where(win, chip, CHIP[ix])
    SDFMIN[ix] = np.minimum(SDFMIN[ix], sd)
log('stones rasterised')

# per-stone parameter lookups
def lut(key, default=0.0):
    arr = np.array([s[key] for s in stones] + [default], np.float32)
    return arr[SID]  # SID -1 -> last element (default)


P_pits = lut('pits')
P_patch = lut('patch')
P_bright = lut('bright', 1.0)
P_cracks = lut('cracks')

# ---- pits (three scales, irregular)
PIT = np.zeros((N, N), np.float32)
pit_warp = gnoise(0.0015)
for cell, prob, rmax, dk in [(0.0045, 0.35, 0.0011, 0.55), (0.013, 0.2, 0.0028, 0.5), (0.045, 0.1, 0.006, 0.3)]:
    F1, F2, ID, nc = worley(cell)
    rr = np.random.default_rng(nseed()).random(nc).astype(np.float32)
    ex = np.random.default_rng(nseed()).random(nc).astype(np.float32)
    rad = rmax * (0.3 + 0.7 * rr[ID] ** 2)
    exist = ex[ID] < prob * P_pits
    d = F1 * (1 + 0.28 * pit_warp)
    prof = np.clip(1 - (d / rad) ** 2, 0, 1) ** 0.7
    PIT = np.minimum(PIT, np.where(exist, -dk * rad * prof, 0))
    del F1, F2, ID
topmask = sstep(0.002, 0.012, DIN) * (SID >= 0)
PIT *= topmask
log('pits')

# ---- granular mineral grain
G1, G2, GID, gnc = worley(0.0026)
gval = np.random.default_rng(nseed()).random(gnc).astype(np.float32)
GRAIN_V = gval[GID]
GRAIN_EDGE = 1 - sstep(0.0, 0.00045, G2 - G1)
del G1, G2, GID
C1, C2, CID, cnc = worley(0.0065)
cval = np.random.default_rng(nseed()).random(cnc).astype(np.float32)
CLAST_V = cval[CID]
CLAST_EDGE = 1 - sstep(0.0, 0.0007, C2 - C1)
del C1, C2, CID
GRAIN_H = (0.00012 * (GRAIN_V - 0.5) - 0.0001 * GRAIN_EDGE + 0.00014 * (CLAST_V - 0.5) - 0.00008 * CLAST_EDGE
           + 0.00008 * gnoise(0.0008) + 0.00025 * gnoise(0.003))

# ---- hairline cracks on some stones
CR = np.abs(fbm([(0.02, 1.0), (0.006, 0.3)]))
CRACK = (1 - sstep(0.0, 0.05, CR)) * P_cracks * sstep(0.0, 0.3, gnoise(0.08)) * topmask

ZST_f = ZST + PIT + (GRAIN_H * (SID >= 0)) - CRACK * 0.0006
del ZST

# ---- soil in joints
F_jd = gnoise(0.12)
# soil level follows the local stone-top level so low-set stones are not flooded
_m = (SID >= 0).astype(np.float32)
LTOP = blur(TOPREF * _m, 0.03) / np.maximum(blur(_m, 0.03), 1e-3)
soil = (LTOP - 0.009 - 0.0022 * F_jd + 0.0015 * fbm([(0.02, 1.0), (0.006, 0.5)])
        + 0.0035 * np.exp(-np.clip(SDFMIN, 0, None) / 0.005))
soil = np.minimum(soil, LTOP - 0.0038)
# granular crumbs in soil
S1, S2, SIDc, snc = worley(0.0026)
sval = np.random.default_rng(nseed()).random(snc).astype(np.float32)
SOIL_V = sval[SIDc]
soil += 0.0008 * (1 - sstep(0.0, 0.0012, S1)) * (SOIL_V > 0.3) * (0.5 + SOIL_V) + 0.0004 * gnoise(0.0012) + 0.0006 * gnoise(0.004)
SOIL_EDGE = 1 - sstep(0.0, 0.00035, S2 - S1)
del S1, S2, SIDc

# ---- moss colonies (in shaded-ish joints, creeping up stone feet)
F_mossp = gnoise(0.18)
near = np.exp(-np.clip(SDFMIN, 0, None) / 0.012)
MOSS = sstep(1.35, 1.8, F_mossp + 0.3 * gnoise(0.02)) * np.clip(near * 1.4, 0, 1)
moss_h = MOSS * (0.0012 + 0.0011 * np.clip(fbm([(0.0012, 1.0), (0.0005, 0.6)]), -1, 2))
soil_m = soil + moss_h

H = np.maximum(ZST_f, soil_m)
STONEV = ZST_f > soil_m
# moss may creep over low stone feet
foot = sstep(0.0, 0.004, ZST_f - soil)
MOSS_ON_STONE = MOSS * (1 - foot) * STONEV
log('height done', float(H.min()), float(H.max()))

# ================================================================= 3. albedo / roughness
pal = srgb2lin(np.array(PALETTE))
pal_idx = np.array([s['pal'] for s in stones] + [0])
BASE = pal[pal_idx[SID]] * P_bright[..., None]

# broad grey/dark weathering patches with ragged granular boundary
patch_big = fbm([(0.045, 1.0), (0.015, 0.5)])
patch_small = fbm([(0.018, 1.0), (0.006, 0.5)])
P_pscale = lut('pscale')
patchf = (patch_big * (1 - P_pscale) + patch_small * P_pscale + P_patch
          + 1.3 * (CLAST_V - 0.5) + 0.6 * (GRAIN_V - 0.5))
PATCH = sstep(0.15, 0.32, patchf)
grey_a = srgb2lin((110, 104, 94))
grey_b = srgb2lin((90, 86, 78))
greyv = sstep(-1, 1, gnoise(0.05))[..., None]
GREY = grey_a * (1 - greyv) + grey_b * greyv
col = BASE * (1 - PATCH[..., None] * 0.85) + GREY * (PATCH[..., None] * 0.85)
# fine granular variation (crystals / clasts)
col *= ((0.88 + 0.22 * GRAIN_V) * (1 - 0.1 * GRAIN_EDGE) * (0.8 + 0.36 * CLAST_V) * (1 - 0.2 * CLAST_EDGE))[..., None]
speck = np.random.default_rng(nseed()).random((N, N), dtype=np.float32)
col = np.where((speck < 0.004)[..., None], col * 0.45, col)
col = np.where((speck > 0.994)[..., None], np.minimum(col * 1.35, 0.85), col)
# subtle warm iron staining
iron = sstep(0.9, 1.8, fbm([(0.05, 1.0), (0.015, 0.5)]))
col = col * (1 - 0.25 * iron[..., None]) + srgb2lin((170, 130, 80)) * 0.25 * iron[..., None]
# dirt in pits and cracks
pitd = sstep(0.0002, 0.0018, -PIT)
dirt = srgb2lin((84, 68, 52))
col = col * (1 - 0.4 * pitd[..., None]) + dirt * 0.4 * pitd[..., None]
col = col * (1 - 0.55 * CRACK[..., None]) + dirt * 0.55 * CRACK[..., None]
# fresh chips are paler, sides slightly warmer
col = col * (1 + 0.18 * CHIP[..., None])
sidef = (1 - sstep(-0.002, 0.008, DIN))[..., None]
col = col * (1 - 0.25 * sidef) + srgb2lin((150, 128, 96)) * 0.25 * sidef
# soil staining creeping up the stone foot
stain = (1 - sstep(0.0, 0.0035, ZST_f - soil))[..., None]
col = col * (1 - 0.5 * stain) + srgb2lin((96, 76, 56)) * 0.5 * stain
# cavity occlusion baked lightly
cav = np.clip(blur(H, 0.004) - H, 0, None)
col *= (1 - np.clip(cav / 0.006, 0, 0.25))[..., None]
# worn high points slightly paler
worn = sstep(0.0, 0.0015, H - blur(H, 0.02)) * (SID >= 0)
col *= (1 + 0.06 * worn)[..., None]
STONE_COL = col
del col, BASE, GREY

# soil colour
sa = srgb2lin((50, 37, 26))
sb = srgb2lin((92, 72, 52))
sc_ = srgb2lin((52, 38, 27))
dry = sstep(-0.8, 1.2, fbm([(0.03, 1.0), (0.008, 0.6)]))[..., None]
SCOL = sa * (1 - dry) + sb * dry
dampf = sstep(0.6, 1.6, gnoise(0.1))[..., None]
SCOL = SCOL * (1 - 0.4 * dampf) + sc_ * 0.4 * dampf
SCOL *= (0.82 + 0.36 * SOIL_V)[..., None] * (1 - 0.3 * SOIL_EDGE)[..., None]
# painted micro-grit
g2 = np.random.default_rng(nseed()).random((N, N), dtype=np.float32)
pale_grit = blur((g2 > 0.993).astype(np.float32), 0.0004)
pale_grit = np.clip(pale_grit / (pale_grit.max() + 1e-6) * 1.4, 0, 0.8)[..., None]
SCOL = SCOL * (1 - pale_grit) + srgb2lin((170, 158, 136)) * pale_grit
# joint soil deeper = darker
deep = sstep(-0.004, 0.006, -(soil - (-0.0115)))[..., None]
SCOL *= (1 - 0.25 * deep)
# moss colour
mv = sstep(-1.2, 1.2, fbm([(0.004, 1.0), (0.0012, 0.8)]))[..., None]
MCOL = srgb2lin((58, 72, 28)) * (1 - mv) + srgb2lin((104, 120, 44)) * mv
mossmix = np.clip(MOSS * sstep(0.0, 0.0006, moss_h) * (~STONEV) + MOSS_ON_STONE, 0, 1)[..., None]

ALB = np.where(STONEV[..., None], STONE_COL, SCOL)
ALB = ALB * (1 - mossmix) + MCOL * mossmix
del STONE_COL, SCOL

ROUGH = np.where(STONEV, 0.8 - 0.1 * worn + 0.12 * pitd - 0.05 * GRAIN_V, 0.95)
ROUGH = np.where(mossmix[..., 0] > 0.5, 0.9, ROUGH)
ROUGH = np.clip(ROUGH, 0.3, 1.0)
log('albedo done')

# ================================================================= 4. mesh-level height + detail normal
spacing = TILE / (A.grid * 2 ** A.subdiv)
H_low = blur(H, 0.55 * spacing)
D = H - H_low
dDx = (np.roll(D, -1, 1) - np.roll(D, 1, 1)) / (2 * PX)
dDy = (np.roll(D, -1, 0) - np.roll(D, 1, 0)) / (2 * PX)
nz = 1.0 / np.sqrt(1 + dDx * dDx + dDy * dDy)
NRM = np.stack([-dDx * nz, -dDy * nz, nz], -1)
hmin, hmax = float(H_low.min()), float(H_low.max())

write_png(os.path.join(MAPS, 'albedo.png'), np.round(lin2srgb(ALB) * 255), 8)
write_png(os.path.join(MAPS, 'roughness.png'), np.round(ROUGH * 255), 8)
write_png(os.path.join(MAPS, 'normal.png'), np.round((NRM * 0.5 + 0.5) * 255), 8)
write_png(os.path.join(MAPS, 'height.png'), np.round((H_low - hmin) / (hmax - hmin) * 65535), 16)
log('maps written')

# scatter data before freeing
SOILV = ~STONEV
soil_depth_for = soil_m


def sample(arr, x, y):
    j = np.floor(x / PX).astype(int) % N
    i = np.floor(y / PX).astype(int) % N
    return arr[i, j]


def sample_bilinear(arr, x, y):
    u = x / PX - 0.5
    v = y / PX - 0.5
    j0 = np.floor(u).astype(int)
    i0 = np.floor(v).astype(int)
    fu = u - j0
    fv = v - i0
    j0 %= N
    i0 %= N
    j1 = (j0 + 1) % N
    i1 = (i0 + 1) % N
    return (arr[i0, j0] * (1 - fu) * (1 - fv) + arr[i0, j1] * fu * (1 - fv)
            + arr[i1, j0] * (1 - fu) * fv + arr[i1, j1] * fu * fv)


# joint-visibility margin: distance to stones
soil_clear = blur(SOILV.astype(np.float32), 0.0015)

# ================================================================= 5. Blender scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
scene = bpy.context.scene
tile_coll = bpy.data.collections.new('PavingTile')
scene.collection.children.link(tile_coll)


def load_img(name, colorspace):
    img = bpy.data.images.load(os.path.join(MAPS, name), check_existing=False)
    img.colorspace_settings.name = colorspace
    return img


img_alb = load_img('albedo.png', 'sRGB')
img_rgh = load_img('roughness.png', 'Non-Color')
img_nrm = load_img('normal.png', 'Non-Color')
img_hgt = load_img('height.png', 'Non-Color')

# ground mesh: coarse grid -> simple subdivision -> displacement from height map
g = A.grid
xs = np.linspace(0, TILE, g + 1)
XX, YY = np.meshgrid(xs, xs)
verts = np.stack([XX.ravel(), YY.ravel(), np.zeros(XX.size)], 1)
idx = np.arange((g + 1) * (g + 1)).reshape(g + 1, g + 1)
faces = np.stack([idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()], 1)
me = bpy.data.meshes.new('PavingGround')
me.from_pydata(verts.tolist(), [], faces.tolist())
uv = me.uv_layers.new(name='UVMap')
loop_v = np.zeros(len(me.loops), np.int32)
me.loops.foreach_get('vertex_index', loop_v)
uvs = verts[loop_v, :2] / TILE
uv.data.foreach_set('uv', uvs.astype(np.float32).ravel())
me.shade_smooth()
ground = bpy.data.objects.new('PavingGround', me)
tile_coll.objects.link(ground)
ground.location.z = hmin
m = ground.modifiers.new('Subdiv', 'SUBSURF')
m.subdivision_type = 'SIMPLE'
m.levels = m.render_levels = A.subdiv
tex = bpy.data.textures.new('PavingHeight', 'IMAGE')
tex.image = img_hgt
tex.extension = 'EXTEND'
tex.use_interpolation = True
m = ground.modifiers.new('Displace', 'DISPLACE')
m.texture = tex
m.texture_coords = 'UV'
m.direction = 'Z'
m.mid_level = 0.0
m.strength = hmax - hmin


def new_mat(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    return mat, nt.nodes, nt.links, nt.nodes['Material Output']


mat, nn, ll, mo = new_mat('PavingGround')
bs = nn.new('ShaderNodeBsdfPrincipled')
ta = nn.new('ShaderNodeTexImage'); ta.image = img_alb; ta.interpolation = 'Cubic'
tr = nn.new('ShaderNodeTexImage'); tr.image = img_rgh
tn = nn.new('ShaderNodeTexImage'); tn.image = img_nrm; tn.interpolation = 'Cubic'
nm = nn.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'
ll.new(ta.outputs['Color'], bs.inputs['Base Color'])
ll.new(tr.outputs['Color'], bs.inputs['Roughness'])
ll.new(tn.outputs['Color'], nm.inputs['Color'])
ll.new(nm.outputs['Normal'], bs.inputs['Normal'])
ll.new(bs.outputs[0], mo.inputs['Surface'])
me.materials.append(mat)
GROUND = dict(mat=mat, bs=bs, ta=ta, mo=mo, nn=nn, ll=ll)
log('ground built')

# ---------------------------------------------------------------- grit / pebbles (GN instances)
var_coll = bpy.data.collections.new('GritVariants')
NV = 24
vrng = np.random.default_rng(nseed())
for k in range(NV):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.5)
    ax = np.array([1.0, vrng.uniform(0.6, 0.95), vrng.uniform(0.4, 0.75)])
    angular = k % 2 == 0
    planes = [(Vector(vrng.normal(0, 1, 3)).normalized(), vrng.uniform(0.18, 0.36)) for _ in range(vrng.integers(4, 8))]
    off = Vector(vrng.uniform(-50, 50, 3))
    for v in bm.verts:
        p = Vector((v.co.x * ax[0], v.co.y * ax[1], v.co.z * ax[2]))
        p += p.normalized() * 0.07 * mnoise.noise(p * 2.5 + off)
        p += p.normalized() * 0.025 * mnoise.noise(p * 7.0 + off)
        if angular:
            for nrm, o in planes:
                d = p.dot(nrm) - o
                if d > 0:
                    p -= nrm * d
        v.co = p
    gm = bpy.data.meshes.new('grit_%02d' % k)
    bm.to_mesh(gm)
    bm.free()
    if not angular:
        gm.shade_smooth()
    go = bpy.data.objects.new('grit_%02d' % k, gm)
    var_coll.objects.link(go)

# points
area_soil = float(SOILV.mean()) * TILE * TILE
target = int(area_soil * 20000)
cand = vrng.random((target * 6, 2)) * TILE
keep = sample(soil_clear, cand[:, 0], cand[:, 1]) > 0.4
cl = sstep(-0.8, 1.2, gnoise(0.05))
keep &= vrng.random(len(cand)) < (0.35 + 0.65 * sample(cl, cand[:, 0], cand[:, 1]))
pts = cand[keep][:target]
npts = len(pts)
u = vrng.random(npts)
size = np.where(u < 0.7, vrng.uniform(0.0025, 0.006, npts),
                np.where(u < 0.96, vrng.uniform(0.0055, 0.011, npts), vrng.uniform(0.011, 0.019, npts)))
flat = vrng.uniform(0.55, 1.0, npts)
scl = np.stack([size, size * vrng.uniform(0.8, 1.1, npts), size * flat], 1)
rot = np.stack([vrng.normal(0, 0.25, npts), vrng.normal(0, 0.25, npts), vrng.uniform(0, 2 * math.pi, npts)], 1)
zs = sample_bilinear(soil_depth_for, pts[:, 0], pts[:, 1]) - vrng.uniform(0.0, 0.16, npts) * size * flat
tints_srgb = np.array([(190, 180, 158), (160, 150, 130), (136, 126, 108), (116, 110, 100), (146, 116, 84), (96, 82, 66), (64, 55, 46), (206, 198, 180)])
tw = np.array([0.16, 0.18, 0.16, 0.14, 0.12, 0.1, 0.08, 0.06])
ti = vrng.choice(len(tints_srgb), npts, p=tw)
tint = srgb2lin(tints_srgb)[ti] * vrng.uniform(0.85, 1.12, (npts, 1))
variant = vrng.integers(0, NV, npts)
pm = bpy.data.meshes.new('GritPoints')
pm.vertices.add(npts)
pm.vertices.foreach_set('co', np.column_stack([pts, zs]).astype(np.float32).ravel())
for name, typ, data in [('rot', 'FLOAT_VECTOR', rot), ('scl', 'FLOAT_VECTOR', scl)]:
    at = pm.attributes.new(name, typ, 'POINT')
    at.data.foreach_set('vector', data.astype(np.float32).ravel())
at = pm.attributes.new('variant', 'INT', 'POINT')
at.data.foreach_set('value', variant.astype(np.int32))
at = pm.attributes.new('tint', 'FLOAT_COLOR', 'POINT')
at.data.foreach_set('color', np.column_stack([tint, np.ones(npts)]).astype(np.float32).ravel())
grit = bpy.data.objects.new('GritPoints', pm)
tile_coll.objects.link(grit)

ng = bpy.data.node_groups.new('GritInstances', 'GeometryNodeTree')
ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
gi = ng.nodes.new('NodeGroupInput')
gout = ng.nodes.new('NodeGroupOutput')
ci = ng.nodes.new('GeometryNodeCollectionInfo')
ci.inputs['Collection'].default_value = var_coll
ci.inputs['Separate Children'].default_value = True
ci.inputs['Reset Children'].default_value = True
iop = ng.nodes.new('GeometryNodeInstanceOnPoints')
iop.inputs['Pick Instance'].default_value = True
nav = ng.nodes.new('GeometryNodeInputNamedAttribute'); nav.data_type = 'INT'; nav.inputs['Name'].default_value = 'variant'
nar = ng.nodes.new('GeometryNodeInputNamedAttribute'); nar.data_type = 'FLOAT_VECTOR'; nar.inputs['Name'].default_value = 'rot'
nas = ng.nodes.new('GeometryNodeInputNamedAttribute'); nas.data_type = 'FLOAT_VECTOR'; nas.inputs['Name'].default_value = 'scl'
ng.links.new(gi.outputs[0], iop.inputs['Points'])
ng.links.new(ci.outputs[0], iop.inputs['Instance'])
ng.links.new(nav.outputs['Attribute'], iop.inputs['Instance Index'])
ng.links.new(nar.outputs['Attribute'], iop.inputs['Rotation'])
ng.links.new(nas.outputs['Attribute'], iop.inputs['Scale'])
ng.links.new(iop.outputs[0], gout.inputs[0])
gm_ = grit.modifiers.new('GritInstances', 'NODES')
gm_.node_group = ng

mat, nn, ll, mo = new_mat('Grit')
bs = nn.new('ShaderNodeBsdfPrincipled')
at = nn.new('ShaderNodeAttribute'); at.attribute_type = 'INSTANCER'; at.attribute_name = 'tint'
nz_ = nn.new('ShaderNodeTexNoise'); nz_.inputs['Scale'].default_value = 6.0; nz_.inputs['Detail'].default_value = 6
tco = nn.new('ShaderNodeTexCoord')
mul = nn.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'
rmp = nn.new('ShaderNodeMapRange'); rmp.inputs['To Min'].default_value = 0.7; rmp.inputs['To Max'].default_value = 1.2
ll.new(tco.outputs['Object'], nz_.inputs['Vector'])
ll.new(nz_.outputs['Fac'], rmp.inputs['Value'])
ll.new(at.outputs['Color'], mul.inputs[0])
ll.new(rmp.outputs['Result'], mul.inputs[1])
ll.new(mul.outputs['Vector'], bs.inputs['Base Color'])
bs.inputs['Roughness'].default_value = 0.72
bmp = nn.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = 0.4
ll.new(nz_.outputs['Fac'], bmp.inputs['Height'])
ll.new(bmp.outputs['Normal'], bs.inputs['Normal'])
ll.new(bs.outputs[0], mo.inputs['Surface'])
for o in var_coll.objects:
    o.data.materials.append(mat)
log('grit', npts)

# ---------------------------------------------------------------- plants
def leaf_texture(w=512, h=256, seed=0, dry=0.0):
    r = np.random.default_rng(seed)
    u = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    v = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
    base0 = srgb2lin((80, 100, 50))
    base1 = srgb2lin((104, 122, 62))
    mot = np.clip(0.5 + 0.35 * np.sin(u * 23 + r.uniform(0, 6)) * np.cos(v * 9 + r.uniform(0, 6)), 0, 1)
    col = base0 * (1 - mot[..., None]) + base1 * mot[..., None]
    mid = np.exp(-(v / 0.045) ** 2)
    f = np.mod(u * 7.5 - np.abs(v) * 1.6, 1.0)
    vein = np.exp(-(np.minimum(f, 1 - f) / 0.035) ** 2) * (np.abs(v) < 0.9) * (u > 0.05)
    col = col * (1 + 0.35 * mid[..., None] + 0.12 * vein[..., None])
    col = col * (1 - 0.5 * mid[..., None]) + srgb2lin((160, 170, 110)) * 0.5 * mid[..., None]
    col = col * (1 - 0.35 * vein[..., None]) + srgb2lin((140, 156, 96)) * 0.35 * vein[..., None]
    edge = sstep(0.8, 1.0, np.abs(v)) + sstep(0.85, 1.0, u)
    col = col * (1 - 0.3 * edge[..., None] * dry) + srgb2lin((150, 120, 60)) * 0.3 * edge[..., None] * dry
    speck = r.random((h, w)) < 0.01
    col = np.where(speck[..., None], col * 0.7, col)
    return np.clip(col, 0, 1)


def grass_texture(w=64, h=256):
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    c0 = srgb2lin((150, 160, 90))
    c1 = srgb2lin((88, 120, 40))
    c2 = srgb2lin((170, 150, 96))
    col = c0 * (1 - sstep(0, 0.2, t))[..., None] + c1 * (sstep(0, 0.2, t) * (1 - sstep(0.75, 1, t)))[..., None] + c2 * sstep(0.75, 1, t)[..., None]
    x = np.linspace(-1, 1, w)[None, :]
    col *= (1 + 0.15 * np.exp(-(x / 0.12) ** 2))[..., None]
    return np.clip(col, 0, 1)


def img_from_lin(name, arr):
    h, w = arr.shape[:2]
    path = os.path.join(MAPS, name + '.png')
    write_png(path, np.round(lin2srgb(arr) * 255), 8)
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'sRGB'
    return img


def plant_mat(name, img, trans=0.3, rough=0.45):
    mat, nn, ll, mo = new_mat(name)
    ti = nn.new('ShaderNodeTexImage'); ti.image = img
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.inputs['Roughness'].default_value = rough
    bs.inputs['Specular IOR Level'].default_value = 0.22
    tl = nn.new('ShaderNodeBsdfTranslucent')
    hs = nn.new('ShaderNodeHueSaturation'); hs.inputs['Saturation'].default_value = 1.05; hs.inputs['Value'].default_value = 1.0
    bp = nn.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; bp.inputs['Distance'].default_value = 0.0005
    ll.new(ti.outputs['Color'], bp.inputs['Height'])
    ll.new(bp.outputs['Normal'], bs.inputs['Normal'])
    mx = nn.new('ShaderNodeMixShader'); mx.inputs['Fac'].default_value = trans
    ll.new(ti.outputs['Color'], bs.inputs['Base Color'])
    ll.new(ti.outputs['Color'], hs.inputs['Color'])
    ll.new(hs.outputs['Color'], tl.inputs['Color'])
    ll.new(bs.outputs[0], mx.inputs[1])
    ll.new(tl.outputs[0], mx.inputs[2])
    ll.new(mx.outputs[0], mo.inputs['Surface'])
    return mat


leaf_mats = [plant_mat('Leaf%d' % i, img_from_lin('leaf%d' % i, leaf_texture(seed=i, dry=d)), 0.22, 0.72) for i, d in enumerate([0.2, 0.6, 1.0])]
grass_mat = plant_mat('Grass', img_from_lin('grass', grass_texture()), 0.35, 0.5)
stem_mat, nn, ll, mo = new_mat('Stem')
bs = nn.new('ShaderNodeBsdfPrincipled'); bs.inputs['Base Color'].default_value = (*srgb2lin((120, 130, 70)), 1); bs.inputs['Roughness'].default_value = 0.5
ll.new(bs.outputs[0], mo.inputs['Surface'])


class MB:
    def __init__(self):
        self.v = []; self.f = []; self.uv = []; self.mi = []

    def add_grid(self, P, UV, mi):
        # P: (nu, nv, 3), UV: (nu, nv, 2)
        nu, nv = P.shape[:2]
        base = sum(len(x) for x in self.v)
        self.v.append(P.reshape(-1, 3))
        for i in range(nu - 1):
            for j in range(nv - 1):
                a = base + i * nv + j
                q = (a, a + nv, a + nv + 1, a + 1)
                self.f.append(q)
                self.uv.append([UV[i, j], UV[i + 1, j], UV[i + 1, j + 1], UV[i, j + 1]])
                self.mi.append(mi)

    def build(self, name, mats, ground=None):
        V = np.concatenate(self.v)
        if ground is not None:  # drape: nothing may sink below the paving surface
            gz = sample_bilinear(ground, V[:, 0], V[:, 1]) + 0.0009
            V[:, 2] = np.maximum(V[:, 2], gz)
        me = bpy.data.meshes.new(name)
        me.from_pydata(V.tolist(), [], self.f)
        for m_ in mats:
            me.materials.append(m_)
        uvl = me.uv_layers.new(name='UVMap')
        uvs = np.array(self.uv, np.float32).reshape(-1, 2)
        uvl.data.foreach_set('uv', uvs.ravel())
        me.polygons.foreach_set('material_index', np.array(self.mi, np.int32))
        me.shade_smooth()
        return me


def rot_z(p, a):
    c, s = math.cos(a), math.sin(a)
    return np.stack([p[..., 0] * c - p[..., 1] * s, p[..., 0] * s + p[..., 1] * c, p[..., 2]], -1)


def rot_y(p, a):  # pitch up around y
    c, s = math.cos(a), math.sin(a)
    return np.stack([p[..., 0] * c - p[..., 2] * s, p[..., 1], p[..., 0] * s + p[..., 2] * c], -1)


def add_tube(mb, pts, r0, r1, mi, sides=5):
    n = len(pts)
    P = np.zeros((n, sides + 1, 3))
    UV = np.zeros((n, sides + 1, 2))
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t /= np.linalg.norm(t) + 1e-9
        a = np.cross(t, [0, 0, 1.0])
        if np.linalg.norm(a) < 1e-6:
            a = np.array([1.0, 0, 0])
        a /= np.linalg.norm(a)
        b = np.cross(t, a)
        r = r0 + (r1 - r0) * i / (n - 1)
        for j in range(sides + 1):
            ang = 2 * math.pi * j / sides
            P[i, j] = pts[i] + r * (math.cos(ang) * a + math.sin(ang) * b)
            UV[i, j] = (0.5, 0.5)
    mb.add_grid(P, UV, mi)


def add_leaf(mb, root, phi, pitch, L, W, pet, mi, rng):
    nu, nv = 14, 7
    u = np.linspace(0, 1, nu)[:, None]
    v = np.linspace(-1, 1, nv)[None, :]
    w = 0.5 * W * np.sin(math.pi * np.clip(u, 0, 1) ** 0.72) ** 0.6
    x = u * L
    y = v * w
    cup = rng.uniform(0.15, 0.4)
    z = cup * np.abs(v) ** 1.6 * w - L * (rng.uniform(0.15, 0.35) * u ** 2) + 0.0012 * np.sin(v * 5 + u * 13 + rng.uniform(0, 6)) * u * np.abs(v)
    P = np.stack(np.broadcast_arrays(x + pet, y, z), -1).astype(float)
    # petiole droop via pitch then yaw
    P = rot_y(P, pitch)
    P = rot_z(P, phi) + root
    UV = np.stack([u * np.ones_like(v), (v + 1) / 2 * np.ones_like(u)], -1)
    mb.add_grid(P, UV, mi)
    # petiole
    k = np.linspace(0, 1, 5)[:, None]
    pp = np.concatenate([k * pet, np.zeros_like(k), -0.002 * (1 - k)], 1)
    pp = rot_z(rot_y(pp, pitch), phi) + root
    add_tube(mb, pp, 0.0012, 0.0009, 3)


def add_rosette(mb, root, rng, scale=1.0):
    n = rng.integers(5, 9)
    phi0 = rng.uniform(0, 2 * math.pi)
    for k in range(n):
        inner = k >= n - 2
        L = scale * (rng.uniform(0.022, 0.04) if inner else rng.uniform(0.035, 0.06))
        W = L * rng.uniform(0.6, 0.8)
        pitch = rng.uniform(0.7, 1.1) if inner else rng.uniform(0.35, 0.7)
        pet = scale * (rng.uniform(0.004, 0.01) if inner else rng.uniform(0.01, 0.024))
        phi = phi0 + 2 * math.pi * k / n + rng.normal(0, 0.25)
        add_leaf(mb, root, phi, pitch, L, W, pet, int(rng.integers(0, 3)), rng)


def add_grass(mb, root, rng, nb=None, hscale=1.0):
    nb = nb or int(rng.integers(6, 16))
    for _ in range(nb):
        Lb = hscale * rng.uniform(0.03, 0.1)
        wb = rng.uniform(0.0018, 0.0032)
        phi = rng.uniform(0, 2 * math.pi)
        lean = rng.uniform(0.15, 0.7)
        curve = rng.uniform(0.3, 1.2)
        nu = 7
        t = np.linspace(0, 1, nu)
        ang = lean + curve * t ** 1.5
        dx = np.cumsum(np.sin(ang)) * Lb / nu
        dz = np.cumsum(np.cos(ang)) * Lb / nu
        spine = np.stack([dx, np.zeros(nu), dz], 1)
        spine[:, 0] -= spine[0, 0]; spine[:, 2] -= spine[0, 2] + 0.004
        wid = wb * (1 - t ** 1.3) + 0.0002
        P = np.zeros((nu, 3, 3))
        tw = rng.normal(0, 0.4)
        for i in range(nu):
            side = np.array([0, 1.0, 0])
            side = np.array([0, math.cos(tw * t[i]), math.sin(tw * t[i])])
            for j, s in enumerate((-1, 0, 1)):
                P[i, j] = spine[i] + side * wid[i] * s * 0.5 + np.array([0, 0, 0.0006 * (1 - abs(s))])
        off = rng.normal(0, 0.004, 3); off[2] = 0
        P = rot_z(P, phi) + root + off
        UV = np.stack([np.repeat(t[:, None], 3, 1) * 0 + np.array([0, 0.5, 1])[None, :], np.repeat(t[:, None], 3, 1)], -1)
        mb.add_grid(P, UV, 4)


# plant sites: stone rect corners are joint crossings
prng = np.random.default_rng(nseed())
corners_all = np.array([warp(x, y) for (x, y, w, h) in rects])
sel = prng.permutation(len(corners_all))
mb = MB()
n_ros, n_small, n_grass = 5, 7, 12
k = 0
sites = []
for idx_ in sel:
    if len(sites) >= n_ros + n_small + n_grass:
        break
    x, y = corners_all[idx_] % TILE
    x += prng.normal(0, 0.006); y += prng.normal(0, 0.006)
    if sample(soil_clear, np.array([x]), np.array([y]))[0] < 0.4:
        continue
    if any((x - a) ** 2 + (y - b) ** 2 < 0.35 ** 2 for a, b in sites):
        continue
    sites.append((x, y))
for i, (x, y) in enumerate(sites):
    z = float(sample_bilinear(soil_m, np.array([x]), np.array([y]))[0])
    root = np.array([x, y, z])
    if i < n_ros:
        add_rosette(mb, root, prng, scale=prng.uniform(0.85, 1.15))
        if prng.random() < 0.5:
            add_grass(mb, root + np.array([0.02, 0.01, 0]), prng, nb=5, hscale=0.8)
    elif i < n_ros + n_small:
        add_rosette(mb, root, prng, scale=prng.uniform(0.4, 0.6))
    else:
        add_grass(mb, root, prng)
pme = mb.build('JointPlants', leaf_mats + [stem_mat, grass_mat], ground=H)
plants = bpy.data.objects.new('JointPlants', pme)
tile_coll.objects.link(plants)
log('plants', len(sites))

# ---------------------------------------------------------------- presentation tiling (translation-periodic tile)
for ty in (-1, 0, 1, 2):
    for tx in (-1, 0, 1):
        if tx == 0 and ty == 0:
            continue
        e = bpy.data.objects.new('TileInst_%d_%d' % (tx, ty), None)
        e.instance_type = 'COLLECTION'
        e.instance_collection = tile_coll
        e.location = (tx * TILE, ty * TILE, 0)
        scene.collection.objects.link(e)

# ---------------------------------------------------------------- lighting / world / render
world = bpy.data.worlds.new('Sky')
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
for n in list(wn):
    if n.type != 'OUTPUT_WORLD':
        wn.remove(n)
sky = wn.new('ShaderNodeTexSky')
sky.sky_type = 'HOSEK_WILKIE'
sky.turbidity = 2.6
sky.ground_albedo = 0.3
bg = wn.new('ShaderNodeBackground')
wl.new(sky.outputs[0], bg.inputs['Color'])
wl.new(bg.outputs[0], wn['World Output'].inputs['Surface'])

sun_d = bpy.data.lights.new('Sun', 'SUN')
sun = bpy.data.objects.new('Sun', sun_d)
scene.collection.objects.link(sun)
sun_d.angle = math.radians(0.6)

cam_d = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.sensor_width = 36

scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
for d in prefs.devices:
    d.use = d.type == 'OPTIX'
scene.cycles.device = 'GPU'
scene.cycles.samples = A.samples
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPTIX'
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 3
scene.cycles.transmission_bounces = 6
scene.render.use_persistent_data = True
scene.view_settings.view_transform = 'AgX'
for look in ('AgX - High Contrast', 'High Contrast'):
    try:
        scene.view_settings.look = look
        break
    except Exception:
        pass
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '8'


def set_sun(el, az, strength, color=(1.0, 0.88, 0.72)):
    el, az = math.radians(el), math.radians(az)
    s = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    sun.rotation_euler = (-s).to_track_quat('-Z', 'Y').to_euler()
    sun_d.energy = strength
    sun_d.color = color
    sky.sun_direction = s
    sun.hide_render = strength <= 0


def set_cam(eye, target, lens, ortho=None):
    cam.location = eye
    cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    cam_d.lens = lens
    if ortho:
        cam_d.type = 'ORTHO'
        cam_d.ortho_scale = ortho
    else:
        cam_d.type = 'PERSP'


# pick a rosette for the close view
ros = np.array(sites[0]) if sites else np.array([2.0, 2.0])
VIEWS = {
    'walking': dict(eye=(2.0, 0.25, 1.6), target=(2.05, 2.75, 0.0), lens=30, sun=(30, 165, 4.6), sky=2.0, res=(1536, 1024)),
    'walking-matched': dict(eye=(2.15, 0.3, 1.635), target=(2.05, 2.15, 0.0), lens=42, sun=(30, 165, 4.6), sky=2.0, res=(1800, 1350)),
    'overview': dict(eye=(-0.6, -1.4, 2.6), target=(2.0, 2.0, 0.0), lens=30, sun=(30, 165, 4.6), sky=2.0, res=(1536, 1024)),
    'close': dict(eye=(ros[0] - 0.05, ros[1] - 0.55, 0.32), target=(ros[0], ros[1] + 0.05, 0.0), lens=40, sun=(30, 165, 4.6), sky=2.0, res=(1536, 1024)),
    'joint': dict(eye=(2.0, 1.3, 0.22), target=(2.05, 1.75, -0.01), lens=45, sun=(28, 170, 4.6), sky=2.0, res=(1536, 1024)),
    'overcast': dict(eye=(2.0, 0.25, 1.6), target=(2.05, 2.75, 0.0), lens=30, sun=(34, 165, 0.0), sky=6.0, res=(1536, 1024)),
    'grazing': dict(eye=(2.0, 0.25, 1.6), target=(2.05, 2.75, 0.0), lens=30, sun=(12, 20, 4.5), sky=2.0, res=(1536, 1024)),
    'top': dict(eye=(2.0, 2.0, 10.0), target=(2.0, 2.0, 0.0), lens=50, ortho=4.0, sun=(55, 165, 4.4), sky=2.0, res=(1600, 1600)),
}
VIEWS['gray'] = dict(VIEWS['walking-matched'], mode='gray')
VIEWS['unlit'] = dict(VIEWS['walking-matched'], mode='unlit')


def set_mode(mode):
    g = GROUND
    for l_ in list(g['bs'].inputs['Base Color'].links):
        g['ll'].remove(l_)
    for l_ in list(g['mo'].inputs['Surface'].links):
        g['ll'].remove(l_)
    if mode == 'gray':
        g['bs'].inputs['Base Color'].default_value = (0.18, 0.18, 0.18, 1)
        g['ll'].new(g['bs'].outputs[0], g['mo'].inputs['Surface'])
    elif mode == 'unlit':
        em = g['nn'].get('UnlitEmission') or g['nn'].new('ShaderNodeEmission')
        em.name = 'UnlitEmission'
        g['ll'].new(g['ta'].outputs['Color'], em.inputs['Color'])
        g['ll'].new(em.outputs[0], g['mo'].inputs['Surface'])
    else:
        g['ll'].new(g['ta'].outputs['Color'], g['bs'].inputs['Base Color'])
        g['ll'].new(g['bs'].outputs[0], g['mo'].inputs['Surface'])


renders = []
for vname in [v for v in A.views.split(',') if v]:
    V = VIEWS[vname]
    set_mode(V.get('mode'))
    scene.view_settings.view_transform = 'Standard' if V.get('mode') == 'unlit' else 'AgX'
    set_cam(V['eye'], V['target'], V['lens'], V.get('ortho'))
    sv = list(V['sun']); sv[2] *= A.sunk; set_sun(*sv)
    bg.inputs['Strength'].default_value = V['sky'] * A.skyk
    scene.render.resolution_x = int(V['res'][0] * A.scale)
    scene.render.resolution_y = int(V['res'][1] * A.scale)
    scene.render.resolution_percentage = 100
    path = os.path.join(OUT, vname + '.png')
    scene.render.filepath = path
    t = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    log('render', vname, '%.1fs' % (time.perf_counter() - t))
    renders.append(path)

set_mode(None)
scene.view_settings.view_transform = 'AgX'
layout = dict(tileMetres=TILE, seed=A.seed, stones=[dict(s, rect=list(map(float, r))) for s, r in zip(stones, rects)])
with open(os.path.join(OUT, 'layout.json'), 'w') as f:
    json.dump(layout, f)
if A.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'source.blend'), relative_remap=True, compress=True)
def ident(p_):
    with open(p_, 'rb') as f:
        b = f.read()
    return dict(path=os.path.relpath(p_, OUT).replace(os.sep, '/'), bytes=len(b), sha256=hashlib.sha256(b).hexdigest())


receipt = dict(
    createdUtc=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
    blender=bpy.app.version_string, args=dict(vars(A), out=os.path.basename(OUT)), seconds=round(time.perf_counter() - T0, 1),
    tileMetres=TILE, texelMillimetres=PX * 1000, meshSpacingMillimetres=spacing * 1000,
    stones=len(stones), gritInstances=int(npts), gritVariants=NV, plantSites=len(sites),
    plantTriangles=int(sum(len(p_.vertices) - 2 for p_ in pme.polygons)),
    groundQuads=int(A.grid * A.grid * 4 ** A.subdiv), heightRangeMetres=[hmin, hmax],
    references=['KIT-001 batch103 A', 'KIT-003 batch103 B', 'MAT-001 batch108 A', 'MAT-018 batch108 B', 'VEG-001 batch116 B1'],
    sourceOnly=True, runtimeQA=False, rightsReviewed=False, artisticAcceptance=False,
    files=[ident(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in sorted(fs) if f.endswith(('.png', '.blend', '.json'))])
with open(os.path.join(OUT, 'receipt.json'), 'w') as f:
    json.dump(receipt, f, indent=1)
log('done')
