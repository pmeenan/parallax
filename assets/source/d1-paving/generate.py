"""Blender 5.1.2 stone pathway source model; never a library export."""

import argparse
import array
import hashlib
import json
import math
import random
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
    if tuple(image.size) != (4096, 4096):
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

material = bpy.data.materials.new("stone_pathway_02__SCANNED_COMPARISON")
material.use_nodes = True
tree = material.node_tree
shader = tree.nodes.get("Principled BSDF")
textures = {}
for role in ("diffuse", "normal_gl", "roughness"):
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = images[role]
    textures[role] = texture
# Lift scanned dark stone toward the brighter courtyard palette while retaining variation.
hue = tree.nodes.new("ShaderNodeHueSaturation")
hue.inputs["Saturation"].default_value = 0.72
hue.inputs["Value"].default_value = 2.4
tree.links.new(textures["diffuse"].outputs["Color"], hue.inputs["Color"])
tree.links.new(hue.outputs["Color"], shader.inputs["Base Color"])
tree.links.new(textures["roughness"].outputs["Color"], shader.inputs["Roughness"])
normal = tree.nodes.new("ShaderNodeNormalMap")
# Full-strength scanned normals plus displaced geometry would duplicate relief.
# This reduced normal strength is an explicit preview compromise, not a bake.
normal.inputs["Strength"].default_value = 0.35
tree.links.new(textures["normal_gl"].outputs["Color"], normal.inputs["Color"])
tree.links.new(normal.outputs["Normal"], shader.inputs["Normal"])

height_image = images["displacement"]
pixels = array.array("f", [0]) * (4096 * 4096 * 4)
height_image.pixels.foreach_get(pixels)


def height(u, v):
    # Bilinear sampling with periodic addressing matches the image sampler.
    x, y = u * 4096 - 0.5, v * 4096 - 0.5
    x0, y0 = int(x // 1), int(y // 1)
    fx, fy = x - x0, y - y0
    def sample(ix, iy):
        return pixels[((iy % 4096) * 4096 + ix % 4096) * 4]
    a = sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx
    b = sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx
    return 0.11 + ((a * (1 - fy) + b * fy) - 0.5) * 0.065


counts = {}
bounds = {}
for level, segments in enumerate((512, 128, 32)):
    collection = bpy.data.collections.new(f"scanned-source-LOD{level}__UNQUALIFIED")
    scene.collection.children.link(collection)
    vertices = [(2.0 * x / segments - 1.0, 2.0 * y / segments - 1.0,
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
    uv = mesh.uv_layers.new(name="full-scan-2.0m")
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop_index in polygon.loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = ((point.x + 1.0) / 2.0, (point.y + 1.0) / 2.0)
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

# Living plants are separate source geometry, rooted in sampled scan depressions.
# Prefer narrow joints bounded by a higher stone lip, never broad stone faces.
plant_rng = random.Random(0x51A45002)
plant_roots = []
for attempt in range(20000):
    u, v = plant_rng.uniform(0.04, 0.96), plant_rng.uniform(0.04, 0.96)
    z = height(u, v)
    neighbors = [height(u + du, v + dv) for du, dv in
                 ((0.014, 0), (-0.014, 0), (0, 0.014), (0, -0.014))]
    if z > 0.113 or max(neighbors) - z < 0.013:
        continue
    if any((u - a) ** 2 + (v - b) ** 2 < 0.055 ** 2 for a, b, _ in plant_roots):
        continue
    plant_roots.append((u, v, z))
    if len(plant_roots) == 26:
        break

leaf_material = bpy.data.materials.new("d1-living-joint-grass__SOURCE")
leaf_material.use_nodes = True
leaf_shader = leaf_material.node_tree.nodes.get("Principled BSDF")
leaf_shader.inputs["Base Color"].default_value = (0.055, 0.13, 0.018, 1)
leaf_shader.inputs["Roughness"].default_value = 0.76
leaf_shader.inputs["Subsurface Weight"].default_value = 0.12
leaf_shader.inputs["Subsurface Radius"].default_value = (0.01, 0.025, 0.008)
plant_vertices, plant_faces = [], []
for u, v, root_height in plant_roots:
    for blade in range(plant_rng.randint(6, 10)):
        theta = plant_rng.uniform(0, math.tau)
        dx, dy = math.cos(theta), math.sin(theta)
        length = plant_rng.uniform(0.028, 0.057)
        lean = plant_rng.uniform(0.3, 0.72)
        width = plant_rng.uniform(0.0016, 0.0032)
        root_x, root_y = 2 * u - 1, 2 * v - 1
        root_x += plant_rng.uniform(-0.003, 0.003)
        root_y += plant_rng.uniform(-0.003, 0.003)
        base = len(plant_vertices)
        for ring in range(6):
            t = ring / 5
            center_x = root_x + dx * length * lean * t ** 1.7
            center_y = root_y + dy * length * lean * t ** 1.7
            center_z = root_height - 0.004 + length * (t - 0.26 * t * t)
            half_width = width * (1 - t) * (0.35 + 0.65 * math.sin(math.pi * t))
            for side in (-1, 0, 1):
                plant_vertices.append((center_x - dy * half_width * side,
                                       center_y + dx * half_width * side,
                                       center_z + (0.0006 * (1-t) if side == 0 else 0)))
        for ring in range(5):
            a = base + ring * 3
            plant_faces.extend(((a, a+1, a+4, a+3), (a+1, a+2, a+5, a+4)))
plant_mesh = bpy.data.meshes.new("living-joint-grass")
plant_mesh.from_pydata(plant_vertices, [], plant_faces)
plant_mesh.update()
plants = bpy.data.objects.new("living-joint-grass__SOURCE", plant_mesh)
scene.collection.objects.link(plants)
plant_mesh.materials.append(leaf_material)
for polygon in plant_mesh.polygons:
    polygon.use_smooth = True

# Neutral ground and lower support are presentation furniture, not exported assets.
rig = bpy.data.collections.new("PREVIEW_RIG_NOT_ASSET")
scene.collection.children.link(rig)


def move_to_rig(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    rig.objects.link(obj)


bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0.06))
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
bpy.ops.object.camera_add(location=(1.65, -2.0, 1.45))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 0.06)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "PERSP"
camera.data.lens = 48
scene.camera = camera
move_to_rig(camera)

metadata = {
    "status": "scanned-source-comparison-only-not-QA-admitted",
    "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "provenanceSha256": hashlib.sha256((Path(__file__).parent / "provenance.json").read_bytes()).hexdigest(),
    "blender": bpy.app.version_string,
    "materialIdentity": "Poly Haven stone_pathway_02, brightened source candidate",
    "sourceUpAxis": "Z",
    "diffuseAdjustment": {"hsvValue": 2.4, "saturation": 0.72},
    "sourceWidthMetres": 2.0,
    "uvCoverage": [0, 1],
    "displacementPeakToPeakScaleMetres": 0.065,
    "normalStrength": 0.35,
    "sourceTriangles": counts,
    "livingPlants": {"clumps": len(plant_roots), "triangles": 2 * len(plant_faces),
                     "seed": 0x51A45002, "rootsUvAndHeightMetres": plant_roots,
                     "bladeLengthMetres": [0.028, 0.057], "rootEmbedMetres": 0.004},
    "measuredBoundsMetresZUp": bounds,
    "constructionSeconds": time.perf_counter() - STARTED,
    "notReady": ["preview uses a complete 2m scan; modular seam quality remains unverified",
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
