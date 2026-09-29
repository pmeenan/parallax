# Shared member toolkit: swept-profile timber and stone "members" with unrolled field textures packed
# into shared atlases (K1's oak and limestone recipes), K1's plaster fields, and their Blender
# materials and meshes. Copied from the accepted K1 wall builder (d1-walls/proof-2026-09-25/build.py,
# candidate 20). Only its module-level steps became functions: build_atlases(), paint() and
# write_atlases(). A plaster piece may name its bounding neighbours ('neighbours'); K1's bays default to
# theirs. K1's own builder keeps its inline copy with its accepted source.
#
# Use: setup(args, maps_dir, seed); create members (oak(), vbeam(), hbeam(), Member(...) in MEMBERS);
# build_atlases(); paint(); write_atlases(); then the Blender helpers.
import math, os, time

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from fields import Grid, lin2srgb, mix, srgb2lin, sstep, tangent_normal, write_png

A = None          # namespace with px, oak_px, stone_px, coarse, subdiv
PX = SPX = OPX = VSPACE = None
MAPS = None
RNG = None
PAD = 4
EXTREME = None
_sc = [0]
T0 = time.perf_counter()


def nseed():
    _sc[0] += 1
    return _sc[0]


def log(*a):
    print('[members %6.1fs]' % (time.perf_counter() - T0), *a, flush=True)


def setup(args, maps, seed):
    """args needs px, oak_px (or None), stone_px, coarse and subdiv, as in K1's builder."""
    global A, PX, SPX, OPX, VSPACE, MAPS, RNG
    A = args
    PX = A.px / 1000.0
    SPX = A.stone_px / 1000.0
    OPX = (A.oak_px if A.oak_px else A.px) / 1000.0
    VSPACE = A.coarse / 2 ** A.subdiv
    MAPS = maps
    RNG = np.random.default_rng(seed)
    _sc[0] = seed * 1000

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
POST_A, HEAD_A, SILL_A, BRACE_A, FRAME_A = 0.035, 0.042, 0.040, 0.022, 0.040   # K1 section faces
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
    if not any(hasattr(m, 'host') for m in MEMBERS):
        return
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


def build_atlases():
    for cls in ('oak', 'stone'):
        rects = [(('legacy', id(m), k) if hasattr(m, 'legacy_rects') else (id(m), k), wh) for m in MEMBERS
                 if m.cls == cls for k, wh in getattr(m, 'legacy_rects', m.rects).items()]
        late = [((id(m), k), wh) for m in MEMBERS if m.cls == cls and hasattr(m, 'legacy_rects') for k, wh in m.rects.items()]
        if not rects:   # a kit without this class
            continue
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
    # growth rings: irregular widths, dark latewood bands with a soft earlywood between (K2: the K1 recipe's
    # rings were too faint to read on sunlit end grain; std ~6 levels)
    period = rng.uniform(0.003, 0.005) * (1 + 0.25 * g.noise(0.03))
    ph = rr / period
    late = sstep(0.55, 0.95, 0.5 + 0.5 * np.sin(2 * np.pi * ph))
    ring = (0.5 + 0.5 * np.sin(2 * np.pi * rr / period.mean())) ** 3
    ang = np.arctan2(Aa - pa, B - pb)
    split = (1 - sstep(0.0, 0.02, np.abs(np.sin(ang * rng.integers(2, 5) + rng.uniform(0, 6))))) * sstep(0.3, 1.0, g.noise(0.02))
    # fine radial checks from drying, the rays of the medulla
    rays = (1 - sstep(0.0, 0.03, np.abs(np.sin(ang * rng.integers(9, 16) + 0.4 * g.noise(0.01))))) * sstep(0.2, 1.2, g.noise(0.006))
    H = -0.0008 * ring - 0.003 * split - 0.0008 * rays + 0.0005 * g.noise(0.004)
    brd = np.minimum.reduce([B - b0, b1 - B, Aa - a0, a1 - Aa])
    H *= sstep(0.0, 0.008, brd)
    base = srgb2lin(OAK_PAL[m.p['tone']]) * m.p['bright'] * 0.72
    col = base * (1.25 - 0.55 * late - 0.2 * ring)[..., None] * (1 + 0.12 * g.noise(0.008))[..., None]
    col = mix(col, srgb2lin((22, 15, 10)), 0.8 * split)
    col = mix(col, srgb2lin((30, 22, 16)), 0.6 * rays)
    col = mix(col, srgb2lin((74, 64, 54)), 0.0 if m.kind in ('tail', 'purlin') else 0.45)
    col = col * (1 - 0.35 * (1 - sstep(0.0, 0.012, brd)))[..., None]            # worn, dirty arris round the end
    if m.kind in ('tail', 'purlin'):   # roof timbers end-on to the weather: dark like the frame's exposed oak
        col = col * 0.45
    # end grain is open, dusty and fully matte; at 0.85 the sun's broad specular lobe greyed sunlit tail ends
    return H.astype(np.float32), col, (1.0 if m.kind in ('tail', 'purlin') else 0.85) + 0 * H, g


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


def paint():
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


HRANGE = {}


def write_atlases():
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
    shapes = P['timbers'] + P.get('neighbours', [('rect', 2.0, 2.25, z0 - 1, z1 + 1), ('rect', -1.0, 0.0, z0 - 1, z1 + 1),
                                                 ('rect', -1.0, 3.0, z1, z1 + 1), ('rect', -1.0, 3.0, z0 - 1, z0)])
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


def write_tile(name, H, col, R, g, px):
    Hl = g.blur(H, 0.55 * VSPACE)
    N = tangent_normal(H - Hl, px, px)
    lo, hi = float(Hl.min()), float(Hl.max())
    write_png(os.path.join(MAPS, name + '-albedo.png'), np.round(lin2srgb(col) * 255))
    write_png(os.path.join(MAPS, name + '-normal.png'), np.round((N * 0.5 + 0.5) * 255))
    write_png(os.path.join(MAPS, name + '-roughness.png'), np.round(np.clip(R, 0, 1) * 255))
    write_png(os.path.join(MAPS, name + '-height.png'), np.round((Hl - lo) / (hi - lo) * 65535), 16)
    return (lo, hi)


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
    # 'mk-' keeps these apart from K1's own height textures when a builder opens K1's source
    tex = bpy.data.textures.get('mk-' + prefix) or bpy.data.textures.new('mk-' + prefix, 'IMAGE')
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
