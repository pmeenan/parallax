"""Give retained scene libraries normal standalone Blender startup state.

Run with a separate background Blender process, never in the live authoring session.
"""
import bpy
import json
import hashlib
import shutil
from pathlib import Path
from datetime import datetime, timezone

assert bpy.app.background, 'This packaging step must not reset the live session'
ROOT=Path('D:/src/parallax/assets/source/d1-paving/surface-study-2026-09-21')
SCRATCH=Path('C:/Users/patme/.codex/tmp/paving-study-2026-09-21-intermediates/standalone')
SCRATCH.mkdir(parents=True,exist_ok=True)
records=[]
for relative,receipt_name in [('cycle11/source.blend','captures.json'),('assembly-cycle11/source.blend','receipt.json'),('portable-cycle11/portable.blend','receipt.json')]:
    path=ROOT/relative;before=hashlib.sha256(path.read_bytes()).hexdigest()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with bpy.data.libraries.load(str(path),link=False) as (source,target):
        target.scenes=source.scenes
    assert len(target.scenes)==1
    scene=target.scenes[0];bpy.context.window.scene=scene
    for other in list(bpy.data.scenes):
        if other!=scene:bpy.data.scenes.remove(other)
    bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
    assert scene.camera and len(scene.objects)>=4
    assert all(im.packed_file for im in bpy.data.images if im.source=='FILE')
    bpy.context.preferences.filepaths.save_version=0
    assert scene.library is None and all(o.library is None for o in scene.objects)
    # Blender keeps an append-origin reference and refuses to overwrite that file
    # directly. Save standalone state outside the repository, then copy verified bytes.
    temporary=SCRATCH/(path.parent.name+'-'+path.name)
    assert path.resolve().is_relative_to(ROOT.resolve()) and temporary.resolve().is_relative_to(SCRATCH.resolve())
    bpy.ops.wm.save_as_mainfile(filepath=str(temporary),compress=True)
    shutil.copyfile(path,SCRATCH/('before-'+path.parent.name+'-'+path.name))
    shutil.copyfile(temporary,path)
    entry={'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}
    receipt_path=path.parent/receipt_name;receipt=json.loads(receipt_path.read_text())
    receipt['files']=[entry if f['name']==path.name else f for f in receipt['files']]
    receipt['standalonePackagingUtc']=datetime.now(timezone.utc).isoformat()
    receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
    records.append({'file':relative,'scene':scene.name,'beforeLibrarySha256':before,'standalone':entry})
(ROOT/'standalone-packaging.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps({'standaloneFiles':len(records),'result':'pass'}))
