# Photoreal paving delivery, stage 2: runtime maps, mip chains and stage-3 geometry inputs.
# blender -b --factory-startup --python-exit-code 1 --python maps.py -- --extract <dir> --out <dir>
# [--pebble-geometry-mm 9]
#
# Ground maps (4 m periodic tile, 4096^2 = 1024 texels/m; ORM at 2048^2):
#   base colour = approved albedo with the source pebbles drawn in from the top-down render
#   normal      = full-height normal (16-bit low-pass slopes + approved detail normal) with
#                 pebble normals; runtime vertex normals are flat, so this map carries all
#                 shading and every LOD shades identically
#   ORM         = R ambient occlusion (--ao-radius-mm, default 40; 0 gives candidates 1-8's 1), G
#                 roughness with pebbles at the source's 0.72, B 0 metallic. The engine applies
#                 R to its sky/ground ambient only (engine package 5).
# Plant atlas (1024 x 512): leaf0-2, grass and stem swatch, with a luminance bump normal.
# Every mip is a 2x2 box of the level above (linear light for colour), so mips stay periodic.
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
ap.add_argument('--pebble-geometry-mm', type=float, default=9.0)
ap.add_argument('--ao-radius-mm', type=float, default=40.0)  # 0 reproduces candidates 1-8
ap.add_argument('--ao-directions', type=int, default=16)
ap.add_argument('--ao-steps', type=int, default=16)
A = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-22/photoreal/candidate1'))
EXT = os.path.abspath(A.extract)
OUT = os.path.abspath(A.out)
if os.path.isdir(OUT) and os.listdir(OUT):
    sys.exit('refusing to overwrite existing output %s' % OUT)
os.makedirs(os.path.join(OUT, 'mips'), exist_ok=True)
TILE, N = 4.0, 4096
PX = TILE / N


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


ext = json.load(open(os.path.join(EXT, 'extract.json'), encoding='utf-8'))
for entry in ext['files']:
    if sha(os.path.join(EXT, entry['path'])) != entry['sha256']:
        sys.exit('stage-1 identity mismatch: %s' % entry['path'])
receipt = json.load(open(os.path.join(SRC, 'receipt.json'), encoding='utf-8'))
src_sha = {e['path']: e['sha256'] for e in receipt['files']}


def read_png(name):
    """Exact decoder for the builder's PNGs (filter 0, no interlace). Row 0 is y = 0."""
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
    arr = px.reshape(h, w * ch, 2).astype(np.uint16) if bpc == 2 else px
    if bpc == 2:
        arr = (arr[..., 0] << 8) | arr[..., 1]
    arr = arr.reshape(h, w, ch) if ch > 1 else arr.reshape(h, w)
    return arr[::-1]


def read_exr(name):
    img = bpy.data.images.load(os.path.join(EXT, name), check_existing=False)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    buf = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)  # Blender rows are bottom-up: row 0 is y = 0


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


# ---------------------------------------------------------------- ground inputs
receipt_h = receipt['heightRangeMetres']
Hq = read_png('height.png').astype(np.float64)
H = (receipt_h[0] + Hq / 65535.0 * (receipt_h[1] - receipt_h[0])).astype(np.float32)
alb = srgb2lin(read_png('albedo.png') / 255.0)
rough = read_png('roughness.png').astype(np.float32) / 255.0
nd = read_png('normal.png').astype(np.float32) / 255.0 * 2 - 1
# Detail normal was (-dDx, -dDy, 1) normalized: recover the detail slopes exactly up to 8 bits.
sdx = -nd[..., 0] / np.maximum(nd[..., 2], 0.05)
sdy = -nd[..., 1] / np.maximum(nd[..., 2], 0.05)
dHx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) / (2 * PX)
dHy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) / (2 * PX)
sx, sy = dHx + sdx, dHy + sdy
ng = np.stack([-sx, -sy, np.ones_like(sx)], -1)
ng /= np.linalg.norm(ng, axis=-1, keepdims=True)
del nd, sdx, sdy, dHx, dHy, sx, sy

# ---------------------------------------------------------------- pebbles drawn into the maps
pa = read_exr('pebble-albedo.exr')
pn = read_exr('pebble-normal.exr')
ph = read_exr('pebble-height.exr')
cover = np.clip(pa[..., 3], 0, 1)
ztop = ph[..., 0] - 1.0
hit = ph[..., 3] > 0.5
# Composite only where the pebble top is above the ground (none under stone shoulders).
above = hit & (ztop > H - 0.0003)
vis = above.copy()
for axis in (0, 1):  # one-texel dilation covers the antialiased rim samples
    vis |= np.roll(above, 1, axis) | np.roll(above, -1, axis)
a = (cover * vis).astype(np.float32)
prgb = pa[..., :3] * vis[..., None]  # Cycles film output is premultiplied by coverage
alb_c = alb * (1 - a[..., None]) + prgb
pnrm = pn[..., :3] / np.maximum(pn[..., 3:4], 1e-4) * 2 - 1
pnrm /= np.maximum(np.linalg.norm(pnrm, axis=-1, keepdims=True), 1e-6)
nrm_c = ng * (1 - a[..., None]) + pnrm * a[..., None]
nrm_c /= np.linalg.norm(nrm_c, axis=-1, keepdims=True)
rough_c = rough * (1 - a) + 0.72 * a
pebble_fraction = float(a.mean())
# The occluding surface: the ground, with every drawn-in pebble's top where it stands above it.
H_ao = np.where(above, np.maximum(H, ztop), H).astype(np.float32)
del pa, pn, ph, pnrm, ng

# ---------------------------------------------------------------- mips and outputs
records = []


def box(x):
    return 0.25 * (x[0::2, 0::2] + x[1::2, 0::2] + x[0::2, 1::2] + x[1::2, 1::2])


def emit(role, levels_rgba, note):
    files = []
    for lv, rgba in enumerate(levels_rgba):
        path = os.path.join(OUT, 'mips', '%s-%02d.rgba' % (role, lv))
        # KTX2 and glTF rows are top-down: flip our y-up rows on the way out.
        data = np.ascontiguousarray(rgba[::-1]).tobytes()
        with open(path, 'wb') as f:
            f.write(data)
        files.append(dict(file='mips/' + os.path.basename(path), width=rgba.shape[1], height=rgba.shape[0],
                          sha256=hashlib.sha256(data).hexdigest()))
    write_png(os.path.join(OUT, role + '.png'), levels_rgba[0][..., :3] if role != 'plant-basecolor' else levels_rgba[0][..., :3])
    records.append(dict(role=role, note=note, levels=files))


def chain(level0, encode, reduce):
    lv = [level0]
    while lv[-1].shape[0] > 1 or lv[-1].shape[1] > 1:
        lv.append(reduce(lv[-1]))
    return [encode(x) for x in lv]


def enc_color(x):
    return np.concatenate([np.round(lin2srgb(x) * 255), np.full(x.shape[:2] + (1,), 255)], -1).astype(np.uint8)


def enc_normal(x):
    n = x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-6)
    return np.concatenate([np.round((n * 0.5 + 0.5) * 255), np.full(x.shape[:2] + (1,), 255)], -1).astype(np.uint8)


def enc_orm(x):
    rgb = np.round(np.clip(x, 0, 1) * 255)
    return np.concatenate([rgb, np.full(x.shape[:2] + (1,), 255)], -1).astype(np.uint8)


def box_any(x):
    if x.shape[0] == 1:
        return 0.5 * (x[:, 0::2] + x[:, 1::2])
    if x.shape[1] == 1:
        return 0.5 * (x[0::2] + x[1::2])
    return box(x)


emit('ground-basecolor', chain(alb_c, enc_color, box_any), 'sRGB; approved albedo with source pebbles drawn in')
del alb_c, alb
emit('ground-normal', chain(nrm_c, enc_normal, box_any), 'OpenGL (+Y up) tangent space; full height slopes; renormalized mips')
del nrm_c


def height_ao(height, spacing, radius, directions, steps):
    """Horizon-based ambient occlusion of a periodic height field (rolls wrap the tile).
    Per direction, the highest horizon within the radius blocks sin^2(elevation) of the
    cosine-weighted sky, faded smoothly to zero at the radius; AO is 1 minus the mean."""
    blocked = np.zeros_like(height)
    for k in range(directions):
        angle = 2 * math.pi * (k + 0.5) / directions
        horizon = np.zeros_like(height)
        seen = set()
        for s in range(1, steps + 1):
            reach = radius * (s / steps) ** 1.5  # denser samples near the texel
            dx = int(round(math.cos(angle) * reach / spacing))
            dy = int(round(math.sin(angle) * reach / spacing))
            if (dx, dy) == (0, 0) or (dx, dy) in seen:
                continue
            seen.add((dx, dy))
            distance = math.hypot(dx, dy) * spacing
            rise = np.maximum(np.roll(height, (-dy, -dx), (0, 1)) - height, 0)
            sine2 = rise * rise / (rise * rise + distance * distance)
            horizon = np.maximum(horizon, sine2 * (1 - (distance / radius) ** 2))
        blocked += horizon
    return (1 - blocked / directions).astype(np.float32)


orm_rough = box(rough_c)
if A.ao_radius_mm > 0:
    # At the ORM's 2048^2 (2 mm texels), from the box-filtered occluding surface.
    occlusion = height_ao(box(H_ao), 2 * PX, A.ao_radius_mm / 1000, A.ao_directions, A.ao_steps)
    ao_note = 'R height-field AO (%g mm radius, %d directions)' % (A.ao_radius_mm, A.ao_directions)
else:
    occlusion = np.ones_like(orm_rough)
    ao_note = 'R occlusion 1'
ao_stats = dict(mean=float(occlusion.mean()), p01=float(np.percentile(occlusion, 1)),
                p10=float(np.percentile(occlusion, 10)), minimum=float(occlusion.min()))
orm0 = np.stack([occlusion, orm_rough, np.zeros_like(orm_rough)], -1)
emit('ground-orm', chain(orm0, enc_orm, box_any), ao_note + ', G roughness, B metallic 0; 2048^2 (512 texels/m)')
del orm0, H_ao

# ---------------------------------------------------------------- plant atlas (1024 x 512)
AW, AH, GUTTER = 1024, 512, 2
atlas = np.zeros((AH, AW, 3), np.float32)
regions = {}


def place(name, img_lin, x0, y0):
    h, w = img_lin.shape[:2]
    atlas[y0:y0 + h, x0:x0 + w] = img_lin
    regions[name] = (x0, y0, w, h)


for i in range(3):
    place('Leaf%d' % i, srgb2lin(read_png('leaf%d.png' % i) / 255.0), (i % 2) * 512, (i // 2) * 256)
place('Grass', srgb2lin(read_png('grass.png') / 255.0), 512, 256)
atlas[256:512, 576:640] = srgb2lin(np.array([120, 130, 70]) / 255.0)
regions['Stem'] = (576, 256, 64, 256)
atlas[256:512, 640:] = atlas[256:512, 512:576].mean((0, 1))  # unused: neutral green, no mip bleed surprises
lum = atlas @ np.array([0.2126, 0.7152, 0.0722], np.float32)
# Source: Bump(height = colour, strength 0.6, distance 0.5 mm). Leaves span ~45 x 30 mm on 512 x 256.
gx = (np.roll(lum, -1, 1) - np.roll(lum, 1, 1)) * 0.5 * 0.0005 / (0.045 / 512) * 0.6
gy = (np.roll(lum, -1, 0) - np.roll(lum, 1, 0)) * 0.5 * 0.0005 / (0.03 / 256) * 0.6
pn = np.stack([-gx, -gy, np.ones_like(gx)], -1)
pn[256:512, 512:] = (0, 0, 1)
emit('plant-basecolor', chain(atlas, enc_color, box_any), 'sRGB atlas: Leaf0-2, Grass, Stem')
emit('plant-normal', chain(pn, enc_normal, box_any), 'luminance bump, source strength 0.6 / 0.5 mm')
prough = np.full((AH, AW), 0.72, np.float32)
prough[256:512, 512:] = 0.5
porm = np.stack([np.ones_like(prough), prough, np.zeros_like(prough)], -1)
emit('plant-orm', chain(porm, enc_orm, box_any), 'leaves 0.72, grass/stem 0.5 roughness')
emit('pebble-normal', chain(np.tile(np.array([0, 0, 1], np.float32), (4, 4, 1)), enc_normal, box_any),
     'flat: pebble geometry shades with its own vertex normals')
emit('pebble-orm', chain(np.tile(np.array([1, 0.72, 0], np.float32), (4, 4, 1)), enc_orm, box_any),
     'source grit roughness 0.72')

# ---------------------------------------------------------------- stage-3 geometry inputs
pl = np.load(os.path.join(EXT, 'plants.npz'))
names = [str(x) for x in pl['materials']]
uv = pl['uv'].astype(np.float64).copy()
for fi, mname in enumerate(names):
    sel = pl['material'] == fi
    x0, y0, w, h = regions[mname]
    u, v = uv[sel][..., 0], uv[sel][..., 1]
    if mname == 'Stem':
        u, v = np.full_like(u, 0.5), np.full_like(v, 0.5)
    # Region-relative UVs, inset by the gutter, then atlas UV with glTF top-down v.
    ax = (x0 + GUTTER + u * (w - 2 * GUTTER)) / AW
    ay = (y0 + GUTTER + v * (h - 2 * GUTTER)) / AH
    uv[sel] = np.stack([ax, 1 - ay], -1)
pk = np.load(os.path.join(EXT, 'pebbles.npz'))
size = pk['scl'][:, 0]
geometry = size >= A.pebble_geometry_mm / 1000.0
GEO = os.path.join(OUT, 'geometry')
os.makedirs(GEO)
arrays = dict(H=H, plant_co=pl['co'], plant_loops=pl['loops'].astype(np.int32),
              plant_uv=uv.astype(np.float32), pebble_geometry=geometry.astype(np.uint8),
              **{k: pk[k] for k in pk.files if k != 'smooth'}, smooth=pk['smooth'].astype(np.uint8))
for k, v in arrays.items():  # plain little-endian .npy files for the Node packer
    v = np.ascontiguousarray(v)
    assert v.dtype in (np.float32, np.int32, np.uint8), (k, v.dtype)
    np.save(os.path.join(GEO, k + '.npy'), v)
write = dict(stage='maps', blender=bpy.app.version_string, pebbleGeometryMinimumMm=A.pebble_geometry_mm,
             pebbles=int(len(size)), pebbleGeometryInstances=int(geometry.sum()),
             pebbleMapCoverageFraction=pebble_fraction, heightRangeMetres=receipt_h,
             ambientOcclusion=dict(radiusMm=A.ao_radius_mm, directions=A.ao_directions, steps=A.ao_steps, **ao_stats),
             atlasRegions=regions, maps=records,
             inputs=dict(extract=sha(os.path.join(EXT, 'extract.json'))))
json.dump(write, open(os.path.join(OUT, 'maps.json'), 'w', encoding='utf-8'), indent=2)
print('MAPS_DONE', OUT, 'pebble geometry', int(geometry.sum()), 'of', len(size), flush=True)
