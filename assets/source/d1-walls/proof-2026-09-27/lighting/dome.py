# Engine package 7: the source's Hosek-Wilkie sky (turbidity 2.6, as calibrate.py) rendered as
# equirectangular panoramas, sky only, at each sweep sun elevation (azimuth 0), for fit.py's dense
# irradiance fit. The 13 Cycles probes per elevation are too few to fit a dome shape; integrating
# these panoramas gives any normal's sky irradiance (they agree with the probes within 2.2%).
# blender -b --factory-startup --python-exit-code 1 --python dome.py -- <calibration.json> <out.npz>
# (The .npz, about 25 MB, is a working file: it stays out of the repository.)
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

cal_path, out_path = sys.argv[sys.argv.index('--') + 1:][:2]
cal = json.load(open(cal_path, encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.cycles.use_denoising = False
W, H = 1024, 512
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_depth = '32'

world = bpy.data.worlds.new('Sky')
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
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
cam_d = bpy.data.cameras.new('Pano')
cam_d.type = 'PANO'
cam_d.panorama_type = 'EQUIRECTANGULAR'
cam = bpy.data.objects.new('Pano', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
# Measured with emissive markers: this rotation puts +x (azimuth 0) at the image centre and +y
# (azimuth 90 degrees) a quarter of the width left of it, with rows running up from the nadir.
cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)

rows = (np.arange(H) + 0.5) / H * math.pi - math.pi / 2  # elevation, bottom row first
cols = (W / 2 - (np.arange(W) + 0.5)) / W * 2 * math.pi  # azimuth
EL, AZ = np.meshgrid(rows, cols, indexing='ij')
DIR = np.stack([np.cos(EL) * np.cos(AZ), np.cos(EL) * np.sin(AZ), np.sin(EL)], -1).reshape(-1, 3)
DOMEGA = (np.cos(EL) * (math.pi / H) * (2 * math.pi / W)).reshape(-1)
UPPER = DIR[:, 2] > 0  # below the horizon the probes see the ground plane, which fit.py models
out = {}
for el in sorted({p['elevationDeg'] for p in cal['sweep']}):
    e = math.radians(el)
    sky.sun_direction = Vector((math.cos(e), 0.0, math.sin(e)))
    path = os.path.join(os.path.dirname(os.path.abspath(out_path)), 'dome_%d.exr' % el)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    L = np.array(img.pixels[:]).reshape(H, W, 4)[:, :, :3].reshape(-1, 3)
    bpy.data.images.remove(img)
    os.remove(path)
    out['el%d' % el] = L[UPPER].astype(np.float32)
np.savez_compressed(out_path, dirs=DIR[UPPER].astype(np.float32), domega=DOMEGA[UPPER].astype(np.float32), **out)
print('DOME_DONE')
