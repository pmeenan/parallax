"""Bounded color-only botanical variation; geometry and all relief remain exact."""
import bpy,numpy as np,json,hashlib,time,math,random
from pathlib import Path
from mathutils import Vector
from datetime import datetime,timezone
OUT=Path(__file__).parent;BASE=OUT.parents[1]/'vegetation/candidate2/source.blend';START=time.perf_counter();rng=random.Random(922702)
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.open_mainfile(filepath=str(BASE));scene=bpy.context.scene
def geometry(o):
    values=np.empty(len(o.data.vertices)*3,np.float32);o.data.vertices.foreach_get('co',values)
    uv=[list(loop.uv) for layer in o.data.uv_layers for loop in layer.data]
    return hashlib.sha256(values.tobytes()+repr(([list(p.vertices) for p in o.data.polygons],uv,[list(row) for row in o.matrix_world])).encode()).hexdigest()
def graph(mat,socket):
    bs=mat.node_tree.nodes.get('Principled BSDF');seen=set();result=[]
    def walk(node):
        if node.name in seen:return
        seen.add(node.name);result.append((node.name,node.bl_idname,getattr(getattr(node,'image',None),'name',None),[(i.name,str(i.default_value)) for i in node.inputs if hasattr(i,'default_value')]))
        for inp in node.inputs:
            for link in inp.links:result.append((link.from_node.name,link.from_socket.name,node.name,inp.name));walk(link.from_node)
    inp=bs.inputs[socket]
    for link in inp.links:walk(link.from_node)
    return hashlib.sha256(repr((str(inp.default_value),result)).encode()).hexdigest()
leafmat=bpy.data.materials['Authored joint weed color normal roughness']
geometry_before={o.name:geometry(o) for o in scene.objects if o.type=='MESH'}
relief_before={m.name:{s:graph(m,s) for s in ['Normal','Roughness']} for m in bpy.data.materials if m.use_nodes and m.node_tree.nodes.get('Principled BSDF')}
nonleaf_before={m.name:graph(m,'Base Color') for m in bpy.data.materials if m!=leafmat and m.use_nodes and m.node_tree.nodes.get('Principled BSDF')}
tex=next(n for n in leafmat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image.name=='leaf-basecolor')
im=tex.image;S=im.size[0];raw=np.empty(S*S*4,np.float32);im.pixels.foreach_get(raw);encoded=raw.reshape(S,S,4)[:,:,:3]
print('SOURCE_COLOR_PIXEL',im.is_float,encoded[S//2,S//2].tolist(),flush=True)
linear=encoded.copy() if im.is_float else np.where(encoded<=.04045,encoded/12.92,((encoded+.055)/1.055)**2.4)
u,v=np.meshgrid(np.linspace(0,1,S),np.linspace(0,1,S))
# Broad interveinal tonal modulation, with quieter veins and no new fine speckle field.
field=np.clip(.5+.21*np.sin(v*18+u*4)+.16*np.sin(u*13-v*7)+.10*np.sin(v*31-u*8),0,1)
main=np.exp(-((u-(.5+.014*np.sin(v*math.pi*1.6)))/.018)**2)
# Soft chlorophyll pockets lie between secondary veins; varied broad regions, not speckles.
pockets=np.zeros_like(u)
for side in [-1,1]:
    d=side*(u-.5)
    for k,level in enumerate([.17,.30,.43,.57,.69,.80]):
        center_u=.5+side*(.24+.045*math.sin(k*2.1+side));center_v=level+.09
        local_v=v-center_v-.20*(np.abs(u-.5)-.25)
        patch=np.exp(-((u-center_u)/(.15+.025*math.sin(k)))**2-(local_v/(.038+.009*math.cos(k*1.7)))**2)
        pockets+=patch*([-.32,.16,-.24,.12,-.30,.14][(k+(side>0))%6])
factor=np.clip(.78+.40*field+pockets,.60,1.30);factor=factor*(1-main*.40)+main*.40
linear*=factor[:,:,None]
linear[:,:,0]*=1+.11*(field-.5)-.10*pockets;linear[:,:,2]*=1-.14*(field-.5)+.08*pockets
linear*=1.6 # Common gain baked into color map; normalized per-leaf attributes divide by1.6.
encoded=np.where(linear<=.0031308,linear*12.92,1.055*np.maximum(linear,0)**(1/2.4)-.055)
rgba=np.concatenate([np.clip(encoded,0,1),np.ones((S,S,1))],axis=2).astype(np.float32)
new=bpy.data.images.new('Botanical leaf color encoded',width=S,height=S,alpha=False,float_buffer=True);new.colorspace_settings.name='sRGB';new.pixels.foreach_set(rgba.ravel());new.filepath_raw=str(OUT/'leaf-basecolor.png');new.file_format='PNG';new.save();bpy.data.images.remove(new)
new=bpy.data.images.load(str(OUT/'leaf-basecolor.png'),check_existing=False);new.name='Botanical leaf color';new.colorspace_settings.name='sRGB';new.pack();tex.image=new
leaves=[];records=[]
for ob in scene.objects:
    if ob.type!='MESH' or leafmat not in ob.data.materials.values():continue
    leaves.append(ob);data=ob.data;neighbors=[set() for v in data.vertices]
    for edge in data.edges:a,b=edge.vertices;neighbors[a].add(b);neighbors[b].add(a)
    seen=set();components=[]
    for vertex in range(len(data.vertices)):
        if vertex in seen:continue
        stack=[vertex];seen.add(vertex);comp=[]
        while stack:
            q=stack.pop();comp.append(q)
            for other in neighbors[q]:
                if other not in seen:seen.add(other);stack.append(other)
        components.append(comp)
    attr=data.color_attributes.new(name='LeafAgeTint',type='FLOAT_COLOR',domain='CORNER');data.color_attributes.active_color=attr
    by_vertex={};seedling=ob.name.startswith('Small seedling');phase=rng.randrange(4)
    for i,comp in enumerate(components):
        intensity=(1.23+rng.uniform(-.06,.10)) if seedling else [.69,.88,1.25,1.02][(i+phase)%4]*rng.uniform(.96,1.04)
        young=intensity>1.13;tint=np.array([1.13,1.02,.89] if young else [.98,1.0,1.02])*intensity
        worn=not seedling and not young and (i==2 or len(records)%6==1);blemish=not seedling and len(records)%11==5
        for q in comp:by_vertex[q]=(tint,worn,blemish)
        records.append({'object':ob.name,'component':i,'vertices':len(comp),'growth':'seedling' if seedling else ('new' if young else 'mature'),'linearTint':tint.tolist(),'fadedEdges':worn,'smallBlemish':blemish})
    uv=data.uv_layers.active
    for loop in data.loops:
        tint,worn,blemish=by_vertex[loop.vertex_index];x,y=uv.data[loop.index].uv;value=tint.copy()
        value*=.965+.07*y
        if worn:
            edge=max(0,(x-.66)/.34)*math.exp(-((y-.64)/.24)**2);value*=np.array([1+.85*edge,1+.12*edge,1-.32*edge])
        if blemish:
            spot=math.exp(-(((x-.78)/.16)**2+((y-.68)/.09)**2));value*=np.array([1+.26*spot,1-.12*spot,1-.08*spot])
        # Keep color attributes within exportable normalized range; common gain is in material factor.
        attr.data[loop.index].color=(*np.clip(value/1.6,0,1),1)
    data.color_attributes.render_color_index=data.color_attributes.find('LeafAgeTint')
nodes,links=leafmat.node_tree.nodes,leafmat.node_tree.links;bs=nodes['Principled BSDF']
vertex=nodes.new('ShaderNodeVertexColor');vertex.layer_name='LeafAgeTint'
mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;links.new(tex.outputs['Color'],mix.inputs[1]);links.new(vertex.outputs['Color'],mix.inputs[2])
links.new(mix.outputs[0],bs.inputs['Base Color'])
assert geometry_before=={o.name:geometry(o) for o in scene.objects if o.type=='MESH'}
assert relief_before=={m.name:{s:graph(m,s) for s in ['Normal','Roughness']} for m in bpy.data.materials if m.name in relief_before}
assert nonleaf_before=={m.name:graph(m,'Base Color') for m in bpy.data.materials if m.name in nonleaf_before}
camera=scene.camera;light=next(o for o in scene.objects if o.type=='LIGHT');cs=(camera.location.copy(),camera.rotation_euler.copy(),camera.data.lens);ls=(light.location.copy(),light.rotation_euler.copy(),light.data.energy,light.data.size)
vr=json.loads((BASE.parent/'receipt.json').read_text());views=[v for v in vr['views'] if v['name'] in ['close','close-opposing','close-unlit','walking','overview']]
unlit=leafmat.copy();unlit.name='Botanical color unlit diagnostic';un=unlit.node_tree.nodes;ul=unlit.node_tree.links;ub=un['Principled BSDF'];em=un.new('ShaderNodeEmission');ul.new(ub.inputs['Base Color'].links[0].from_socket,em.inputs['Color']);ul.new(em.outputs[0],un['Material Output'].inputs['Surface'])
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU'
for view in views:
    for ob in leaves:ob.data.materials[0]=unlit if view['name']=='close-unlit' else leafmat
    camera.location=view['eye'];camera.rotation_euler=(Vector(view['target'])-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=view['lens']
    light.location=Vector((3,4,6)) if view['opposingLight'] else ls[0];light.rotation_euler=(Vector((0,0,.06))-light.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/(view['name']+'.png'));bpy.ops.render.render(write_still=True)
for ob in leaves:ob.data.materials[0]=leafmat
camera.location,camera.rotation_euler,camera.data.lens=cs;light.location,light.rotation_euler,light.data.energy,light.data.size=ls
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
r={'seconds':time.perf_counter()-START,'seed':922702,'source':str(BASE),'sourceSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'geometryTopologyUVTransformsUnchanged':True,'normalRoughnessGraphsUnchanged':True,'nonleafBaseColorGraphsUnchanged':True,'geometryHashes':geometry_before,'reliefHashes':relief_before,'leaves':records,'views':views,'colorDelivery':'Authored map explicitly sRGB encoded/reloaded with1.6 common image gain; per-leaf LeafAgeTint FLOAT_COLOR corner attribute divided by1.6; explicit COLOR_0 export preserves exact native product','scope':'Second final color-only candidate, no shape/relief/roughness edits','rightsReviewed':False,'sourceOnly':True,'files':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(OUT.iterdir()) if p.suffix in {'.png','.blend','.py'}]}
(OUT/'receipt.json').write_text(json.dumps(r,indent=2)+'\n')
