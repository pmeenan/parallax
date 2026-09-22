"""Single bounded restored-family transfer; neutral isolated studios only."""
from pathlib import Path
import bpy,json,time,hashlib
from mathutils import Vector
OUT=Path(__file__).parent
BASE=OUT.parent/'restored-family/source.blend'
BASELINE=OUT.parents[1]/'surface-study-2026-09-21'
START=time.perf_counter()
assert bpy.app.version[:3]==(5,2,1)
source_hash=hashlib.sha256(BASE.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(BASE))
source_scene=bpy.context.scene
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
reports=[]
for index,label in enumerate('ABC'):
    member_started=time.perf_counter()
    stone=source_scene.objects['Family '+label]
    studio=bpy.data.scenes.new('Restored '+label+' transfer source')
    bpy.context.window.scene=studio
    studio.collection.objects.link(stone)
    studio.world=bpy.data.worlds.new('Neutral transfer world '+label);studio.world.use_nodes=True
    studio.world.node_tree.nodes['Background'].inputs[0].default_value=(.35,.35,.35,1)
    studio.world.node_tree.nodes['Background'].inputs[1].default_value=.3
    target=stone.location+Vector((0,0,.04))
    camera=bpy.data.objects.new('Transfer camera '+label,bpy.data.cameras.new('Transfer camera '+label));studio.collection.objects.link(camera)
    camera.location=target+Vector((.52,-.68,.67));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=52;camera.data.dof.use_dof=False;studio.camera=camera
    light=bpy.data.objects.new('Transfer key '+label,bpy.data.lights.new('Transfer key '+label,'AREA'));studio.collection.objects.link(light)
    light.location=target+Vector((-.7,-.8,1));light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=190;light.data.size=.65
    bottom=min((stone.matrix_world@Vector(p)).z for p in stone.bound_box)
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,bottom-.002));ground=bpy.context.object;ground.name='Neutral support '+label
    gm=bpy.data.materials.new('Neutral support material '+label);gm.use_nodes=True;gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.09,.09,.09,1);gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;ground.data.materials.append(gm)
    studio.render.engine='CYCLES';studio.cycles.device='GPU';studio.cycles.samples=128;studio.cycles.use_denoising=True
    studio.render.resolution_x=1600;studio.render.resolution_y=1200;studio.render.resolution_percentage=100;studio.view_settings.view_transform='AgX'
    assert len(studio.objects)==4
    out=OUT/label.lower();out.mkdir(exist_ok=True)
    studio.render.filepath=str(out/'high-source.png');bpy.ops.render.render(write_still=True)
    light.location=target+Vector((.7,.8,1));light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    studio.render.filepath=str(out/'high-source-opposing.png');bpy.ops.render.render(write_still=True)
    light.location=target+Vector((-.7,-.8,1));light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    cycle=301+index
    code=(BASELINE/'bake.py').read_text()
    code=code.replace("CYCLE=int(globals().get('STUDY_CYCLE',11))",f'CYCLE={cycle}')
    code=code.replace("OUT=ROOT/f'portable-cycle{CYCLE}';OUT.mkdir(exist_ok=True)",f'OUT=Path({str(out)!r});OUT.mkdir(exist_ok=True)')
    code=code.replace("bpy.data.scenes[f'Complete limestone study cycle{CYCLE}']",f'bpy.data.scenes[{studio.name!r}]')
    code=code.replace("o.name.startswith('Surface study master')",f"o.name.startswith('Family {label}')")
    code=code.replace("'source':f'cycle{CYCLE}/source.blend'","'source':'../../restored-family/source.blend'")
    (out/'resolved_bake.py').write_text(code)
    ns={};exec(compile(code,str(out/'resolved_bake.py'),'exec'),ns)
    verify=(BASELINE/'verify_portable.py').read_text()
    verify=verify.replace("CYCLE=int(globals().get('STUDY_CYCLE',11))",f'CYCLE={cycle}')
    verify=verify.replace("OUT=ROOT/f'portable-cycle{CYCLE}'",f'OUT=Path({str(out)!r})')
    verify=verify.replace("bpy.data.scenes[f'Complete limestone study cycle{CYCLE}']",f'bpy.data.scenes[{studio.name!r}]')
    verify=verify.replace("o.name.startswith('Surface study master')",f"o.name.startswith('Family {label}')")
    verify=verify.replace('assert triangles==3900','assert 0 < triangles <= 4000')
    verify=verify.replace("bpy.ops.import_scene.gltf(filepath=str(OUT/'limestone.glb'))","import time\nimport_started=time.perf_counter()\nbpy.ops.import_scene.gltf(filepath=str(OUT/'limestone.glb'))\nimport_seconds=time.perf_counter()-import_started")
    verify=verify.replace("'closedManifold':manifold", "'importSeconds':import_seconds,'closedManifold':manifold")
    (out/'resolved_verify.py').write_text(verify)
    exec(compile(verify,str(out/'resolved_verify.py'),'exec'),ns)
    imported_scene=bpy.context.scene
    key=next(o for o in imported_scene.objects if o.type=='LIGHT')
    key.location=target+Vector((.7,.8,1));key.rotation_euler=(target-key.location).to_track_quat('-Z','Y').to_euler()
    imported_scene.render.filepath=str(out/'reimport-opposing.png');bpy.ops.render.render(write_still=True)
    report=ns['report'];report.update({'member':label,'memberTotalSeconds':time.perf_counter()-member_started,'resource8MiBCeilingPassed':report['glbBytes']<=8*1024*1024,'rightsReviewed':False,'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.iterdir())]})
    (out/'verification.json').write_text(json.dumps(report,indent=2)+'\n');reports.append(report)
assert hashlib.sha256(BASE.read_bytes()).hexdigest()==source_hash
(OUT/'results.json').write_text(json.dumps({'source':str(BASE),'sourceSha256':source_hash,'sourceFileUnchanged':True,'tool':bpy.app.version_string,'totalSeconds':time.perf_counter()-START,'rightsReviewed':False,'scope':'Early source-only transfer; no library/engine/full QA acceptance. No compression, LOD or shared material conformance completed.','members':reports},indent=2)+'\n')
