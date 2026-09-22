"""Read-only native geometry audit of final bounded patch."""
import bpy,json,math,bmesh,hashlib
from pathlib import Path
OUT=Path(__file__).parent
bpy.ops.wm.open_mainfile(filepath=str(OUT/'source.blend'))
soil=bpy.context.scene.objects['Continuous adaptive compacted earth']
bm=bmesh.new();bm.from_mesh(soil.data);bm.verts.ensure_lookup_table();bm.verts.index_update()
seen=set();components=0
for v in bm.verts:
    if v.index in seen:continue
    components+=1;stack=[v];seen.add(v.index)
    while stack:
        q=stack.pop()
        for e in q.link_edges:
            other=e.other_vert(q)
            if other.index not in seen:seen.add(other.index);stack.append(other)
audit={'soilConnectedComponents':components,'soilBoundaryEdges':sum(e.is_boundary for e in bm.edges),'soilNonmanifoldInteriorEdges':sum(not e.is_manifold and not e.is_boundary for e in bm.edges),'soilFiniteCoordinates':all(math.isfinite(x) for v in bm.verts for x in v.co),'soilFacesAreaBelow1e14M2':sum(f.calc_area()<1e-14 for f in bm.faces),'soilFaces':len(bm.faces),'soilVertices':len(bm.verts)}
bm.free();assert audit['soilConnectedComponents']==1 and audit['soilNonmanifoldInteriorEdges']==0 and audit['soilFiniteCoordinates'] and audit['soilFacesAreaBelow1e14M2']==0
audit['sourceSha256']=hashlib.sha256((OUT/'source.blend').read_bytes()).hexdigest()
audit['scope']='Focused geometric evidence; no UV, texture, engine, rights or visual acceptance test.'
(OUT/'geometry-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
