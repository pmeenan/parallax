"""Matched LOD and serialized-KTX decode captures; records scoped image differences."""
import bpy, json, hashlib, sys
import numpy as np
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:]; root=Path(args[0]).resolve(); ktx=Path(args[1]).resolve()
out=root/'verification'; assert not out.exists(); out.mkdir()
views=json.loads((root.parent.parent/'cobble-study/candidate1/receipt.json').read_text())['views']
def open_scene():
    bpy.ops.wm.open_mainfile(filepath=str(root/'shared.blend'))
    prefs=bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type='OPTIX'; prefs.refresh_devices()
    for d in prefs.devices:d.use=d.type=='OPTIX'
    scene=bpy.context.scene; scene.cycles.device='GPU'; scene.cycles.samples=64
    return scene
def capture(scene,name,state):
    _,eye,target,lens,key,energy,size,ambient=state
    camera=scene.camera;light=scene.objects['Patch area light']
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
    scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
for lod in [1,2]:
    state=list(views[0]);state[1]=[v*(2 if lod==1 else 4) for v in state[1]]
    scene=open_scene();capture(scene,f'lod0-at-{lod}',state)
    for ob in list(scene.objects):
        if ob.type=='MESH' and not ob.get('excludeFromRuntime'):bpy.data.objects.remove(ob,do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=str(root/f'lod{lod}.glb'));capture(scene,f'lod{lod}-import',state)
scene=open_scene()
receipt=json.loads((ktx/'receipt.json').read_text())
for record in receipt['maps']:
    raw=(ktx/(record['name']+'.rgba')).read_bytes();assert hashlib.sha256(raw).hexdigest()==record['decodedSha256']
    im=bpy.data.images[record['name']];im.pixels.foreach_set(np.frombuffer(raw,np.uint8).astype(np.float32)/255);im.update()
for idx in [3,5,6]:capture(scene,'ktx-'+views[idx][0],views[idx])
def arr(path):
    im=bpy.data.images.load(str(path),check_existing=False);v=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(v);bpy.data.images.remove(im);return v.reshape(-1,4)[:,:3]
comparisons=[]
for label,a,b in [('shared-vs-control-'+name,root/('control-'+name+'.png'),root/('shared-'+name+'.png')) for name in ['walking','plant-contact','moss-contact','grazing']]+[('reimport-'+name,root/('shared-'+name+'.png'),root/('reimport-'+name+'.png')) for name in ['walking','plant-contact','moss-contact','grazing']]+[('ktx-'+name,root/('shared-'+name+'.png'),out/('ktx-'+name+'.png')) for name in ['walking','plant-contact','moss-contact']]+[(f'lod{lod}',out/f'lod0-at-{lod}.png',out/f'lod{lod}-import.png') for lod in [1,2]]:
    d=np.abs(arr(a)-arr(b));comparisons.append({'label':label,'meanLoadedRgbDifference':float(d.mean()),'p99':float(np.quantile(d,.99)),'maximum':float(d.max())})
(out/'receipt.json').write_text(json.dumps({'scope':'Blender captures only; no GPU BC7, moving LOD or engine evidence','comparisons':comparisons},indent=2)+'\n')
