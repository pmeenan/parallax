"""Original limestone authoring study. Run in Blender 5.2.1 through MCP.

The same metric geological fields drive source relief and material attributes.
No photographic scan, generated paintover, or previous master is consumed.
"""
import bpy
import bmesh
import numpy as np
import math
import json
import time
from pathlib import Path
from datetime import datetime, timezone
from mathutils import Vector

ROOT = Path('D:/src/parallax/assets/source/d1-paving/surface-study-2026-09-21')
CYCLE = int(globals().get('STUDY_CYCLE', 1))
OUT = ROOT / f'cycle{CYCLE}'
OUT.mkdir(parents=True, exist_ok=True)
assert bpy.app.version[:3] == (5, 2, 1)
START = time.perf_counter()

def hash3(x, y, z, seed=0):
    h = np.sin(x*127.1+y*311.7+z*74.7+seed*19.31)*43758.5453123
    return h-np.floor(h)

def noise(p, freq=1, seed=0):
    q=p*freq
    grid=np.floor(q)
    f=q-grid
    f=f*f*f*(f*(f*6-15)+10)
    out=np.zeros(len(p), dtype=np.float64)
    for i in (0,1):
        for j in (0,1):
            for k in (0,1):
                w=(f[:,0] if i else 1-f[:,0])*(f[:,1] if j else 1-f[:,1])*(f[:,2] if k else 1-f[:,2])
                out+=w*hash3(grid[:,0]+i,grid[:,1]+j,grid[:,2]+k,seed)
    return out

def smoothstep(a,b,v):
    t=np.clip((v-a)/(b-a),0,1)
    return t*t*(3-2*t)

def fields(p,seed=0):
    warp=np.column_stack([noise(p,35,seed+10+i) for i in range(3)])-.5
    q=p+warp*.012
    geology=.69*noise(q,62,seed+20)+.22*noise(q,135,seed+21)+.09*noise(q,310,seed+22)
    plateau=smoothstep(.45,.59,geology)
    grain=noise(p,360,seed+25)
    broad=noise(p,9,seed+29)
    return geology,plateau,grain,broad

def mesh_object(name,verts,faces):
    me=bpy.data.meshes.new(name+' mesh')
    me.from_pydata(verts,[],faces);me.update()
    assert not me.validate(), 'Invalid constructed mesh'
    ob=bpy.data.objects.new(name,me);scene.collection.objects.link(ob)
    return ob

def make_stone(name,seed=713,hx=.2,hy=.15,hz=.04,res=1):
    # A welded surface grid retains millimetre-scale relief without radial fans.
    vertices=[];faces=[]
    counts=[int(320*res),int(240*res),int(64*res)]
    half=np.array([hx,hy,hz])
    for axis in range(3):
        a,b=[j for j in range(3) if j!=axis]
        for sign in (-1,1):
            u,v=np.meshgrid(np.linspace(-half[a],half[a],counts[a]+1),np.linspace(-half[b],half[b],counts[b]+1))
            p=np.zeros((u.size,3));p[:,axis]=sign*half[axis];p[:,a]=u.ravel();p[:,b]=v.ravel()
            start=len(vertices);vertices.extend(p.tolist())
            ids=np.arange(len(p)).reshape(u.shape)+start
            quads=np.stack([ids[:-1,:-1],ids[:-1,1:],ids[1:,1:],ids[1:,:-1]],axis=-1).reshape(-1,4)
            faces.extend(quads.tolist())
    p=np.array(vertices)
    # Variable edge radius plus macro outline warp, all evaluated in metric space.
    radius=.003+.005*noise(p,18,seed+1)
    core=half-radius[:,None]
    clamped=np.clip(p,-core,core)
    delta=p-clamped
    norm=delta/np.maximum(np.linalg.norm(delta,axis=1)[:,None],1e-10)
    p=clamped+norm*radius[:,None]
    for axis in (0,1):
        p[:,axis]+=.0035*(noise(p,13,seed+2+axis)-.5)
    g,plateau,grain,broad=fields(p,seed)
    # Pits occupy lower chalky matrix between smoother, mineral-rich plateaus.
    top=np.clip(norm[:,2],0,1)
    relief=(plateau-.55)*.0018+(grain-.5)*.00045+(broad-.5)*.0018
    side_relief=(noise(p,46,seed+40)-.5)*.0025+(noise(p,135,seed+41)-.5)*.0009
    p+=norm*(top*relief+(1-top)*side_relief)[:,None]
    # Irregular shallow edge losses overlap, with variable slopes and broken outlines.
    rng=np.random.default_rng(seed)
    for i in range(44):
        axis=i%2;sgn=-1 if (i//2)%2 else 1
        c=np.array([rng.uniform(-hx,hx),rng.uniform(-hy,hy),hz-rng.uniform(.001,.018)])
        c[axis]=sgn*(half[axis]-rng.uniform(0,.006))
        radii=np.array([rng.uniform(.006,.020),rng.uniform(.006,.021),rng.uniform(.006,.017)])
        d=(p-c)/radii
        r=np.sqrt(np.sum(d*d,axis=1))
        jag=(noise(p,220,seed+i+90)-.5)*.40
        loss=np.clip(1-r+jag,0,1)**.75*rng.uniform(.002,.007)
        p-=norm*loss[:,None]
    p[:,2]+=hz
    ob=mesh_object(name,p.tolist(),faces)
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    assert all(e.is_manifold for e in bm.edges)
    bm.to_mesh(ob.data);bm.free()
    co=np.empty(len(ob.data.vertices)*3);ob.data.vertices.foreach_get('co',co)
    co=co.reshape(-1,3);co[:,2]-=hz
    geology,plateau,grain,broad=fields(co,seed)
    for attr,values in [('geology',geology),('plateau',plateau),('grain',grain),('broad',broad)]:
        layer=ob.data.attributes.new(attr,'FLOAT','POINT');layer.data.foreach_set('value',values.astype(np.float32))
    for poly in ob.data.polygons:poly.use_smooth=True
    ob['seed']=seed;ob['authoring']='Coherent metric relief and mineral fields with localized fractured edges'
    ob.data.materials.append(stone_material())
    return ob

def ramp(nodes,links,source,name,stops):
    n=nodes.new('ShaderNodeValToRGB');n.label=name
    r=n.color_ramp
    while len(r.elements)>2:r.elements.remove(r.elements[-1])
    for i,(pos,col) in enumerate(stops):
        e=r.elements[i] if i<2 else r.elements.new(pos)
        e.position=pos;e.color=(*col,1)
    r.interpolation='EASE';links.new(source,n.inputs[0]);return n.outputs['Color']

def stone_material():
    name=f'Original limestone correlated surface cycle{CYCLE}'
    if name in bpy.data.materials:return bpy.data.materials[name]
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    n,l=mat.node_tree.nodes,mat.node_tree.links
    bs=n.get('Principled BSDF');bs.inputs['Roughness'].default_value=.78
    attrs={}
    for name in ('geology','plateau','grain','broad'):
        attr=n.new('ShaderNodeAttribute');attr.attribute_name=name;attrs[name]=attr.outputs['Fac']
    col=ramp(n,l,attrs['geology'],'Mineral matrix / worn plateaus',[
        (.22,(.38,.32,.235)),(.43,(.57,.49,.37)),(.51,(.43,.405,.335)),(.63,(.23,.245,.218)),(.8,(.30,.31,.275))])
    coord=n.new('ShaderNodeTexCoord')
    fine=n.new('ShaderNodeTexNoise');fine.inputs['Scale'].default_value=1300;fine.inputs['Detail'].default_value=2.5
    l.new(coord.outputs['Object'],fine.inputs['Vector'])
    mineral=ramp(n,l,fine.outputs['Fac'],'Fine granular reflectance',[(.22,(.42,.38,.32)),(.48,(.82,.79,.72)),(.72,(1,1,.97))])
    mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.55
    l.new(col,mix.inputs[1]);l.new(mineral,mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Base Color'])
    rough=n.new('ShaderNodeMapRange');rough.inputs['To Min'].default_value=.9;rough.inputs['To Max'].default_value=.62
    l.new(attrs['plateau'],rough.inputs['Value']);l.new(rough.outputs[0],bs.inputs['Roughness'])
    vor=n.new('ShaderNodeTexVoronoi');vor.inputs['Scale'].default_value=1750;l.new(coord.outputs['Object'],vor.inputs['Vector'])
    pores=ramp(n,l,vor.outputs['Distance'],'Fine isolated pore relief',[(.12,(0,0,0)),(.28,(.8,.8,.8)),(.8,(1,1,1))])
    bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00022;bump.inputs['Strength'].default_value=.45
    l.new(pores,bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal'])
    return mat

def simple_material(name,color,roughness):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness
    return mat

def point_camera(location,target,lens=55):
    camera.location=location;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens

scene=bpy.data.scenes.new(f'Complete limestone study cycle{CYCLE}')
bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
stone=make_stone('Surface study master')
ground=mesh_object('Neutral support',[(-5,-5,-.003),(5,-5,-.003),(5,5,-.003),(-5,5,-.003)],[(0,1,2,3)])
ground.data.materials.append(simple_material('Warm gray support',(.16,.145,.12),.9))
world=bpy.data.worlds.new('Neutral ambient');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.64,.72,.85,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.28;scene.world=world
ld=bpy.data.lights.new('Broad daylight key','AREA');ld.energy=45;ld.shape='DISK';ld.size=.65
light=bpy.data.objects.new('Broad daylight key',ld);scene.collection.objects.link(light);light.location=(-.6,-.5,.9)
light.rotation_euler=(Vector((0,0,.03))-light.location).to_track_quat('-Z','Y').to_euler()
cd=bpy.data.cameras.new('Study camera');camera=bpy.data.objects.new('Study camera',cd);scene.collection.objects.link(camera);scene.camera=camera
camera.data.clip_start=.01;point_camera((.51,-.59,.48),(0,0,.035))
scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU'
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
scene.render.filepath=str(OUT/'oblique.png')
bpy.context.view_layer.update()
for o in bpy.context.selected_objects:o.select_set(False)
stone.select_set(True);bpy.context.view_layer.objects.active=stone
metrics={'createdUtc':datetime.now(timezone.utc).isoformat(),'buildSeconds':time.perf_counter()-START,
 'version':bpy.app.version_string,'cycle':CYCLE,'seed':int(stone['seed']),'vertices':len(stone.data.vertices),
 'triangles':sum(len(p.vertices)-2 for p in stone.data.polygons),'dimensionsM':list(stone.dimensions),
 'references':['batch-104/kit-002-stone-family-v4.png','batch-108/mat-001-cream-limestone-v1.png','batch-103/kit-001-paving-assembly-v1.png'],
 'scope':'Original source authoring study; no library admission or runtime acceptance'}
(OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
(OUT/'build.py').write_text((ROOT/'build.py').read_text())
bpy.data.libraries.write(str(OUT/'source.blend'),{scene},fake_user=True,compress=True)
result=metrics
