"""Reopen retained bytes and independently measure geometry/preservation/support."""
import bpy, numpy as np, json, hashlib, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).parent
name=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'candidate2'
OUT=ROOT/name
BASE=ROOT.parent/'cobble-study/candidate1'

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def geometry(ob):
    d=ob.data
    return hashlib.sha256(repr(([(tuple(v.co)) for v in d.vertices],
        [tuple(p.vertices) for p in d.polygons],[[tuple(v.uv) for v in l.data] for l in d.uv_layers],
        [list(row) for row in ob.matrix_world],[m.name for m in d.materials])).encode()).hexdigest()
def matsig(mat):
    nodes=[]
    for n in mat.node_tree.nodes:
        im=getattr(n,'image',None);pixels=None
        if im and im.has_data:
            a=np.empty(len(im.pixels),np.float32);im.pixels.foreach_get(a)
            pixels=(tuple(im.size),im.colorspace_settings.name,hashlib.sha256(a.tobytes()).hexdigest())
        nodes.append((n.name,n.bl_idname,pixels,[(s.name,str(s.default_value)) for s in n.inputs if hasattr(s,'default_value')]))
    links=[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in mat.node_tree.links]
    return hashlib.sha256(repr((nodes,links)).encode()).hexdigest()

bpy.ops.wm.open_mainfile(filepath=str(BASE/'source.blend'))
stones={o.name:geometry(o) for o in bpy.context.scene.objects if o.name.startswith('Paver ')}
mats={m.name:matsig(m) for ob in bpy.context.scene.objects if ob.type=='MESH' for m in ob.data.materials}
original_grit=bpy.context.scene.objects['Sparse embedded aggregate'].data
grit_source_coordinates=np.array([v.co[:] for v in original_grit.vertices])
grit_source_normals={tuple(p.vertices):[tuple(original_grit.corner_normals[k].vector) for k in p.loop_indices] for p in original_grit.polygons}
original=json.loads((BASE/'receipt.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(OUT/'source.blend'))
scene=bpy.context.scene
actual={o.name:geometry(o) for o in scene.objects if o.name.startswith('Paver ')}
assert actual==stones
active_mats={m.name:matsig(m) for ob in scene.objects if ob.type=='MESH' for m in ob.data.materials}
assert all(mats[name]==value for name,value in active_mats.items())
soil=scene.objects['Continuous adaptive compacted earth'];soil.data.calc_loop_triangles()
tree=BVHTree.FromPolygons([v.co[:] for v in soil.data.vertices],
    [p.vertices[:] for p in soil.data.loop_triangles],all_triangles=True)
def height(p):
    hit=tree.ray_cast(Vector((p[0],p[1],.4)),Vector((0,0,-1)),1)[0]
    assert hit is not None
    return hit.z
plants=[o for o in scene.objects if o.name.startswith(('Broadleaf weed','Small seedling','Bowed uneven grass','Leafy moss colony'))]
counts={};bounds={}
for ob in scene.objects:
    if ob.type!='MESH':continue
    ob.data.calc_loop_triangles();counts[ob.name]=len(ob.data.loop_triangles)
    a=np.array([ob.matrix_world@v.co for v in ob.data.vertices]);assert np.isfinite(a).all()
    bounds[ob.name]=[a.min(0).tolist(),a.max(0).tolist()]
    if not ob.name.startswith(('Paver ','Preview only')):
        assert np.max(np.abs(a[:,:2]))<=2.001, (ob.name,bounds[ob.name])
root_checks=[]
for rec in original['plantRecords']:
    ob=scene.objects[rec['name']]
    root=Vector(rec['sourceRootM'])+ob.location
    support=scene.objects.get(rec['name']+' petioles',ob)
    nearby=[support.matrix_world@v.co for v in support.data.vertices
        if ((support.matrix_world@v.co).xy-root.xy).length<.005]
    assert nearby, 'No retained stem geometry near authored root'
    lowest=min(nearby,key=lambda p:p.z)
    root_checks.append({'name':ob.name,'depthM':height(root)-root.z,'expectedM':rec['rootDepthM'],
        'actualLowestStemVertexDepthM':height(lowest)-lowest.z})
    assert abs(root_checks[-1]['depthM']-rec['rootDepthM'])<1e-6
    assert root_checks[-1]['actualLowestStemVertexDepthM']>0, 'Retained root floats'
moss_leaf_clearances=[]
for ob in plants:
    if not ob.name.startswith('Leafy moss'):continue
    # In silhouette candidate2, six stem vertices followed by 7*4 leaf vertices.
    if name in {'candidate2','candidate3'}:
        a=np.array([v.co[:] for v in ob.data.vertices]).reshape(-1,34,3)
        for shoot in a:
            root=shoot[:3].mean(0)
            assert abs(height(root)-root[2]-.00012)<1e-6
            moss_leaf_clearances.extend(p[2]-height(p) for p in shoot[6:])
grit=scene.objects['Sparse embedded aggregate'].data
neighbors=[set() for v in grit.vertices]
for edge in grit.edges:
    a,b=edge.vertices;neighbors[a].add(b);neighbors[b].add(a)
seen=set();components=0
used={i for p in grit.polygons for i in p.vertices}
for i in range(len(neighbors)):
    if i in seen or i not in used:continue
    components+=1;pending=[i];seen.add(i)
    while pending:
        for j in neighbors[pending.pop()]:
            if j not in seen:seen.add(j);pending.append(j)
grit_preservation=None
if name=='candidate3':
    actual_coordinates=np.array([v.co[:] for v in grit.vertices])
    delta=(actual_coordinates-grit_source_coordinates).reshape(-1,12,3)
    assert np.max(np.abs(delta[:,:,:2]))==0
    relative_error=float(np.max(np.ptp(delta[:,:,2],axis=1)))
    assert relative_error<1e-7, 'Grit must move rigidly'
    normal_error=0
    for p in grit.polygons:
        expected=grit_source_normals[tuple(p.vertices)]
        normal_error=max(normal_error,float(np.max(np.abs(np.array([grit.corner_normals[k].vector[:] for k in p.loop_indices])-expected))))
    assert normal_error<.0002
    retained_ids={i//12 for i in used}
    assert len(retained_ids)==components
    # Completely removed pieces must actually be buried, not lost by decimation.
    buried_ids=set(range(len(delta)))-retained_ids
    for i in buried_ids:
        assert all(p[2]<height(p)-.000299 for p in actual_coordinates[i*12:(i+1)*12])
    grit_preservation={'processedSourcePieces':len(delta),'retainedVisiblePieces':len(retained_ids),
        'fullyBuriedPiecesRemoved':len(buried_ids),'rigidVerticalShiftMaximumErrorM':relative_error,
        'originalCornerNormalMaximumComponentError':normal_error}
summary={'inputSha256':digest(BASE/'source.blend'),'candidateSha256':digest(OUT/'source.blend'),
    'stonesAndTransformsExact':True,'activeMaterialsAndPackedPixelsExact':True,
    'stoneCount':len(stones),'trianglesByObject':counts,'boundsByObject':bounds,
    'rootChecks':root_checks,'mossMinimumLeafClearanceM':min(moss_leaf_clearances) if moss_leaf_clearances else None,
    'retainedGritComponents':components,
    'unusedGritSourceVertices':len(grit.vertices)-len(used),
    'gritPreservation':grit_preservation,
    'scope':'Saved native preservation/metric checks; no production admission or visual acceptance',
    'limitations':['Vertex ground support, not complete triangle intersection test','No compressed runtime resources or engine validation']}
if moss_leaf_clearances:assert min(moss_leaf_clearances)>=0, 'Moss leaf below soil'
(OUT/'native-verification.json').write_text(json.dumps(summary,indent=2)+'\n')
print('VERIFIED',json.dumps({k:summary[k] for k in ['candidateSha256','stoneCount','mossMinimumLeafClearanceM']}))
