"""Read-only native source topology audit; no save or render."""
import bpy, bmesh, json, pathlib, struct
out=pathlib.Path(__file__).parent
stones=[]
for ob in bpy.data.objects:
    if ob.type!='MESH' or not ob.name.startswith('Limestone '): continue
    bm=bmesh.new();bm.from_mesh(ob.data)
    stones.append({'name':ob.name,'vertices':len(bm.verts),'faces':len(bm.faces),
        'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),
        'dimensions_m':list(ob.dimensions)})
    bm.free()
images=[]
for p in out.glob('*.png'):
    data=p.read_bytes();w,h=struct.unpack('>II',data[16:24])
    images.append({'file':p.name,'width':w,'height':h})
from mathutils import Vector
from mathutils.bvhtree import BVHTree
trees=[]
for ob in bpy.data.objects:
    if ob.type=='MESH' and ob.name.startswith('Limestone '):
        vs=[ob.matrix_world@v.co for v in ob.data.vertices]
        box=(min(v.x for v in vs),max(v.x for v in vs),min(v.y for v in vs),max(v.y for v in vs))
        trees.append((box,BVHTree.FromPolygons(vs,[list(p.vertices)for p in ob.data.polygons],all_triangles=True)))
soil=bpy.data.objects['Continuous earth substrate'];checks=0;above=0;worst=0
for face in soil.data.polygons:
    p=face.center
    for (a,b,c,d),tree in trees:
        if a<=p.x<=b and c<=p.y<=d:
            hit=tree.ray_cast(Vector((p.x,p.y,.2)),Vector((0,0,-1)),.4)[0]
            if hit is not None:
                checks+=1;delta=p.z-hit.z
                if delta>0:above+=1;worst=max(worst,delta)
report={'method':'Read existing source.blend in Blender; no scene save or render',
    'soil_face_center_checks_inside_stones':checks,'soil_face_centers_above_stone':above,'worst_intersection_m':worst,
    'stone_count':len(stones),'stones':stones,'images':images,
    'materials':len(bpy.data.materials),'packed_images':[im.name for im in bpy.data.images if im.packed_file],
    'limits':'Closed stone topology only. Does not establish leaf collision, material quality, export or runtime validity.'}
(out/'source-topology.json').write_text(json.dumps(report,indent=2))
print('AUDIT',len(stones),'stones;',sum(s['nonmanifold_edges'] for s in stones),'nonmanifold edges')
