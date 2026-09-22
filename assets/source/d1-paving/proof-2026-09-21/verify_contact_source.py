"""Verify the recovered Blender save by reopening and rendering its stored camera."""
import ast
import bpy
import hashlib
import json
import numpy as np
from pathlib import Path
from datetime import datetime, timezone

out = Path(__file__).parent / 'family-contact1'
scene = bpy.context.scene
assert all(scene.objects.get('Family ' + n) for n in 'ABC')
assert scene.objects.get('Embedded mixed aggregate')
used_images = {node.image for o in scene.objects if o.type == 'MESH'
               for slot in o.material_slots if slot.material and slot.material.use_nodes
               for node in slot.material.node_tree.nodes
               if node.type == 'TEX_IMAGE' and node.image}
missing = [im.name for im in used_images if im.source == 'FILE' and not im.packed_file]
external_images = [{'name': im.name, 'path': bpy.path.abspath(im.filepath),
                    'loaded': bool(im.has_data),
                    'exists': Path(bpy.path.abspath(im.filepath)).is_file()}
                   for im in used_images if im.name in missing]
scene.render.filepath = str(out / 'reopened-joint-detail.png')
bpy.ops.render.render(write_still=True)
def pixels(name):
    im = bpy.data.images.load(str(out / name), check_existing=False)
    values = np.empty(len(im.pixels), dtype=np.float32)
    im.pixels.foreach_get(values)
    return values
delta = np.abs(pixels('joint-detail.png') - pixels('reopened-joint-detail.png'))
# Cycles' reopened render can differ slightly; report measured deltas, not a
# bit-identical or automatic artistic-pass claim. Inspect both actual captures.
views = next(ast.literal_eval(n.value) for n in ast.parse((out/'resolved.py').read_text()).body
             if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'views' for t in n.targets))
receipt = {
    'verifiedUtc': datetime.now(timezone.utc).isoformat(),
    'baseline': 'family/candidate2 plus contact-cycle3 recipe',
    'saveRecovery': 'Blender wrote source.blend@ but failed final rename; copied unchanged to source.blend and verified in a fresh process.',
    'sourceReopened': True, 'usedMaterialFileImagesPacked': not missing,
    'externalImages': external_images,
    'reopenedRenderDeltaMean': float(delta.mean()), 'reopenedRenderDeltaMax': float(delta.max()),
    'reopenedRenderDeltaP99': float(np.quantile(delta, .99)),
    'views': views, 'soilNominalHeightM': .068,
    'meshTriangles': {o.name: sum(len(p.vertices)-2 for p in o.data.polygons)
                      for o in scene.objects if o.type == 'MESH'},
    'sourceOnly': True, 'runtimeQA': False, 'rightsReviewed': False,
    'files': [{'name': f.name, 'bytes': f.stat().st_size, 'sha256': hashlib.sha256(f.read_bytes()).hexdigest()}
              for f in sorted(out.iterdir()) if f.suffix in {'.png', '.blend'}]
}
(out/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
print(json.dumps({k:v for k,v in receipt.items() if k not in {'files','views'}}))
