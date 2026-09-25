# Lighting calibration against the approved paving source's Cycles lighting (engine package 4).
# blender -b --factory-startup --python calibrate.py -- --out <dir>
#
# 1. Irradiance: an unoccluded, horizontal white Lambert plane under the source's sun and
#    Hosek-Wilkie sky, each alone. Its linear radiance is E / pi, the value a Lambert
#    albedo-1 surface shows, so sun : sky ratios transfer directly to the game's lights.
# 2. Tone curve: emission patches of known linear radiance through AgX - High Contrast,
#    the source's view transform, read back as display-encoded 8-bit values.
import argparse, json, math, os, sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--samples', type=int, default=256)
A = ap.parse_args(argv)
A.out = os.path.abspath(A.out)
os.makedirs(A.out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = A.samples
scene.cycles.use_denoising = False
scene.cycles.seed = 7
scene.render.resolution_x = scene.render.resolution_y = 64
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

cam_d = bpy.data.cameras.new('Cam')
cam_d.type = 'ORTHO'
cam_d.ortho_scale = 1.0
cam = bpy.data.objects.new('Cam', cam_d)
cam.location = (0, 0, 1)
scene.collection.objects.link(cam)
scene.camera = cam

bpy.ops.mesh.primitive_plane_add(size=1.0)
plane = bpy.context.active_object
white = bpy.data.materials.new('White')
white.use_nodes = True
nodes = white.node_tree.nodes
for n in list(nodes):
    nodes.remove(n)
diffuse = nodes.new('ShaderNodeBsdfDiffuse')
diffuse.inputs['Color'].default_value = (1, 1, 1, 1)
diffuse.inputs['Roughness'].default_value = 0.0
out = nodes.new('ShaderNodeOutputMaterial')
white.node_tree.links.new(diffuse.outputs[0], out.inputs['Surface'])
plane.data.materials.append(white)


def set_sun(el, az, strength, color=(1.0, 0.88, 0.72)):
    el, az = math.radians(el), math.radians(az)
    s = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    sun.rotation_euler = (-s).to_track_quat('-Z', 'Y').to_euler()
    sun_d.energy = strength
    sun_d.color = color
    sky.sun_direction = s
    sun.hide_render = strength <= 0


def render_linear(name):
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    path = os.path.join(A.out, f'{name}.exr')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float64).reshape(-1, 4)[:, :3]
    bpy.data.images.remove(img)
    os.remove(path)
    return [float(v) for v in px.mean(axis=0)]


# The source's views: (name, elevation, azimuth, sun W/m^2, sky strength).
cases = [
    ('day-30', 30, 165, 4.6, 2.0),
    ('joint-28', 28, 170, 4.6, 2.0),
    ('grazing-12', 12, 20, 4.5, 2.0),
    ('overcast-34', 34, 165, 0.0, 6.0),
]
irradiance = []
for name, el, az, sun_w, sky_k in cases:
    bg.inputs['Strength'].default_value = 0.0
    set_sun(el, az, sun_w)
    sun_only = render_linear(f'{name}-sun') if sun_w > 0 else [0.0, 0.0, 0.0]
    bg.inputs['Strength'].default_value = sky_k
    set_sun(el, az, 0.0)
    sky.sun_direction = Vector((math.cos(math.radians(el)) * math.cos(math.radians(az)),
                                math.cos(math.radians(el)) * math.sin(math.radians(az)),
                                math.sin(math.radians(el))))
    sky_only = render_linear(f'{name}-sky')
    irradiance.append(dict(name=name, elevationDeg=el, azimuthDeg=az, sunWm2=sun_w,
                           skyStrength=sky_k, sunOnlyRadiance=sun_only,
                           skyOnlyRadiance=sky_only))

# Sky radiance seen directly (camera looking at the sky, no plane): zenith and horizon hue.
plane.hide_render = True
cam_d.type = 'PERSP'
cam_d.lens = 200
sky_samples = []
bg.inputs['Strength'].default_value = 2.0
set_sun(30, 165, 0.0)
sky.sun_direction = Vector((math.cos(math.radians(30)) * math.cos(math.radians(165)),
                            math.cos(math.radians(30)) * math.sin(math.radians(165)),
                            math.sin(math.radians(30))))
for name, direction in (('zenith', (0, 0, 1)), ('horizon-away', (1, 0, 0.08)),
                        ('horizon-sunward', (-0.97, 0.26, 0.08))):
    cam.location = (0, 0, 0)
    cam.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    sky_samples.append(dict(name=name, direction=direction, radiance=render_linear(f'sky-{name}')))
plane.hide_render = False
cam.location = (0, 0, 1)
cam.rotation_euler = (0, 0, 0)
cam_d.type = 'ORTHO'

# AgX - High Contrast tone curve on neutral emission patches.
emit = bpy.data.materials.new('Emit')
emit.use_nodes = True
en = emit.node_tree.nodes
for n in list(en):
    en.remove(n)
em = en.new('ShaderNodeEmission')
em.inputs['Color'].default_value = (1, 1, 1, 1)
eo = en.new('ShaderNodeOutputMaterial')
emit.node_tree.links.new(em.outputs[0], eo.inputs['Surface'])
plane.data.materials[0] = emit
bg.inputs['Strength'].default_value = 0.0
set_sun(30, 165, 0.0)
scene.cycles.samples = 4
curve = []
for stops in np.arange(-8, 6.01, 0.5):
    value = 0.18 * 2.0 ** float(stops)
    em.inputs['Strength'].default_value = value
    scene.view_settings.view_transform = 'AgX'
    for look in ('AgX - High Contrast', 'High Contrast'):
        try:
            scene.view_settings.look = look
            break
        except Exception:
            pass
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_depth = '16'
    path = os.path.join(A.out, 'agx.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    px = np.array(img.pixels[:], dtype=np.float64).reshape(-1, 4)[:, :3]
    bpy.data.images.remove(img)
    os.remove(path)
    curve.append(dict(linear=value, display=float(px.mean())))

receipt = dict(
    blender=bpy.app.version_string,
    method='Cycles CPU, white Lambert plane, orthographic top view; radiance = E / pi',
    irradiance=irradiance,
    skyRadiance=sky_samples,
    agxHighContrast=curve,
)
with open(os.path.join(A.out, 'calibration.json'), 'w') as f:
    json.dump(receipt, f, indent=2)
    f.write('\n')
print(json.dumps(receipt['irradiance'], indent=1))
