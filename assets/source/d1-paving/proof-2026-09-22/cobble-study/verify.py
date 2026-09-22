"""Reopen saved native bytes and verify retained artwork and fitted support."""
import bpy, numpy as np, json, hashlib, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).parent
OUT=ROOT/(sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'candidate1')
bpy.ops.wm.open_mainfile(filepath=str(OUT/'source.blend'));scene=bpy.context.scene
receipt=json.loads((OUT/'receipt.json').read_text())
def geom(ob,positions=True):
    d=ob.data
    return hashlib.sha256(repr((
        [tuple(v.co) for v in d.vertices] if positions else len(d.vertices),
        [tuple(p.vertices) for p in d.polygons],
        [[tuple(x.uv) for x in l.data] for l in d.uv_layers],
        {a.name:[tuple(x.color) for x in a.data] for a in d.color_attributes})).encode()).hexdigest()
def material(m):
    tree=m.node_tree
    nodes=[]
    for n in tree.nodes:
        im=getattr(n,'image',None)
        packed=(hashlib.sha256(bytes(im.packed_file.data)).hexdigest(),im.colorspace_settings.name) if im and im.packed_file else None
        nodes.append((n.name,n.bl_idname,packed,[(s.name,str(s.default_value)) for s in n.inputs if hasattr(s,'default_value')]))
    return hashlib.sha256(repr((nodes,[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in tree.links])).encode()).hexdigest()

stone_checks=[]
for label in 'ABC':
    path=ROOT.parent/'transfer'/label.lower()/'portable.blend'
    with bpy.data.libraries.load(str(path),link=False) as (src,dst):dst.objects=[n for n in src.objects if n.startswith('Limestone portable LOD0')]
    original=dst.objects[0];expected=geom(original);expected_mat=[material(m) for m in original.data.materials]
    matches=[scene.objects[r['object']] for r in receipt['layout'] if r['family']==label]
    assert all(geom(o)==expected for o in matches)
    assert all([material(m) for m in o.data.materials]==expected_mat for o in matches)
    stone_checks.append({'family':label,'placements':len(matches),'geometryUvUnchanged':True,'materialsPackedMapsUnchanged':True})
plant_source=ROOT.parent/'moss/candidate1/source.blend'
with bpy.data.libraries.load(str(plant_source),link=False) as (src,dst):
    names=[n for n in src.objects if n.startswith(('Broadleaf weed','Small seedling','Bowed uneven grass','Leafy moss colony'))]
    dst.objects=names.copy()
plant_checks=[]
for name,original in zip(names,dst.objects):
    current=scene.objects[name]
    assert [material(m) for m in current.data.materials]==[material(m) for m in original.data.materials],name
    assert geom(current,False)==geom(original,False),name
    error=0
    if name.startswith('Leafy moss'):
        a=np.array([v.co[:] for v in original.data.vertices]).reshape(-1,41,3)
        b=np.array([v.co[:] for v in current.data.vertices]).reshape(-1,41,3)
        error=float(np.max(np.abs((a-a[:,:1])-(b-b[:,:1]))));assert error<2.5e-7
    else:assert geom(current)==geom(original),name
    plant_checks.append({'name':name,'topologyUvColorUnchanged':True,'materialsPackedMapsUnchanged':True,'relativeShootMaximumErrorM':error})
soil=scene.objects['Continuous adaptive compacted earth']
tree=BVHTree.FromPolygons([v.co[:] for v in soil.data.vertices],[p.vertices[:] for p in soil.data.polygons],all_triangles=True)
root_errors=[]
for r in receipt['plantRecords']:
    x,y,z=r['rootM'];hit=tree.ray_cast(Vector((x,y,.3)),Vector((0,0,-1)),1)[0]
    root_errors.append(abs(hit.z-z-r['rootDepthM']))
assert max(root_errors)<1e-6
all_meshes=[o for o in scene.objects if o.type=='MESH']
assert all(np.isfinite(np.array([v.co[:] for v in o.data.vertices])).all() for o in all_meshes)
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in all_meshes)
assert triangles==receipt['triangles']['scene']
report={'source':str(OUT/'source.blend'),'sourceSha256':hashlib.sha256((OUT/'source.blend').read_bytes()).hexdigest(),
 'stoneChecks':stone_checks,'plantChecks':plant_checks,'maximumRootDepthErrorM':max(root_errors),
 'sceneTriangles':triangles,'finiteVertices':True,'fullQA':False,
 'scope':'Focused saved-source preservation/support checks; no full triangle collisions, engine or artistic acceptance'}
(OUT/'native-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print('NATIVE_CHECKS',len(stone_checks),len(plant_checks),max(root_errors),triangles)
