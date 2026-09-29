# K2 roof delivery, stage 3: runtime maps and mip chains in the K1 delivery's maps.json format.
# blender -b --factory-startup --python-exit-code 1 --python maps.py -- --extract <dir> --out <dir>
#     [--tile-factor 4] [--oak-factor 4] [--oak-orm-factor 2] [--plaster-factor 4]
#     [--plaster-normal-factor 2] [--plaster-orm-factor 4]
#
# Factors divide the source densities (tiles and oak 0.75 mm, gable plaster 1 mm). Materials:
#   roof-tile      the shared 28-variant atlas. Base colour is pre-tint (each tile's tint rides in its
#                  UVs, engine pbr-tint); ORM R is the tiles' sky occlusion in the assembled roof,
#                  averaged per variant slot over its visible instances (extract.py's per-vertex AO,
#                  rasterized through each face's UVs); no height (B 0). Repeat addressing.
#   roof-oak       the roof's own member atlas, processed as K1's oak: full normal (low-pass height
#                  slopes plus the detail normal), island AO, the fibre layer's mean darkening.
#                  Islands are the UV rectangles of the extract's connected oak triangles.
#   plaster-gable  K1's plaster processing without the facade margin: occluding height of the
#                  gable's own timber, 150 mm AO without falloff.
#   roof-mortar    the source's object-space procedural bedding, as a 0.5 m repeat tile (box-mapped
#                  by the geometry stage); roof-deck a constant.
import argparse
import hashlib
import json
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '../../../common')))
from delivery_maps import (Emitter, full_normal, height_ao, pool, push_pull, read_png, srgb2lin,  # noqa: E402
                           to_blocks)
from fields import Grid  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--extract', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--tile-factor', type=int, default=4)
ap.add_argument('--tile-orm-factor', type=int, default=1)
ap.add_argument('--oak-factor', type=int, default=4)
ap.add_argument('--oak-orm-factor', type=int, default=2)
ap.add_argument('--plaster-factor', type=int, default=4)
ap.add_argument('--plaster-normal-factor', type=int, default=2)
ap.add_argument('--plaster-orm-factor', type=int, default=4)
ap.add_argument('--ao-radius-mm', type=float, default=40.0)
ap.add_argument('--plaster-ao-radius-mm', type=float, default=150.0)
ap.add_argument('--ao-directions', type=int, default=16)
ap.add_argument('--ao-steps', type=int, default=16)
# Shared tiling detail, as the walls' maps stage: detail.py's output and 'plaster:1,1'.
ap.add_argument('--detail-dir', default=None)
ap.add_argument('--detail', default='')
ap.add_argument('--source', default='candidate8', help='the accepted K2 source candidate (proof-2026-09-27)')
A = ap.parse_args(argv)
SOURCE = A.source
SRC = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-27', SOURCE))
EXT = os.path.abspath(A.extract)
OUT = os.path.abspath(A.out)
if os.path.isdir(OUT) and os.listdir(OUT):
    sys.exit('refusing to overwrite existing output %s' % OUT)
E = Emitter(OUT)
PX = {'tile': 0.00075, 'oak': 0.00075, 'plaster': 0.001}


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 24), b''):
            h.update(block)
    return h.hexdigest()


receipt = json.load(open(os.path.join(SRC, 'receipt.json'), encoding='utf-8'))
src_sha = {e['path']: e['sha256'] for e in receipt['files']}
assert sha(os.path.join(SRC, 'source.blend')) == src_sha['source.blend']
extract = json.load(open(os.path.join(EXT, 'extract.json'), encoding='utf-8'))
assert extract['source'] == SOURCE


def png(name):
    return read_png(os.path.join(SRC, 'maps', name), src_sha['maps/' + name])


def npy(obj, name):
    return np.load(os.path.join(EXT, obj, name + '.npy'))


# Displacement ranges, from the source's modifiers (the builders name their textures 'mk-<prefix>').
bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, 'source.blend'))
RANGES = {}
for ob in bpy.data.objects:
    for md in ob.modifiers:
        if md.type == 'DISPLACE' and md.texture and md.texture.name.startswith('mk-'):
            lo = -md.mid_level * md.strength
            r = (lo, lo + md.strength)
            key = md.texture.name[3:]
            assert key not in RANGES or np.allclose(RANGES[key], r), key
            RANGES[key] = r
print('ranges', RANGES, flush=True)


def height_m(name, rng):
    return (rng[0] + png(name).astype(np.float32) / 65535.0 * (rng[1] - rng[0])).astype(np.float32)


def rasterize(shape, uv, T, values, weight=None):
    """Mean of per-vertex `values` over each texel centre inside the UV triangles (row 0 = v 0)."""
    h, w = shape
    acc = np.zeros(shape, np.float64)
    cnt = np.zeros(shape, np.float64)
    px = uv * np.array([w, h])
    for t in T:
        p = px[t]
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
        if x1 <= x0 or y1 <= y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
        if abs(d) < 1e-12:
            continue
        l0 = ((p[1, 1] - p[2, 1]) * (X - p[2, 0]) + (p[2, 0] - p[1, 0]) * (Y - p[2, 1])) / d
        l1 = ((p[2, 1] - p[0, 1]) * (X - p[2, 0]) + (p[0, 0] - p[2, 0]) * (Y - p[2, 1])) / d
        l2 = 1 - l0 - l1
        inside = (l0 >= -1e-3) & (l1 >= -1e-3) & (l2 >= -1e-3)
        if not inside.any():
            continue
        v = l0 * values[t[0]] + l1 * values[t[1]] + l2 * values[t[2]]
        acc[y0:y1, x0:x1][inside] += v[inside]
        cnt[y0:y1, x0:x1][inside] += 1
    return acc, cnt


# ---------------------------------------------------------------- roof tiles: the shared variant atlas
f = A.tile_factor
alb8 = png('tile-albedo.png')
known = alb8.any(-1)                     # every face texel has colour; unpacked texels are black
alb = srgb2lin(alb8 / 255.0)
del alb8
N = png('tile-normal.png').astype(np.float32) / 127.5 - 1.0
rgh = png('tile-roughness.png').astype(np.float32) / 255.0
AH, AW = known.shape
albf, kf = pool(alb, f, known)
Nf, _ = pool(N, f, known)
Nf /= np.maximum(np.linalg.norm(Nf, axis=-1, keepdims=True), 1e-6)
rf, _ = pool(rgh, f * A.tile_orm_factor, known)
del alb, N, rgh
albf, Nf = push_pull(albf, kf), push_pull(Nf, kf)
E.emit('roof-tile', 'basecolor', albf, 'sRGB albedo before the per-tile tint, %g mm texels' % (PX['tile'] * f * 1000))
E.emit('roof-tile', 'normal', Nf, 'OpenGL (+Y up) tangent space, %g mm texels' % (PX['tile'] * f * 1000))
fo = f * A.tile_orm_factor
oshape = (AH // fo, AW // fo)
acc = np.zeros(oshape)
cnt = np.zeros(oshape)
instances = 0
for rec in extract['objects']:
    if not rec.get('tinted'):
        continue
    UV, T, M, AO, VIS = (npy(rec['object'], k) for k in ('UV', 'T', 'M', 'AO', 'VIS'))
    face = (M == rec['materials'].index('roof-tile')) & (VIS > 0)
    a, c = rasterize(oshape, UV.astype(np.float64), T[face].astype(np.int64), AO.astype(np.float64))
    acc += a
    cnt += c
    instances += int(face.sum())
ao_known = cnt > 0
ao = np.where(ao_known, acc / np.maximum(cnt, 1), 0).astype(np.float32)
ao = np.clip(push_pull(ao, ao_known), 0, 1)
face_known = pool(known.astype(np.float32), fo)[0] > 0 if fo > 1 else known
rf = push_pull(rf, face_known)
E.orm('roof-tile', ao, rf, None, 'R sky occlusion in the assembled roof (per-slot mean over %d visible face '
      'triangles), G roughness, B 0; %g mm texels' % (instances, PX['tile'] * fo * 1000), PX['tile'] * fo * 1000,
      address='repeat')
E.materials['roof-tile'].update(texelMm=PX['tile'] * f * 1000, atlas=[AW // f, AH // f],
                                sourceSpecularLevel=0.25, aoCoverage=float(ao_known[face_known].mean()))
del albf, Nf, rf, ao, acc, cnt

# ---------------------------------------------------------------- roof oak: K1's oak processing
f = A.oak_factor
px = PX['oak']
H = height_m('oak-height.png', RANGES['oak'])
rgh = png('oak-roughness.png').astype(np.float32) / 255.0
occ = rgh > 0
AH, AW = occ.shape
# Islands: each connected set of oak triangles is one rectangle of the atlas.
ids = np.full((AH, AW), -1, np.int32)
nisl = 0
for rec in extract['objects']:
    if 'roof-oak' not in rec['materials']:
        continue
    UV, T = npy(rec['object'], 'UV'), npy(rec['object'], 'T').astype(np.int64)
    lab = np.arange(len(UV))
    while True:
        m = lab[T].min(1)
        new = lab.copy()
        for k in range(3):
            np.minimum.at(new, T[:, k], m)
        new = new[new]
        new = new[new]
        if (new == lab).all():
            break
        lab = new
    for root in np.unique(lab):
        uv = UV[lab == root]
        x0, y0 = np.floor(uv.min(0) * [AW, AH]).astype(int)
        x1, y1 = np.ceil(uv.max(0) * [AW, AH]).astype(int)
        ids[max(y0, 0):min(y1, AH), max(x0, 0):min(x1, AW)] = nisl
        nisl += 1
# Islands own their edge-replicated pads too: grow each id over the occupied texels next to it.
for _ in range(8):
    grow = ids.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(ids, (dy, dx), (0, 1))
        take = (grow < 0) & occ & (sh >= 0)
        grow[take] = sh[take]
    ids = grow
print('oak islands', nisl, 'occupied texels without an island %.4f%%' % (100 * ((ids < 0) & occ).mean()), flush=True)
nd = png('oak-normal.png')
N = full_normal(H, nd, px, px)
del nd
alb = srgb2lin(png('oak-albedo.png') / 255.0)
detail = png('oak-detail-albedo.png').astype(np.float32) / 255.0
fibre = float(0.82 + 0.33 * detail.mean())
mask = png('oak-detailmask.png') > 127
alb[mask] *= fibre
del mask
albf, kf = pool(alb, f, occ)
del alb
Nf, _ = pool(N, f, occ)
del N
Nf /= np.maximum(np.linalg.norm(Nf, axis=-1, keepdims=True), 1e-6)
albf, Nf = push_pull(albf, kf), push_pull(Nf, kf)
E.emit('roof-oak', 'basecolor', albf, 'sRGB albedo, %g mm texels, islands push-pull filled' % (px * f * 1000))
E.emit('roof-oak', 'normal', Nf, 'OpenGL (+Y up) tangent space; low-pass slopes + detail; renormalized mips')
del albf, Nf
fo = f * A.oak_orm_factor
Ho, knowno = pool(H, fo, occ)
ro, _ = pool(rgh, fo, occ)
c = fo // 2
ido = ids[c::fo, c::fo]
Ho, ro = push_pull(Ho, knowno), push_pull(ro, knowno)
occlusion = height_ao(Ho, ido, px * fo, px * fo, A.ao_radius_mm / 1000, A.ao_directions, A.ao_steps)
occlusion = np.where(knowno, occlusion, 1.0).astype(np.float32)
E.orm('roof-oak', occlusion, ro, Ho, 'R island AO (%g mm), G roughness, B height; %g mm texels'
      % (A.ao_radius_mm, px * fo * 1000), px * fo * 1000)
E.materials['roof-oak'].update(texelMm=px * f * 1000, atlas=[AW // f, AH // f], islands=nisl,
                               fibreAlbedoFactor=fibre, sourceSpecularLevel=[0.055, 0.22])
del H, rgh, occ, ids, Ho, ro, occlusion

# ---------------------------------------------------------------- gable plaster (K1's plaster processing)
x0, x1, z0, z1 = 0.0, 6.25, None, None
H = height_m('plaster-gable-height.png', RANGES['plaster-gable'])
rows, cols = H.shape
gp = next(r for r in extract['objects'] if r['object'] == 'gable-plaster')
Bp = npy('gable-plaster', 'B')
UVp = npy('gable-plaster', 'UV')
assert np.abs(Bp[:, 1]).max() < 1e-4, 'the gable plaster lies in its piece frame y = 0'
# The plaster's UVs map its rectangle affinely: recover it from the base vertices.
fit = np.linalg.lstsq(np.c_[UVp, np.ones(len(UVp))], Bp[:, [0, 2]], rcond=None)[0]
x0, z0 = fit[2]
x1, z1 = fit[0][0] + x0, fit[1][1] + z0
assert abs(fit[0][1]) < 1e-6 and abs(fit[1][0]) < 1e-6, fit
pu, pv = (x1 - x0) / cols, (z1 - z0) / rows
print('gable plaster rect', x0, x1, z0, z1, 'texels mm', pu * 1000, pv * 1000, flush=True)
N = full_normal(H, png('plaster-gable-normal.png'), pu, pv)
alb = srgb2lin(png('plaster-gable-albedo.png') / 255.0)
rgh = png('plaster-gable-roughness.png').astype(np.float32) / 255.0
# Pad to whole 4 x 4 pooling blocks (2 mm at the far edges: under a texel at 4 mm).
q = 4 * max(A.plaster_factor, A.plaster_orm_factor, A.plaster_normal_factor)
pad = ((0, -rows % q), (0, -cols % q))
H, rgh = np.pad(H, pad, mode='edge'), np.pad(rgh, pad, mode='edge')
N, alb = np.pad(N, pad + ((0, 0),), mode='edge'), np.pad(alb, pad + ((0, 0),), mode='edge')
# Occluding height of the gable's own timber in front of the plaster (-y), as K1's occluder().
timber = np.full(H.shape, -1.0, np.float32)
P, T = npy('roof-gable-oak', 'P'), npy('roof-gable-oak', 'T').astype(np.int64)
tri = P[T]
tri = tri[(-tri[..., 1]).max(1) > 0]
e = np.maximum(np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1), np.linalg.norm(tri[:, 2] - tri[:, 0], axis=1))
sub = np.clip(np.ceil(e / (0.5 * pu)).astype(int), 1, 64)
for n in sorted(set(sub)):
    sel = tri[sub == n]
    a, b = np.meshgrid(np.arange(n + 1), np.arange(n + 1))
    keep = a + b <= n
    wa, wb = (a[keep] / n).astype(np.float32), (b[keep] / n).astype(np.float32)
    pts = (sel[:, None, 0] * (1 - wa - wb)[None, :, None] + sel[:, None, 1] * wa[None, :, None]
           + sel[:, None, 2] * wb[None, :, None]).reshape(-1, 3)
    row = np.floor((pts[:, 2] - z0) / pv).astype(int)
    col = np.floor((pts[:, 0] - x0) / pu).astype(int)
    ok = (col >= 0) & (col < H.shape[1]) & (row >= 0) & (row < H.shape[0])
    np.maximum.at(timber, (row[ok], col[ok]), -pts[ok, 1])
for _ in range(3):
    tp = np.pad(timber, 1, mode='edge')
    timber = np.maximum.reduce([timber, tp[:-2, 1:-1], tp[2:, 1:-1], tp[1:-1, :-2], tp[1:-1, 2:]])
for _ in range(4):
    tp = np.pad(timber, 1, mode='edge')
    timber = np.minimum.reduce([timber, tp[:-2, 1:-1], tp[2:, 1:-1], tp[1:-1, :-2], tp[1:-1, 2:]])
Hs = np.fft.irfft2(np.fft.rfft2(H) * np.exp(-2 * math.pi ** 2 * (0.003 ** 2) * (
    (np.fft.fftfreq(H.shape[0], d=pv) ** 2)[:, None] + (np.fft.rfftfreq(H.shape[1], d=pu) ** 2)[None, :])),
    s=H.shape).astype(np.float32)
Hocc = np.maximum(Hs, timber)
f = A.plaster_factor
albf, _ = pool(alb, f)
Nf, _ = pool(N, A.plaster_normal_factor)
Nf /= np.linalg.norm(Nf, axis=-1, keepdims=True)
E.emit('plaster-gable', 'basecolor', to_blocks(albf), 'sRGB albedo, %g mm texels' % (pu * f * 1000))
E.emit('plaster-gable', 'normal', to_blocks(Nf), 'OpenGL (+Y up); low-pass slopes + detail; %g mm texels'
       % (pu * A.plaster_normal_factor * 1000))
fo = A.plaster_orm_factor
Ho, _ = pool(Hocc, fo)
ro, _ = pool(rgh, fo)
occlusion = height_ao(Ho, None, pu * fo, pv * fo, A.plaster_ao_radius_mm / 1000, A.ao_directions, A.ao_steps,
                      falloff=False)
E.orm('plaster-gable', to_blocks(occlusion), to_blocks(ro), to_blocks(Ho),
      'R AO (%g mm, no falloff) of plaster + proud timber, G roughness, B plaster + timber height; %g mm texels'
      % (A.plaster_ao_radius_mm, pu * fo * 1000), pu * fo * 1000)
E.materials['plaster-gable'].update(texelMm=pu * f * 1000, normalTexelMm=pu * A.plaster_normal_factor * 1000,
                                    rect=[x0, x1, z0, z1], paddedTexels=[int(pad[1][1]), int(pad[0][1])],
                                    timberCoverage=float((timber > H).mean()))
del H, N, alb, rgh, timber, Hocc, Hs, albf, Nf, Ho, ro, occlusion

# ---------------------------------------------------------------- roof mortar and deck
# The source's mortar: Blender noise (scale 40, detail 10) through a ramp from (92, 86, 76) at 0.3
# to (150, 142, 124) at 0.75, roughness 0.97, and a fine bump. Periodic fBm of the same scales
# stands in for Blender's noise (an approximation, disclosed): a 0.5 m tile at 2 mm.
MT, MTM = 256, 0.5
g = Grid(MT, MT, MTM / MT, 71)
n = g.fbm([(0.05, 1.0), (0.02, 0.5), (0.008, 0.25), (0.003, 0.12)])
n = (n - n.mean()) / (n.std() + 1e-9) * 0.13 + 0.5
t = np.clip((n - 0.3) / 0.45, 0, 1)[..., None]
col = srgb2lin(np.array([92, 86, 76]) / 255.0) * (1 - t) + srgb2lin(np.array([150, 142, 124]) / 255.0) * t
fine = g.fbm([(0.002, 1.0), (0.001, 0.5)]) * 0.0003
Fw = np.pad(fine, 1, mode='wrap')
mpx = MTM / MT
Nm = np.stack([-(Fw[1:-1, 2:] - Fw[1:-1, :-2]) / (2 * mpx), -(Fw[2:, 1:-1] - Fw[:-2, 1:-1]) / (2 * mpx),
               np.ones_like(fine)], -1)
Nm /= np.linalg.norm(Nm, axis=-1, keepdims=True)
E.emit('roof-mortar', 'basecolor', col.astype(np.float32), 'procedural bedding, %g m repeat tile' % MTM)
E.emit('roof-mortar', 'normal', Nm.astype(np.float32), 'fine grit, %g m repeat tile' % MTM)
E.orm('roof-mortar', np.ones((MT // 2, MT // 2), np.float32), np.full((MT // 2, MT // 2), 0.97, np.float32), None,
      'R 1, G 0.97, B 0', 1000 * MTM / (MT // 2), 'repeat')
E.materials['roof-mortar'].update(texelMm=1000 * mpx, tileMetres=MTM)
E.emit('roof-deck', 'basecolor', np.tile(srgb2lin(np.array([58, 44, 34]) / 255.0), (4, 4, 1)).astype(np.float32), 'constant')
E.emit('roof-deck', 'normal', np.tile(np.array([0, 0, 1], np.float32), (4, 4, 1)), 'flat')
E.orm('roof-deck', np.ones((4, 4), np.float32), np.full((4, 4), 0.95, np.float32), None, 'constant', 0.0)
E.materials['roof-deck'].update(constant=True)

# ---------------------------------------------------------------- shared detail tiles
if A.detail_dir:
    dmeta = json.load(open(os.path.join(A.detail_dir, 'detail.json'), encoding='utf-8'))
    detail = {}
    for spec in filter(None, A.detail.split(';')):
        cls, gains = spec.split(':')
        normal_gain, albedo_gain = (float(g) for g in gains.split(','))
        d = dmeta['classes'][cls]
        tw, th = d['size']
        raw = np.fromfile(os.path.join(A.detail_dir, cls + '-detail.rgba'), np.uint8).reshape(th, tw, 4)
        E.emit('detail-' + cls, 'detail', raw[::-1, :, :3].astype(np.float32) / 255.0,
               'shared %s detail: RG normal offset, B albedo ratio (x%g); %g x %g m tile'
               % (cls, dmeta['albedoRange'], d['tileMetres'][0], d['tileMetres'][1]),
               tileMetres=d['tileMetres'], cutoffMillimetres=d['cutoffMillimetres'])
        detail[cls] = dict(role='detail-%s-detail' % cls, tileMetres=d['tileMetres'], normalGain=normal_gain,
                           albedoGain=albedo_gain)
    for name, m in E.materials.items():
        cls = 'plaster' if name.startswith('plaster-') else {'roof-oak': 'oak'}.get(name)
        if cls not in detail:
            continue
        normal = next(r for r in E.records if r['role'] == name + '-normal')['levels'][0]
        mm = m.get('normalTexelMm', m['texelMm'])
        t = detail[cls]
        m['detail'] = dict(texture=t['role'], uvScale=[normal['width'] * mm / 1000 / t['tileMetres'][0],
                                                       normal['height'] * mm / 1000 / t['tileMetres'][1]],
                           normalGain=t['normalGain'], albedoGain=t['albedoGain'])

json.dump(dict(stage='maps', blender=bpy.app.version_string, source=SOURCE,
               factors=dict(tile=A.tile_factor, tileOrm=A.tile_orm_factor, oak=A.oak_factor, oakOrm=A.oak_orm_factor,
                            plaster=A.plaster_factor, plasterNormal=A.plaster_normal_factor,
                            plasterOrm=A.plaster_orm_factor),
               ambientOcclusion=dict(radiusMm=A.ao_radius_mm, directions=A.ao_directions, steps=A.ao_steps,
                                     plasterRadiusMm=A.plaster_ao_radius_mm, plasterFalloff=False),
               ranges={k: list(v) for k, v in RANGES.items()},
               **({'detail': dict(source=os.path.abspath(A.detail_dir), classes=A.detail)} if A.detail_dir else {}),
               materials=E.materials, maps=E.records,
               inputs=dict(extract=sha(os.path.join(EXT, 'extract.json')))),
          open(os.path.join(OUT, 'maps.json'), 'w', encoding='utf-8'), indent=1)
print('MAPS_DONE', OUT, len(E.records), flush=True)
