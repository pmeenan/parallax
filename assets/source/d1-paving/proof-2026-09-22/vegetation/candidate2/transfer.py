"""Representative leaf/petiole standard GLB transfer, isolated neutral studio only."""
import bpy,json,time,hashlib,numpy as np,math
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).parent/'transfer';OUT.mkdir(exist_ok=True);START=time.perf_counter()
bpy.ops.wm.open_mainfile(filepath=str(OUT.parent/'source.blend'));source=bpy.context.scene
targets=[source.objects[n] for n in ['Broadleaf weed 0','Broadleaf weed 0 petioles']]
scene=bpy.data.scenes.new('Representative vegetation transfer');bpy.context.window.scene=scene
for ob in targets:scene.collection.objects.link(ob)
scene.world=source.world
coords=[Vector(v.co) for ob in targets for v in ob.data.vertices];center=sum(coords,Vector())/len(coords)
camera=bpy.data.objects.new('Transfer camera',bpy.data.cameras.new('Transfer camera'));scene.collection.objects.link(camera);scene.camera=camera
camera.location=center+Vector((.11,-.15,.17));camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=58
light=bpy.data.objects.new('Transfer light',bpy.data.lights.new('Transfer light','AREA'));scene.collection.objects.link(light);light.location=center+Vector((-.5,-.6,.8));light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=60;light.data.size=.3
bpy.ops.mesh.primitive_plane_add(size=20,location=(0,0,min(v.z for v in coords)+.002));ground=bpy.context.object;ground.name='Neutral support';mat=bpy.data.materials.new('Neutral support');mat.use_nodes=True;mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.07,.07,.07,1);mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;ground.data.materials.append(mat)
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=128;scene.cycles.use_denoising=True;scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.render.filepath=str(OUT/'native.png');bpy.ops.render.render(write_still=True)
for ob in scene.objects:ob.select_set(ob in targets)
bpy.context.view_layer.objects.active=targets[0]
export_start=time.perf_counter();bpy.ops.export_scene.gltf(filepath=str(OUT/'representative-weed.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_materials='EXPORT');export_seconds=time.perf_counter()-export_start
bpy.data.libraries.write(str(OUT/'native.blend'),{scene},fake_user=True,compress=True)
for ob in targets:scene.collection.objects.unlink(ob)
import_start=time.perf_counter();bpy.ops.import_scene.gltf(filepath=str(OUT/'representative-weed.glb'));import_seconds=time.perf_counter()-import_start
scene.render.filepath=str(OUT/'reimport.png');bpy.ops.render.render(write_still=True)
arrays=[]
for file in ['native.png','reimport.png']:
    im=bpy.data.images.load(str(OUT/file),check_existing=False);values=np.empty(im.size[0]*im.size[1]*4,np.float32);im.pixels.foreach_get(values);arrays.append(values.reshape(-1,4)[:,:3])
delta=np.abs(arrays[0]-arrays[1]);raw=(OUT/'representative-weed.glb').read_bytes();assert raw[:4]==b'glTF' and int.from_bytes(raw[8:12],'little')==len(raw)
g=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')]);triangles=sum(g['accessors'][p['indices']]['count']//3 for m in g['meshes'] for p in m['primitives'])
r={'seconds':time.perf_counter()-START,'exportSeconds':export_seconds,'importSeconds':import_seconds,'triangles':triangles,'meshes':len(g['meshes']),'materials':len(g['materials']),'textures':len(g.get('textures',[])),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'extensions':g.get('extensionsUsed',[]),'nativeReimportPixelDelta':{'mean':float(delta.mean()),'p99':float(np.percentile(delta,99)),'max':float(delta.max())},'scope':'Representative Blender transfer only; no runtime/QA/art acceptance','notChecked':['Full glTF validator','Engine roundtrip','Compression/LOD','Production4pixel texture-class conformance','Rights clearance'],'knownDifference':'Native2.5percent subsurface shader may not transfer into standard glTF; no material tuning done to hide differences','files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir())]}
(OUT/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
