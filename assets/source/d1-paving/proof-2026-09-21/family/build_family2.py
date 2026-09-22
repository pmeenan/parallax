"""First bounded three-stone family from candidate3; isolated Blender5.2.1.
Nonlinear field remapping is artistic derivation of retained synthetic inputs.
No soil/contact result, runtime claim, public upload or library admission.
"""
from pathlib import Path
import time, json, hashlib
import bpy, numpy as np
from mathutils import Vector
ROOT=Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21')
OUT=ROOT/'family/candidate2'
OUT.mkdir(parents=True,exist_ok=True)
START=time.perf_counter()
source=(ROOT/'stone/candidate3/resolved_build.py').read_text()
source=source.replace("OUT = Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21/stone/candidate3')",f"OUT = Path('{OUT.as_posix()}')")
source=source.replace('Paving proof stone candidate3','Paving proof family candidate2')
source=source.replace("(OUT/'resolved_build.py').write_text(SOURCE_TEXT)","pass # The resolved input is captured by family authoring provenance")
source=source.replace("bpy.data.libraries.write(str(OUT/'source.blend'),{scene},fake_user=True,compress=True)","pass # Save only the complete three-stone family below")
source=source.replace("(OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\\n')","pass # Complete family metrics are recorded below")
ns={'SOURCE_TEXT':source}
exec(compile(source,str(ROOT/'stone/candidate3/resolved_build.py'),'exec'),ns)
scene=ns['scene']; camera=ns['camera']; light=ns['light']; ground=ns['ground']
stone_a=ns['stone'];stone_a.name='Family A';stone_a.data.name='Family A mesh'
def pixels(im):
    p=np.empty(im.size[0]*im.size[1]*4,dtype=np.float32);im.pixels.foreach_get(p)
    return p.reshape(im.size[1],im.size[0],4)
height_original=pixels(ns['HEIGHT'])
mod_original=pixels(ns['MODULATION'])
def remap(src,seed):
    # Distinct smoothly warped coordinates preserve source mineral connectivity
    # locally while altering large island proportions and spacing independently.
    h,w=src.shape[:2]; yy,xx=np.mgrid[0:h,0:w].astype(np.float32)
    u=xx/(w-1);v=yy/(h-1);rng=np.random.default_rng(seed)
    phase=rng.uniform(0,6.283,4)
    du=.015*np.sin(6.283*(v*1.35+.23*u)+phase[0])+.006*np.sin(6.283*(u*2.2-v*.6)+phase[1])
    dv=.015*np.sin(6.283*(u*1.17-.19*v)+phase[2])+.006*np.sin(6.283*(v*2.6+u*.7)+phase[3])
    u=(u+du+seed*.017)%1;v=(v+dv+seed*.011)%1
    def sample(a,b):
        x=(a%1)*(w-1);y=(b%1)*(h-1);ix=x.astype(int);iy=y.astype(int);fx=(x-ix)[:,:,None];fy=(y-iy)[:,:,None]
        return ((src[iy,ix]*(1-fx)+src[iy,np.minimum(ix+1,w-1)]*fx)*(1-fy)+(src[np.minimum(iy+1,h-1),ix]*(1-fx)+src[np.minimum(iy+1,h-1),np.minimum(ix+1,w-1)]*fx)*fy)
    # Recombine two broad source zones without rescaling the mineral spots.
    # Same deterministic spatial mask is used for every material/relief channel.
    primary=sample(u,v)
    alternate=sample(1-u+.317,1-v+.413)
    zone=np.sin(6.283*(xx/(w-1)*.85+yy/(h-1)*.34)+phase[1])+.65*np.cos(6.283*(yy/(h-1)*1.2-xx/(w-1)*.28)+phase[3])
    mask=np.clip((zone+.16)/.32,0,1);mask=mask*mask*(3-2*mask)
    return (primary*(1-mask[:,:,None])+alternate*mask[:,:,None]).astype(np.float32)
def packed(name,p):
    im=bpy.data.images.new(name,width=p.shape[1],height=p.shape[0],float_buffer=True)
    im.colorspace_settings.name='Non-Color';im.pixels.foreach_set(p.ravel());im.update();im.pack();return im
def blurred(p,count):
    p=p.copy()
    for _ in range(count):
        p=(np.roll(p,1,axis=0)+2*p+np.roll(p,-1,axis=0))/4
        p=(np.roll(p,1,axis=1)+2*p+np.roll(p,-1,axis=1))/4
    return p
stones=[stone_a]
for label,seed,hx,hy in [('B',787,.15,.1425),('C',829,.255,.125)]:
    hp=remap(height_original,seed)
    ns['HEIGHT']=packed(f'Family {label} nonlinear relief',hp)
    ns['HEIGHT_PIXELS']=blurred(hp[:,:,0],3)
    ns['HEIGHT_MACRO']=blurred(ns['HEIGHT_PIXELS'],20)
    mp=np.ones_like(hp);mp[:,:,:3]=ns['HEIGHT_MACRO'][:,:,None]
    ns['MACRO']=packed(f'Family {label} nonlinear mineral regions',mp)
    ns['MODULATION']=packed(f'Family {label} nonlinear chromatic variation',remap(mod_original,seed))
    ob=ns['make_stone']('Family '+label,seed=seed,hx=hx,hy=hy,hz=.04)
    ob.data.name='Family '+label+' mesh';stones.append(ob)
for ob,xyz,rot in zip(stones,[(-.207,-.165,0),(.161,-.173,.001),(-.072,.129,-.0005)],[.005,-.012,.008]):
    ob.location=xyz;ob.rotation_euler.z=rot
    ob.data.materials[0].name=ob.name+' candidate3 mineral material'
    ob['familyDerivation']='Candidate3 control' if ob==stone_a else 'Independently nonlinear-warped source field aligned across relief, reflectance and roughness'
ground.location.z=.003
scene.name='Paving proof family candidate2'
scene.render.resolution_x=1800;scene.render.resolution_y=1200;scene.cycles.samples=128
light.data.size=1.2;light.data.energy=200
camera.data.clip_start=.01
views=[('oblique',(.79,-1.0,.94),(-.04,-.04,.045),(-1,-1,2),50),('reverse-light',(.79,-1.0,.94),(-.04,-.04,.045),(1,1,2),50),('walking',(0,-.75,1.65),(0,0,.04),(-1,-1,2),45),('top',(-.03,-.03,1.5),(-.03,-.03,.04),(-1,-1,2),48)]
for name,eye,target,key,lens in views:
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=key;light.rotation_euler=(Vector((0,0,.04))-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
camera.location=views[0][1];camera.rotation_euler=(Vector(views[0][2])-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=50
light.location=views[0][3];light.rotation_euler=(Vector((0,0,.04))-light.location).to_track_quat('-Z','Y').to_euler()
for im in bpy.data.images:
    if im.source=='FILE' and im.has_data and not im.packed_file and im.filepath:im.pack()
bpy.context.view_layer.update()
for other in list(bpy.data.scenes):
    if other!=scene:bpy.data.scenes.remove(other)
bpy.data.orphans_purge(do_local_ids=True,do_linked_ids=False,do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
paths=[ROOT/'stone/candidate3/resolved_build.py',ROOT/'stone/candidate3/provenance.json',ROOT/'family/build_family2.py']
receipt={'tool':bpy.app.version_string,'seconds':time.perf_counter()-START,'scene':scene.name,'objects':[{'name':o.name,'material':o.data.materials[0].name,'dimensionsM':list(o.dimensions),'seed':o['seed'],'triangles':sum(len(p.vertices)-2 for p in o.data.polygons)} for o in stones],'views':views,'derivation':'A candidate3 control; B/C independently nonlinearly warped retained synthetic scalar and compressed chromatic fields with aligned channels. Shapes and dimensions use independent seeds. This is artistic derivation, not a scan or intrinsic decomposition.','limitations':['Residual source lighting inherited from candidate3','No contact/soil, portable bake, full QA or game claim','Rights review remains open'],'inputs':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in paths],'outputs':[{'path':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in sorted(OUT.iterdir()) if f.suffix in {'.png','.blend'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')

