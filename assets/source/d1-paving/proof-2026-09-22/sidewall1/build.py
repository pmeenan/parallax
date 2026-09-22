"""One bounded sidewall-wear candidate; preserve soil and stone top materials.
Run only in isolated background Blender5.2.1; never modifies the baseline file.
"""
import bpy, numpy as np, json, hashlib, time
from pathlib import Path
from mathutils import Vector
from datetime import datetime, timezone
ROOT=Path('D:/src/parallax/assets/source/d1-paving')
BASE=ROOT/'proof-2026-09-21/family-contact2'
OUT=ROOT/'proof-2026-09-22/sidewall1'
OUT.mkdir(parents=True,exist_ok=True)
START=time.perf_counter()
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.open_mainfile(filepath=str(BASE/'source.blend'))
scene=bpy.context.scene;scene.name='Paving sidewall wear candidate1'
stones=[scene.objects[n] for n in ['Family A','Family B','Family C']]
def coords(o):
    p=np.empty(len(o.data.vertices)*3,dtype=np.float32);o.data.vertices.foreach_get('co',p);return p.reshape(-1,3)
def digest(o):return hashlib.sha256(coords(o).tobytes()).hexdigest()
preserved={o.name:digest(o) for o in scene.objects if o.type=='MESH' and o not in stones}
def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
changes=[]
for si,ob in enumerate(stones):
    p=coords(ob);before=p.copy();hx,hy=[(.2,.15),(.15,.1425),(.255,.125)][si]
    # Local hand-directed facet centers on each edge, varied deterministically.
    # There is no random micro-noise; each bounded lobe represents one worn chip.
    rng=np.random.default_rng(921+si)
    features=[]
    for axis,half,other in [(0,hx,hy),(1,hy,hx)]:
        tangent=1-axis
        for sign in [-1,1]:
            priority=(si==0 and axis==0 and sign==1) or (si==1 and axis==0 and sign==-1) or (si==2 and axis==1 and sign==-1)
            centers=np.array([-.78,-.43,-.09,.26,.61,.85])*other
            for ci,center in enumerate(centers):
                width=float(rng.uniform(.018,.031) if priority else rng.uniform(.014,.025))
                depth=float(rng.uniform(.0032,.0052) if priority else rng.uniform(.0017,.0032))
                center+=float(rng.uniform(-.006,.006))
                # Piecewise-planar inner core with smoothly worn outer rim.
                t=np.abs((before[:,tangent]-center)/width)
                along=np.maximum(1-t,0)
                along=along*.75+smooth(0,1,along)*.25
                side=smooth(half-.022,half-.008,sign*before[:,axis])
                # Leave the original soil-level section unchanged below61mm.
                # Recession increases toward the upper sidewall, turning it upward.
                z=before[:,2]+ob.location.z
                vertical=smooth(.0605,.077,z)
                loss=depth*along*side*vertical
                p[:,axis]-=sign*loss
                features.append({'axis':axis,'sign':sign,'centerM':center,'halfSpanM':width,'depthM':depth,'priorityJointEdge':priority})
    ob.data.vertices.foreach_set('co',p.ravel());ob.data.update()
    delta=np.linalg.norm(p-before,axis=1)
    changes.append({'object':ob.name,'verticesChanged':int(np.count_nonzero(delta>1e-8)),'maxDisplacementM':float(delta.max()),'meanChangedDisplacementM':float(delta[delta>1e-8].mean()),'topInteriorUnchanged':bool(np.array_equal(p[(abs(before[:,0])<hx-.023)&(abs(before[:,1])<hy-.023)],before[(abs(before[:,0])<hx-.023)&(abs(before[:,1])<hy-.023)])),'features':features})
assert all(digest(scene.objects[name])==value for name,value in preserved.items())
for im in bpy.data.images:
    if im.source=='FILE' and im.has_data and not im.packed_file:im.pack()
camera=scene.camera;light=next(o for o in scene.objects if o.type=='LIGHT')
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=96;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
views=json.loads((BASE/'receipt.json').read_text())['views']
def view(v):
    name,eye,target,lens,key,energy,size,ambient=v
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
for v in views:view(v)
gray=bpy.data.materials.new('Sidewall diagnostic gray');gray.use_nodes=True
bs=gray.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.4,.4,.4,1);bs.inputs['Roughness'].default_value=.85
scene.view_layers[0].material_override=gray
scene.render.filepath=str(OUT/'diagnostic-gray.png');bpy.ops.render.render(write_still=True)
scene.view_layers[0].material_override=None
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'tool':bpy.app.version_string,'seconds':time.perf_counter()-START,'author':'Codex paver_refinement agent','baseline':str(BASE/'source.blend'),'baselineSha256':hashlib.sha256((BASE/'source.blend').read_bytes()).hexdigest(),'changes':changes,'nonStoneGeometryUnchanged':preserved,'materialChanges':'None; external loaded height packed for standalone recovery','views':views,'grayDiagnostic':'same joint-detail camera/light; clay override only','scope':'One sidewall candidate; no soil raising, no library/runtime/artistic acceptance','rightsReviewed':False,'inputLineage':str(ROOT/'proof-2026-09-21/family/candidate2/receipt.json'),'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'files':[{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(OUT.iterdir()) if p.suffix in ['.blend','.png']]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
