"""Native 4m paving study: current low family, compact earth, rooted broadleaf plants."""
import bpy,math,json,time,hashlib,random,ast
import numpy as np
from pathlib import Path
from mathutils import Vector
from datetime import datetime,timezone
START=time.perf_counter();OUT=Path(__file__).parent;PROOF=OUT.parents[1];D1=PROOF.parent
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.name='Four metre paving patch candidate2'
rng=random.Random(922408)
sources={};masters={}
for label in 'ABC':
    path=PROOF/'transfer'/label.lower()/'portable.blend'
    sources[label]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    with bpy.data.libraries.load(str(path),link=False) as (src,dst):dst.objects=[n for n in src.objects if n.startswith('Limestone portable LOD0')]
    ob=dst.objects[0];masters[label]=ob
    assert sum(len(p.vertices)-2 for p in ob.data.polygons)==3900
# A shared planning grid coordinates cuts; randomized rectangular packing breaks long courses.
N=28;STEP=1/7;occupied=np.zeros((N,N),dtype=bool);tiles=[]
options=[('A',3,2),('B',2,2),('C',4,2),('A',2,3),('C',2,4)]
attempts=0
def tile():
    global attempts
    attempts+=1
    if attempts>2500:raise RuntimeError('bounded packing search exhausted')
    vacant=np.argwhere(~occupied)
    if not len(vacant):return True
    y,x=map(int,vacant[0]);choices=options.copy();rng.shuffle(choices)
    # Prefer long axis along courses, with enough turned stones to interrupt their seams.
    if rng.random()<.12:choices.sort(key=lambda c:c[1]<c[2])
    for label,w,h in choices:
        if x+w>N or y+h>N or occupied[y:y+h,x:x+w].any():continue
        occupied[y:y+h,x:x+w]=True;tiles.append((label,x,y,w,h))
        if tile():return True
        tiles.pop();occupied[y:y+h,x:x+w]=False
    return False
def seam_score(candidate):
    owners=np.zeros((N,N),dtype=int)
    for i,(_,x,y,w,h) in enumerate(candidate):owners[y:y+h,x:x+w]=i+1
    runs=[]
    for boundary in [owners[:,:-1]!=owners[:,1:],(owners[:-1,:]!=owners[1:,:]).T]:
        for col in boundary.T:
            run=0
            for value in list(col)+[False]:
                if value:run+=1
                elif run:runs.append(run);run=0
    return sum(max(0,r-5)**3 for r in runs),max(runs)
best=None
for trial in range(80):
    occupied[:]=False;tiles=[];attempts=0
    try: success=tile()
    except RuntimeError:success=False
    if not success:continue
    score=seam_score(tiles)
    if best is None or score<best[0]:best=(score,tiles.copy())
assert best is not None
layout_seam_score,tiles=best
assert len(tiles)<=190
stones=[];layout=[];rects=[]
for i,(label,gx,gy,gw,gh) in enumerate(tiles):
    master=masters[label];ob=master.copy();ob.data=master.data;ob.name=f'Paver {i:03d} {label}';scene.collection.objects.link(ob)
    coords=np.array([v.co[:] for v in ob.data.vertices]);lo=coords.min(0);hi=coords.max(0);center=(lo+hi)/2
    turned=gw<gh;angle=(math.pi/2 if turned else 0)+rng.choice([0,math.pi])+rng.uniform(-.0025,.0025)
    gap=rng.uniform(.010,.012);dx=gw*STEP-gap;dy=gh*STEP-gap
    sx=(dy if turned else dx)/(hi[0]-lo[0]);sy=(dx if turned else dy)/(hi[1]-lo[1])
    sx=min(sx,1.08);sy=min(sy,1.08)
    # Adjacent same-family placements alternate their 180-degree landmark orientation.
    neighbors=[item for item in layout if item['family']==label and abs(item['grid'][0]-gx)<=4 and abs(item['grid'][1]-gy)<=4]
    if neighbors:
        previous=neighbors[-1]['rotationZRadians']
        if math.cos(angle-previous)>.5:angle+=math.pi
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
# One welded adaptive triangulation: no separate overlaid bank geometry.
from mathutils.geometry import delaunay_2d_cdt
xx,yy=np.meshgrid(np.linspace(-2.1,2.1,45),np.linspace(-2.1,2.1,45));points=list(zip(xx.ravel(),yy.ravel()))
for a in rects:
    for expansion in [-.004,.004,.012,.025]:
        bounds=[a[0]-expansion,a[1]-expansion,a[2]+expansion,a[3]+expansion]
        corners=np.array([[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]])
        for k in range(4):
            u,w=corners[k],corners[(k+1)%4]
            for t in np.linspace(0,1,max(2,int(np.linalg.norm(w-u)/.024)+1)):points.append(tuple(u*(1-t)+w*t))
for radius in [2.3,2.6,30]:
    for t in np.linspace(-radius,radius,17 if radius<3 else 2):points.extend([(t,-radius),(t,radius),(-radius,t),(radius,t)])
cdt=delaunay_2d_cdt([Vector(p) for p in points],[],[],0,1e-6)
p=np.array([q[:] for q in cdt[0]]);z=soil_height(p);blend=np.clip((np.max(np.abs(p),axis=1)-2.1)/.5,0,1);z=z*(1-blend)+.059*blend
soil=mesh('Continuous adaptive compacted earth',np.column_stack((p,z)).tolist(),cdt[2],earth)
def stone_at(x,y,margin=0):return bool(np.any((x>=rects[:,0]-margin)&(x<=rects[:,2]+margin)&(y>=rects[:,1]-margin)&(y<=rects[:,3]+margin)))
# Sparse embedded aggregate: tiny pieces do not become a second pebble paving layer.
import bmesh
bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=1,radius=1);bm.verts.ensure_lookup_table();bm.verts.index_update();template=np.array([q.co[:] for q in bm.verts]);tf=[tuple(q.index for q in f.verts) for f in bm.faces];bm.free()
verts=[];faces=[];aggregate_positions=[]
for trial in range(200000):
    if len(aggregate_positions)>=2500:break
    x,y=rng.uniform(-1.98,1.98),rng.uniform(-1.98,1.98)
    if stone_at(x,y):continue
    r=rng.choices([.0015,.0025,.004,.006],weights=[.30,.45,.22,.03])[0]*rng.uniform(.7,1.3);z=float(soil_height(np.array([[x,y]]))[0]);shape=template*np.array([r,r*.8,r*.55])+[x,y,z-r*.25];start=len(verts);verts.extend(shape.tolist());faces.extend([tuple(start+k for k in f) for f in tf]);aggregate_positions.append([x,y,z])
gritmat=bpy.data.materials.new('Sparse pale embedded grit');gritmat.use_nodes=True;gb=gritmat.node_tree.nodes['Principled BSDF'];gb.inputs['Base Color'].default_value=(.13,.09,.045,1);gb.inputs['Roughness'].default_value=.9
grit=mesh('Sparse embedded aggregate',verts,faces,gritmat)
for color in [(.065,.043,.018),(.09,.075,.042),(.17,.135,.075)]:
    gm=gritmat.copy();gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*color,1);grit.data.materials.append(gm)
for poly in grit.data.polygons:poly.material_index=(poly.index//20)%4
# Rounded ovate blades with a cupped midrib, raised crown and seated roots.
leafmat=bpy.data.materials.new('Muted living broadleaf');leafmat.use_nodes=True;n,l=leafmat.node_tree.nodes,leafmat.node_tree.links;bs=n['Principled BSDF'];bs.inputs['Roughness'].default_value=.78
coord=n.new('ShaderNodeTexCoord');tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=160;tex.inputs['Detail'].default_value=2;l.new(coord.outputs['Object'],tex.inputs['Vector'])
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.014,.033,.003,1);ramp.color_ramp.elements[1].color=(.06,.105,.010,1);l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],bs.inputs['Base Color'])
stemmat=bpy.data.materials.new('Short green brown stems');stemmat.use_nodes=True;stemmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.055,.07,.008,1);stemmat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.85
veinmat=stemmat.copy();veinmat.name='Subtle living midrib';veinmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.07,.105,.018,1)
roots=[]
for trial in range(200000):
    if len(roots)>=8:break
    x,y=rng.uniform(-1.7,1.7),rng.uniform(-1.7,1.7)
    if stone_at(x,y,.005) or any(math.hypot(x-a,y-b)<.6 for a,b,z in roots):continue
    z=float(soil_height(np.array([[x,y]]))[0])-.004;roots.append([x,y,z])
lv=[];lf=[];sv=[];sf=[];vv=[];vf=[]
def stem(a,b,r=.001):
    axis=(b-a).normalized();u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=axis.cross(Vector((1,0,0)))
    u.normalize();w=axis.cross(u);start=len(sv)
    for p in [a,b]:
        for k in range(5):sv.append(tuple(p+r*(math.cos(k*math.tau/5)*u+math.sin(k*math.tau/5)*w)))
    for k in range(5):sf.append((start+k,start+(k+1)%5,start+5+(k+1)%5,start+5+k))
for root_values in roots:
    root=Vector(root_values);crown=root.copy();crown.z=.088
    stem(root,crown,.002)
    for j in range(6):
        angle=rng.uniform(0,math.tau);direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0))
        length=rng.uniform(.027,.061);width=length*rng.uniform(.53,.70);rise=rng.uniform(.002,.033)
        base=crown+direction*rng.uniform(.004,.016)+Vector((0,0,rng.uniform(.001,.011)));stem(crown,base,rng.uniform(.0007,.0011))
        def center(t):return base+direction*(length*t)+side*(.003*math.sin(math.pi*t))+Vector((0,0,rise*t+.005*math.sin(math.pi*t)))
        start=len(lv);lv.append(tuple(center(0)))
        for k in range(1,10):
            t=k/10;mid=center(t);half=width*math.sqrt(1-(2*t-1)**2)*.5
            for q in [-1,0,1]:lv.append(tuple(mid+side*(q*half*(1.08 if q<0 else .92))+Vector((0,0,abs(q)*.0025*math.sin(math.pi*t)))))
        tip=len(lv);lv.append(tuple(center(1)))
        lf.extend([(start,start+1,start+2),(start,start+2,start+3)])
        for k in range(8):
            for q in range(2):lf.append((start+1+k*3+q,start+1+(k+1)*3+q,start+1+(k+1)*3+q+1,start+1+k*3+q+1))
        lf.extend([(tip-3,tip,tip-2),(tip-2,tip,tip-1)])
        # A narrow raised, gently curved vein follows the blade; no painted line or generated image.
        vstart=len(vv)
        for t in np.linspace(.04,.95,6):
            mid=center(float(t))+Vector((0,0,.00022));half=.0003*(1-.6*t)
            vv.extend([tuple(mid-side*half),tuple(mid+side*half)])
        for k in range(5):vf.append((vstart+k*2,vstart+k*2+1,vstart+k*2+3,vstart+k*2+2))
leaves=mesh('Rounded cupped asymmetric leaves',lv,lf,leafmat);stems=mesh('Rooted crowns and petioles',sv,sf,stemmat);veins=mesh('Readable curved midribs',vv,vf,veinmat)
plant_vertex_conflicts=[]
for ob in [leaves,stems,veins]:
    for i,v in enumerate(ob.data.vertices):
        x,y,z=v.co
        if z<.084 and stone_at(x,y,.001):plant_vertex_conflicts.append([ob.name,i])
assert not plant_vertex_conflicts
counts={o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'}
stone_tris=sum(counts[o.name] for o in stones);plant_tris=counts[leaves.name]+counts[stems.name]+counts[veins.name];ground_tris=sum(counts.values())-stone_tris-plant_tris
assert sum(counts.values())<=750000 and len(stones)<=200 and plant_tris<=4000
camera=bpy.data.objects.new('Patch camera',bpy.data.cameras.new('Patch camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.data.dof.use_dof=False
light=bpy.data.objects.new('Patch area light',bpy.data.lights.new('Patch area light','AREA'));scene.collection.objects.link(light)
scene.world=bpy.data.worlds.new('Patch world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.45,.45,1)
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=96;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.render.resolution_x=1800;scene.render.resolution_y=1350;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
detail=min(roots,key=lambda r:r[0]**2+r[1]**2);d=Vector(detail)
views=[('sunny-oblique',(4.4,-5.5,5.7),(0,0,.06),50,(-3,-4,6),2200,1.0,.22),('opposing-light',(4.4,-5.5,5.7),(0,0,.06),50,(3,4,6),2200,1.0,.22),('overcast',(4.4,-5.5,5.7),(0,0,.06),50,(-3,-4,6),1100,8,.5),('walking',(.15,-1.7,1.7),(.05,.15,.065),42,(-3,-4,6),2200,1.0,.22),('top-packing',(0,0,8.7),(0,0,.065),48,(-3,-4,6),2200,1.0,.22),('plant-contact',tuple(d+Vector((.20,-.22,.34))),tuple(d+Vector((0,0,.025))),58,(-3,-4,6),2200,1.0,.22)]
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
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'seconds':time.perf_counter()-START,'blender':bpy.app.version_string,'seed':922408,'layoutSeamScore':layout_seam_score,'layoutCandidatesScored':80,'sources':sources,'contactRecipe':{'path':str(recipe),'sha256':hashlib.sha256(recipe.read_bytes()).hexdigest(),'material':'Compacted mixed earth contact1','nominalHeightM':.064,'localBankM':.002,'adaptation':'One welded adaptive Delaunay mesh with dense perimeter-neighborhood samples, same64mm/+2mm height formula and exact shader; conservative rectangle distance approximates actual chipped boundary. Source-only ground triangle excess restores contact continuity.'},'nominalPatchDimensionsM':[4,4],'stoneFieldDimensionsM':[4,4],'stoneCount':len(stones),'triangles':{'stones':stone_tris,'ground':ground_tris,'plants':plant_tris,'scene':sum(counts.values())},'layout':layout,'aabbOverlapPairs':overlaps,'minimumAABBClearanceM':min(clearance),'plantRoots':roots,'plantRootsInClearJoints':all(not stone_at(x,y,.0025) for x,y,z in roots),'rootDepthBelowLocalSoilM':.004,'plantVerticesConflictingWithConservativeStoneAtZBelow84mm':plant_vertex_conflicts,'actualXYScaleRange':[min(v for a in layout for v in a['scaleXYZ'][:2]),max(v for a in layout for v in a['scaleXYZ'][:2])],'aggregateCount':len(aggregate_positions),'views':views,'rightsReviewed':False,'sourceOnly':True,'runtimeQA':False,'limitations':['Only three retained mineral identities; repetition is part of this test','XY scale changes mineral physical size in same proportion, recorded per stone; Z scale unchanged','Adaptive soil uses conservative rectangle proximity; original dense soil topology not copied','No compression, LOD chain, resource budget admission, shared-material compliance or engine validation'],'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir()) if p.suffix in {'.png','.blend','.py'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
