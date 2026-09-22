"""Separate native/export/fresh-import comparison for reduced plants and grit."""
import bpy, json, hashlib, time, sys
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).parent
candidate=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'candidate3'
SOURCE=ROOT/candidate;OUT=SOURCE/'transfer'
assert not OUT.exists(), 'Preserve transfer evidence'
OUT.mkdir()
START=time.perf_counter()
reports=[]
for subject,names,color,offset in [
    ('leaf',['Broadleaf weed 0','Broadleaf weed 0 petioles'],'LeafAgeTint',(.11,-.15,.17)),
    ('moss',['Leafy moss colony 0'],'MossColor',(.025,-.035,.045)),
    ('grit',['Sparse embedded aggregate'],None,(.045,-.055,.095))]:
    dest=OUT/subject;dest.mkdir()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'source.blend'));source=bpy.context.scene
    targets=[source.objects[n] for n in names]
    scene=bpy.data.scenes.new('Reduced '+subject+' transfer');bpy.context.window.scene=scene
    for ob in targets:scene.collection.objects.link(ob)
    scene.world=source.world
    coords=[ob.matrix_world@v.co for ob in targets for v in ob.data.vertices]
    if subject=='grit':
        r=json.loads((ROOT.parent/'cobble-study/candidate1/receipt.json').read_text())
        center=Vector(r['views'][6][2])
    else:center=sum(coords,Vector())/len(coords)
    camera=bpy.data.objects.new('Transfer camera',bpy.data.cameras.new('Transfer camera'));scene.collection.objects.link(camera);scene.camera=camera
    camera.location=center+Vector(offset);camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=58;camera.data.clip_start=.001
    light=bpy.data.objects.new('Transfer light',bpy.data.lights.new('Transfer light','AREA'));scene.collection.objects.link(light)
    light.location=center+Vector((-.5,-.6,.8));light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=60;light.data.size=.3
    floor=min(v.z for v in coords)-.0002
    bpy.ops.mesh.primitive_plane_add(size=20,location=(0,0,floor));ground=bpy.context.object;ground.name='Neutral transfer floor'
    mat=bpy.data.materials.new('Neutral transfer floor');mat.use_nodes=True;mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.07,.07,.07,1);mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;ground.data.materials.append(mat)
    scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=96;scene.cycles.use_denoising=True
    scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
    for d in prefs.devices:d.use=d.type=='OPTIX'
    scene.render.filepath=str(dest/'native.png');bpy.ops.render.render(write_still=True)
    for ob in scene.objects:ob.select_set(ob in targets)
    bpy.context.view_layer.objects.active=targets[0]
    args={'filepath':str(dest/'representative.glb'),'export_format':'GLB','use_selection':True,'use_active_scene':True,
        'export_materials':'EXPORT','export_all_vertex_colors':False}
    if color:args.update(export_vertex_color='NAME',export_vertex_color_name=color)
    else:args['export_vertex_color']='NONE'
    export_start=time.perf_counter();bpy.ops.export_scene.gltf(**args);export_seconds=time.perf_counter()-export_start
    bpy.data.libraries.write(str(dest/'native.blend'),{scene},fake_user=True,compress=True)
    for ob in targets:scene.collection.objects.unlink(ob)
    import_start=time.perf_counter();bpy.ops.import_scene.gltf(filepath=str(dest/'representative.glb'));import_seconds=time.perf_counter()-import_start
    scene.render.filepath=str(dest/'reimport.png');bpy.ops.render.render(write_still=True)
    arrays=[]
    for file in ['native.png','reimport.png']:
        im=bpy.data.images.load(str(dest/file),check_existing=False);values=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(values);arrays.append(values.reshape(-1,4)[:,:3])
    delta=np.abs(arrays[0]-arrays[1]);raw=(dest/'representative.glb').read_bytes()
    assert raw[:4]==b'glTF' and int.from_bytes(raw[8:12],'little')==len(raw)
    g=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')])
    triangles=sum(g['accessors'][p['indices']]['count']//3 for m in g['meshes'] for p in m['primitives'])
    if color:assert any('COLOR_0' in p['attributes'] for m in g['meshes'] for p in m['primitives'])
    r={'subject':subject,'sourceSha256':hashlib.sha256((SOURCE/'source.blend').read_bytes()).hexdigest(),
        'triangles':triangles,'meshes':len(g['meshes']),'materials':len(g['materials']),'textures':len(g.get('textures',[])),
        'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'exportSeconds':export_seconds,'importSeconds':import_seconds,
        'pixelDelta':{'mean':float(delta.mean()),'p99':float(np.quantile(delta,.99)),'maximum':float(delta.max())},
        'scope':'Representative standard GLB / fresh Blender import only; neutral floor is not rooting evidence',
        'notQualified':['Runtime material sharing','Current class budgets','Compression and LODs','Engine loader','Rights','Library admission'],
        'knownDifference':'Native leaf 2.5% subsurface is not represented by standard glTF' if subject=='leaf' else None,
        'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(dest.iterdir())]}
    (dest/'receipt.json').write_text(json.dumps(r,indent=2)+'\n');reports.append(r)
(OUT/'summary.json').write_text(json.dumps({'seconds':time.perf_counter()-START,'subjects':reports},indent=2)+'\n')
print('TRANSFER_READY',json.dumps([{'subject':r['subject'],'triangles':r['triangles'],'bytes':r['bytes'],'delta':r['pixelDelta']} for r in reports]))
