"""Original hero geometry with neutral, generated, or historical scan comparisons.

The selected courtyard uses the generated diffuse mode; scanned-material proofs
remain separate historical outputs and are not inputs to the selected export.
"""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--material-dir',type=Path);p.add_argument('--generated-diffuse',type=Path)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=a.output.resolve();out.relative_to(ROOT/'harness/results');out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.render.resolution_x=1400;scene.render.resolution_y=1100;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
# Irregular fractured outline, broad rectangular character without rounded waves.
outline=[(-.195,-.137),(-.131,-.148),(-.052,-.143),(.044,-.149),(.139,-.14),(.182,-.115),(.193,-.055),(.186,.029),(.194,.097),(.161,.135),(.094,.141),(.009,.132),(-.074,.14),(-.149,.127),(-.186,.108),(-.198,.038),(-.188,-.048)]

def polygon_distance(x,y,poly):
    distance=1;inside=False;nearest=0
    for j,((ax,ay),(bx,by)) in enumerate(zip(poly,poly[1:]+poly[:1])):
        if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:inside=not inside
        dx,dy=bx-ax,by-ay;t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
        d=math.hypot(x-ax-t*dx,y-ay-t*dy)
        if d<distance:distance=d;nearest=j
    return distance if inside else -distance,nearest

# Shape patches have independent polygon boundaries and tilted floors. Their
# placement is authored, sparse and asymmetrical, leaving most of the face worn.
patches=[([(-.142,-.098),(-.103,-.109),(-.079,-.091),(-.094,-.065),(-.124,-.067),(-.15,-.08)],.0042,.006),
         ([(.068,.047),(.099,.027),(.139,.038),(.153,.067),(.128,.088),(.094,.079)],.0030,.008),
         ([(-.026,-.039),(.009,-.048),(.035,-.028),(.026,-.006),(-.004,.003),(-.028,-.013)],.0018,.010),
         ([(-.197,.057),(-.154,.063),(-.141,.088),(-.158,.113),(-.192,.107)],.006,.006)]
shoulder_width=[.009,.004,.013,.006,.019,.003,.011,.006,.015,.003,.008,.014,.005,.017,.006,.010,.004]
edge_drop=[.005,.003,.007,.002,.010,.003,.004,.003,.008,.002,.006,.009,.004,.007,.003,.004,.002]

def height(x,y):
    distance,j=polygon_distance(x,y,outline)
    z=.073+.004*x-.002*y
    # Broad calm wear sag, not a center mound.
    z-=.0008*max(0,1-(x/.2)**2-(y/.15)**2)
    ax,ay=outline[j];bx,by=outline[(j+1)%len(outline)]
    segment_t=max(0,min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)))
    blend=.5-.5*math.cos(segment_t*math.pi)
    w=shoulder_width[j]*(1-blend)+shoulder_width[(j+1)%len(outline)]*blend
    drop=edge_drop[j]*(1-blend)+edge_drop[(j+1)%len(outline)]*blend
    t=max(0,1-distance/w);z-=drop*t*t
    for poly,depth,ramp in patches:
        d,_=polygon_distance(x,y,poly)
        if d>0:
            blend=min(1,d/(ramp*1.25));blend=blend*blend*(3-2*blend)
            z-=depth*blend
    return z

# Dense radial study is decimated to the stone budget. Boundary corners and
# shallow polygonal fractures survive more naturally than a uniform coarse grid.
segments=136;rings=36
def border(theta):
    dx,dy=math.cos(theta),math.sin(theta);best=10
    for (ax,ay),(bx,by) in zip(outline,outline[1:]+outline[:1]):
        ex,ey=bx-ax,by-ay;det=dx*(-ey)-(-ex)*dy
        if abs(det)<1e-10:continue
        t=(ax*(-ey)+ex*ay)/det;s=(dx*ay-dy*ax)/det
        if t>0 and 0<=s<=1:best=min(best,t)
    return (dx*best,dy*best)
vertices=[(0,0,height(0,0))];faces=[]
for ring in range(1,rings+1):
    radius=ring/rings
    for j in range(segments):
        x,y=border(math.tau*j/segments);x*=radius;y*=radius;vertices.append((x,y,height(x,y)))
    start=1+(ring-1)*segments
    for j in range(segments):
        k=(j+1)%segments
        if ring==1:faces.append((0,start+j,start+k))
        else:
            prev=start-segments;faces.extend(((prev+j,start+j,start+k),(prev+j,start+k,prev+k)))
last=1+(rings-1)*segments;bottom=len(vertices)
for j in range(segments):
    x,y,_=vertices[last+j];vertices.append((x*.99,y*.99,0))
for j in range(segments):
    k=(j+1)%segments;faces.extend(((last+j,bottom+j,bottom+k),(last+j,bottom+k,last+k)))
center=len(vertices);vertices.append((0,0,0))
for j in range(segments):faces.append((center,bottom+(j+1)%segments,bottom+j))
mesh=bpy.data.meshes.new('original-fractured-limestone');mesh.from_pydata(vertices,[],faces);mesh.update()
obj=bpy.data.objects.new('hero-limestone',mesh);scene.collection.objects.link(obj)
bpy.context.view_layer.objects.active=obj;obj.select_set(True)
mod=obj.modifiers.new('budgeted-planar-preservation','DECIMATE');mod.ratio=3900/len(faces);bpy.ops.object.modifier_apply(modifier=mod.name)
# Smooth only shallow changes; actual fractured ridges keep their angular normals.
for face in obj.data.polygons:face.use_smooth=True
obj.data.set_sharp_from_angle(angle=1.1)
mat=bpy.data.materials.new('neutral-limestone-clay');mat.diffuse_color=(.43,.40,.33,1);mat.use_nodes=True
bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.43,.40,.33,1);bsdf.inputs['Roughness'].default_value=.82;obj.data.materials.append(mat)
if a.generated_diffuse:
    uv=obj.data.uv_layers.new(name='half-metre-authored-surface')
    for face in obj.data.polygons:
        axis=max(range(3),key=lambda i:abs(face.normal[i]))
        for li in face.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co
            x,y=(v.x,v.y) if axis==2 else ((v.x,v.z) if axis==1 else (v.y,v.z))
            uv.data[li].uv=(x/.5+.5,y/.5+.5)
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    diffuse=nodes.new('ShaderNodeTexImage');diffuse.image=bpy.data.images.load(str(a.generated_diffuse.resolve()));links.new(diffuse.outputs['Color'],bsdf.inputs['Base Color'])
    coord=nodes.new('ShaderNodeTexCoord');grain=nodes.new('ShaderNodeTexNoise');grain.inputs['Scale'].default_value=190;grain.inputs['Detail'].default_value=2
    links.new(coord.outputs['UV'],grain.inputs['Vector'])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0004;bump.inputs['Strength'].default_value=.35
    links.new(grain.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
elif a.material_dir:
    uv=obj.data.uv_layers.new(name='two-metre-physical-surface')
    for face in obj.data.polygons:
        axis=max(range(3),key=lambda i:abs(face.normal[i]))
        for li in face.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co
            x,y=(v.x,v.y) if axis==2 else ((v.x,v.z) if axis==1 else (v.y,v.z))
            uv.data[li].uv=(x/2+.36,y/2+.46)
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    def texture(role,color=False):
        node=nodes.new('ShaderNodeTexImage')
        high=a.material_dir.resolve()/f'worn_rock_natural_01_{role}_8k.png'
        node.image=bpy.data.images.load(str(high if high.exists() else a.material_dir.resolve()/f'worn_rock_natural_01_{role}_2k.png'))
        if not color:node.image.colorspace_settings.name='Non-Color'
        return node
    diffuse=texture('diff',True);rough=texture('rough');normal=texture('nor_gl');displacement=texture('disp')
    hue=nodes.new('ShaderNodeHueSaturation');hue.inputs['Saturation'].default_value=.48;hue.inputs['Value'].default_value=1.16
    links.new(diffuse.outputs['Color'],hue.inputs['Color']);links.new(hue.outputs['Color'],bsdf.inputs['Base Color']);links.new(rough.outputs['Color'],bsdf.inputs['Roughness'])
    normal_map=nodes.new('ShaderNodeNormalMap');normal_map.inputs['Strength'].default_value=.5;links.new(normal.outputs['Color'],normal_map.inputs['Color'])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.001;bump.inputs['Strength'].default_value=.35
    links.new(displacement.outputs['Color'],bump.inputs['Height']);links.new(normal_map.outputs['Normal'],bump.inputs['Normal']);links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
obj.location.z=-.057
bpy.ops.mesh.primitive_plane_add(size=2);ground=bpy.context.object;ground.name='ground-height-reference'
soil=bpy.data.materials.new('neutral-earth');soil.use_nodes=True;soil.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.12,.095,.066,1);soil.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.95;ground.data.materials.append(soil)
world=bpy.data.worlds.new('neutral-day');scene.world=world;world.use_nodes=True;world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.65,.75,1,1);world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.3
bpy.ops.object.light_add(type='SUN',rotation=(.85,-.45,-.5));bpy.context.object.data.energy=3;bpy.context.object.data.angle=.04
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.lens=60
def capture(name,location,target):
    camera.location=location;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'hero.blend'))
prefix='generated' if a.generated_diffuse else ('surface' if a.material_dir else 'neutral')
capture(prefix+'-grazing',(.46,-.59,.27),(0,0,.01))
capture(prefix+'-overhead',(.08,-.10,.79),(0,0,.01))
capture(prefix+'-walking',(.55,-.75,1.6),(0,0,.01))
source_description='original authored geometry; neutral untextured material'
if a.material_dir:source_description='original authored geometry; Poly Haven CC0 worn sandstone surface adapted toward pale limestone'
if a.generated_diffuse:source_description='original authored geometry; generated limestone diffuse; original procedural fine bump, not measured relief'
(out/'metrics.json').write_text(json.dumps({'triangles':len(obj.data.polygons),'nominalThickness':.073,'burial':.057,'patchDepths':[p[1] for p in patches],'source':source_description,'surfaceMetresPerUvUnit':.5 if a.generated_diffuse else (2 if a.material_dir else None),'surfaceNormalStrength':.5 if a.material_dir else 0,'estimatedResidualBumpMetres':.00014 if a.generated_diffuse else (.00035 if a.material_dir else 0)},indent=2)+'\n')
