"""Export the accepted source as a bounded runtime candidate; QA owns admission."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--input', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = args.output.resolve()
output.relative_to((ROOT / 'harness/results').resolve())
output.mkdir(parents=True, exist_ok=True)
if bpy.app.version != (5, 1, 2):
    raise RuntimeError('Requires Blender 5.1.2')
provenance = json.loads((Path(__file__).parent / 'provenance.json').read_text())
for entry in provenance['maps']:
    if hashlib.sha256((args.input / entry['file']).read_bytes()).hexdigest() != entry['sha256']:
        raise RuntimeError('Source map hash mismatch: ' + entry['file'])
bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
height_image = bpy.data.images.load(str(args.input.resolve() / 'stone_pathway_02_disp_4k.png'), check_existing=False)
height_image.colorspace_settings.name = 'Non-Color'
height_pixels = np.empty(4096 * 4096 * 4, dtype=np.float32)
height_image.pixels.foreach_get(height_pixels)
height_pixels = height_pixels.reshape(4096, 4096, 4)[:, :, 0]
def sample_height(u, v):
    x, y = u * 4096 - .5, v * 4096 - .5
    ix, iy = int(np.floor(x)), int(np.floor(y))
    fx, fy = x - ix, y - iy
    a = height_pixels[iy % 4096, ix % 4096] * (1-fx) + height_pixels[iy % 4096, (ix+1) % 4096] * fx
    b = height_pixels[(iy+1) % 4096, ix % 4096] * (1-fx) + height_pixels[(iy+1) % 4096, (ix+1) % 4096] * fx
    return .03 + (float(a * (1-fy) + b * fy) - .5) * .065

meshes = []
for lod, segments in enumerate((128, 64, 32)):
    vertices = [(2*x/segments-1, 2*y/segments-1, sample_height(x/segments, y/segments)) for y in range(segments+1) for x in range(segments+1)]
    faces = []
    for y in range(segments):
        for x in range(segments):
            a = y * (segments+1) + x
            faces.extend(((a, a+1, a+segments+2), (a, a+segments+2, a+segments+1)))
    mesh = bpy.data.meshes.new(f'd1-paving-stone-lod{lod}')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True
    uv = mesh.uv_layers.new(name='scan-2m')
    for loop in mesh.loops:
        p = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((p.x+1)/2, (p.y+1)/2)
    meshes.append((lod, 'stone', mesh, 0.0))
# The source leaf tips contain zero-area faces; export drops those explicitly.
plants = bpy.data.objects['living-joint-grass__SOURCE'].data
for lod in range(3):
    meshes.append((lod, 'grass', plants, .08))

mesh_reports = []
for lod, role, mesh, shift in meshes:
    mesh.calc_loop_triangles()
    if role == 'stone':
        mesh.calc_tangents(uvmap='scan-2m')
    attributes, indices, lookup = [], [], {}
    skipped = 0
    for tri_number, triangle in enumerate(mesh.loop_triangles):
        # Whole blades consist of 20 triangles; preserve complete silhouettes.
        if role == 'grass' and (tri_number // 20) % (1 << lod) != 0:
            continue
        points = [mesh.vertices[mesh.loops[l].vertex_index].co for l in triangle.loops]
        if (points[1]-points[0]).cross(points[2]-points[0]).length < 1e-12:
            skipped += 1
            continue
        for loop_index in triangle.loops:
            loop = mesh.loops[loop_index]
            vertex = mesh.vertices[loop.vertex_index]
            p, n = vertex.co, vertex.normal
            if role == 'stone':
                uv = mesh.uv_layers.active.data[loop_index].uv
                t = loop.tangent
                # glTF image origin is top-left; flip V and tangent handedness.
                values = (p.x, p.z-shift, -p.y, n.x, n.z, -n.y, uv.x, 1-uv.y, t.x, t.z, -t.y, -loop.bitangent_sign)
            else:
                values = (p.x, p.z-shift, -p.y, n.x, n.z, -n.y, 0., 0., 1., 0., 0., 1.)
            if values not in lookup:
                lookup[values] = len(attributes)
                attributes.append(values)
            indices.append(lookup[values])
    if role == 'grass':
        front_count = len(attributes)
        back = [tuple(list(v[:3]) + [-n for n in v[3:6]] + list(v[6:11]) + [-v[11]]) for v in attributes]
        attributes.extend(back)
        indices.extend([indices[i+j]+front_count for i in range(0, len(indices), 3) for j in (2, 1, 0)])
    a = np.asarray(attributes, dtype='<f4')
    i = np.asarray(indices, dtype='<u4')
    stem = f'lod{lod}-{role}'
    a.tofile(output / (stem + '.vertices'))
    i.tofile(output / (stem + '.indices'))
    mesh_reports.append({'lod': lod, 'role': role, 'stem': stem, 'vertices': len(a), 'triangles': len(i)//3, 'bounds': [a[:, :3].min(axis=0).tolist(), a[:, :3].max(axis=0).tolist()], 'removedZeroAreaTriangles': skipped})

# Preserve the accepted linear-space HSV adjustment, then encode glTF sRGB.
texture_reports = []
for role, source_role in [('baseColor', 'diffuse'), ('normal', 'normal_gl'), ('orm', 'roughness')]:
    entry = next(e for e in provenance['maps'] if e['role'] == source_role)
    image = bpy.data.images.load(str(args.input.resolve() / entry['file']), check_existing=False)
    image.colorspace_settings.name = 'sRGB' if role == 'baseColor' else 'Non-Color'
    dimension = 1024 if role == 'orm' else 2048
    image.scale(dimension, dimension)
    pixels = np.empty(dimension*dimension*4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(dimension, dimension, 4)[::-1].copy()
    if role == 'baseColor':
        rgb = pixels[:, :, :3]
        rgb[:] = (.72 * rgb + .28 * np.max(rgb, axis=2, keepdims=True)) * 2.4
        clipped = float(np.mean(rgb > 1.0))
    else:
        clipped = 0
    if role == 'orm':
        pixels[:, :, 1] = pixels[:, :, 0]
        pixels[:, :, 0] = 1
        pixels[:, :, 2] = 0
    pixels[:, :, 3] = 1
    levels = []
    size = dimension
    level = 0
    while True:
        encoded = pixels.copy()
        if role == 'baseColor':
            rgb = encoded[:, :, :3]
            rgb[:] = np.where(rgb <= .0031308, rgb*12.92, 1.055*np.maximum(rgb, 0)**(1/2.4)-.055)
        filename = f'{role}-{level}.rgba'
        np.rint(np.clip(encoded, 0, 1)*255).astype('u1').tofile(output / filename)
        levels.append({'file': filename, 'width': size, 'height': size})
        if size == 1:
            break
        pixels = pixels.reshape(size//2, 2, size//2, 2, 4).mean(axis=(1, 3))
        if role == 'normal':
            xyz = pixels[:, :, :3]*2-1
            xyz /= np.maximum(np.linalg.norm(xyz, axis=2, keepdims=True), 1e-6)
            pixels[:, :, :3] = xyz*.5+.5
        size //= 2
        level += 1
    texture_reports.append({'role': role, 'levels': levels, 'linearComponentsClippedFraction': clipped})
report = {'schemaVersion': 1, 'sourceBlendSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(), 'sourceProvenanceSha256': hashlib.sha256((Path(__file__).parent/'provenance.json').read_bytes()).hexdigest(), 'sourceWidthMetres': 2, 'upAxis': 'Y', 'normalStrength': .35, 'texelsPerMetre': 1024, 'meshes': mesh_reports, 'textures': texture_reports}
(output / 'export.json').write_text(json.dumps(report, indent=2)+'\n')
print('PAVING_EXPORT ' + json.dumps(report))
