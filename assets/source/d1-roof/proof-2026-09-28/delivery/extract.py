# K2 roof delivery, stage 1: extract runtime source geometry from accepted source candidate 8.
# blender -b --factory-startup --python-exit-code 1 --python extract.py -- --out <dir>
#
# Writes (never overwrites) the K1 delivery's extract format, so its geometry stage is shared:
# per mesh object, <object>/<array>.npy in Blender's Z-up frame:
#   P, B   displaced and base vertex positions (equal for undisplaced meshes)
#   N      base-surface corner normals; UV Blender UVs (v up)
#   T      triangles (uint32); M per-triangle material slot (slot names in extract.json)
# Tile meshes (a 'tint' corner colour over the shared variant atlas) add:
#   C      the per-tile kiln and weathering tint (linear RGB), per vertex
#   VIS    per triangle, 1 where some ray from the face reaches open air in the assembled house
#          (any placement of its piece): cover undersides and pan bottoms lying on the course
#          below are 0, and the geometry stage drops them
#   AO     per vertex, cosine-weighted sky visibility within AO_RANGE_M in the assembled house,
#          averaged over the piece's placements; the maps stage averages it per variant slot
# Pieces are the 'roof-*' collections, with their pivots at the placement origins (all 0).
import argparse
import hashlib
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--vis-rays', type=int, default=96)
ap.add_argument('--ao-rays', type=int, default=48)
ap.add_argument('--source', default='candidate8', help='the accepted K2 source candidate (proof-2026-09-27)')
A = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = A.source
SRC = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-27', SOURCE))
OUT = os.path.abspath(A.out)
AO_RANGE_M = 1.0
if os.path.isdir(OUT) and os.listdir(OUT):
    sys.exit('refusing to overwrite existing output %s' % OUT)
os.makedirs(OUT, exist_ok=True)
if bpy.app.version[:3] != (5, 2, 1):
    sys.exit('requires Blender 5.2.1, found %s' % bpy.app.version_string)


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 24), b''):
            h.update(block)
    return h.hexdigest()


receipt = json.load(open(os.path.join(SRC, 'receipt.json'), encoding='utf-8'))
checked = []
for entry in receipt['files']:
    if entry['path'] in ('source.blend', 'build-snapshot.py') or entry['path'].startswith('maps/'):
        p = os.path.join(SRC, entry['path'])
        if sha(p) != entry['sha256']:
            sys.exit('%s identity mismatch: %s' % (SOURCE, entry['path']))
        checked.append(entry['path'])
assert 'source.blend' in checked, checked
bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, 'source.blend'))
scene = bpy.context.scene


def evaluated(ob, displace):
    for m in ob.modifiers:
        if m.type == 'DISPLACE':
            m.show_viewport = displace
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = ob.evaluated_get(dg)
    return ev, ev.to_mesh()


def extract(ob):
    has_disp = any(m.type == 'DISPLACE' for m in ob.modifiers)
    for m in ob.modifiers:
        if m.type == 'SUBSURF':
            m.levels = m.render_levels  # the renders used render levels
    ev, me = evaluated(ob, False)
    me.calc_loop_triangles()
    nv = len(me.vertices)
    B = np.empty(nv * 3, np.float32)
    me.vertices.foreach_get('co', B)
    nl = len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get('vertex_index', lv)
    ln = np.empty(nl * 3, np.float32)
    me.corner_normals.foreach_get('vector', ln)
    uv = np.zeros(nl * 2, np.float32)
    if me.uv_layers:
        me.uv_layers['UVMap'].data.foreach_get('uv', uv)
    tint = None
    if 'tint' in me.color_attributes:
        ca = me.color_attributes['tint']
        assert ca.domain == 'CORNER', ob.name
        tint = np.empty(nl * 4, np.float32)
        ca.data.foreach_get('color', tint)
        tint = tint.reshape(-1, 4)[:, :3]
    nt = len(me.loop_triangles)
    tl = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get('loops', tl)
    tm = np.empty(nt, np.int32)
    me.loop_triangles.foreach_get('material_index', tm)
    mats = [s.material.name if s.material else '' for s in ob.material_slots]
    ev.to_mesh_clear()
    if has_disp:
        ev, me2 = evaluated(ob, True)
        assert len(me2.vertices) == nv, 'displacement changed the topology of %s' % ob.name
        P = np.empty(nv * 3, np.float32)
        me2.vertices.foreach_get('co', P)
        ev.to_mesh_clear()
    else:
        P = B.copy()
    B, P, ln, uv = B.reshape(-1, 3), P.reshape(-1, 3), ln.reshape(-1, 3), uv.reshape(-1, 2)
    # Unique corners (position index, normal, UV, tint), clustered as K1's extract does.
    nk = np.round(ln * 1000).astype(np.int64)
    keys = [uv[:, 1], uv[:, 0], nk[:, 2], nk[:, 1], nk[:, 0], lv]
    if tint is not None:
        tk = np.round(tint * 1e4).astype(np.int64)
        keys = [tk[:, 2], tk[:, 1], tk[:, 0]] + keys
    order = np.lexsort(keys)
    brk = np.ones(nl, bool)
    brk[1:] = ((lv[order][1:] != lv[order][:-1]) | (nk[order][1:] != nk[order][:-1]).any(1)
               | (np.abs(np.diff(uv[order], axis=0)) > 1e-6).any(1))
    if tint is not None:
        brk[1:] |= (tk[order][1:] != tk[order][:-1]).any(1)
    cid = np.cumsum(brk) - 1
    inv = np.empty(nl, np.int64)
    inv[order] = cid
    first = order[brk]
    vidx = lv[first]
    T = inv[tl].reshape(-1, 3).astype(np.uint32)
    arrays = dict(P=P[vidx], B=B[vidx], N=ln[first], UV=uv[first], T=T, M=tm)
    if tint is not None:
        arrays['C'] = tint[first]
    return dict(object=ob.name, vertices=int(len(first)), triangles=int(nt), materials=mats,
                displaced=has_disp, tinted=tint is not None), arrays


# ---------------------------------------------------------------- the assembled house
def instances():
    """(object, world matrix, piece) for every mesh drawn in the source's scene."""
    out = []
    for ob in scene.collection.objects:
        if ob.type == 'MESH':
            out.append((ob, ob.matrix_world.copy(), None))
        elif ob.type == 'EMPTY' and ob.instance_collection:
            for o in ob.instance_collection.objects:
                if o.type == 'MESH':
                    out.append((o, ob.matrix_world @ o.matrix_world, ob.instance_collection.name))
    return out


SKIP = ('FarGround', 'Paving', 'FootPlants')   # ground and plants never hide a roof face


def occluder_mesh(ob):
    """Base-surface triangles (no subdivision or displacement): cheap, and within a few mm."""
    saved = [(m, m.show_viewport) for m in ob.modifiers]
    for m in ob.modifiers:
        if m.type in ('SUBSURF', 'DISPLACE', 'SOLIDIFY'):
            m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    V = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', V)
    F = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get('vertices', F)
    ev.to_mesh_clear()
    for m, s in saved:
        m.show_viewport = s
    return V.reshape(-1, 3), F.reshape(-1, 3)


def world_bvh():
    Vs, Fs, n = [], [], 0
    cache = {}
    for ob, mw, _ in instances():
        if ob.name.startswith(SKIP) or ob.data.materials and all(
                m and m.name in ('grass', 'leaf0', 'leaf1', 'leaf2', 'stem', 'paving') for m in ob.data.materials):
            continue
        if ob.name not in cache:
            cache[ob.name] = occluder_mesh(ob)
        V, F = cache[ob.name]
        M = np.array(mw, np.float64)
        Vw = V @ M[:3, :3].T + M[:3, 3]
        Vs.append(Vw)
        Fs.append(F + n)
        n += len(V)
    V = np.concatenate(Vs)
    F = np.concatenate(Fs)
    print('occluders', len(F), 'triangles', flush=True)
    return BVHTree.FromPolygons([tuple(v) for v in V.tolist()], [tuple(f) for f in F.tolist()], epsilon=0.0)


def fibonacci(n):
    k = np.arange(n) + 0.5
    z = 1 - 2 * k / n
    r = np.sqrt(1 - z * z)
    a = math.pi * (3 - math.sqrt(5)) * k
    return np.stack([r * np.cos(a), r * np.sin(a), z], -1)


def frame(n):
    t = np.cross(n, [0.0, 0.0, 1.0] if abs(n[2]) < 0.9 else [1.0, 0.0, 0.0])
    t /= np.linalg.norm(t)
    return t, np.cross(n, t)


def cosine_dirs(n):
    """Cosine-weighted hemisphere directions about +z (a Fibonacci disc lifted to the hemisphere)."""
    k = np.arange(n) + 0.5
    r = np.sqrt(k / n)
    a = math.pi * (3 - math.sqrt(5)) * k
    x, y = r * np.cos(a), r * np.sin(a)
    return np.stack([x, y, np.sqrt(np.maximum(1 - x * x - y * y, 0))], -1)


SPHERE = fibonacci(2 * A.vis_rays)
COSINE = cosine_dirs(A.ao_rays)


def visible(bvh, p, n):
    for d in SPHERE:
        if d @ n > 0.02 and bvh.ray_cast(Vector(p + n * 2e-4), Vector(d))[0] is None:
            return True
    return False


def sky(bvh, p, n):
    t, b = frame(n)
    free = 0
    for d in COSINE:
        w = d[0] * t + d[1] * b + d[2] * n
        free += bvh.ray_cast(Vector(p + n * 2e-4), Vector(w), AO_RANGE_M)[0] is None
    return free / len(COSINE)


# ---------------------------------------------------------------- objects, pieces, placements
objects, kit, placements, house = [], {}, [], []
data = {}
for coll in sorted(bpy.data.collections, key=lambda c: c.name):
    if not coll.name.startswith('roof-'):
        continue
    kit[coll.name] = []
    for ob in sorted(coll.objects, key=lambda o: o.name):
        rec, arrays = extract(ob)
        objects.append(rec | dict(piece=coll.name))
        data[ob.name] = arrays
        kit[coll.name].append(ob.name)
for ob in sorted(scene.collection.objects, key=lambda o: o.name):
    if ob.type == 'MESH' and any(m and m.name.startswith('roof-') for m in ob.data.materials):
        rec, arrays = extract(ob)
        objects.append(rec | dict(piece=None))
        data[ob.name] = arrays
        house.append(ob.name)
for ob in sorted(scene.collection.objects, key=lambda o: o.name):
    if ob.type == 'EMPTY' and ob.instance_collection and ob.instance_collection.name.startswith('roof-'):
        placements.append(dict(name=ob.name, piece=ob.instance_collection.name,
                               matrix=[list(r) for r in ob.matrix_world]))

bvh = world_bvh()
for rec in objects:
    if not rec['tinted']:
        continue
    arr = data[rec['object']]
    ob = bpy.data.objects[rec['object']]
    mats = [np.array(p['matrix'], np.float64) @ np.array(ob.matrix_world, np.float64)
            for p in placements if p['piece'] == rec['piece']]
    assert mats, rec['object']
    P, N, T = arr['P'].astype(np.float64), arr['N'].astype(np.float64), arr['T']
    vis = np.zeros(len(T), np.uint8)
    ao = np.zeros(len(P), np.float64)
    tile_face = arr['M'] == rec['materials'].index('roof-tile')
    for M in mats:
        R = M[:3, :3]
        Pw = P @ R.T + M[:3, 3]
        Nw = N @ np.linalg.inv(R)
        Nw /= np.linalg.norm(Nw, axis=1, keepdims=True)
        for t in np.nonzero(vis == 0)[0]:
            a, b, c = T[t]
            fn = np.cross(Pw[b] - Pw[a], Pw[c] - Pw[a])
            ln_ = np.linalg.norm(fn)
            if ln_ == 0:
                continue
            fn /= ln_
            if fn @ (Nw[a] + Nw[b] + Nw[c]) < 0:
                fn = -fn
            if visible(bvh, (Pw[a] + Pw[b] + Pw[c]) / 3, fn):
                vis[t] = 1
        on_face = np.zeros(len(P), bool)
        on_face[T[tile_face].ravel()] = True
        for v in np.nonzero(on_face)[0]:
            ao[v] += sky(bvh, Pw[v], Nw[v])
    arr['VIS'] = vis
    arr['AO'] = (ao / len(mats)).astype(np.float32)
    rec['visibleTriangles'] = int(vis.sum())
    print(rec['object'], 'visible', int(vis.sum()), 'of', len(T), 'mean face AO %.3f' % float(arr['AO'][arr['AO'] > 0].mean()),
          flush=True)

for name, arrays in data.items():
    os.makedirs(os.path.join(OUT, name))
    for k, arr in arrays.items():
        np.save(os.path.join(OUT, name, k + '.npy'), np.ascontiguousarray(arr))

files = sorted(os.path.relpath(os.path.join(d, f), OUT).replace(os.sep, '/')
               for d, _, fs in os.walk(OUT) for f in fs)
json.dump(dict(stage='extract', blender=bpy.app.version_string, source=SOURCE, sourceChecked=checked,
               pivots={piece: [0, 0, 0] for piece in kit}, kit=kit, house=house, placements=placements,
               objects=objects, visibilityRays=A.vis_rays, aoRays=A.ao_rays, aoRangeMetres=AO_RANGE_M,
               files=[dict(path=f, bytes=os.path.getsize(os.path.join(OUT, f)),
                           sha256=sha(os.path.join(OUT, f))) for f in files]),
          open(os.path.join(OUT, 'extract.json'), 'w', encoding='utf-8'), indent=1)
print('EXTRACT_DONE', OUT, len(objects), flush=True)
