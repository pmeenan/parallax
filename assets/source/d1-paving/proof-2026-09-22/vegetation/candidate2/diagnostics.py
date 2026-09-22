"""Read-only source audit and extra species views; no artistic modification."""
import bpy,json,math,hashlib,numpy as np
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).parent
bpy.ops.wm.open_mainfile(filepath=str(OUT/'source.blend'))
r=json.loads((OUT/'receipt.json').read_text());scene=bpy.context.scene;camera=scene.camera
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU'
for kind in ['grass','moss']:
    item=next(p for p in r['plants'] if p['type']==kind);root=Vector(item['root']);target=root+Vector((0,0,.02 if kind=='grass' else .004));eye=root+Vector((.10,-.13,.15))
    camera.location=eye;camera.rotation_euler=(target-eye).to_track_quat('-Z','Y').to_euler();camera.data.lens=62;scene.render.filepath=str(OUT/(kind+'-detail.png'));bpy.ops.render.render(write_still=True)
names=set(r['plantCounts']);audit={'plants':{},'mapNodes':[],'inputSourceHashUnchanged':hashlib.sha256(Path(r['source']).read_bytes()).hexdigest()==r['sourceSha256']}
for name in names:
    ob=scene.objects[name];audit['plants'][name]={'finiteCoordinates':all(math.isfinite(x) for v in ob.data.vertices for x in v.co),'facesAreaBelow1e14M2':sum(p.area<1e-14 for p in ob.data.polygons),'triangles':sum(len(p.vertices)-2 for p in ob.data.polygons)}
for node in bpy.data.materials['Authored joint weed color normal roughness'].node_tree.nodes:
    if node.type=='TEX_IMAGE':audit['mapNodes'].append({'image':node.image.name,'size':list(node.image.size),'hasData':node.image.has_data,'isFloat':node.image.is_float,'colorSpace':node.image.colorspace_settings.name,'outputsLinked':any(s.is_linked for s in node.outputs)})
audit['normalMapStrength']=bpy.data.materials['Authored joint weed color normal roughness'].node_tree.nodes.get('Normal Map').inputs['Strength'].default_value
audit['scope']='Geometry/map linkage audit only; no full QA, botanical acceptance, or complete collision test.'
(OUT/'diagnostic-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
