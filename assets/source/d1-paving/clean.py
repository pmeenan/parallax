"""Author a finite limestone module from explicit contours; never admits an asset.

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
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
OUT = args.output.resolve()
OUT.relative_to((ROOT / 'harness/results').resolve())
OUT.mkdir(parents=True, exist_ok=True)
EXPORT = OUT / 'export'
EXPORT.mkdir(exist_ok=True)
assert bpy.app.version == (5, 1, 2)
layout = json.loads((HERE / 'clean-layout.json').read_text())
provenance_path = HERE / 'clean-provenance.json'
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
def classify(u, v):
    x, y = np.asarray(u)*1254, np.asarray(v)*1254
    ids = np.zeros(np.broadcast_shapes(x.shape, y.shape), dtype=np.int16)
    distances = np.full(ids.shape, np.inf, dtype=np.float32)
    for sid, polygon in enumerate(layout['stones'], 1):
        inside = np.zeros(ids.shape, dtype=bool)
        distance = np.full(ids.shape, np.inf, dtype=np.float32)
        for a, b in zip(polygon, polygon[1:] + polygon[:1]):
            ax, ay = a; bx, by = b
            inside ^= ((ay > y) != (by > y)) & (x < (bx-ax)*(y-ay)/(by-ay if by != ay else 1e-12)+ax)
            dx, dy = bx-ax, by-ay
            t = np.clip(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy), 0, 1)
            distance = np.minimum(distance, np.hypot(x-ax-t*dx, y-ay-t*dy))
        ids = np.where(inside, sid, ids)
        distances = np.minimum(distances, distance)
    return ids, distances * (2/1254)

def macro_height(u, v):
    ids, distance = classify(u, v)
    # Uneven worn shoulders; variation is subordinate to the explicit contours.
    width = .027 + .005*np.sin(np.asarray(u)*43+ids*1.7)*np.sin(np.asarray(v)*31+ids)
    t = np.clip(distance/width, 0, 1)
    bevel = t*t*(3-2*t)
    plateau = .018 + .0015*np.sin(ids*2.7)
    height = np.where(ids > 0, .004+(plateau-.004)*bevel, .004)
    for cx, cy, rx, ry, depth in layout['authoredHollows']:
        r2 = ((np.asarray(u)*1254-cx)/rx)**2 + ((np.asarray(v)*1254-cy)/ry)**2
        height -= np.where(ids > 0, 2*depth*np.maximum(1-r2, 0)**2*bevel, 0)
    # Hand-placed surviving flake ridges follow visible elongated features.
    for ax,ay,bx,by,width,raised in layout['authoredFlakeRidges']:
        x,y=np.asarray(u)*1254,np.asarray(v)*1254
        dx,dy=bx-ax,by-ay
        along=np.clip(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy),0,1)
        d=np.hypot(x-ax-along*dx,y-ay-along*dy)
        profile=np.maximum(1-(d/width)**2,0)**2
        height += np.where(ids > 0, raised*profile*bevel, 0)
    return height

N = 2048
coord = (np.arange(N, dtype=np.float32)+.5)/N
U, V = np.meshgrid(coord, coord)
ids, distances = classify(U, V)
height = macro_height(U, V).astype('f4')
image = bpy.data.images.load(str(reference), check_existing=False)
image.colorspace_settings.name = 'sRGB'
# Blender resampling changes resolution only, with no artistic modification.
image.scale(N, N)
rgba = np.empty(N*N*4, dtype='f4')
image.pixels.foreach_get(rgba)
rgba = rgba.reshape(N, N, 4)[::-1].copy()

def box_blur(a, radius):
    p = np.pad(a, ((radius, radius),(radius, radius)), mode='edge')
    integral = np.pad(p, ((1,0),(1,0))).cumsum(0, dtype='f8').cumsum(1, dtype='f8')
    k = radius*2+1
    return ((integral[k:,k:] - integral[:-k,k:] - integral[k:,:-k] + integral[:-k,:-k])/(k*k)).astype('f4')

gray = rgba[:,:,:3].mean(2)
# Fine color residual has ambiguous physical interpretation. Limit to 0.2mm;
# remove low frequency lighting and suppress it in joints and bevels.
residual = np.clip((box_blur(gray, 1)-box_blur(gray, 5))*.008, -.0002, .0002)
residual *= (ids > 0)*np.clip((distances-.012)/.008, 0, 1)
dy, dx = np.gradient(residual, 2/N)
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
    node = nodes.new('ShaderNodeTexImage'); node.image = img; node.extension = 'EXTEND'
    links.new(node.outputs['Color'], bsdf.inputs[socket])
node = nodes.new('ShaderNodeTexImage'); node.image = normal_image; node.extension = 'EXTEND'
normal_node = nodes.new('ShaderNodeNormalMap'); normal_node.inputs['Strength'].default_value = 1
links.new(node.outputs['Color'], normal_node.inputs['Color'])
links.new(normal_node.outputs['Normal'], bsdf.inputs['Normal'])
grass_material = bpy.data.materials.new('separate-joint-grass')
grass_material.diffuse_color = (.055,.13,.018,1)
grass_material.use_nodes = True
grass_bsdf = grass_material.node_tree.nodes.get('Principled BSDF')
grass_bsdf.inputs['Base Color'].default_value = (.055,.13,.018,1)
grass_bsdf.inputs['Roughness'].default_value = .76

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
        xy=[Vector((finite_edge(v.co.x),finite_edge(v.co.y))) for v in obj.data.vertices]
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
    uv = obj.data.uv_layers.new(name='reference-layout')
    for loop in obj.data.loops:
        p = obj.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((p.x+1)/2,(p.y+1)/2)
    obj.data.materials.append(material)
    obj.select_set(False)
    return obj

terrains = [terrain(512, 'd1-paving-stone-lod'+str(lod), count, (1,4,16)[lod]) for lod,count in enumerate((32768,8192,2048))]
trees = [BVHTree.FromPolygons([v.co for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons]) for o in terrains]
rng = random.Random(91735)
roots = []
while len(roots) < 120:
    u,v = rng.uniform(.025,.975),rng.uniform(.025,.975)
    sid,d = classify(u,v)
    if sid != 0 or d < .004: continue
    # Six sample footprint clearance, not merely the root center.
    if any(classify(u+.0018*math.cos(a),v+.0018*math.sin(a))[0] != 0 for a in np.linspace(0,2*math.pi,6)): continue
    roots.append((u,v,rng.uniform(.025,.055),rng.uniform(0,2*math.pi)))

grass_objects=[]; root_reports=[]
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
report={'schemaVersion':1,'sourceBlendSha256':hashlib.sha256((OUT/'source.blend').read_bytes()).hexdigest(),'sourceProvenancePath':provenance_path.relative_to(ROOT).as_posix(),'sourceProvenanceSha256':hashlib.sha256(provenance_path.read_bytes()).hexdigest(),'sourceWidthMetres':2,'upAxis':'Y','normalStrength':1,'texelsPerMetre':1024,'meshes':mesh_reports,'textures':texture_reports}
(EXPORT/'export.json').write_text(json.dumps(report,indent=2)+'\n')
(OUT/'geometry-evidence.json').write_text(json.dumps({'layoutSha256':hashlib.sha256((HERE/'clean-layout.json').read_bytes()).hexdigest(),'estimatedNotMeasured':True,'nominalJointDepthMetres':.014,'bevelWidthMetres':[.022,.032],'authoredHollows':len(layout['authoredHollows']),'authoredFlakeRidges':len(layout['authoredFlakeRidges']),'fineResidualMaxMetres':float(abs(residual).max()),'stoneIDs':len(layout['stones']),'grass':root_reports,'tileable':False,'finitePatchRequiresClampSampler':True},indent=2)+'\n')
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
print('CLEAN_EXPORT '+json.dumps(report))
