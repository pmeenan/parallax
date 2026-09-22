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
CYCLE = 101
OUT = Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21/stone/candidate1')
OUT.mkdir(parents=True, exist_ok=True)
assert bpy.app.version[:3] == (5, 2, 1)
START = time.perf_counter()
HEIGHT = bpy.data.images.load(str(ROOT/'inputs/limestone-height-v1.png'),check_existing=True)
HEIGHT.colorspace_settings.name='Non-Color'
_pixels=np.empty(HEIGHT.size[0]*HEIGHT.size[1]*4,dtype=np.float32)
HEIGHT.pixels.foreach_get(_pixels)
HEIGHT_PIXELS=_pixels.reshape(HEIGHT.size[1],HEIGHT.size[0],4)[:,:,0]
# Filter this synthetic scalar field before geometric displacement.
for _ in range(3):
    HEIGHT_PIXELS=(np.roll(HEIGHT_PIXELS,1,axis=0)+2*HEIGHT_PIXELS+np.roll(HEIGHT_PIXELS,-1,axis=0))/4
    HEIGHT_PIXELS=(np.roll(HEIGHT_PIXELS,1,axis=1)+2*HEIGHT_PIXELS+np.roll(HEIGHT_PIXELS,-1,axis=1))/4

HEIGHT_MACRO=HEIGHT_PIXELS.copy()
for _ in range(160):
    HEIGHT_MACRO=(np.roll(HEIGHT_MACRO,1,axis=0)+2*HEIGHT_MACRO+np.roll(HEIGHT_MACRO,-1,axis=0))/4
    HEIGHT_MACRO=(np.roll(HEIGHT_MACRO,1,axis=1)+2*HEIGHT_MACRO+np.roll(HEIGHT_MACRO,-1,axis=1))/4
MACRO=bpy.data.images.new(f'Authored mineral plateau field cycle{CYCLE}',width=HEIGHT.size[0],height=HEIGHT.size[1],float_buffer=True)
rgba=np.ones((HEIGHT.size[1],HEIGHT.size[0],4),dtype=np.float32);rgba[:,:,:3]=HEIGHT_MACRO[:,:,None]
MACRO.colorspace_settings.name='Non-Color';MACRO.pixels.foreach_set(rgba.ravel());MACRO.update();MACRO.pack()
assert MACRO.packed_file and max(MACRO.pixels[:128:4])>.1, 'Scalar image must survive initialization and packing'

def height_sample(p,normal,pixels=None):
    pixels=HEIGHT_PIXELS if pixels is None else pixels
    weights=np.abs(normal)**4
    weights/=np.maximum(weights.sum(axis=1)[:,None],1e-10)
    result=np.zeros(len(p))
    for axis,(a,b) in enumerate(((1,2),(0,2),(0,1))):
        uv=(p[:,[a,b]]/.45+.5)%1
        xx=uv[:,0]*(HEIGHT.size[0]-1);yy=uv[:,1]*(HEIGHT.size[1]-1)
        x=np.floor(xx).astype(int);y=np.floor(yy).astype(int);fx=xx-x;fy=yy-y
        result+=weights[:,axis]*((pixels[y,x]*(1-fx)+pixels[y,np.minimum(x+1,HEIGHT.size[0]-1)]*fx)*(1-fy)+(pixels[np.minimum(y+1,HEIGHT.size[1]-1),x]*(1-fx)+pixels[np.minimum(y+1,HEIGHT.size[1]-1),np.minimum(x+1,HEIGHT.size[0]-1)]*fx)*fy)
    return result

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
    counts=[int(640*res),int(480*res),int(112*res)]
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
    raw=p.copy()
    # Rounded but asymmetric cut corners, varying outline and side batter.
    p[:,0]*=1-(.055+.018*np.sign(raw[:,0])*np.sign(raw[:,1]))*np.abs(raw[:,1]/hy)**10
    p[:,1]*=1-(.067-.016*np.sign(raw[:,0]))*np.abs(raw[:,0]/hx)**10
    # Variable edge radius plus macro outline warp, all evaluated in metric space.
    radius=.003+.005*noise(p,18,seed+1)
    core=half-radius[:,None]
    clamped=np.clip(p,-core,core)
    delta=p-clamped
    norm=delta/np.maximum(np.linalg.norm(delta,axis=1)[:,None],1e-10)
    p=clamped+norm*radius[:,None]
    for axis in (0,1):
        p[:,axis]+=.013*(noise(p,15,seed+2+axis)-.5)
    g,plateau,grain,broad=fields(p,seed)
    texture_offset=np.array({713:(0,0,0),729:(.137,.093,0),751:(-.139,.17,0)}.get(seed,(0,0,0)))
    scalar=height_sample(p+texture_offset,norm)
    macro_scalar=height_sample(p+texture_offset,norm,HEIGHT_MACRO)
    # Pits occupy lower chalky matrix between smoother, mineral-rich plateaus.
    top=np.clip(norm[:,2],0,1)
    wear=1-smoothstep(.60,.69,macro_scalar)
    relief=(np.minimum(macro_scalar,.61)-.57)*.0045+(np.minimum(scalar,.61)-np.minimum(macro_scalar,.61))*.0045*(1-.72*wear)+(broad-.5)*.0012
    side_relief=(np.minimum(macro_scalar,.73)-.57)*.005+(noise(p,36,seed+40)-.5)*.0022
    p+=norm*(top*relief+(1-top)*side_relief)[:,None]
    edge_distance=np.minimum(hx-np.abs(raw[:,0]),hy-np.abs(raw[:,1]))
    edge_width=.004+.049*noise(p,22,seed+75)**2
    shoulder_loss=(.001+.020*noise(p,22,seed+76)**3)*np.clip(1-edge_distance/edge_width,0,1)**1.3
    # Compress the complete local section: dropping only upward normals leaves
    # raised paper-like side lips. The bottom stays fixed and ordering is retained.
    p[:,2]-=np.clip((p[:,2]+hz)/(2*hz),0,1)*shoulder_loss
    # Unequal side batter reduces the extruded-cuboid reading.
    level=(raw[:,2]+hz)/(2*hz)
    for axis in (0,1):p[:,axis]*=1-(.025+.070*noise(p,10,seed+80+axis))*(1-level)
    # Irregular shallow edge losses overlap, with variable slopes and broken outlines.
    rng=np.random.default_rng(seed)
    for i in range(9):
        axis=i%2;sgn=-1 if (i//2)%2 else 1
        c=np.array([rng.uniform(-hx,hx),rng.uniform(-hy,hy),hz+rng.uniform(.002,.008)])
        c[axis]=sgn*(half[axis]-rng.uniform(0,.006))
        radii=np.array([rng.uniform(.013,.033),rng.uniform(.013,.033),rng.uniform(.010,.026)])
        d=(p-c)/radii
        r=np.sum(np.abs(d)**1.4,axis=1)**(1/1.4)
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
    ob.data.materials.append(stone_material(seed,texture_offset))
    return ob

def ramp(nodes,links,source,name,stops):
    n=nodes.new('ShaderNodeValToRGB');n.label=name
    r=n.color_ramp
    while len(r.elements)>2:r.elements.remove(r.elements[-1])
    for i,(pos,col) in enumerate(stops):
        e=r.elements[i] if i<2 else r.elements.new(pos)
        e.position=pos;e.color=(*col,1)
    r.interpolation='EASE';links.new(source,n.inputs[0]);return n.outputs['Color']

def stone_material(seed,texture_offset):
    name=f'Original limestone correlated surface cycle{CYCLE} seed{seed}'
    if name in bpy.data.materials:return bpy.data.materials[name]
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    n,l=mat.node_tree.nodes,mat.node_tree.links
    bs=n.get('Principled BSDF');bs.inputs['Roughness'].default_value=.78
    coord=n.new('ShaderNodeTexCoord')
    mapping=n.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY_ADD'
    mapping.inputs[1].default_value=(1/.45,1/.45,1/.45)
    mapping.inputs[2].default_value=tuple(np.array((.5,.5,.5-.04/.45))+texture_offset/.45)
    l.new(coord.outputs['Object'],mapping.inputs[0])
    height_tex=n.new('ShaderNodeTexImage');height_tex.image=HEIGHT;height_tex.projection='BOX';height_tex.projection_blend=.2
    l.new(mapping.outputs[0],height_tex.inputs['Vector'])
    macro_tex=n.new('ShaderNodeTexImage');macro_tex.image=MACRO;macro_tex.projection='BOX';macro_tex.projection_blend=.2
    l.new(mapping.outputs[0],macro_tex.inputs['Vector'])
    # The reference mineral boundaries remain, but brightness is not photographic.
    # No albedo image or pore-scale scalar connects to Base Color.
    col=ramp(n,l,macro_tex.outputs['Color'],'Authored mineral reflectance, no pore light',[
        (.25,(.14,.127,.108)),(.43,(.12,.119,.108)),(.60,(.135,.13,.117)),
        (.665,(.215,.196,.163)),(.735,(.34,.30,.235)),(.87,(.36,.315,.25))])
    l.new(col,bs.inputs['Base Color'])
    rough=n.new('ShaderNodeMapRange');rough.inputs['From Min'].default_value=.5;rough.inputs['From Max'].default_value=.75
    rough.inputs['To Min'].default_value=.67;rough.inputs['To Max'].default_value=.86
    l.new(macro_tex.outputs['Color'],rough.inputs['Value']);l.new(rough.outputs[0],bs.inputs['Roughness'])
    strength=n.new('ShaderNodeMapRange');strength.inputs['From Min'].default_value=.60;strength.inputs['From Max'].default_value=.70
    strength.inputs['To Min'].default_value=.10;strength.inputs['To Max'].default_value=.32
    l.new(macro_tex.outputs['Color'],strength.inputs['Value'])
    bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00010
    l.new(strength.outputs[0],bump.inputs['Strength'])
    l.new(height_tex.outputs['Color'],bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal'])
    return mat

def simple_material(name,color,roughness):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness
    return mat

def point_camera(location,target,lens=55):
    camera.location=location;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens

scene=bpy.data.scenes.new('Paving proof stone candidate1')
bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
stone=make_stone('Paving proof stone candidate1 master')
ground=mesh_object('Neutral support',[(-5,-5,-.003),(5,-5,-.003),(5,5,-.003),(-5,5,-.003)],[(0,1,2,3)])
ground.data.materials.append(simple_material('Warm gray support',(.16,.145,.12),.9))
world=bpy.data.worlds.new('Neutral ambient');world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.78,.82,.88,1)
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
(OUT/'resolved_build.py').write_text(SOURCE_TEXT)
bpy.data.libraries.write(str(OUT/'source.blend'),{scene},fake_user=True,compress=True)
result=metrics
