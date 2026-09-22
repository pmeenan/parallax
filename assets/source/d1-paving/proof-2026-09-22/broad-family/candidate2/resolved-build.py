"""Physical-scale source family, isolated Blender 5.2.1; no library writes."""
from pathlib import Path
from datetime import datetime, timezone
import ast
import bpy
import bmesh
import numpy as np
import math
import time
import json
import hashlib
from mathutils import Vector

START = time.perf_counter()
ROOT = Path(__file__).parents[2]
PROOF = ROOT / 'proof-2026-09-22'
STUDY = ROOT / 'surface-study-2026-09-21'
OUT = Path(__file__).parent / 'candidate2'
OUT.mkdir(parents=True, exist_ok=True)
assert not (OUT / 'source.blend').exists(), 'Retained candidates are immutable'
(OUT/'resolved-build.py').write_text(RESOLVED_SOURCE)
assert bpy.app.version[:3] == (5, 2, 1)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = 'Broad physical limestone family candidate2'
scene.unit_settings.system = 'METRIC'

# Reuse only the accepted shape construction functions, at a fixed metric grid
# density. The broad source is constructed in metres, never enlarged afterwards.
recipe = ROOT / 'proof-2026-09-21/stone/candidate3/resolved_build.py'
tree = ast.parse(recipe.read_text())
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             and node.name in {'height_sample', 'hash3', 'noise', 'smoothstep',
                               'fields', 'mesh_object', 'make_stone', 'ramp'}]
code = ast.unparse(ast.Module(body=functions, type_ignores=[]))
assert 'counts = [int(640 * res), int(480 * res), int(112 * res)]' in code
code = code.replace('counts = [int(640 * res), int(480 * res), int(112 * res)]',
                    'counts = [math.ceil(2*hx/.002), math.ceil(2*hy/.002), 40]')
# Keep side batter in millimetres when constructing a larger stone. The old
# dimensionless percentage otherwise makes the broad face overhang its sidewall.
code = code.replace('p[:, axis] *= 1 - (0.025 + 0.07 * noise(p, 10, seed + 80 + axis)) * (1 - level)',
                    'p[:, axis] -= np.sign(p[:, axis]) * (.001 + .003 * noise(p, 10, seed + 80 + axis)) * (1-level)')
exec(compile(code, str(recipe), 'exec'))

original = STUDY / 'cycle11/source.blend'
with bpy.data.libraries.load(str(original), link=False) as (src, dst):
    dst.materials = [name for name in src.materials
                     if name.startswith('Original limestone correlated surface cycle11')]
assert len(dst.materials) == 1
template = dst.materials[0]
original_images = [node for node in template.node_tree.nodes if node.type == 'TEX_IMAGE']
HEIGHT = next(node.image for node in original_images if 'limestone-height-v1' in node.image.name)
MACRO = next(node.image for node in original_images if 'Authored mineral plateau' in node.image.name)

def pixels(image):
    values = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(values)
    return values.reshape(image.size[1], image.size[0], 4)

HEIGHT_PIXELS = pixels(HEIGHT)[:, :, 0].copy()
for _ in range(3):
    HEIGHT_PIXELS = (np.roll(HEIGHT_PIXELS, 1, 0) + 2*HEIGHT_PIXELS + np.roll(HEIGHT_PIXELS, -1, 0))/4
    HEIGHT_PIXELS = (np.roll(HEIGHT_PIXELS, 1, 1) + 2*HEIGHT_PIXELS + np.roll(HEIGHT_PIXELS, -1, 1))/4
HEIGHT_MACRO = pixels(MACRO)[:, :, 0]

"""Final-cycle metric limestone field; used by build2.py, not a standalone job."""
def stone_material(seed, texture_offset):
    mat = template.copy()
    mat.name = f'Broad limestone correlated field {seed}'
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bs = nodes.get('Principled BSDF')
    coord = next(node for node in nodes if node.type == 'TEX_COORD')
    mapping = next(node for node in nodes if node.type == 'VECT_MATH' and node.operation == 'MULTIPLY_ADD')
    seeded = nodes.new('ShaderNodeVectorMath')
    seeded.operation = 'ADD'
    seeded.inputs[1].default_value = ((seed % 997)*.017, (seed % 613)*.023, (seed % 379)*.031)
    links.new(coord.outputs['Object'], seeded.inputs[0])
    warp = nodes.new('ShaderNodeTexNoise')
    warp.inputs['Scale'].default_value = 5.5
    warp.inputs['Detail'].default_value = 2
    warp.inputs['Roughness'].default_value = .55
    links.new(seeded.outputs[0], warp.inputs['Vector'])
    displacement = nodes.new('ShaderNodeVectorMath')
    displacement.operation = 'MULTIPLY_ADD'
    displacement.inputs[1].default_value = (.11, .11, .04)
    displacement.inputs[2].default_value = (-.055, -.055, -.02)
    links.new(warp.outputs['Color'], displacement.inputs[0])
    warped = nodes.new('ShaderNodeVectorMath')
    warped.operation = 'ADD'
    links.new(coord.outputs['Object'], warped.inputs[0])
    links.new(displacement.outputs[0], warped.inputs[1])
    # A shared metric warp drives all three retained synthetic channels. It
    # changes local adjacency and mineral boundaries, not just their origin.
    links.new(warped.outputs[0], mapping.inputs[0])
    mapping.inputs[2].default_value = ((seed % 97)/97, (seed % 79)/79, .5-.04/.45)
    old_color = bs.inputs['Base Color'].links[0].from_socket
    broad = nodes.new('ShaderNodeTexNoise')
    broad.inputs['Scale'].default_value = 3.2
    broad.inputs['Detail'].default_value = 2.3
    broad.inputs['Roughness'].default_value = .65
    links.new(seeded.outputs[0], broad.inputs['Vector'])
    tint = nodes.new('ShaderNodeMapRange')
    tint.inputs['To Min'].default_value = .75
    tint.inputs['To Max'].default_value = 1.16
    links.new(broad.outputs['Fac'], tint.inputs['Value'])
    mult = nodes.new('ShaderNodeMixRGB')
    mult.blend_type = 'MULTIPLY'
    mult.inputs[0].default_value = 1
    links.new(old_color, mult.inputs[1])
    links.new(tint.outputs['Result'], mult.inputs[2])
    links.new(mult.outputs[0], bs.inputs['Base Color'])
    bump = next(node for node in nodes if node.type == 'BUMP')
    bump.inputs['Distance'].default_value = .00020
    bump.inputs['Strength'].default_value = .60
    return mat

specs = [
    ('A', 923101, 1.08, .72, (-.55, -.37, 0)),
    ('B', 923149, .76, .72, (.386, -.37, 0)),
    ('C', 923207, .90, .54, (-.64, .276, 0)),
    ('D', 923269, .94, .54, (.306, .276, 0)),
]
stones = []
for label, seed, width, depth, position in specs:
    stone = make_stone('Broad source '+label, seed=seed, hx=width/2, hy=depth/2, hz=.04)
    stone.location = position
    assert tuple(stone.scale) == (1, 1, 1)
    stone['physicalDimensionsNominalM'] = (width, depth, .08)
    stones.append(stone)
bpy.context.view_layer.update()

# Approved earth shader and existing 64 mm contact height, dense only for this
# source sample. New stone boundaries do not inherit the old sample topology.
contact = ROOT / 'proof-2026-09-21/family-contact2/source.blend'
with bpy.data.libraries.load(str(contact), link=False) as (src, dst):
    dst.materials = ['Compacted mixed earth contact1']
earth = dst.materials[0]
soil_recipe = ROOT / 'proof-2026-09-21/family-contact2/resolved.py'
soil_tree = ast.parse(soil_recipe.read_text())
exec(compile(ast.Module(body=[node for node in soil_tree.body if isinstance(node, ast.FunctionDef)
                              and node.name == 'field'], type_ignores=[]), str(soil_recipe), 'exec'))
rectangles = []
for stone in stones:
    points = np.array([stone.matrix_world @ Vector(corner) for corner in stone.bound_box])
    rectangles.append([*points.min(0)[:2], *points.max(0)[:2]])
rectangles = np.array(rectangles)
xx, yy = np.meshgrid(np.linspace(-1.25, .94, 438), np.linspace(-.86, .71, 314))
xy = np.column_stack((xx.ravel(), yy.ravel()))
distance = np.full(len(xy), np.inf)
for xmin, ymin, xmax, ymax in rectangles:
    dx = np.maximum(np.maximum(xmin-xy[:, 0], xy[:, 0]-xmax), 0)
    dy = np.maximum(np.maximum(ymin-xy[:, 1], xy[:, 1]-ymax), 0)
    inside = np.minimum.reduce([xy[:, 0]-xmin, xmax-xy[:, 0], xy[:, 1]-ymin, ymax-xy[:, 1]])
    distance = np.minimum(distance, np.where((dx == 0) & (dy == 0), abs(inside), np.hypot(dx, dy)))
z = .064 + .002*np.exp(-distance/.010)*(.55+.45*field(xy, 45, 121)) + .005*(field(xy, 29, 51)-.5) + .003*(field(xy, 150, 62)-.5) + .0014*(field(xy, 430, 77)-.5)
border = np.minimum.reduce([xy[:, 0]+1.25, .94-xy[:, 0], xy[:, 1]+.86, .71-xy[:, 1]])
edge_blend = smoothstep(0, .06, border)
z = .056*(1-edge_blend)+z*edge_blend
ids = np.arange(len(xy)).reshape(xx.shape)
faces = np.stack([ids[:-1, :-1], ids[:-1, 1:], ids[1:, 1:], ids[1:, :-1]], -1).reshape(-1, 4)
ground = mesh_object('Approved earth contact sample', np.column_stack((xy, z)).tolist(), faces.tolist())
ground.data.materials.append(earth)
for face in ground.data.polygons:
    face.use_smooth = True
base = mesh_object('Surrounding earth', [(-30, -30, .056), (30, -30, .056), (30, 30, .056), (-30, 30, .056)], [(0, 1, 2, 3)])
base.data.materials.append(earth)
camera = bpy.data.objects.new('Family camera', bpy.data.cameras.new('Family camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.clip_start = .01
light = bpy.data.objects.new('Patch area light', bpy.data.lights.new('Patch area light', 'AREA'))
scene.collection.objects.link(light)
scene.world = bpy.data.worlds.new('Patch world')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.45, .45, .45, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .22
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
for device in prefs.devices:
    device.use = device.type == 'OPTIX'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'

views = [
    ('oblique', (1.95, -2.65, 2.85), (-.17, -.06, .065), 52, (-3, -4, 6)),
    ('opposing-light', (1.95, -2.65, 2.85), (-.17, -.06, .065), 52, (3, 4, 6)),
    ('walking', (-.15, -1.05, 1.70), (-.15, .10, .065), 40, (-3, -4, 6)),
    ('reverse', (-2.05, 2.4, 2.6), (-.17, -.06, .065), 52, (-3, -4, 6)),
    ('grazing', (.05, -1.55, .32), (-.12, -.18, .071), 48, (-3, -4, 6)),
]
def view(item):
    name, eye, target, lens, key = item
    camera.location = eye
    camera.rotation_euler = (Vector(target)-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = lens
    light.location = key
    light.rotation_euler = (Vector(target)-light.location).to_track_quat('-Z', 'Y').to_euler()
    light.data.energy = 2200
    light.data.size = 1
    bpy.context.view_layer.update()
    scene.render.filepath = str(OUT / (name+'.png'))

build_seconds = time.perf_counter()-START
for item in views:
    view(item)
    bpy.ops.render.render(write_still=True)
view(views[0])
original_mats = [stone.data.materials[0] for stone in stones]
gray = bpy.data.materials.new('Geometry diagnostic')
gray.use_nodes = True
gray.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.28, .28, .28, 1)
gray.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .85
for stone in stones:
    stone.data.materials[0] = gray
scene.render.filepath = str(OUT / 'gray.png')
bpy.ops.render.render(write_still=True)
for stone, mat in zip(stones, original_mats):
    unlit = mat.copy()
    nodes, links = unlit.node_tree.nodes, unlit.node_tree.links
    color = nodes['Principled BSDF'].inputs['Base Color'].links[0].from_socket
    emission = nodes.new('ShaderNodeEmission')
    links.new(color, emission.inputs['Color'])
    links.new(emission.outputs[0], nodes['Material Output'].inputs['Surface'])
    stone.data.materials[0] = unlit
scene.render.filepath = str(OUT / 'unlit.png')
bpy.ops.render.render(write_still=True)
for stone, mat in zip(stones, original_mats):
    stone.data.materials[0] = mat
view(views[0])
for image in bpy.data.images:
    if image.has_data and not image.packed_file:
        image.pack()
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=False, do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'), compress=True)
def identity(path):
    return {'path': path.as_posix(), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
clearances = []
for i, a in enumerate(rectangles):
    for b in rectangles[:i]:
        clearances.append(math.hypot(max(a[0]-b[2], b[0]-a[2], 0), max(a[1]-b[3], b[1]-a[3], 0)))
assert min(clearances) > 0
receipt = {
    'createdUtc': datetime.now(timezone.utc).isoformat(), 'blender': bpy.app.version_string,
    'buildSeconds': build_seconds, 'totalSeconds': time.perf_counter()-START,
    'stones': [{'name': stone.name, 'seed': int(stone['seed']), 'dimensionsM': list(stone.dimensions),
                'scale': list(stone.scale), 'triangles': sum(len(p.vertices)-2 for p in stone.data.polygons)} for stone in stones],
    'minimumAABBClearanceM': min(clearances), 'views': views,
    'physicalScales': {'surfaceGridM': .002, 'oldFineDetailPeriodM': .45, 'metricWarpNoisePerMetre': 5.5, 'metricWarpRangeM': [.11, .11, .04], 'broadReflectanceNoisePerMetre': 3.2},
    'inputs': [identity(p) for p in [recipe, original, contact, soil_recipe,
        ROOT.parents[1]/'reference/concepts/batch-103/kit-001-paving-assembly-v1.png',
        ROOT.parents[1]/'reference/concepts/batch-108/mat-001-cream-limestone-v1.png',
        ROOT.parents[1]/'reference/concepts/batch-104/kit-002-stone-family-v4.png']],
    'outputs': [identity(p) for p in sorted(OUT.iterdir()) if p.suffix in {'.png', '.blend'}],
    'buildScript': identity(Path(__file__)), 'resolvedBuild': identity(OUT/'resolved-build.py'), 'materialRecipe': identity(Path(__file__).parent/'material2.py'), 'sourceOnly': True, 'rightsReviewed': False,
    'limitations': ['New material is provisional and needs visual selection', 'Microstructure still derives from synthetic inputs',
        'Four-piece source sample; no eight-variant library, LODs, compression or runtime result',
        'Conservative AABB clearance is not triangle-level contact proof', 'Accepted vegetation intentionally not copied into a material sample'],
}
(OUT / 'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
print(json.dumps({'output': str(OUT), 'seconds': receipt['totalSeconds'], 'stones': receipt['stones']}))
