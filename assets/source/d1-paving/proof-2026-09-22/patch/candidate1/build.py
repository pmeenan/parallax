"""Native 4m paving study: current low family, compact earth, rooted broadleaf plants."""
import bpy,math,json,time,hashlib,random,ast
import numpy as np
from pathlib import Path
from mathutils import Vector
from datetime import datetime,timezone
START=time.perf_counter();OUT=Path(__file__).parent;PROOF=OUT.parents[1];D1=PROOF.parent
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.name='Four metre paving patch candidate1'
rng=random.Random(922407)
sources={};masters={}
for label in 'ABC':
    path=PROOF/'transfer'/label.lower()/'portable.blend'
    sources[label]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    with bpy.data.libraries.load(str(path),link=False) as (src,dst):dst.objects=[n for n in src.objects if n.startswith('Limestone portable LOD0')]
    ob=dst.objects[0];masters[label]=ob
    assert sum(len(p.vertices)-2 for p in ob.data.polygons)==3900
# A shared planning grid coordinates cuts; randomized rectangular packing breaks long courses.
N=28;STEP=.14;occupied=np.zeros((N,N),dtype=bool);tiles=[]
options=[('A',3,2),('B',2,2),('C',4,2),('A',2,3),('C',2,4)]
attempts=0
def tile():
    global attempts
    attempts+=1
    if attempts>200000:raise RuntimeError('bounded packing search exhausted')
    vacant=np.argwhere(~occupied)
    if not len(vacant):return True
    y,x=map(int,vacant[0]);choices=options.copy();rng.shuffle(choices)
    # Prefer long axis along courses, with enough turned stones to interrupt their seams.
    if rng.random()<.58:choices.sort(key=lambda c:c[1]<c[2])
    for label,w,h in choices:
        if x+w>N or y+h>N or occupied[y:y+h,x:x+w].any():continue
        occupied[y:y+h,x:x+w]=True;tiles.append((label,x,y,w,h))
        if tile():return True
        tiles.pop();occupied[y:y+h,x:x+w]=False
    return False
assert tile() and len(tiles)<=190
stones=[];layout=[];rects=[]
for i,(label,gx,gy,gw,gh) in enumerate(tiles):
    master=masters[label];ob=master.copy();ob.data=master.data;ob.name=f'Paver {i:03d} {label}';scene.collection.objects.link(ob)
    coords=np.array([v.co[:] for v in ob.data.vertices]);lo=coords.min(0);hi=coords.max(0);center=(lo+hi)/2
    turned=gw<gh;angle=(math.pi/2 if turned else 0)+rng.choice([0,math.pi])+rng.uniform(-.0025,.0025)
    gap=rng.uniform(.010,.014);dx=gw*STEP-gap;dy=gh*STEP-gap
    sx=(dy if turned else dx)/(hi[0]-lo[0]);sy=(dx if turned else dy)/(hi[1]-lo[1])
    ob.rotation_euler=(0,0,angle);ob.scale=(sx,sy,1)
    x=-N*STEP/2+(gx+gw/2)*STEP;y=-N*STEP/2+(gy+gh/2)*STEP
    ob.location=(x,y,0);bpy.context.view_layer.update()
    # Local source centres are near zero; preserve source top height and offset XY centre exactly.
    offset=ob.matrix_world.to_3x3()@Vector((center[0],center[1],0));ob.location.x-=offset.x;ob.location.y-=offset.y
    bpy.context.view_layer.update();world=np.array([ob.matrix_world@Vector(p) for p in coords]);mn=world.min(0);mx=world.max(0)
    rects.append((mn[0],mn[1],mx[0],mx[1]));stones.append(ob)
    layout.append({'object':ob.name,'family':label,'grid':[gx,gy,gw,gh],'locationM':list(ob.location),'rotationZRadians':angle,'scaleXYZ':list(ob.scale),'boundsM':[mn.tolist(),mx.tolist()]})
rects=np.array(rects)
overlaps=[];clearance=[]
for i,a in enumerate(rects):
    for j in range(i):
        b=rects[j];dx=max(a[0]-b[2],b[0]-a[2],0);dy=max(a[1]-b[3],b[1]-a[3],0)
        if dx==0 and dy==0:overlaps.append([i,j])
        clearance.append(math.hypot(dx,dy))
assert not overlaps
# Reuse exact approved earth shader without loading any dense soil geometry.
contact=D1/'proof-2026-09-21/family-contact2/source.blend'
with bpy.data.libraries.load(str(contact),link=False) as (src,dst):dst.materials=[n for n in src.materials if n=='Compacted mixed earth contact1']
earth=dst.materials[0]
recipe=D1/'proof-2026-09-21/family-contact2/resolved.py'
tree=ast.parse(recipe.read_text());field_ast=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='field'],type_ignores=[]);exec(compile(field_ast,str(recipe),'exec'))
def edge_distance(p):
    # Distance to conservatively enclosing stone rectangles; <= few mm local boundary approximation.
    result=np.full(len(p),np.inf)
    for a in rects:
        dx=np.maximum(np.maximum(a[0]-p[:,0],p[:,0]-a[2]),0);dy=np.maximum(np.maximum(a[1]-p[:,1],p[:,1]-a[3]),0)
        outside=np.hypot(dx,dy);inside=np.minimum.reduce([p[:,0]-a[0],a[2]-p[:,0],p[:,1]-a[1],a[3]-p[:,1]])
        result=np.minimum(result,np.where((dx==0)&(dy==0),np.abs(inside),outside))
    return result
def soil_height(p):
    return .064+.002*np.exp(-edge_distance(p)/.010)*(.55+.45*field(p,45,121))+.005*(field(p,29,51)-.5)+.003*(field(p,150,62)-.5)+.0014*(field(p,430,77)-.5)
def mesh(name,verts,faces,material):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();assert not data.validate()
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob)
    if material:data.materials.append(material)
    for p in data.polygons:p.use_smooth=True
    return ob
xx,yy=np.meshgrid(np.linspace(-2.08,2.08,49),np.linspace(-2.08,2.08,49));p=np.column_stack((xx.ravel(),yy.ravel()));v=np.column_stack((p,soil_height(p)))
idx=np.arange(len(v)).reshape(xx.shape);faces=np.stack((idx[:-1,:-1],idx[:-1,1:],idx[1:,1:],idx[1:,:-1]),axis=-1).reshape(-1,4)
soil=mesh('Compacted matrix lower density',v.tolist(),faces.tolist(),earth)
# Explicit 10mm edge ribbons keep the local bank represented independently of coarse grid pitch.
verts=[];faces=[]
for a in rects:
    corners=np.array([[a[0],a[1]],[a[2],a[1]],[a[2],a[3]],[a[0],a[3]]])
    for k in range(4):
        u,w=corners[k],corners[(k+1)%4];direction=w-u;normal=np.array([direction[1],-direction[0]])/np.linalg.norm(direction)
        points=np.array([u,w,w+normal*.010,u+normal*.010]);z=soil_height(points)
        # Outer strip edge connects towards the base soil level; it is a limited contact approximation.
        start=len(verts);verts.extend(np.column_stack((points,z)).tolist());faces.append(tuple(range(start,start+4)))
banks=mesh('Local compacted 10mm edge banks',verts,faces,earth)
mesh('Distant earth continuation',[(-30,-30,.059),(30,-30,.059),(30,30,.059),(-30,30,.059)],[(0,1,2,3)],earth)
def stone_at(x,y,margin=0):return bool(np.any((x>=rects[:,0]-margin)&(x<=rects[:,2]+margin)&(y>=rects[:,1]-margin)&(y<=rects[:,3]+margin)))
# Sparse embedded aggregate: tiny pieces do not become a second pebble paving layer.
import bmesh
bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=1,radius=1);bm.verts.ensure_lookup_table();bm.verts.index_update();template=np.array([q.co[:] for q in bm.verts]);tf=[tuple(q.index for q in f.verts) for f in bm.faces];bm.free()
verts=[];faces=[];aggregate_positions=[]
for trial in range(30000):
    if len(aggregate_positions)>=100:break
    x,y=rng.uniform(-1.98,1.98),rng.uniform(-1.98,1.98)
    if stone_at(x,y):continue
    r=rng.uniform(.0015,.004);z=float(soil_height(np.array([[x,y]]))[0]);shape=template*np.array([r,r*.8,r*.55])+[x,y,z-r*.25];start=len(verts);verts.extend(shape.tolist());faces.extend([tuple(start+k for k in f) for f in tf]);aggregate_positions.append([x,y,z])
gritmat=bpy.data.materials.new('Sparse pale embedded grit');gritmat.use_nodes=True;gb=gritmat.node_tree.nodes['Principled BSDF'];gb.inputs['Base Color'].default_value=(.13,.09,.045,1);gb.inputs['Roughness'].default_value=.9
grit=mesh('Sparse embedded aggregate',verts,faces,gritmat)
# Broadleaf geometry: asymmetric ovate blades on visible petioles, roots below the stone tops.
leafmat=bpy.data.materials.new('Muted living broadleaf');leafmat.use_nodes=True;n,l=leafmat.node_tree.nodes,leafmat.node_tree.links;bs=n['Principled BSDF'];bs.inputs['Roughness'].default_value=.7
tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=95;tex.inputs['Detail'].default_value=2
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.018,.038,.004,1);ramp.color_ramp.elements[1].color=(.08,.14,.017,1);l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],bs.inputs['Base Color'])
stemmat=bpy.data.materials.new('Short green brown stems');stemmat.use_nodes=True;stemmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.065,.085,.015,1);stemmat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.83
roots=[]
for trial in range(100000):
    if len(roots)>=10:break
    x,y=rng.uniform(-1.8,1.8),rng.uniform(-1.8,1.8)
    if stone_at(x,y,.0025) or any(math.hypot(x-a,y-b)<.5 for a,b,z in roots):continue
    if rng.random()>.35:continue
    z=float(soil_height(np.array([[x,y]]))[0])-.005;roots.append([x,y,z])
lv=[];lf=[];sv=[];sf=[]
def stem(a,b,r=.001):
    axis=(b-a).normalized();u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=axis.cross(Vector((1,0,0)))
    u.normalize();w=axis.cross(u);start=len(sv)
    for p in [a,b]:
        for k in range(5):sv.append(tuple(p+r*(math.cos(k*math.tau/5)*u+math.sin(k*math.tau/5)*w)))
    for k in range(5):sf.append((start+k,start+(k+1)%5,start+5+(k+1)%5,start+5+k))
for root in roots:
    root=Vector(root)
    for j in range(rng.randint(6,8)):
        angle=rng.uniform(0,math.tau);direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0))
        length=rng.uniform(.025,.063);width=length*rng.uniform(.25,.40);rise=rng.uniform(.008,.052)
        base=root+direction*rng.uniform(.004,.019)+Vector((0,0,rng.uniform(.012,.039)));stem(root,base,rng.uniform(.0007,.0012))
        start=len(lv)
        for k in range(8):
            t=k/7;mid=base+direction*(length*t)+Vector((0,0,rise*t+.006*math.sin(math.pi*t)))
            half=width*(math.sin(math.pi*t)**.75)*.5
            for q in [-1,0,1]:lv.append(tuple(mid+side*(q*half*(1.08 if q<0 else .92))+Vector((0,0,-abs(q)*.003*math.sin(math.pi*t)))))
        for k in range(7):
            for q in range(2):lf.append((start+k*3+q,start+(k+1)*3+q,start+(k+1)*3+q+1,start+k*3+q+1))
leaves=mesh('Sparse asymmetric oval leaves',lv,lf,leafmat);stems=mesh('Rooted short petioles',sv,sf,stemmat)
counts={o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'}
stone_tris=sum(counts[o.name] for o in stones);plant_tris=counts[leaves.name]+counts[stems.name];ground_tris=sum(counts.values())-stone_tris-plant_tris
assert sum(counts.values())<=750000 and len(stones)<=200 and plant_tris<=4000
camera=bpy.data.objects.new('Patch camera',bpy.data.cameras.new('Patch camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.data.dof.use_dof=False
light=bpy.data.objects.new('Patch area light',bpy.data.lights.new('Patch area light','AREA'));scene.collection.objects.link(light)
scene.world=bpy.data.worlds.new('Patch world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.45,.45,1)
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=96;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.render.resolution_x=1800;scene.render.resolution_y=1350;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
detail=min(roots,key=lambda r:r[0]**2+r[1]**2);d=Vector(detail)
views=[('sunny-oblique',(3.5,-4.4,4.7),(0,0,.06),50,(-3,-4,6),2200,1.0,.22),('opposing-light',(3.5,-4.4,4.7),(0,0,.06),50,(3,4,6),2200,1.0,.22),('overcast',(3.5,-4.4,4.7),(0,0,.06),50,(-3,-4,6),1100,8,.5),('walking',(.15,-1.7,1.7),(.05,.15,.065),42,(-3,-4,6),2200,1.0,.22),('top-packing',(0,0,6.7),(0,0,.065),48,(-3,-4,6),2200,1.0,.22),('plant-contact',tuple(d+Vector((.23,-.30,.23))),tuple(d+Vector((0,0,.025))),58,(-3,-4,6),2200,1.0,.22)]
for name,eye,target,lens,key,energy,size,ambient in views:
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size;scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
for im in bpy.data.images:
    if im.has_data and not im.packed_file:im.pack()
# Save the representative wide view for convenient reopening.
_,eye,target,lens,key,energy,size,ambient=views[0];camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size;scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'seconds':time.perf_counter()-START,'blender':bpy.app.version_string,'seed':922407,'sources':sources,'contactRecipe':{'path':str(recipe),'sha256':hashlib.sha256(recipe.read_bytes()).hexdigest(),'material':'Compacted mixed earth contact1','nominalHeightM':.064,'localBankM':.002,'adaptation':'49x49 base grid plus explicit10mm local edge ribbons at conservative stone AABB edges; high-frequency geometric soil detail approximated, exact shader retained'},'nominalPatchDimensionsM':[4,4],'stoneFieldDimensionsM':[3.92,3.92],'stoneCount':len(stones),'triangles':{'stones':stone_tris,'ground':ground_tris,'plants':plant_tris,'scene':sum(counts.values())},'layout':layout,'aabbOverlapPairs':overlaps,'minimumAABBClearanceM':min(clearance),'plantRoots':roots,'plantRootsInClearJoints':all(not stone_at(x,y,.0025) for x,y,z in roots),'rootDepthBelowLocalSoilM':.005,'views':views,'rightsReviewed':False,'sourceOnly':True,'runtimeQA':False,'limitations':['Only three retained mineral identities; repetition is part of this test','XY scale changes mineral physical size in same proportion, recorded per stone; Z scale unchanged','Coarse soil geometry and rectangle-local banks approximate prior dense contact recipe','No compression, LOD chain, resource budget admission, shared-material compliance or engine validation'],'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir()) if p.suffix in {'.png','.blend','.py'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
