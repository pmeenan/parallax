# K1 timber-framed wall delivery, stage 3: runtime maps and mip chains.
# blender -b --factory-startup --python-exit-code 1 --python maps.py -- --extract <dir> --out <dir>
#     [--oak-factor 2] [--stone-factor 2] [--plaster-factor 2] [--plaster-normal-factor 1]
#     [--plaster-orm-factor 2] [--orm-factor 2]
#
# One base colour / normal / ORM set per runtime material, from accepted candidate 18's maps:
#   base colour  approved albedo (sRGB)
#   normal       full normal: the low-pass height slopes the geometry carries plus the approved
#                detail normal, because runtime vertex normals are the undisplaced base surface's
#   ORM          R height-field AO, G roughness, B occluding height over its recorded range (sun
#                micro-shadowing, D-206). A plaster's occluding height includes the timber and iron
#                standing proud of it, so they cast their short sun shadows onto the plaster.
# Factors divide the source texel density (oak 0.75 mm, stone 1.25 mm, plaster 1 mm); the ORM is
# a further --orm-factor coarser. The oak and stone atlases keep candidate 18's packing: the
# builder snapshot's packing stage is re-run to recover every island, so normals and AO never
# read a neighbouring island and texels outside any island are filled from their neighbours
# (push-pull) instead of bleeding black into mips. Mortar and soil stay 1 m repeat tiles, the foot
# plants get the paving's 1024 x 512 atlas layout, and iron, glass and the interior are constants.
# Every array here has row 0 at v = 0 (Blender's UV origin); rows flip on the way out.
import argparse
import hashlib
import json
import math
import os
import struct
import sys
import zlib

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--extract', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--oak-factor', type=int, default=2)
ap.add_argument('--stone-factor', type=int, default=1)
ap.add_argument('--plaster-factor', type=int, default=1)
ap.add_argument('--orm-factor', type=int, default=2)
# Plaster slots take their own densities: its air pits and loss steps live in the normal, which
# candidate 1's screens found lost at 2 mm inside a metre; the ORM's timber shadows stair-stepped
# at 4 mm (both relative to the 1 mm source).
ap.add_argument('--plaster-normal-factor', type=int, default=1)
ap.add_argument('--plaster-orm-factor', type=int, default=2)
# The plinth stones' relief (up to 34 mm) needs its occluding height at the stone's own density.
ap.add_argument('--stone-orm-factor', type=int, default=1)
# The oak normal may ship coarser than its base colour (house kit memory round): the figure is in
# the colour, the checks and arrises in the normal. Default: the oak factor.
ap.add_argument('--oak-normal-factor', type=int, default=None)
# The oak ORM (AO, roughness, micro-shadow height) may ship coarser than the other ORMs (house kit
# memory round). Default: --orm-factor.
ap.add_argument('--oak-orm-factor', type=int, default=None)
ap.add_argument('--tile-size', type=int, default=512)
ap.add_argument('--ao-radius-mm', type=float, default=40.0)
ap.add_argument('--ao-directions', type=int, default=16)
ap.add_argument('--ao-steps', type=int, default=16)
# Plaster AO with its proud timber: a post stands 40-55 mm proud, and a wall point beside it loses
# (1 - cos(atan(h/d)))/2 of its cosine-weighted sky (27% at 20 mm, 9% at 60 mm). The paving's 40 mm
# radius with its distance falloff kept only the last 12-20 mm, so the recess beside a post stayed
# near fully lit against Cycles (delivery candidate 4).
ap.add_argument('--plaster-ao-radius-mm', type=float, default=None)
ap.add_argument('--plaster-ao-falloff', type=int, default=1)
# Net shrink of the timber occluder footprint after its 3 mm closing, in source texels (1 mm).
# 3 left post shadows about 5 mm short of the source's (delivery candidate 4); 1 keeps the plaster
# texels at the timber's edge on the plaster's own height, so no lit sliver returns.
ap.add_argument('--occluder-erode-texels', type=int, default=1)
# Shared tiling detail (K2 delivery memory round, engine pbr-detail): <dir> is detail.py's output
# (d1-roof/proof-2026-09-28), and --detail names the classes that use it with their normal and
# albedo gains, e.g. 'plaster:1,1;oak:1,0'. Each tile ships as its own map (slot 'detail').
ap.add_argument('--detail-dir', default=None)
ap.add_argument('--detail', default='')
A = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = 'candidate20'  # the accepted source (candidate 20 since the 2026-09-27 brace and corner fixes)
SRC = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-25', SOURCE))
EXT = os.path.abspath(A.extract)
OUT = os.path.abspath(A.out)
if os.path.isdir(OUT) and os.listdir(OUT):
    sys.exit('refusing to overwrite existing output %s' % OUT)
os.makedirs(os.path.join(OUT, 'mips'), exist_ok=True)


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 24), b''):
            h.update(block)
    return h.hexdigest()


receipt = json.load(open(os.path.join(SRC, 'receipt.json'), encoding='utf-8'))
src_sha = {e['path']: e['sha256'] for e in receipt['files']}
for p in ('build-snapshot.py', 'source.blend'):
    assert sha(os.path.join(SRC, p)) == src_sha[p], p
extract = json.load(open(os.path.join(EXT, 'extract.json'), encoding='utf-8'))
assert extract['source'] == SOURCE

# ---------------------------------------------------------------- atlas islands from the builder
# The snapshot's kit description and packing run before any field or Blender scene is made; they
# consume the seeded RNG exactly as the accepted build did, so the islands are the source's.
snapshot = open(os.path.join(SRC, 'build-snapshot.py'), encoding='utf-8').read()
prefix = snapshot[:snapshot.index('\ndef paste(')]
head = prefix.index('OUT = os.path.abspath(A.out)')
tail = prefix.index("    f.write(builder_bytes)\n") + len("    f.write(builder_bytes)\n")
prefix = prefix[:head] + 'OUT = MAPS = None\n' + prefix[tail:]
prefix = prefix.replace('A = ap.parse_args(argv)', 'A = ap.parse_args(_ARGS)')
args = receipt['args']
_ARGS = ['--out', 'unused', '--px', str(args['px']), '--stone-px', str(args['stone_px']), '--oak-px',
         str(args['oak_px']), '--coarse', str(args['coarse']), '--subdiv', str(args['subdiv']),
         '--seed', str(args['seed'])]
NS = dict(__file__=os.path.join(SRC, 'build-snapshot.py'), __name__='snapshot', _ARGS=_ARGS)
exec(compile(prefix, 'build-snapshot.py', 'exec'), NS)
for cls, (w, h) in receipt['atlases'].items():
    assert (NS['ATLAS'][cls]['W'], NS['ATLAS'][cls]['H']) == (w, h), cls
PAD = NS['PAD']
ISLANDS = {cls: [] for cls in ('oak', 'stone')}
for m in NS['MEMBERS']:
    for k, (w, h) in m.rects.items():
        x, y = NS['ATLAS'][m.cls]['pos'][(id(m), k)]
        pu, pv = (m.pxs, m.pxt) if k == 'strip' else (m.px, m.px)
        ISLANDS[m.cls].append((x, y, w, h, pu, pv))
PX_SRC = {'oak': NS['OPX'], 'stone': NS['SPX']}
print('islands', {k: len(v) for k, v in ISLANDS.items()}, flush=True)

# ---------------------------------------------------------------- displacement ranges
bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, 'source.blend'))
RANGES = {}
for ob in bpy.data.objects:
    for md in ob.modifiers:
        if md.type == 'DISPLACE':
            lo = -md.mid_level * md.strength
            RANGES[md.texture.image.name.replace('-height.png', '')] = (lo, lo + md.strength)
for cls in ('oak', 'stone'):
    assert np.allclose(RANGES[cls], receipt['heightRangeMetres'][cls], atol=1e-6), cls


# ---------------------------------------------------------------- IO and colour
def read_png(name):
    """Exact decoder for the builder's PNGs (filter 0, no interlace). Row 0 is v = 0."""
    path = os.path.join(SRC, 'maps', name)
    raw = open(path, 'rb').read()
    assert hashlib.sha256(raw).hexdigest() == src_sha['maps/' + name], name
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


def height_m(name, rng):
    return (rng[0] + read_png(name).astype(np.float32) / 65535.0 * (rng[1] - rng[0])).astype(np.float32)


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
    occluders toward the radius (the paving's artistic choice); without it the estimate is the
    geometric one."""
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
records = []


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


def emit(material, slot, level0, note, **extra):
    enc = {'basecolor': enc_color, 'normal': enc_normal, 'orm': enc_orm, 'detail': enc_orm}[slot]
    role = '%s-%s' % (material, slot)
    files = []
    for lv, rgba in enumerate(chain(level0, enc)):
        path = os.path.join(OUT, 'mips', '%s-%02d.rgba' % (role, lv))
        data = np.ascontiguousarray(rgba[::-1]).tobytes()  # KTX2 rows are top-down
        with open(path, 'wb') as f:
            f.write(data)
        files.append(dict(file='mips/' + os.path.basename(path), width=rgba.shape[1], height=rgba.shape[0],
                          sha256=hashlib.sha256(data).hexdigest()))
        if lv == 0 and max(rgba.shape[:2]) <= 8192:
            write_png(os.path.join(OUT, role + '.png'), rgba[..., :3])
    records.append(dict(material=material, slot=slot, role=role, srgb=slot == 'basecolor', note=note,
                        levels=files, **extra))
    print('emit', role, level0.shape[1], 'x', level0.shape[0], flush=True)


MATERIALS = {}


def orm_record(material, occlusion, rough, height, note, texel_mm, address='clamp-to-edge', metallic=0.0):
    if height is None:
        # Lite multiplies the metallic factor by ORM.B; surfaces without height carry 1 there.
        orm_b, extra = np.full_like(rough, 1.0 if metallic > 0 else 0.0), {}
    else:
        lo, hi = float(height.min()), float(height.max())
        orm_b, extra = (height - lo) / (hi - lo), dict(ormHeightRangeMetres=[lo, hi])
    emit(material, 'orm', np.stack([occlusion, rough, orm_b], -1), note, **extra)
    ao = dict(mean=float(occlusion.mean()), p01=float(np.percentile(occlusion, 1)),
              minimum=float(occlusion.min()))
    MATERIALS[material] = dict(MATERIALS.get(material, {}), ormTexelMm=texel_mm, textureAddressMode=address,
                               ambientOcclusion=ao, **extra)


# ---------------------------------------------------------------- oak and stone atlases
def atlas(cls, f):
    W, Hh = receipt['atlases'][cls]
    px = PX_SRC[cls]
    H = height_m(cls + '-height.png', RANGES[cls])
    rgh = read_png(cls + '-roughness.png').astype(np.float32) / 255.0
    occ = np.zeros((Hh, W), bool)
    ids = np.full((Hh, W), -1, np.int32)
    N = np.zeros((Hh, W, 3), np.float32)
    N[..., 2] = 1
    nd = read_png(cls + '-normal.png')
    for i, (x, y, w, h, pu, pv) in enumerate(ISLANDS[cls]):
        ys, xs = slice(y - PAD, y + h + PAD), slice(x - PAD, x + w + PAD)
        occ[ys, xs] = True
        ids[ys, xs] = i
        N[ys, xs] = full_normal(H[ys, xs], nd[ys, xs], pu, pv)
    del nd
    assert (rgh[occ] > 0).all() and (rgh[~occ] == 0).all(), 'island recovery disagrees with the maps'
    alb = srgb2lin(read_png(cls + '-albedo.png') / 255.0)
    if cls == 'oak':
        # The source multiplied the oak's albedo by its 0.25 mm fibre layer (Map Range 0.82-1.15 of
        # the detail albedo) wherever the detail mask is set. The runtime drops that sub-texel layer,
        # so it keeps its mean darkening; without it the delivered oak read 13-15% lighter.
        detail = read_png('oak-detail-albedo.png').astype(np.float32) / 255.0
        fibre = float(0.82 + 0.33 * detail.mean())
        mask = read_png('oak-detailmask.png') > 127
        alb[mask] *= fibre
        MATERIALS.setdefault('kit-oak', {})['fibreAlbedoFactor'] = fibre
        del mask
    # Base colour and normal at the runtime density, empty texels filled from the islands.
    albf, known = pool(alb, f, occ)
    del alb
    fn = A.oak_normal_factor if cls == 'oak' and A.oak_normal_factor else f
    Nf, known_n = pool(N, fn, occ)
    del N
    Nf /= np.maximum(np.linalg.norm(Nf, axis=-1, keepdims=True), 1e-6)
    albf, Nf = push_pull(albf, known), push_pull(Nf, known_n)
    emit('kit-' + cls, 'basecolor', albf, 'sRGB albedo, %g mm texels, islands push-pull filled' % (px * f * 1000))
    emit('kit-' + cls, 'normal', Nf, 'OpenGL (+Y up) tangent space; low-pass slopes + detail; renormalized mips')
    del albf, Nf
    # ORM a further factor coarser; AO and height never read another island.
    fo = f * (A.stone_orm_factor if cls == 'stone' else A.oak_orm_factor or A.orm_factor)
    Ho, knowno = pool(H, fo, occ)
    ro, _ = pool(rgh, fo, occ)
    c = fo // 2
    ido = ids[c::fo, c::fo]
    Ho, ro = push_pull(Ho, knowno), push_pull(ro, knowno)
    occlusion = height_ao(Ho, ido, px * fo, px * fo, A.ao_radius_mm / 1000, A.ao_directions, A.ao_steps)
    occlusion = np.where(knowno, occlusion, 1.0).astype(np.float32)
    orm_record('kit-' + cls, occlusion, ro, Ho,
               'R island AO (%g mm), G roughness, B height; %g mm texels' % (A.ao_radius_mm, px * fo * 1000),
               px * fo * 1000)
    MATERIALS['kit-' + cls].update(texelMm=px * f * 1000, atlas=[W // f, Hh // f],
                                   islands=len(ISLANDS[cls]))
    if fn != f:
        MATERIALS['kit-' + cls]['normalTexelMm'] = px * fn * 1000


atlas('oak', A.oak_factor)
atlas('stone', A.stone_factor)


# ---------------------------------------------------------------- plaster: one set per bay variant
def npy(obj, name):
    return np.load(os.path.join(EXT, obj, name + '.npy'))


def facade_sources(piece):
    """(object, shift along the wall) for every oak or iron object placed on the same facade and
    storey as the piece's first placement, in the piece's own frame. Neighbouring bays shade a
    panel's margin with their real posts and plates: each bay's post carries its own seeded
    relief, and the corner piece's post is not a bay's. Placements that are not a pure shift along
    the wall (another facade or handedness) are skipped."""
    mats = {p['name']: np.array(p['matrix'], float) for p in extract['placements']}
    first = next(p for p in extract['placements'] if p['piece'] == piece)
    inv = np.linalg.inv(mats[first['name']])
    out = []
    for q in extract['placements']:
        if q['piece'] != 'corner' and q['piece'][:2] != piece[:2]:
            continue
        rel = inv @ mats[q['name']]
        if not (np.allclose(rel[:3, :3], np.eye(3), atol=1e-4) and abs(rel[1, 3]) < 1e-3 and abs(rel[2, 3]) < 1e-3):
            continue
        out += [(o, float(rel[0, 3])) for o in extract['kit'][q['piece']]]
    return out


def occluder(piece, rect):
    """Highest oak or iron surface in front of the plaster plane, rasterized onto the plaster grid
    from the extracted displaced source triangles (barycentric samples at half-texel spacing), for
    the piece and its real neighbours on the facade (`facade_sources`)."""
    x0, x1, z0, z1, shape = rect
    hgt = np.full(shape, -1.0, np.float32)
    sources = facade_sources(piece)
    for obj, own in sources:  # own: the shift along the wall, in metres
        if obj.startswith('plaster-') or obj.startswith('glass-'):
            continue
        P, T = npy(obj, 'P'), npy(obj, 'T').astype(np.int64)
        if P[:, 0].max() + own < x0 or P[:, 0].min() + own > x1:
            continue
        tri = P[T]  # (n, 3, 3)
        front = (-tri[..., 1]).max(1) > 0
        tri = tri[front]
        e = np.maximum(np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1), np.linalg.norm(tri[:, 2] - tri[:, 0], axis=1))
        texel = (x1 - x0) / shape[1]
        for n in sorted(set(np.clip(np.ceil(e / (0.5 * texel)).astype(int), 1, 64))):
            sel = tri[np.clip(np.ceil(e / (0.5 * texel)).astype(int), 1, 64) == n]
            a, b = np.meshgrid(np.arange(n + 1), np.arange(n + 1))
            keep = a + b <= n
            wa, wb = (a[keep] / n).astype(np.float32), (b[keep] / n).astype(np.float32)
            pts = (sel[:, None, 0] * (1 - wa - wb)[None, :, None] + sel[:, None, 1] * wa[None, :, None]
                   + sel[:, None, 2] * wb[None, :, None]).reshape(-1, 3)
            row = np.floor((pts[:, 2] - z0) / (z1 - z0) * shape[0]).astype(int)
            col = np.floor((pts[:, 0] + own - x0) / (x1 - x0) * shape[1]).astype(int)
            ok = (col >= 0) & (col < shape[1]) & (row >= 0) & (row < shape[0])
            np.maximum.at(hgt, (row[ok], col[ok]), -pts[ok, 1])
    return hgt


# Each plaster map carries a margin beyond its rectangle (geometry.mjs maps the plaster's UVs
# inside it). The timber around a panel mostly lies outside it (plates above, the next bay's post
# to the right), and a sun march that leaves the panel must still find those occluders: the
# margin carries the neighbouring pieces actually placed on the facade.
PLASTER_MARGIN_M = 0.1
PLASTER_AO_MM = A.ao_radius_mm if A.plaster_ao_radius_mm is None else A.plaster_ao_radius_mm
for piece, info in extract['layout']['pieces'].items():
    if not info['plaster']:
        continue
    x0, x1, z0, z1 = info['plaster'][:4]
    name = 'plaster-' + piece
    f = A.plaster_factor
    H = height_m(name + '-height.png', RANGES[name])
    nd = read_png(name + '-normal.png')
    rows, cols = H.shape
    pu, pv = (x1 - x0) / cols, (z1 - z0) / rows
    mu, mv = PLASTER_MARGIN_M / pu, PLASTER_MARGIN_M / pv
    assert abs(mu - round(mu)) < 1e-6 and abs(mv - round(mv)) < 1e-6, (mu, mv)
    mu, mv = int(round(mu)), int(round(mv))
    N = full_normal(H, nd, pu, pv)
    del nd
    alb = srgb2lin(read_png(name + '-albedo.png') / 255.0)
    rgh = read_png(name + '-roughness.png').astype(np.float32) / 255.0
    pad = ((mv, mv), (mu, mu))
    H, rgh = np.pad(H, pad, mode='edge'), np.pad(rgh, pad, mode='edge')
    N, alb = np.pad(N, pad + ((0, 0),), mode='edge'), np.pad(alb, pad + ((0, 0),), mode='edge')
    M = PLASTER_MARGIN_M
    timber = occluder(piece, (x0 - M, x1 + M, z0 - M, z1 + M, H.shape))
    # Close the footprint 3 mm first (fill checks and chips, so the shadow outline follows the
    # member, not its grain), then erode it (1 mm net): plaster texels at the timber's edge must
    # keep the plaster's own height, or the march starts on the timber top and a lit sliver runs
    # along its shadowed side.
    for _ in range(3):
        tp = np.pad(timber, 1, mode='edge')
        timber = np.maximum.reduce([timber, tp[:-2, 1:-1], tp[2:, 1:-1], tp[1:-1, :-2], tp[1:-1, 2:]])
    for _ in range(3 + A.occluder_erode_texels):
        tp = np.pad(timber, 1, mode='edge')
        timber = np.minimum.reduce([timber, tp[:-2, 1:-1], tp[2:, 1:-1], tp[1:-1, :-2], tp[1:-1, 2:]])
    # The plaster's own part of the occluding height is low-passed (sigma 3 mm): its air pits and
    # flakes live in the 1 mm normal, and at full detail they made each fragment's start height
    # wobble, so timber shadow edges went lumpy and the flakes cast over-dark cavities.
    Hs = np.fft.irfft2(np.fft.rfft2(H) * np.exp(-2 * math.pi ** 2 * (0.003 ** 2) * (
        (np.fft.fftfreq(H.shape[0], d=pv) ** 2)[:, None] + (np.fft.rfftfreq(H.shape[1], d=pu) ** 2)[None, :])),
        s=H.shape).astype(np.float32)
    Hocc = np.maximum(Hs, timber)
    albf, _ = pool(alb, f)
    Nf, _ = pool(N, A.plaster_normal_factor)
    Nf /= np.linalg.norm(Nf, axis=-1, keepdims=True)
    emit(name, 'basecolor', to_blocks(albf), 'sRGB albedo, %g mm texels' % (pu * f * 1000))
    emit(name, 'normal', to_blocks(Nf), 'OpenGL (+Y up); low-pass slopes + detail; renormalized mips; %g mm texels'
         % (pu * A.plaster_normal_factor * 1000))
    fo = A.plaster_orm_factor
    Ho, _ = pool(Hocc, fo)
    ro, _ = pool(rgh, fo)
    occlusion = height_ao(Ho, None, pu * fo, pv * fo, PLASTER_AO_MM / 1000, A.ao_directions, A.ao_steps,
                          falloff=bool(A.plaster_ao_falloff))
    orm_record(name, to_blocks(occlusion), to_blocks(ro), to_blocks(Ho),
               'R AO (%g mm%s) of plaster + proud timber, G roughness, B plaster + timber height; %g mm texels'
               % (PLASTER_AO_MM, '' if A.plaster_ao_falloff else ', no falloff', pu * fo * 1000), pu * fo * 1000)
    MATERIALS[name].update(texelMm=pu * f * 1000, normalTexelMm=pu * A.plaster_normal_factor * 1000, marginMetres=PLASTER_MARGIN_M,
                           timberCoverage=float((timber > H).mean()),
                           timberMaxHeightMm=float(timber.max() * 1000))
    del H, N, alb, rgh, timber, Hocc, albf, Nf, Ho, ro, occlusion

# ---------------------------------------------------------------- mortar and soil repeat tiles
T = A.tile_size
MORTAR_JOINT_AO = 0.4
for name in ('mortar', 'soil'):
    alb = srgb2lin(read_png(name + '-albedo.png') / 255.0)
    n0 = alb.shape[0]
    px = 1.0 / n0  # 1 m tiles
    nd = read_png(name + '-normal.png')
    rgh = read_png(name + '-roughness.png').astype(np.float32) / 255.0
    if name in RANGES:  # displaced: the geometry carries the low-pass height
        H = height_m(name + '-height.png', RANGES[name])
        Hw = np.pad(H, 1, mode='wrap')
        gx = (Hw[1:-1, 2:] - Hw[1:-1, :-2]) / (2 * px)
        gy = (Hw[2:, 1:-1] - Hw[:-2, 1:-1]) / (2 * px)
    else:  # the mortar core is a flat box: the source shaded it with the detail normal only
        H, gx, gy = None, 0.0, 0.0
    n = nd.astype(np.float32) / 127.5 - 1.0
    nz = np.maximum(n[..., 2], 0.05)
    N = np.stack([-(gx - n[..., 0] / nz), -(gy - n[..., 1] / nz), np.ones(nd.shape[:2], np.float32)], -1)
    N /= np.linalg.norm(N, axis=-1, keepdims=True)
    emit(name, 'basecolor', resize(alb, T, T, wrap=True), 'sRGB albedo, 1 m repeat tile')
    emit(name, 'normal', resize(N, T, T, wrap=True), 'OpenGL (+Y up), 1 m repeat tile')
    To = T // A.orm_factor
    ro = resize(rgh, To, To, wrap=True)
    if H is None:
        # The mortar core sits about 15 mm behind the stone faces in 5-13 mm joints: most of the sky
        # is hidden. Its own tile knows nothing of the stones, so the occlusion is a constant.
        orm_record(name, np.full_like(ro, MORTAR_JOINT_AO), ro, None,
                   'R %g joint occlusion, G roughness, B 0 (no height)' % MORTAR_JOINT_AO, 1000 / To, 'repeat')
    else:
        Ho = resize(H, To, To, wrap=True)
        occlusion = height_ao(Ho, None, 1 / To, 1 / To, A.ao_radius_mm / 1000, A.ao_directions, A.ao_steps, wrap=True)
        orm_record(name, occlusion, ro, Ho, 'R AO, G roughness, B height; 1 m repeat tile', 1000 / To, 'repeat')
    MATERIALS[name].update(texelMm=1000 / T, tileMetres=1.0)

# ---------------------------------------------------------------- foot plants: 1024 x 512 atlas
AW, AH = 1024, 512
patlas = np.zeros((AH, AW, 3), np.float32)
for i in range(3):
    patlas[(i // 2) * 256:(i // 2) * 256 + 256, (i % 2) * 512:(i % 2) * 512 + 512] = srgb2lin(read_png('leaf%d.png' % i) / 255.0)
patlas[256:512, 512:576] = srgb2lin(read_png('grass.png') / 255.0)
patlas[256:512, 576:640] = srgb2lin(np.array([120, 130, 70]) / 255.0)
patlas[256:512, 640:] = patlas[256:512, 512:576].mean((0, 1))
lum = patlas @ np.array([0.2126, 0.7152, 0.0722], np.float32)
gx = (np.roll(lum, -1, 1) - np.roll(lum, 1, 1)) * 0.5 * 0.0005 / (0.045 / 512) * 0.6
gy = (np.roll(lum, -1, 0) - np.roll(lum, 1, 0)) * 0.5 * 0.0005 / (0.03 / 256) * 0.6
pn = np.stack([-gx, -gy, np.ones_like(gx)], -1)
pn[256:512, 512:] = (0, 0, 1)
emit('plants', 'basecolor', patlas, 'sRGB atlas: leaf0-2, grass, stem (the paving layout)')
emit('plants', 'normal', pn, 'luminance bump, source strength 0.6 / 0.5 mm')
prough = np.full((AH, AW), 0.72, np.float32)
prough[256:512, 512:] = 0.5
orm_record('plants', np.ones_like(prough), prough, None, 'leaves 0.72, grass/stem 0.5 roughness', 1.0)

# ---------------------------------------------------------------- constant materials
# Iron: a periodic 0.1 m tile (geometry.mjs box-projects the UVs) of the source's object-space
# noise (Blender scale 60, detail 8) through its dark-iron-to-rust ramp (0.45 -> 0.75), with its
# 0.35-strength bump; roughness 0.62, metallic 0.55 through the factor (ORM.B = 1).
IRON_TILE_M, IRON_N = 0.1, 256
g = NS['Grid'](IRON_N, IRON_N, IRON_TILE_M / IRON_N, 60)
noise = np.clip(0.5 + 0.11 * g.fbm([(0.006, 1.0), (0.003, 0.5), (0.0015, 0.25), (0.0008, 0.125)]), 0, 1)
t = np.clip((noise - 0.45) / 0.3, 0, 1)[..., None]
iron_col = np.array([0.035, 0.032, 0.03], np.float32) * (1 - t) + np.array([0.16, 0.07, 0.03], np.float32) * t
px = IRON_TILE_M / IRON_N
Hn = noise * 0.0015  # bump relief: about a millimetre and a half of scale and pitting
Hw = np.pad(Hn, 1, mode='wrap')
gx = (Hw[1:-1, 2:] - Hw[1:-1, :-2]) / (2 * px)
gy = (Hw[2:, 1:-1] - Hw[:-2, 1:-1]) / (2 * px)
iron_n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
iron_n /= np.linalg.norm(iron_n, axis=-1, keepdims=True)
emit('kit-iron', 'basecolor', iron_col.astype(np.float32), 'sRGB; source noise ramp, 0.1 m repeat tile')
emit('kit-iron', 'normal', iron_n.astype(np.float32), 'OpenGL (+Y up); source noise bump, 0.1 m repeat tile')
orm_record('kit-iron', np.ones((IRON_N, IRON_N), np.float32), np.full((IRON_N, IRON_N), 0.62, np.float32), None,
           'R 1, G 0.62, B 1 (metallic 0.55 via the factor); 0.1 m repeat tile', 1000 * px, 'repeat', metallic=0.55)
MATERIALS['kit-iron'].update(metallicFactor=0.55, tileMetres=IRON_TILE_M,
                             meanTilt=float(np.degrees(np.arccos(iron_n[..., 2])).mean()))
# Glass: opaque, dark and smooth (the runtime has no transmission; the ambient gives the sheen),
# on a 0.2 m tile of slightly uneven glazing, box-projected like the iron.
GLASS_TILE_M = 0.2
gg = NS['Grid'](256, 256, GLASS_TILE_M / 256, 61)
wav = gg.fbm([(0.02, 1.0), (0.008, 0.4)]) * 0.0004  # about 0.4 mm of waviness: 1-2 degrees of tilt
Gw = np.pad(wav, 1, mode='wrap')
gpx = GLASS_TILE_M / 256
glass_n = np.stack([-(Gw[1:-1, 2:] - Gw[1:-1, :-2]) / (2 * gpx), -(Gw[2:, 1:-1] - Gw[:-2, 1:-1]) / (2 * gpx),
                    np.ones_like(wav)], -1)
glass_n /= np.linalg.norm(glass_n, axis=-1, keepdims=True)
emit('kit-glass', 'basecolor', np.tile(np.array([0.015, 0.018, 0.017], np.float32), (256, 256, 1)), 'constant, 0.2 m tile')
emit('kit-glass', 'normal', glass_n.astype(np.float32), 'uneven glazing, 0.2 m repeat tile')
orm_record('kit-glass', np.ones((256, 256), np.float32), np.full((256, 256), 0.06, np.float32), None,
           'R 1, G 0.06, B 0', 1000 * gpx, 'repeat')
MATERIALS['kit-glass'].update(metallicFactor=0.0, tileMetres=GLASS_TILE_M,
                              meanTiltDeg=float(np.degrees(np.arccos(glass_n[..., 2])).mean()))
CONST = {
    # The interior stands for an unlit room: the game's ambient reaches it, so it is near black.
    'interior': dict(color=(0.004, 0.004, 0.004), rough=1.0, metallic=0.0),
}
for name, c in CONST.items():
    emit(name, 'basecolor', np.tile(np.array(c['color'], np.float32), (4, 4, 1)), 'constant')
    emit(name, 'normal', np.tile(np.array([0, 0, 1], np.float32), (4, 4, 1)), 'flat')
    orm_record(name, np.ones((4, 4), np.float32), np.full((4, 4), c['rough'], np.float32), None,
               'constant; metallic %g via the factor' % c['metallic'], 0.0, metallic=c['metallic'])
    MATERIALS[name].update(metallicFactor=c['metallic'], constant=True)

# ---------------------------------------------------------------- shared detail tiles
DETAIL = {}
if A.detail_dir:
    dmeta = json.load(open(os.path.join(A.detail_dir, 'detail.json'), encoding='utf-8'))
    for spec in filter(None, A.detail.split(';')):
        cls, gains = spec.split(':')
        normal_gain, albedo_gain = (float(g) for g in gains.split(','))
        d = dmeta['classes'][cls]
        tw, th = d['size']
        raw = np.fromfile(os.path.join(A.detail_dir, cls + '-detail.rgba'), np.uint8).reshape(th, tw, 4)
        # detail.py writes rows top-down as the preview uploaded them; emit takes row 0 at v = 0.
        tile = raw[::-1, :, :3].astype(np.float32) / 255.0
        role = 'detail-' + cls
        emit(role, 'detail', tile, 'shared %s detail: RG normal offset, B albedo ratio (x%g); %g x %g m tile'
             % (cls, dmeta['albedoRange'], d['tileMetres'][0], d['tileMetres'][1]),
             tileMetres=d['tileMetres'], cutoffMillimetres=d['cutoffMillimetres'])
        DETAIL[cls] = dict(role=role + '-detail', tileMetres=d['tileMetres'], normalGain=normal_gain,
                           albedoGain=albedo_gain)
    for name, m in MATERIALS.items():
        cls = 'plaster' if name.startswith('plaster-') else {'kit-oak': 'oak', 'kit-stone': 'stone'}.get(name)
        if cls not in DETAIL:
            continue
        normal = next(r for r in records if r['role'] == name + '-normal')['levels'][0]
        mm = m.get('normalTexelMm', m['texelMm'])
        extent = (normal['width'] * mm / 1000, normal['height'] * mm / 1000)
        t = DETAIL[cls]
        m['detail'] = dict(texture=t['role'], uvScale=[extent[0] / t['tileMetres'][0], extent[1] / t['tileMetres'][1]],
                           normalGain=t['normalGain'], albedoGain=t['albedoGain'])

json.dump(dict(stage='maps', blender=bpy.app.version_string, source=SOURCE,
               factors=dict(oak=A.oak_factor, stone=A.stone_factor, plaster=A.plaster_factor,
                            plasterNormal=A.plaster_normal_factor, plasterOrm=A.plaster_orm_factor,
                            stoneOrm=A.stone_orm_factor, orm=A.orm_factor,
                            **({'oakNormal': A.oak_normal_factor} if A.oak_normal_factor else {}),
                            **({'oakOrm': A.oak_orm_factor} if A.oak_orm_factor else {})),
               tileSize=A.tile_size,
               **({'detail': dict(source=os.path.abspath(A.detail_dir), classes=A.detail)} if A.detail_dir else {}),
               ambientOcclusion=dict(radiusMm=A.ao_radius_mm, directions=A.ao_directions, steps=A.ao_steps,
                                     plasterRadiusMm=PLASTER_AO_MM, plasterFalloff=bool(A.plaster_ao_falloff)),
               ranges={k: list(v) for k, v in RANGES.items()},
               plantAtlas=dict(width=AW, height=AH, regions=dict(leaf0=[0, 0, 512, 256], leaf1=[512, 0, 512, 256],
                                                                 leaf2=[0, 256, 512, 256], grass=[512, 256, 64, 256],
                                                                 stem=[576, 256, 64, 256]), gutter=2),
               materials=MATERIALS, maps=records,
               inputs=dict(extract=sha(os.path.join(EXT, 'extract.json')))),
          open(os.path.join(OUT, 'maps.json'), 'w', encoding='utf-8'), indent=1)
print('MAPS_DONE', OUT, len(records), flush=True)
