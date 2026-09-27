# Engine package 7: lighting on every surface orientation, calibrated against Cycles.
# blender -b --factory-startup --python-exit-code 1 --python calibrate.py -- --out <dir>
#
# 1. Irradiance probes: small white Lambert quads (albedo 1) facing up, down, four horizontal
#    directions relative to the sun and two 45-degree tilts, 1.5 m above a large ground plane of
#    the admitted paving's mean linear albedo, under the source's exact sun and Hosek-Wilkie sky
#    (turbidity 2.6). Each case renders sun-only and sky-only; a probe's mean linear radiance is
#    E / pi, the value an albedo-1 Lambert surface shows.
# 2. Tone map: emission patches of known linear colour through AgX - High Contrast, the source's
#    view transform, read back as display-encoded values.
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--samples', type=int, default=512)
ap.add_argument('--sweep', type=int, default=1)
ap.add_argument('--agx-grid', type=int, default=1)
A = ap.parse_args(argv)
OUT = os.path.abspath(A.out)
os.makedirs(OUT, exist_ok=True)
# The admitted paving's mean linear albedo (photoreal candidate1 maps, box-averaged).
GROUND_ALBEDO = (0.3187, 0.2547, 0.1668)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = A.samples
scene.cycles.use_denoising = False
scene.cycles.seed = 7
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 4
scene.render.resolution_x = scene.render.resolution_y = 32
scene.render.filter_size = 0.01

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
sun_d = bpy.data.lights.new('Sun', 'SUN')
sun = bpy.data.objects.new('Sun', sun_d)
scene.collection.objects.link(sun)
sun_d.angle = math.radians(0.6)


def material(name, color, emission=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    for n in list(nodes):
        nodes.remove(n)
    if emission:
        sh = nodes.new('ShaderNodeEmission')
        sh.inputs['Color'].default_value = (*color, 1)
    else:
        sh = nodes.new('ShaderNodeBsdfDiffuse')
        sh.inputs['Color'].default_value = (*color, 1)
        sh.inputs['Roughness'].default_value = 0.0
    out = nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(sh.outputs[0], out.inputs['Surface'])
    return mat, sh


bpy.ops.mesh.primitive_plane_add(size=400.0)
ground = bpy.context.active_object
ground.data.materials.append(material('Ground', GROUND_ALBEDO)[0])
bpy.ops.mesh.primitive_plane_add(size=0.2)
probe = bpy.context.active_object
white, _ = material('White', (1, 1, 1))
probe.data.materials.append(white)
# The probe must not see itself or cast onto the ground it measures: the camera sees only it.
probe.visible_shadow = False
cam_d = bpy.data.cameras.new('Cam')
cam_d.type = 'ORTHO'
cam_d.ortho_scale = 0.1
cam_d.clip_start = 0.01
cam_d.clip_end = 1.0
cam = bpy.data.objects.new('Cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam


def set_sun(el, az, strength, color=(1.0, 0.88, 0.72)):
    el, az = math.radians(el), math.radians(az)
    s = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    sun.rotation_euler = (-s).to_track_quat('-Z', 'Y').to_euler()
    sun_d.energy = strength
    sun_d.color = color
    sky.sun_direction = s
    sun.hide_render = strength <= 0
    return s


def aim_probe(normal):
    n = Vector(normal).normalized()
    probe.location = (0, 0, 1.5)
    probe.rotation_euler = n.to_track_quat('Z', 'Y').to_euler()
    cam.location = Vector(probe.location) + n * 0.3
    cam.rotation_euler = (-n).to_track_quat('-Z', 'Y').to_euler()


def render_linear(name):
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    path = os.path.join(OUT, name + '.exr')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float64).reshape(-1, 4)[:, :3]
    bpy.data.images.remove(img)
    os.remove(path)
    return [float(v) for v in px.mean(axis=0)]


# (name, elevation, azimuth, sun W/m^2, sky strength): the wall source's key and low views, the
# paving's day, and the wall source's overcast diagnostic (sun off, sky x3).
CASES = [
    ('wall-key-38', 38, -35, 4.6, 2.0),
    ('paving-day-30', 30, 165, 4.6, 2.0),
    ('wall-low-12', 12, -150, 4.5, 2.0),
    ('wall-overcast-34', 34, -35, 0.0, 6.0),
]
probes = []
for name, el, az, sun_w, sky_k in CASES:
    azr = math.radians(az)
    toward = Vector((math.cos(azr), math.sin(azr), 0))
    side = Vector((-math.sin(azr), math.cos(azr), 0))
    orientations = {
        'up': (0, 0, 1), 'down': (0, 0, -1),
        'sunward': tuple(toward), 'antisun': tuple(-toward),
        'side-left': tuple(side), 'side-right': tuple(-side),
        'tilt-sunward': tuple((toward + Vector((0, 0, 1))).normalized()),
        'tilt-antisun': tuple((-toward + Vector((0, 0, 1))).normalized()),
    }
    for oname, normal in orientations.items():
        aim_probe(normal)
        bg.inputs['Strength'].default_value = 0.0
        set_sun(el, az, sun_w)
        sun_only = render_linear(f'{name}-{oname}-sun') if sun_w > 0 else [0.0, 0.0, 0.0]
        bg.inputs['Strength'].default_value = sky_k
        s = set_sun(el, az, 0.0)
        sky_only = render_linear(f'{name}-{oname}-sky')
        probes.append(dict(case=name, elevationDeg=el, azimuthDeg=az, sunWm2=sun_w, skyStrength=sky_k,
                           orientation=oname, normal=[float(v) for v in normal], toSun=[float(v) for v in s],
                           sunOnlyRadiance=sun_only, skyOnlyRadiance=sky_only))
        print(name, oname, [round(v, 4) for v in sun_only], [round(v, 4) for v in sky_only], flush=True)

# Sky-dome sweep for the model fit: sky-only probes at 13 normals (sun frame: up, down, 4
# horizontal, 4 tilted up, 2 tilted down, and a sunward-side diagonal) over sun elevations 3-80
# degrees. The ground bounce is exact analytically ((1 - n.y) / 2 of the ground's radiance), so the
# fit subtracts it; the sun's direct term is the renderer's own.
sweep = []
if A.sweep:
    for el in (3, 8, 12, 20, 30, 38, 50, 65, 80):
        az = 0.0
        t = Vector((1, 0, 0))
        sd = Vector((0, 1, 0))
        up = Vector((0, 0, 1))
        normals = {
            'up': up, 'down': -up, 'sunward': t, 'antisun': -t, 'side': sd, 'side2': -sd,
            'tilt-sunward': (t + up).normalized(), 'tilt-antisun': (-t + up).normalized(),
            'tilt-side': (sd + up).normalized(), 'tilt-diag': (t + sd + up).normalized(),
            'down-sunward': (t - up).normalized(), 'down-antisun': (-t - up).normalized(),
            'diag': (t + sd).normalized(),
        }
        bg.inputs['Strength'].default_value = 2.0
        s_vec = set_sun(el, az, 0.0)
        for oname, n in normals.items():
            aim_probe(tuple(n))
            sweep.append(dict(elevationDeg=el, orientation=oname, normal=[float(v) for v in n],
                              toSun=[float(v) for v in s_vec], skyOnlyRadiance=render_linear(f'sweep-{el}-{oname}')))
        print('sweep', el, flush=True)

# Tone map on coloured emission patches (linear Rec.709), at three exposures each.
probe.visible_shadow = True
ground.hide_render = True
bg.inputs['Strength'].default_value = 0.0
set_sun(30, 165, 0.0)
emit, em = material('Emit', (1, 1, 1), emission=True)
probe.data.materials[0] = emit
aim_probe((0, 0, 1))
scene.cycles.samples = 4
PATCHES = {
    'grey': (0.18, 0.18, 0.18),
    'plaster': (0.62, 0.50, 0.33),
    'oak': (0.09, 0.055, 0.03),
    'stone': (0.45, 0.38, 0.27),
    'sky-blue': (0.2, 0.35, 0.6),
    'grass': (0.12, 0.2, 0.05),
    'red': (0.6, 0.05, 0.03),
    'green': (0.05, 0.5, 0.05),
    'blue': (0.04, 0.06, 0.6),
}
tone = []
for pname, col in PATCHES.items():
    for scale in (0.35, 1.0, 2.5):
        em.inputs['Color'].default_value = (*[c * scale for c in col], 1)
        em.inputs['Strength'].default_value = 1.0
        scene.view_settings.view_transform = 'AgX'
        for look in ('AgX - High Contrast', 'High Contrast'):
            try:
                scene.view_settings.look = look
                break
            except Exception:
                pass
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_depth = '16'
        path = os.path.join(OUT, 'agx.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = 'Non-Color'
        px = np.array(img.pixels[:], dtype=np.float64).reshape(-1, 4)[:, :3]
        bpy.data.images.remove(img)
        os.remove(path)
        tone.append(dict(patch=pname, linear=[c * scale for c in col], display=[float(v) for v in px.mean(axis=0)]))

# A dense AgX grid in one render: 5 levels per channel at three exposures, one emission quad per
# colour on a 25 x 15 lattice seen by an orthographic camera.
grid = []
if A.agx_grid:
    levels = (0.01, 0.05, 0.15, 0.4, 1.0)
    colours = [(r, g, b) for r in levels for g in levels for b in levels]
    cells = [(c, k) for k in (0.3, 1.0, 3.0) for c in colours]
    for ob in list(scene.objects):
        if ob.type == 'MESH':
            ob.hide_render = True
    cols, rows = 25, 15
    for i, (c, k) in enumerate(cells):
        mat, node = material('g%d' % i, tuple(v * k for v in c), emission=True)
        bpy.ops.mesh.primitive_plane_add(size=0.9, location=(i % cols, -(i // cols), 0))
        bpy.context.active_object.data.materials.append(mat)
    cam.location = ((cols - 1) / 2, -(rows - 1) / 2, 5)
    cam.rotation_euler = (0, 0, 0)
    cam_d.ortho_scale = cols
    cam_d.clip_end = 10
    scene.render.resolution_x, scene.render.resolution_y = cols * 16, rows * 16
    scene.view_settings.view_transform = 'AgX'
    for look in ('AgX - High Contrast', 'High Contrast'):
        try:
            scene.view_settings.look = look
            break
        except Exception:
            pass
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_depth = '16'
    path = os.path.join(OUT, 'agx-grid.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float64).reshape(H, W, 4)[::-1, :, :3]
    bpy.data.images.remove(img)
    for i, (c, k) in enumerate(cells):
        cx, cy = (i % cols) * 16 + 8, (i // cols) * 16 + 8
        grid.append(dict(linear=[v * k for v in c], display=[float(v) for v in px[cy - 3:cy + 3, cx - 3:cx + 3].mean((0, 1))]))

json.dump(dict(blender=bpy.app.version_string, groundAlbedo=GROUND_ALBEDO,
               method='Cycles CPU; white Lambert probe 1.5 m over the paving-albedo ground; radiance = E / pi',
               probes=probes, sweep=sweep, agxHighContrast=tone, agxGrid=grid),
          open(os.path.join(OUT, 'calibration.json'), 'w', encoding='utf-8'), indent=1)
print('CALIBRATE_DONE', flush=True)
