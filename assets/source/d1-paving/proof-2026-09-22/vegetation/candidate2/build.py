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
rng=random.Random(922602)
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
    if space=='sRGB':data=np.where(data<=.0031308,data*12.92,1.055*np.maximum(data,0)**(1/2.4)-.055)
    rgba=np.concatenate([data,np.ones((S,S,1))],axis=2).astype(np.float32)
    im=bpy.data.images.new(name,width=S,height=S,alpha=False,float_buffer=True);im.colorspace_settings.name=space;im.pixels.foreach_set(rgba.ravel());im.filepath_raw=str(OUT/(name+'.png'));im.file_format='PNG'
    scene.render.image_settings.color_depth='16';im.save()
    file=im.filepath_raw;bpy.data.images.remove(im);im=bpy.data.images.load(file,check_existing=False);im.name=name;im.colorspace_settings.name=space;im.pack();maps[name]=im;return im
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
        # Smooth curved taper, five rings. Lateral travel accelerates above the joint crown.
        delta=b-a;start=len(verts)
        for ring in range(5):
            t=ring/4;p=a+Vector((delta.x*t*t,delta.y*t*t,delta.z*t));axis=Vector((delta.x*max(.05,2*t),delta.y*max(.05,2*t),delta.z)).normalized();side=axis.cross(Vector((0,0,1)))
            if side.length<.001:side=axis.cross(Vector((1,0,0)))
            side.normalize();other=axis.cross(side);radius=r*(1-.45*t)
            for k in range(5):verts.append(tuple(p+radius*(math.cos(k*math.tau/5)*side+math.sin(k*math.tau/5)*other)))
        for ring in range(4):
            for k in range(5):faces.append((start+ring*5+k,start+ring*5+(k+1)%5,start+(ring+1)*5+(k+1)%5,start+(ring+1)*5+k))
    return mesh(name,verts,faces,stemmat)
def weed(name,x,y,seedling=False):
    root=Vector((x,y,soil_z(x,y)-.003));crown=Vector((x,y,.084));segments=[(root,crown,.00065 if seedling else .0012)]
    verts=[];faces=[];uv=[];num=2 if seedling else 4;phase=rng.uniform(0,math.tau)
    for j in range(num):
        angle=phase+(j*math.pi+rng.uniform(-.15,.15) if seedling else [0,1.45,3.30,4.95][j]+rng.uniform(-.13,.13));direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0))
        length=rng.uniform(.009,.014) if seedling else rng.uniform(.031,.051);width=length*rng.uniform(.64,.78) if seedling else length*rng.uniform(.55,.69)
        rise=rng.uniform(.001,.003) if seedling else rng.uniform(.001,.007);curl=rng.uniform(.001,.004)
        base=crown+direction*rng.uniform(.002,.006)+Vector((0,0,.004 if seedling else .007));segments.append((crown,base,.00040 if seedling else .00065))
        rows=10 if seedling else 18;cols=5 if seedling else 7;start=len(verts);twist=rng.uniform(-.0015,.0015)
        verts.append(tuple(base));uv.append((.5,0))
        for k in range(1,rows):
            t=k/rows;mid=base+direction*length*t+side*(.002*math.sin(math.pi*t))+Vector((0,0,rise*t+.0035*math.sin(math.pi*t)-curl*t**3))
            half=width*.5*math.sin(math.pi*t)**.50*(.88+.12*t)
            for q in np.linspace(-1,1,cols):
                irregular=1+.018*math.sin(t*17+j*2)+(0.04 if q<0 else -.02)
                point=mid+side*(q*half*irregular)+Vector((0,0,(q*q)*.0022*math.sin(math.pi*t)+q*twist*math.sin(t*math.pi)))
                verts.append(tuple(point));uv.append(((q+1)/2,t))
        end=len(verts);verts.append(tuple(base+direction*length+Vector((0,0,rise-curl))));uv.append((.5,1))
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
drymat=flatmat('Subdued old grass blade',(.085,.065,.025));grasslight=flatmat('Fresh grass blade',(.038,.073,.013))
for i in range(5):
    x,y=nearby(anchors[[0,1,1,4,7][i]],.20);z=soil_z(x,y)-.002;verts=[];faces=[];material_ids=[]
    for j in range(7):
        angle=rng.uniform(0,math.tau);direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0));height=rng.uniform(.018,.040);reach=rng.uniform(.020,.037);width=rng.uniform(.0013,.0025);start=len(verts);twist=rng.uniform(-1,1)
        for k in range(8):
            t=k/8;mid=Vector((x,y,z))+direction*(reach*t*t)+Vector((0,0,height*math.sin(t*math.pi*.68)));blade_side=side*math.cos(twist*t)+Vector((0,0,1))*math.sin(twist*t)
            for sign in [-1,1]:verts.append(tuple(mid+blade_side*(sign*width*(1-t)**.8*.5)))
        tip=len(verts);verts.append(tuple(Vector((x,y,z))+direction*reach+Vector((0,0,height*math.sin(math.pi*.68)))))
        for k in range(7):faces.append((start+k*2,start+k*2+1,start+k*2+3,start+k*2+2));material_ids.append(1 if j==0 else j%3)
        faces.append((tip-2,tip-1,tip));material_ids.append(1 if j==0 else j%3)
    ob=mesh('Bowed uneven grass '+str(i),verts,faces,grassmat);ob.data.materials.append(drymat);ob.data.materials.append(grasslight)
    for p,m in zip(ob.data.polygons,material_ids):p.material_index=m
    records.append({'name':ob.name,'type':'grass','root':[x,y,z]})
# Fine original moss color/normal maps on connected low organic cushions; no ico pellets.
fine_moss=(np.sin(u*213+np.sin(v*103)*3)*np.sin(v*319+np.sin(u*137)*2)+np.sin(u*457-v*293))*.25+.5
mh=.00010*fine_moss+.00004*np.sin(u*79+v*31)**2
mcolor=np.stack([.016+.010*fine_moss,.029+.024*fine_moss,.004+.006*fine_moss],axis=-1)
mdy,mdx=np.gradient(mh,.055/(S-1),.008/(S-1));mn=np.stack([-mdx,-mdy,np.ones_like(mdx)],axis=-1);mn/=np.linalg.norm(mn,axis=-1)[...,None]
mc=image('moss-basecolor',mcolor,'sRGB');mi=image('moss-normal',mn*.5+.5,'Non-Color');image('moss-height',mh/.0002,'Non-Color')
nodes,links=mossmat.node_tree.nodes,mossmat.node_tree.links;mb=nodes['Principled BSDF'];mb.inputs['Roughness'].default_value=.97
tn=nodes.new('ShaderNodeTexImage');tn.image=mc;links.new(tn.outputs['Color'],mb.inputs['Base Color']);tn=nodes.new('ShaderNodeTexImage');tn.image=mi;nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.45;links.new(tn.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs[0],mb.inputs['Normal'])
for i in range(4):
    x,y=nearby(anchors[[0,1,4,7][i]],.11,.004)
    # Orient cushion along the closest stone edge and keep its boundary seated in soil.
    distances=[]
    for a in rects:distances.extend([(abs(x-a[0]),0),(abs(x-a[2]),0),(abs(y-a[1]),1),(abs(y-a[3]),1)])
    axis=min(distances)[1];along=Vector((0,1,0)) if axis==0 else Vector((1,0,0));across=Vector((1,0,0)) if axis==0 else Vector((0,1,0))
    verts=[];uv=[];faces=[];allowed=[];length=rng.uniform(.040,.065)
    for row in range(19):
        t=row/18;half=.0035*(.65+.35*math.sin(t*17+i))
        for col in range(7):
            q=col/3-1;p=Vector((x,y,0))+along*((t-.5)*length)+across*(q*half);free=not stone_at(p.x,p.y,.0003);height=.0010*max(0,1-q*q)*math.sin(math.pi*t)**.5
            z=soil_z(p.x,p.y)+height-.00025;verts.append((p.x,p.y,z));uv.append((col/6,t));allowed.append(free)
    for row in range(18):
        for col in range(6):
            quad=(row*7+col,row*7+col+1,(row+1)*7+col+1,(row+1)*7+col)
            if all(allowed[k] for k in quad):faces.append(quad)
    mesh('Low connected moss cushion '+str(i),verts,faces,mossmat,uv);records.append({'name':'Low connected moss cushion '+str(i),'type':'moss','root':[x,y,soil_z(x,y)]})
after={o.name:signature(o) for o in scene.objects if o.type=='MESH' and o not in plant_objects};assert before==after
counts={o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in plant_objects};total=sum(counts.values())
# Native render controls are temporary copies; the saved source restores original assignments/light/camera.
camera=scene.camera;light=next(o for o in scene.objects if o.type=='LIGHT');cam_state=(camera.location.copy(),camera.rotation_euler.copy(),camera.data.lens);light_state=(light.location.copy(),light.rotation_euler.copy(),light.data.energy,light.data.size);world_strength=scene.world.node_tree.nodes['Background'].inputs[1].default_value
original_mats={o.name:list(o.data.materials) for o in plant_objects};controls={}
for mode in ['gray','geometry','unlit']:
    controls[mode]={}
    for mat in {m for mats in original_mats.values() for m in mats}:
        m=mat.copy();m.name=mode+' '+mat.name;n,l=m.node_tree.nodes,m.node_tree.links;bs=n.get('Principled BSDF')
        if mode in ['gray','geometry']:
            for link in list(bs.inputs['Base Color'].links):l.remove(link)
            bs.inputs['Base Color'].default_value=(.18,.18,.18,1)
            if mode=='geometry':
                for link in list(bs.inputs['Normal'].links):l.remove(link)
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
for name,mode,eye_now,target_now,lens,reverse in [('close','full',eye,target,60,False),('close-opposing','full',eye,target,60,True),('close-gray','gray',eye,target,60,False),('close-unlit','unlit',eye,target,60,False),('close-geometry','geometry',eye,target,60,False),('overview','full',cam_state[0],Vector((0,0,.06)),cam_state[2],False),('walking','full',Vector((anchors[0][0]+.1,anchors[0][1]-.55,1.05)),Vector((anchors[0][0],anchors[0][1]+.12,.065)),50,False)]:
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
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'seconds':time.perf_counter()-START,'seed':922602,'source':str(BASE),'sourceSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'nonplantSignaturesUnchanged':before==after,'nonplantSignatures':before,'plantTriangles':total,'plantCounts':counts,'sceneTriangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH'),'plants':records,'views':views,'maps':{'resolution':[512,512],'basecolor':'Linear authored colors explicitly sRGB encoded toPNG, then file reloaded/packed; native uses delivered file, no scene shading','height':'Normalized to0.15mm range, original procedural source retained','normal':'Tangent normal generated by finite differences at34x65mm representative leaf dimensions, native strength0.6','roughness':'Non-Color authored biological variation'},'rightsReviewed':False,'sourceOnly':True,'productionGrass4PixelMapCeilingPassed':False,'triangleExcessReason':'Final source study spends additional leaf contour/curved petiole and moss cushion triangles to address first-cycle shape failures; no production budget change','plant4000TriangleTargetPassed':total<=4000,'knownLimitations':['Procedural plant maps are source study beyond4pixel production map ceiling','No full QA, engine validation or rights clearance','No comprehensive triangle-interior stone collision test'],'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir()) if p.suffix in {'.png','.blend','.py'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
