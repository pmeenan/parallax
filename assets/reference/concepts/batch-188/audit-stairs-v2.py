import bpy,json,pathlib
from mathutils import Vector
out=pathlib.Path(r"D:/src/parallax/assets/reference/concepts/batch-188")
bpy.context.view_layer.update()
rows=[]
for i in range(20):
 o=bpy.data.objects["Stair tread %02d"%i]
 coords=[o.matrix_world@Vector(v) for v in o.bound_box]
 rows.append({"tread":i,"x_min":min(p.x for p in coords)-516,"x_max":max(p.x for p in coords)-516,"z_min":min(p.y for p in coords)-146,"z_max":max(p.y for p in coords)-146,"top":max(p.z for p in coords),"horizontal_top":len(set(round(p.z,5) for p in coords))==2})
assert len(rows)==20 and all(r["horizontal_top"] for r in rows)
assert all(abs(rows[i]["top"]-rows[i+1]["top"]-0.1045)<1e-5 for i in range(19))
assert all(abs(r["z_max"]-r["z_min"]-0.5)<1e-5 for r in rows)
(out/"stair-geometry-audit-v2.json").write_text(json.dumps({"method":"Read saved v2 scene, transformed world bounds; no scene changes or rendering","treads":rows,"riser":0.1045,"tread_depth":0.5,"clear_width":3.4,"assertions":"PASS"},indent=2))
print("TWENTY PHYSICAL HORIZONTAL TREADS PASS")

