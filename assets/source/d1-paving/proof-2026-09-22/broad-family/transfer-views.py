"""Matched walking/grazing transfer views; no source or GLB modification."""
from pathlib import Path
import bpy
import numpy as np
import json
import hashlib
import time
from mathutils import Vector

started = time.perf_counter()
root = Path(__file__).parent
folder = root/'transfer/a'
source = root/'candidate2/source.blend'
paths = [source, folder/'portable.blend', folder/'limestone.glb']
inputs = [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]
bpy.ops.wm.open_mainfile(filepath=str(folder/'portable.blend'))
scene = next(s for s in bpy.data.scenes if s.name == 'Portable limestone transfer proof cycle401')
bpy.context.window.scene = scene
low = next(o for o in scene.objects if o.name.startswith('Limestone portable LOD0'))
with bpy.data.libraries.load(str(source), link=False) as (src, dst):
    dst.objects = ['Broad source A']
high = dst.objects[0]
scene.collection.objects.link(high)
before = set(scene.objects)
bpy.ops.import_scene.gltf(filepath=str(folder/'limestone.glb'))
imported = [o for o in scene.objects if o not in before and o.type == 'MESH']
assert len(imported) == 1
groups = {'high': [high], 'low': [low], 'import': imported}
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.refresh_devices()
for d in prefs.devices:
    d.use = d.type == 'OPTIX'
scene.cycles.samples = 128
scene.cycles.device = 'GPU'
target = high.location + Vector((0, 0, .04))
camera = scene.camera
views = [('walking', (.15, -1.10, 1.65), 47), ('grazing', (1.25, -1.55, .20), 52)]
arrays = {}
outputs = []
for name, offset, lens in views:
    camera.location = target + Vector(offset)
    camera.rotation_euler = (target-camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = lens
    for label, visible in groups.items():
        for group in groups.values():
            for ob in group:
                ob.hide_render = ob not in visible
        path = folder/f'{name}-{label}.png'
        assert not path.exists()
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(str(path), check_existing=False)
        rgba = np.empty(image.size[0]*image.size[1]*4, np.float32)
        image.pixels.foreach_get(rgba)
        arrays[(name, label)] = rgba.reshape(-1, 4)[:, :3]
        outputs.append({'path': str(path), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
report = {
    'blender': bpy.app.version_string, 'seconds': time.perf_counter()-started,
    'views': views, 'inputs': inputs, 'outputs': outputs,
    'loadedPixelMeanAbsoluteDeltas': {name: {
        'sourceToReduced': float(np.abs(arrays[(name, 'high')]-arrays[(name, 'low')]).mean()),
        'reducedToImported': float(np.abs(arrays[(name, 'low')]-arrays[(name, 'import')]).mean()),
    } for name, _, _ in views},
    'limitation': 'Raster deltas include silhouette/shadow changes; no perceptual or performance verdict.',
}
assert all(hashlib.sha256(p.read_bytes()).hexdigest() == row['sha256'] for p, row in zip(paths, inputs))
(folder/'matched-views.json').write_text(json.dumps(report, indent=2)+'\n')
