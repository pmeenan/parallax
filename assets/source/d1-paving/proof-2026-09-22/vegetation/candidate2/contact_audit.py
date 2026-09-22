"""Read-only moss burial/stone overlap and preserved camera/light audit."""
import bpy,json,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
OUT=Path(__file__).parent;r=json.loads((OUT/'receipt.json').read_text())
def setup():
    s=bpy.context.scene
    return {'camera':{'location':list(s.camera.location),'rotation':list(s.camera.rotation_euler),'lens':s.camera.data.lens},'lights':{o.name:{'location':list(o.location),'rotation':list(o.rotation_euler),'energy':o.data.energy,'size':o.data.size} for o in s.objects if o.type=='LIGHT'},'world':[(n.name,str([i.default_value for i in n.inputs if hasattr(i,'default_value')])) for n in s.world.node_tree.nodes]}
bpy.ops.wm.open_mainfile(filepath=r['source']);original=setup()
bpy.ops.wm.open_mainfile(filepath=str(OUT/'source.blend'));current=setup();scene=bpy.context.scene
soil=scene.objects['Continuous adaptive compacted earth'];st=BVHTree.FromPolygons([v.co[:] for v in soil.data.vertices],[p.vertices[:] for p in soil.data.polygons],all_triangles=True)
deps=bpy.context.evaluated_depsgraph_get();stones=[(o,BVHTree.FromObject(o,deps)) for o in scene.objects if o.name.startswith('Paver ')]
report={'cameraLightingPreserved':original==current,'originalSettings':original,'currentSettings':current,'moss':{}}
for ob in scene.objects:
    if not ob.name.startswith('Low connected moss cushion'):continue
    offsets=[];stone_overlaps=0
    for v in ob.data.vertices:
        p=ob.matrix_world@v.co;hit=st.ray_cast(Vector((p.x,p.y,.3)),Vector((0,0,-1)),1)[0];offsets.append(p.z-hit.z)
        for stone,tree in stones:
            inv=stone.matrix_world.inverted();hit=tree.ray_cast(inv@Vector((p.x,p.y,.3)),Vector((0,0,-1)),1)[0]
            if hit is not None and (stone.matrix_world@hit).z>p.z:stone_overlaps+=1;break
    report['moss'][ob.name]={'vertices':len(offsets),'minimumAboveActualSoilM':min(offsets),'maximumAboveActualSoilM':max(offsets),'verticesAtOrBelowSoil':sum(v<=0 for v in offsets),'verticesBelowStoneTopAtSameXY':stone_overlaps,'triangles':sum(len(p.vertices)-2 for p in ob.data.polygons)}
report['interpretation']='Thin connected source cushions; intended boundaries seat below soil. Visibility/organic moss appearance require visual judgment, not inferred from these counts.'
(OUT/'contact-audit.json').write_text(json.dumps(report,indent=2)+'\n')
