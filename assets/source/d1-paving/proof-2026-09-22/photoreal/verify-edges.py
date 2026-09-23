"""Check translated source edges in Blender; no runtime or artistic acceptance.

blender -b --factory-startup --python-exit-code 1 --python verify-edges.py -- source.blend
The retained candidate1 is a negative control: its clamped displacement fails.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np

source = Path(sys.argv[sys.argv.index('--') + 1]).resolve(strict=True)
bpy.ops.wm.open_mainfile(filepath=str(source))
for image in bpy.data.images:
    if image.source == 'FILE' and not image.packed_file:
        if not Path(bpy.path.abspath(image.filepath)).is_file():
            raise RuntimeError(f'Missing source map: {image.filepath}')
ground = bpy.data.objects['PavingGround']
evaluated = ground.evaluated_get(bpy.context.evaluated_depsgraph_get())
mesh = evaluated.to_mesh()
results = []
try:
    co = np.empty((len(mesh.vertices), 3), np.float32)
    mesh.vertices.foreach_get('co', co.ravel())
    normals = np.empty_like(co)
    mesh.vertices.foreach_get('normal', normals.ravel())
    if not np.isfinite(co).all() or not np.isfinite(normals).all():
        raise RuntimeError('Non-finite evaluated geometry')
    for axis in (0, 1):
        # Subdivision moves nominal boundary coordinates by floating-point roundoff.
        low = np.flatnonzero(np.isclose(co[:, axis], 0, rtol=0, atol=1e-5))
        high = np.flatnonzero(np.isclose(co[:, axis], 4, rtol=0, atol=1e-5))
        low = low[np.argsort(co[low, 1 - axis])]
        high = high[np.argsort(co[high, 1 - axis])]
        if len(low) < 2 or len(low) != len(high):
            raise RuntimeError('Missing or mismatched opposite edges')
        if not np.allclose(co[low, 1 - axis], co[high, 1 - axis], rtol=0, atol=1e-5):
            raise RuntimeError('Opposite edge vertices do not align')
        gaps_mm = np.abs(co[low, 2] - co[high, 2]) * 1000
        angles = np.degrees(np.arccos(np.clip((normals[low] * normals[high]).sum(1), -1, 1)))
        results.append(dict(
            axis='xy'[axis], vertices=len(low), maximumGapMm=float(gaps_mm.max()),
            meanGapMm=float(gaps_mm.mean()), maximumNormalAngleDegrees=float(angles.max()),
            meanNormalAngleDegrees=float(angles.mean())))
finally:
    evaluated.to_mesh_clear()

# Five micrometres allows Blender's UV/subdivision sampling roundoff. This is a
# source-position regression check, not a new asset budget or a normal-seam waiver.
passed = all(row['maximumGapMm'] <= 0.005 for row in results)
print(json.dumps(dict(
    sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
    positionEdgesPassed=passed, positionToleranceMm=0.005, edges=results,
    limits=['Edge normals are diagnostic and still require delivery qualification',
            'No LOD, runtime, budget or artistic verdict']), indent=2), flush=True)
if not passed:
    raise RuntimeError('Translated paving tiles have open position seams')
