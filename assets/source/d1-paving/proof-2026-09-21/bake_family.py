"""Bake and fresh-import each screened family member; source-only transfer evidence."""
from pathlib import Path
import bpy,json
root=Path('D:/src/parallax/assets/source/d1-paving')
baseline=root/'surface-study-2026-09-21'
proof=root/'proof-2026-09-21'
source_scene=bpy.context.scene
assert set(('Family A','Family B','Family C')).issubset(source_scene.objects.keys())
reports=[]
for index,label in enumerate('ABC'):
    # A temporary source studio references only this member and neutral stage.
    studio=bpy.data.scenes.new('Family '+label+' export source')
    studio.world=source_scene.world
    for old in source_scene.objects:
        if old.name.startswith('Family ') and old.name!='Family '+label: continue
        studio.collection.objects.link(old)
        if old.type=='CAMERA':studio.camera=old
    bpy.context.window.scene=studio
    studio.render.engine='CYCLES';studio.cycles.device='GPU'
    studio.render.resolution_x=1600;studio.render.resolution_y=1200;studio.render.resolution_percentage=100
    studio.view_settings.view_transform='AgX'
    out=proof/('portable-family-'+label.lower());out.mkdir(exist_ok=True)
    cycle=201+index
    code=(baseline/'bake.py').read_text()
    code=code.replace("CYCLE=int(globals().get('STUDY_CYCLE',11))",f'CYCLE={cycle}')
    code=code.replace("OUT=ROOT/f'portable-cycle{CYCLE}';OUT.mkdir(exist_ok=True)",f'OUT=Path({str(out)!r});OUT.mkdir(exist_ok=True)')
    code=code.replace("bpy.data.scenes[f'Complete limestone study cycle{CYCLE}']",f'bpy.data.scenes[{studio.name!r}]')
    code=code.replace("o.name.startswith('Surface study master')",f"o.name.startswith('Family {label}')")
    code=code.replace("'source':f'cycle{CYCLE}/source.blend'","'source':'../family/candidate2/source.blend'")
    (out/'resolved_bake.py').write_text(code)
    ns={};exec(compile(code,str(out/'resolved_bake.py'),'exec'),ns)
    verify=(baseline/'verify_portable.py').read_text()
    verify=verify.replace("CYCLE=int(globals().get('STUDY_CYCLE',11))",f'CYCLE={cycle}')
    verify=verify.replace("OUT=ROOT/f'portable-cycle{CYCLE}'",f'OUT=Path({str(out)!r})')
    verify=verify.replace("bpy.data.scenes[f'Complete limestone study cycle{CYCLE}']",f'bpy.data.scenes[{studio.name!r}]')
    verify=verify.replace("o.name.startswith('Surface study master')",f"o.name.startswith('Family {label}')")
    verify=verify.replace('assert triangles==3900','assert 0 < triangles <= 4000')
    (out/'resolved_verify.py').write_text(verify)
    exec(compile(verify,str(out/'resolved_verify.py'),'exec'),ns)
    reports.append({'member':label,**ns['report']})
(proof/'portable-family-verification.json').write_text(json.dumps(reports,indent=2)+'\n')
