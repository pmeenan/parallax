"""Original native joint plants and procedural venation maps; first bounded candidate."""
import bpy,numpy as np,math,json,hashlib,time,random
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from datetime import datetime,timezone
OUT=Path(__file__).parent;BASE=OUT.parents[1]/'patch/candidate2/source.blend';START=time.perf_counter()
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.open_mainfile(filepath=str(BASE));scene=bpy.context.scene
old_names={'Rounded cupped asymmetric leaves','Rooted crowns and petioles','Readable curved midribs'}
def signature(ob):
    p=np.empty(len(ob.data.vertices)*3,np.float32);ob.data.vertices.foreach_get('co',p)
    faces=[list(f.vertices) for f in ob.data.polygons]
    mats=[]
    for mat in ob.data.materials:
        nodes=[(n.name,n.bl_idname,getattr(getattr(n,'image',None),'name',None),[(s.name,str(s.default_value)) for s in n.inputs if hasattr(s,'default_value')]) for n in mat.node_tree.nodes]
        links=[(x.from_node.name,x.from_socket.name,x.to_node.name,x.to_socket.name) for x in mat.node_tree.links]
        mats.append(hashlib.sha256(repr((nodes,links)).encode()).hexdigest())
    return {'mesh':hashlib.sha256(p.tobytes()+repr(faces).encode()).hexdigest(),'matrix':[list(row) for row in ob.matrix_world],'materials':mats}
before={o.name:signature(o) for o in scene.objects if o.type=='MESH' and o.name not in old_names}
for name in old_names:bpy.data.objects.remove(scene.objects[name],do_unlink=True)
rng=random.Random(922601)
baseline=json.loads((BASE.parent/'receipt.json').read_text());rects=np.array([[a['boundsM'][0][0],a['boundsM'][0][1],a['boundsM'][1][0],a['boundsM'][1][1]] for a in baseline['layout']])
def stone_at(x,y,margin=0):return bool(np.any((x>=rects[:,0]-margin)&(x<=rects[:,2]+margin)&(y>=rects[:,1]-margin)&(y<=rects[:,3]+margin)))
soil=scene.objects['Continuous adaptive compacted earth'];tree=BVHTree.FromPolygons([v.co[:] for v in soil.data.vertices],[p.vertices[:] for p in soil.data.polygons],all_triangles=True)
def soil_z(x,y):return tree.ray_cast(Vector((x,y,.3)),Vector((0,0,-1)),1)[0].z
# Leaf maps: no illumination is multiplied into color. Veins carry subtle biological color and relief.
S=512;u,v=np.meshgrid(np.linspace(0,1,S),np.linspace(0,1,S));center=.5+.014*np.sin(v*math.pi*1.6)
main=np.exp(-((u-center)/(.004+.004*(1-v)))**2)
secondary=np.zeros_like(u);tertiary=np.zeros_like(u)
for side in [-1,1]:
    d=np.maximum(side*(u-center),0)
    for k,start in enumerate([.10,.23,.36,.50,.63,.75,.85]):
        curve=start+.24*d+.28*d*d+.009*np.sin(d*13+k)
        mask=(side*(u-center)>0)*(d<.48)*(v<.99)
        strength=(1-.65*np.clip(d/.5,0,1))
        secondary=np.maximum(secondary,np.exp(-((v-curve)/(.0025+.0015*(1-d*2)))**2)*mask*strength)
        for branch in [.13,.25,.36]:
            branchcurve=start+.24*branch+.28*branch*branch+.009*math.sin(branch*13+k)+.55*(d-branch)
            tertiary=np.maximum(tertiary,np.exp(-((v-branchcurve)/.0014)**2)*mask*(d>branch)*(d<branch+.115)*.45)
fine=(np.sin(u*831+np.sin(v*421)*2)*np.sin(v*727+u*19)+np.sin(u*1367+v*913))*.5
broad=.50+.20*np.sin(u*14+v*8)+.13*np.sin(u*31-v*17)+.08*np.sin(u*67+v*43)
height=.000085*main+.000045*secondary+.000015*tertiary+.0000025*fine
color=np.zeros((S,S,3));color[:]=(.021,.054,.009)
color*=((.76+.48*broad)[...,None]);veins=np.clip(main*.28+secondary*.14+tertiary*.06,0,.4)
color+=veins[...,None]*np.array([.035,.040,.006])
# Restrained age/wear at a handful of nonuniform margin spots.
spots=np.zeros_like(u)
for x,y,r in [(.08,.25,.022),(.91,.59,.019),(.15,.78,.012),(.84,.36,.010)]:spots=np.maximum(spots,np.exp(-(((u-x)/r)**2+((v-y)/(r*.7))**2)))
color=color*(1-spots[...,None]*.45)+spots[...,None]*np.array([.037,.023,.005]);color+=fine[...,None]*.0006
rough=np.clip(.73-.09*main-.04*secondary+.04*(broad-.5),.6,.86)
dy,dx=np.gradient(height,.065/(S-1),.034/(S-1));normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1)[...,None];normal=normal*.5+.5
maps={}
def image(name,data,space):
    if data.ndim==2:data=np.repeat(data[:,:,None],3,axis=2)
    rgba=np.concatenate([data,np.ones((S,S,1))],axis=2).astype(np.float32)
    im=bpy.data.images.new(name,width=S,height=S,alpha=False,float_buffer=True);im.colorspace_settings.name=space;im.pixels.foreach_set(rgba.ravel());im.filepath_raw=str(OUT/(name+'.png'));im.file_format='PNG'
    scene.render.image_settings.color_depth='16';im.save();im.pack();maps[name]=im;return im
base=image('leaf-basecolor',np.clip(color,0,1),'sRGB');norm=image('leaf-normal',normal,'Non-Color');hmap=image('leaf-height',np.clip(height/.00015,0,1),'Non-Color');roughmap=image('leaf-roughness',rough,'Non-Color')
leafmat=bpy.data.materials.new('Authored joint weed color normal roughness');leafmat.use_nodes=True;n,l=leafmat.node_tree.nodes,leafmat.node_tree.links;bs=n['Principled BSDF'];bs.inputs['Roughness'].default_value=.75
for im,socket in [(base,'Base Color'),(roughmap,'Roughness')]:
    tex=n.new('ShaderNodeTexImage');tex.image=im;tex.interpolation='Linear';l.new(tex.outputs['Color'],bs.inputs[socket])
tex=n.new('ShaderNodeTexImage');tex.image=norm;nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.6;l.new(tex.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs[0],bs.inputs['Normal'])
bs.inputs['Subsurface Weight'].default_value=.025
def flatmat(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes['Principled BSDF'];b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=.88;return m
stemmat=flatmat('Living short petioles',(.042,.051,.009));grassmat=flatmat('Muted joint grass',(.025,.065,.012));mossmat=flatmat('Sheltered moss olive',(.016,.035,.005))
plant_objects=[];records=[]
def mesh(name,verts,faces,mat,uv=None):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update();assert not data.validate();data.materials.append(mat)
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);plant_objects.append(ob)
    for p in data.polygons:p.use_smooth=True
    if uv:
        layer=data.uv_layers.new(name='Leaf UV')
        for loop in data.loops:layer.data[loop.index].uv=uv[loop.vertex_index]
    return ob
def tubes(name,segments):
    verts=[];faces=[]
    for a,b,r in segments:
        axis=(b-a).normalized();side=axis.cross(Vector((0,0,1)))
        if side.length<.001:side=axis.cross(Vector((1,0,0)))
        side.normalize();other=axis.cross(side);start=len(verts)
        for p in [a,b]:
            for k in range(5):verts.append(tuple(p+r*(math.cos(k*math.tau/5)*side+math.sin(k*math.tau/5)*other)))
        for k in range(5):faces.append((start+k,start+(k+1)%5,start+5+(k+1)%5,start+5+k))
    return mesh(name,verts,faces,stemmat)
def weed(name,x,y,seedling=False):
    root=Vector((x,y,soil_z(x,y)-.003));crown=Vector((x,y,.086 if not seedling else .083));segments=[(root,crown,.0011 if seedling else .0017)]
    verts=[];faces=[];uv=[];num=2 if seedling else 5
    for j in range(num):
        angle=rng.uniform(0,math.tau);direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0))
        length=rng.uniform(.012,.022) if seedling else rng.uniform(.029,.060);width=length*rng.uniform(.43,.62);rise=rng.uniform(.003,.014) if seedling else rng.uniform(.002,.036)
        base=crown+direction*rng.uniform(.003,.012)+Vector((0,0,rng.uniform(.002,.01)));segments.append((crown,base,.00055 if seedling else .0008))
        rows=6 if seedling else 12;cols=3 if seedling else 5;start=len(verts);curl=rng.uniform(-.004,.006)
        # Single tip vertices prevent collapsed UV/geometry quads at the outline ends.
        verts.append(tuple(base));uv.append((.5,0))
        for k in range(1,rows):
            t=k/rows;mid=base+direction*length*t+side*(.003*math.sin(math.pi*t)*rng.uniform(.95,1.05))+Vector((0,0,rise*t+.004*math.sin(math.pi*t)+curl*t**3))
            half=width*.5*math.sin(math.pi*t)**.65*(.75+.25*t)
            for q in np.linspace(-1,1,cols):
                irregular=1+.045*math.sin(t*27+j*2)+(0.05 if q<0 else -.025)
                point=mid+side*(q*half*irregular)+Vector((0,0,(q*q)*.0035*math.sin(math.pi*t)+q*.0015*math.sin(t*math.pi*1.3)))
                verts.append(tuple(point));uv.append(((q+1)/2,t))
        end=len(verts);verts.append(tuple(base+direction*length+Vector((0,0,rise+curl))));uv.append((.5,1))
        for q in range(cols-1):faces.append((start,start+1+q,start+2+q))
        for k in range(rows-2):
            for q in range(cols-1):faces.append((start+1+k*cols+q,start+1+(k+1)*cols+q,start+2+(k+1)*cols+q,start+2+k*cols+q))
        for q in range(cols-1):faces.append((end-cols+q,end,end-cols+q+1))
    ob=mesh(name,verts,faces,leafmat,uv);tubes(name+' petioles',segments);records.append({'name':name,'type':'seedling' if seedling else 'broadleaf','root':list(root),'crown':list(crown)})
    return ob
anchors=sorted(baseline['plantRoots'],key=lambda p:p[0]**2+p[1]**2)
for i,index in enumerate([0,1,4,7]):weed('Broadleaf weed '+str(i),*anchors[index][:2])
def nearby(anchor,radius,margin=.003):
    for trial in range(10000):
        x=anchor[0]+rng.uniform(-radius,radius);y=anchor[1]+rng.uniform(-radius,radius)
        if not stone_at(x,y,margin):return x,y
    raise RuntimeError('No rooted joint location found')
for i in range(5):weed('Small seedling '+str(i),*nearby(anchors[[0,0,1,4,4][i]],.15),seedling=True)
for i in range(5):
    x,y=nearby(anchors[[0,1,1,4,7][i]],.24);z=soil_z(x,y)-.002;verts=[];faces=[]
    for j in range(6):
        angle=rng.uniform(0,math.tau);direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0));height=rng.uniform(.022,.060);reach=rng.uniform(.005,.022);width=rng.uniform(.001,.0022);start=len(verts)
        for k in range(6):
            t=k/5;mid=Vector((x,y,z))+direction*(reach*t*t)+Vector((0,0,height*(t-.15*t*t)))
            for sign in [-1,1]:verts.append(tuple(mid+side*(sign*width*(1-t*.95)*.5)))
        for k in range(5):faces.append((start+k*2,start+k*2+1,start+k*2+3,start+k*2+2))
    mesh('Fine grass tuft '+str(i),verts,faces,grassmat);records.append({'name':'Fine grass tuft '+str(i),'type':'grass','root':[x,y,z]})
import bmesh
bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=1,radius=1);bm.verts.ensure_lookup_table();bm.verts.index_update();template=np.array([v.co[:] for v in bm.verts]);tf=[tuple(v.index for v in f.verts) for f in bm.faces];bm.free()
verts=[];faces=[]
for i in range(4):
    x,y=nearby(anchors[[0,1,4,7][i]],.1,.002)
    for j in range(9):
        a,b=nearby((x,y),.018,.001);z=soil_z(a,b);r=rng.uniform(.0018,.0045);start=len(verts);verts.extend((template*np.array([r,r*.65,.0012])+[a,b,z+.0001]).tolist());faces.extend([tuple(start+k for k in f) for f in tf])
    records.append({'name':'Low moss pocket '+str(i),'type':'moss','root':[x,y,soil_z(x,y)]})
mesh('Low moss in protected joints',verts,faces,mossmat)
after={o.name:signature(o) for o in scene.objects if o.type=='MESH' and o not in plant_objects};assert before==after
counts={o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in plant_objects};total=sum(counts.values())
# Native render controls are temporary copies; the saved source restores original assignments/light/camera.
camera=scene.camera;light=next(o for o in scene.objects if o.type=='LIGHT');cam_state=(camera.location.copy(),camera.rotation_euler.copy(),camera.data.lens);light_state=(light.location.copy(),light.rotation_euler.copy(),light.data.energy,light.data.size);world_strength=scene.world.node_tree.nodes['Background'].inputs[1].default_value
original_mats={o.name:list(o.data.materials) for o in plant_objects};controls={}
for mode in ['gray','unlit']:
    controls[mode]={}
    for mat in {m for mats in original_mats.values() for m in mats}:
        m=mat.copy();m.name=mode+' '+mat.name;n,l=m.node_tree.nodes,m.node_tree.links;bs=n.get('Principled BSDF')
        if mode=='gray':
            for link in list(bs.inputs['Base Color'].links):l.remove(link)
            bs.inputs['Base Color'].default_value=(.18,.18,.18,1)
        else:
            emission=n.new('ShaderNodeEmission');src=bs.inputs['Base Color'];emission.inputs['Color'].default_value=src.default_value
            if src.is_linked:l.new(src.links[0].from_socket,emission.inputs['Color'])
            l.new(emission.outputs[0],n.get('Material Output').inputs['Surface'])
        controls[mode][mat.name]=m
scene.cycles.samples=128;scene.cycles.device='GPU';scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.render.resolution_x=1800;scene.render.resolution_y=1350;scene.render.resolution_percentage=100
anchor=Vector((*anchors[0][:2],.082));eye=anchor+Vector((.17,-.20,.23));target=anchor+Vector((0,0,.025))
views=[]
for name,mode,eye_now,target_now,lens,reverse in [('close','full',eye,target,60,False),('close-opposing','full',eye,target,60,True),('close-gray','gray',eye,target,60,False),('close-unlit','unlit',eye,target,60,False),('overview','full',cam_state[0],Vector((0,0,.06)),cam_state[2],False),('walking','full',Vector((.15,-1.7,1.7)),Vector((.05,.15,.065)),42,False)]:
    for o in plant_objects:
        for i,m in enumerate(original_mats[o.name]):o.data.materials[i]=m if mode=='full' else controls[mode][m.name]
    camera.location=eye_now;camera.rotation_euler=(target_now-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=light_state[0] if not reverse else Vector((3,4,6));light.rotation_euler=(Vector((0,0,.06))-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);views.append({'name':name,'mode':mode,'eye':list(eye_now),'target':list(target_now),'lens':lens,'opposingLight':reverse})
for o in plant_objects:
    for i,m in enumerate(original_mats[o.name]):o.data.materials[i]=m
camera.location,camera.rotation_euler,camera.data.lens=cam_state;light.location,light.rotation_euler,light.data.energy,light.data.size=light_state
assert before=={o.name:signature(o) for o in scene.objects if o.type=='MESH' and o not in plant_objects}
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'seconds':time.perf_counter()-START,'seed':922601,'source':str(BASE),'sourceSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'nonplantSignaturesUnchanged':before==after,'nonplantSignatures':before,'plantTriangles':total,'plantCounts':counts,'sceneTriangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'),'plants':records,'views':views,'maps':{'resolution':[512,512],'basecolor':'sRGB image from authored linear color, no scene shading','height':'Normalized to0.15mm range, original procedural source retained','normal':'Tangent normal generated by finite differences at34x65mm representative leaf dimensions, native strength0.6','roughness':'Non-Color authored biological variation'},'rightsReviewed':False,'sourceOnly':True,'productionGrass4PixelMapCeilingPassed':False,'plant4000TriangleTargetPassed':total<=4000,'knownLimitations':['Procedural plant maps are source study beyond4pixel production map ceiling','No full QA, engine validation or rights clearance','No comprehensive triangle-interior stone collision test'],'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir()) if p.suffix in {'.png','.blend','.py'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
