# K1 timber-framed wall delivery, stage 1: extract runtime source geometry from accepted candidate 18.
# blender -b --factory-startup --python-exit-code 1 --python extract.py -- --out <dir>
#
# Verifies candidate 18's source.blend and map identities, then writes (never overwrites), per
# mesh object, <object>/<array>.npy in Blender's Z-up source frame:
#   P   displaced vertex positions (Subdiv + Displace, exactly as the approved renders)
#   B   the same vertices before displacement (the base surface)
#   N   base-surface corner normals, deduplicated with the UVs into the vertex set
#   UV  Blender UVs (v up)
#   T   triangles (uint32), M per-triangle material slot (slot names are in extract.json)
# Vertices are unique (position index, normal, UV) corners, so UV and sharp-edge seams stay
# welded in position. extract.json records the kit pieces, their pivots, the placements of the
# test house and every output hash.
import argparse
import hashlib
import json
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
A = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = 'candidate20'  # the accepted source (candidate 20 since the 2026-09-27 brace and corner fixes)
SRC = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-25', SOURCE))
OUT = os.path.abspath(A.out)
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
    if entry['path'] in ('source.blend', 'layout.json') or entry['path'].startswith('maps/'):
        p = os.path.join(SRC, entry['path'])
        if os.path.getsize(p) != entry['bytes'] or sha(p) != entry['sha256']:
            sys.exit('%s identity mismatch: %s' % (SOURCE, entry['path']))
        checked.append(entry['path'])
assert 'source.blend' in checked and 'layout.json' in checked, checked
bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, 'source.blend'))
scene = bpy.context.scene
layout = json.load(open(os.path.join(SRC, 'layout.json'), encoding='utf-8'))


def evaluated(ob, displace):
    for m in ob.modifiers:
        if m.type == 'DISPLACE':
            m.show_viewport = displace
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    return ev, me


def extract(ob):
    has_disp = any(m.type == 'DISPLACE' for m in ob.modifiers)
    for m in ob.modifiers:
        if m.type == 'SUBSURF':
            m.levels = m.render_levels  # the renders used render levels
        if m.type == 'SOLIDIFY':
            m.show_viewport = False     # the runtime glass is the single outward face
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
    # Unique corners: position index, normal and UV. Subdivision interpolates each face's UVs
    # separately, so one vertex's corners differ by float noise (~1e-8); exact keys would split
    # them into false seams that stop the simplifier. Real seams (another atlas rect or a sharp
    # edge) differ by at least a pad of texels, so corners are clustered within a tolerance.
    nk = np.round(ln * 1000).astype(np.int64)
    order = np.lexsort((uv[:, 1], uv[:, 0], nk[:, 2], nk[:, 1], nk[:, 0], lv))
    brk = np.ones(nl, bool)
    brk[1:] = ((lv[order][1:] != lv[order][:-1]) | (nk[order][1:] != nk[order][:-1]).any(1)
               | (np.abs(np.diff(uv[order], axis=0)) > 1e-6).any(1))
    cid = np.cumsum(brk) - 1
    inv = np.empty(nl, np.int64)
    inv[order] = cid
    first = order[brk]
    vidx = lv[first]
    T = inv[tl].reshape(-1, 3).astype(np.uint32)
    os.makedirs(os.path.join(OUT, ob.name))
    for k, arr in dict(P=P[vidx], B=B[vidx], N=ln[first], UV=uv[first], T=T, M=tm).items():
        np.save(os.path.join(OUT, ob.name, k + '.npy'), np.ascontiguousarray(arr))
    return dict(object=ob.name, vertices=int(len(first)), triangles=int(nt), materials=mats,
                displaced=has_disp)


objects = []
kit = {}
for coll in bpy.data.collections:
    if not coll.name.startswith('kit-'):
        continue
    name = coll.name[4:]
    kit[name] = []
    for ob in sorted(coll.objects, key=lambda o: o.name):
        objects.append(extract(ob) | dict(piece=name))
        kit[name].append(ob.name)
house = []
for ob in sorted(scene.collection.objects, key=lambda o: o.name):
    # FarGround is the source's staging (paving to the horizon, candidate 19), not the house.
    if ob.type == 'MESH' and ob.name != 'FarGround':
        objects.append(extract(ob) | dict(piece=None))
        house.append(ob.name)
placements = []
for ob in sorted(scene.collection.objects, key=lambda o: o.name):
    if ob.type == 'EMPTY' and ob.instance_collection and ob.instance_collection.name.startswith('kit-'):
        placements.append(dict(name=ob.name, piece=ob.instance_collection.name[4:],
                               matrix=[list(r) for r in ob.matrix_world]))

files = sorted(os.path.relpath(os.path.join(d, f), OUT).replace(os.sep, '/')
               for d, _, fs in os.walk(OUT) for f in fs)
json.dump(dict(stage='extract', blender=bpy.app.version_string, source=SOURCE,
               sourceChecked=checked, layout=layout, kit=kit, house=house, placements=placements,
               objects=objects,
               files=[dict(path=f, bytes=os.path.getsize(os.path.join(OUT, f)),
                           sha256=sha(os.path.join(OUT, f))) for f in files]),
          open(os.path.join(OUT, 'extract.json'), 'w', encoding='utf-8'), indent=1)
print('EXTRACT_DONE', OUT, len(objects), flush=True)
