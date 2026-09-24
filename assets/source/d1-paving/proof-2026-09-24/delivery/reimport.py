# Photoreal paving delivery, stage 4: fresh import of the delivery GLBs under candidate1's
# exact cameras, sun, sky and AgX look (copied from photoreal/build.py), for matched review.
# blender -b --factory-startup --python-exit-code 1 --python reimport.py -- --pack <dir> --out <dir>
#   [--lod 0|1|2|mixed] [--samples 256] [--views walking,...] [--scale 1.0]
# "mixed" picks each translated tile's ground/pebble/plant LOD from its centre distance
# with the runtime boundaries below, as the game would.
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--pack', required=True)
ap.add_argument('--extract', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--lod', default='0')
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--views', default='walking,walking-matched,overview,close,joint,grazing,overcast,gray,unlit,join')
ap.add_argument('--scale', type=float, default=1.0)
# Diagnostic: Cycles shadow-terminator geometry offset on the ground (Blender default 0.1).
ap.add_argument('--terminator-offset', type=float, default=None)
# Diagnostic: drop each plant face's coincident reversed copy (the rasterizer needs both;
# Cycles renders both sides of one face and can shade the coincident copy instead).
ap.add_argument('--single-sided-plants', action='store_true')
A = ap.parse_args(argv)
OUT = os.path.abspath(A.out)
os.makedirs(OUT, exist_ok=True)
TILE = 4.0
LOD_BOUNDS = dict(ground=(12.0, 32.0), pebbles=(6.0, 12.0), plants=(8.0, 24.0))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
parts = {}  # (part, lod) -> collection
for lod in range(3):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.abspath(A.pack), 'lod%d.glb' % lod))
    for ob in set(bpy.data.objects) - before:
        part = ob.name.split('-lod')[0]
        coll = bpy.data.collections.new('%s-lod%d' % (part, lod))
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        coll.objects.link(ob)
        ob.location = (2.0, 2.0, 0.0)  # importer gives the tile centred at the origin
        if A.single_sided_plants and part == 'plants':
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            seen, drop = set(), []
            for f in bm.faces:
                key = tuple(sorted(tuple(round(c, 6) for c in v.co) for v in f.verts))
                if key in seen:
                    drop.append(f)
                else:
                    seen.add(key)
            bmesh.ops.delete(bm, geom=drop, context='FACES')
            bm.to_mesh(ob.data)
            bm.free()
        if A.terminator_offset is not None and part == 'ground':
            ob.shadow_terminator_geometry_offset = A.terminator_offset
        parts[(part, lod)] = coll

ground_mats = {m.name: m for m in bpy.data.materials if m.name.startswith('PavingGround')}
assert len(ground_mats) == 3, list(ground_mats)
for m in bpy.data.materials:  # the source used cubic filtering on albedo/normal; the GPU is linear
    for nd in m.node_tree.nodes:
        if nd.type == 'TEX_IMAGE':
            assert nd.extension in ('REPEAT', 'EXTEND', 'CLIP'), nd.extension


def tile_lod(part, cx, cy, cam):
    if A.lod != 'mixed':
        return int(A.lod)
    d = (Vector((cx, cy, 0.0)) - cam).length
    near, far = LOD_BOUNDS[part]
    return 0 if d <= near else 1 if d <= far else 2


instances = []


def place_tiles(cam):
    for e in instances:
        bpy.data.objects.remove(e, do_unlink=True)
    instances.clear()
    for ty in (-1, 0, 1, 2):
        for tx in (-1, 0, 1):
            cx, cy = tx * TILE + 2.0, ty * TILE + 2.0
            for part in ('ground', 'pebbles', 'plants'):
                lod = tile_lod(part, cx, cy, cam)
                if (part, lod) not in parts:
                    continue
                e = bpy.data.objects.new('%s_%d_%d' % (part, tx, ty), None)
                e.instance_type = 'COLLECTION'
                e.instance_collection = parts[(part, lod)]
                e.location = (tx * TILE, ty * TILE, 0)
                scene.collection.objects.link(e)
                instances.append(e)


# ---------------------------------------------------------------- lighting / world / render (build.py)
world = bpy.data.worlds.new('Sky')
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
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
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '8'


def set_look(view_transform):
    scene.view_settings.view_transform = view_transform
    if view_transform == 'AgX':
        for look in ('AgX - High Contrast', 'High Contrast'):
            try:
                scene.view_settings.look = look
                break
            except Exception:
                pass


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
    cam_d.type = 'PERSP'


VIEWS = {
    'walking': dict(eye=(2.0, 0.25, 1.6), target=(2.05, 2.75, 0.0), lens=30, sun=(30, 165, 4.6), sky=2.0, res=(1536, 1024)),
    'walking-matched': dict(eye=(2.15, 0.3, 1.635), target=(2.05, 2.15, 0.0), lens=42, sun=(30, 165, 4.6), sky=2.0, res=(1800, 1350)),
    'overview': dict(eye=(-0.6, -1.4, 2.6), target=(2.0, 2.0, 0.0), lens=30, sun=(30, 165, 4.6), sky=2.0, res=(1536, 1024)),
    'joint': dict(eye=(2.0, 1.3, 0.22), target=(2.05, 1.75, -0.01), lens=45, sun=(28, 170, 4.6), sky=2.0, res=(1536, 1024)),
    'overcast': dict(eye=(2.0, 0.25, 1.6), target=(2.05, 2.75, 0.0), lens=30, sun=(34, 165, 0.0), sky=6.0, res=(1536, 1024)),
    'grazing': dict(eye=(2.0, 0.25, 1.6), target=(2.05, 2.75, 0.0), lens=30, sun=(12, 20, 4.5), sky=2.0, res=(1536, 1024)),
    # Four-tile corner at (4, 4) under a low sun: the delivery's tile-join check.
    'join': dict(eye=(4.35, 3.05, 0.55), target=(4.0, 4.0, 0.0), lens=35, sun=(12, 20, 4.5), sky=2.0, res=(1536, 1024)),
}
VIEWS['gray'] = dict(VIEWS['walking-matched'], mode='gray')
VIEWS['unlit'] = dict(VIEWS['walking-matched'], mode='unlit')
# build.py aims 'close' at its first rosette site. Its first petiole ring (vertices 98-103,
# after the 14 x 7 leaf grid) is centred on that root, so recover it from the stage-1 plants.
import numpy as np
co = np.load(os.path.join(os.path.abspath(A.extract), 'plants.npz'))['co']
ros = co[98:104, :2].mean(0)
VIEWS['close'] = dict(eye=(ros[0] - 0.05, ros[1] - 0.55, 0.32), target=(ros[0], ros[1] + 0.05, 0.0), lens=40,
                      sun=(30, 165, 4.6), sky=2.0, res=(1536, 1024))


def set_mode(mode):
    for m in ground_mats.values():
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        outn = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE' and 'basecolor' in n.image.name)
        for l_ in list(bsdf.inputs['Base Color'].links) + list(outn.inputs['Surface'].links):
            nt.links.remove(l_)
        if mode == 'gray':
            bsdf.inputs['Base Color'].default_value = (0.18, 0.18, 0.18, 1)
            nt.links.new(bsdf.outputs[0], outn.inputs['Surface'])
        elif mode == 'unlit':
            em = nt.nodes.get('UnlitEmission') or nt.nodes.new('ShaderNodeEmission')
            em.name = 'UnlitEmission'
            nt.links.new(tex.outputs['Color'], em.inputs['Color'])
            nt.links.new(em.outputs[0], outn.inputs['Surface'])
        else:
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            nt.links.new(bsdf.outputs[0], outn.inputs['Surface'])


for vname in [v for v in A.views.split(',') if v]:
    V = VIEWS[vname]
    set_mode(V.get('mode'))
    set_look('Standard' if V.get('mode') == 'unlit' else 'AgX')
    set_cam(V['eye'], V['target'], V['lens'])
    place_tiles(Vector(V['eye']))
    set_sun(*V['sun'])
    bg.inputs['Strength'].default_value = V['sky']
    scene.render.resolution_x = int(V['res'][0] * A.scale)
    scene.render.resolution_y = int(V['res'][1] * A.scale)
    scene.render.resolution_percentage = 100
    scene.render.filepath = os.path.join(OUT, vname + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', vname, flush=True)
