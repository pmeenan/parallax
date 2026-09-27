# D1 timber-framed wall family — procedural source (daylight kit package K1).
# Run: blender -b --factory-startup --python build.py -- --out candidateN [--save-blend] [--views ...]
# Preview: add --px 2 --stone-px 3 --subdiv 2 --paving-subdiv 2 --samples 48 --scale 0.75
#
# Every piece is authored in its own frame: the plaster plane is y = 0, the exterior faces -y,
# x runs along the wall and z is up. Timber, plinth stones and caps are "members": a rounded
# rectangle profile swept along an axis, textured over their unrolled surface, so grain runs
# along each member and checks, wear and weathering are continuous around its arrises.
import argparse, hashlib, json, math, os, struct, sys, time, zlib

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

T0 = time.perf_counter()


def log(*a):
    print('[wall %6.1fs]' % (time.perf_counter() - T0), *a, flush=True)


HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--px', type=float, default=1.0, help='oak and plaster texel size, mm')
ap.add_argument('--stone-px', type=float, default=1.5, help='plinth stone texel size, mm')
ap.add_argument('--oak-px', type=float, default=None, help='oak texel size, mm (default: --px)')
ap.add_argument('--coarse', type=float, default=0.02, help='base mesh spacing before subdivision, m')
ap.add_argument('--subdiv', type=int, default=3)
ap.add_argument('--paving', default=os.path.normpath(os.path.join(HERE, '../../d1-paving/proof-2026-09-22/photoreal/candidate1')))
ap.add_argument('--paving-subdiv', type=int, default=3)
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--views', default='front')
ap.add_argument('--scale', type=float, default=1.0)
ap.add_argument('--seed', type=int, default=7)
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
with open(__file__, 'rb') as f:
    builder_bytes = f.read()
with open(os.path.join(OUT, 'build-snapshot.py'), 'wb') as f:
    f.write(builder_bytes)

PX = A.px / 1000.0
SPX = A.stone_px / 1000.0
OPX = (A.oak_px if A.oak_px else A.px) / 1000.0
VSPACE = A.coarse / 2 ** A.subdiv  # rendered vertex spacing
PAD = 4
_sc = [A.seed * 1000]


def nseed():
    _sc[0] += 1
    return _sc[0]


RNG = np.random.default_rng(A.seed)


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


# ================================================================= member geometry
class Profile:
    """Rounded rectangle in the (b, a) plane, traversed counter-clockwise from the middle of the
    back face (a = a0), so the outward normal is the tangent turned clockwise."""

    def __init__(self, a0, a1, b0, b1, r):
        r = max(0.0, min(r, 0.5 * (a1 - a0) - 1e-5, 0.5 * (b1 - b0) - 1e-5))
        self.a0, self.a1, self.b0, self.b1, self.r = a0, a1, b0, b1, r
        bm = 0.5 * (b0 + b1)
        S = []

        def line(p, q, n):
            S.append(('L', math.dist(p, q), p, q, n))

        def arc(c, t0, t1):
            S.append(('A', r * abs(t1 - t0), c, t0, t1))

        line((bm, a0), (b1 - r, a0), (0, -1)); arc((b1 - r, a0 + r), -math.pi / 2, 0)
        line((b1, a0 + r), (b1, a1 - r), (1, 0)); arc((b1 - r, a1 - r), 0, math.pi / 2)
        line((b1 - r, a1), (b0 + r, a1), (0, 1)); arc((b0 + r, a1 - r), math.pi / 2, math.pi)
        line((b0, a1 - r), (b0, a0 + r), (-1, 0)); arc((b0 + r, a0 + r), math.pi, 1.5 * math.pi)
        line((b0 + r, a0), (bm, a0), (0, -1))
        self.S = S
        self.starts = np.cumsum([0.0] + [s[1] for s in S])
        self.P = float(self.starts[-1])
        self.arc_mid = np.array([self.starts[i] + 0.5 * S[i][1] for i in (1, 3, 5, 7)])

    def t_at_a(self, a_cut):
        """Arc-length window of the part of the profile in front of a = a_cut."""
        tA = self.starts[2] + (a_cut - (self.a0 + self.r))
        tB = self.starts[6] + ((self.a1 - self.r) - a_cut)
        return float(tA), float(tB)

    def eval(self, t):
        t = np.asarray(t, np.float64)
        b = np.zeros_like(t); a = np.zeros_like(t); nb = np.zeros_like(t); na = np.zeros_like(t)
        tt = np.mod(t, self.P)
        for i, s in enumerate(self.S):
            m = (tt >= self.starts[i]) & (tt <= self.starts[i + 1] + 1e-12)
            if not m.any() or s[1] <= 0:
                continue
            u = (tt[m] - self.starts[i]) / s[1]
            if s[0] == 'L':
                (pb, pa), (qb, qa), (xb, xa) = s[2], s[3], s[4]
                b[m] = pb + (qb - pb) * u; a[m] = pa + (qa - pa) * u; nb[m] = xb; na[m] = xa
            else:
                (cb, ca), t0, t1 = s[2], s[3], s[4]
                th = t0 + (t1 - t0) * u
                nb[m] = np.cos(th); na[m] = np.sin(th)
                b[m] = cb + self.r * nb[m]; a[m] = ca + self.r * na[m]
        d = np.abs(tt[:, None] - self.arc_mid[None, :])
        darc = np.minimum(d, self.P - d).min(1)
        return b, a, nb, na, darc

    def coarse(self, tA, tB, step):
        pts = [tA, tB]
        for i, s in enumerate(self.S):
            if s[1] <= 0:
                continue
            n = (4 if self.r > 0.003 else 1) if s[0] == 'A' else max(1, int(math.ceil(s[1] / step)))
            pts += list(self.starts[i] + s[1] * np.arange(n + 1) / n)
        pts = np.array(sorted(set(round(p, 9) for p in pts)))
        return pts[(pts >= tA - 1e-9) & (pts <= tB + 1e-9)]


class Member:
    def __init__(self, cls, obj, p0, e_s, L, e_a, a0, a1, b0, b1, r, out=(0, -1, 0), a_cut=None,
                 caps=(True, True), kind='beam', **params):
        self.cls, self.obj, self.kind = cls, obj, kind
        self.p0 = np.array(p0, float)
        self.e_s = np.array(e_s, float) / np.linalg.norm(e_s)
        self.e_a = np.array(e_a, float) / np.linalg.norm(e_a)
        self.e_b = np.cross(self.e_s, self.e_a)
        self.L = float(L)
        self.prof = Profile(a0, a1, b0, b1, r)
        self.closed = a_cut is None
        self.tA, self.tB = (0.0, self.prof.P) if self.closed else self.prof.t_at_a(a_cut)
        self.caps = caps
        self.out = np.array(out, float)
        self.p = params
        self.px = SPX if cls == 'stone' else OPX
        self.ns = max(8, int(math.ceil(self.L / self.px)))
        span = self.tB - self.tA
        self.nt = max(8, int(round(span / self.px)) if self.closed else int(math.ceil(span / self.px)))
        self.pxs = self.L / self.ns
        self.pxt = span / self.nt
        self.rects = {'strip': (self.ns, self.nt)}
        tc = self.prof.coarse(self.tA, self.tB, A.coarse)
        if self.closed:
            tc = tc[tc < self.tB - 1e-9]
        self.tc = tc
        cb, ca, _, _, _ = self.prof.eval(tc)
        self.cap_ab = (cb, ca)
        self.cap_box = (cb.min(), cb.max(), ca.min(), ca.max())
        for k, on in zip(('cap0', 'cap1'), caps):
            if on:
                self.rects[k] = (max(4, int(math.ceil((cb.max() - cb.min()) / self.px)) + 1),
                                 max(4, int(math.ceil((ca.max() - ca.min()) / self.px)) + 1))

    def world(self, s, b, a):
        bow = self.p.get('bow', 0.0) * np.sin(np.pi * np.clip(s / self.L, 0, 1))
        if 'mitre' in self.p:
            s = self.p['mitre'](s, b)
        return self.p0[None, :] + s[:, None] * self.e_s + (b + bow * 0.4)[:, None] * self.e_b + (a + bow)[:, None] * self.e_a


# ================================================================= kit description
OAK_PAL = [(80, 58, 40), (88, 64, 44), (72, 53, 37), (96, 70, 48), (78, 58, 42)]
STONE_PAL = [(192, 172, 138), (184, 162, 126), (178, 162, 136), (196, 172, 132), (200, 182, 150), (168, 150, 120)]
MEMBERS = []
PIECES = {}   # piece name -> dict(plaster=[...], iron=[...], glass=[...])
OUT_Y = (0, -1, 0)

A_BACK = -0.215     # back face of full-depth timber (wall is 0.25 m, plaster plane at y = 0)
A_CUT = -0.012      # shell timbers stop just behind the plaster plane
# Corner posts reach 5 mm past the side facade's plaster line (y = 0.25) so no slot opens between the
# post and the side plaster; at A_BACK one showed daylight through the roofless shell (candidate 20).
CORNER_BACK = -0.255


def piece(name):
    PIECES.setdefault(name, dict(plaster=None, iron=[], glass=[], openings=[], timbers=[], streaks=[]))
    return PIECES[name]


def oak(obj, p0, e_s, L, a1, b0, b1, a0=A_BACK, a_cut=A_CUT, r=None, caps=(True, True), kind='beam', face=True, **kw):
    r_draw = RNG.uniform(0.012, 0.028) if r is None else r
    r = min(r_draw, 0.12 * (b1 - b0), 0.3 * (a1 - (a0 if a_cut is None else a_cut))) if r is None else r
    tone = int(RNG.integers(len(OAK_PAL)))
    bright = float(RNG.normal(1.0, 0.06))
    weather = float(RNG.uniform(0.45, 1.0))
    checks = float(RNG.uniform(0.5, 1.3))
    # A legacy draw keeps the random sequence of every later member (candidate 19: the front-left
    # corner post was a bowed beam in candidate 18).
    legacy_bow = kw.pop('legacy_bow_draw', False)
    bow = float(RNG.normal(0, 0.005)) if (kind in ('beam', 'lintel') or legacy_bow) and L > 1.0 else 0.0
    m = Member('oak', obj, p0, e_s, L, OUT_Y if 'e_a' not in kw else kw.pop('e_a'), a0, a1, b0, b1, r, a_cut=a_cut,
               caps=caps, kind=kind, tone=tone, bright=bright, weather=weather, checks=checks,
               bow=bow if kind in ('beam', 'lintel') else 0.0, **kw)
    m.r_draw = r_draw
    MEMBERS.append(m)
    return m


def vbeam(obj, x0, x1, z0, z1, a1, **kw):
    """Vertical member over [x0, x1] x [z0, z1] in the facade plane."""
    m = oak(obj, (x0, 0, z0), (0, 0, 1), z1 - z0, a1, 0.0, x1 - x0, **kw)
    if kw.get('face', True):
        piece(obj)['timbers'].append(('rect', x0, x1, z0, z1))
    return m


def hbeam(obj, x0, x1, z0, z1, a1, **kw):
    """Horizontal member; e_b = e_s x e_a = -z, so b runs downward from the top edge."""
    m = oak(obj, (x0, 0, z1), (1, 0, 0), x1 - x0, a1, 0.0, z1 - z0, **kw)
    if kw.get('face', True):
        piece(obj)['timbers'].append(('rect', x0, x1, z0, z1))
    return m


def brace(obj, pA, pB, w, a1, post_x, head_z, seat=0.075, clear=0.032, ext=0.035, margin=0.012):
    """Diagonal brace from the post (side face x = post_x) up to the plate (underside z = head_z).
    Both ends are mitred parallel to those faces and seated `seat` into them, as a tenoned brace is,
    so each visible shoulder runs the brace's full width tight against its post or plate (candidate
    20; square ends left a plaster triangle at one edge).
    The member keeps candidate 19's square-cut length L and so its texture, byte for byte (a new
    length re-rolls the grain). Along each edge the texture is spread linearly over that edge's
    length between the planes `clear` inside the post and plate faces (past any arris); grain
    stays along the member, and the last `margin` of texture at each end covers the hidden seat."""
    d = np.array([pB[0] - pA[0], 0, pB[1] - pA[1]])
    Ld = np.linalg.norm(d)
    e = d / Ld
    e_b = np.array([e[2], 0.0, -e[0]])   # e_s x e_a with e_a = OUT_Y
    into = -math.copysign(1.0, pB[0] - pA[0])   # the post lies behind the brace's foot
    # s from pA along the axis where an edge at b meets the plane x = X (post) or z = Z (plate)
    s_post = lambda X, b: (X - pA[0] - b * e_b[0]) / e[0]
    s_head = lambda Z, b: (Z - pA[1] - b * e_b[2]) / e[2]
    L = Ld + 2 * ext

    def mitre(u, b):
        s0, s1 = s_post(post_x + into * seat, b), s_head(head_z + seat, b)
        w0, w1 = s_post(post_x + into * clear, b), s_head(head_z + clear, b)
        s = np.where(u < margin, s0 + (w0 - s0) * u / margin, w0 + (u - margin) * (w1 - w0) / (L - 2 * margin))
        s = np.where(u > L - margin, w1 + (s1 - w1) * (u - (L - margin)) / margin, s)
        return s + ext   # world() measures s from p0 = pA - ext e

    p0 = np.array([pA[0], 0, pA[1]]) - e * ext
    m = oak(obj, p0, e, L, a1, -w / 2, w / 2, caps=(False, False), kind='brace', mitre=mitre)
    poly = []
    for bb in (w / 2, -w / 2):
        poly.append(np.array([pA[0], pA[1]]) + e[[0, 2]] * s_post(post_x + into * seat, bb) + e_b[[0, 2]] * bb)
    for bb in (-w / 2, w / 2):
        poly.append(np.array([pA[0], pA[1]]) + e[[0, 2]] * s_head(head_z + seat, bb) + e_b[[0, 2]] * bb)
    piece(obj)['timbers'].append(('poly', poly))
    return m


def brace_peg(obj, pA, pB, post_x, head_z, plate, depth=0.05, proud=0.004):
    """Pegs through the brace's two tenons, on its axis, `depth` inside the post and the plate.
    The plate is hewn with a few millimetres of relief and bows, so the plate peg is seated on the
    plate's actual surface once its height field exists (seat_pegs); the post peg (on a corner
    post, unbowed, sometimes another piece's) stands `proud` further out than the frame's pegs."""
    d = np.array([pB[0] - pA[0], pB[1] - pA[1]])
    e = d / np.linalg.norm(d)
    into = -math.copysign(1.0, pB[0] - pA[0])
    X = post_x + into * depth
    xh = pB[0] + e[0] * depth / e[1]
    bow = plate.p.get('bow', 0.0) * math.sin(math.pi * min(max((xh - plate.p0[0]) / plate.L, 0.0), 1.0))
    m = peg(obj, xh, head_z + depth - 0.4 * bow, HEAD_A, lift=bow + proud)
    m.host = (plate, xh - plate.p0[0], plate.p0[2] - (head_z + depth), bow)
    peg(obj, X, pA[1] + e[1] * (X - pA[0]) / e[0], POST_A, lift=proud)


def seat_pegs(proud=0.003):
    """Stand each hosted peg `proud` of the highest point of its host's displaced face under it."""
    at = ATLAS['oak']
    for m in MEMBERS:
        if not hasattr(m, 'host'):
            continue
        h, s, b, bow = m.host
        pr = h.prof
        t = pr.starts[4] + ((pr.b1 - pr.r) - b)   # the front face runs from b1 - r down to b0 + r
        rx, ry = at['pos'][(id(h), 'strip')]
        c, r_ = int(round(s / h.pxs)), int(round((t - h.tA) / h.pxt))
        k = int(math.ceil(0.011 / h.px))
        top = float(at['hgt'][ry + max(0, r_ - k):ry + r_ + k + 1, rx + max(0, c - k):rx + c + k + 1].max())
        front = pr.a1 + bow + top + proud
        m.p0[1] = -(front - m.L)
        log('peg on %s seated %.1f mm proud of the nominal face' % (m.obj, 1000 * (front - pr.a1 - bow)))


def peg(obj, x, z, face_a, rad=0.011, lift=0.0):
    # a short round member along the outward normal; its outer cap is the visible end grain
    L = 0.013
    return oak(obj, (x, -(face_a - 0.011 + lift), z), (0, -1, 0), L, rad, -rad, rad, a0=-rad, a_cut=None, r=rad,
               caps=(False, True), kind='peg', e_a=(0, 0, 1), face=False)


def iron_box(obj, c, size, rot=0.0):
    piece(obj)['iron'].append(('box', c, size, rot))


def iron_cyl(obj, c, rad, depth, axis='y'):
    piece(obj)['iron'].append(('cyl', c, rad, depth, axis))


def nails(obj, xs, z, a, rad=0.0075):
    for x in xs:
        iron_cyl(obj, (x, -a - 0.002, z), rad, 0.006)


GROUND = dict(base=0.5, sill=(0.5, 0.70), posts=(0.5, 3.28), head=(3.28, 3.50), girt=None)
UPPER = dict(base=3.5, sill=None, posts=(3.68, 6.28), head=(6.28, 6.50), girt=(3.50, 3.68))
POST_A, HEAD_A, SILL_A, BRACE_A, FRAME_A = 0.035, 0.042, 0.040, 0.022, 0.040


def window(name, zc, st):
    # clear 0.62 x 0.82, 0.10 frame, projecting sill board, head rail, casement, open shutters
    x0, x1 = 0.795, 1.455
    z0, z1 = zc - 0.43, zc + 0.43
    P = piece(name)
    vbeam(name, x0 - 0.10, x0, z0 - 0.08, z1 + 0.10, FRAME_A, a_cut=None, kind='frame')
    vbeam(name, x1, x1 + 0.10, z0 - 0.08, z1 + 0.10, FRAME_A, a_cut=None, kind='frame')
    hbeam(name, x0, x1, z0 - 0.08, z0, FRAME_A - 0.004, a_cut=None, kind='frame')
    hbeam(name, x0, x1, z1, z1 + 0.10, FRAME_A - 0.004, a_cut=None, kind='frame')
    hbeam(name, x0 - 0.14, x1 + 0.14, z1 + 0.10, z1 + 0.22, HEAD_A, kind='lintel')
    hbeam(name, x0 - 0.14, x1 + 0.14, z0 - 0.14, z0 - 0.08, 0.085, a_cut=-0.03, kind='sillboard')
    # casement: surround, mullion and transom, recessed behind the face
    ca1, ca0 = -0.035, -0.085
    w = 0.035
    for (bx0, bx1, bz0, bz1) in [(x0, x0 + w, z0, z1), (x1 - w, x1, z0, z1), ((x0 + x1) / 2 - w / 2, (x0 + x1) / 2 + w / 2, z0, z1)]:
        oak(name, (bx0, 0, bz0), (0, 0, 1), bz1 - bz0, ca1, 0.0, bx1 - bx0, a0=ca0, a_cut=None, r=0.004, kind='casement', face=False)
    for (bz0, bz1) in [(z0, z0 + w), (z1 - w, z1), ((z0 + z1) / 2 - w / 2, (z0 + z1) / 2 + w / 2)]:
        oak(name, (x0 + w, 0, bz1), (1, 0, 0), x1 - x0 - 2 * w, ca1, 0.0, bz1 - bz0, a0=ca0, a_cut=None, r=0.004, kind='casement', face=False)
    P['glass'].append((x0, x1, z0, z1, -0.06))
    P['openings'].append((x0 - 0.02, x1 + 0.02, z0 - 0.02, z1 + 0.02))
    P['streaks'].append((x0 - 0.14, x1 + 0.14, z0 - 0.14))
    P['streaks'].append((x0 - 0.14, x1 + 0.14, z1 + 0.10))
    # shutters open flat against the wall, hinged on the frame edges
    sh_w, sh_h = 0.33, 0.94
    for side in (-1, 1):
        hx = x0 - 0.10 if side < 0 else x1 + 0.10
        xa, xb = (hx - sh_w - 0.006, hx - 0.006) if side < 0 else (hx + 0.006, hx + sh_w + 0.006)
        zb = zc - sh_h / 2
        n = 4
        for k in range(n):
            px0 = xa + (xb - xa) * k / n
            px1 = xa + (xb - xa) * (k + 1) / n - 0.002
            oak(name, (px0, 0, zb), (0, 0, 1), sh_h, 0.034, 0.0, px1 - px0, a0=0.008, a_cut=0.014, r=0.004,
                kind='plank', face=False)
        for zz in (zb + 0.13, zb + sh_h - 0.13):
            iron_box(name, ((xa + xb) / 2 - side * 0.02, -0.037, zz), (sh_w - 0.02, 0.005, 0.034))
            nails(name, np.linspace(xa + 0.05, xb - 0.05, 4), zz, 0.037, rad=0.006)
            iron_cyl(name, (hx, -0.030, zz), 0.009, 0.05, axis='z')
        # holdback: a wall plate with a turned catch at the shutter's outer bottom corner
        edge = xa if side < 0 else xb
        ox = edge + side * 0.03
        iron_box(name, (ox, -0.006, zb + 0.08), (0.028, 0.006, 0.05))
        iron_box(name, (ox, -0.022, zb + 0.08), (0.012, 0.028, 0.012))
        iron_box(name, (ox - side * 0.035, -0.039, zb + 0.08), (0.075, 0.007, 0.014))


def bay(name, st, kind):
    P = piece(name)
    z_p0, z_p1 = st['posts']
    if kind == 'braced':
        # The braced bays stand at the front-left corner (the only place they are used): their post
        # is the house's corner post, full depth and standing 35 mm proud of the left facade's
        # plaster plane (x = 0), as the corner piece's post is at the front-right. A shell post here
        # left a slot through the corner and the left facade's brace ending in the air (candidate 19).
        m = vbeam(name, -POST_A, 0.25, z_p0, z_p1, POST_A, a0=CORNER_BACK, a_cut=None, kind='corner',
                  legacy_bow_draw=True)
        # The oak detail tile is sampled in atlas space, so keep candidate 18's packing for every
        # other member: the shell post's rectangles stay in the packing as empty placeholders and
        # the corner post's own are packed after everything else.
        m.legacy_rects = Member('oak', name, (0, 0, z_p0), (0, 0, 1), z_p1 - z_p0, OUT_Y, A_BACK, POST_A, 0.0, 0.25,
                                min(m.r_draw, 0.12 * 0.25, 0.3 * (POST_A - A_CUT)), a_cut=A_CUT).rects
    else:
        vbeam(name, 0.0, 0.25, z_p0, z_p1, POST_A)
    # plates: the front corner bay runs its plates full-section over the corner post, showing end grain
    # on the side facade; the side corner bay's plates stop against the back of that plate
    pk = {}
    x_start, x_end = 0.0, 2.0
    if name.endswith('cbrace2'):
        x_end = 2.25 + A_BACK
    elif kind == 'cbrace':
        x_end, pk = 2.25 + HEAD_A, dict(a_cut=None)
    elif kind == 'braced':
        x_start, pk = -HEAD_A, dict(a_cut=None)
    plates = [st['head']] + ([st['girt']] if st['girt'] else [])
    head = None
    for (pz0, pz1) in plates:
        pm = hbeam(name, x_start, x_end, pz0, pz1, HEAD_A, **pk)
        head = head or pm
        peg(name, 0.125, (pz0 + pz1) / 2, HEAD_A)
        if x_end > 2.2:
            peg(name, 2.125, (pz0 + pz1) / 2, HEAD_A)
    if st['girt']:
        z_lo = st['girt'][1]
    else:
        z_lo = st['sill'][1]
        if kind == 'door':
            hbeam(name, 0.25, 0.58, st['sill'][0], st['sill'][1], SILL_A, caps=(False, True))
            hbeam(name, 1.82, 2.0, st['sill'][0], st['sill'][1], SILL_A, caps=(True, False))
        else:
            hbeam(name, 0.25, 2.0, st['sill'][0], st['sill'][1], SILL_A)
        peg(name, 0.125, (st['sill'][0] + st['sill'][1]) / 2, POST_A)
    z_hi = st['head'][0]
    if kind == 'braced':
        zt = z_hi
        brace(name, (0.25, zt - 0.95), (1.05, zt), 0.15, BRACE_A, 0.25, zt)
        brace_peg(name, (0.25, zt - 0.95), (1.05, zt), 0.25, zt, head)
    elif kind == 'cbrace':
        zt = z_hi
        brace(name, (2.0, zt - 0.95), (1.2, zt), 0.15, BRACE_A, 2.0, zt)
        brace_peg(name, (2.0, zt - 0.95), (1.2, zt), 2.0, zt, head)
    elif kind == 'window':
        window(name, (2.0 if st is GROUND else 5.0), st)
    elif kind == 'door':
        dx0, dx1 = 0.70, 1.70
        vbeam(name, 0.58, dx0, 0.0, 2.25, FRAME_A, a_cut=None, kind='jamb')
        vbeam(name, dx1, 1.82, 0.0, 2.25, FRAME_A, a_cut=None, kind='jamb')
        hbeam(name, 0.25, 2.0, 2.25, 2.42, HEAD_A, kind='lintel')
        peg(name, 0.125, 2.335, POST_A)
        P['streaks'].append((0.25, 2.0, 2.25))
        # plank door, closed, set back in the jamb rebate
        n = 6
        for k in range(n):
            x0 = dx0 + (dx1 - dx0) * k / n
            x1 = dx0 + (dx1 - dx0) * (k + 1) / n - 0.003
            oak(name, (x0, 0, 0.012), (0, 0, 1), 2.235, -0.01, 0.0, x1 - x0, a0=-0.057, a_cut=-0.042, r=0.005,
                kind='plank', face=False)
        for zz in (0.36, 1.92):
            iron_box(name, (1.08, 0.006, zz), (0.72, 0.006, 0.05))
            nails(name, np.linspace(0.76, 1.40, 5), zz, -0.006)
            iron_cyl(name, (dx0 - 0.004, 0.0, zz), 0.011, 0.07, axis='z')
        iron_box(name, (1.56, 0.006, 1.05), (0.07, 0.006, 0.12))
        piece(name)['iron'].append(('ring', (1.56, -0.008, 0.99), 0.045, 0.006))
        P['openings'].append((dx0 - 0.02, dx1 + 0.02, 0.0, 2.26))
        P['stone'] = [(0.58, 1.82)]
    P['plaster'] = (0.0, 2.0, z_lo, z_hi, st is GROUND)


VARIANTS = [('g-plain', GROUND, 'plain'), ('g-window', GROUND, 'window'), ('g-door', GROUND, 'door'),
            ('g-braced', GROUND, 'braced'), ('g-cbrace', GROUND, 'cbrace'), ('g-cbrace2', GROUND, 'cbrace'), ('g-window2', GROUND, 'window'),
            ('u-window2', UPPER, 'window'), ('u-cbrace', UPPER, 'cbrace'), ('u-cbrace2', UPPER, 'cbrace'), ('u-plain', UPPER, 'plain'), ('u-window', UPPER, 'window'),
            ('u-braced', UPPER, 'braced')]
for name, st, kind in VARIANTS:
    bay(name, st, kind)

# corner piece, in the front facade's frame; the side facade's plaster plane is x = XC
XC = 12.25
CP = piece('corner')
for (z0, z1) in (GROUND['posts'], UPPER['posts']):
    m = oak('corner', (12.0, 0, z0), (0, 0, 1), z1 - z0, POST_A, 0.0, 0.25 + POST_A, a0=CORNER_BACK, a_cut=None,
            kind='corner')
    # candidate 19's post (to A_BACK) stays in the atlas packing as a placeholder, as in bay()
    m.legacy_rects = Member('oak', 'corner', m.p0, m.e_s, m.L, OUT_Y, A_BACK, POST_A, 0.0, 0.25 + POST_A,
                            min(m.r_draw, 0.12 * (0.25 + POST_A), 0.3 * (POST_A - A_BACK)), a_cut=None).rects
peg('corner', 12.125, 0.6, POST_A)


# ---------------------------------------------------------------- scene layout (world frame)
def M_front(x):
    return Matrix.Translation((x, 0, 0))


def M_right(y_end):  # mirrored bays on the +x side, owner post at the far end
    return Matrix.Translation((XC, y_end, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Diagonal((-1, 1, 1, 1))


def M_left(y_start):
    return Matrix.Translation((0, y_start, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')


PLACE = []
for i, (g, u) in enumerate(zip(['g-braced', 'g-window', 'g-door', 'g-window2', 'g-plain', 'g-cbrace'],
                               ['u-braced', 'u-window', 'u-window2', 'u-window', 'u-plain', 'u-cbrace'])):
    PLACE += [(g, M_front(2 * i)), (u, M_front(2 * i))]
for j, (g, u) in enumerate(zip(['g-cbrace2', 'g-window2', 'g-plain'], ['u-cbrace2', 'u-plain', 'u-window'])):
    PLACE += [(g, M_right(2.25 + 2 * j)), (u, M_right(2.25 + 2 * j))]
for j, (g, u) in enumerate(zip(['g-plain', 'g-window', 'g-cbrace2'], ['u-window', 'u-plain', 'u-cbrace2'])):
    PLACE += [(g, M_left(6.25 - 2 * j)), (u, M_left(6.25 - 2 * j))]
PLACE.append(('corner', Matrix.Identity(4)))
DOOR_GAP = (4.58, 5.82)

# plinth runs: courses of rough limestone blocks under the sill, staggered at the corners
FOOT = 0.6  # corner footing stones: FOOT x FOOT on plan, full plinth height
RUNS = [
    dict(name='front', origin=(0, 0, 0), d=(1, 0, 0), o=(0, -1, 0), c1=(FOOT - 0.06, XC + 0.07 - FOOT), c2=(FOOT - 0.06, XC + 0.07 - FOOT), gap=DOOR_GAP),
    dict(name='right', origin=(XC, 0, 0), d=(0, 1, 0), o=(1, 0, 0), c1=(FOOT - 0.06, 6.3), c2=(FOOT - 0.06, 6.3), gap=None),
    dict(name='left', origin=(0, 0, 0), d=(0, 1, 0), o=(-1, 0, 0), c1=(FOOT - 0.06, 6.3), c2=(FOOT - 0.06, 6.3), gap=None),
]
PL_A1, PL_BACK = 0.06, -0.24
Z_C1 = 0.225


def course_blocks(rng, lo, hi, gaps, avoid=None, first_len=None):
    segs = [(lo, hi)]
    if gaps:
        segs = [(lo, gaps[0] - 0.005), (gaps[1] + 0.005, hi)]
    out = []
    for (s0, s1) in segs:
        best = None
        for _ in range(300):
            xs = [s0]
            while xs[-1] < s1 - 0.2:
                L = first_len if (first_len and len(xs) == 1 and s0 == lo) else (
                    rng.uniform(0.18, 0.26) if rng.random() < 0.2 else rng.uniform(0.24, 0.56))
                xs.append(xs[-1] + L)
            xs[-1] = s1
            if len(xs) > 2 and xs[-1] - xs[-2] < 0.22:
                xs.pop(-2)
            joints = np.array(xs[1:-1])
            sc = 1.0 if avoid is None or not len(joints) or not len(avoid) else np.abs(joints[:, None] - avoid[None, :]).min()
            if best is None or sc > best[0]:
                best = (sc, xs)
            if sc > 0.12:
                break
        xs = best[1]
        for k in range(len(xs) - 1):
            out.append((xs[k] + (rng.uniform(0.004, 0.007) if k > 0 else 0), xs[k + 1] - (rng.uniform(0.004, 0.007) if k < len(xs) - 2 else 0),
                        k == 0, k == len(xs) - 2))
    return out


PLINTH = []
for run in RUNS:
    rng = np.random.default_rng(nseed())
    o3 = np.array(run['origin'], float); d3 = np.array(run['d'], float); ov = np.array(run['o'], float)
    c1 = course_blocks(rng, *run['c1'], run['gap'])
    j1 = np.array([b[1] for b in c1[:-1]])
    c2 = course_blocks(rng, *run['c2'], run['gap'], avoid=j1, first_len=0.56 if run['name'] == 'right' else None)
    run['blocks'] = []
    c1_tops = []
    for ci, (course, zlo, zhi) in enumerate([(c1, -0.06, Z_C1), (c2, Z_C1 + 0.008, 0.498)]):
        for (x0, x1, first, last) in course:
            if ci == 0:
                top = zhi + rng.uniform(-0.035, 0.03)       # uneven coursing
                c1_tops.append((x0, x1, top))
                bot = zlo
            else:
                top = zhi - rng.uniform(0.0, 0.006)
                under = [t for (a0, a1, t) in c1_tops if a1 > x0 and a0 < x1]
                bot = (max(under) if under else Z_C1) + rng.uniform(0.009, 0.013)
            a1 = PL_A1 + max(-0.006, rng.normal(0.004, 0.005) if ci == 0 else rng.normal(0, 0.005))
            e_s = d3
            e_b = np.cross(e_s, ov)
            p0 = o3 + d3 * x0
            # b coordinates from the z-range (e_b is +-z)
            bz = e_b[2]
            b0, b1 = sorted([(bot - p0[2]) * bz, (top - p0[2]) * bz])
            end_open = (first or last)
            m = Member('stone', 'plinth-' + run['name'], p0, e_s, x1 - x0, ov, PL_BACK, a1, b0, b1,
                       rng.uniform(0.016, 0.03), out=ov, a_cut=None if end_open else 0.0,
                       caps=(first or True, last or True), kind='block', tone=int(rng.choice(len(STONE_PAL))),
                       bright=float(rng.normal(1.0, 0.05)), course=ci, lichen=float(rng.uniform(0.2, 1.2)))
            MEMBERS.append(m)
            run['blocks'].append((x0, x1, bot, top))
for fi, fx in enumerate((-0.07, XC + 0.07 - FOOT)):
    frng = np.random.default_rng(nseed())
    MEMBERS.append(Member('stone', 'plinth-foot', (fx, -0.07, 0.505), (1, 0, 0), FOOT, OUT_Y, -FOOT, 0.0, 0.0, 0.565,
                          0.04, a_cut=None, kind='footing', tone=int(frng.choice(len(STONE_PAL))), bright=1.0,
                          course=1, lichen=float(frng.uniform(0.5, 1.1))))
# door threshold stone, in the door bay's frame
for (x0, x1) in PIECES['g-door']['stone']:
    MEMBERS.append(Member('stone', 'g-door', (x0, 0, 0.012), (1, 0, 0), x1 - x0, OUT_Y, -0.215, 0.13, 0.0, 0.1, 0.018,
                          a_cut=None, kind='threshold', tone=1, bright=1.0, course=0, lichen=0.1))
log('members', len(MEMBERS), 'oak', sum(m.cls == 'oak' for m in MEMBERS), 'stone', sum(m.cls == 'stone' for m in MEMBERS))


# ================================================================= atlas packing
def pack(rects, W, late=()):
    """Shelf packing. Late rectangles (members changed since candidate 18, whose original rectangles
    stay as empty 'legacy' placeholders so every other member keeps its atlas position) first fill
    those placeholders, shelf by shelf, then go on shelves below everything else."""
    x = y = sh = 0
    pos = {}
    for key, (w, h) in sorted(rects, key=lambda r: -r[1][1]):
        w2, h2 = w + 2 * PAD, h + 2 * PAD
        if x + w2 > W:
            x, y, sh = 0, y + sh, 0
        pos[key] = (x + PAD, y + PAD)
        x += w2
        sh = max(sh, h2)
    holes = sorted(([pos[k][0] - PAD, pos[k][1] - PAD, w + 2 * PAD, h + 2 * PAD, 0, 0, 0]
                    for k, (w, h) in rects if k[0] == 'legacy'), key=lambda o: -o[2] * o[3])
    for key, (w, h) in sorted(late, key=lambda r: -r[1][1]):
        w2, h2 = w + 2 * PAD, h + 2 * PAD
        for o in holes:   # o: x, y, w, h, shelf x, shelf y, shelf height
            if w2 > o[2] or h2 > o[3] - o[5]:
                continue
            if o[4] + w2 > o[2]:
                o[4], o[5], o[6] = 0, o[5] + o[6], 0
            if o[4] + w2 <= o[2] and o[5] + h2 <= o[3] and (o[6] == 0 or h2 <= o[6]):
                pos[key] = (o[0] + o[4] + PAD, o[1] + o[5] + PAD)
                o[4] += w2
                o[6] = max(o[6], h2)
                break
        else:   # a taller rectangle opens a fresh shelf rather than growing the last one
            if x + w2 > W or h2 > sh:
                x, y, sh = 0, y + sh, 0
            pos[key] = (x + PAD, y + PAD)
            x += w2
            sh = max(sh, h2)
    return pos, y + sh


ATLAS = {}
for cls in ('oak', 'stone'):
    rects = [(('legacy', id(m), k) if hasattr(m, 'legacy_rects') else (id(m), k), wh) for m in MEMBERS
             if m.cls == cls for k, wh in getattr(m, 'legacy_rects', m.rects).items()]
    late = [((id(m), k), wh) for m in MEMBERS if m.cls == cls and hasattr(m, 'legacy_rects') for k, wh in m.rects.items()]
    area = sum((w + 2 * PAD) * (h + 2 * PAD) for _, (w, h) in rects)
    W = 1024
    while W * W < area * 1.08 or W < max(w for _, (w, _) in rects) + 2 * PAD:
        W *= 2
    pos, H = pack(rects, W, late)
    H = int(math.ceil(H / 64) * 64)
    ATLAS[cls] = dict(W=W, H=H, pos=pos, alb=np.zeros((H, W, 3), np.uint8), nrm=np.zeros((H, W, 3), np.uint8),
                      rgh=np.zeros((H, W), np.uint8), hgt=np.zeros((H, W), np.float32), msk=np.zeros((H, W), np.uint8))
    ATLAS[cls]['nrm'][..., 2] = 255
    ATLAS[cls]['nrm'][..., :2] = 128
    log('atlas', cls, W, H, '%.1f Mtexel' % (W * H / 1e6))


def paste(cls, key, hgt, alb, rgh, nrm):
    at = ATLAS[cls]
    x, y = at['pos'][key]
    h, w = hgt.shape

    def P(a):
        pw = ((PAD, PAD), (PAD, PAD)) + (((0, 0),) if a.ndim == 3 else ())
        return np.pad(a, pw, mode='edge')

    at['hgt'][y - PAD:y + h + PAD, x - PAD:x + w + PAD] = P(hgt)
    at['msk'][y - PAD:y + h + PAD, x - PAD:x + w + PAD] = 255 if key[1] == 'strip' else 0
    at['alb'][y - PAD:y + h + PAD, x - PAD:x + w + PAD] = P(np.round(lin2srgb(alb) * 255).astype(np.uint8))
    at['rgh'][y - PAD:y + h + PAD, x - PAD:x + w + PAD] = P(np.round(np.clip(rgh, 0, 1) * 255).astype(np.uint8))
    at['nrm'][y - PAD:y + h + PAD, x - PAD:x + w + PAD] = P(np.round((nrm * 0.5 + 0.5) * 255).astype(np.uint8))


# ================================================================= oak fields
def oak_strip(m):
    g = Grid(m.nt, m.ns, m.px, nseed())
    T = (m.tA + (np.arange(m.nt) + 0.5) * m.pxt)
    S = ((np.arange(m.ns) + 0.5) * m.pxs)[None, :]
    b, a, nb, na, darc = m.prof.eval(T)
    nw = na[:, None] * m.e_a[None, :] + nb[:, None] * m.e_b[None, :]
    up = nw[:, 2][:, None].astype(np.float32)
    out = (nw @ m.out)[:, None].astype(np.float32)
    T = T[:, None].astype(np.float32)
    darc = darc[:, None].astype(np.float32)
    rng = g.rng
    small = m.kind in ('peg', 'casement', 'plank')
    # ---- grain coordinate TG: meanders, runs out obliquely across the face, bends round knots.
    # Hewn structural oak is not quarter-sawn joinery: its figure wanders and is cut through.
    TG = (T + rng.normal(0, 0.014) * S + 0.012 * g.noise(0.05, 0.7) + 0.004 * g.noise(0.012, 0.16)).astype(np.float32)
    KN = np.zeros((m.nt, m.ns), np.float32)
    KR = np.zeros((m.nt, m.ns), np.float32)
    KL = np.zeros((m.nt, m.ns), np.float32)
    faces_ = np.nonzero(((out[:, 0] > 0.6) | (up[:, 0] > 0.6)) & (darc[:, 0] > 0.03))[0]
    nk = 0
    if not small and m.L > 0.5 and len(faces_) and (m.prof.b1 - m.prof.b0) > 0.14 and m.kind not in ('jamb', 'frame'):
        nk = max(2 if (m.e_s[2] > 0.9 and m.L > 1.5) else 1, int(rng.poisson((0.9 if m.e_s[2] > 0.9 else 0.55) * m.L)))
    KNOTS = []
    for _ in range(nk):
        sk = rng.uniform(0.28, m.L - 0.28)
        main = faces_[out[faces_, 0] > 0.8] if _ == 0 and np.any(out[faces_, 0] > 0.8) else faces_
        tk = float(T[rng.choice(main), 0])
        rt = rng.uniform(0.024, 0.036)
        rs = rt * rng.uniform(2.2, 3.2)   # knots are cut obliquely: elongated along the grain
        KNOTS.append((sk, tk, rs, rt))
        e = np.sqrt(((S - sk) / (0.6 * rs)) ** 2 + ((T - tk) / (0.6 * rt)) ** 2)
        e = e + 0.15 * g.noise(0.004)
        KN = np.maximum(KN, 1 - sstep(0.75, 1.0, e))
        KR = np.maximum(KR, (0.5 + 0.5 * np.cos(2 * np.pi * e * 3.0)) * (1 - sstep(0.6, 1.0, e))
                        + 0.3 * np.exp(-((e - 1.1) / 0.15) ** 2))        # the dark branch heart
        # flow lines: the surrounding fibres part round the knot as stretched contour loops
        ef = np.sqrt(((S - sk) / (1.0 * rs)) ** 2 + ((T - tk) / (0.75 * rt)) ** 2) + 0.06 * g.noise(0.006, 0.02)
        loops = (0.5 + 0.5 * np.cos(2 * np.pi * (ef * 2.2))) ** 5 * sstep(0.7, 0.95, ef) * (1 - sstep(1.6, 2.6, ef))
        KL = np.maximum(KL, loops)
    # ---- growth rings: the figure on each face is where it cuts the rings round a wandering pith axis.
    # Boxed-heart timbers show straight lines near the pith and cathedral arches where the face runs out
    # through the rings; knots are branch stubs that the rings wrap around.
    pr_ = m.prof
    bw, aw = pr_.b1 - pr_.b0, pr_.a1 - pr_.a0
    boxed = rng.random() < (0.15 if m.e_s[2] > 0.9 else 0.4)
    ob = rng.normal(0, 0.15 * bw) if boxed else rng.choice([-1, 1]) * rng.uniform(0.6, 1.6) * bw
    oa = rng.normal(0, 0.15 * aw) if boxed else rng.uniform(0.5, 1.5) * aw
    kb, ka = rng.normal(0, 0.035), rng.normal(0, 0.035)
    lam = rng.uniform(0.6, 1.8)
    Sc = S - m.L / 2
    bp_ = 0.5 * (pr_.b0 + pr_.b1) + ob + kb * Sc + 0.006 * np.sin(2 * np.pi * S / lam + rng.uniform(0, 6))
    ap_ = 0.5 * (pr_.a0 + pr_.a1) + oa + ka * Sc + 0.006 * np.sin(2 * np.pi * S / (lam * 1.3) + rng.uniform(0, 6))
    rad = np.sqrt((b[:, None] - bp_) ** 2 + (a[:, None] - ap_) ** 2).astype(np.float32)
    rad = rad + 0.005 * g.noise(0.03, 0.3) + 0.0025 * g.noise(0.012, 0.08) + 0.0008 * g.noise(0.005, 0.03)
    for (sk, tk, rs, rt) in KNOTS:
        e2 = ((S - sk) / rs) ** 2 + ((T - tk) / rt) ** 2
        rad = rad + rng.choice([-1, 1]) * rng.uniform(0.012, 0.018) * np.exp(-0.3 * e2)
    rsp = rng.uniform(0.0028, 0.0055)
    ph = (rad + 0.007 * np.sin(2 * np.pi * rad / rng.uniform(0.018, 0.03) + rng.uniform(0, 6))
          + 0.002 * np.sin(2 * np.pi * rad / rng.uniform(0.007, 0.012) + rng.uniform(0, 6))) / rsp + 0.25 * g.noise(0.01, 0.1)
    ew = 0.5 + 0.5 * np.cos(2 * np.pi * ph)
    wgt = sstep(-1.0, 1.2, g.noise(0.01, 0.25))
    groove = sstep(0.55, 0.9, ew) * (0.45 + 0.55 * wgt)
    brk = sstep(-0.9, 0.7, g.noise(0.0015, 0.035))
    groove = groove * (0.55 + 0.45 * brk)
    near = sstep(0.05, 0.3, g.blur(KL, 0.01) * 3)
    groove = groove * (1 - 0.7 * near) + 0.9 * KL      # straight grain gives way to the loops round knots
    fib = g.noise(0.0005, 0.016)
    gate = g.noise(0.0014, 0.012)
    isl = sstep(0.75, 1.0, (1 - ew) + 0.7 * gate + 0.2 * g.noise(0.004, 0.03)) * (1 - small * 0.6)
    erosion = rng.uniform(0.35, 1.0) if not small else 0.4
    isl = isl * sstep(-0.8, 0.6, g.noise(0.03, 0.25) + 1.2 * erosion - 0.6)
    streak = g.fbm([((0.004, 0.18), 1.0), ((0.0015, 0.06), 0.6)])
    broad = g.fbm([((0.05, 0.4), 1.0), ((0.02, 0.12), 0.5)])
    # ---- hand-hewn faces: overlapping adze scallops, undulating and slightly twisted
    scal = sstep(-1.2, 1.2, g.noise(0.035, 0.09)) + 0.5 * sstep(-1.0, 1.0, g.noise(0.015, 0.04))
    # adze strokes: shallow scallops across the grain, 8-16 cm apart, with wandering boundaries
    period = rng.uniform(0.08, 0.16)
    aph = S / period + 0.35 * g.noise(0.03, 0.08) + rng.uniform(0, 1)
    fr = aph - np.floor(aph)
    adze = np.abs(fr - 0.5) ** 1.5 * 2.83 - 0.4
    hew = sstep(0.05, 0.5, out + np.maximum(up, 0)) * (0.0 if small else rng.uniform(0.9, 1.3))
    pore = sstep(1.05, 1.7, g.noise(0.0008, 0.005)) * (0.5 + 0.5 * groove)
    stip = g.noise(0.0007, 0.0025)  # torn, pitted fibre surface
    FINE = (-0.0017 * groove + 0.00035 * fib * (0.5 + brk) + 0.0011 * isl - 0.0008 * pore
            + 0.0003 * stip * (1 - small)).astype(np.float32)
    H = (FINE + (0.0006 if small else 0.0024) * broad + 0.0055 * hew * (scal - 0.75)
         + 0.0028 * hew * adze * (0.6 + 0.4 * erosion)).astype(np.float32)
    # ---- splits: a few long checks and many short ones, all following the grain
    CRK = np.zeros_like(H)
    faceok = (darc > 0.015) & (out + np.maximum(up, 0) > 0.2)
    nck = 0 if small or m.L < 0.4 else int(rng.poisson(m.p['checks'] * 20.0 * m.L))
    rows = np.nonzero(faceok[:, 0])[0]
    for _ in range(nck if len(rows) else 0):
        r0 = rng.choice(rows)
        long_ = m.L > 0.4 and (_ == 0 or rng.random() < 0.4)
        if _ == 0 and np.any(out[rows, 0] > 0.8):
            r0 = rng.choice(rows[out[rows, 0] > 0.8])
        ln = rng.uniform(0.2, min(0.95, 0.6 * m.L)) if long_ else rng.uniform(0.025, 0.14)
        s0 = rng.uniform(min(0.06, 0.2 * m.L), max(0.07, m.L - ln - 0.06))
        wmax = min(rng.uniform(0.0015, 0.0045) if long_ else rng.uniform(0.0005, 0.002), 0.02 * (m.prof.b1 - m.prof.b0))
        dep = rng.uniform(0.004, 0.014) if long_ else rng.uniform(0.001, 0.004)
        j0, j1 = int(s0 / m.pxs), min(m.ns, int((s0 + ln) / m.pxs) + 1)
        i0 = max(0, r0 - int(0.03 / m.pxt)); i1 = min(m.nt, r0 + int(0.03 / m.pxt) + 1)
        if j1 <= j0 or i1 <= i0:
            continue
        u = np.clip((S[:, j0:j1] - s0) / ln, 0, 1)
        pr = np.sin(np.pi * u) ** 0.5
        d = np.abs(TG[i0:i1, j0:j1] - TG[r0, j0:j1][None, :])
        wv = wmax * pr * (0.7 + 0.6 * sstep(-1, 1, g.noise(0.01, 0.05)[i0:i1, j0:j1]))
        cr = (1 - sstep(0.35 * wv, 0.5 * wv + 0.0003, d)) * (pr > 0.03)
        H[i0:i1, j0:j1] = np.minimum(H[i0:i1, j0:j1], -dep * pr * cr + H[i0:i1, j0:j1] * (1 - cr))
        if long_ and m.kind == 'beam' and m.e_s[2] > 0.9 and out[r0, 0] > 0.8:
            bb, aa, _, _, _ = m.prof.eval(np.array([T[r0, 0]]))
            CHECKS.append((m.obj, m.world(np.array([s0 + 0.5 * ln]), bb, aa)[0], ln, float(bb[0] - m.prof.b0)))
        CRK[i0:i1, j0:j1] = np.maximum(CRK[i0:i1, j0:j1], cr * np.minimum(1, pr * 3))
    hair = (1 - sstep(0.0, 0.05, np.abs(np.sin(np.pi * ph * 0.5)))) * sstep(0.3, 1.1, g.noise(0.006, 0.09))
    hair *= (1 - small) * sstep(0.1, 0.5, out + np.maximum(up, 0))
    H -= 0.0011 * hair
    FINE = FINE - 0.0011 * hair
    # ---- broken, uneven arrises: wane and bruising that vary along the member
    edge = np.exp(-darc / 0.01)
    wane = sstep(0.1, 1.3, g.noise(0.02, 0.22))
    chip = sstep(0.4, 1.3, g.fbm([((0.005, 0.02), 1.0), ((0.002, 0.008), 0.5)]))
    H -= (0.001 if small else (0.003 + 0.008 * wane)) * edge * (0.45 + 0.55 * chip)
    H += 0.0008 * KN
    taper = sstep(0.0, 0.012, S) * sstep(0.0, 0.012, m.L - S)
    H *= taper
    m.fine = FINE * taper
    # ---- colour: dark weathered oak, tan worn ridges, near-black grooves and splits, grey-black patina
    base = srgb2lin(OAK_PAL[m.p['tone']]) * m.p['bright']
    col = base * (0.6 + 0.8 * sstep(-1.8, 1.8, streak))[..., None]
    col = col * (0.62 + 0.0 * isl)[..., None]
    col = mix(col, srgb2lin((138, 110, 82)) * (0.8 + 0.4 * sstep(-1.5, 1.5, streak))[..., None], (0.4 + 0.3 * erosion) * isl)
    col = col * (1 - 0.55 * groove)[..., None]
    worn = sstep(0.0002, 0.0014, H - g.blur(H, 0.002))
    col = mix(col, srgb2lin((156, 114, 72)) * (0.8 + 0.4 * sstep(-1, 1, fib))[..., None], 0.5 * worn * (1 - groove))
    silver = np.clip(m.p['weather'] * (0.22 + 0.85 * np.maximum(up, 0) + 0.38 * np.maximum(out, 0))
                     + 0.35 * g.fbm([((0.006, 0.15), 1.0), ((0.03, 0.4), 1.0)]) * m.p['weather'], 0, 1)
    col = mix(col, srgb2lin((124, 118, 106)), 0.58 * silver * (1 - 0.4 * groove))
    patina = sstep(0.4, 1.5, g.fbm([((0.012, 0.12), 1.0), ((0.04, 0.35), 0.7)]))
    col = mix(col, srgb2lin((40, 34, 28)), 0.3 * patina)
    col = mix(col, srgb2lin((22, 15, 10)), 0.8 * pore)
    col = col * (0.88 + 0.24 * sstep(-1.5, 1.5, stip))[..., None]
    col = col * (1 - 0.18 * np.clip(-up, 0, 1))[..., None]
    col = mix(col, srgb2lin((18, 13, 9)), 0.9 * CRK)
    col = mix(col, srgb2lin((26, 18, 12)), 0.75 * hair)
    col = mix(col, srgb2lin((44, 29, 18)), 0.8 * KN * (0.5 + 0.5 * sstep(0.3, 1.0, KN)))
    col = mix(col, srgb2lin((104, 72, 44)), 0.45 * np.clip(KR, 0, 1))
    col = mix(col, srgb2lin((150, 100, 56)), 0.55 * KR * (1 - KN))
    endd = 1 - sstep(0.0, 0.06, np.minimum(S, m.L - S))
    col = col * (1 - 0.3 * endd)[..., None]
    cav = np.clip((g.blur(H, 0.004) - H) / 0.003, 0, 0.45)
    col = col * (1 - cav)[..., None]
    col = mix(col, srgb2lin((118, 100, 80)), 0.2 * chip * edge * (1 - wane * 0.5))
    R = np.clip(0.92 + 0.05 * groove + 0.04 * silver - 0.04 * worn + 0.04 * CRK, 0.85, 1.0)
    return H, col, R, g


def oak_cap(m, k):
    b0, b1, a0, a1 = m.cap_box
    nx, ny = m.rects[k]
    g = Grid(ny, nx, m.px, nseed())
    Bc = b0 + (np.arange(nx) + 0.5) * m.px
    Ac = a0 + (np.arange(ny) + 0.5) * m.px
    B, Aa = np.meshgrid(Bc, Ac)
    rng = g.rng
    pb, pa = rng.uniform(b0 - 0.05, b1 + 0.05), rng.uniform(a0 - 0.05, a1 + 0.05)
    rr = np.sqrt((B - pb) ** 2 + (Aa - pa) ** 2) + 0.002 * g.noise(0.01)
    ring = (0.5 + 0.5 * np.sin(2 * np.pi * rr / rng.uniform(0.003, 0.005))) ** 3
    ang = np.arctan2(Aa - pa, B - pb)
    split = (1 - sstep(0.0, 0.02, np.abs(np.sin(ang * rng.integers(2, 5) + rng.uniform(0, 6))))) * sstep(0.3, 1.0, g.noise(0.02))
    H = -0.0008 * ring - 0.003 * split + 0.0005 * g.noise(0.004)
    brd = np.minimum.reduce([B - b0, b1 - B, Aa - a0, a1 - Aa])
    H *= sstep(0.0, 0.008, brd)
    base = srgb2lin(OAK_PAL[m.p['tone']]) * m.p['bright'] * 0.72
    col = base * (1.15 - 0.6 * ring)[..., None]
    col = mix(col, srgb2lin((22, 15, 10)), 0.8 * split)
    col = mix(col, srgb2lin((74, 64, 54)), 0.45)
    return H.astype(np.float32), col, 0.85 + 0 * H, g


# ================================================================= stone fields
def stone_strip(m):
    g = Grid(m.nt, m.ns, m.px, nseed())
    T = (m.tA + (np.arange(m.nt) + 0.5) * m.pxt)
    S = ((np.arange(m.ns) + 0.5) * m.pxs)[None, :]
    b, a, nb, na, darc = m.prof.eval(T)
    nw = na[:, None] * m.e_a[None, :] + nb[:, None] * m.e_b[None, :]
    up = nw[:, 2][:, None].astype(np.float32)
    out = (nw @ m.out)[:, None].astype(np.float32)
    zw = (m.p0[2] + a[:, None] * m.e_a[2] + b[:, None] * m.e_b[2] + S * m.e_s[2]).astype(np.float32)
    darc = darc[:, None].astype(np.float32)
    H, col, R, g = stone_common(m, g, S, zw, up, out, darc)
    return H * sstep(0.0, 0.01, S) * sstep(0.0, 0.01, m.L - S), col, R, g


def stone_cap(m, k):
    b0, b1, a0, a1 = m.cap_box
    nx, ny = m.rects[k]
    g = Grid(ny, nx, m.px, nseed())
    B, Aa = np.meshgrid(b0 + (np.arange(nx) + 0.5) * m.px, a0 + (np.arange(ny) + 0.5) * m.px)
    zw = (m.p0[2] + B * m.e_b[2] + Aa * m.e_a[2]).astype(np.float32)
    brd = np.minimum.reduce([B - b0, b1 - B, Aa - a0, a1 - Aa]).astype(np.float32)
    H, col, R, g = stone_common(m, g, None, zw, np.zeros_like(zw), np.ones_like(zw), brd)
    H *= sstep(0.0, 0.01, brd)
    return H, col, R, g


def stone_common(m, g, S, zw, up, out, darc):
    rng = g.rng
    front = np.clip(sstep(0.4, 0.8, out) + 0.6 * sstep(0.5, 0.9, up), 0, 1)
    top = sstep(0.5, 0.9, up)
    # pitched rock face: shallow conchoidal facets with small ridges, broad undulation
    F1, F2, ID, nc = g.worley(0.07)
    dish = F1 / 0.045
    ridge = 1 - sstep(0.0, 0.004, F2 - F1)
    und = g.fbm([(0.06, 1.0), (0.02, 0.5)])
    pillow = sstep(0.0, 0.09, darc) * (sstep(0.0, 0.1, S) * sstep(0.0, 0.1, m.L - S) if S is not None else 1.0)
    rmask = sstep(0.2, 1.0, g.noise(0.03))
    H = front * (0.014 * pillow + 0.006 * (0.4 - np.clip(dish, 0, 1.2)) + 0.0012 * ridge * rmask + 0.005 * und)
    H += top * 0.0008 * und
    H += 0.0022 * g.fbm([(0.008, 1.0), (0.0035, 0.6), (0.0015, 0.3)]) * (0.4 + 0.6 * front)
    # worn, chipped arrises
    edge = np.exp(-darc / 0.02)
    chip = sstep(0.3, 1.2, g.fbm([(0.012, 1.0), (0.005, 0.5)]))
    H -= 0.011 * edge * (0.15 + 0.85 * chip)
    # pits
    PIT = np.zeros_like(H)
    for cell, prob, rmax, dk in [(0.008, 0.25, 0.0016, 0.6), (0.025, 0.15, 0.004, 0.5)]:
        P1, _, PID, pnc = g.worley(cell)
        rr = rng.random(pnc).astype(np.float32); ex = rng.random(pnc).astype(np.float32)
        rad = rmax * (0.3 + 0.7 * rr[PID] ** 2)
        prof = np.clip(1 - (P1 / rad) ** 2, 0, 1) ** 0.7
        PIT = np.minimum(PIT, np.where(ex[PID] < prob, -dk * rad * prof, 0))
    H += PIT
    # colour: per-block limestone tone, clast-driven weathering, lichen, soil and damp near the ground
    base = srgb2lin(STONE_PAL[m.p['tone']]) * m.p['bright'] * 0.95
    C1, C2, CID, cnc = g.worley(0.007)
    cv = rng.random(cnc).astype(np.float32)[CID]
    col = base * (0.84 + 0.3 * cv)[..., None] * (1 + 0.06 * g.fbm([(0.03, 1.0), (0.01, 0.5)]))[..., None]
    patch = sstep(0.0, 0.3, g.fbm([(0.05, 1.0), (0.015, 0.5)]) + 1.2 * (cv - 0.5) - 0.1)
    col = mix(col, srgb2lin((136, 124, 104)) * (0.85 + 0.3 * cv)[..., None], 0.45 * patch)
    col = col * (1 - 0.22 * sstep(0.0, 1.0, -(H - g.blur(H, 0.01)) / 0.003))[..., None]
    L1, L2, LID, lnc = g.worley(0.02)
    lv = rng.random(lnc).astype(np.float32)[LID]
    lich = sstep(0.9, 1.5, g.fbm([(0.04, 1.0), (0.012, 0.6)]) + 0.6 * m.p['lichen'] - 0.3) * (lv > 0.3)
    lich *= 1 - sstep(0.004, 0.009, L1) * 0.6
    lcol = np.where((lv > 0.88)[..., None], srgb2lin((188, 184, 160)), srgb2lin((140, 138, 80)))
    col = mix(col, lcol, 0.75 * lich)
    soil = 1 - sstep(0.0, 0.1 + 0.04 * g.noise(0.05), zw)
    col = mix(col, srgb2lin((88, 70, 52)), 0.65 * soil)
    damp = 1 - sstep(0.1, 0.36, zw + 0.04 * g.noise(0.08))
    col = col * (1 - 0.14 * damp)[..., None]
    moss = sstep(1.0, 1.6, g.fbm([(0.03, 1.0), (0.008, 0.6)])) * (edge + soil * 0.6 > 0.35) * (1 - sstep(0.0, 0.2, zw))
    col = mix(col, srgb2lin((70, 84, 34)), 0.7 * moss)
    col = mix(col, srgb2lin((84, 70, 54)), 0.45 * sstep(0.0003, 0.002, -PIT))
    cav = np.clip((g.blur(H, 0.004) - H) / 0.005, 0, 0.28)
    col = col * (1 - cav)[..., None]
    R = 0.82 + 0.08 * soil - 0.05 * edge
    return H.astype(np.float32), col, R, g


def finish(m, key, H, col, R, g, pxx, pxy):
    fine = getattr(m, 'fine', None) if key == 'strip' else None
    Hl = g.blur(H - fine if fine is not None else H, 0.55 * VSPACE)
    m.fine = None
    N = tangent_normal(H - Hl, pxx, pxy)
    paste(m.cls, (id(m), key), Hl, col, R, N)


CHECKS = []
t_f = time.perf_counter()
for m in MEMBERS:
    strip = oak_strip if m.cls == 'oak' else stone_strip
    capf = oak_cap if m.cls == 'oak' else stone_cap
    H, col, R, g = strip(m)
    finish(m, 'strip', H, col, R, g, m.pxs, m.pxt)
    for k in ('cap0', 'cap1'):
        if k in m.rects:
            H, col, R, g = capf(m, k)
            finish(m, k, H, col, R, g, m.px, m.px)
log('member fields %.1fs' % (time.perf_counter() - t_f))
seat_pegs()
EXTREME = None
for (obj, pnt, ln, bpos) in CHECKS:
    for (name, M) in PLACE:
        if name != obj or abs(M[0][0] - 1) > 1e-6 or abs(M[1][1] - 1) > 1e-6 or M[0][3] > 11.9:
            continue
        w = M @ Vector(pnt)
        if 0.9 < w.z < 2.2 and 0.1 < pnt[0] < 0.24 and (EXTREME is None or ln > EXTREME['len']):
            EXTREME = dict(obj=obj, local=(0.25, float(pnt[2])), world=w, len=ln, edge=w.x - pnt[0] + 0.25)

HRANGE = {}
for cls, at in ATLAS.items():
    h = at['hgt']
    lo, hi = float(h.min()), float(h.max())
    HRANGE[cls] = (lo, hi)
    write_png(os.path.join(MAPS, cls + '-albedo.png'), at['alb'])
    write_png(os.path.join(MAPS, cls + '-normal.png'), at['nrm'])
    write_png(os.path.join(MAPS, cls + '-roughness.png'), at['rgh'])
    write_png(os.path.join(MAPS, cls + '-height.png'), np.round((h - lo) / (hi - lo) * 65535), 16)
    write_png(os.path.join(MAPS, cls + '-detailmask.png'), at['msk'])
    del at['alb'], at['nrm'], at['rgh'], at['hgt'], at['msk']
log('atlases written', HRANGE)


# ================================================================= plaster (one field per bay variant)
def rect_sdf(X, Z, x0, x1, z0, z1):
    dx = np.maximum(x0 - X, X - x1)
    dz = np.maximum(z0 - Z, Z - z1)
    return np.where((dx < 0) & (dz < 0), np.maximum(dx, dz), np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dz, 0) ** 2))


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
    # vertices are ordered clockwise in (x, z) for braces; accept either winding
    inside2 = np.ones(X.shape, bool)
    for i in range(len(Q)):
        ax, ay = Q[i]
        bx, by = Q[(i + 1) % len(Q)]
        inside2 &= ((bx - ax) * (Y - ay) - (by - ay) * (X - ax)) < 0
    return np.where(inside | inside2, -d, d).astype(np.float32)


PLASTER = {}


def FORCE_LOSS(name, X, Z):
    if not EXTREME or EXTREME['obj'] != name:
        return 0.0
    lx, lz = EXTREME['local']
    return np.exp(-(((X - (lx + 0.02)) / 0.05) ** 2 + ((Z - lz) / 0.09) ** 2))


def plaster_field(name):
    P = PIECES[name]
    x0, x1, z0, z1, ground = P['plaster']
    nx, nz = int(math.ceil((x1 - x0) / PX)), int(math.ceil((z1 - z0) / PX))
    g = Grid(nz, nx, PX, nseed())
    rng = g.rng
    X = (x0 + (np.arange(nx) + 0.5) * (x1 - x0) / nx).astype(np.float32)[None, :]
    Z = (z0 + (np.arange(nz) + 0.5) * (z1 - z0) / nz).astype(np.float32)[:, None]
    X, Z = np.broadcast_to(X, (nz, nx)), np.broadcast_to(Z, (nz, nx))
    DT = np.full((nz, nx), 9.0, np.float32)
    # the neighbouring bay's post at x = 2 bounds this panel too
    shapes = P['timbers'] + [('rect', 2.0, 2.25, z0 - 1, z1 + 1), ('rect', -1.0, 0.0, z0 - 1, z1 + 1),
                             ('rect', -1.0, 3.0, z1, z1 + 1), ('rect', -1.0, 3.0, z0 - 1, z0)]
    for sh in shapes:
        DT = np.minimum(DT, rect_sdf(X, Z, *sh[1:]) if sh[0] == 'rect' else poly_sdf(X, Z, sh[1]))
    OPEN = np.zeros((nz, nx), bool)
    for (ox0, ox1, oz0, oz1) in P['openings']:
        OPEN |= (X > ox0) & (X < ox1) & (Z > oz0) & (Z < oz1)
    dd = np.clip(DT, 0, None)
    # ---- relief: gently bellied trowelled field
    belly = 0.005 * sstep(0.0, 0.35, dd) * (0.7 + 0.3 * g.noise(0.25))
    trowel = (0.0014 * g.fbm([(0.14, 1.0), (0.05, 0.6)]) + 0.0013 * g.fbm([(0.02, 1.0), (0.009, 0.7)])
              + 0.0006 * g.fbm([(0.004, 1.0), (0.0022, 0.6)]))
    # flattened trowel pads: broad calm areas where the float pressed the lumps down
    pad_ = sstep(0.3, 1.1, g.fbm([(0.06, 1.0), (0.02, 0.4)]))
    trowel = trowel * (1 - 0.55 * pad_) + 0.0006 * pad_
    swirl = 0.0002 * g.fbm([((0.02, 0.03), 1.0), ((0.03, 0.02), 1.0)])
    I1, _, IID, inc = g.worley(0.02)
    iv = rng.random(inc).astype(np.float32)
    lump = np.where(iv[IID] < 0.3, np.clip(1 - (I1 / (0.0012 + 0.006 * iv[IID])) ** 2, 0, 1) ** 0.6, 0) * 0.0012
    grain = 0.00007 * g.noise(0.0005) + 0.0001 * g.noise(0.0014)
    gw = 0.0011 + 0.0007 * sstep(-1, 1, g.noise(0.08))
    ret = sstep(gw, gw + 0.009, dd)
    repf = g.fbm([(0.09, 1.0), (0.03, 0.4)]) - 0.8 * np.exp(-dd / 0.05)
    rq = float(np.quantile(repf, 1 - rng.uniform(0.02, 0.05)))
    rep = sstep(rq, rq + 0.12, repf)
    H = (belly + trowel * (1 - 0.4 * rep) + swirl * (1 - 0.6 * rep) + grain + lump) * ret - 0.006 * (1 - ret) + 0.0004 * rep
    # ---- loss of the finish coat: stepped ragged edges revealing coarse backing
    zrel = (Z - z0) / (z1 - z0)
    lossf = (g.fbm([(0.13, 1.0), (0.05, 0.6)]) + 0.3 * g.fbm([(0.012, 1.0), (0.004, 0.6), (0.0015, 0.3)])
             + rng.uniform(0.9, 1.4) * np.exp(-dd / 0.06) * sstep(0.6, 1.4, g.noise(0.12))
             + (rng.uniform(0.0, 0.6) * (1 - sstep(0.0, 0.3, zrel)) * sstep(-0.5, 0.8, g.noise(0.25)) if ground else 0.0)
             + rng.uniform(-0.8, 0.1))
    frac = rng.uniform(0.004, 0.014)
    q1 = float(np.quantile(lossf[ret > 0.5], 1 - frac))
    q2 = float(np.quantile(lossf[ret > 0.5], 1 - 0.2 * frac))
    L1 = sstep(q1, q1 + 0.05, lossf) * ret
    L2 = sstep(q2, q2 + 0.05, lossf) * ret
    fl = FORCE_LOSS(name, X, Z)
    if not np.isscalar(fl):
        jag = fl + 0.18 * g.fbm([(0.01, 1.0), (0.004, 0.6), (0.0015, 0.3)])
        L1 = np.maximum(L1, sstep(0.45, 0.5, jag) * ret)
        L2 = np.maximum(L2, sstep(0.8, 0.85, jag) * ret)
        lossf = np.maximum(lossf, q1 + 0.1 * (jag - 0.45))
    L1 = L1 * sstep(0.35, 0.65, g.blur(L1, 0.014))
    L2 = L2 * sstep(0.3, 0.6, g.blur(L2, 0.01))
    B1, B2, BID, bnc = g.worley(0.0028)
    bv = rng.random(bnc).astype(np.float32)[BID]
    backing = 0.0016 * (bv - 0.5) - 0.0009 * (1 - sstep(0.0, 0.0006, B2 - B1)) + 0.001 * g.noise(0.004)
    H = H * (1 - L1) + L1 * (-0.0055 + backing + 0.2 * trowel) - 0.0025 * L2
    RIM = sstep(q1 - 0.1, q1, lossf) * (1 - L1) * ret     # freshly broken edge of the finish coat
    # ---- pits and hairline cracks
    PIT = np.zeros_like(H)
    for cell, prob, rmax, dk in [(0.005, 0.12, 0.0009, 0.7), (0.014, 0.3, 0.0022, 0.6)]:
        P1, _, PID, pnc = g.worley(cell)
        rr = rng.random(pnc).astype(np.float32); ex = rng.random(pnc).astype(np.float32)
        rad = rmax * (0.3 + 0.7 * rr[PID] ** 2)
        prof = np.clip(1 - (P1 / rad) ** 2, 0, 1) ** 0.7
        PIT = np.minimum(PIT, np.where(ex[PID] < prob, -dk * rad * prof, 0))
    PIT *= (1 - L1) * ret
    H += PIT
    corner_near = np.zeros_like(H)
    for (ox0, ox1, oz0, oz1) in P['openings']:
        for cx, cz in ((ox0 - 0.1, oz0 - 0.1), (ox1 + 0.1, oz0 - 0.1), (ox0 - 0.1, oz1 + 0.1), (ox1 + 0.1, oz1 + 0.1)):
            corner_near = np.maximum(corner_near, np.exp(-np.sqrt((X - cx) ** 2 + (Z - cz) ** 2) / 0.18))
    cf = np.abs(g.fbm([(0.03, 1.0), (0.01, 0.4), (0.004, 0.2)]))
    CRACK = (1 - sstep(0.0, 0.03, cf)) * np.clip(corner_near * 1.6 + 0.25 * sstep(0.8, 1.5, g.noise(0.2))
             + 1.0 * np.exp(-dd / 0.03) * sstep(0.1, 0.9, g.noise(0.15)), 0, 1) * ret * (1 - L1)
    H -= 0.0004 * CRACK
    # ---- colour
    col = srgb2lin((228, 205, 160)) * np.ones((nz, nx, 1), np.float32)
    col = mix(col, srgb2lin((222, 188, 136)), 0.4 * sstep(-1, 1, g.noise(0.35)))
    col = col * (1 + 0.05 * sstep(0.0, 0.0012, H - g.blur(H, 0.006)))[..., None]
    col = col * (1 + 0.035 * g.fbm([(0.2, 1.0), (0.07, 0.5)]) + 0.02 * g.fbm([(0.012, 1.0), (0.004, 0.5)]))[..., None]
    col = mix(col, srgb2lin((238, 216, 174)), 0.45 * rep)
    bcol = mix(srgb2lin((178, 156, 124)), srgb2lin((144, 124, 98)), bv)
    col = mix(col, bcol, L1)
    col = col * (1 + 0.04 * RIM)[..., None]
    col = mix(col, srgb2lin((120, 104, 84)), 0.45 * L2)
    # runoff streaks below horizontal timbers and sills
    RUN = np.zeros_like(H)
    st = (sstep(-0.2, 1.3, g.noise(0.2, 0.006)) * (0.5 + 0.5 * sstep(-1, 1, g.noise(0.05, 0.02)))
          * sstep(-0.6, 0.9, g.noise(0.5, 0.3)) * rng.uniform(0.4, 1.0))
    for (sx0, sx1, sz) in P['streaks'] + [(0.0, 2.0, z1)]:
        dz = sz - Z
        inx = sstep(sx0 - 0.02, sx0 + 0.03, X) * (1 - sstep(sx1 - 0.03, sx1 + 0.02, X))
        RUN = np.maximum(RUN, st * np.exp(-np.clip(dz, 0, None) / 0.45) * (dz > 0) * inx)
    col = mix(col, srgb2lin((124, 110, 88)), 0.6 * RUN)
    col = col * (1 - 0.1 * np.exp(-dd / 0.02))[..., None]
    grime = sstep(-0.2, 1.6, g.fbm([(0.35, 1.0), (0.12, 0.6), (0.04, 0.3)]))
    col = mix(col, srgb2lin((168, 154, 128)), 0.22 * grime)
    if ground:
        spl = (1 - sstep(0.0, 0.7 + 0.15 * g.noise(0.2), Z - z0))
        col = mix(col, srgb2lin((142, 122, 96)), 0.5 * spl)
        col = mix(col, srgb2lin((110, 92, 72)), 0.5 * spl * (g.rng.random((nz, nx)) < 0.02 * spl))
    col = mix(col, srgb2lin((120, 104, 86)), 0.55 * CRACK)
    col = mix(col, srgb2lin((176, 158, 128)), 0.2 * sstep(0.0001, 0.0008, -PIT))
    cav = np.clip((g.blur(H, 0.003) - H) / 0.003, 0, 0.3)
    col = col * (1 - cav)[..., None]
    R = np.clip(0.9 + 0.05 * L1 - 0.05 * rep, 0, 1)
    Hl = g.blur(H, 0.55 * VSPACE)
    N = tangent_normal(H - Hl, (x1 - x0) / nx, (z1 - z0) / nz)
    lo, hi = float(Hl.min()), float(Hl.max())
    base = os.path.join(MAPS, 'plaster-' + name)
    write_png(base + '-albedo.png', np.round(lin2srgb(col) * 255))
    write_png(base + '-normal.png', np.round((N * 0.5 + 0.5) * 255))
    write_png(base + '-roughness.png', np.round(R * 255))
    write_png(base + '-height.png', np.round((Hl - lo) / (hi - lo) * 65535), 16)
    PLASTER[name] = dict(range=(lo, hi), rect=(x0, x1, z0, z1))


t_p = time.perf_counter()
for name in PIECES:
    if PIECES[name]['plaster']:
        plaster_field(name)
log('plaster fields %.1fs' % (time.perf_counter() - t_p))


# ================================================================= small tiled maps: mortar and foot soil
def soil_tile(n, size, seed, moss=0.0):
    px = size / n
    g = Grid(n, n, px, seed)
    rng = g.rng
    S1, S2, SID, snc = g.worley(0.0028)
    sv = rng.random(snc).astype(np.float32)[SID]
    H = 0.0012 * (1 - sstep(0.0, 0.0014, S1)) * (sv > 0.3) * (0.5 + sv) + 0.0005 * g.noise(0.0015) + 0.0012 * g.noise(0.006)
    dry = sstep(-0.8, 1.2, g.fbm([(0.03, 1.0), (0.008, 0.6)]))
    col = mix(srgb2lin((56, 42, 30)), srgb2lin((98, 80, 58)), dry)
    col = col * (0.8 + 0.4 * sv)[..., None] * (1 - 0.3 * (1 - sstep(0.0, 0.0004, S2 - S1)))[..., None]
    grit = g.blur((rng.random((n, n)) > 0.992).astype(np.float32), 0.0005)
    grit = np.clip(grit / (grit.max() + 1e-6) * 1.4, 0, 0.8)
    col = mix(col, srgb2lin((176, 164, 140)), grit)
    H += 0.0015 * grit
    if moss:
        mm = sstep(0.8, 1.4, g.fbm([(0.03, 1.0), (0.01, 0.5)])) * moss
        col = mix(col, srgb2lin((66, 82, 32)), 0.8 * mm)
        H += 0.001 * mm
    return H.astype(np.float32), col, 0.95 + 0 * H, g


def oak_detail_tile(nu=1024, nv=512, px=0.00025):
    g = Grid(nv, nu, px, nseed())
    fibres = g.noise(0.00012, 0.004)
    fib2 = g.noise(0.0003, 0.012)
    split = (1 - sstep(0.0, 0.05, np.abs(g.noise(0.00022, 0.03)))) * sstep(0.7, 1.3, g.noise(0.002, 0.04))
    pore = sstep(1.7, 2.3, g.noise(0.00018, 0.0012))
    h = 0.5 * fibres + 0.3 * fib2 - 1.6 * split - 1.0 * pore
    h = (h - h.min()) / (h.max() - h.min())
    a = np.clip(0.55 + 0.25 * sstep(-2, 2, fibres + 0.5 * fib2) - 0.35 * split - 0.3 * pore, 0, 1)
    write_png(os.path.join(MAPS, 'oak-detail-height.png'), np.round(h * 65535), 16)
    write_png(os.path.join(MAPS, 'oak-detail-albedo.png'), np.round(a * 255))
    return nu * px, nv * px


OAK_DETAIL = oak_detail_tile()


def write_tile(name, H, col, R, g, px):
    Hl = g.blur(H, 0.55 * VSPACE)
    N = tangent_normal(H - Hl, px, px)
    lo, hi = float(Hl.min()), float(Hl.max())
    write_png(os.path.join(MAPS, name + '-albedo.png'), np.round(lin2srgb(col) * 255))
    write_png(os.path.join(MAPS, name + '-normal.png'), np.round((N * 0.5 + 0.5) * 255))
    write_png(os.path.join(MAPS, name + '-roughness.png'), np.round(np.clip(R, 0, 1) * 255))
    write_png(os.path.join(MAPS, name + '-height.png'), np.round((Hl - lo) / (hi - lo) * 65535), 16)
    return (lo, hi)


TILE_M = 1.0
ntile = int(round(TILE_M / (PX * 1.5)))
H, col, R, g = soil_tile(ntile, TILE_M, nseed(), moss=0.5)
MORTAR_RANGE = write_tile('mortar', H, mix(col, srgb2lin((150, 136, 110)), 0.45), R, g, TILE_M / ntile)
H, col, R, g = soil_tile(ntile, TILE_M, nseed(), moss=0.35)
SOIL_RANGE = write_tile('soil', H, col, R, g, TILE_M / ntile)
log('tiles')

# ================================================================= Blender scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
scene = bpy.context.scene


def load_img(path, colorspace):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def new_mat(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    return mat, nt.nodes, nt.links, nt.nodes['Material Output']


MATS = []


def mapped_material(name, prefix, spec=0.4):
    mat, nn, ll, mo = new_mat(name)
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'
    bs.inputs['Specular IOR Level'].default_value = spec
    ta = nn.new('ShaderNodeTexImage'); ta.name = 'ALB'; ta.interpolation = 'Cubic'
    ta.image = load_img(prefix + '-albedo.png', 'sRGB')
    tr = nn.new('ShaderNodeTexImage'); tr.image = load_img(prefix + '-roughness.png', 'Non-Color')
    tn = nn.new('ShaderNodeTexImage'); tn.image = load_img(prefix + '-normal.png', 'Non-Color'); tn.interpolation = 'Cubic'
    nm = nn.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'
    ll.new(ta.outputs['Color'], bs.inputs['Base Color'])
    ll.new(tr.outputs['Color'], bs.inputs['Roughness'])
    ll.new(tn.outputs['Color'], nm.inputs['Color'])
    ll.new(nm.outputs['Normal'], bs.inputs['Normal'])
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    MATS.append(mat)
    return mat


def displace(ob, prefix, rng_, levels=None):
    m = ob.modifiers.new('Subdiv', 'SUBSURF')
    m.subdivision_type = 'SIMPLE'
    m.levels = m.render_levels = A.subdiv if levels is None else levels
    tex = bpy.data.textures.get(prefix) or bpy.data.textures.new(prefix, 'IMAGE')
    tex.image = load_img(os.path.join(MAPS, prefix + '-height.png'), 'Non-Color')
    tex.extension = 'EXTEND'
    tex.use_interpolation = True
    lo, hi = rng_
    m = ob.modifiers.new('Displace', 'DISPLACE')
    m.texture = tex
    m.texture_coords = 'UV'
    m.uv_layer = 'UVMap'
    m.direction = 'NORMAL'
    m.strength = hi - lo
    m.mid_level = -lo / (hi - lo)


MAT_CLS = {cls: mapped_material('kit-' + cls, os.path.join(MAPS, cls), 0.22 if cls == 'oak' else 0.4) for cls in ATLAS}


def add_detail(mat, W, H_, px, tile):
    nt = mat.node_tree; nn, ll = nt.nodes, nt.links
    bs, ta = nn['BSDF'], nn['ALB']
    tc = nn.new('ShaderNodeTexCoord')
    vm = nn.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY'
    vm.inputs[1].default_value = (W * px / tile[0], H_ * px / tile[1], 1.0)
    ll.new(tc.outputs['UV'], vm.inputs[0])
    dh = nn.new('ShaderNodeTexImage'); dh.image = load_img(os.path.join(MAPS, 'oak-detail-height.png'), 'Non-Color')
    da = nn.new('ShaderNodeTexImage'); da.image = load_img(os.path.join(MAPS, 'oak-detail-albedo.png'), 'Non-Color')
    for t_ in (dh, da):
        t_.extension = 'REPEAT'
        ll.new(vm.outputs['Vector'], t_.inputs['Vector'])
    nm_link = bs.inputs['Normal'].links[0]
    nm_out = nm_link.from_socket
    ll.remove(nm_link)
    mk = nn.new('ShaderNodeTexImage'); mk.image = load_img(os.path.join(MAPS, 'oak-detailmask.png'), 'Non-Color'); mk.interpolation = 'Closest'
    msc = nn.new('ShaderNodeMath'); msc.operation = 'MULTIPLY'; msc.inputs[1].default_value = 0.6
    ll.new(mk.outputs['Color'], msc.inputs[0])
    bp = nn.new('ShaderNodeBump'); bp.inputs['Distance'].default_value = 0.0003
    ll.new(msc.outputs[0], bp.inputs['Strength'])
    ll.new(dh.outputs['Color'], bp.inputs['Height'])
    ll.new(nm_out, bp.inputs['Normal'])
    ll.new(bp.outputs['Normal'], bs.inputs['Normal'])
    mr = nn.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 0.82; mr.inputs['To Max'].default_value = 1.15
    ll.new(da.outputs['Color'], mr.inputs['Value'])
    ta.name = 'ALB-base'
    mul = nn.new('ShaderNodeVectorMath'); mul.operation = 'MULTIPLY'; mul.name = 'ALB'
    mx = nn.new('ShaderNodeMix'); mx.data_type = 'FLOAT'
    ll.new(mk.outputs['Color'], mx.inputs[0]); mx.inputs[2].default_value = 1.0
    ll.new(mr.outputs['Result'], mx.inputs[3])
    ll.new(ta.outputs['Color'], mul.inputs[0]); ll.new(mx.outputs[0], mul.inputs[1])
    for l_ in list(bs.inputs['Base Color'].links):
        ll.remove(l_)
    ll.new(mul.outputs[0], bs.inputs['Base Color'])


add_detail(MAT_CLS['oak'], ATLAS['oak']['W'], ATLAS['oak']['H'], OPX, OAK_DETAIL)


def member_mesh(ms, name):
    V, F, UV, SHARP = [], [], [], []
    nv = 0
    for m in ms:
        at = ATLAS[m.cls]
        W, Hh = at['W'], at['H']
        sc = np.linspace(0.0, m.L, max(1, int(math.ceil(m.L / A.coarse))) + 1)
        tc = m.tc
        if m.closed:
            tc = np.append(tc, m.tB)
        b, a, _, _, _ = m.prof.eval(tc)
        S_, T_ = np.meshgrid(sc, np.arange(len(tc)), indexing='ij')
        P = m.world(S_.ravel(), b[T_.ravel()], a[T_.ravel()])
        rx, ry = at['pos'][(id(m), 'strip')]
        u = (rx + S_ / m.pxs) / W
        v = (ry + (tc[T_] - m.tA) / m.pxt) / Hh
        ns_, nt_ = len(sc), len(tc)
        idx = nv + np.arange(ns_ * nt_).reshape(ns_, nt_)
        uvg = np.stack([u, v], -1)
        for i in range(ns_ - 1):
            for j in range(nt_ - 1):
                F.append((idx[i, j], idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]))
                UV.append((uvg[i, j], uvg[i + 1, j], uvg[i + 1, j + 1], uvg[i, j + 1]))
        V.append(P)
        nv += ns_ * nt_
        ring_n = len(m.tc)
        for k, send in (('cap0', 0), ('cap1', -1)):
            if k not in m.rects:
                continue
            ring = list(idx[send, :ring_n])
            cb, ca = m.cap_ab
            b0, _, a0, _ = m.cap_box
            rx, ry = at['pos'][(id(m), k)]
            cu = (rx + (cb - b0) / m.px) / W
            cv = (ry + (ca - a0) / m.px) / Hh
            order = list(range(ring_n))
            if send == -1:
                order = order[::-1]
            SHARP += [(ring[order[i]], ring[order[(i + 1) % ring_n]]) for i in range(ring_n)]
            # concentric rings shrinking to the centroid give even quads for subdivision/displacement
            sc_ = 0.0 if send == 0 else m.L
            bc, ac = cb.mean(), ca.mean()
            K = max(1, int(math.ceil(max(cb.max() - cb.min(), ca.max() - ca.min()) / 2 / A.coarse)))
            prev = [ring[i] for i in order]
            prev_uv = [(cu[i], cv[i]) for i in order]
            for kk in range(1, K + 1):
                f_ = 1 - kk / (K + 0.35)
                rb = bc + (cb[order] - bc) * f_
                ra = ac + (ca[order] - ac) * f_
                Pk = m.world(np.full(ring_n, sc_), rb, ra)
                cur = list(range(nv, nv + ring_n))
                V.append(Pk)
                nv += ring_n
                cur_uv = list(zip((rx + (rb - b0) / m.px) / W, (ry + (ra - a0) / m.px) / Hh))
                for i in range(ring_n):
                    i2 = (i + 1) % ring_n
                    F.append((prev[i], prev[i2], cur[i2], cur[i]))
                    UV.append((prev_uv[i], prev_uv[i2], cur_uv[i2], cur_uv[i]))
                prev, prev_uv = cur, cur_uv
            F.append(tuple(prev))
            UV.append(tuple(prev_uv))
    V = np.concatenate(V)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], [tuple(int(x) for x in f) for f in F])
    uvl = me.uv_layers.new(name='UVMap')
    uvl.data.foreach_set('uv', np.array([c for f in UV for c in f], np.float32).ravel())
    me.shade_smooth()
    if SHARP:
        sh = np.sort(np.array(SHARP, np.int64), 1)
        ev = np.zeros(2 * len(me.edges), np.int64)
        me.edges.foreach_get('vertices', ev)
        ev = np.sort(ev.reshape(-1, 2), 1)
        att = me.attributes.get('sharp_edge') or me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        att.data.foreach_set('value', np.isin(ev[:, 0] * nv + ev[:, 1], sh[:, 0] * nv + sh[:, 1]))
    return me


def plaster_mesh(name):
    x0, x1, z0, z1 = PLASTER[name]['rect']
    nx, nz = int(math.ceil((x1 - x0) / A.coarse)), int(math.ceil((z1 - z0) / A.coarse))
    xs, zs = np.linspace(x0, x1, nx + 1), np.linspace(z0, z1, nz + 1)
    XX, ZZ = np.meshgrid(xs, zs)
    V = np.stack([XX.ravel(), np.zeros(XX.size), ZZ.ravel()], 1)
    idx = np.arange(V.shape[0]).reshape(nz + 1, nx + 1)
    faces = []
    for i in range(nz):
        for j in range(nx):
            cx, cz = (xs[j] + xs[j + 1]) / 2, (zs[i] + zs[i + 1]) / 2
            if any(ox0 < cx < ox1 and oz0 < cz < oz1 for (ox0, ox1, oz0, oz1) in PIECES[name]['openings']):
                continue
            faces.append((idx[i, j], idx[i, j + 1], idx[i + 1, j + 1], idx[i + 1, j]))  # normal -y
    me = bpy.data.meshes.new('plaster-' + name)
    me.from_pydata(V.tolist(), [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    lv = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', lv)
    uv = np.stack([(V[lv, 0] - x0) / (x1 - x0), (V[lv, 2] - z0) / (z1 - z0)], 1)
    uvl.data.foreach_set('uv', uv.astype(np.float32).ravel())
    me.shade_smooth()
    return me


def box_mesh(name, lo, hi, inward=False, uv_scale=1.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector([lo[i] + (v.co[i] + 0.5) * (hi[i] - lo[i]) for i in range(3)])
    if inward:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        u_ax, v_ax = [(1, 2), (0, 2), (0, 1)][ax]
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co[u_ax] / uv_scale, lp.vert.co[v_ax] / uv_scale)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


# ---------------------------------------------------------------- simple procedural materials
def iron_material():
    mat, nn, ll, mo = new_mat('kit-iron')
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'
    tc = nn.new('ShaderNodeTexCoord')
    nz = nn.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 60.0; nz.inputs['Detail'].default_value = 8
    ll.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nn.new('ShaderNodeValToRGB'); ramp.name = 'ALB'
    ramp.color_ramp.elements[0].position = 0.45; ramp.color_ramp.elements[0].color = (0.035, 0.032, 0.03, 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (0.16, 0.07, 0.03, 1)
    ll.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    ll.new(ramp.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Metallic'].default_value = 0.55
    bs.inputs['Roughness'].default_value = 0.62
    bp = nn.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.35
    ll.new(nz.outputs['Fac'], bp.inputs['Height']); ll.new(bp.outputs['Normal'], bs.inputs['Normal'])
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    MATS.append(mat)
    return mat


def glass_material():
    mat, nn, ll, mo = new_mat('kit-glass')
    bs = nn.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Base Color'].default_value = (0.72, 0.78, 0.72, 1)
    bs.inputs['Transmission Weight'].default_value = 1.0
    bs.inputs['Roughness'].default_value = 0.02
    bs.inputs['IOR'].default_value = 1.52
    tc = nn.new('ShaderNodeTexCoord')
    nz = nn.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 9.0; nz.inputs['Detail'].default_value = 3
    ll.new(tc.outputs['Object'], nz.inputs['Vector'])
    nz2 = nn.new('ShaderNodeTexNoise'); nz2.inputs['Scale'].default_value = 45.0; nz2.inputs['Detail'].default_value = 2
    ll.new(tc.outputs['Object'], nz2.inputs['Vector'])
    mxn = nn.new('ShaderNodeMath'); mxn.operation = 'ADD'
    ll.new(nz.outputs['Fac'], mxn.inputs[0]); ll.new(nz2.outputs['Fac'], mxn.inputs[1])
    bp = nn.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.35
    ll.new(mxn.outputs[0], bp.inputs['Height']); ll.new(bp.outputs['Normal'], bs.inputs['Normal'])
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    return mat


def dark_material():
    mat, nn, ll, mo = new_mat('interior')
    bs = nn.new('ShaderNodeBsdfDiffuse'); bs.inputs['Color'].default_value = (0.045, 0.038, 0.03, 1)
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    return mat


MAT_IRON, MAT_GLASS, MAT_DARK = iron_material(), glass_material(), dark_material()
MAT_MORTAR = mapped_material('mortar', os.path.join(MAPS, 'mortar'))
MAT_SOIL = mapped_material('soil', os.path.join(MAPS, 'soil'))


def iron_mesh(parts, name):
    bm = bmesh.new()
    for p in parts:
        if p[0] == 'box':
            _, c, size, rot = p
            r = bmesh.ops.create_cube(bm, size=1.0)
            for v in r['verts']:
                v.co = Vector((c[0] + v.co.x * size[0], c[1] + v.co.y * size[1], c[2] + v.co.z * size[2]))
            bmesh.ops.bevel(bm, geom=list({e for v in r['verts'] for e in v.link_edges}), offset=0.0015, segments=2, affect='EDGES')
        elif p[0] == 'cyl':
            _, c, rad, depth, axis = p
            r = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=rad, radius2=rad, depth=depth)
            rotm = Matrix.Rotation(math.pi / 2, 3, 'X') if axis == 'y' else Matrix.Identity(3)
            for v in r['verts']:
                v.co = rotm @ v.co + Vector(c)
        elif p[0] == 'ring':
            _, c, rad, th = p
            nu, nv = 24, 8  # a torus hanging flat against the door
            vs = [[bm.verts.new((c[0] + (rad + th * math.cos(q)) * math.cos(p_), c[1] + th * math.sin(q),
                                 c[2] + (rad + th * math.cos(q)) * math.sin(p_)))
                   for q in np.linspace(0, 2 * math.pi, nv, endpoint=False)]
                  for p_ in np.linspace(0, 2 * math.pi, nu, endpoint=False)]
            for i in range(nu):
                for j in range(nv):
                    bm.faces.new((vs[i][j], vs[(i + 1) % nu][j], vs[(i + 1) % nu][(j + 1) % nv], vs[i][(j + 1) % nv]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MAT_IRON)
    return me


# ---------------------------------------------------------------- kit piece collections
KIT = {}
for name in PIECES:
    coll = bpy.data.collections.new('kit-' + name)
    KIT[name] = coll
    for cls in ('oak', 'stone'):
        ms = [m for m in MEMBERS if m.cls == cls and m.obj == name]
        if ms:
            me = member_mesh(ms, '%s-%s' % (name, cls))
            me.materials.append(MAT_CLS[cls])
            ob = bpy.data.objects.new('%s-%s' % (name, cls), me)
            coll.objects.link(ob)
            displace(ob, cls, HRANGE[cls])
    if PIECES[name]['plaster']:
        ob = bpy.data.objects.new('plaster-' + name, plaster_mesh(name))
        ob.data.materials.append(mapped_material('plaster-' + name, os.path.join(MAPS, 'plaster-' + name)))
        coll.objects.link(ob)
        displace(ob, 'plaster-' + name, PLASTER[name]['range'])
    if PIECES[name]['iron']:
        coll.objects.link(bpy.data.objects.new('iron-' + name, iron_mesh(PIECES[name]['iron'], 'iron-' + name)))
    for (gx0, gx1, gz0, gz1, ga) in PIECES[name]['glass']:
        me = bpy.data.meshes.new('glass-' + name)
        me.from_pydata([(gx0, -ga, gz0), (gx1, -ga, gz0), (gx1, -ga, gz1), (gx0, -ga, gz1)], [], [(0, 1, 2, 3)])
        me.materials.append(MAT_GLASS)
        gob = bpy.data.objects.new('glass-' + name, me)
        sm = gob.modifiers.new('Solidify', 'SOLIDIFY'); sm.thickness = 0.004
        coll.objects.link(gob)
log('kit pieces built')

for i, (name, M) in enumerate(PLACE):
    e = bpy.data.objects.new('place-%02d-%s' % (i, name), None)
    e.instance_type = 'COLLECTION'
    e.instance_collection = KIT[name]
    e.matrix_world = M
    scene.collection.objects.link(e)

ms = [m for m in MEMBERS if m.obj == 'plinth-foot']
me = member_mesh(ms, 'plinth-foot')
me.materials.append(MAT_CLS['stone'])
ob = bpy.data.objects.new('plinth-foot', me)
scene.collection.objects.link(ob)
displace(ob, 'stone', HRANGE['stone'])
# plinth runs, mortar cores, foot soil
for run in RUNS:
    ms = [m for m in MEMBERS if m.obj == 'plinth-' + run['name']]
    me = member_mesh(ms, 'plinth-' + run['name'])
    me.materials.append(MAT_CLS['stone'])
    ob = bpy.data.objects.new('plinth-' + run['name'], me)
    scene.collection.objects.link(ob)
    displace(ob, 'stone', HRANGE['stone'])
    o3, d3, ov = np.array(run['origin'], float), np.array(run['d'], float), np.array(run['o'], float)
    lo_x = min(run['c1'][0], run['c2'][0]); hi_x = max(run['c1'][1], run['c2'][1])
    segs = [(lo_x, hi_x)] if not run['gap'] else [(lo_x, run['gap'][0] - 0.005), (run['gap'][1] + 0.005, hi_x)]
    for k, (sx0, sx1) in enumerate(segs):
        # core: from 15 mm behind the stone faces to the wall back, carrying the mortar joints
        pts = [o3 + d3 * x + ov * a for x in (sx0 + 0.04, sx1 - 0.04) for a in (PL_A1 - 0.014, PL_BACK)]
        lo = np.min(pts, 0); hi = np.max(pts, 0)
        lo[2], hi[2] = -0.06, 0.482
        ob = bpy.data.objects.new('mortar-%s-%d' % (run['name'], k), box_mesh('mortar', lo, hi, uv_scale=TILE_M))
        ob.data.materials.append(MAT_MORTAR)
        scene.collection.objects.link(ob)
        # foot soil: a strip banked against the plinth, falling below the paving tops
        ex0 = sx0 - (FOOT + 0.3 if k == 0 else 0.0)
        ex1 = sx1 + (FOOT + 0.3 if k == len(segs) - 1 and run['name'] == 'front' else 0.0)
        L = ex1 - ex0
        nx = max(2, int(math.ceil(L / A.coarse))); nw = 14
        xs = np.linspace(ex0, ex1, nx + 1); ws = np.linspace(0.0, 0.30, nw + 1)
        XX, WW = np.meshgrid(xs, ws, indexing='ij')
        rngs = np.random.default_rng(nseed())
        ph = rngs.uniform(0, 6, 3)
        width = 0.17 + 0.07 * np.sin(XX * 1.7 + ph[0]) + 0.04 * np.sin(XX * 5.3 + ph[1])
        zz = 0.022 * (1 - sstep(0.0, 1.0, WW / width)) + 0.008 - 0.035 * sstep(0.75, 1.3, WW / width) + 0.003 * np.sin(XX * 9 + ph[2])
        inside = sstep(-0.12, 0.0, XX - min(run['c1'][0], run['c2'][0]) + FOOT + 0.02) * sstep(-0.12, 0.0, (max(run['c1'][1], run['c2'][1]) + (FOOT if run['name'] == 'front' else 0.0)) + 0.02 - XX)
        zz = zz * inside - 0.03 * (1 - inside)
        P3 = o3[None, None, :] + d3[None, None, :] * XX[..., None] + ov[None, None, :] * (PL_A1 + 0.005 + WW)[..., None]
        P3[..., 2] = zz - (0.001 if run['name'] != 'front' else 0.0)
        idx = np.arange((nx + 1) * (nw + 1)).reshape(nx + 1, nw + 1)
        faces = [(idx[i, j], idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]) for i in range(nx) for j in range(nw)]
        me = bpy.data.meshes.new('soil')
        me.from_pydata(P3.reshape(-1, 3).tolist(), [], faces)
        if np.cross(d3, ov)[2] < 0:
            me.flip_normals()
        uvl = me.uv_layers.new(name='UVMap')
        lv = np.zeros(len(me.loops), np.int32)
        me.loops.foreach_get('vertex_index', lv)
        Pf = P3.reshape(-1, 3)
        uvl.data.foreach_set('uv', (np.stack([Pf[lv, 0] + Pf[lv, 1] * 0.37, Pf[lv, 1] - Pf[lv, 0] * 0.37], 1) / TILE_M).astype(np.float32).ravel())
        me.shade_smooth()
        me.materials.append(MAT_SOIL)
        ob = bpy.data.objects.new('soil-%s-%d' % (run['name'], k), me)
        scene.collection.objects.link(ob)
        displace(ob, 'soil', SOIL_RANGE, levels=max(0, A.subdiv - 1))
log('plinth runs built')

# interior: a closed dark volume seen through the windows
ob = bpy.data.objects.new('interior', box_mesh('interior', (0.26, 0.26, 0.0), (11.99, 6.2, 6.49), inward=True))
ob.data.materials.append(MAT_DARK)
scene.collection.objects.link(ob)

# ---------------------------------------------------------------- approved paving (photoreal candidate1 maps)
PM = os.path.join(A.paving, 'maps')
with open(os.path.join(A.paving, 'receipt.json'), encoding='utf-8') as f:
    prc = json.load(f)
phmin, phmax = prc['heightRangeMetres']
pav_coll = bpy.data.collections.new('PavingTile')
g_ = 200
xs = np.linspace(0, 4.0, g_ + 1)
XX, YY = np.meshgrid(xs, xs)
verts = np.stack([XX.ravel(), YY.ravel(), np.zeros(XX.size)], 1)
idx = np.arange((g_ + 1) ** 2).reshape(g_ + 1, g_ + 1)
faces = np.stack([idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()], 1)
me = bpy.data.meshes.new('PavingGround')
me.from_pydata(verts.tolist(), [], faces.tolist())
uvl = me.uv_layers.new(name='UVMap')
lv = np.zeros(len(me.loops), np.int32)
me.loops.foreach_get('vertex_index', lv)
uvl.data.foreach_set('uv', (verts[lv, :2] / 4.0).astype(np.float32).ravel())
me.shade_smooth()
pav = bpy.data.objects.new('PavingGround', me)
pav_coll.objects.link(pav)
pav.location.z = phmin
m = pav.modifiers.new('Subdiv', 'SUBSURF'); m.subdivision_type = 'SIMPLE'; m.levels = m.render_levels = A.paving_subdiv
ptex = bpy.data.textures.new('PavingHeight', 'IMAGE')
ptex.image = load_img(os.path.join(PM, 'height.png'), 'Non-Color')
ptex.extension = 'REPEAT'
m = pav.modifiers.new('Displace', 'DISPLACE'); m.texture = ptex; m.texture_coords = 'UV'; m.direction = 'Z'
m.mid_level = 0.0; m.strength = phmax - phmin
pmat, nn, ll, mo = new_mat('paving')
bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'
ta = nn.new('ShaderNodeTexImage'); ta.name = 'ALB'; ta.image = load_img(os.path.join(PM, 'albedo.png'), 'sRGB'); ta.interpolation = 'Cubic'
tr = nn.new('ShaderNodeTexImage'); tr.image = load_img(os.path.join(PM, 'roughness.png'), 'Non-Color')
tn = nn.new('ShaderNodeTexImage'); tn.image = load_img(os.path.join(PM, 'normal.png'), 'Non-Color'); tn.interpolation = 'Cubic'
nm = nn.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'
ll.new(ta.outputs['Color'], bs.inputs['Base Color']); ll.new(tr.outputs['Color'], bs.inputs['Roughness'])
ll.new(tn.outputs['Color'], nm.inputs['Color']); ll.new(nm.outputs['Normal'], bs.inputs['Normal'])
ll.new(bs.outputs[0], mo.inputs['Surface'])
me.materials.append(pmat)
MATS.append(pmat)
for ty in range(-4, 2):
    for tx in range(-3, 5):
        e = bpy.data.objects.new('Paving_%d_%d' % (tx, ty), None)
        e.instance_type = 'COLLECTION'
        e.instance_collection = pav_coll
        e.location = (tx * 4.0 - 0.37, ty * 4.0 + 0.21, 0)
        scene.collection.objects.link(e)
# Ground to the horizon beyond the paving patch (candidate 19; engine package 7): the same paving,
# undisplaced, 2 cm under the patch's lowest point. Blender's Hosek-Wilkie sky stays bright below
# the horizon (about ten times the paving's radiance), and walls saw it past the patch's edge: 13-37%
# more sky light than the street they stand in, and than the game's ground bounce models.
fme = bpy.data.meshes.new('FarGround')
fv = np.array([(-2000, -2000, 0), (2000, -2000, 0), (2000, 2000, 0), (-2000, 2000, 0)], float)
fme.from_pydata(fv.tolist(), [], [(0, 1, 2, 3)])
fuv = fme.uv_layers.new(name='UVMap')
# The paving tiles' UVs: tile-local metres / 4 from the grid origin (-0.37, 0.21).
fuv.data.foreach_set('uv', ((fv[:, :2] - (-0.37, 0.21)) / 4.0).astype(np.float32).ravel())
far = bpy.data.objects.new('FarGround', fme)
far.location.z = phmin - 0.02
scene.collection.objects.link(far)
far.data.materials.append(pmat)
log('paving placed')


# ---------------------------------------------------------------- plants at the plinth foot (paving recipe)
def leaf_texture(w=512, h=256, seed=0, dry=0.0):
    r = np.random.default_rng(seed)
    u = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    v = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
    mot = np.clip(0.5 + 0.35 * np.sin(u * 23 + r.uniform(0, 6)) * np.cos(v * 9 + r.uniform(0, 6)), 0, 1)
    col = srgb2lin((80, 100, 50)) * (1 - mot[..., None]) + srgb2lin((104, 122, 62)) * mot[..., None]
    mid = np.exp(-(v / 0.045) ** 2)
    f = np.mod(u * 7.5 - np.abs(v) * 1.6, 1.0)
    vein = np.exp(-(np.minimum(f, 1 - f) / 0.035) ** 2) * (np.abs(v) < 0.9) * (u > 0.05)
    col = col * (1 + 0.35 * mid[..., None] + 0.12 * vein[..., None])
    col = col * (1 - 0.5 * mid[..., None]) + srgb2lin((160, 170, 110)) * 0.5 * mid[..., None]
    col = col * (1 - 0.35 * vein[..., None]) + srgb2lin((140, 156, 96)) * 0.35 * vein[..., None]
    edge = sstep(0.8, 1.0, np.abs(v)) + sstep(0.85, 1.0, u)
    col = col * (1 - 0.3 * edge[..., None] * dry) + srgb2lin((150, 120, 60)) * 0.3 * edge[..., None] * dry
    return np.clip(col, 0, 1)


def grass_texture(w=64, h=256):
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
    col = (srgb2lin((150, 160, 90)) * (1 - sstep(0, 0.2, t))[..., None]
           + srgb2lin((88, 120, 40)) * (sstep(0, 0.2, t) * (1 - sstep(0.75, 1, t)))[..., None]
           + srgb2lin((170, 150, 96)) * sstep(0.75, 1, t)[..., None])
    return np.clip(col, 0, 1)


def plant_mat(name, arr, trans, rough):
    path = os.path.join(MAPS, name + '.png')
    write_png(path, np.round(lin2srgb(arr) * 255))
    mat, nn, ll, mo = new_mat(name)
    ti = nn.new('ShaderNodeTexImage'); ti.image = load_img(path, 'sRGB'); ti.name = 'ALB'
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'; bs.inputs['Roughness'].default_value = rough
    bs.inputs['Specular IOR Level'].default_value = 0.22
    tl = nn.new('ShaderNodeBsdfTranslucent')
    bp = nn.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; bp.inputs['Distance'].default_value = 0.0005
    ll.new(ti.outputs['Color'], bp.inputs['Height']); ll.new(bp.outputs['Normal'], bs.inputs['Normal'])
    mx = nn.new('ShaderNodeMixShader'); mx.inputs['Fac'].default_value = trans
    ll.new(ti.outputs['Color'], bs.inputs['Base Color']); ll.new(ti.outputs['Color'], tl.inputs['Color'])
    ll.new(bs.outputs[0], mx.inputs[1]); ll.new(tl.outputs[0], mx.inputs[2])
    ll.new(mx.outputs[0], mo.inputs['Surface'])
    MATS.append(mat)
    return mat


PLANT_MATS = [plant_mat('leaf%d' % i, leaf_texture(seed=i, dry=d), 0.22, 0.72) for i, d in enumerate([0.2, 0.6, 1.0])]
stem_mat, nn, ll, mo = new_mat('stem')
bs = nn.new('ShaderNodeBsdfPrincipled'); bs.inputs['Base Color'].default_value = (*srgb2lin((120, 130, 70)), 1)
ll.new(bs.outputs[0], mo.inputs['Surface'])
PLANT_MATS += [stem_mat, plant_mat('grass', grass_texture(), 0.35, 0.5)]


def rot_z(p, a):
    c, s = math.cos(a), math.sin(a)
    return np.stack([p[..., 0] * c - p[..., 1] * s, p[..., 0] * s + p[..., 1] * c, p[..., 2]], -1)


def rot_y(p, a):
    c, s = math.cos(a), math.sin(a)
    return np.stack([p[..., 0] * c - p[..., 2] * s, p[..., 1], p[..., 0] * s + p[..., 2] * c], -1)


class MB:
    def __init__(self):
        self.v, self.f, self.uv, self.mi = [], [], [], []

    def add_grid(self, P, UV, mi):
        nu, nv = P.shape[:2]
        base = sum(len(x) for x in self.v)
        self.v.append(P.reshape(-1, 3))
        for i in range(nu - 1):
            for j in range(nv - 1):
                a = base + i * nv + j
                self.f.append((a, a + nv, a + nv + 1, a + 1))
                self.uv.append([UV[i, j], UV[i + 1, j], UV[i + 1, j + 1], UV[i, j + 1]])
                self.mi.append(mi)


def add_leaf(mb, root, phi, pitch, L, W, pet, mi, rng):
    u = np.linspace(0, 1, 14)[:, None]
    v = np.linspace(-1, 1, 7)[None, :]
    w = 0.5 * W * np.sin(math.pi * np.clip(u, 0, 1) ** 0.72) ** 0.6
    z = rng.uniform(0.15, 0.4) * np.abs(v) ** 1.6 * w - L * (rng.uniform(0.15, 0.35) * u ** 2)
    P = np.stack(np.broadcast_arrays(u * L + pet, v * w, z), -1).astype(float)
    P = rot_z(rot_y(P, pitch), phi) + root
    mb.add_grid(P, np.stack([u * np.ones_like(v), (v + 1) / 2 * np.ones_like(u)], -1), mi)


def add_rosette(mb, root, rng, scale=1.0):
    n = rng.integers(5, 9)
    phi0 = rng.uniform(0, 2 * math.pi)
    for k in range(n):
        inner = k >= n - 2
        L = scale * (rng.uniform(0.022, 0.04) if inner else rng.uniform(0.035, 0.06))
        add_leaf(mb, root, phi0 + 2 * math.pi * k / n + rng.normal(0, 0.25),
                 rng.uniform(0.7, 1.1) if inner else rng.uniform(0.35, 0.7), L, L * rng.uniform(0.6, 0.8),
                 scale * (rng.uniform(0.004, 0.01) if inner else rng.uniform(0.01, 0.024)), int(rng.integers(0, 3)), rng)


def add_grass(mb, root, rng, nb=None, hscale=1.0):
    for _ in range(nb or int(rng.integers(6, 16))):
        Lb = hscale * rng.uniform(0.04, 0.14)
        wb = rng.uniform(0.0018, 0.0032)
        phi, lean, curve = rng.uniform(0, 2 * math.pi), rng.uniform(0.15, 0.7), rng.uniform(0.3, 1.2)
        t = np.linspace(0, 1, 7)
        ang = lean + curve * t ** 1.5
        spine = np.stack([np.cumsum(np.sin(ang)) * Lb / 7, np.zeros(7), np.cumsum(np.cos(ang)) * Lb / 7], 1)
        spine[:, 0] -= spine[0, 0]; spine[:, 2] -= spine[0, 2] + 0.004
        wid = wb * (1 - t ** 1.3) + 0.0002
        P = np.zeros((7, 3, 3))
        for i in range(7):
            for j, s in enumerate((-1, 0, 1)):
                P[i, j] = spine[i] + np.array([0, 1.0, 0]) * wid[i] * s * 0.5 + np.array([0, 0, 0.0006 * (1 - abs(s))])
        P = rot_z(P, phi) + root + np.array([*rng.normal(0, 0.004, 2), 0])
        UV = np.stack([np.repeat(t[:, None], 3, 1) * 0 + np.array([0, 0.5, 1])[None, :], np.repeat(t[:, None], 3, 1)], -1)
        mb.add_grid(P, UV, 4)


mb = MB()
prng = np.random.default_rng(nseed())
nsites = 0
for run in RUNS:
    o3, d3, ov = np.array(run['origin'], float), np.array(run['d'], float), np.array(run['o'], float)
    lo_x = min(run['c1'][0], run['c2'][0]); hi_x = min(max(run['c1'][1], run['c2'][1]), 6.0 if run['name'] != 'front' else 99)
    x = lo_x + prng.uniform(0.1, 0.4)
    while x < hi_x - 0.1:
        if not (run['gap'] and run['gap'][0] - 0.15 < x < run['gap'][1] + 0.15):
            w = prng.uniform(0.012, 0.12)
            root = o3 + d3 * x + ov * (PL_A1 + w)
            root[2] = 0.022 * (1 - w / 0.17) + 0.006
            r = prng.random()
            if r < 0.4:
                add_rosette(mb, root, prng, scale=prng.uniform(1.0, 2.2))
            elif r < 0.8:
                add_grass(mb, root, prng, nb=int(prng.integers(10, 26)), hscale=prng.uniform(1.2, 2.6))
            else:
                add_rosette(mb, root, prng, scale=prng.uniform(0.4, 0.6))
                add_grass(mb, root + ov * 0.02, prng, nb=5, hscale=0.8)
            nsites += 1
        x += prng.uniform(0.05, 0.3) if prng.random() < 0.75 else prng.uniform(0.5, 1.2)
V = np.concatenate(mb.v)
pme = bpy.data.meshes.new('FootPlants')
pme.from_pydata(V.tolist(), [], mb.f)
for m_ in PLANT_MATS:
    pme.materials.append(m_)
uvl = pme.uv_layers.new(name='UVMap')
uvl.data.foreach_set('uv', np.array(mb.uv, np.float32).reshape(-1, 2).ravel())
pme.polygons.foreach_set('material_index', np.array(mb.mi, np.int32))
pme.shade_smooth()
scene.collection.objects.link(bpy.data.objects.new('FootPlants', pme))
log('plants', nsites)

# ================================================================= lighting, cameras, render
world = bpy.data.worlds.new('Sky')
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
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
cam_d.clip_start = 0.02

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


def set_cam(eye, target, lens):
    cam.location = eye
    cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    cam_d.lens = lens


KEY = (38, -35, 4.6)
VIEWS = {
    'front': dict(eye=(3.0, -7.2, 1.75), target=(3.0, 0.0, 1.75), lens=38, sun=KEY, sky=2.0, res=(1536, 1024)),
    'corner': dict(eye=(13.75, -1.95, 0.55), target=(12.1, 0.2, 1.05), lens=28, sun=KEY, sky=2.0, res=(1312, 1200)),
    'junction': dict(eye=(1.85, -0.95, 0.92), target=(2.05, 0.0, 0.74), lens=38, sun=KEY, sky=2.0, res=(1536, 1024)),
    'extreme': dict(eye=(2.235, -0.3, 1.26), target=(2.27, 0.0, 1.2), lens=42, sun=KEY, sky=2.0, res=(1536, 1024)),
    'oak': dict(eye=(11.25, -1.55, 2.95), target=(11.7, 0.0, 3.0), lens=40, sun=KEY, sky=2.0, res=(1312, 1200)),
    'window': dict(eye=(4.5, -1.7, 1.75), target=(3.1, 0.0, 1.95), lens=35, sun=KEY, sky=2.0, res=(1536, 1024)),
    'street': dict(eye=(-1.2, -4.8, 1.7), target=(8.5, 0.3, 2.9), lens=26, sun=KEY, sky=2.0, res=(1536, 1024)),
    'overview': dict(eye=(17.5, -13.0, 6.0), target=(6.0, 2.0, 2.6), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    'overcast': dict(eye=(-1.2, -4.8, 1.7), target=(8.5, 0.3, 2.9), lens=26, sun=(34, -35, 0.0), sky=6.0, res=(1536, 1024)),
    'low': dict(eye=(3.0, -7.2, 1.75), target=(3.0, 0.0, 1.75), lens=38, sun=(12, -150, 4.5), sky=2.0, res=(1536, 1024)),
    # The front-left corner and the mirrored right facade (candidate 19; the runtime delivery's views).
    'corner-left': dict(eye=(-1.6, -1.8, 2.2), target=(0.1, 0.1, 2.0), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    'right': dict(eye=(18.5, 3.1, 1.7), target=(12.25, 3.1, 2.4), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    # Candidate 20: the mitred brace joints at the front-left upper bay, and a grazing look along
    # each side facade into the corner, where candidate 19's corner posts left a slot.
    'brace-foot': dict(eye=(0.62, -0.95, 5.3), target=(0.3, 0.0, 5.38), lens=38, sun=KEY, sky=2.0, res=(1536, 1024)),
    'brace-head': dict(eye=(1.2, -0.95, 6.05), target=(1.02, 0.0, 6.3), lens=38, sun=KEY, sky=2.0, res=(1536, 1024)),
    'slot-left': dict(eye=(-2.6, 0.62, 4.4), target=(0.0, 0.22, 5.0), lens=38, sun=KEY, sky=2.0, res=(1536, 1024)),
    'slot-right': dict(eye=(14.85, 0.62, 4.4), target=(12.25, 0.22, 5.0), lens=38, sun=KEY, sky=2.0, res=(1536, 1024)),
}
# extreme: the longest check on a front ground post, framed with the plaster loss at its edge
if EXTREME:
    w = EXTREME['world']
    tx = 0.5 * (w.x + EXTREME['edge'] + 0.06)
    VIEWS['extreme'] = dict(eye=(tx - 0.02, -0.34, w.z + 0.05), target=(tx, 0.0, w.z), lens=42, sun=KEY, sky=2.0, res=(1536, 1024))
    log('extreme view on check at', tuple(round(c, 3) for c in w), 'length', round(EXTREME['len'], 2))
VIEWS['gray'] = dict(VIEWS['front'], mode='gray')
VIEWS['unlit'] = dict(VIEWS['front'], mode='unlit')


def set_mode(mode):
    for mat in MATS:
        nt = mat.node_tree
        bs, ta, mo = nt.nodes.get('BSDF'), nt.nodes.get('ALB'), nt.nodes['Material Output']
        if bs is None or ta is None:
            continue
        for l_ in list(bs.inputs['Base Color'].links) + list(mo.inputs['Surface'].links):
            nt.links.remove(l_)
        src = ta.outputs[0]
        if mode == 'gray':
            bs.inputs['Base Color'].default_value = (0.18, 0.18, 0.18, 1)
            nt.links.new(bs.outputs[0], mo.inputs['Surface'])
        elif mode == 'unlit':
            # seen by the camera only: as sampled lights, every displaced triangle would enter
            # Cycles' light tree, which ran out of GPU memory at candidate 20
            mat.cycles.emission_sampling = 'NONE'
            em = nt.nodes.get('UnlitEmission') or nt.nodes.new('ShaderNodeEmission')
            em.name = 'UnlitEmission'
            nt.links.new(src, em.inputs['Color'])
            nt.links.new(em.outputs[0], mo.inputs['Surface'])
        else:
            nt.links.new(src, bs.inputs['Base Color'])
            mx = [n for n in nt.nodes if n.type == 'MIX_SHADER']
            nt.links.new((mx[0] if mx else bs).outputs[0], mo.inputs['Surface'])


renders = []
for vname in [v for v in A.views.split(',') if v]:
    V = VIEWS[vname]
    set_mode(V.get('mode'))
    scene.view_settings.view_transform = 'Standard' if V.get('mode') == 'unlit' else 'AgX'
    try:
        scene.view_settings.look = 'None' if V.get('mode') == 'unlit' else 'AgX - High Contrast'
    except Exception:
        pass
    set_cam(V['eye'], V['target'], V['lens'])
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

layout = dict(seed=A.seed, pieces={k: dict(openings=v['openings'], plaster=v['plaster']) for k, v in PIECES.items()},
              placements=[dict(piece=n, matrix=[list(r) for r in M]) for n, M in PLACE],
              plinth={r['name']: r['blocks'] for r in RUNS})
write_json(os.path.join(OUT, 'layout.json'), json.loads(json.dumps(layout, default=float)))
if A.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'source.blend'), relative_remap=True, compress=True)


def ident(p_):
    with open(p_, 'rb') as f:
        b = f.read()
    return dict(path=os.path.relpath(p_, OUT).replace(os.sep, '/'), bytes=len(b), sha256=hashlib.sha256(b).hexdigest())


receipt = dict(
    createdUtc=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
    blender=bpy.app.version_string, args=dict(vars(A), out=os.path.basename(OUT), paving=os.path.relpath(A.paving, HERE).replace(os.sep, '/')),
    seconds=round(time.perf_counter() - T0, 1), texelMillimetres=dict(oak=A.px, plaster=A.px, stone=A.stone_px),
    meshSpacingMillimetres=VSPACE * 1000, members=len(MEMBERS), atlases={k: [v['W'], v['H']] for k, v in ATLAS.items()},
    heightRangeMetres={k: list(v) for k, v in HRANGE.items()}, plantSites=nsites,
    references=['KIT-005 batch087 A v3', 'KIT-006 batch087 B v2', 'MAT-008 batch104 B v1', 'MAT-009 batch105 A v5',
                'KIT-007 batch089 A v1', 'KIT-009 batch090 A v2', 'KIT-010 batch090 B v3', 'DIR-002 batch001 B'],
    sourceOnly=True, runtimeQA=False, rightsReviewed=False, artisticAcceptance=False,
    files=[ident(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in sorted(fs)
           if f != 'receipt.json' and f.endswith(('.png', '.blend', '.json', '.py'))])
write_json(os.path.join(OUT, 'receipt.json'), receipt)
log('done')
