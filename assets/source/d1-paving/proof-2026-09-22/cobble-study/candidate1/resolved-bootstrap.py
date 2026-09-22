"""Native 4m paving study: current low family, compact earth, rooted broadleaf plants."""
import bpy,math,json,time,hashlib,random,ast
import numpy as np
from pathlib import Path
from mathutils import Vector
from datetime import datetime,timezone
START=time.perf_counter();OUT=DEST;PROOF=OUT.parents[1];D1=PROOF.parent
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.name='Small stone cobble proof '+CANDIDATE
rng=random.Random(922811)
sources={};masters={}
for label in 'ABC':
    path=PROOF/'transfer'/label.lower()/'portable.blend'
    sources[label]={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    with bpy.data.libraries.load(str(path),link=False) as (src,dst):dst.objects=[n for n in src.objects if n.startswith('Limestone portable LOD0')]
    ob=dst.objects[0];masters[label]=ob
    assert sum(len(p.vertices)-2 for p in ob.data.polygons)==3900
# Deterministic exact-cover layout from the bounded joint search.
N=28;STEP=1/7
layout_path=OUT.parent/'layout.json'
layout_data=json.loads(layout_path.read_text())
assert layout_data['grid']==[N,N] and layout_data['fieldMetres']==[4,4]
tiles=[(item['family'],*item['grid']) for item in layout_data['tiles']]
layout_seam_score=(layout_data['longSeamPenalty'],layout_data['longestInternalSeamCells'])
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
