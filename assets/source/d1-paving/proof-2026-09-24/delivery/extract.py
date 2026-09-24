# Photoreal paving delivery, stage 1: extract source data from approved candidate1.
# blender -b --factory-startup --python-exit-code 1 --python extract.py -- --out <dir>
# Verifies every candidate1 identity, then writes (never overwrites):
#   pebbles.npz     GritPoints position/rot/scl/variant/tint plus the 24 variant meshes
#   plants.npz      JointPlants vertices/faces/UVs/material index (source coordinates)
#   pebble-{albedo,normal,height}.exr  top-down orthographic renders of the tile's
#                   pebbles only (neighbour copies included, so edges wrap), used to
#                   draw the pebbles into the delivery maps at their exact placements
#   leaf0-2.png / grass.png copies are re-read from candidate1/maps by stage 2
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
ap.add_argument('--samples', type=int, default=64)
A = ap.parse_args(argv)
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-22/photoreal/candidate1'))
OUT = os.path.abspath(A.out)
if os.path.isdir(OUT) and os.listdir(OUT):
    sys.exit('refusing to overwrite existing output %s' % OUT)
os.makedirs(OUT, exist_ok=True)
if bpy.app.version[:3] != (5, 2, 1):
    sys.exit('requires Blender 5.2.1, found %s' % bpy.app.version_string)


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


receipt = json.load(open(os.path.join(SRC, 'receipt.json'), encoding='utf-8'))
checked = []
for entry in receipt['files']:
    if entry['path'] == 'source.blend' or entry['path'].startswith('maps/'):
        p = os.path.join(SRC, entry['path'])
        if os.path.getsize(p) != entry['bytes'] or sha(p) != entry['sha256']:
            sys.exit('candidate1 identity mismatch: %s' % entry['path'])
        checked.append(entry['path'])
assert 'source.blend' in checked and len(checked) == 9, checked
bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, 'source.blend'))
scene = bpy.context.scene

# ---------------------------------------------------------------- pebble instances + variants
gp = bpy.data.objects['GritPoints'].data
n = len(gp.vertices)


def attr(name, width):
    a = gp.attributes[name]
    key = {'FLOAT_VECTOR': 'vector', 'FLOAT_COLOR': 'color', 'INT': 'value'}[a.data_type]
    buf = np.empty(n * width, np.int32 if a.data_type == 'INT' else np.float32)
    a.data.foreach_get(key, buf)
    return buf.reshape(n, width) if width > 1 else buf


pos = attr('position', 3)
variants = sorted(bpy.data.collections['GritVariants'].objects, key=lambda o: o.name)
vv, vf, vs = [], [], []
for o in variants:
    me = o.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    tri = np.empty(len(me.polygons) * 3, np.int32)
    me.polygons.foreach_get('vertices', tri)
    smooth = np.empty(len(me.polygons), bool)
    me.polygons.foreach_get('use_smooth', smooth)
    vv.append(co.reshape(-1, 3))
    vf.append(tri.reshape(-1, 3))
    vs.append(bool(smooth.all()))
    assert smooth.all() or not smooth.any()
np.savez(os.path.join(OUT, 'pebbles.npz'), position=pos, rot=attr('rot', 3), scl=attr('scl', 3),
         variant=attr('variant', 1), tint=attr('tint', 4)[:, :3],
         **{'v%02d' % i: v for i, v in enumerate(vv)}, **{'f%02d' % i: f for i, f in enumerate(vf)},
         smooth=np.array(vs))

# ---------------------------------------------------------------- plants (source coordinates, quads)
pl = bpy.data.objects['JointPlants'].data
co = np.empty(len(pl.vertices) * 3, np.float32)
pl.vertices.foreach_get('co', co)
nloop = np.empty(len(pl.polygons), np.int32)
pl.polygons.foreach_get('loop_total', nloop)
assert (nloop == 4).all()
lv = np.empty(len(pl.loops), np.int32)
pl.loops.foreach_get('vertex_index', lv)
uv = np.empty(len(pl.loops) * 2, np.float32)
pl.uv_layers['UVMap'].data.foreach_get('uv', uv)
mi = np.empty(len(pl.polygons), np.int32)
pl.polygons.foreach_get('material_index', mi)
np.savez(os.path.join(OUT, 'plants.npz'), co=co.reshape(-1, 3), loops=lv.reshape(-1, 4),
         uv=uv.reshape(-1, 4, 2), material=mi, materials=np.array([m.name for m in pl.materials]))

# ---------------------------------------------------------------- top-down pebble renders
for name in ('PavingGround', 'JointPlants'):
    bpy.data.objects[name].hide_render = True
cam = scene.camera
cam.location = (2.0, 2.0, 1.0)
cam.rotation_euler = (0.0, 0.0, 0.0)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 4.0
cam.data.clip_start = 0.5
cam.data.clip_end = 2.0
scene.render.resolution_x = scene.render.resolution_y = 4096
scene.render.resolution_percentage = 100
scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
scene.render.film_transparent = True
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
for d in prefs.devices:
    d.use = d.type == 'OPTIX'
scene.cycles.device = 'GPU'
scene.cycles.use_denoising = False
scene.cycles.seed = 11
scene.view_settings.view_transform = 'Standard'
try:
    scene.view_settings.look = 'None'
except Exception:
    pass
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
for o in scene.objects:
    if o.type == 'LIGHT':
        o.hide_render = True
fmt = scene.render.image_settings
fmt.file_format = 'OPEN_EXR'
fmt.color_depth = '32'
fmt.color_mode = 'RGBA'
fmt.exr_codec = 'ZIP'

mat = bpy.data.materials['Grit']
nt = mat.node_tree
out = next(nd for nd in nt.nodes if nd.type == 'OUTPUT_MATERIAL')
albedo = next(nd for nd in nt.nodes if nd.type == 'VECT_MATH' and nd.operation == 'MULTIPLY')
bump = next(nd for nd in nt.nodes if nd.type == 'BUMP')
em = nt.nodes.new('ShaderNodeEmission')
nt.links.new(em.outputs[0], out.inputs['Surface'])
half = nt.nodes.new('ShaderNodeVectorMath')
half.operation = 'MULTIPLY_ADD'
half.inputs[1].default_value = (0.5, 0.5, 0.5)
half.inputs[2].default_value = (0.5, 0.5, 0.5)
nt.links.new(bump.outputs['Normal'], half.inputs[0])
geo = nt.nodes.new('ShaderNodeNewGeometry')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
nt.links.new(geo.outputs['Position'], sep.inputs[0])
lift = nt.nodes.new('ShaderNodeMath')
lift.operation = 'ADD'
lift.inputs[1].default_value = 1.0  # emission stays positive; stage 2 subtracts it
nt.links.new(sep.outputs['Z'], lift.inputs[0])
passes = {
    'albedo': (albedo.outputs['Vector'], A.samples, 1.0),
    'normal': (half.outputs['Vector'], A.samples, 1.0),
    # One near-centre sample per texel: the nearest pebble top, never a filtered mix.
    'height': (lift.outputs['Value'], 1, 0.01),
}
for name, (socket, samples, width) in passes.items():
    for link in list(em.inputs['Color'].links):
        nt.links.remove(link)
    nt.links.new(socket, em.inputs['Color'])
    scene.cycles.samples = samples
    scene.cycles.filter_width = width
    scene.render.filepath = os.path.join(OUT, 'pebble-%s.exr' % name)
    bpy.ops.render.render(write_still=True)

files = sorted(f for f in os.listdir(OUT))
json.dump(dict(stage='extract', blender=bpy.app.version_string, samples=A.samples,
               candidate1Checked=checked,
               files=[dict(path=f, bytes=os.path.getsize(os.path.join(OUT, f)),
                           sha256=sha(os.path.join(OUT, f))) for f in files]),
          open(os.path.join(OUT, 'extract.json'), 'w', encoding='utf-8'), indent=2)
print('EXTRACT_DONE', OUT, flush=True)
