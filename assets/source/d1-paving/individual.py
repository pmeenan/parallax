"""Original hero-derived limestone geometry with a generated limestone surface.

The selected single-surface image supplies diffuse detail. Macro relief and fine
procedural normals are authored, not measured. No rejected CC0 scan is sampled.
"""
import argparse
import json
import math
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT=Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
OUT=args.output.resolve();OUT.relative_to((ROOT/'harness/results').resolve());OUT.mkdir(parents=True,exist_ok=True)
assert bpy.app.version==(5,1,2)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.render.resolution_x=1500;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'

sys.path.insert(0,str(Path(__file__).resolve().parent))
from stone_geometry import build_stone
SURFACE=ROOT/'assets/reference/d1-paving-clean/limestone-single-surface-v1.png'
def stone_material(name,tone):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links;bsdf=nodes.get('Principled BSDF')
    image=nodes.new('ShaderNodeTexImage');image.image=bpy.data.images.load(str(SURFACE),check_existing=True)
    multiply=nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1;multiply.inputs[2].default_value=(*tone,1)
    links.new(image.outputs['Color'],multiply.inputs[1]);links.new(multiply.outputs[0],bsdf.inputs['Base Color']);bsdf.inputs['Roughness'].default_value=.82
    coord=nodes.new('ShaderNodeTexCoord');grain=nodes.new('ShaderNodeTexNoise');grain.inputs['Scale'].default_value=190;grain.inputs['Detail'].default_value=2
    links.new(coord.outputs['UV'],grain.inputs['Vector'])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0004;bump.inputs['Strength'].default_value=.35
    links.new(grain.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
    return mat
TONES={'cream':(1,1,1),'buff':(.99,.96,.89),'gray':(.91,.94,.96)}
materials={name:stone_material('limestone-'+name,color) for name,color in TONES.items()}
earth=bpy.data.materials.new('packed-earth-and-mineral-grit');earth.use_nodes=True
n,l=earth.node_tree.nodes,earth.node_tree.links;bsdf=n.get('Principled BSDF')
tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=65;tex.inputs['Detail'].default_value=4
coord=n.new('ShaderNodeTexCoord');l.new(coord.outputs['Object'],tex.inputs['Vector'])
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.075,.059,.040,1);ramp.color_ramp.elements[1].color=(.19,.16,.112,1)
l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],bsdf.inputs['Base Color'])
bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0015;bump.inputs['Strength'].default_value=.45
l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],bsdf.inputs['Normal']);bsdf.inputs['Roughness'].default_value=.94
grit=n.new('ShaderNodeTexVoronoi');grit.inputs['Scale'].default_value=220;l.new(coord.outputs['Object'],grit.inputs['Vector'])
grit_ramp=n.new('ShaderNodeValToRGB');grit_ramp.color_ramp.elements[0].position=.16;grit_ramp.color_ramp.elements[0].color=(.17,.145,.10,1);grit_ramp.color_ramp.elements[1].position=.45;grit_ramp.color_ramp.elements[1].color=(.075,.058,.04,1)
l.new(grit.outputs['Distance'],grit_ramp.inputs[0])
earth_mix=n.new('ShaderNodeMixRGB');earth_mix.blend_type='MIX';earth_mix.inputs[0].default_value=.25;l.new(ramp.outputs[0],earth_mix.inputs[1]);l.new(grit_ramp.outputs[0],earth_mix.inputs[2]);l.new(earth_mix.outputs[0],bsdf.inputs['Base Color'])
grit_bump=n.new('ShaderNodeBump');grit_bump.inputs['Distance'].default_value=.003;grit_bump.inputs['Strength'].default_value=.55;l.new(grit.outputs['Distance'],grit_bump.inputs['Height']);l.new(bump.outputs[0],grit_bump.inputs['Normal']);l.new(grit_bump.outputs[0],bsdf.inputs['Normal'])
vegetation=bpy.data.materials.new('sparse-joint-grass');vegetation.use_nodes=True
vegetation.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.035,.065,.009,1)
vegetation.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.83

def convex_outline(points):
    points=sorted(set(points))
    def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower=[];upper=[]
    for point in points:
        while len(lower)>=2 and cross(lower[-2],lower[-1],point)<=0:lower.pop()
        lower.append(point)
    for point in reversed(points):
        while len(upper)>=2 and cross(upper[-2],upper[-1],point)<=0:upper.pop()
        upper.append(point)
    return lower[:-1]+upper[:-1]

def make_stone(index,width,length,nx,ny,lod):
    mesh=build_stone(width,length,435+index*71,(3900,1150,380)[lod])
    mesh.name=f'limestone-{index}-lod{lod}'
    uv=mesh.uv_layers.new(name='half-metre-generated-surface')
    angle=(index%4)*math.pi/2
    rng=random.Random(182+index)
    margin=max(0,(.5-max(width,length))/2-.005)
    offset=(rng.uniform(-margin,margin),rng.uniform(-margin,margin))
    for polygon in mesh.polygons:
        axis=max(range(3),key=lambda a:abs(polygon.normal[a]))
        for li in polygon.loop_indices:
            p=mesh.vertices[mesh.loops[li].vertex_index].co
            x,y=(p.x,p.y) if axis==2 else ((p.x,p.z) if axis==1 else (p.y,p.z))
            u=(x*math.cos(angle)-y*math.sin(angle)+offset[0])/.5+.5
            v=(x*math.sin(angle)+y*math.cos(angle)+offset[1])/.5+.5
            uv.data[li].uv=(u,v)
    # Authored irregular boundaries can extend slightly beyond nominal dimensions.
    # Translate each shared island set into the field without clamping/stretching.
    for axis in range(2):
        minimum=min(item.uv[axis] for item in uv.data);maximum=max(item.uv[axis] for item in uv.data)
        assert maximum-minimum<.996
        shift=max(0,.002-minimum)+min(0,.998-maximum)
        for item in uv.data:item.uv[axis]+=shift
    mesh.materials.append(materials['cream'])
    # Conservative convex footprint used for joint packing and root exclusion.
    return mesh,convex_outline((v.co.x,v.co.y) for v in mesh.vertices)
specs=[('limestone-square-'+str(i),.235+i*.001,.235-i*.001) for i in range(3)]+[('limestone-rect-'+str(i),.483+i*.001,.235-i*.001) for i in range(3)]+[('limestone-large-'+str(i),.483+i*.001,.483-i*.001) for i in range(2)]
variants={};outlines={}
for index,(name,w,h) in enumerate(specs):
    sizes=((48,24),(24,12),(12,6)) if 'rect' in name else ((32,32),(18,18),(8,8))
    variants[name]=[]
    for lod,(nx,ny) in enumerate(sizes):
        mesh,outline=make_stone(index,w,h,nx,ny,lod);variants[name].append(mesh)
        mesh.name=f'{name}-lod{lod}';mesh.use_fake_user=True
        if lod==0:outlines[name]=outline
    outlines[name]=convex_outline((v.co.x,v.co.y) for mesh in variants[name] for v in mesh.vertices)

# One authored placement seed for the whole courtyard; no repeated mosaic tile.
rng=random.Random(551903);grid=np.zeros((16,16),dtype=bool);slots=[]
while not grid.all():
    choices=np.argwhere(~grid);y,x=choices[rng.randrange(len(choices))]
    shapes=[(2,1),(1,2),(1,1)]
    if rng.random()<.2:shapes.insert(0,(2,2))
    possible=[(w,h) for w,h in shapes if x+w<=16 and y+h<=16 and not grid[y:y+h,x:x+w].any()]
    w,h=possible[0] if rng.random()<.8 else rng.choice(possible)
    grid[y:y+h,x:x+w]=True;slots.append((int(x),int(y),w,h))

def terrain_height(x,y,sloped=False):
    return .18*x+.03*math.sin(y*1.1) if sloped else 0

placements=[];objects=[]
for number,(x,y,w,h) in enumerate(slots):
    group='large' if w==h==2 else ('square' if w==h else 'rect')
    choices=[name for name in variants if group in name];name=rng.choice(choices)
    yaw=(math.pi/2 if h>w else 0)+rng.uniform(-.025,.025)+(math.pi if rng.random()<.5 else 0)
    px=-2+(x+w/2)*.25+rng.uniform(-.0015,.0015);py=-2+(y+h/2)*.25+rng.uniform(-.0015,.0015)
    tone=rng.choices(['cream','buff','gray'],[.6,.2,.2])[0]
    obj=bpy.data.objects.new('placed-'+str(number),variants[name][0]);scene.collection.objects.link(obj)
    obj.location=(px,py,-.057);obj.rotation_euler=(0,0,yaw)
    # Object-linked material slots allow geometry sharing across tones.
    obj.material_slots[0].link='OBJECT';obj.material_slots[0].material=materials[tone]
    footprint=[(px+math.cos(yaw)*a-math.sin(yaw)*b,py+math.sin(yaw)*a+math.cos(yaw)*b) for a,b in outlines[name]]
    placements.append({'id':'stone-'+str(number),'variantId':name,'center':[px,-.057,-py],'yaw':yaw,'pitch':0,'roll':0,'scale':1,'tone':tone,'footprint':[[a,-b] for a,b in footprint]})
    objects.append(obj)

def joint_clearance(x,y):
    best=100
    for placement in placements:
        polygon=[(a,-b) for a,b in placement['footprint']]
        inside=False
        for (ax,ay),(bx,by) in zip(polygon,polygon[1:]+polygon[:1]):
            if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:inside=not inside
            dx,dy=bx-ax,by-ay;t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
            best=min(best,math.hypot(x-ax-t*dx,y-ay-t*dy))
        if inside:return -1
    return best

bpy.ops.mesh.primitive_grid_add(x_subdivisions=32,y_subdivisions=32,size=4)
ground=bpy.context.object;ground.name='continuous-earth';ground.data.materials.append(earth)
# Small irregular aggregate embedded in exposed joints.
aggregate=[]
for _ in range(4200):
    if len(aggregate)>=250:break
    x,y=rng.uniform(-1.98,1.98),rng.uniform(-1.98,1.98)
    if joint_clearance(x,y)<.003:continue
    radius=rng.uniform(.0015,.004)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=radius,location=(x,y,radius*.2))
    obj=bpy.context.object;obj.name='joint-aggregate';obj.scale=(1,rng.uniform(.6,1),rng.uniform(.35,.65));obj.data.materials.append(earth);aggregate.append(obj)

grass_vertices=[];grass_faces=[];grass_roots=[]
while len(grass_roots)<150:
    x,y=rng.uniform(-1.96,1.96),rng.uniform(-1.96,1.96);clearance=joint_clearance(x,y)
    if clearance<.004:continue
    grass_roots.append({'position':[x,0,-y],'footprintRadiusMetres':.002,'clearanceMetres':.001,'measuredSourceMarginMetres':clearance-.002})
    for blade in range(2 if len(grass_roots)<=120 else 1):
        angle=rng.uniform(0,math.tau);height=rng.uniform(.012,.025);start=len(grass_vertices)
        for i in range(5):
            t=i/4;width=.0015*(1-t);bend=.01*t*t
            for sign in (-1,1):grass_vertices.append((x+math.cos(angle)*bend+math.sin(angle)*width*sign,y+math.sin(angle)*bend-math.cos(angle)*width*sign,-.001+height*t))
        for i in range(4):
            a=start+i*2;grass_faces.extend(((a,a+1,a+3),(a,a+3,a+2)))
mesh=bpy.data.meshes.new('joint-grass');mesh.from_pydata(grass_vertices,[],grass_faces);mesh.materials.append(vegetation)
grass=bpy.data.objects.new('joint-grass',mesh);scene.collection.objects.link(grass)

world=bpy.data.worlds.new('physical-daylight');scene.world=world;world.use_nodes=True
nodes,links=world.node_tree.nodes,world.node_tree.links
nodes.get('Background').inputs['Color'].default_value=(.55,.68,.9,1);nodes.get('Background').inputs['Strength'].default_value=.35
bpy.ops.object.light_add(type='SUN',rotation=(.55,-.4,-.75));bpy.context.object.data.energy=3;bpy.context.object.data.angle=.08
bpy.ops.object.camera_add(location=(3.5,-4.0,3.2));camera=bpy.context.object;scene.camera=camera;camera.data.lens=48
def capture(name,location,target,lens=48):
    camera.location=location;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)

layout={'coordinateSystem':'canonical-rh-y-up','placements':placements,'grassRoots':grass_roots,'sourceGroundHeight':0,'stoneOrigin':'closed flat bottom, localY0','stoneThicknessMetres':.073,'nominalBurialDepthMetres':.057,'nominalTopExposureMetres':.016,'textureMetresPerUvUnit':.5,'toneFactors':TONES}
(OUT/'layout.json').write_text(json.dumps(layout,indent=2)+'\n')
(OUT/'source-metrics.json').write_text(json.dumps({'variants':[{'id':name,'width':w,'length':h,'triangles':[len(m.polygons) for m in variants[name]]} for name,w,h in specs],'placedStones':len(placements),'grassRoots':len(grass_roots),'aggregateObjects':len(aggregate),'materialOrigin':'generated single limestone diffuse; original procedural fine normal and authored macro geometry','estimatedFineBumpMetres':.00014},indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
capture('courtyard',(3.45,-4.3,3.4),(0,0,0),48)
capture('close-stones',(.75,-1.5,.65),(.2,-.6,.01),55)
# Rigid source-slope proof: stones tilt as wholes; earth remains continuous.
for obj,placement in zip(objects,placements):
    x,y=obj.location.x,obj.location.y
    normal=Vector((-.18,-.033*math.cos(y*1.1),1)).normalized()
    tilt=Vector((0,0,1)).rotation_difference(normal)
    yaw=Matrix.Rotation(placement['yaw'],4,'Z').to_quaternion()
    obj.rotation_mode='QUATERNION';obj.rotation_quaternion=tilt@yaw
    obj.location.z=terrain_height(x,y,True)-.057
for vertex in ground.data.vertices:vertex.co.z=terrain_height(vertex.co.x,vertex.co.y,True)
for vertex in grass.data.vertices:vertex.co.z+=terrain_height(vertex.co.x,vertex.co.y,True)
for obj in aggregate:obj.location.z+=terrain_height(obj.location.x,obj.location.y,True)
capture('sloped-courtyard',(3.45,-4.3,3.4),(0,0,0),48)
print('INDIVIDUAL_SOURCE '+json.dumps({'stones':len(placements),'variants':len(variants),'output':str(OUT)}))

