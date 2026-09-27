# K1 timber-framed wall delivery: fresh import of the runtime bytes under candidate 18's exact
# cameras, sun, sky, paving and AgX look, for a matched review before any engine difference.
# blender -b --factory-startup --python-exit-code 1 --python reimport.py --
#     --geometry <geometry.mjs dir> --textures <pack.mjs dir> --out <dir> [--views front,...]
#     [--lod 0|1|2] [--samples 256] [--scale 1.0]
# Meshes are the decoded runtime vertex/index streams (32-byte glTF-frame slabs) with their base
# normals as custom normals; materials read the decoded shipped maps (BC1/BC7 as the GPU sees
# them): base colour, tangent-space normal, roughness from ORM.G and metallic factor x ORM.B.
# ORM.R and the micro-shadow height are runtime-only; Cycles traces its own occlusion.
import argparse
import hashlib
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--geometry', required=True)
ap.add_argument('--textures', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--lod', type=int, default=0)
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--views', default='front,corner,junction,close,oak,window,street,overview,overcast,low,right,gray')
ap.add_argument('--scale', type=float, default=1.0)
A = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = 'candidate20'  # the accepted source (candidate 20 since the 2026-09-27 brace and corner fixes)
SRC = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-25', SOURCE))
GEO, TEX = os.path.abspath(A.geometry), os.path.abspath(A.textures)
OUT = os.path.abspath(A.out)
if os.path.isdir(OUT) and os.listdir(OUT):
    sys.exit('refusing to overwrite existing output %s' % OUT)
os.makedirs(OUT, exist_ok=True)
receipt = json.load(open(os.path.join(SRC, 'receipt.json'), encoding='utf-8'))
blend = os.path.join(SRC, 'source.blend')
with open(blend, 'rb') as f:
    assert hashlib.sha256(f.read()).hexdigest() == {e['path']: e['sha256'] for e in receipt['files']}['source.blend']
geometry = json.load(open(os.path.join(GEO, 'geometry.json'), encoding='utf-8'))
pack = json.load(open(os.path.join(TEX, 'pack.json'), encoding='utf-8'))

# The source scene keeps its paving (and far ground), sun, camera and sky; the source house goes.
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
for ob in list(bpy.data.objects):
    keep = ob.name.startswith('Paving') or ob.name == 'FarGround' or ob.type in ('LIGHT', 'CAMERA')
    if not keep:
        bpy.data.objects.remove(ob, do_unlink=True)
for coll in list(bpy.data.collections):
    if coll.name.startswith('kit-'):
        bpy.data.collections.remove(coll)
sun = next(o for o in scene.objects if o.type == 'LIGHT')
cam = scene.camera
sky = next(n for n in scene.world.node_tree.nodes if n.type == 'TEX_SKY')
bg = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
scene.cycles.samples = A.samples
# The saved source.blend ends on its unlit pass (Standard); every lit view uses AgX High Contrast.
scene.view_settings.view_transform = 'AgX'
for look in ('AgX - High Contrast', 'High Contrast'):
    try:
        scene.view_settings.look = look
        break
    except Exception:
        pass


# ---------------------------------------------------------------- decoded maps as images
def image(role, colorspace):
    t = next(x for x in pack['textures'] if x['role'] == role)
    w, h = t['width'], t['height']
    raw = np.fromfile(os.path.join(TEX, 'decoded', '%s-00.rgba' % role), np.uint8).reshape(h, w, 4)
    img = bpy.data.images.new(role, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set((raw[::-1].astype(np.float32) / 255.0).ravel())  # KTX2 rows are top-down
    img.pack()
    return img


MATS = {}
for name, m in pack['materials'].items():
    mat = bpy.data.materials.new('rt-' + name)
    mat.use_nodes = True
    nt = mat.node_tree
    nn, ll = nt.nodes, nt.links
    bs = nn['Principled BSDF']
    bs.name = 'BSDF'
    ta = nn.new('ShaderNodeTexImage')
    ta.name = 'ALB'
    ta.image = image(name + '-basecolor', 'sRGB')
    ta.extension = 'REPEAT' if m['textureAddressMode'] == 'repeat' else 'EXTEND'
    tn = nn.new('ShaderNodeTexImage')
    tn.image = image(name + '-normal', 'Non-Color')
    tn.extension = ta.extension
    to = nn.new('ShaderNodeTexImage')
    to.image = image(name + '-orm', 'Non-Color')
    to.extension = ta.extension
    nm = nn.new('ShaderNodeNormalMap')
    nm.uv_map = 'UVMap'
    sep = nn.new('ShaderNodeSeparateColor')
    ll.new(ta.outputs['Color'], bs.inputs['Base Color'])
    ll.new(tn.outputs['Color'], nm.inputs['Color'])
    ll.new(nm.outputs['Normal'], bs.inputs['Normal'])
    ll.new(to.outputs['Color'], sep.inputs['Color'])
    ll.new(sep.outputs['Green'], bs.inputs['Roughness'])
    metal = m.get('metallicFactor', 0.0)
    if metal > 0:
        mul = nn.new('ShaderNodeMath')
        mul.operation = 'MULTIPLY'
        mul.inputs[1].default_value = metal
        ll.new(sep.outputs['Blue'], mul.inputs[0])
        ll.new(mul.outputs[0], bs.inputs['Metallic'])
    else:
        bs.inputs['Metallic'].default_value = 0.0
    MATS[name] = mat

# ---------------------------------------------------------------- runtime meshes
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # Blender -> glTF


def runtime_mesh(entry, lod):
    name = '%s-lod%d' % (entry['object'], lod)
    v = np.fromfile(os.path.join(GEO, 'decoded', name + '.vertices'), np.float32).reshape(-1, 8)
    idx = np.fromfile(os.path.join(GEO, 'decoded', name + '.indices'), np.uint32).reshape(-1, 3)
    co = np.stack([v[:, 0], -v[:, 2], v[:, 1]], 1)       # glTF (X, Y, Z) -> Blender (X, -Z, Y)
    nrm = np.stack([v[:, 3], -v[:, 5], v[:, 4]], 1)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co))
    me.vertices.foreach_set('co', co.ravel())
    me.loops.add(idx.size)
    me.loops.foreach_set('vertex_index', idx.ravel().astype(np.int32))
    me.polygons.add(len(idx))
    me.polygons.foreach_set('loop_start', np.arange(0, idx.size, 3, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(len(idx), 3, np.int32))
    me.update(calc_edges=True)
    uvl = me.uv_layers.new(name='UVMap')
    uv = np.stack([v[:, 6], 1 - v[:, 7]], 1)
    uvl.data.foreach_set('uv', uv[idx.ravel()].ravel())
    me.shade_smooth()
    me.normals_split_custom_set_from_vertices(nrm.tolist())
    me.materials.append(MATS[entry['material']])
    return me


collections = {}
for entry in geometry['meshes']:
    lod = min(A.lod, len(entry['lods']) - 1)
    me = runtime_mesh(entry, lod)
    ob = bpy.data.objects.new(me.name, me)
    # Base-surface normals over decimated relief: Cycles self-shadows the steeper faces into thin
    # dark terminator lines that the rasterizer never draws (the paving delivery's setting).
    ob.shadow_terminator_geometry_offset = 1.0
    if entry['piece'] is None:
        scene.collection.objects.link(ob)
        continue
    coll = collections.get(entry['piece'])
    if coll is None:
        coll = collections[entry['piece']] = bpy.data.collections.new('rt-' + entry['piece'])
    coll.objects.link(ob)
for p in geometry['placements']:
    G = Matrix([p['matrix'][c::4] for c in range(4)])  # column-major -> rows
    e = bpy.data.objects.new('rt-' + p['name'], None)
    e.instance_type = 'COLLECTION'
    e.instance_collection = collections[p['piece']]
    e.matrix_world = C.inverted() @ G @ C
    scene.collection.objects.link(e)


# ---------------------------------------------------------------- cameras and sun (build.py)
def set_sun(el, az, strength, color=(1.0, 0.88, 0.72)):
    el, az = math.radians(el), math.radians(az)
    s = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    sun.rotation_euler = (-s).to_track_quat('-Z', 'Y').to_euler()
    sun.data.energy = strength
    sun.data.color = color
    sky.sun_direction = s
    sun.hide_render = strength <= 0


def set_cam(eye, target, lens):
    cam.location = eye
    cam.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens


KEY = (38, -35, 4.6)
VIEWS = {
    'front': dict(eye=(3.0, -7.2, 1.75), target=(3.0, 0.0, 1.75), lens=38, sun=KEY, sky=2.0, res=(1536, 1024)),
    'corner': dict(eye=(13.75, -1.95, 0.55), target=(12.1, 0.2, 1.05), lens=28, sun=KEY, sky=2.0, res=(1312, 1200)),
    'junction': dict(eye=(1.85, -0.95, 0.92), target=(2.05, 0.0, 0.74), lens=38, sun=KEY, sky=2.0, res=(1536, 1024)),
    'close': dict(eye=(2.0, -0.34, 2.40), target=(2.02, 0.0, 2.35), lens=42, sun=KEY, sky=2.0, res=(1536, 1024)),
    'oak': dict(eye=(11.25, -1.55, 2.95), target=(11.7, 0.0, 3.0), lens=40, sun=KEY, sky=2.0, res=(1312, 1200)),
    'window': dict(eye=(4.5, -1.7, 1.75), target=(3.1, 0.0, 1.95), lens=35, sun=KEY, sky=2.0, res=(1536, 1024)),
    'street': dict(eye=(-1.2, -4.8, 1.7), target=(8.5, 0.3, 2.9), lens=26, sun=KEY, sky=2.0, res=(1536, 1024)),
    'overview': dict(eye=(17.5, -13.0, 6.0), target=(6.0, 2.0, 2.6), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    'overcast': dict(eye=(-1.2, -4.8, 1.7), target=(8.5, 0.3, 2.9), lens=26, sun=(34, -35, 0.0), sky=6.0, res=(1536, 1024)),
    'low': dict(eye=(3.0, -7.2, 1.75), target=(3.0, 0.0, 1.75), lens=38, sun=(12, -150, 4.5), sky=2.0, res=(1536, 1024)),
    'right': dict(eye=(18.5, 3.1, 1.7), target=(12.25, 3.1, 2.4), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    # The front-left corner, fixed in source candidate 19 (the source's corner-left view).
    'corner-left': dict(eye=(-1.6, -1.8, 2.2), target=(0.1, 0.1, 2.0), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
}
VIEWS['gray'] = dict(VIEWS['front'], mode='gray')


def set_mode(mode):
    for mat in MATS.values():
        nt = mat.node_tree
        bs, ta = nt.nodes['BSDF'], nt.nodes['ALB']
        for l_ in list(bs.inputs['Base Color'].links):
            nt.links.remove(l_)
        if mode == 'gray':
            bs.inputs['Base Color'].default_value = (0.18, 0.18, 0.18, 1)
        else:
            nt.links.new(ta.outputs['Color'], bs.inputs['Base Color'])


for vname in [v for v in A.views.split(',') if v]:
    V = VIEWS[vname]
    set_mode(V.get('mode'))
    set_cam(V['eye'], V['target'], V['lens'])
    set_sun(*V['sun'])
    bg.inputs['Strength'].default_value = V['sky']
    scene.render.resolution_x = int(V['res'][0] * A.scale)
    scene.render.resolution_y = int(V['res'][1] * A.scale)
    scene.render.resolution_percentage = 100
    scene.render.filepath = os.path.join(OUT, vname + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', vname, flush=True)
json.dump(dict(stage='reimport', lod=A.lod, samples=A.samples, views=A.views.split(','),
               geometry=hashlib.sha256(open(os.path.join(GEO, 'geometry.json'), 'rb').read()).hexdigest(),
               pack=hashlib.sha256(open(os.path.join(TEX, 'pack.json'), 'rb').read()).hexdigest()),
          open(os.path.join(OUT, 'reimport.json'), 'w', encoding='utf-8'), indent=1)
print('REIMPORT_DONE', flush=True)
