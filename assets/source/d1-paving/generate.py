"""Blender 5.1.2 scanned cobblestone source comparison; never a library export."""

import argparse
import array
import hashlib
import json
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector


STARTED = time.perf_counter()
ROOT = Path(__file__).resolve().parents[3]
RESULTS = (ROOT / "harness/results").resolve()
parser = argparse.ArgumentParser()
parser.add_argument("--input", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
output = args.output.resolve()
output.relative_to(RESULTS)
output.mkdir(parents=True, exist_ok=True)
if bpy.app.version != (5, 1, 2):
    raise RuntimeError(f"Requires Blender 5.1.2, got {bpy.app.version_string}")

provenance = json.loads((Path(__file__).parent / "provenance.json").read_text(encoding="utf-8"))
images = {}
for entry in provenance["maps"]:
    path = args.input.resolve() / entry["file"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
        raise RuntimeError(f"Input hash differs from reviewed source: {entry['file']}")
    image = bpy.data.images.load(str(path), check_existing=False)
    if tuple(image.size) != (2048, 2048):
        raise RuntimeError(f"Unexpected source dimensions: {entry['file']}")
    image.colorspace_settings.name = "sRGB" if entry["role"] == "diffuse" else "Non-Color"
    images[entry["role"]] = image

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.cycles.seed = 0x51A45001
scene.render.resolution_x = 1280
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
scene.world.color = (0.35, 0.40, 0.48)

material = bpy.data.materials.new("cobblestone_pavement__SCANNED_COMPARISON")
material.use_nodes = True
tree = material.node_tree
shader = tree.nodes.get("Principled BSDF")
textures = {}
for role in ("diffuse", "normal_gl", "roughness"):
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = images[role]
    textures[role] = texture
tree.links.new(textures["diffuse"].outputs["Color"], shader.inputs["Base Color"])
tree.links.new(textures["roughness"].outputs["Color"], shader.inputs["Roughness"])
normal = tree.nodes.new("ShaderNodeNormalMap")
# Full-strength scanned normals plus displaced geometry would duplicate relief.
# This reduced normal strength is an explicit preview compromise, not a bake.
normal.inputs["Strength"].default_value = 0.35
tree.links.new(textures["normal_gl"].outputs["Color"], normal.inputs["Color"])
tree.links.new(normal.outputs["Normal"], shader.inputs["Normal"])

height_image = images["displacement"]
pixels = array.array("f", [0]) * (2048 * 2048 * 4)
height_image.pixels.foreach_get(pixels)


def height(u, v):
    # Bilinear sampling with periodic addressing matches the image sampler.
    x, y = u * 2048 - 0.5, v * 2048 - 0.5
    x0, y0 = int(x // 1), int(y // 1)
    fx, fy = x - x0, y - y0
    def sample(ix, iy):
        return pixels[((iy % 2048) * 2048 + ix % 2048) * 4]
    a = sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx
    b = sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx
    return 0.11 + ((a * (1 - fy) + b * fy) - 0.5) * 0.015


counts = {}
bounds = {}
for level, segments in enumerate((192, 96, 24)):
    collection = bpy.data.collections.new(f"scanned-source-LOD{level}__UNQUALIFIED")
    scene.collection.children.link(collection)
    vertices = [(2.5 * x / segments - 1.25, 2.5 * y / segments - 1.25,
                 height(x / segments, y / segments))
                for y in range(segments + 1) for x in range(segments + 1)]
    faces = []
    for y in range(segments):
        for x in range(segments):
            a = y * (segments + 1) + x
            faces.append((a, a + 1, a + segments + 2, a + segments + 1))
    mesh = bpy.data.meshes.new(collection.name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="full-scan-2.5m")
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop_index in polygon.loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = ((point.x + 1.25) / 2.5, (point.y + 1.25) / 2.5)
    obj = bpy.data.objects.new(collection.name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    collection.hide_render = level != 0
    collection.hide_viewport = level != 0
    counts[collection.name] = len(faces) * 2
    bounds[collection.name] = {
        "min": [min(point[axis] for point in vertices) for axis in range(3)],
        "max": [max(point[axis] for point in vertices) for axis in range(3)],
    }

# Neutral ground and lower support are presentation furniture, not exported assets.
rig = bpy.data.collections.new("PREVIEW_RIG_NOT_ASSET")
scene.collection.children.link(rig)


def move_to_rig(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    rig.objects.link(obj)


bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0.095))
ground = bpy.context.object
ground.name = "preview-ground"
ground_material = bpy.data.materials.new("preview-neutral-ground")
ground_material.diffuse_color = (0.12, 0.13, 0.14, 1)
ground.data.materials.append(ground_material)
move_to_rig(ground)
bpy.ops.object.light_add(type="AREA", location=(-3, -4, 6))
light = bpy.context.object
light.data.energy = 1600
light.data.size = 1.8
light.rotation_euler = (Vector((0, 0, 0)) - light.location).to_track_quat("-Z", "Y").to_euler()
move_to_rig(light)
bpy.ops.object.camera_add(location=(2.6, -3.1, 3.6))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 0.06)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 4.25
scene.camera = camera
move_to_rig(camera)

metadata = {
    "status": "scanned-source-comparison-only-not-QA-admitted",
    "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "provenanceSha256": hashlib.sha256((Path(__file__).parent / "provenance.json").read_bytes()).hexdigest(),
    "blender": bpy.app.version_string,
    "materialIdentity": "Poly Haven cobblestone_pavement; not declared limestone",
    "sourceUpAxis": "Z",
    "sourceWidthMetres": 2.5,
    "uvCoverage": [0, 1],
    "displacementPeakToPeakScaleMetres": 0.015,
    "normalStrength": 0.35,
    "sourceTriangles": counts,
    "measuredBoundsMetresZUp": bounds,
    "constructionSeconds": time.perf_counter() - STARTED,
    "notReady": ["2.5m source scale differs from proposed 2m kit",
                 "dense source meshes exceed proposed kit budget",
                 "normal/displacement frequency separation not baked",
                 "no LOD or modular seam appearance qualification",
                 "no meshopt/KTX2 export or worker-loader roundtrip",
                 "no QA/library admission or human artistic acceptance"],
    "renders": [],
}
bpy.ops.wm.save_as_mainfile(filepath=str(output / "d1-scanned-source.blend"))
for view in ("sunny", "gloomy", "grazing"):
    if view == "gloomy":
        light.data.energy = 500
        light.data.size = 7
        light.data.color = (0.72, 0.82, 1.0)
        scene.world.color = (0.10, 0.13, 0.18)
    elif view == "grazing":
        light.data.energy = 1400
        light.data.size = 2
        light.data.color = (1, 0.95, 0.84)
        camera.location = (1.7, -1.9, 0.9)
        camera.rotation_euler = (Vector((0, 0, 0.1)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.ortho_scale = 2.4
    scene.render.filepath = str(output / f"paving-{view}.png")
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    metadata["renders"].append({"view": view, "seconds": time.perf_counter() - started})
metadata["elapsedSeconds"] = time.perf_counter() - STARTED
(output / "source-report.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
print("D1_SCANNED_SOURCE_REPORT " + json.dumps(metadata))
