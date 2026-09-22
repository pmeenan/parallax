"""Second bounded layout diagnostic: continuous, injective XY surface warp."""

import bpy
import hashlib
import json
import math
import time
from pathlib import Path

from mathutils import Vector

START = time.perf_counter()
OUT = Path(__file__).parent
INPUT = OUT.parent / "candidate1" / "source.blend"
INPUT_RECEIPT = OUT.parent / "candidate1" / "receipt.json"
assert bpy.app.version[:3] == (5, 2, 1)
source_sha = hashlib.sha256(INPUT.read_bytes()).hexdigest()
prior = json.loads(INPUT_RECEIPT.read_text())
bpy.ops.wm.open_mainfile(filepath=str(INPUT))
scene = bpy.context.scene
scene.name = "Broken-joint surface-warp candidate2"


def material_digest():
    records = []
    for mat in sorted(bpy.data.materials, key=lambda m: m.name):
        records.append((mat.name, mat.diffuse_color[:]))
        if mat.use_nodes:
            for node in sorted(mat.node_tree.nodes, key=lambda n: n.name):
                records.append((mat.name, node.name, node.bl_idname))
                for socket in node.inputs:
                    if hasattr(socket, "default_value"):
                        records.append((socket.name, str(socket.default_value)))
            for link in mat.node_tree.links:
                records.append((link.from_node.name, link.from_socket.name, link.to_node.name, link.to_socket.name))
    return hashlib.sha256(repr(records).encode()).hexdigest()


material_before = material_digest()
frequency = math.tau


def warp(x, y):
    dx = 0.013 * math.sin(frequency * y / 0.72 + 0.3) + 0.0035 * math.sin(frequency * y / 0.23 + 1.1)
    dy = 0.012 * math.sin(frequency * x / 0.79 + 1.4) + 0.003 * math.sin(frequency * x / 0.27 + 0.6)
    return x + dx, y + dy


# Operator norm of the displacement Jacobian is at most max(|d(dx)/dy|,
# |d(dy)/dx|). It is <1, so this map is globally injective and cannot create
# a stone intersection from separated source geometry.
lipschitz = max(
    frequency * (0.013 / 0.72 + 0.0035 / 0.23),
    frequency * (0.012 / 0.79 + 0.003 / 0.27),
)
assert lipschitz < 0.25
vertex_count = 0
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    ob.data = ob.data.copy()  # Source pavers share three master mesh datablocks.
    world = ob.matrix_world.copy()
    inverse = world.inverted()
    for vertex in ob.data.vertices:
        p = world @ vertex.co
        nx, ny = warp(p.x, p.y)
        vertex.co = inverse @ Vector((nx, ny, p.z))
        assert all(math.isfinite(value) for value in vertex.co)
        vertex_count += 1
    ob.data.update()
assert material_digest() == material_before

camera = scene.camera
light = bpy.data.objects["Patch area light"]
view_records = prior["views"]
views = {view[0]: view for view in view_records}
scene.render.engine = "CYCLES"
scene.cycles.device = "GPU"
scene.cycles.samples = 96
scene.cycles.use_denoising = True
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.refresh_devices()
for device in prefs.devices:
    device.use = device.type == "OPTIX"
scene.render.resolution_x = 1800
scene.render.resolution_y = 1350
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"


def capture(name, override=None):
    _, eye, target, lens, key, energy, size, ambient = views[name]
    camera.location = eye
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = lens
    light.location = key
    light.rotation_euler = (Vector(target) - light.location).to_track_quat("-Z", "Y").to_euler()
    light.data.energy = energy
    light.data.size = size
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = ambient
    scene.view_layers[0].material_override = override
    scene.render.filepath = str(OUT / (name + ("-gray" if override else "") + ".png"))
    bpy.ops.render.render(write_still=True)
    scene.view_layers[0].material_override = None


for name in ("top-packing", "sunny-oblique", "opposing-light", "overcast", "walking"):
    capture(name)
gray = bpy.data.materials.new("Diagnostic neutral gray")
gray.diffuse_color = (0.18, 0.18, 0.18, 1)
gray.use_nodes = True
gray.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.18, 0.18, 1)
capture("top-packing", gray)
bpy.data.materials.remove(gray)
capture_name = "sunny-oblique"
_, eye, target, lens, key, energy, size, ambient = views[capture_name]
camera.location = eye
camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.lens = lens
light.location = key
light.rotation_euler = (Vector(target) - light.location).to_track_quat("-Z", "Y").to_euler()
light.data.energy = energy
light.data.size = size
scene.world.node_tree.nodes["Background"].inputs[1].default_value = ambient
assert material_digest() == material_before
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "source.blend"), compress=True)

triangles = sum(len(poly.vertices) - 2 for ob in scene.objects if ob.type == "MESH" for poly in ob.data.polygons)
receipt = {
    "blender": bpy.app.version_string,
    "source": str(INPUT),
    "sourceSha256": source_sha,
    "seconds": time.perf_counter() - START,
    "warp": {
        "dx": "0.013 sin(2πy/0.72 + 0.3) + 0.0035 sin(2πy/0.23 + 1.1)",
        "dy": "0.012 sin(2πx/0.79 + 1.4) + 0.003 sin(2πx/0.27 + 0.6)",
        "displacementLipschitzUpperBound": lipschitz,
        "priorConservativeStoneSeparationM": prior["minimumAABBClearanceM"],
        "postWarpSeparationLowerBoundM": (1 - lipschitz) * prior["minimumAABBClearanceM"],
    },
    "warpedVertices": vertex_count,
    "triangles": triangles,
    "stoneCount": prior["stoneCount"],
    "layoutLongestSeamCellsUnchanged": prior["layoutSeamScore"][1],
    "originalMaterialDigestUnchanged": material_before,
    "views": ["top-packing", "sunny-oblique", "opposing-light", "overcast", "walking", "top-packing-gray"],
    "sourceOnly": True,
    "rightsReviewed": False,
    "limitations": [
        "The warp changes seam shape, not stone adjacency or repeated mineral identities",
        "Plants remain provisional older layout-study plants; accepted color and moss are absent",
        "Conservative post-warp separation is an analytic lower bound, not a triangle-pair distance measurement",
        "No production LOD/compression, full QA, engine import or human artistic acceptance",
    ],
    "files": [
        {"name": p.name, "bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
        for p in sorted(OUT.iterdir()) if p.suffix in {".png", ".blend", ".py"}
    ],
}
(OUT / "receipt.json").write_bytes((json.dumps(receipt, indent=2) + "\n").encode("utf-8"))
