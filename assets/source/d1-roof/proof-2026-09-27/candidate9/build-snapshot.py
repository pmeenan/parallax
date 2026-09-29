# D1 terracotta roof — procedural source (daylight kit package K2).
# Run: blender -b --factory-startup --python build.py -- --out candidateN [--save-blend] [--views ...]
# Preview: add --px 2 --samples 48 --scale 0.75 --walls-subdiv 1
#
# Opens the accepted K1 walls source (its house, paving, calibrated sun and sky) and adds the
# gable roof: curved Roman pan and cover tiles in courses, ridge caps on a mortar bed, eave tails
# and board, verges and the gable infill. World frame is K1's: the front plaster plane is y = 0
# (exterior -y), x runs along the 12.25 m front, z is up, and the head plates top out at 6.5 m.
import argparse, hashlib, json, math, os, sys, time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '../../common')))
from fields import Grid, lin2srgb, mix, srgb2lin, sstep, tangent_normal, write_json, write_png  # noqa: E402
import members as mk  # noqa: E402

T0 = time.perf_counter()


def log(*a):
    print('[roof %6.1fs]' % (time.perf_counter() - T0), *a, flush=True)


argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--walls', default=os.path.normpath(os.path.join(HERE, '../../d1-walls/proof-2026-09-25/candidate20/source.blend')))
ap.add_argument('--px', type=float, default=0.75, help='tile texel size, mm')
ap.add_argument('--variants', type=int, default=24, help='unique pan and cover tile textures')
ap.add_argument('--oak-px', type=float, default=0.75, help='oak texel size, mm (K1)')
ap.add_argument('--plaster-px', type=float, default=1.0, help='gable plaster texel size, mm (K1)')
ap.add_argument('--coarse', type=float, default=0.02, help='member base mesh spacing before subdivision, m')
ap.add_argument('--subdiv', type=int, default=3)
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--views', default='gable')
ap.add_argument('--scale', type=float, default=1.0)
ap.add_argument('--seed', type=int, default=11)
ap.add_argument('--walls-subdiv', type=int, default=None, help='preview: cap the K1 house subdivision')
ap.add_argument('--save-blend', action='store_true')
ap.add_argument('--force', action='store_true')
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

WALLS = os.path.abspath(A.walls)
bpy.ops.wm.open_mainfile(filepath=WALLS)
scene = bpy.context.scene
if A.walls_subdiv is not None:
    for ob in scene.objects:
        for m in ob.modifiers:
            if m.type == 'SUBSURF':
                m.levels = m.render_levels = min(m.render_levels, A.walls_subdiv)
    for coll in bpy.data.collections:
        for ob in coll.objects:
            for m in ob.modifiers:
                if m.type == 'SUBSURF':
                    m.levels = m.render_levels = min(m.render_levels, A.walls_subdiv)
log('opened walls', WALLS)

PX = A.px / 1000.0
RNG = np.random.default_rng(A.seed)
_sc = [A.seed * 1000]


def nseed():
    _sc[0] += 1
    return _sc[0]


# ================================================================= roof geometry (K1 world frame)
PITCH = math.radians(40.0)
TANP, COSP, SINP = math.tan(PITCH), math.cos(PITCH), math.sin(PITCH)
PLATE_TOP = 6.50                  # K1 head plate top
FRONT_FACE, BACK_FACE = -0.042, 6.292   # plate outer faces (the back mirrors the front)
Y_RIDGE = 0.5 * (FRONT_FACE + BACK_FACE)
X_LEFT_FACE, X_RIGHT_FACE = -0.042, 12.292
JOIST_H, JOIST_W, TAIL = 0.15, 0.16, 0.46   # attic joists over the plates, tails beyond the face
BOARD_H, BOARD_W = 0.06, 0.16            # eave board on the tail ends
DECK = 0.02                              # boarding over the rafters (tiles bear on it)
Y_BOARD_OUT = FRONT_FACE - TAIL         # outer edge of tails and eave board
Z_DECK_EAVE = PLATE_TOP + JOIST_H + BOARD_H + DECK
EAVE_PROJ = 0.07                        # tile mouths beyond the eave board
XB0, NBAY = 0.125, 6                    # roof bays: 2 m along the eave, centred on the house
X_MID = XB0 + NBAY                        # 6.125, the house's centre line
VERGE_CH = 1                              # channels in each verge piece (~0.25 m past the gable face with its cover)


def deck_z(y):
    """Top of the boarding on the front slope at plan position y (mirror for the back)."""
    return Z_DECK_EAVE + (y - Y_BOARD_OUT) * TANP


Z_RIDGE_DECK = deck_z(Y_RIDGE)
log('ridge deck %.3f m' % Z_RIDGE_DECK)

# tiles (m): Roman pan and cover, tapering, ~0.35 m exposed per course
TILE_L = 0.40
# pans are wider than covers, so a third of each channel shows between the covers (MAT-011)
PAN_W = (0.250, 0.190)      # (wide uphill end, narrow downhill end)
COVER_W = (0.180, 0.120)    # (wide downhill end, narrow uphill end)
TILE_T = 0.024
TILE_ARC = math.radians(156.0)          # covers and ridge caps: near half-round
PAN_ARC = math.radians(110.0)           # pans: shallow curved troughs, as MAT-011's canal tiles


def arc_of(role):
    return PAN_ARC if role == 'pan' else TILE_ARC
CHANNEL = 2.0 / 7.0                      # six channels per 2 m bay (kit spec): covers straddle the gap between
                                          # pans and land just inside their rims, so the pans' troughs show
X0, X1 = XB0 - VERGE_CH * CHANNEL, XB0 + 2.0 * NBAY + VERGE_CH * CHANNEL
RIDGE_L, RIDGE_W = 0.45, 0.40

# ================================================================= tile texture variants
TERRA = [(178, 106, 72), (172, 102, 70), (184, 110, 76), (168, 100, 68), (164, 98, 68), (188, 118, 82),
         (160, 96, 66), (176, 104, 72)]
BODY = srgb2lin((204, 118, 74))


def tile_face_dims(w_wide, length, arc_=TILE_ARC):
    r = 0.5 * w_wide / math.sin(0.5 * arc_)
    arc = (r + TILE_T) * arc_
    return int(math.ceil(length / PX)), int(math.ceil(arc / PX))


def tile_face(role, face, nx, ny, g, base, params):
    """One face of a tile as (height, linear albedo, roughness): rows run around the arc (v), columns
    along the tile from its downhill end (u = 0)."""
    U = ((np.arange(nx) + 0.5) / nx)[None, :].astype(np.float32)
    V = ((np.arange(ny) + 0.5) / ny)[:, None].astype(np.float32)
    lu, lv = U * TILE_L, (V - 0.5)                        # metres along, -0.5..0.5 across the arc
    rng = g.rng
    edge = np.minimum(np.minimum(U * TILE_L, (1 - U) * TILE_L), np.minimum(V, 1 - V) * ny * PX)
    # hand-moulded clay: long moulding ripples, fine grain, sand, pits
    H = 0.0006 * g.fbm([((0.006, 0.014), 1.0), ((0.003, 0.006), 0.4)])
    H += 0.00035 * g.fbm([(0.0015, 1.0), (0.0008, 0.7), (0.0004, 0.4)])   # coarse sandy skin
    F1, F2, ID, nc = g.worley(0.0025)
    sand = (rng.random(nc).astype(np.float32)[ID] < 0.22) & (F1 < 0.0008)
    H += 0.00025 * sand
    P1, _, PID, pnc = g.worley(0.005)
    prad = 0.0006 + 0.0012 * rng.random(pnc).astype(np.float32)[PID] ** 2
    pit = (rng.random(pnc).astype(np.float32)[PID] < 0.35) * np.clip(1 - (P1 / prad) ** 2, 0, 1)
    H -= 0.0008 * pit
    # chipped edges expose the fired body
    chipn = sstep(0.2, 1.2, g.fbm([(0.006, 1.0), (0.002, 0.5)]))
    chip = (1 - sstep(0.0, 0.006 + 0.004 * chipn, edge)) * sstep(0.35, 0.8, chipn + 0.25 * g.noise(0.01))
    H -= 0.002 * chip
    col = srgb2lin(base) * params['bright']
    mott = g.fbm([(0.025, 1.0), (0.008, 0.6), (0.003, 0.3)])
    col = col * (1 + 0.12 * mott)[..., None]
    # brown firing clouds and darker iron specks through the body
    cloud = sstep(0.1, 1.3, g.fbm([(0.04, 1.0), (0.015, 0.5), (0.005, 0.3)]) + params['cloud'])
    col = mix(col, srgb2lin((104, 64, 46)), 0.28 * cloud)
    S1, _, SID, snc = g.worley(0.004)
    speck = (rng.random(snc).astype(np.float32)[SID] < 0.12) * np.clip(1 - (S1 / 0.0006) ** 2, 0, 1)
    col = col * (1 - 0.45 * speck)[..., None]
    # kiln flashing: a darker, browner end or side on some tiles
    flash = params['flash'] * sstep(0.2, 1.0, (1 - U) * params['flash_end'] + U * (1 - params['flash_end']) + 0.3 * g.noise(0.05))
    col = mix(col, srgb2lin((96, 54, 38)), 0.35 * flash)
    col = col * (1 + 0.10 * g.noise(0.0015))[..., None]
    col = mix(col, srgb2lin((214, 184, 148)), 0.25 * sand)
    col = col * (1 - 0.35 * pit)[..., None]
    col = mix(col, BODY * (1 + 0.15 * g.noise(0.001))[..., None], 0.85 * chip)
    R = 0.93 + 0.03 * g.noise(0.01) - 0.05 * chip
    visible = (role == 'pan' and face == 'inner') or (role in ('cover', 'ridge') and face == 'outer')
    if visible:
        lap = params['exposed']        # the upper tile covers u > lap; its lip lies on this line
        exposed = 1 - sstep(lap - 0.02, lap + 0.02, U * TILE_L) if role != 'ridge' else np.ones_like(U)
        exposed = np.broadcast_to(exposed, H.shape)
        if role == 'pan':
            # the channel: damp centre, sediment streaks along the flow, moss where the upper pan's
            # lip and the covers' edges hold water
            centre = np.exp(-(lv / 0.18) ** 2)
            streak = sstep(0.3, 1.4, g.fbm([((0.003, 0.05), 1.0)]))
            col = col * (1 - (0.30 * centre + 0.15 * streak * centre) * exposed)[..., None]
            col = mix(col, srgb2lin((96, 58, 42)), 0.25 * centre * exposed)
            rim = sstep(0.34, 0.5, np.abs(lv))
            lipline = np.exp(-((U * TILE_L - lap) / 0.02) ** 2)
            moss = sstep(0.55, 1.2, g.fbm([(0.006, 1.0), (0.002, 0.6)]) + 0.9 * (rim + lipline) - 0.6) * params['moss']
            col = mix(col, srgb2lin((84, 90, 42)) * (1 + 0.2 * g.noise(0.002))[..., None], 0.8 * moss * exposed)
            H += 0.0008 * moss * exposed
            R = R + 0.05 * moss
        else:
            # the crown: pale weathering bloom and lichen rosettes; darker where it dips into the pans
            crown = np.exp(-(lv / 0.22) ** 2)
            bloom = sstep(0.2, 1.4, g.fbm([(0.012, 1.0), (0.004, 0.6), (0.0015, 0.3)]) + params['bloom'])
            col = mix(col, srgb2lin((150, 136, 118)), 0.22 * bloom * crown * exposed)
            # lichen: crusts grown from sparse centres, grey-green with pale rims, a few yellow
            L1, _, LID, lnc = g.worley(0.035)
            lr = rng.random(lnc).astype(np.float32)
            rad = (0.008 + 0.018 * lr[LID] ** 1.5) * (1 + 0.35 * g.noise(0.003))
            dd_ = L1 / np.maximum(rad, 1e-4)
            inside = (lr[LID] < params['lichen']) * (1 - sstep(0.85, 1.0, dd_))
            ros = inside * (0.55 + 0.45 * sstep(-0.3, 0.5, g.noise(0.0008))) * (0.35 + 0.65 * crown) * exposed
            rimc = inside * sstep(0.7, 0.95, dd_) * exposed
            yellow = (rng.random(lnc) < 0.2)[LID][..., None]
            lcol = np.where(yellow, srgb2lin((184, 160, 74)), srgb2lin((150, 154, 130)))
            col = mix(col, lcol * (1 + 0.25 * g.noise(0.0008))[..., None], 0.65 * ros)
            col = mix(col, srgb2lin((188, 188, 170)), 0.2 * rimc)
            H += 0.0003 * ros
            col = col * (1 - 0.18 * sstep(0.3, 0.5, np.abs(lv)))[..., None]
            R = R + 0.04 * ros
        # sparse dark grime: blackish crusts and dirt in the hollows of the crust and clay
        grime = sstep(0.9, 1.6, g.fbm([(0.012, 1.0), (0.004, 0.6)]) + params['grime']) * exposed
        col = mix(col, srgb2lin((64, 48, 40)), 0.55 * grime)
        # the covered lap stays cleaner and slightly pinker
        col = mix(col, srgb2lin(base) * params['bright'] * 1.04, 0.35 * (1 - exposed))
    else:
        col = col * 0.94   # undersides: dustier, unweathered
    return H.astype(np.float32), np.clip(col, 0, 1).astype(np.float32), np.clip(R, 0.6, 1.0).astype(np.float32)


def make_variants():
    roles = [('pan', A.variants // 2), ('cover', A.variants // 2), ('ridge', 4)]
    slots = []
    for role, n in roles:
        w = {'ridge': RIDGE_W, 'pan': PAN_W[0], 'cover': COVER_W[0]}[role]
        L = RIDGE_L if role == 'ridge' else TILE_L
        for k in range(n):
            nx, ny = tile_face_dims(w, L, arc_of(role))
            p = dict(bright=float(RNG.normal(1.0, 0.07)), flash=float(RNG.uniform(0, 1) < 0.35) * float(RNG.uniform(0.4, 1)),
                     flash_end=float(RNG.integers(2)), exposed=float(RNG.uniform(0.28, 0.32)),
                     moss=float(RNG.uniform(0.2, 1.0)), bloom=float(RNG.uniform(-0.6, 0.4)),
                     lichen=float(RNG.uniform(0.0, 1.0) ** 2 * 0.6), cloud=float(RNG.uniform(-0.8, 0.2)),
                     grime=float(RNG.uniform(-0.8, 0.2)),
                     tone=int(RNG.integers(len(TERRA))))
            if k % 11 == 5:
                p['tone'] = 5    # a few pale replacement tiles
            slots.append(dict(role=role, k=k, nx=nx, ny=ny, p=p))
    # shelf-pack faces: each variant is one column slot of outer face over inner face
    PAD = 4
    W = 1024
    area = sum((s['nx'] + 2 * PAD) * (2 * s['ny'] + 4 * PAD) for s in slots)
    while W * W < area * 1.1:
        W *= 2
    x = y = sh = 0
    for s in slots:
        w2, h2 = s['nx'] + 2 * PAD, 2 * s['ny'] + 4 * PAD
        if x + w2 > W:
            x, y, sh = 0, y + sh, 0
        s['pos'] = (x + PAD, y + PAD)
        x += w2
        sh = max(sh, h2)
    H_ = int(math.ceil((y + sh) / 64) * 64)
    alb = np.zeros((H_, W, 3), np.uint8)
    nrm = np.zeros((H_, W, 3), np.uint8); nrm[..., 2] = 255; nrm[..., :2] = 128
    rgh = np.full((H_, W), 230, np.uint8)
    for s in slots:
        x, y = s['pos']
        for fi, face in enumerate(('outer', 'inner')):
            g = Grid(s['ny'], s['nx'], PX, nseed())
            Hf, col, R = tile_face(s['role'], face, s['nx'], s['ny'], g, TERRA[s['p']['tone']], s['p'])
            N = tangent_normal(Hf, PX, PX)
            yy = y + fi * (s['ny'] + 2 * PAD)
            sl = (slice(yy - PAD, yy + s['ny'] + PAD), slice(x - PAD, x + s['nx'] + PAD))
            pad = lambda a: np.pad(a, ((PAD, PAD), (PAD, PAD)) + (((0, 0),) if a.ndim == 3 else ()), mode='edge')
            alb[sl] = pad(np.round(lin2srgb(col) * 255).astype(np.uint8))
            nrm[sl] = pad(np.round((N * 0.5 + 0.5) * 255).astype(np.uint8))
            rgh[sl] = pad(np.round(R * 255).astype(np.uint8))
            s['face_y_%s' % face] = yy
    write_png(os.path.join(MAPS, 'tile-albedo.png'), alb)
    write_png(os.path.join(MAPS, 'tile-normal.png'), nrm)
    write_png(os.path.join(MAPS, 'tile-roughness.png'), rgh)
    log('tile atlas', W, H_, len(slots), 'variants')
    return slots, W, H_


SLOTS, AW, AH = make_variants()
BY_ROLE = {r: [s for s in SLOTS if s['role'] == r] for r in ('pan', 'cover', 'ridge')}


# ================================================================= tile meshes
class MeshBuilder:
    def __init__(self):
        self.V, self.F, self.UV, self.C, self.MI = [], [], [], [], []
        self.nv = 0

    def add(self, V, F, UV, MI, tint):
        self.V.append(V)
        self.F += [tuple(int(i) + self.nv for i in f) for f in F]
        self.UV += UV
        self.MI += MI
        self.C += [tint] * len(F)
        self.nv += len(V)

    def build(self, name, mat):
        me = bpy.data.meshes.new(name)
        V = np.concatenate(self.V) if self.V else np.zeros((0, 3))
        me.from_pydata(V.tolist(), [], self.F)
        uvl = me.uv_layers.new(name='UVMap')
        uvl.data.foreach_set('uv', np.array([c for f in self.UV for c in f], np.float32).ravel())
        ca = me.color_attributes.new('tint', 'FLOAT_COLOR', 'CORNER')
        ca.data.foreach_set('color', np.array([c for f, t in zip(self.UV, self.C) for c in [t] * len(f)], np.float32).ravel())
        me.materials.append(mat)
        me.materials.append(MAT_BODY)
        me.polygons.foreach_set('material_index', np.array(self.MI, np.int32))
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)   # every tile is a closed shell
        bm.to_mesh(me)
        bm.free()
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(40))
        ob = bpy.data.objects.new(name, me)
        return ob


def tile_geometry(slot, role, frame, jitter):
    """Vertices, quads and UVs of one tile. `frame` maps tile-local (u along from the downhill end,
    y across, z up) into the world; covers and ridge caps are convex up, pans concave."""
    L = RIDGE_L if role == 'ridge' else TILE_L
    w_down = {'ridge': RIDGE_W, 'pan': PAN_W[1], 'cover': COVER_W[0]}[role]
    w_up = {'ridge': RIDGE_W * 0.92, 'pan': PAN_W[0], 'cover': COVER_W[1]}[role]
    nu, nphi = 8, 12
    us = np.linspace(0, L, nu + 1)
    ARC = arc_of(role)
    phis = np.linspace(-0.5, 0.5, nphi + 1) * ARC
    wob = jitter['wobble']
    rings = {}
    for side in ('inner', 'outer'):
        pts = np.zeros((nu + 1, nphi + 1, 3))
        for i, u in enumerate(us):
            w = w_down + (w_up - w_down) * u / L
            r = 0.5 * w / math.sin(0.5 * ARC) * (1 + wob * math.sin(3.1 * u / L + jitter['ph']))
            rr = r + (TILE_T if side == 'outer' else 0.0)
            y = rr * np.sin(phis)
            if role == 'pan':
                z = (r + TILE_T) - rr * np.cos(phis)
            else:
                z = rr * np.cos(phis) - (r + TILE_T) * math.cos(0.5 * ARC)
            pts[i, :, 0], pts[i, :, 1], pts[i, :, 2] = u, y, z
        rings[side] = pts
    x, y = slot['pos']
    V, F, UV = [], [], []
    for side in ('outer', 'inner'):
        base = len(V) and sum(len(v) for v in V)
        P = rings[side].reshape(-1, 3)
        V.append(P)
        fy = slot['face_y_%s' % side]
        for i in range(nu):
            for j in range(nphi):
                a, b, c, d = i * (nphi + 1) + j, (i + 1) * (nphi + 1) + j, (i + 1) * (nphi + 1) + j + 1, i * (nphi + 1) + j + 1
                q = (a, b, c, d) if side == 'outer' else (a, d, c, b)
                if role == 'pan':
                    q = q[::-1]
                F.append(tuple(k + base for k in q))
                uv = []
                for (ii, jj) in {(a, b, c, d): [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)],
                                 (a, d, c, b): [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]}[(a, b, c, d) if side == 'outer' else (a, d, c, b)]:
                    uv.append(((x + ii / nu * slot['nx']) / AW, (fy + jj / nphi * slot['ny']) / AH))
                UV.append(uv[::-1] if role == 'pan' else uv)
    nin = (nu + 1) * (nphi + 1)
    # edges: long rims and both ends join inner and outer shells; they take the visible face's border
    vis = 'inner' if role == 'pan' else 'outer'
    fy = slot['face_y_%s' % vis]
    o = 0 if vis == 'outer' else nin

    def idx(side, i, j):
        return (0 if side == 'outer' else nin) + i * (nphi + 1) + j

    def uvat(i, j, inset):
        return ((x + (i / nu) * slot['nx']) / AW, (fy + min(max(j / nphi * slot['ny'] + inset, 0.5), slot['ny'] - 0.5)) / AH)

    for j in (0, nphi):
        inset = 6 if j == 0 else -6
        for i in range(nu):
            q = (idx('outer', i, j), idx('outer', i + 1, j), idx('inner', i + 1, j), idx('inner', i, j))
            if (j == 0) != (role == 'pan'):
                q = q[::-1]
            F.append(q)
            UV.append([uvat(i, j, 0), uvat(i + 1, j, 0), uvat(i + 1, j, inset), uvat(i, j, inset)][::(-1 if q[0] != idx('outer', i, j) else 1)])
    for i in (0, nu):
        for j in range(nphi):
            q = (idx('outer', i, j), idx('inner', i, j), idx('inner', i, j + 1), idx('outer', i, j + 1))
            if (i == 0) != (role == 'pan'):
                q = q[::-1]
            F.append(q)
            ui = 0.02 if i == 0 else -0.02
            UV.append([uvat(i + ui, j, 0), uvat(i + ui * 2, j, 0), uvat(i + ui * 2, j + 1, 0), uvat(i + ui, j + 1, 0)][::(1 if q[0] == idx('outer', i, j) else -1)])
    P = np.concatenate(V)
    P = (frame @ np.c_[P, np.ones(len(P))].T).T[:, :3]
    nshell = 2 * nu * nphi
    return P, F, UV, [0] * nshell + [1] * (len(F) - nshell)


def slope_frame(side, x, s, lift, yaw, roll, pitch_extra):
    """Tile-local to world: u up the slope from arc length s on the deck (from the eave line), x
    along the eave. `side` 1 = front slope (rising toward +y), -1 = back."""
    y_e = Y_BOARD_OUT - EAVE_PROJ if side == 1 else BACK_FACE + TAIL + EAVE_PROJ
    ang = PITCH + pitch_extra
    up = Vector((0, side * math.cos(ang), math.sin(ang)))          # along the tile, uphill
    nrm = Vector((0, -side * math.sin(PITCH), math.cos(PITCH)))     # deck normal
    lat = nrm.cross(up).normalized()   # right-handed: up x lat = nrm
    y0 = y_e + side * s * COSP
    z0 = deck_z(y_e if side == 1 else FRONT_FACE - TAIL - EAVE_PROJ) + s * SINP
    o = Vector((x, y0, z0)) + nrm * lift
    R = Matrix.Rotation(yaw, 3, nrm) @ Matrix.Rotation(roll, 3, up)
    ex, ey, ez = R @ up, R @ lat, R @ nrm
    M = Matrix(((ex.x, ey.x, ez.x, o.x), (ex.y, ey.y, ez.y, o.y), (ex.z, ey.z, ez.z, o.z), (0, 0, 0, 1)))
    return np.array(M)


def pan_rim_height():
    r = 0.5 * PAN_W[0] / math.sin(0.5 * PAN_ARC)
    return (r + TILE_T) - r * math.cos(0.5 * PAN_ARC)


def cover_lift(gap):
    """Height of a cover's local origin over the deck so that its inner surface rests on the two pan
    rims `gap` apart (lateral offsets ±gap/2 from the cover's axis)."""
    r = 0.5 * COVER_W[0] / math.sin(0.5 * TILE_ARC)
    phi = math.asin(min(0.99, 0.5 * gap / r))
    return pan_rim_height() - (r * math.cos(phi) - (r + TILE_T) * math.cos(0.5 * TILE_ARC))


SLOPE_LEN = (Y_RIDGE - (Y_BOARD_OUT - EAVE_PROJ)) / COSP
N_COURSE = int(round((SLOPE_LEN - 0.03 - TILE_L) / 0.30)) + 1
EXPOSE = (SLOPE_LEN - 0.03 - TILE_L) / (N_COURSE - 1)
log('slope %.3f m, %d courses at %.3f m exposure' % (SLOPE_LEN, N_COURSE, EXPOSE))

# ---- course poses: each tile lies on what is under it (K2 candidate 7). A course's pose is its origin
# height over the deck along the tile, o(u) = a + b u. Pans rest on the deck and on the pan below (they nest
# downhill, narrow end in wide end); covers rest on the pan rims either side of their joint and on the cover
# below. Candidates 1-6 lifted every course and tilted it nose-up, so each course sank into the one above it.
COVER_OFFSET = -0.015          # covers start just downhill of their pans and hide the pans' rim ends
CLEAR = 0.003


def pan_w(u):
    return PAN_W[1] + (PAN_W[0] - PAN_W[1]) * u / TILE_L


def cov_w(u):
    return COVER_W[0] + (COVER_W[1] - COVER_W[0]) * u / TILE_L


def pan_surf(yl, u, outer):
    r = 0.5 * pan_w(u) / math.sin(0.5 * PAN_ARC)
    rr = r + (TILE_T if outer else 0.0)
    z = (r + TILE_T) - np.sqrt(np.maximum(rr * rr - yl * yl, 0.0))
    return np.where(np.abs(yl) <= rr * math.sin(0.5 * PAN_ARC), z, np.nan)


def cov_surf(y, u, outer):
    r = 0.5 * cov_w(u) / math.sin(0.5 * TILE_ARC)
    rr = r + (TILE_T if outer else 0.0)
    z = np.sqrt(np.maximum(rr * rr - y * y, 0.0)) - (r + TILE_T) * math.cos(0.5 * TILE_ARC)
    return np.where(np.abs(y) <= rr * math.sin(0.5 * TILE_ARC), z, np.nan)


def fit_line(us, req):
    b = (req[-1] - req[0]) / (us[-1] - us[0])
    a = float(np.max(req - b * us))
    return a, float(b)


def solve_poses():
    us = np.linspace(0.0, TILE_L, 17)
    ys = np.linspace(-0.2, 0.2, 161)

    def solve_pans(below):
        pans = []
        for k in range(N_COURSE):
            req = np.zeros_like(us)                       # the deck
            prev = pans[k - 1] if k else below
            if prev is not None:
                a0, b0 = prev
                for i, u in enumerate(us):
                    up = u + EXPOSE                        # the same point on the pan below
                    if up <= TILE_L:
                        sup = a0 + b0 * up + pan_surf(ys, up, False)
                        need = sup + CLEAR - pan_surf(ys, u, True)
                        req[i] = max(req[i], float(np.nanmax(need)))
            pans.append(fit_line(us, req))
        return pans

    # The eave course rests on a tilting fillet on the eave board (candidate 9) that stands in for a course
    # below it, posed as the field's: on the bare deck it lay a pan's lap lower than the field and sank
    # into the eave board (candidates 1-8). EAVE_FILLET records the pose the fillet carries.
    global EAVE_FILLET
    EAVE_FILLET = solve_pans(None)[N_COURSE // 2]
    pans = solve_pans(EAVE_FILLET)
    def solve_covers(below):
        covers = []
        for k in range(N_COURSE):
            req = np.zeros_like(us)                       # never below the deck
            prev = covers[k - 1] if k else below
            for i, u in enumerate(us):
                sk = k * EXPOSE + COVER_OFFSET + u
                need = []
                for j in range(N_COURSE):                   # pan rims either side of the joint
                    uj = sk - j * EXPOSE
                    if 0.0 <= uj <= TILE_L:
                        aj, bj = pans[j]
                        for yc in (-0.5 * CHANNEL, 0.5 * CHANNEL):
                            need.append(aj + bj * uj + pan_surf(ys - yc, uj, False) + CLEAR - cov_surf(ys, u, False))
                if prev is not None:
                    a0, b0 = prev
                    up = u + EXPOSE
                    if up <= TILE_L:
                        need.append(a0 + b0 * up + cov_surf(ys, up, True) + CLEAR - cov_surf(ys, u, False))
                if need:
                    req[i] = max(req[i], float(np.nanmax(np.concatenate(need))))
            covers.append(fit_line(us, req))
        return covers

    # The eave covers too rest as on a course below (candidate 9): on the pan rims alone they lay 38 mm under
    # the field's line. EAVE_COVER records that virtual course's pose (the eave bedding carries it).
    global EAVE_COVER
    EAVE_COVER = solve_covers(None)[N_COURSE // 2]
    covers = solve_covers(EAVE_COVER)
    # The eave and ridge courses see fewer supports than the field (no cover below; no pan above). Keep their
    # tilt at the field's and only raise them as far as their own supports need.
    mid = covers[N_COURSE // 2]
    for k in (0, N_COURSE - 1):
        a_k, b_k = covers[k]
        lift = max(a_k + b_k * u - mid[1] * u for u in (0.0, TILE_L)) if k else a_k
        covers[k] = (max(lift, 0.0) if k else a_k, mid[1])
    return pans, covers


PAN_POSE, COVER_POSE = solve_poses()
COVER_POSE_TOP_EST = COVER_POSE[N_COURSE // 2][0] + 0.07   # a cover's crown over the deck, for the verge pointing
log('cover poses', [(round(a, 3), round(b, 3)) for a, b in COVER_POSE])
log('poses: pan lift %.3f tilt %.3f, cover lift %.3f tilt %.3f (course 5)' % (*PAN_POSE[5], *COVER_POSE[5]))


WEATHER_PH = np.random.default_rng(A.seed + 7).uniform(0, 2 * np.pi, 6)


def weathering(x, s):
    """Broad damp and lichen-grey staining over the slope (0..1): heavier low on the roof and in drifts
    across it. Smooth over a piece; pieces repeat it, but at 2 m it reads as weather, not as a stamp."""
    p = WEATHER_PH
    f = 0.5 + 0.25 * math.sin(2 * math.pi * x / 1.3 + p[0]) * math.sin(2 * math.pi * s / 1.7 + p[1]) \
        + 0.15 * math.sin(2 * math.pi * (x + 0.6 * s) / 0.9 + p[2]) + 0.2 * (1 - s / SLOPE_LEN)
    return min(1.0, max(0.0, f))


def tile_tint(rng, w=0.0):
    """Per-tile kiln variation over the variant texture (brightness and a warmer or browner cast), dulled and
    greyed by the slope's weathering field `w`."""
    t = float(np.clip(rng.normal(1.0, 0.06), 0.84, 1.14)) * (1 - 0.14 * w)
    q = rng.random()
    t *= 0.74 if q < 0.08 else (1.18 if q > 0.93 else 1.0)
    brown = float(np.clip(rng.normal(0.0, 0.04), -0.08, 0.1)) + 0.05 * w
    return (t * (1 - 0.3 * brown), t * (1 + 0.1 * brown), t * (1 + 0.35 * brown), 1.0)


# ================================================================= materials
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


def tile_material():
    mat, nn, ll, mo = new_mat('roof-tile')
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'
    bs.inputs['Specular IOR Level'].default_value = 0.25
    ti = nn.new('ShaderNodeTexImage'); ti.name = 'ALB_IMG'; ti.interpolation = 'Cubic'
    ti.image = load_img(os.path.join(MAPS, 'tile-albedo.png'), 'sRGB')
    at = nn.new('ShaderNodeVertexColor'); at.layer_name = 'tint'
    mul = nn.new('ShaderNodeMix'); mul.name = 'ALB'; mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    ll.new(ti.outputs['Color'], mul.inputs[6]); ll.new(at.outputs['Color'], mul.inputs[7])
    tr = nn.new('ShaderNodeTexImage'); tr.image = load_img(os.path.join(MAPS, 'tile-roughness.png'), 'Non-Color')
    tn = nn.new('ShaderNodeTexImage'); tn.image = load_img(os.path.join(MAPS, 'tile-normal.png'), 'Non-Color'); tn.interpolation = 'Cubic'
    nm = nn.new('ShaderNodeNormalMap'); nm.uv_map = 'UVMap'
    ll.new(mul.outputs[2], bs.inputs['Base Color'])
    ll.new(tr.outputs['Color'], bs.inputs['Roughness'])
    ll.new(tn.outputs['Color'], nm.inputs['Color'])
    ll.new(nm.outputs['Normal'], bs.inputs['Normal'])
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    return mat


def flat_material(name, rgb, rough):
    mat, nn, ll, mo = new_mat(name)
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'
    bs.inputs['Base Color'].default_value = (*srgb2lin(rgb), 1)
    bs.inputs['Roughness'].default_value = rough
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    return mat


def body_material():
    mat, nn, ll, mo = new_mat('roof-tile-body')
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'
    bs.inputs['Roughness'].default_value = 0.95
    tc = nn.new('ShaderNodeTexCoord')
    nz = nn.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 260.0; nz.inputs['Detail'].default_value = 8
    ll.new(tc.outputs['Object'], nz.inputs['Vector'])
    vo = nn.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = 900.0
    ll.new(tc.outputs['Object'], vo.inputs['Vector'])
    ramp = nn.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.3; ramp.color_ramp.elements[0].color = (*srgb2lin((170, 88, 54)), 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (*srgb2lin((208, 132, 86)), 1)
    ll.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    pore = nn.new('ShaderNodeMath'); pore.operation = 'LESS_THAN'; pore.inputs[1].default_value = 0.12
    ll.new(vo.outputs['Distance'], pore.inputs[0])
    dark = nn.new('ShaderNodeMix'); dark.data_type = 'RGBA'; dark.blend_type = 'MIX'
    dark.inputs[7].default_value = (*srgb2lin((86, 50, 36)), 1)
    ll.new(pore.outputs[0], dark.inputs['Factor']); ll.new(ramp.outputs['Color'], dark.inputs[6])
    at = nn.new('ShaderNodeVertexColor'); at.layer_name = 'tint'
    mul = nn.new('ShaderNodeMix'); mul.name = 'ALB'; mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    ll.new(dark.outputs[2], mul.inputs[6]); ll.new(at.outputs['Color'], mul.inputs[7])
    ll.new(mul.outputs[2], bs.inputs['Base Color'])
    bp = nn.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; bp.inputs['Distance'].default_value = 0.0008
    ll.new(pore.outputs[0], bp.inputs['Height']); ll.new(bp.outputs['Normal'], bs.inputs['Normal'])
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    return mat


MAT_TILE = tile_material()
MAT_BODY = body_material()
def mortar_material():
    """Weathered lime bedding: grey-buff with grit, lichen-dark patches and damp staining."""
    mat, nn, ll, mo = new_mat('roof-mortar')
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'
    bs.inputs['Roughness'].default_value = 0.97
    tc = nn.new('ShaderNodeTexCoord')
    nz = nn.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 40.0; nz.inputs['Detail'].default_value = 10
    ll.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nn.new('ShaderNodeValToRGB'); ramp.name = 'ALB'
    els = ramp.color_ramp.elements
    els[0].position = 0.3; els[0].color = (*srgb2lin((92, 86, 76)), 1)
    els[1].position = 0.75; els[1].color = (*srgb2lin((150, 142, 124)), 1)
    ll.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    ll.new(ramp.outputs['Color'], bs.inputs['Base Color'])
    fine = nn.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 600.0; fine.inputs['Detail'].default_value = 4
    ll.new(tc.outputs['Object'], fine.inputs['Vector'])
    bp = nn.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.7; bp.inputs['Distance'].default_value = 0.002
    ll.new(fine.outputs['Fac'], bp.inputs['Height']); ll.new(bp.outputs['Normal'], bs.inputs['Normal'])
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    return mat


MAT_MORTAR = mortar_material()
MAT_DECK = flat_material('roof-deck', (58, 44, 34), 0.95)


def box(mb_list, lo, hi):
    lo, hi = np.array(lo, float), np.array(hi, float)
    c = np.array([[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]],
                  [lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]])
    F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mb_list.append((c, F))


def skew_box(mb_list, pts, F=None):
    mb_list.append((np.array(pts, float), F or [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]))


def flat_object(name, parts, mat):
    V, F, n = [], [], 0
    for P, Fs in parts:
        V.append(P)
        F += [tuple(i + n for i in f) for f in Fs]
        n += len(P)
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.concatenate(V).tolist(), [], F)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


# ================================================================= timber: K1's oak members; gables: K1's plaster
mk.setup(argparse.Namespace(px=A.plaster_px, oak_px=A.oak_px, stone_px=1.25, coarse=A.coarse, subdiv=A.subdiv),
         MAPS, A.seed + 101)
UP = (0, 0, 1)


def downward_b(e_s, e_a, depth):
    """b range that runs `depth` downward from the member's top edge."""
    e_b = np.cross(np.array(e_s, float) / np.linalg.norm(e_s), np.array(e_a, float) / np.linalg.norm(e_a))
    return (-depth, 0.0) if e_b[2] > 0 else (0.0, depth)


# roof pieces (kit spec: 2 m along the eave, pivot at the eave midpoint). Each is built at its front-slope
# placement in world coordinates and stored relative to its pivot; the back slope reuses them turned 180°
# about the house's centre. A piece owns the cover over its left joint.
BAYS = ['A', 'B', 'C', 'A', 'C', 'B']       # three bay variants along the eave, reused on the back slope
PIECE_SPANS = {'verge-left': (X0, XB0), 'verge-right': (XB0 + 2.0 * NBAY, X1)}
for v in 'ABC':
    k = BAYS.index(v)
    PIECE_SPANS['bay-' + v] = (XB0 + 2.0 * k, XB0 + 2.0 * (k + 1))
Y_MOUTH = Y_BOARD_OUT - EAVE_PROJ


def pivot(name):
    xa, xb = PIECE_SPANS[name]
    return np.array((0.5 * (xa + xb), Y_MOUTH, deck_z(Y_MOUTH)))


out = (0, -1, 0)
for name, (xa, xb) in PIECE_SPANS.items():
    if name.startswith('bay'):
        for xj in (xa + 1 / 3, xa + 1.0, xa + 5 / 3):   # joist tails with end grain
            mk.oak(name, (xj, FRONT_FACE + 0.10, PLATE_TOP), (0, -1, 0), 0.10 + TAIL, JOIST_H,
                   -JOIST_W / 2, JOIST_W / 2, a0=0.0, a_cut=None, caps=(False, True), kind='tail', e_a=UP, out=out)
    mk.oak(name, (xa + 0.002, Y_BOARD_OUT + BOARD_W, PLATE_TOP + JOIST_H), (1, 0, 0), xb - xa - 0.004, BOARD_H, 0.0,
           BOARD_W, a0=0.0, a_cut=None, kind='board', e_a=UP, out=out)
    # soffit boards on the deck's underside, from the eave board to past the wall line
    n_dk = np.array((0, -SINP, COSP))
    for row in range(2):
        ytop = Y_BOARD_OUT + BOARD_W + row * 0.17
        b0, b1 = downward_b((1, 0, 0), n_dk, 0.17)
        mk.oak(name, (xa + 0.002, ytop, deck_z(ytop) - DECK), (1, 0, 0), xb - xa - 0.004, 0.0, b0, b1,
               a0=-0.022, a_cut=None, kind='plank', e_a=tuple(n_dk), out=(0, 0, -1), face=False)
# purlins and the ridge beam run out through each gable to carry the verge (KIT-008 A); each verge piece carries
# its front-slope purlins and one ridge beam, and its back-slope placement those of the other end
for name, x_in, x_out, sx in (('verge-left', X_LEFT_FACE + 0.06, X0 - 0.12, -1), ('verge-right', X_RIGHT_FACE - 0.06, X1 + 0.12, 1)):
    for f, w_, h_ in ((0.2, 0.15, 0.15), (0.4, 0.15, 0.15), (0.6, 0.15, 0.15), (0.8, 0.15, 0.15), (1.0, 0.18, 0.18)):
        yp = FRONT_FACE + f * (Y_RIDGE - FRONT_FACE) - (0.0 if f < 1 else 0.0)
        mk.oak(name, (x_in, yp, deck_z(yp) - DECK), (sx, 0, 0), abs(x_out - x_in), 0.0, -w_ / 2, w_ / 2,
               a0=-h_, a_cut=None, caps=(False, True), kind='purlin', e_a=UP, out=(sx, 0, 0))
for name, xt in (('verge-left', X0 + 0.085), ('verge-right', X1 - 0.085)):
    mk.oak(name, (xt, FRONT_FACE + 0.10, PLATE_TOP), (0, -1, 0), 0.10 + TAIL, JOIST_H,
           -JOIST_W / 2, JOIST_W / 2, a0=0.0, a_cut=None, caps=(False, True), kind='tail', e_a=UP, out=(0, -1, 0))
# barge boards: each verge piece carries its end's front half (its back-slope placement carries the other end's)
for name, xv, outward in (('verge-left', X0 + 0.025, (-1, 0, 0)), ('verge-right', X1 - 0.025, (1, 0, 0))):
    pa = np.array((xv, Y_BOARD_OUT, deck_z(Y_BOARD_OUT) + 0.07))
    pb = np.array((xv, Y_RIDGE, deck_z(Y_RIDGE) + 0.07))
    L = float(np.linalg.norm(pb - pa))
    e_s = tuple((pb - pa) / L)
    b0, b1 = downward_b(e_s, outward, 0.17)
    mk.oak(name, tuple(pa), e_s, L, 0.035, b0, b1, a0=0.0, a_cut=None, kind='board', e_a=outward, out=outward)
    # boxed verge: a soffit board from the barge board's foot to the gable wall, so the verge cannot be seen
    # through along the gable (candidate 4 showed sky there from the street)
    n_up = np.array((0.0, -SINP, COSP))
    x_wall = X_LEFT_FACE if outward[0] < 0 else X1 - 0.01
    width = (X_LEFT_FACE - (X0 + 0.01)) if outward[0] < 0 else (X1 - 0.01 - X_RIGHT_FACE)
    p0 = np.array((x_wall, Y_BOARD_OUT, deck_z(Y_BOARD_OUT) + 0.02)) - n_up * 0.10
    mk.oak(name, tuple(p0), e_s, L, 0.0, 0.0, width, a0=-0.02, a_cut=None, kind='plank',
           e_a=tuple(-n_up), out=tuple(-n_up), face=False)

VERGE_MORTAR = {}
for name, xo, sx in (('verge-left', X0, 1), ('verge-right', X1, -1)):
    zt_e, zt_r = deck_z(Y_MOUTH) + COVER_POSE_TOP_EST, deck_z(Y_RIDGE) + COVER_POSE_TOP_EST
    xi = xo + sx * 0.07
    # it starts over the eave board (candidate 9): from the tile mouths its flat end showed under the eave course
    y_pt = Y_BOARD_OUT + 0.03
    zt_e = deck_z(y_pt) + COVER_POSE_TOP_EST
    pts = [(xo, y_pt, deck_z(y_pt) + 0.02), (xo, Y_RIDGE, deck_z(Y_RIDGE) + 0.02), (xo, Y_RIDGE, zt_r), (xo, y_pt, zt_e)]
    pts += [(xi, y, z) for (_, y, z) in pts]
    VERGE_MORTAR[name] = [(np.array(pts), [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])]
# gable piece (K1 piece frame: x along the wall, plaster plane y = 0, exterior -y), placed at both ends
GW = 6.25                       # the side walls' plaster run


def zr(xl):
    """Underside of the roof deck over the gable at local x (world y = GW - x, symmetric about the ridge)."""
    yw = GW - xl
    return deck_z(min(yw, 2 * Y_RIDGE - yw)) - DECK


XA = 0.5 * GW
mk.vbeam('gable', XA - 0.11, XA + 0.11, PLATE_TOP, zr(XA) - 0.20, mk.POST_A, kind='kingpost')
gp = mk.piece('gable')
for xa, xb in ((-0.04, XA), (XA, GW + 0.285)):
    pa, pb = np.array((xa, 0.0, zr(xa))), np.array((xb, 0.0, zr(xb)))
    L = float(np.linalg.norm(pb - pa))
    e_s = tuple((pb - pa) / L)
    b0, b1 = downward_b(e_s, mk.OUT_Y, 0.20)
    mk.oak('gable', tuple(pa), e_s, L, mk.HEAD_A, b0, b1, kind='rake')
    eb = np.cross(np.array(e_s), np.array(mk.OUT_Y, float))
    eb = eb if eb[2] < 0 else -eb
    q = [pa[[0, 2]], pb[[0, 2]], (pb + eb * 0.2)[[0, 2]], (pa + eb * 0.2)[[0, 2]]]
    gp['timbers'].append(('poly', q))
    gp['timbers'].append(('poly', [pa[[0, 2]], pb[[0, 2]], np.array((xb, 20.0)), np.array((xa, 20.0))]))
gp['plaster'] = (0.0, GW, PLATE_TOP, zr(XA), False)
gp['neighbours'] = [('rect', -1.0, 0.0, PLATE_TOP - 1, zr(XA) + 1), ('rect', GW, GW + 1, PLATE_TOP - 1, zr(XA) + 1),
                    ('rect', -1.0, GW + 1, PLATE_TOP - 1, PLATE_TOP)]
gp['streaks'].append((XA - 0.11, XA + 0.11, zr(XA) - 0.2))

# Tilting fillet (candidate 9): an oak batten on the eave board under the eave course's pans, standing in for
# the course below them (solve_poses), its top face along their bottom line. Made last and packed late, so
# every accepted member keeps its random draws and its atlas position.
_a_f, _b_f = PAN_POSE[0]
_n_dk, _d_up = np.array((0.0, -SINP, COSP)), np.array((0.0, COSP, SINP))
_k_f = math.sqrt(1 + _b_f * _b_f)
_n_f = (_n_dk - _b_f * _d_up) / _k_f
FILLET_S = (EAVE_PROJ / COSP + 0.01, EAVE_PROJ / COSP + 0.13)   # along the deck from the tile mouths
for name, (xa, xb) in PIECE_SPANS.items():
    base = np.array((xa + 0.002, Y_MOUTH, deck_z(Y_MOUTH)))
    p0 = base + _a_f * _n_dk + FILLET_S[1] * (_d_up + _b_f * _n_dk) - CLEAR * _n_f
    m = mk.oak(name, tuple(p0), (1, 0, 0), xb - xa - 0.004, 0.0, 0.0, (FILLET_S[1] - FILLET_S[0]) * _k_f,
               a0=-(_a_f + _b_f * FILLET_S[0] + 0.02), a_cut=None, kind='board', e_a=tuple(_n_f), out=(0, -1, 0))
    if name.startswith('bay'):
        m.p['bow'] = -0.012        # the courses' belly between the bay lines (sag in build_piece_tiles)
    m.legacy_rects = {}
    m.fillet = True
log('eave fillet: pan pose lift %.4f tilt %.4f (field course %.4f %.4f)' % (_a_f, _b_f, *PAN_POSE[N_COURSE // 2]))

mk.build_atlases()
# The fillets paint from their own seed range, and the members' seed counter is restored afterwards: the
# fields seeded after paint() (the oak detail tile, the gable plaster) keep candidate 8's seeds.
_fillets = [m for m in mk.MEMBERS if getattr(m, 'fillet', False)]
_others = [m for m in mk.MEMBERS if not getattr(m, 'fillet', False)]
mk.MEMBERS[:] = _others
mk.paint()
_sc_after = mk._sc[0]
mk._sc[0] = 9_000_000 + A.seed * 1000
for m in _fillets:
    H_, col_, R_, g_ = mk.oak_strip(m)
    mk.finish(m, 'strip', H_, col_, R_, g_, m.pxs, m.pxt)
    for k in ('cap0', 'cap1'):
        if k in m.rects:
            H_, col_, R_, g_ = mk.oak_cap(m, k)
            mk.finish(m, k, H_, col_, R_, g_, m.px, m.px)
mk._sc[0] = _sc_after
mk.MEMBERS[:] = _others + _fillets
mk.write_atlases()
OAK_DETAIL = mk.oak_detail_tile()
mk.plaster_field('gable')
MAT_OAK = mk.mapped_material('roof-oak', os.path.join(MAPS, 'oak'), 0.22)
mk.add_detail(MAT_OAK, mk.ATLAS['oak']['W'], mk.ATLAS['oak']['H'], mk.OPX, OAK_DETAIL)
# End grain (detail mask 0) is open and dusty: a quarter of the long grain's specular. Flat, dark tail ends
# otherwise caught a grazing-Fresnel glint of the sun and read pale grey (candidates 3-5).
_nt = MAT_OAK.node_tree
_mask = next(n for n in _nt.nodes if n.type == 'TEX_IMAGE' and 'detailmask' in n.image.filepath)
_sp = _nt.nodes.new('ShaderNodeMapRange')
_sp.inputs['To Min'].default_value = 0.055
_sp.inputs['To Max'].default_value = 0.22
_nt.links.new(_mask.outputs['Color'], _sp.inputs['Value'])
_nt.links.new(_sp.outputs['Result'], _nt.nodes['BSDF'].inputs['Specular IOR Level'])
MAT_PLASTER = mk.mapped_material('plaster-gable', os.path.join(MAPS, 'plaster-gable'))


def timber_object(piece_name, coll):
    ms = [m for m in mk.MEMBERS if m.obj == piece_name]
    me = mk.member_mesh(ms, 'roof-%s-oak' % piece_name)
    me.materials.append(MAT_OAK)
    ob = bpy.data.objects.new('roof-%s-oak' % piece_name, me)
    coll.objects.link(ob)
    mk.displace(ob, 'oak', mk.HRANGE['oak'])
    return ob


PIECE_COLL = {}
for pname in PIECE_SPANS:
    coll = bpy.data.collections.new('roof-' + pname)
    PIECE_COLL[pname] = coll
    ob = timber_object(pname, coll)
    ob.data.transform(Matrix.Translation(-Vector(pivot(pname))))

# the gable's plaster: K1's mesh over the triangle, reaching under the raking plates
x0_, x1_, z0_, z1_ = mk.PLASTER['gable']['rect']
nxg, nzg = int(math.ceil((x1_ - x0_) / A.coarse)), int(math.ceil((z1_ - z0_) / A.coarse))
xs_, zs_ = np.linspace(x0_, x1_, nxg + 1), np.linspace(z0_, z1_, nzg + 1)
XX, ZZ = np.meshgrid(xs_, zs_)
Vg = np.stack([XX.ravel(), np.zeros(XX.size), ZZ.ravel()], 1)
ig = np.arange(Vg.shape[0]).reshape(nzg + 1, nxg + 1)
Fg = [(ig[i, j], ig[i, j + 1], ig[i + 1, j + 1], ig[i + 1, j]) for i in range(nzg) for j in range(nxg)
      if zs_[i] < zr(0.5 * (xs_[j] + xs_[j + 1])) - 0.08]
meg = bpy.data.meshes.new('gable-plaster')
meg.from_pydata(Vg.tolist(), [], Fg)
uvg = meg.uv_layers.new(name='UVMap')
lv = np.zeros(len(meg.loops), np.int32)
meg.loops.foreach_get('vertex_index', lv)
uvg.data.foreach_set('uv', np.stack([(Vg[lv, 0] - x0_) / (x1_ - x0_), (Vg[lv, 2] - z0_) / (z1_ - z0_)], 1).astype(np.float32).ravel())
meg.shade_smooth()
meg.materials.append(MAT_PLASTER)
gable_coll = bpy.data.collections.new('roof-gable')
obg = bpy.data.objects.new('gable-plaster', meg)
gable_coll.objects.link(obg)
mk.displace(obg, 'plaster-gable', mk.PLASTER['gable']['range'])
timber_object('gable', gable_coll)
XC = 12.25
for nm, M in (('gable-left', Matrix.Translation((0, GW, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')),
              ('gable-right', Matrix.Translation((XC, GW, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Diagonal((-1, 1, 1, 1)))):
    e = bpy.data.objects.new(nm, None)
    e.instance_type = 'COLLECTION'
    e.instance_collection = gable_coll
    e.matrix_world = M
    scene.collection.objects.link(e)

# the deck above the soffit, under the tiles (closes the attic; never seen)
deck_parts = []
for side in (1, -1):
    ye = Y_BOARD_OUT if side == 1 else BACK_FACE + TAIL
    zlo = deck_z(Y_BOARD_OUT) - DECK
    pts = []
    for (x, y) in ((X0, ye), (X1, ye), (X1, Y_RIDGE), (X0, Y_RIDGE)):
        pts.append((x, y, zlo + abs(y - ye) * TANP))
    pts += [(p[0], p[1], p[2] + DECK) for p in pts]
    skew_box(deck_parts, pts)
# eaves blocking between the joists on the wall line closes the attic
for yb in (FRONT_FACE + 0.02, BACK_FACE - 0.06):
    yf = yb if yb < Y_RIDGE else 2 * Y_RIDGE - (yb + 0.04)   # the front-slope equivalent
    box(deck_parts, (X0 + 0.01, yb, PLATE_TOP), (X1 - 0.01, yb + 0.04, deck_z(yf) - DECK))
flat_object('roof-deck', deck_parts, MAT_DECK)
log('timber', len(mk.MEMBERS), 'members')

# ================================================================= tiles
def moss_material():
    mat, nn, ll, mo = new_mat('roof-moss')
    bs = nn.new('ShaderNodeBsdfPrincipled'); bs.name = 'BSDF'
    bs.inputs['Roughness'].default_value = 0.95
    tc = nn.new('ShaderNodeTexCoord')
    nz = nn.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 900.0; nz.inputs['Detail'].default_value = 6
    ll.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nn.new('ShaderNodeValToRGB'); ramp.name = 'ALB'
    ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (*srgb2lin((44, 50, 22)), 1)
    ramp.color_ramp.elements[1].position = 0.7; ramp.color_ramp.elements[1].color = (*srgb2lin((96, 104, 46)), 1)
    ll.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    ll.new(ramp.outputs['Color'], bs.inputs['Base Color'])
    bp = nn.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.8
    ll.new(nz.outputs['Fac'], bp.inputs['Height']); ll.new(bp.outputs['Normal'], bs.inputs['Normal'])
    ll.new(bs.outputs[0], mo.inputs['Surface'])
    return mat


MAT_MOSS = moss_material()


def moss_tuft(parts, centre, normal, rng):
    """A small squashed cushion of moss where a cover's edge meets the pan beneath it."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    r = rng.uniform(0.01, 0.022)
    n = Vector(normal).normalized()
    R = n.to_track_quat('Z', 'Y').to_matrix()
    for v in bm.verts:
        c = v.co
        k = 1 + 0.35 * math.sin(7 * c.x + 3 * c.y) * math.cos(5 * c.z + 2 * c.x)
        c = Vector((c.x * r * k, c.y * r * 0.8 * k, max(c.z, -0.1) * r * 0.22))
        v.co = Vector(centre) + R @ c
    V = np.array([v.co[:] for v in bm.verts])
    F = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    parts.append((V, F))


def build_piece_tiles(name, rng, mb, moss):
    """Front-slope tiles of one piece: pans in its channels, covers over its left joint and inner joints
    (and, for the right verge, over its outer edge too), and restrained moss where cover edges meet pans."""
    xa, xb = PIECE_SPANS[name]
    n = int(round((xb - xa) / CHANNEL))
    joints = [xa + c * CHANNEL for c in range(n)] + ([xb] if name == 'verge-right' else [])
    bay = name.startswith('bay')

    def sag(x, s):
        # courses belly slightly between the bay lines and between the purlins (thirds of the slope)
        along = math.sin(math.pi * (x - xa) / (xb - xa)) if bay else 0.0
        up = abs(math.sin(3 * math.pi * s / SLOPE_LEN))
        return -0.012 * along - 0.006 * up

    def wander(x, s, ph):
        # each channel sits a few mm off true along its whole run (zero at the piece's edges so joints meet);
        # it must not change course to course, or a tile's rim cuts through the tile lapping over it
        edge = math.sin(math.pi * (x - xa) / (xb - xa)) if bay else 0.0
        return edge * 0.004 * math.sin(ph)

    ph = rng.uniform(0, 6, n + 1)
    for c in range(n):
        xc = xa + (c + 0.5) * CHANNEL
        for k in range(N_COURSE):
            s = k * EXPOSE + rng.normal(0, 0.003)
            slot = BY_ROLE['pan'][int(rng.integers(len(BY_ROLE['pan'])))]
            jit = dict(wobble=float(rng.normal(0, 0.006)), ph=float(rng.uniform(0, 6)))
            a_, b_ = PAN_POSE[k]
            lift = a_ + abs(rng.normal(0, 0.001)) + sag(xc, s)
            F = slope_frame(1, xc + wander(xc, s, ph[c]) + rng.normal(0, 0.0015), s, lift, rng.normal(0, 0.003),
                            rng.normal(0, 0.006), math.atan(b_) + rng.normal(0, 0.002))
            mb.add(*tile_geometry(slot, 'pan', F, jit), tile_tint(rng, weathering(xc - xa, s)))
    cl = cover_lift(CHANNEL - PAN_W[0] + 0.004)
    for ci, xg in enumerate(joints):
        pj = 0.5 * (ph[max(ci - 1, 0)] + ph[min(ci, n - 1)])
        for k in range(N_COURSE):
            s = k * EXPOSE + COVER_OFFSET + rng.normal(0, 0.003)   # covers hide the pans' rim ends
            slot = BY_ROLE['cover'][int(rng.integers(len(BY_ROLE['cover'])))]
            jit = dict(wobble=float(rng.normal(0, 0.006)), ph=float(rng.uniform(0, 6)))
            a_, b_ = COVER_POSE[k]
            lift = a_ + abs(rng.normal(0, 0.0015)) + sag(xg, s)
            F = slope_frame(1, xg + wander(xg, s, pj) + rng.normal(0, 0.0015), s, lift, rng.normal(0, 0.003),
                            rng.normal(0, 0.006), math.atan(b_) + rng.normal(0, 0.002))
            mb.add(*tile_geometry(slot, 'cover', F, jit), tile_tint(rng, weathering(xg - xa, s)))
            # moss: a few cushions where this cover's lower edge sits in the pans, more near the eave
            for sgn in (-1, 1):
                if False:   # cushions read as CG spheres (K2 candidate 4); moss stays in the texture
                    Fm = slope_frame(1, xg + sgn * 0.09, s + rng.uniform(0.0, 0.05), 0.03, 0.0, 0.0, 0.0)
                    moss_tuft(moss, Fm[:3, 3], Fm[:3, 2], rng)
    return n


rng = np.random.default_rng(A.seed + 1)
M_BACK = (Matrix.Translation((X_MID, Y_RIDGE, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
          @ Matrix.Translation((-X_MID, -Y_RIDGE, 0)))
for name in PIECE_SPANS:
    mb, moss = MeshBuilder(), []
    n = build_piece_tiles(name, rng, mb, moss)
    ob = mb.build('roof-%s-tiles' % name, MAT_TILE)
    ob.data.transform(Matrix.Translation(-Vector(pivot(name))))
    PIECE_COLL[name].objects.link(ob)
    if name in VERGE_MORTAR:
        vm = flat_object('roof-%s-pointing' % name, VERGE_MORTAR[name], MAT_MORTAR)
        scene.collection.objects.unlink(vm)
        vm.data.transform(Matrix.Translation(-Vector(pivot(name))))
        PIECE_COLL[name].objects.link(vm)
    if moss:
        mo_ = flat_object('roof-%s-moss' % name, moss, MAT_MOSS)
        scene.collection.objects.unlink(mo_)
        mo_.data.transform(Matrix.Translation(-Vector(pivot(name))))
        mo_.data.shade_smooth()
        PIECE_COLL[name].objects.link(mo_)
    log('piece', name, n, 'channels', len(mb.F), 'faces', len(moss), 'moss')
placements = [('verge-left', XB0 - 0.5 * VERGE_CH * CHANNEL)] + [('bay-' + v, XB0 + 2.0 * k + 1.0) for k, v in enumerate(BAYS)] \
    + [('verge-right', XB0 + 2.0 * NBAY + 0.5 * VERGE_CH * CHANNEL)]
for i, (name, xc) in enumerate(placements):
    base = Matrix.Translation((xc, Y_MOUTH, deck_z(Y_MOUTH)))
    for slope, M in (('front', base), ('back', M_BACK @ base)):
        e = bpy.data.objects.new('roof-place-%s-%02d-%s' % (slope, i, name), None)
        e.instance_type = 'COLLECTION'
        e.instance_collection = PIECE_COLL[name]
        e.matrix_world = M
        scene.collection.objects.link(e)

# ridge pieces: caps along the ridge on a lime mortar bed, one piece per 2 m bay and one per verge span
# (placed once; the ridge is shared by both slopes). Pivot on the ridge line at the piece's centre.
# the caps' rims rest on the top covers' crowns at the caps' half-width, so the caps stand proud of both
# slopes and the mortar shows only as a bedding line under their rims
_rc = 0.5 * COVER_W[0] / math.sin(0.5 * TILE_ARC)
_a, _b = COVER_POSE[-1]
COVER_TOP = max(_a + _b * u + float(np.nanmax(cov_surf(np.zeros(1), u, True))) for u in np.linspace(0, TILE_L, 9))


def cover_crown_at(y_plan):
    """World height of the top course's cover crown where it passes plan position y_plan (front slope),
    from its pose as slope_frame places it; the crown narrows and falls toward the cover's upper end."""
    s_k = (N_COURSE - 1) * EXPOSE + COVER_OFFSET
    t = math.atan(_b)
    y_e = Y_BOARD_OUT - EAVE_PROJ

    def at(u):
        zc = float(cov_surf(np.zeros(1), u, True)[0])
        return (y_e + s_k * COSP - _a * SINP + u * math.cos(PITCH + t) - zc * SINP,
                deck_z(y_e) + s_k * SINP + _a * COSP + u * math.sin(PITCH + t) + zc * COSP)
    lo, hi = 0.0, TILE_L
    if at(hi)[0] < y_plan:
        return at(hi)[1]
    for _ in range(40):
        mid_ = 0.5 * (lo + hi)
        lo, hi = (mid_, hi) if at(mid_)[0] < y_plan else (lo, mid_)
    return at(0.5 * (lo + hi))[1]


# The caps' rims rest on the top covers' crowns where the rims land (candidate 9). Candidates 1-8 set them at
# the covers' highest crown (their downhill ends), 30-40 mm above the covers under the rims, and the
# bedding showed in the gap.
top_z = cover_crown_at(Y_RIDGE - 0.5 * RIDGE_W)
log('ridge caps: rim height %.4f (candidate 8 %.4f)' % (top_z, deck_z(Y_RIDGE - 0.5 * RIDGE_W) + COVER_TOP / COSP + 0.01))
RIDGE_STEP = 0.40                             # 0.45 m caps lapping 5 cm along the ridge
MORTAR_HW = 0.5 * RIDGE_W - 0.035              # the bedding's half-width, 35 mm inside the cap rims


def build_ridge(name, xa, xb, rng):
    mb, mortar = MeshBuilder(), []
    n = max(1, int(round((xb - xa) / RIDGE_STEP)))
    step = (xb - xa) / n
    for i in range(n):
        x = xa + i * step
        # over a bay the covers belly 12 mm between the bay lines (build_piece_tiles' sag); the caps follow them
        belly = -0.012 * math.sin(math.pi * (x + 0.5 * RIDGE_L - xa) / (xb - xa)) if name.startswith('ridge-') and             name[6:].isdigit() else 0.0
        o = Vector((x, Y_RIDGE + rng.normal(0, 0.004), top_z + belly + rng.normal(0, 0.002)))
        ex = Vector((1, 0, math.atan(TILE_T / RIDGE_L))).normalized()
        ez = Vector((0, 0, 1))
        ey = ez.cross(ex).normalized()
        ez = ex.cross(ey)
        M = np.array(Matrix(((ex.x, ey.x, ez.x, o.x), (ex.y, ey.y, ez.y, o.y), (ex.z, ey.z, ez.z, o.z), (0, 0, 0, 1))))
        slot = BY_ROLE['ridge'][int(rng.integers(len(BY_ROLE['ridge'])))]
        mb.add(*tile_geometry(slot, 'ridge', M, dict(wobble=float(rng.normal(0, 0.01)), ph=float(rng.uniform(0, 6)))), tile_tint(rng))
    # The bedding stays inside the caps (candidate 9): its faces stand MORTAR_IN inside the cap rims, so it
    # shows only as packing in the pan channels' ends, in the caps' shadow. Candidates 1-8 ran a slab wider
    # than the caps up to their rims, and it read as a beam the top courses butted into.
    zb = deck_z(Y_RIDGE - MORTAR_HW) - 0.05
    xm0 = xa + (0.05 if name == 'ridge-left' else 0.0)
    xm1 = xb - (0.05 if name == 'ridge-right' else 0.0)
    prof = [(-MORTAR_HW, zb), (-MORTAR_HW, top_z + 0.03), (0.0, top_z + 0.10), (MORTAR_HW, top_z + 0.03), (MORTAR_HW, zb)]
    P_ = [(xm, Y_RIDGE + y_, z_) for xm in (xm0, xm1) for (y_, z_) in prof]
    n_p = len(prof)
    mortar.append((np.array(P_), [tuple(range(n_p - 1, -1, -1)), tuple(range(n_p, 2 * n_p))]
                   + [(i, (i + 1) % n_p, n_p + (i + 1) % n_p, n_p + i) for i in range(n_p)]))
    # End fill (candidate 9): a plug inside the end cap's arch only, down to its rims' chord and 15 mm in from
    # its end. Candidates 1-8 ran a flat plate over the whole arch and down past the tiles to below the deck,
    # which stood on the gable like a tombstone. The right end is the last cap's narrow, lapped-up end.
    ends = ((xa + 0.015, +1, 0.0, 1.0, name == 'ridge-left'),
            (xa + (n - 1) * step + RIDGE_L - 0.015, -1, TILE_T, 0.92, name == 'ridge-right'))
    for xe, inward, dz, wf, grow in ends:
        if not grow:
            continue
        rr_ = 0.5 * RIDGE_W * wf / math.sin(0.5 * TILE_ARC) - 0.004
        ph_ = np.linspace(-0.5, 0.5, 17) * TILE_ARC
        ring = [(xe, Y_RIDGE + rr_ * math.sin(q), top_z + dz + rr_ * math.cos(q) - (rr_ + TILE_T) * math.cos(0.5 * TILE_ARC))
                for q in ph_]
        P = np.array(ring + [(x_ + inward * 0.03, y_, z_) for (x_, y_, z_) in ring])
        n_ = len(ring)
        F = [tuple(range(n_)), tuple(range(2 * n_ - 1, n_ - 1, -1))] + [(i, (i + 1) % n_, n_ + (i + 1) % n_, n_ + i) for i in range(n_)]
        mortar.append((P, F))
    coll = bpy.data.collections.new('roof-' + name)
    pv = Vector((0.5 * (xa + xb), Y_RIDGE, top_z))
    ob = mb.build('roof-%s-caps' % name, MAT_TILE)
    ob.data.transform(Matrix.Translation(-pv))
    coll.objects.link(ob)
    mo_ = flat_object('roof-%s-mortar' % name, mortar, MAT_MORTAR)
    bm_ = bmesh.new()                              # closed solids: outward normals whatever the vertex order
    bm_.from_mesh(mo_.data)
    bmesh.ops.recalc_face_normals(bm_, faces=bm_.faces)
    bm_.to_mesh(mo_.data)
    bm_.free()
    scene.collection.objects.unlink(mo_)
    mo_.data.transform(Matrix.Translation(-pv))
    coll.objects.link(mo_)
    return coll, n


RIDGE_SPANS = [('ridge-left', X0 + 0.04, XB0)] + [('ridge-%d' % k, XB0 + 2.0 * k, XB0 + 2.0 * (k + 1)) for k in range(NBAY)] \
    + [('ridge-right', XB0 + 2.0 * NBAY, X1 - 0.04)]
n_caps = 0
for name, xa, xb in RIDGE_SPANS:
    coll, n = build_ridge(name, xa, xb, rng)
    n_caps += n
    e = bpy.data.objects.new('roof-place-%s' % name, None)
    e.instance_type = 'COLLECTION'
    e.instance_collection = coll
    e.matrix_world = Matrix.Translation((0.5 * (xa + xb), Y_RIDGE, top_z))
    scene.collection.objects.link(e)
log('ridge', n_caps, 'caps in', len(RIDGE_SPANS), 'pieces')

# ================================================================= staging, views, render
world = scene.world
sky = next(n for n in world.node_tree.nodes if n.type == 'TEX_SKY')
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
sun = bpy.data.objects['Sun']
sun_d = sun.data
cam = scene.camera
cam_d = cam.data
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
for d in prefs.devices:
    d.use = d.type == 'OPTIX'
scene.cycles.device = 'GPU'
scene.cycles.samples = A.samples


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
    'gable': dict(eye=(-7.5, -9.5, 1.7), target=(3.5, 1.5, 5.6), lens=26, sun=KEY, sky=2.0, res=(1536, 1024)),
    'eave': dict(eye=(13.9, -1.6, 4.3), target=(12.1, -0.3, 6.7), lens=24, sun=KEY, sky=2.0, res=(1312, 1200)),
    'tile': dict(eye=(5.75, -1.55, 7.45), target=(5.95, -0.3, 6.9), lens=35, sun=KEY, sky=2.0, res=(1312, 1200)),
    'underside': dict(eye=(5.0, -1.6, 1.7), target=(5.6, -0.25, 6.6), lens=24, sun=KEY, sky=2.0, res=(1536, 1024)),
    'street': dict(eye=(-4.0, -9.5, 1.7), target=(7.5, 1.0, 5.4), lens=22, sun=KEY, sky=2.0, res=(1536, 1024)),
    'verge': dict(eye=(-3.6, -2.4, 3.2), target=(-0.2, 1.6, 7.4), lens=26, sun=KEY, sky=2.0, res=(1536, 1024)),
    'overview': dict(eye=(17.5, -13.0, 11.0), target=(6.0, 2.5, 6.0), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    'overview-rear': dict(eye=(-8.5, 18.0, 12.0), target=(6.0, 3.5, 6.0), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    'front': dict(eye=(6.0, -14.0, 3.0), target=(6.0, 0.0, 5.0), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    # diagnostic: straight down the front slope's normal onto a 1.5 m patch of tiles
    'tailcheck': dict(eye=(4.6, -1.35, 6.3), target=(4.79, -0.5, 6.7), lens=50, sun=KEY, sky=2.0, res=(1312, 1200)),
    'cornercheck': dict(eye=(-1.6, -1.8, 6.2), target=(-0.3, -0.4, 6.75), lens=45, sun=KEY, sky=2.0, res=(1312, 1200)),
    'ridgecheck': dict(eye=(4.0, -1.0, 10.6), target=(5.5, 3.1, 9.6), lens=40, sun=KEY, sky=2.0, res=(1312, 1200)),
    'ridgeside': dict(eye=(-2.5, 3.1, 9.9), target=(1.0, 3.1, 9.8), lens=50, sun=KEY, sky=2.0, res=(1312, 1200)),
    'plan': dict(eye=(6.0, 1.3 - 2.2 * math.sin(PITCH), 7.9 + 2.2 * math.cos(PITCH)), target=(6.0, 1.3, 7.9), lens=35, sun=KEY, sky=2.0, res=(1312, 1200)),
    'overcast': dict(eye=(-7.5, -9.5, 1.7), target=(3.5, 1.5, 5.6), lens=26, sun=(34, -35, 0.0), sky=6.0, res=(1536, 1024)),
    'low': dict(eye=(-7.5, -9.5, 1.7), target=(3.5, 1.5, 5.6), lens=26, sun=(12, -150, 4.5), sky=2.0, res=(1536, 1024)),
}
VIEWS['gray'] = dict(VIEWS['gable'], mode='gray')
VIEWS['unlit'] = dict(VIEWS['gable'], mode='unlit')
VIEWS['tailunlit'] = dict(VIEWS['cornercheck'], mode='unlit')
VIEWS['tailgray'] = dict(VIEWS['cornercheck'], mode='gray')


def set_mode(mode):
    """K1's diagnostic modes, applied to every mapped material (K1's and the roof's)."""
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        bs, ta, mo = nt.nodes.get('BSDF'), nt.nodes.get('ALB'), nt.nodes.get('Material Output')
        if bs is None or mo is None:
            continue
        if ta is None:   # flat materials
            if mode == 'gray':
                mat['_base'] = list(bs.inputs['Base Color'].default_value) if '_base' not in mat else mat['_base']
                bs.inputs['Base Color'].default_value = (0.18, 0.18, 0.18, 1)
            elif '_base' in mat:
                bs.inputs['Base Color'].default_value = mat['_base']
            continue
        src = ta.outputs[2] if ta.type == 'MIX' else ta.outputs[0]
        for l_ in list(bs.inputs['Base Color'].links) + list(mo.inputs['Surface'].links):
            nt.links.remove(l_)
        if mode == 'gray':
            bs.inputs['Base Color'].default_value = (0.18, 0.18, 0.18, 1)
            nt.links.new(bs.outputs[0], mo.inputs['Surface'])
        elif mode == 'unlit':
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
    set_sun(*V['sun'])
    bg.inputs['Strength'].default_value = V['sky']
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

if A.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'source.blend'), relative_remap=True, compress=True)


def sha(p):
    with open(p, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


files = sorted(os.path.relpath(os.path.join(d, n), OUT).replace('\\', '/') for d, _, ns in os.walk(OUT) for n in ns)
write_json(os.path.join(OUT, 'receipt.json'), {
    'createdUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'blender': bpy.app.version_string,
    'args': vars(A),
    'walls': {'path': os.path.relpath(WALLS, HERE).replace('\\', '/'), 'sha256': sha(WALLS)},
    'seconds': round(time.perf_counter() - T0, 1),
    'geometry': {'pitchDegrees': 40, 'ridgeDeckMetres': round(Z_RIDGE_DECK, 4), 'courses': N_COURSE,
                 'exposureMetres': round(EXPOSE, 4), 'channelMetres': round(CHANNEL, 4)},
    'files': [{'path': p, 'sha256': sha(os.path.join(OUT, p))} for p in files if p != 'receipt.json'],
})
log('done')
