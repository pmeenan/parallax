"""Original explicit moss shoots, bounded native source study. No underlying sheet."""
import bpy, numpy as np, math, random, json, hashlib, time
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
OUT=Path(__file__).parent; BASE=OUT.parents[1]/'leaf-color/candidate2/source.blend'; START=time.perf_counter(); rng=random.Random(922801)
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.open_mainfile(filepath=str(BASE)); scene=bpy.context.scene
def signature(o):
    d=o.data; a=np.empty(len(d.vertices)*3,np.float32);d.vertices.foreach_get('co',a)
    attrs={x.name:[tuple(e.color) for e in x.data] for x in d.color_attributes}
    return hashlib.sha256(a.tobytes()+repr(([list(p.vertices) for p in d.polygons],[[tuple(x.uv) for x in l.data] for l in d.uv_layers],attrs,[list(r) for r in o.matrix_world],[m.name for m in d.materials])).encode()).hexdigest()
def mat_sig(m):
    if not m.use_nodes:return str(m.diffuse_color)
    return hashlib.sha256(repr(([(n.name,n.bl_idname,getattr(getattr(n,'image',None),'name',None),[(s.name,str(s.default_value)) for s in n.inputs if hasattr(s,'default_value')]) for n in m.node_tree.nodes],[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in m.node_tree.links])).encode()).hexdigest()
old=[o for o in scene.objects if o.name.startswith('Low connected moss cushion')]
centers=[sum((v.co for v in o.data.vertices),Vector())/len(o.data.vertices) for o in old]
before={o.name:signature(o) for o in scene.objects if o.type=='MESH' and o not in old}; materials={m.name:mat_sig(m) for o in scene.objects if o.type=='MESH' and o not in old for m in o.data.materials}
for o in old:bpy.data.objects.remove(o,do_unlink=True)
soil=scene.objects['Continuous adaptive compacted earth'];tree=BVHTree.FromPolygons([v.co[:] for v in soil.data.vertices],[p.vertices[:] for p in soil.data.polygons],all_triangles=True)
layout=json.loads((OUT.parents[1]/'patch/candidate2/receipt.json').read_text())['layout'];rects=np.array([[p['boundsM'][0][0],p['boundsM'][0][1],p['boundsM'][1][0],p['boundsM'][1][1]] for p in layout])
def blocked(x,y,margin=.0002):return bool(np.any((x>=rects[:,0]-margin)&(x<=rects[:,2]+margin)&(y>=rects[:,1]-margin)&(y<=rects[:,3]+margin)))
def soil_z(x,y):
    hit=tree.ray_cast(Vector((x,y,.4)),Vector((0,0,-1)),1)[0]
    return hit.z if hit else None
def clearance(x,y):
    dx=np.maximum(np.maximum(rects[:,0]-x,x-rects[:,2]),0);dy=np.maximum(np.maximum(rects[:,1]-y,y-rects[:,3]),0)
    return float(np.min(np.sqrt(dx*dx+dy*dy)))
m=bpy.data.materials.new('Moss living olive leafy shoots');m.use_nodes=True;bs=m.node_tree.nodes['Principled BSDF'];bs.inputs['Roughness'].default_value=.86
vc=m.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='MossColor';m.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
objects=[];records=[];all_heights=[];rejected=0
for colony,oldcenter in enumerate(centers):
    # Choose a nearby wider joint pocket, not a straight strip against a stone wall.
    options=[]
    for dx in np.linspace(-.105,.105,43):
        for dy in np.linspace(-.105,.105,43):
            x,y=oldcenter.x+dx,oldcenter.y+dy
            if blocked(x,y) or soil_z(x,y) is None:continue
            c=clearance(x,y);score=min(c,.022)-.035*math.hypot(dx,dy)
            options.append((score,x,y,c))
    _,cx,cy,clear=max(options);verts=[];faces=[];colors=[];roots=[]
    sub=[(0,0,.008),(-.009,.004,.006),(.008,-.006,.005),(.004,.010,.004)]
    attempts=0
    while len(roots)<390 and attempts<12000:
        attempts+=1;sx,sy,r=rng.choice(sub);angle=rng.uniform(0,math.tau);rad=r*math.sqrt(rng.random());x=cx+sx+rad*math.cos(angle);y=cy+sy+rad*math.sin(angle)
        if blocked(x,y,.0018):continue
        if any((x-a)**2+(y-b)**2<.00045**2 for a,b in roots):continue
        if rng.random()<.12:continue
        z=soil_z(x,y);height=rng.uniform(.002,.0043);lean=Vector((rng.uniform(-.00045,.00045),rng.uniform(-.00045,.00045),0));local=[];polys=[];tints=[]
        shade=rng.uniform(.72,1.28);base=np.array([.031,.059,.010])*shade
        # Triangular narrow stem tapering into a leafy shoot; true geometry at metric scale.
        for level in [0,1]:
            for k in range(3):
                a=k*math.tau/3;radius=.000075*(1-.6*level);local.append(Vector((x+radius*math.cos(a),y+radius*math.sin(a),z-.00012+height*level))+lean*level);tints.append(base*.58)
        for k in range(3):polys.append((k,(k+1)%3,3+(k+1)%3,3+k))
        phase=rng.uniform(0,math.tau)
        for leaf in range(7):
            t=.22+leaf*.105;az=phase+leaf*2.399+rng.uniform(-.25,.25);direction=Vector((math.cos(az),math.sin(az),0));side=Vector((-math.sin(az),math.cos(az),0));origin=Vector((x,y,z+height*t))+lean*t
            length=rng.uniform(.00085,.0015)*(1-.30*t);width=length*rng.uniform(.20,.28);end=origin+direction*length+Vector((0,0,length*rng.uniform(.35,.8)))
            mid=origin.lerp(end,.52);ridge=mid+Vector((0,0,.00009));q=len(local)
            local.extend([origin,mid-side*width,ridge,mid+side*width,end]);tints.extend([base*.7,base,base*1.10,base*.97,base*1.14]);polys.extend([(q,q+1,q+2),(q,q+2,q+3),(q+1,q+4,q+2),(q+2,q+4,q+3)])
        if any(blocked(v.x,v.y) for v in local):rejected+=1;continue
        # Above-ground leaflets stay above actual soil; only the stem root is embedded.
        if any(v.z<soil_z(v.x,v.y)+.00005 for v in local[6:]):rejected+=1;continue
        offset=len(verts);verts.extend([tuple(v) for v in local]);faces.extend([tuple(offset+i for i in p) for p in polys]);colors.extend(tints);roots.append((x,y));all_heights.extend([v.z-soil_z(v.x,v.y) for v in local])
    mesh=bpy.data.meshes.new('Moss colony '+str(colony));mesh.from_pydata(verts,[],faces);mesh.update();assert not mesh.validate();mesh.materials.append(m)
    ob=bpy.data.objects.new('Leafy moss colony '+str(colony),mesh);scene.collection.objects.link(ob);objects.append(ob)
    attr=mesh.color_attributes.new(name='MossColor',type='FLOAT_COLOR',domain='CORNER');mesh.color_attributes.active_color=attr
    for p in mesh.polygons:p.use_smooth=True
    for loop in mesh.loops:attr.data[loop.index].color=(*colors[loop.vertex_index],1)
    records.append({'name':ob.name,'center':[cx,cy,soil_z(cx,cy)],'shoots':len(roots),'clearanceAtCenterM':clear,'triangles':sum(len(p.vertices)-2 for p in mesh.polygons),'rootDepthM':.00012,'maximumShootHeightM':max(v[2]-soil_z(v[0],v[1]) for v in verts)})
assert before=={o.name:signature(o) for o in scene.objects if o.type=='MESH' and o not in objects}
assert materials=={name:mat_sig(bpy.data.materials[name]) for name in materials}
total=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in scene.objects if o.type=='MESH');assert total<750000
camera=scene.camera;light=next(o for o in scene.objects if o.type=='LIGHT');cs=(camera.location.copy(),camera.rotation_euler.copy(),camera.data.lens);ls=(light.location.copy(),light.rotation_euler.copy(),light.data.energy,light.data.size)
controls={}
for mode in ['gray','unlit']:
    c=m.copy();c.name='Moss diagnostic '+mode;n,l=c.node_tree.nodes,c.node_tree.links;b=n['Principled BSDF']
    if mode=='gray':
        for link in list(b.inputs['Base Color'].links):l.remove(link)
        b.inputs['Base Color'].default_value=(.18,.18,.18,1)
    else:
        e=n.new('ShaderNodeEmission');l.new(n.get(vc.name).outputs['Color'],e.inputs['Color']);l.new(e.outputs[0],n['Material Output'].inputs['Surface'])
    controls[mode]=c
target=Vector(records[0]['center'])+Vector((0,0,.002));eye=target+Vector((.045,-.055,.095));views=[]
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU';scene.cycles.samples=128;scene.render.resolution_x=1800;scene.render.resolution_y=1350;camera.data.dof.use_dof=False
for name,mode,eye_now,tgt,lens,reverse in [('close','full',eye,target,55,False),('close-opposing','full',eye,target,55,True),('close-unlit','unlit',eye,target,55,False),('close-gray','gray',eye,target,55,False),('walking','full',target+Vector((.1,-.38,.85)),target,55,False),('overview','full',cs[0],Vector((0,0,.06)),cs[2],False)]:
    for o in objects:o.data.materials[0]=m if mode=='full' else controls[mode]
    camera.location=eye_now;camera.rotation_euler=(tgt-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=Vector((3,4,6)) if reverse else ls[0];light.rotation_euler=(Vector((0,0,.06))-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);views.append({'name':name,'eye':list(eye_now),'target':list(tgt),'lens':lens,'mode':mode,'opposing':reverse})
for o in objects:o.data.materials[0]=m
camera.location,camera.rotation_euler,camera.data.lens=cs;light.location,light.rotation_euler,light.data.energy,light.data.size=ls
for im in bpy.data.images:
    if im.has_data and not im.packed_file:im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
r={'source':str(BASE),'sourceSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'seed':922801,'seconds':time.perf_counter()-START,'nonmossGeometryAttributesTransformsUnchanged':True,'nonmossMaterialsUnchanged':True,'nonmossHashes':before,'materialHashes':materials,'colonies':records,'sceneTriangles':total,'mossTriangles':sum(x['triangles'] for x in records),'supportHeightRangeM':[min(all_heights),max(all_heights)],'stoneVertexViolations':0,'rejectedShootCandidates':rejected,'views':views,'sourceOnly':True,'rightsReviewed':False,'reference':'batch-116/veg-001-courtyard-joint-plants-v1.png; moss morphology is original authored extension, not a depicted species','limits':['Plant4000tri target exceeded by explicit source microgeometry','No runtime validation, baking or LOD','Conservative stone footprint vertex tests; no full triangle collision solver'],'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir()) if p.is_file()]}
(OUT/'receipt.json').write_text(json.dumps(r,indent=2)+'\n');print('MOSS_READY',total,records,flush=True)
