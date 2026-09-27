# K1 timber-framed wall delivery: render the accepted source (candidate 20) at delivery cameras that
# the source package did not render (its `extreme` camera was placed from build-time check data).
# blender -b <candidate20/source.blend> --python-exit-code 1 --python source_views.py -- --out <dir>
#     [--views close,...] [--samples 256]
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--views', default='close')
ap.add_argument('--samples', type=int, default=256)
A = ap.parse_args(argv)
OUT = os.path.abspath(A.out)
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
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
KEY = (38, -35, 4.6)
# `close`: 0.25 m across a front ground post's check and the plaster loss beside it (x 1.92,
# z 2.31 in the front view), the delivery's extreme-range view.
VIEWS = {
    # The front-left corner, which no source view shows: the test house has its corner piece only
    # at the front-right.
    'corner-fl': dict(eye=(-1.6, -1.8, 2.2), target=(0.1, 0.1, 2.0), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    # The mirrored right facade, which the source package did not render.
    'right': dict(eye=(18.5, 3.1, 1.7), target=(12.25, 3.1, 2.4), lens=30, sun=KEY, sky=2.0, res=(1536, 1024)),
    'close': dict(eye=(2.0, -0.34, 2.40), target=(2.02, 0.0, 2.35), lens=42, sun=KEY, sky=2.0, res=(1536, 1024)),
    # The junction under the sun alone: the post's cast shadow on the plaster return, without sky.
    'junction-sun': dict(eye=(1.85, -0.95, 0.92), target=(2.05, 0.0, 0.74), lens=38, sun=KEY, sky=0.0,
                         res=(1536, 1024)),
}
for vname in A.views.split(','):
    V = VIEWS[vname]
    el, az = math.radians(V['sun'][0]), math.radians(V['sun'][1])
    s = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    sun.rotation_euler = (-s).to_track_quat('-Z', 'Y').to_euler()
    sun.data.energy = V['sun'][2]
    sun.data.color = (1.0, 0.88, 0.72)
    sky.sun_direction = s
    bg.inputs['Strength'].default_value = V['sky']
    cam.location = V['eye']
    cam.rotation_euler = (Vector(V['target']) - Vector(V['eye'])).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = V['lens']
    scene.render.resolution_x, scene.render.resolution_y = V['res']
    scene.render.resolution_percentage = 100
    scene.render.filepath = os.path.join(OUT, vname + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', vname, flush=True)
