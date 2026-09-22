"""Independent compacted joint authoring on the preserved cycle11 three-stone scene.

Run in an isolated Blender process opened from assembly-cycle11/source.blend.
Native geometry/shading only. No original file is overwritten; source is not runtime QA.
"""
import bpy, math, json, time, hashlib
import numpy as np
from pathlib import Path
from datetime import datetime, timezone
from mathutils import Vector
from mathutils.bvhtree import BVHTree

START = time.perf_counter()
ROOT = Path('D:/src/parallax/assets/source/d1-paving')
OUT = ROOT/'proof-2026-09-21/profile-contact2'
OUT.mkdir(parents=True, exist_ok=True)
assert bpy.app.version[:3] == (5, 2, 1)
scene = bpy.context.scene
scene.name = 'Paving profile fitted contact2'
stones = [o for o in scene.objects if o.name in {'Family A','Family B','Family C'}]
assert len(stones) == 3
# Only the isolated loaded copy is changed; retained source files and live session survive.
for o in list(scene.objects):
    if o.type=='MESH' and o not in stones:
        scene.collection.objects.unlink(o)

def field(p, frequency, seed):
    q=p*frequency; grid=np.floor(q); f=q-grid; f=f*f*(3-2*f)
    out=np.zeros(len(p))
    for a in (0,1):
        for b in (0,1):
            v=np.sin((grid[:,0]+a)*127.1+(grid[:,1]+b)*311.7+seed*19.31)*43758.5453
            out+=(v-np.floor(v))*(f[:,0] if a else 1-f[:,0])*(f[:,1] if b else 1-f[:,1])
    return out

# Nearest real sidewall samples locate packed soil at the stone/earth interface.
from mathutils.kdtree import KDTree
bpy.context.view_layer.update()
edge_points=[]
for stone in stones:
    coords=np.empty(len(stone.data.vertices)*3); normals=np.empty_like(coords)
    stone.data.vertices.foreach_get('co',coords); stone.data.vertices.foreach_get('normal',normals)
    coords=coords.reshape(-1,3); normals=normals.reshape(-1,3)
    mask=(coords[:,2]>.054)&(coords[:,2]<.076)&(np.abs(normals[:,2])<.7)
    for p in coords[mask][::4]:
        w=stone.matrix_world@Vector(p); edge_points.append((w.x,w.y,0))
edge_tree=KDTree(len(edge_points))
for i,p in enumerate(edge_points): edge_tree.insert(p,i)
edge_tree.balance()
def edge_distance(p):
    return np.array([edge_tree.find(Vector((x,y,0)))[2] for x,y in p])

def soil_height(p):
    # Irregular compacted matrix: 2–30 mm spatial structure, not large rolling dunes.
    return .064 + .002*np.exp(-edge_distance(p)/.010)*(.55+.45*field(p,45,121)) + .005*(field(p,29,51)-.5) + .003*(field(p,150,62)-.5) + .0014*(field(p,430,77)-.5)

def mesh(name, verts, faces, mat):
    data=bpy.data.meshes.new(name); data.from_pydata(verts,[],faces); data.update()
    assert not data.validate()
    ob=bpy.data.objects.new(name,data); scene.collection.objects.link(ob)
    if mat: data.materials.append(mat)
    return ob

mat=bpy.data.materials.new('Compacted mixed earth contact1'); mat.use_nodes=True
n,l=mat.node_tree.nodes,mat.node_tree.links; bs=n.get('Principled BSDF')
coord=n.new('ShaderNodeTexCoord')
tex=n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=310; tex.inputs['Detail'].default_value=2
l.new(coord.outputs['Object'],tex.inputs['Vector'])
r=n.new('ShaderNodeValToRGB'); r.color_ramp.elements[0].position=.2; r.color_ramp.elements[0].color=(.018,.009,.0035,1)
r.color_ramp.elements[1].position=.8; r.color_ramp.elements[1].color=(.065,.035,.012,1)
l.new(tex.outputs['Fac'],r.inputs[0]); l.new(r.outputs[0],bs.inputs['Base Color']); bs.inputs['Roughness'].default_value=.94
bump=n.new('ShaderNodeBump'); bump.inputs['Distance'].default_value=.002; bump.inputs['Strength'].default_value=.8
l.new(tex.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs[0],bs.inputs['Normal'])
xx,yy=np.meshgrid(np.linspace(-.82,.82,801),np.linspace(-.82,.82,801))
p=np.column_stack((xx.ravel(),yy.ravel())); v=np.column_stack((p,soil_height(p)))
idx=np.arange(len(v)).reshape(xx.shape)
faces=np.stack((idx[:-1,:-1],idx[:-1,1:],idx[1:,1:],idx[1:,:-1]),axis=-1).reshape(-1,4)
soil=mesh('Compacted recessed matrix',v.tolist(),faces.tolist(),mat)
for poly in soil.data.polygons: poly.use_smooth=True
# A distant continuation prevents a stage-like slab boundary in low views.
mesh('Distant ground',[(-6,-6,.059),(6,-6,.059),(6,6,.059),(-6,6,.059)],[(0,1,2,3)],mat)

bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get()
trees=[(s,BVHTree.FromObject(s,deps)) for s in stones]
def stone_at(x,y):
    for s,tree in trees:
        inv=s.matrix_world.inverted()
        hit=tree.ray_cast(inv@Vector((x,y,.3)),Vector((0,0,-1)),.5)[0]
        if hit is not None: return True
    return False


# A ring follows actual sidewall intersections. Its upper contact is constrained by
# a second ray onto the local top, not inferred from a nominal stone bounding box.
base_soil_height=soil_height
collar_samples=[]; collar_vertices=[]; collar_faces=[]; contact_clearances=[]
for stone,tree in trees:
    inv=stone.matrix_world.inverted(); centre=stone.matrix_world.translation
    for j in range(768):
        angle=math.tau*j/768
        outward=Vector((math.cos(angle),math.sin(angle),0))
        xy=np.array([[centre.x+.2*outward.x,centre.y+.2*outward.y]])
        z=.072 + .004*(float(field(xy,19,138)[0])-.5)
        point=None; top_z=None
        for iteration in range(4):
            origin=Vector((centre.x,centre.y,z))+outward
            direction=(inv.to_3x3()@(-outward)).normalized()
            hit=tree.ray_cast(inv@origin,direction,1.2)[0]
            if hit is None: break
            point=stone.matrix_world@hit
            probe=point-outward*.012
            top=tree.ray_cast(inv@Vector((probe.x,probe.y,.3)),Vector((0,0,-1)),.5)[0]
            if top is None: break
            top_z=(stone.matrix_world@top).z
            z=min(z,top_z-.005)
        assert point is not None and top_z is not None
        # Recompute at final height, so the collar does not preserve an earlier hit.
        origin=Vector((centre.x,centre.y,z))+outward
        point=stone.matrix_world@tree.ray_cast(inv@origin,(inv.to_3x3()@(-outward)).normalized(),1.2)[0]
        width=.011+.012*float(field(np.array([[point.x,point.y]]),36,813)[0])
        start=len(collar_vertices)
        for k in range(6):
            t=k/5
            pos=point+outward*(-.0007+(width+.0007)*t)
            base=float(base_soil_height(np.array([[pos.x,pos.y]]))[0])
            h=base+(z-base)*(1-t)**1.35
            collar_vertices.append((pos.x,pos.y,h))
        collar_samples.append((point.x,point.y,z,width))
        contact_clearances.append(top_z-z)
    ring_start=len(collar_vertices)-768*6
    for j in range(768):
        for k in range(5):
            a=ring_start+j*6+k; b=ring_start+((j+1)%768)*6+k
            collar_faces.append((a,b,b+1,a+1))
collar=mesh('Profile fitted packed earth',collar_vertices,collar_faces,mat)
for polygon in collar.data.polygons: polygon.use_smooth=True
collar_tree=KDTree(len(collar_samples))
for i,p in enumerate(collar_samples): collar_tree.insert((p[0],p[1],0),i)
collar_tree.balance()
def soil_height(p):
    result=base_soil_height(p)
    for k,(x,y) in enumerate(p):
        _,i,d=collar_tree.find((x,y,0)); sample=collar_samples[i]
        if d<sample[3]:
            result[k]=max(result[k],result[k]+(sample[2]-result[k])*(1-d/sample[3])**1.35)
    return result
(OUT/'profile-metrics.json').write_text(json.dumps({
    'inwardTopProbeM':.012,'profileSamples':len(collar_samples),'collarTriangles':len(collar_faces)*2,
    'nominalTopClearanceM':.005,'sampledTopClearanceMinimumM':min(contact_clearances),
    'contactHeightMinM':min(p[2] for p in collar_samples),
    'contactHeightMaxM':max(p[2] for p in collar_samples),
    'method':'horizontal sidewall ray, local inward top probe, outer blend to existing soil',
    'limitations':'Sampled collar construction is not a watertight collision proof.'
},indent=2)+'\n')

# Real embedded aggregates, varied and partly buried, distributed more densely in joints.
rng=np.random.default_rng(92151); verts=[]; faces=[]; shades=[]; kept=0
# Native low subdivision icosphere template: irregular rounded grains, not diamonds.
import bmesh
bm=bmesh.new(); bmesh.ops.create_icosphere(bm,subdivisions=2,radius=1)
bm.verts.ensure_lookup_table(); bm.verts.index_update()
template=np.array([v.co[:] for v in bm.verts])
triangles=[tuple(v.index for v in f.verts) for f in bm.faces]; bm.free()
for i in range(115000):
    x,y=rng.uniform(-.78,.78),rng.uniform(-.70,.70)
    if stone_at(x,y): continue
    density=float(field(np.array([[x,y]]),18,904)[0])
    edge_d=float(edge_distance(np.array([[x,y]]))[0])
    chance=.09+.41*density**1.3+(.50 if edge_d<.018 else 0)
    if rng.random() > chance: continue
    radius=float(rng.choice([.0013,.0022,.0035,.006],p=[.51,.36,.12,.01])*rng.uniform(.65,1.3))
    if edge_d<.018: radius*=.8
    z=float(soil_height(np.array([[x,y]]))[0])
    angle=rng.uniform(0,math.tau); c,s=math.cos(angle),math.sin(angle)
    rotation=np.array([[c,-s,0],[s,c,0],[0,0,1]])
    shape=template*rng.uniform(.75,1.25,template.shape); shape[:,2]*=rng.uniform(.5,.8)
    shape=(shape@rotation.T)*radius+np.array([x,y,z-radius*.45])
    start=len(verts); verts.extend(shape.tolist())
    faces.extend([tuple(start+k for k in f) for f in triangles]); kept+=1
    shades.extend([int(rng.choice(5,p=[.28,.25,.20,.19,.08]))]*len(triangles))
grit=mesh('Embedded mixed aggregate',verts,faces,None)
for i,color in enumerate([(.045,.024,.010),(.075,.045,.020),(.13,.10,.060),(.050,.044,.032),(.19,.15,.095)]):
    m=bpy.data.materials.new(f'Earth aggregate {i}'); m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF'); shader.inputs['Base Color'].default_value=(*color,1); shader.inputs['Roughness'].default_value=.87
    nodes,links=m.node_tree.nodes,m.node_tree.links
    tc=nodes.new('ShaderNodeTexCoord'); micro=nodes.new('ShaderNodeTexNoise'); micro.inputs['Scale'].default_value=1600
    links.new(tc.outputs['Object'],micro.inputs['Vector'])
    rr=nodes.new('ShaderNodeValToRGB'); rr.color_ramp.elements[0].color=tuple(v*.55 for v in color)+(1,); rr.color_ramp.elements[1].color=tuple(v*1.3 for v in color)+(1,)
    links.new(micro.outputs['Fac'],rr.inputs[0]); links.new(rr.outputs[0],shader.inputs['Base Color'])
    bb=nodes.new('ShaderNodeBump'); bb.inputs['Distance'].default_value=.00018; bb.inputs['Strength'].default_value=.55
    links.new(micro.outputs['Fac'],bb.inputs['Height']); links.new(bb.outputs[0],shader.inputs['Normal'])
    grit.data.materials.append(m)
for poly,index in zip(grit.data.polygons,shades):
    poly.material_index=index; poly.use_smooth=True

camera=scene.camera; light=next(o for o in scene.objects if o.type=='LIGHT')
scene.render.engine='CYCLES'; scene.cycles.device='GPU'; scene.cycles.samples=96; scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type='OPTIX'; prefs.refresh_devices()
for device in prefs.devices: device.use=device.type=='OPTIX'
scene.render.resolution_x=1600; scene.render.resolution_y=1200; scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
def view(name,eye,target,lens,key,energy,size,ambient):
    camera.location=eye; camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.lens=lens
    light.location=key; light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler()
    light.data.energy=energy; light.data.size=size
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
    scene.render.filepath=str(OUT/(name+'.png')); bpy.ops.render.render(write_still=True)
views=[
 ('oblique',(.73,-.98,1.1),(-.04,-.015,.065),50,(-1,-.9,1.5),145,.5,.22),
 ('reverse-light',(.73,-.98,1.1),(-.04,-.015,.065),50,(1,.9,1.5),145,.5,.22),
 ('walking',(.05,-.4,1.7),(-.04,-.015,.065),52,(-1,-.9,1.5),145,.5,.22),
 ('overcast',(.05,-.4,1.7),(-.04,-.015,.065),52,(-1,-.9,1.5),70,3,.5),
 ('joint-detail',(.24,-.36,.33),(-.025,-.01,.066),58,(-1,-.9,1.5),145,.5,.22),
]
for args in views: view(*args)
for im in bpy.data.images:
    if im.source=='FILE' and im.has_data and not im.packed_file: im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'seconds':time.perf_counter()-START,
 'baseline':'family source plus contact3 recipe','stoneChanges':'screened family; contact-only integration',
 'soilNominalHeightM':.064,'aggregateCount':kept,'soilTriangles':len(soil.data.polygons)*2,
 'views':views,'sourceOnly':True,'runtimeQA':False,'rightsReviewed':False,
 'files':[{'name':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(OUT.iterdir()) if f.suffix in {'.png','.blend'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
result=receipt
