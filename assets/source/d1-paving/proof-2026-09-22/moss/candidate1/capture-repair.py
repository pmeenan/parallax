"""Fix diagnostic camera near-plane clipping only; saved source remains unchanged."""
import bpy,json
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(OUT/'source.blend'));s=bpy.context.scene
r=json.loads((OUT/'receipt.json').read_text());cam=s.camera;light=next(o for o in s.objects if o.type=='LIGHT');original=light.location.copy();oldclip=cam.data.clip_start;cam.data.clip_start=.001
objects=[o for o in s.objects if o.name.startswith('Leafy moss colony')];mat=bpy.data.materials['Moss living olive leafy shoots']
for mode in ['gray','unlit']:
    c=mat.copy();c.name='Moss diagnostic '+mode;n,l=c.node_tree.nodes,c.node_tree.links;b=n['Principled BSDF']
    if mode=='gray':
        for link in list(b.inputs['Base Color'].links):l.remove(link)
        b.inputs['Base Color'].default_value=(.18,.18,.18,1)
    else:
        e=n.new('ShaderNodeEmission');l.new(b.inputs['Base Color'].links[0].from_socket,e.inputs['Color']);l.new(e.outputs[0],n['Material Output'].inputs['Surface'])
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
for view in r['views']:
    if not view['name'].startswith('close'):continue
    for o in objects:o.data.materials[0]=mat if view['mode']=='full' else bpy.data.materials['Moss diagnostic '+view['mode']]
    cam.location=view['eye'];cam.rotation_euler=(Vector(view['target'])-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=view['lens']
    light.location=Vector((3,4,6)) if view['opposing'] else original;light.rotation_euler=(Vector((0,0,.06))-light.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(OUT/(view['name']+'.png'));bpy.ops.render.render(write_still=True)
r['diagnosticCameraNearPlaneRepair']={'originalM':oldclip,'closeCaptureM':.001,'sourceCameraUnchanged':True,'reason':'Macro camera inherited0.1m clip plane intersected foreground stones; capture-only correction, no art revision'}
import hashlib
r['files']=[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='receipt.json']
(OUT/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
