"""Bake unchanged source stone samples into a toroidal limestone module.

The reference bitmap is read unchanged. Height/normal/roughness are estimated
material data: joint-distance bevel, manually located hollows, and <=0.2mm
band-limited color residual. Color intensity is never the macro height field.
"""
import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import delaunay_2d_cdt

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--preview-only', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
OUT = args.output.resolve()
OUT.relative_to((ROOT / 'harness/results').resolve())
OUT.mkdir(parents=True, exist_ok=True)
EXPORT = OUT / 'export'
EXPORT.mkdir(exist_ok=True)
assert bpy.app.version == (5, 1, 2)
source_layout = json.loads((HERE / 'clean-layout.json').read_text())
packing = json.loads((HERE / 'periodic-packing.json').read_text())
layout = {'reference':packing['reference'],'stones':[],'authoredHollows':[],'authoredFlakeRidges':[]}
transforms=[]
for specification in packing['stones']:
    source_id,left,top,width,length=specification[:5]
    turns=specification[5] if len(specification)>5 else 0
    polygon=np.array(source_layout['stones'][source_id-1],dtype='f8')
    angle=turns*math.pi/2
    rotation=np.rint([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])
    rotated=polygon@rotation.T
    low=rotated.min(0);extent=rotated.max(0)-low
    scale=np.array([width-.003,length-.003])*1254/extent
    assert .8<=scale[0]/scale[1]<=1.2, 'Source stone aspect ratio exceeds 20% deviation'
    offset=np.array([left+.0015,top+.0015])*1254-low*scale
    matrix=np.diag(scale)@rotation
    transformed=polygon@matrix.T+offset
    layout['stones'].append(transformed.tolist())
    transforms.append((polygon,matrix,offset))
    source_low=polygon.min(0);source_high=polygon.max(0)
    for cx,cy,rx,ry,depth in source_layout['authoredHollows']:
        if source_low[0]<cx<source_high[0] and source_low[1]<cy<source_high[1]:
            center=matrix@np.array([cx,cy])+offset
            radii=abs(matrix)@np.array([rx,ry])
            layout['authoredHollows'].append([*center,*radii,depth])
    for ax,ay,bx,by,r,raised in source_layout['authoredFlakeRidges']:
        if source_low[0]<(ax+bx)/2<source_high[0] and source_low[1]<(ay+by)/2<source_high[1]:
            a=matrix@np.array([ax,ay])+offset;b=matrix@np.array([bx,by])+offset
            layout['authoredFlakeRidges'].append([*a,*b,r*float(min(scale)),raised])
provenance_path = HERE / 'periodic-provenance.json'
provenance = json.loads(provenance_path.read_text())
reference = ROOT / layout['reference']
assert any(e['sha256'] == hashlib.sha256(reference.read_bytes()).hexdigest() for e in provenance['inputs'])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'

# Classification is entirely explicit geometry in reference-image coordinates.
def warp_y(x,y):
    return y+.006*np.sin(math.tau*x*3+np.sin(math.tau*y))+.004*np.sin(math.tau*x*5+1.2)

def unwarp(u,v):
    y=np.asarray(v)
    for _ in range(4):y=np.asarray(v)-(warp_y(u,y)-y)
    return u,y

def classify(u, v):
    x,y=np.broadcast_arrays((np.asarray(u)%1)*1254,(np.asarray(v)%1)*1254)
    shape=x.shape;x=x.ravel();y=y.ravel()
    ids=np.zeros(x.shape,dtype=np.int16);distances=np.full(x.shape,100,dtype='f4')
    for sid, polygon in enumerate(layout['stones'], 1):
        for ox in (-1254,0,1254):
            for oy in (-1254,0,1254):
                poly=np.asarray(polygon)+[ox,oy];low=poly.min(0)-40;high=poly.max(0)+40
                select=(x>=low[0])&(x<=high[0])&(y>=low[1])&(y<=high[1])
                if not select.any():continue
                xx,yy=x[select],y[select]
                inside=np.zeros(xx.shape,dtype=bool);distance=np.full(xx.shape,100,dtype='f4')
                for a,b in zip(poly,np.roll(poly,-1,axis=0)):
                    ax,ay=a;bx,by=b;dx,dy=bx-ax,by-ay
                    inside^=((ay>yy)!=(by>yy))&(xx<(bx-ax)*(yy-ay)/(by-ay if by!=ay else 1e-12)+ax)
                    t=np.clip(((xx-ax)*dx+(yy-ay)*dy)/(dx*dx+dy*dy),0,1)
                    distance=np.minimum(distance,np.hypot(xx-ax-t*dx,yy-ay-t*dy))
                ids[select]=np.where(inside,sid,ids[select]);distances[select]=np.minimum(distances[select],distance)
    return ids.reshape(shape),distances.reshape(shape)*(2/1254)

def macro_height(u, v):
    u,v=unwarp(u,v)
    ids, distance = classify(u, v)
    # Uneven worn shoulders; variation is subordinate to the explicit contours.
    width = .027 + .005*np.sin((np.asarray(u)%1)*math.tau*7+ids*1.7)*np.sin((np.asarray(v)%1)*math.tau*5+ids)
    t = np.clip(distance/width, 0, 1)
    bevel = t*t*(3-2*t)
    plateau = .018 + .0015*np.sin(ids*2.7)
    # Separate earth has small uneven compaction; stone plateaus are unaffected.
    soil=.004+.0012*np.sin(math.tau*np.asarray(u)*11+np.sin(math.tau*np.asarray(v)*7))*np.sin(math.tau*np.asarray(v)*13)
    height = np.where(ids > 0, soil+(plateau-soil)*bevel, soil)
    for cx, cy, rx, ry, depth in layout['authoredHollows']:
        dx=((np.asarray(u)*1254-cx+627)%1254)-627
        dy=((np.asarray(v)*1254-cy+627)%1254)-627
        r2 = (dx/rx)**2 + (dy/ry)**2
        height -= np.where(ids > 0, 2*depth*np.maximum(1-r2, 0)**2*bevel, 0)
    # Hand-placed surviving flake ridges follow visible elongated features.
    for ax,ay,bx,by,width,raised in layout['authoredFlakeRidges']:
        cx,cy=(ax+bx)/2,(ay+by)/2
        x=((np.asarray(u)*1254-cx+627)%1254)-627+cx
        y=((np.asarray(v)*1254-cy+627)%1254)-627+cy
        dx,dy=bx-ax,by-ay
        along=np.clip(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy),0,1)
        d=np.hypot(x-ax-along*dx,y-ay-along*dy)
        profile=np.maximum(1-(d/width)**2,0)**2
        height += np.where(ids > 0, raised*profile*bevel, 0)
    return height

def bake_atlas():
    source=bpy.data.images.load(str(reference),check_existing=False)
    mat=bpy.data.materials.new('unchanged-reference-stone-samples');mat.use_nodes=True
    nodes=mat.node_tree.nodes;nodes.clear()
    tex=nodes.new('ShaderNodeTexImage');tex.image=source;tex.extension='EXTEND'
    em=nodes.new('ShaderNodeEmission');dest=nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(tex.outputs['Color'],em.inputs['Color']);mat.node_tree.links.new(em.outputs[0],dest.inputs[0])
    for sid,(poly,matrix,offset) in enumerate(transforms):
        for ox in (-1254,0,1254):
            for oy in (-1254,0,1254):
                points=poly@matrix.T+offset+[ox,oy]
                if points[:,0].max()<0 or points[:,0].min()>1254 or points[:,1].max()<0 or points[:,1].min()>1254:continue
                mesh=bpy.data.meshes.new('atlas-stone');mesh.from_pydata([(x/627-1,1-2*warp_y(x/1254,y/1254),.001) for x,y in points],[],[tuple(reversed(range(len(points))))]);mesh.update()
                obj=bpy.data.objects.new('atlas-stone',mesh);scene.collection.objects.link(obj);mesh.materials.append(mat)
                uv=mesh.uv_layers.new(name='source-stone-sample')
                for loop in mesh.loops:
                    x,y=poly[loop.vertex_index];uv.data[loop.index].uv=(x/1254,1-y/1254)
    # A periodic 4D noise shader supplies neutral mineral grit only in joints.
    grout=bpy.data.materials.new('periodic-mineral-joints');grout.use_nodes=True
    nodes=grout.node_tree.nodes;nodes.clear();links=grout.node_tree.links
    geometry=nodes.new('ShaderNodeNewGeometry');separate=nodes.new('ShaderNodeSeparateXYZ');links.new(geometry.outputs['Position'],separate.inputs[0])
    trig=[]
    for axis,operation in [('X','COSINE'),('X','SINE'),('Y','COSINE'),('Y','SINE')]:
        multiply=nodes.new('ShaderNodeMath');multiply.operation='MULTIPLY';multiply.inputs[1].default_value=math.pi;links.new(separate.outputs[axis],multiply.inputs[0])
        fn=nodes.new('ShaderNodeMath');fn.operation=operation;links.new(multiply.outputs[0],fn.inputs[0]);trig.append(fn)
    combine=nodes.new('ShaderNodeCombineXYZ')
    for i in range(3):links.new(trig[i].outputs[0],combine.inputs[i])
    noise=nodes.new('ShaderNodeTexNoise');noise.noise_dimensions='4D';noise.inputs['Scale'].default_value=48;noise.inputs['Detail'].default_value=2
    links.new(combine.outputs[0],noise.inputs['Vector']);links.new(trig[3].outputs[0],noise.inputs['W'])
    ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.12,.113,.095,1);ramp.color_ramp.elements[1].color=(.20,.187,.163,1);links.new(noise.outputs['Fac'],ramp.inputs[0])
    em=nodes.new('ShaderNodeEmission');dest=nodes.new('ShaderNodeOutputMaterial');links.new(ramp.outputs[0],em.inputs[0]);links.new(em.outputs[0],dest.inputs[0])
    bpy.ops.mesh.primitive_plane_add(size=6);bpy.context.object.data.materials.append(grout)
    bpy.ops.object.camera_add(location=(0,0,3));camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=2;scene.camera=camera
    scene.view_settings.view_transform='Standard';scene.cycles.samples=16;scene.render.resolution_x=2048;scene.render.resolution_y=2048
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_depth='16';scene.render.film_transparent=False
    scene.render.filepath=str(OUT/'periodic-color-bake.png');bpy.ops.render.render(write_still=True)
    # Preview actual repeat sampling of the bake, rather than editing a montage.
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    bake=bpy.data.images.load(str(OUT/'periodic-color-bake.png'),check_existing=False)
    preview=bpy.data.materials.new('periodic-bake-repeat-preview');preview.use_nodes=True
    nodes=preview.node_tree.nodes;nodes.clear();tex=nodes.new('ShaderNodeTexImage');tex.image=bake;tex.extension='REPEAT'
    em=nodes.new('ShaderNodeEmission');dest=nodes.new('ShaderNodeOutputMaterial');preview.node_tree.links.new(tex.outputs[0],em.inputs[0]);preview.node_tree.links.new(em.outputs[0],dest.inputs[0])
    bpy.ops.mesh.primitive_plane_add(size=4);obj=bpy.context.object;obj.data.materials.append(preview)
    for uv in obj.data.uv_layers.active.data:uv.uv*=2
    bpy.ops.object.camera_add(location=(0,0,3));camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=4;scene.camera=camera
    scene.render.resolution_x=1400;scene.render.resolution_y=1400;scene.cycles.samples=1
    scene.render.filepath=str(OUT/'atlas-repeat-2x2.png');bpy.ops.render.render(write_still=True)
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    scene.view_settings.view_transform='AgX';scene.cycles.samples=32;scene.render.resolution_x=1200;scene.render.resolution_y=1200
    scene.render.image_settings.color_depth='8'
    return bake

image=bake_atlas()
if args.preview_only:sys.exit(0)
N = 2048
coord = (np.arange(N, dtype=np.float32)+.5)/N
U, V = np.meshgrid(coord, coord)
ids, distances = classify(*unwarp(U, V))
height = macro_height(U, V).astype('f4')
image.colorspace_settings.name = 'sRGB'
# Blender resampling changes resolution only, with no artistic modification.
image.scale(N, N)
rgba = np.empty(N*N*4, dtype='f4')
image.pixels.foreach_get(rgba)
rgba = rgba.reshape(N, N, 4)[::-1].copy()

def box_blur(a, radius):
    p = np.pad(a, ((radius, radius),(radius, radius)), mode='wrap')
    integral = np.pad(p, ((1,0),(1,0))).cumsum(0, dtype='f8').cumsum(1, dtype='f8')
    k = radius*2+1
    return ((integral[k:,k:] - integral[:-k,k:] - integral[k:,:-k] + integral[:-k,:-k])/(k*k)).astype('f4')

gray = rgba[:,:,:3].mean(2)
# Fine color residual has ambiguous physical interpretation. Limit to 0.2mm;
# remove low frequency lighting and suppress it in joints and bevels.
residual = np.clip((box_blur(gray, 1)-box_blur(gray, 5))*.008, -.0002, .0002)
residual *= (ids > 0)*np.clip((distances-.012)/.008, 0, 1)
residual += (ids==0)*.00018*np.sin(math.tau*U*97+np.sin(math.tau*V*57))*np.sin(math.tau*V*89)
dx=(np.roll(residual,-1,axis=1)-np.roll(residual,1,axis=1))/(4/N)
dy=(np.roll(residual,-1,axis=0)-np.roll(residual,1,axis=0))/(4/N)
normal = np.dstack((-dx, dy, np.ones_like(dx)))
normal /= np.linalg.norm(normal, axis=2, keepdims=True)
normal_rgba = np.dstack((normal*.5+.5, np.ones_like(dx))).astype('f4')
roughness = np.where(ids > 0, .79 + np.clip(abs(residual)*180, 0, .05), .94).astype('f4')
orm = np.dstack((np.ones_like(dx), roughness, np.zeros_like(dx), np.ones_like(dx)))

def make_image(name, pixels, color=False):
    h, w = pixels.shape[:2]
    result = bpy.data.images.new(name, width=w, height=h, float_buffer=True)
    result.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    result.pixels.foreach_set(pixels[::-1].astype('f4').ravel())
    result.pack()
    return result

normal_image = make_image('estimated-residual-normal', normal_rgba)
rough_image = make_image('authored-roughness', np.dstack((roughness, roughness, roughness, np.ones_like(dx))))
material = bpy.data.materials.new('clean-limestone-generated-reference')
material.use_nodes = True
nodes, links = material.node_tree.nodes, material.node_tree.links
bsdf = nodes.get('Principled BSDF')
for img, socket in ((image, 'Base Color'), (rough_image, 'Roughness')):
    node = nodes.new('ShaderNodeTexImage'); node.image = img; node.extension = 'REPEAT'
    links.new(node.outputs['Color'], bsdf.inputs[socket])
node = nodes.new('ShaderNodeTexImage'); node.image = normal_image; node.extension = 'REPEAT'
normal_node = nodes.new('ShaderNodeNormalMap'); normal_node.inputs['Strength'].default_value = 1
links.new(node.outputs['Color'], normal_node.inputs['Color'])
links.new(normal_node.outputs['Normal'], bsdf.inputs['Normal'])
grass_material = bpy.data.materials.new('separate-joint-grass')
grass_material.diffuse_color = (.055,.13,.018,1)
grass_material.use_nodes = True
grass_bsdf = grass_material.node_tree.nodes.get('Principled BSDF')
grass_bsdf.inputs['Base Color'].default_value = (.055,.13,.018,1)
grass_bsdf.inputs['Roughness'].default_value = .76

analytic_normals={}

def field_normals(x,y):
    u,v=(np.asarray(x)+1)/2,(1-np.asarray(y))/2
    step=1/8192
    # u/v cover two metres. Central differences use the wrapped neighborhood.
    dx=(macro_height(u+step,v)-macro_height(u-step,v))/(4*step)
    dy=-(macro_height(u,v+step)-macro_height(u,v-step))/(4*step)
    normal=np.column_stack((-dx,-dy,np.ones_like(dx)))
    return normal/np.linalg.norm(normal,axis=1,keepdims=True)

def terrain(segments, name, target, boundary_step):
    c = np.linspace(0,1,segments+1)
    u,v = np.meshgrid(c,c)
    h = macro_height(u,v)
    vertices = np.column_stack(((u*2-1).ravel(), (1-v*2).ravel(), h.ravel()))
    faces = []
    for y in range(segments):
        for x in range(segments):
            a = y*(segments+1)+x
            faces.extend(((a,a+segments+2,a+1),(a,a+segments+1,a+segments+2)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices.tolist(), [], faces); mesh.update()
    obj = bpy.data.objects.new(name,mesh); scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    if len(faces) > target:
        group = obj.vertex_groups.new(name='interior-only-decimation')
        collapsible = []
        for i in range(len(vertices)):
            x,y=i%(segments+1),i//(segments+1)
            on_edge=x in (0,segments) or y in (0,segments)
            # Lower tiers retain sparse exact perimeter samples, so their
            # triangle budget can represent interiors rather than a boundary fan.
            protected=on_edge and x%boundary_step==0 and y%boundary_step==0
            if not protected:collapsible.append(i)
        group.add(collapsible,1,'REPLACE')
        mod = obj.modifiers.new('preserve-boundary-adaptive','DECIMATE')
        # Sparse-boundary simplification may move edge points into the interior;
        # reserve headroom for their complete planar retriangulation.
        collapse_target = target-64 if boundary_step==1 else int((target-64)*.85)
        mod.ratio = collapse_target/len(faces); mod.vertex_group = group.name; mod.vertex_group_factor = 1
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        # Decimation can fold projected triangles at steep relief. Re-triangulate
        # its adaptive point set in the UV plane, then re-sample authored height.
        # This gives a complete nonoverlapping heightfield, not patched holes.
        def finite_edge(value):
            # Simplifier drift below 0.1mm must not produce UV slivers which
            # collapse to identical float32 texcoords at the finite perimeter.
            return math.copysign(1,value) if abs(value)>.9999 else value
        # Discard independent simplifier edge choices. Every LOD receives the
        # identical 128-interval perimeter, with one shared periodic profile.
        xy=[Vector((v.co.x,v.co.y)) for v in obj.data.vertices if abs(v.co.x)<.999 and abs(v.co.y)<.999]
        boundary=np.linspace(-1,1,129)
        xy.extend(Vector((float(t),side)) for side in (-1.,1.) for t in boundary)
        xy.extend(Vector((side,float(t))) for side in (-1.,1.) for t in boundary[1:-1])
        points,_,triangles,_,_,_=delaunay_2d_cdt(xy,[],[],0,1e-6,False)
        sx=np.array([p.x for p in points]);sy=np.array([p.y for p in points])
        sh=macro_height((sx+1)/2,(1-sy)/2)
        replacement=bpy.data.meshes.new(name+'-planar-adaptive')
        replacement.from_pydata([(float(x),float(y),float(z)) for x,y,z in zip(sx,sy,sh)],[],triangles)
        replacement.update();obj.data=replacement
        assert len(triangles)<=target, 'Adaptive triangulation exceeds LOD budget'
        interior_count=sum(abs(v.co.x)<.99999 and abs(v.co.y)<.99999 for v in obj.data.vertices)
        assert interior_count>target//4, 'Boundary vertices starve the LOD interior'
    for p in obj.data.polygons: p.use_smooth = True
    coords=np.array([v.co[:] for v in obj.data.vertices])
    normals=field_normals(coords[:,0],coords[:,1])
    obj.data.normals_split_custom_set_from_vertices(normals.tolist())
    analytic_normals[name]=normals
    uv = obj.data.uv_layers.new(name='reference-layout')
    for loop in obj.data.loops:
        p = obj.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((p.x+1)/2,(p.y+1)/2)
    obj.data.materials.append(material)
    obj.select_set(False)
    return obj

terrains = [terrain(512, 'd1-paving-stone-lod'+str(lod), count, (4,4,16)[lod]) for lod,count in enumerate((32768,8192,2048))]
trees = [BVHTree.FromPolygons([v.co for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons]) for o in terrains]
rng = random.Random(91735)
roots = []
while len(roots) < 120:
    u,v = rng.uniform(.004,.996),rng.uniform(.004,.996)
    sid,d = classify(*unwarp(u,v))
    if sid != 0 or d < .004: continue
    # Six sample footprint clearance, not merely the root center.
    if any(classify(*unwarp(u+.0018*math.cos(a),v+.0018*math.sin(a)))[0] != 0 for a in np.linspace(0,2*math.pi,6)): continue
    roots.append((u,v,rng.uniform(.025,.055),rng.uniform(0,2*math.pi)))

grass_objects=[]; root_reports=[]

def wrap_grass(vertices,faces):
    """Clip crossing blades and translate continuations to the opposite tile."""
    points=[];triangles=[];lookup={}
    for face in faces:
        source=[np.array(vertices[i],dtype='f8') for i in face]
        shifts=[(0,0)] if all(abs(p[0])<=1 and abs(p[1])<=1 for p in source) else [(x,y) for x in (-2,0,2) for y in (-2,0,2)]
        for sx,sy in shifts:
            poly=[p+np.array([sx,sy,0]) for p in source]
            for axis,sign in ((0,1),(0,-1),(1,1),(1,-1)):
                if not poly:break
                clipped=[]
                for a,b in zip(poly,poly[1:]+poly[:1]):
                    da,db=a[axis]*sign-1,b[axis]*sign-1
                    if da<=0:clipped.append(a)
                    if (da<=0)!=(db<=0):clipped.append(a+(b-a)*(da/(da-db)))
                poly=clipped
            if len(poly)<3:continue
            indices=[]
            for p in poly:
                key=tuple(p)
                if key not in lookup:lookup[key]=len(points);points.append(key)
                indices.append(lookup[key])
            for i in range(1,len(indices)-1):triangles.append((indices[0],indices[i],indices[i+1]))
    return points,triangles

for lod, tree in enumerate(trees):
    vertices=[]; faces=[]; signed=[]
    for u,v,length,angle in roots[::1<<lod]:
        x,y=u*2-1,1-v*2
        hit=tree.ray_cast(Vector((x,y,.2)),Vector((0,0,-1)))[0]
        assert hit is not None
        z=hit.z-.0015
        signed.append(z-hit.z)
        start=len(vertices)
        for step in range(11):
            t=step/10; width=.0028*(1-t)
            bend=.012*t*t
            for sign in (-1,1):
                vertices.append((x+math.cos(angle)*bend+math.sin(angle)*width*sign, y+math.sin(angle)*bend-math.cos(angle)*width*sign,z+length*t))
        for step in range(10):
            a=start+2*step; faces.extend(((a,a+1,a+3),(a,a+3,a+2)))
    vertices,faces=wrap_grass(vertices,faces)
    mesh=bpy.data.meshes.new('d1-paving-grass-lod'+str(lod));mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj);mesh.materials.append(grass_material)
    grass_objects.append(obj)
    root_reports.append({'lod':lod,'blades':len(signed),'rootOffsetMetres':[min(signed),max(signed)],'stoneFootprintOverlaps':0})

mesh_reports=[]
for lod in range(3):
    for role,obj in [('stone',terrains[lod]),('grass',grass_objects[lod])]:
        mesh=obj.data;mesh.calc_loop_triangles()
        if role=='stone':mesh.calc_tangents(uvmap='reference-layout')
        attributes=[];indices=[];lookup={};skipped=0
        for triangle in mesh.loop_triangles:
            points=[mesh.vertices[mesh.loops[l].vertex_index].co for l in triangle.loops]
            if (points[1]-points[0]).cross(points[2]-points[0]).length<1e-12:skipped+=1;continue
            for li in triangle.loops:
                loop=mesh.loops[li];vertex=mesh.vertices[loop.vertex_index];p,n=vertex.co,vertex.normal
                if role=='stone':
                    n=Vector(analytic_normals[obj.name][loop.vertex_index])
                    uv=mesh.uv_layers.active.data[li].uv;t=loop.tangent
                    values=(p.x,p.z,-p.y,n.x,n.z,-n.y,uv.x,1-uv.y,t.x,t.z,-t.y,-loop.bitangent_sign)
                else:values=(p.x,p.z,-p.y,n.x,n.z,-n.y,0.,0.,1.,0.,0.,1.)
                if values not in lookup:lookup[values]=len(attributes);attributes.append(values)
                indices.append(lookup[values])
        if role=='grass':
            count=len(attributes)
            attributes.extend([tuple(list(v[:3])+[-n for n in v[3:6]]+list(v[6:11])+[-v[11]]) for v in list(attributes)])
            indices.extend([indices[i+j]+count for i in range(0,len(indices),3) for j in (2,1,0)])
        a=np.asarray(attributes,dtype='<f4');i=np.asarray(indices,dtype='<u4');stem=f'lod{lod}-{role}'
        a.tofile(EXPORT/(stem+'.vertices'));i.tofile(EXPORT/(stem+'.indices'))
        mesh_reports.append({'lod':lod,'role':role,'stem':stem,'vertices':len(a),'triangles':len(i)//3,'bounds':[a[:,:3].min(0).tolist(),a[:,:3].max(0).tolist()],'removedZeroAreaTriangles':skipped})
        obj.hide_render=lod!=0

texture_reports=[]
for role,pixels in [('baseColor',rgba),('normal',normal_rgba),('orm',orm.reshape(1024,2,1024,2,4).mean((1,3)))]:
    levels=[];size=pixels.shape[0];level=0
    while True:
        encoded=pixels.copy()
        if role=='baseColor':
            rgb=encoded[:,:,:3];rgb[:]=np.where(rgb<=.0031308,rgb*12.92,1.055*np.maximum(rgb,0)**(1/2.4)-.055)
        encoded[:,:,3]=1
        filename=f'{role}-{level}.rgba'
        np.rint(np.clip(encoded,0,1)*255).astype('u1').tofile(EXPORT/filename)
        levels.append({'file':filename,'width':size,'height':size})
        if size==1:break
        pixels=pixels.reshape(size//2,2,size//2,2,4).mean((1,3))
        if role=='normal':
            xyz=pixels[:,:,:3]*2-1;xyz/=np.maximum(np.linalg.norm(xyz,axis=2,keepdims=True),1e-6);pixels[:,:,:3]=xyz*.5+.5
        size//=2;level+=1
    texture_reports.append({'role':role,'levels':levels,'linearComponentsClippedFraction':0})

world=bpy.data.worlds.new('neutral-daylight');scene.world=world;world.use_nodes=True
world.node_tree.nodes.get('Background').inputs[0].default_value=(.55,.63,.75,1)
world.node_tree.nodes.get('Background').inputs[1].default_value=.6
bpy.ops.object.light_add(type='AREA',location=(-1.5,-2.0,3.5))
bpy.context.object.data.energy=350;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=3
bpy.ops.object.camera_add(location=(0,0,3))
camera=bpy.context.object;scene.camera=camera
image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
report={'schemaVersion':1,'periodic':True,'textureAddressMode':'repeat','sourceBlendSha256':hashlib.sha256((OUT/'source.blend').read_bytes()).hexdigest(),'sourceProvenancePath':provenance_path.relative_to(ROOT).as_posix(),'sourceProvenanceSha256':hashlib.sha256(provenance_path.read_bytes()).hexdigest(),'sourceWidthMetres':2,'upAxis':'Y','normalStrength':1,'texelsPerMetre':1024,'meshes':mesh_reports,'textures':texture_reports}
(EXPORT/'export.json').write_text(json.dumps(report,indent=2)+'\n')
(OUT/'geometry-evidence.json').write_text(json.dumps({'layoutSha256':hashlib.sha256((HERE/'clean-layout.json').read_bytes()).hexdigest(),'packingSha256':hashlib.sha256((HERE/'periodic-packing.json').read_bytes()).hexdigest(),'estimatedNotMeasured':True,'nominalJointDepthMetres':.014,'bevelWidthMetres':[.022,.032],'authoredHollows':len(layout['authoredHollows']),'authoredFlakeRidges':len(layout['authoredFlakeRidges']),'fineResidualMaxMetres':float(abs(residual).max()),'stoneIDs':len(layout['stones']),'grass':root_reports,'tileable':True,'boundaryIntervalsPerEdge':128,'mirrored':False},indent=2)+'\n')
for view,location in [('overhead',(0,0,3)),('grazing',(1.8,-2.3,1.0))]:
    camera.location=location;camera.rotation_euler=(Vector((0,0,.015))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=2.35 if view=='overhead' else 2.8
    scene.render.filepath=str(OUT/(view+'.png'));bpy.ops.render.render(write_still=True)
world.node_tree.nodes.get('Background').inputs[1].default_value=.25
for obj in scene.objects:
    if obj.type=='LIGHT':obj.hide_render=True
bpy.ops.object.light_add(type='SUN',location=(-2,-3,5))
sun=bpy.context.object;sun.rotation_euler=(.45,-.6,-.45);sun.data.energy=2;sun.data.angle=.08
scene.render.filepath=str(OUT/'grazing-sunny.png');bpy.ops.render.render(write_still=True)
# Inspect repeated complete geometry under the same directional lighting.
for sx,sy in ((2,0),(0,2),(2,2)):
    for original in (terrains[0],grass_objects[0]):
        duplicate=original.copy();duplicate.data=original.data;duplicate.location=(sx,sy,0);scene.collection.objects.link(duplicate)
camera.location=(4.0,-3.8,2.6);camera.rotation_euler=(Vector((1,1,.015))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=5.9
scene.render.resolution_x=1500;scene.render.resolution_y=1200
scene.render.filepath=str(OUT/'periodic-geometry-2x2-grazing.png');bpy.ops.render.render(write_still=True)
print('CLEAN_EXPORT '+json.dumps(report))
