"""Export accepted original geometry/generated surface through the variant gate."""
import argparse,hashlib,json,sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=a.source.resolve();out=a.output.resolve();out.relative_to(ROOT/'harness/results');out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source/'source.blend'))
scene=bpy.context.scene;scene.cycles.samples=24
layout=json.loads((source/'layout.json').read_text());reports=[];variant_reports=[];texture_reports=[]
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def export_mesh(mesh,stem,variant,kind,lod):
    mesh.calc_loop_triangles()
    if kind!='grass':mesh.calc_tangents(uvmap=mesh.uv_layers.active.name)
    values=[];indices=[];lookup={}
    for triangle in mesh.loop_triangles:
        points=[mesh.vertices[mesh.loops[li].vertex_index].co for li in triangle.loops]
        if (points[1]-points[0]).cross(points[2]-points[0]).length<1e-12:continue
        for li in triangle.loops:
            loop=mesh.loops[li];pos=mesh.vertices[loop.vertex_index].co;normal=mesh.corner_normals[li].vector
            if kind=='grass':uv=(0.,0.);tangent=Vector((1,0,0));sign=1.
            else:uv=mesh.uv_layers.active.data[li].uv;tangent=loop.tangent;sign=loop.bitangent_sign
            row=(pos.x,pos.z,-pos.y,normal.x,normal.z,-normal.y,uv[0],1-uv[1],tangent.x,tangent.z,-tangent.y,-sign)
            if row not in lookup:lookup[row]=len(values);values.append(row)
            indices.append(lookup[row])
    if kind=='grass':
        count=len(values);original=list(indices)
        values.extend([tuple(list(v[:3])+[-x for x in v[3:6]]+list(v[6:11])+[-v[11]]) for v in list(values)])
        indices.extend([original[i+j]+count for i in range(0,len(original),3) for j in (2,1,0)])
    attrs=np.asarray(values,dtype='<f4');ids=np.asarray(indices,dtype='<u4')
    attrs.tofile(out/(stem+'.vertices'));ids.tofile(out/(stem+'.indices'))
    reports.append({'stem':stem,'variantId':variant,'kind':kind,'material':{'stone':'stone','substrate':'earth','grass':'vegetation'}[kind],'lod':lod,'vertices':len(attrs),'triangles':len(ids)//3,'bounds':[attrs[:,:3].min(0).tolist(),attrs[:,:3].max(0).tolist()],'uvPolicy':'solid-color-vegetation' if kind=='grass' else 'shared-procedural-surface'})

names=sorted(set(p['variantId'] for p in layout['placements']))
for name in names:
    stems=[]
    for lod in range(3):
        stem=f'{name}-lod{lod}';stems.append(stem);export_mesh(bpy.data.meshes[stem],stem,name,'stone',lod)
    near=bpy.data.meshes[stems[0]]
    bottom_edges={}
    for face in near.polygons:
        ids=list(face.vertices)
        if not all(abs(near.vertices[i].co.z)<1e-7 for i in ids):continue
        for first,second in zip(ids,ids[1:]+ids[:1]):
            key=tuple(sorted((first,second)));bottom_edges[key]=bottom_edges.get(key,0)+1
    adjacency={}
    for (first,second),count in bottom_edges.items():
        if count!=1:continue
        adjacency.setdefault(first,[]).append(second);adjacency.setdefault(second,[]).append(first)
    start=min(adjacency);order=[start];previous=None;current=start
    while True:
        following=next(i for i in adjacency[current] if i!=previous)
        if following==start:break
        order.append(following);previous,current=current,following
        assert len(order)<=len(adjacency)
    bottom=[(near.vertices[i].co.x,-near.vertices[i].co.y) for i in order]
    variant_reports.append({'id':name,'kind':'stone','material':'stone','lods':stems,'bottomFootprint':bottom,'nominalThicknessMetres':.073,'nominalBurialDepthMetres':.057})

aggregate=sorted([o for o in scene.objects if o.name.startswith('joint-aggregate')],key=lambda o:o.name)
for lod,(grid,grit_count,roots_count) in enumerate([(32,250,270),(16,75,140),(8,20,70)]):
    vertices=[];faces=[]
    for y in range(grid):
        for x in range(grid):vertices.append((-2+4*x/(grid-1),-2+4*y/(grid-1),0))
    for y in range(grid-1):
        for x in range(grid-1):
            q=y*grid+x;faces.extend(((q,q+1,q+grid+1),(q,q+grid+1,q+grid)))
    for obj in aggregate[:grit_count]:
        start=len(vertices);vertices.extend([tuple(obj.matrix_world@v.co) for v in obj.data.vertices]);obj.data.calc_loop_triangles()
        faces.extend([tuple(start+i for i in tri.vertices) for tri in obj.data.loop_triangles])
    mesh=bpy.data.meshes.new(f'substrate-lod{lod}');mesh.from_pydata(vertices,[],faces);mesh.update();uv=mesh.uv_layers.new(name='courtyard-earth')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=((v.x+2+v.z*.013)/4,(v.y+2+v.z*.021)/4)
    export_mesh(mesh,mesh.name,'substrate','substrate',lod)
    original=bpy.data.objects['joint-grass'].data
    mesh=bpy.data.meshes.new(f'grass-lod{lod}');mesh.from_pydata([v.co[:] for v in original.vertices[:roots_count*10]],[],[tuple(f.vertices) for f in original.polygons[:roots_count*8]]);mesh.update()
    export_mesh(mesh,mesh.name,'grass','grass',lod)
variant_reports.extend([{'id':kind,'kind':kind,'material':material,'lods':[f'{kind}-lod{i}' for i in range(3)]} for kind,material in [('substrate','earth'),('grass','vegetation')]])

def pixels(image):
    data=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(data);return data.reshape(image.size[1],image.size[0],4)
def save_chain(role,data,color=False):
    levels=[];level=0
    while True:
        encoded=data.copy();encoded[:,:,3]=1
        if color:
            rgb=encoded[:,:,:3];rgb[:]=np.where(rgb<=.0031308,rgb*12.92,1.055*np.maximum(rgb,0)**(1/2.4)-.055)
        path=out/f'{role}-{level}.rgba';np.rint(np.clip(encoded[::-1],0,1)*255).astype('u1').tofile(path)
        size=len(data);levels.append({'file':path.name,'width':size,'height':size,'sha256':digest(path)})
        if size==1:break
        data=data.reshape(size//2,2,size//2,2,4).mean((1,3))
        if 'normal' in role.lower():
            v=data[:,:,:3]*2-1;v/=np.maximum(np.linalg.norm(v,axis=2,keepdims=True),1e-8);data[:,:,:3]=v*.5+.5
        level+=1
    texture_reports.append({'role':role,'levels':levels})

# Bake original procedural shaders, never infer macro height from diffuse.
for obj in scene.objects:obj.hide_render=True
def bake(material,size,physical_width,mode):
    bpy.ops.object.select_all(action='DESELECT');bpy.ops.mesh.primitive_plane_add(size=physical_width)
    plane=bpy.context.object;plane.data.materials.append(material.copy());mat=plane.data.materials[0]
    image=bpy.data.images.new('export-'+mode,width=size,height=size,alpha=True,float_buffer=True);image.colorspace_settings.name='Non-Color'
    nodes,links=mat.node_tree.nodes,mat.node_tree.links;target=nodes.new('ShaderNodeTexImage');target.image=image;nodes.active=target
    if mode=='color':
        bsdf=nodes.get('Principled BSDF');emit=nodes.new('ShaderNodeEmission')
        if bsdf.inputs['Base Color'].is_linked:links.new(bsdf.inputs['Base Color'].links[0].from_socket,emit.inputs['Color'])
        else:emit.inputs['Color'].default_value=bsdf.inputs['Base Color'].default_value
        links.new(emit.outputs[0],nodes.get('Material Output').inputs['Surface'])
    bpy.ops.object.bake(type='EMIT' if mode=='color' else 'NORMAL',normal_space='TANGENT',margin=0,use_clear=True)
    data=pixels(image).copy();bpy.data.objects.remove(plane,do_unlink=True);return data
stone=bpy.data.materials['limestone-cream'];earth=bpy.data.materials['packed-earth-and-mineral-grit']
save_chain('baseColor',bake(stone,2048,.5,'color'),True)
save_chain('normal',bake(stone,2048,.5,'normal'))
orm=np.ones((1024,1024,4),np.float32);orm[:,:,1]=.82;orm[:,:,2]=0;save_chain('orm',orm)
save_chain('earthBaseColor',bake(earth,1024,4,'color'),True)
save_chain('earthNormal',bake(earth,512,4,'normal'))
# Geometry-aware local occlusion: distance to the actual placed footprint, not
# painted directional shadows. Supports near-flush dirt/stone contacts.
size=512;x,y=np.meshgrid(np.linspace(-2,2,size),np.linspace(-2,2,size));distance=np.full((size,size),10.);inside_any=np.zeros((size,size),bool)
for placement in layout['placements']:
    poly=[(a,-b) for a,b in placement['footprint']];inside=np.zeros((size,size),bool)
    for (ax,ay),(bx,by) in zip(poly,poly[1:]+poly[:1]):
        dx,dy=bx-ax,by-ay;t=np.clip(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy),0,1);distance=np.minimum(distance,np.hypot(x-ax-t*dx,y-ay-t*dy))
        inside^=((ay>y)!=(by>y)) & (x<(bx-ax)*(y-ay)/(by-ay+1e-20)+ax)
    inside_any|=inside
orm=np.ones((size,size,4),np.float32);orm[:,:,0]=np.where(inside_any,.5,.65+.35*np.clip(distance/.025,0,1));orm[:,:,1]=.94;orm[:,:,2]=0;save_chain('earthOrm',orm)
for role,value in [('grassBaseColor',(.035,.065,.009,1)),('grassNormal',(.5,.5,1,1)),('grassOrm',(1,.83,0,1))]:
    data=np.empty((4,4,4),np.float32);data[:]=value;save_chain(role,data,role=='grassBaseColor')
materials={}
for name,roles in [('stone',('baseColor','normal','orm')),('earth',('earthBaseColor','earthNormal','earthOrm')),('vegetation',('grassBaseColor','grassNormal','grassOrm'))]:
    materials[name]={'baseColor':roles[0],'normal':roles[1],'metallicRoughness':roles[2],'metallicFactor':0,'roughnessFactor':1,'normalStrength':1,'textureAddressMode':'clamp-to-edge'}
provenance=ROOT/'assets/source/d1-paving/individual-provenance.json'
report={'schemaVersion':1,'mode':'individual-stone-variants','sourceBlendSha256':digest(source/'source.blend'),'sourceProvenancePath':provenance.relative_to(ROOT).as_posix(),'sourceProvenanceSha256':digest(provenance),'normalStrength':1,'sourceWidthMetres':4,'upAxis':'Y','textureMetresPerUvUnit':{'stone':.5,'earth':4},'uvConvention':'Standard glTF UV(u,1-v), top-origin texture rows, Blender OpenGL normal RGB unchanged, tangent sign negated for V reflection','variants':variant_reports,'meshes':reports,'textures':texture_reports,'materials':materials,'layout':layout}
(out/'export.json').write_text(json.dumps(report,indent=2)+'\n')
print('EXPORTED '+json.dumps({'meshes':len(reports),'textures':len(texture_reports),'triangles':[r['triangles'] for r in reports]}))
