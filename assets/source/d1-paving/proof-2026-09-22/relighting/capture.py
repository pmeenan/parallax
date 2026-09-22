"""Bounded moving-light diagnosis; no asset/material authoring changes."""
import bpy,numpy as np,json,hashlib,math,time
from pathlib import Path
from mathutils import Vector
from datetime import datetime,timezone
OUT=Path(__file__).parent
BASE=OUT.parent/'restored-family/source.blend'
START=time.perf_counter()
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.open_mainfile(filepath=str(BASE))
scene=bpy.context.scene;scene.name='Restored family relighting diagnostic'
def geometry(o):
    p=np.empty(len(o.data.vertices)*3,dtype=np.float32);o.data.vertices.foreach_get('co',p)
    return {'sha256':hashlib.sha256(p.tobytes()).hexdigest(),'transform':[list(row) for row in o.matrix_world]}
before={o.name:geometry(o) for o in scene.objects if o.type=='MESH'}
stones=[scene.objects['Family '+v] for v in 'ABC']
originals={o.name:o.data.materials[0] for o in stones}
controls={}
for ob in stones:
    m=originals[ob.name].copy();m.name='Diagnostic neutral base '+ob.name
    bs=m.node_tree.nodes.get('Principled BSDF');socket=bs.inputs['Base Color']
    for link in list(socket.links):m.node_tree.links.remove(link)
    socket.default_value=(.20,.20,.20,1)
    controls[ob.name]=m
camera=scene.camera;light=next(o for o in scene.objects if o.type=='LIGHT')
camera.data.dof.use_dof=False
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.cycles.samples=96;scene.cycles.device='GPU';scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
cameras=[('close',(.10,-.62,.47),(-.207,-.165,.065),50),('walking',(.05,-.4,1.7),(-.04,-.015,.065),52)]
center=Vector((-.207,-.165,.065));distance=1.5;elev=math.radians(30)
light.data.energy=145;light.data.size=.35
frames=[]
for camera_name,eye,target,lens in cameras:
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    for mode in ['full','gray']:
        for ob in stones:ob.data.materials[0]=originals[ob.name] if mode=='full' else controls[ob.name]
        for azimuth in (range(0,360,45) if mode=='full' else range(0,360,90)):
            angle=math.radians(azimuth)
            key=center+Vector((distance*math.cos(elev)*math.cos(angle),distance*math.cos(elev)*math.sin(angle),distance*math.sin(elev)))
            light.location=key;light.rotation_euler=(center-key).to_track_quat('-Z','Y').to_euler()
            file=OUT/f'{camera_name}-{mode}-{azimuth:03d}.png'
            scene.render.filepath=str(file);bpy.ops.render.render(write_still=True)
            frames.append({'file':file.name,'camera':camera_name,'mode':mode,'azimuthDegrees':azimuth,'lightPositionM':list(key),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'bytes':file.stat().st_size})
for ob in stones:ob.data.materials[0]=originals[ob.name]
after={o.name:geometry(o) for o in scene.objects if o.type=='MESH'}
assert before==after
camera.location=cameras[0][1];camera.rotation_euler=(Vector(cameras[0][2])-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=cameras[0][3]
for im in bpy.data.images:
    if im.source=='FILE' and im.has_data and not im.packed_file:im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'tool':bpy.app.version_string,'seconds':time.perf_counter()-START,'source':str(BASE),'sourceSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'outputSourceSha256':hashlib.sha256((OUT/'source.blend').read_bytes()).hexdigest(),'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cameras':[{'name':n,'eyeM':e,'targetM':t,'lensMM':l} for n,e,t,l in cameras],'light':{'orbitCenterM':list(center),'distanceM':distance,'elevationDegrees':30,'energyW':145,'areaSizeM':.35,'worldStrength':scene.world.node_tree.nodes['Background'].inputs[1].default_value},'grayControl':'Only stone Principled Base Color disconnected and set0.20linear neutral. Original bump/normal/roughness graphs preserved. Soil unchanged. Original material slots restored before source save.','geometryAndTransformsUnchanged':before==after,'geometry':before,'frames':frames,'scope':'Diagnostic only; no artistic modification/acceptance, intrinsic-albedo claim or runtime qualification','rightsReviewed':False}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
