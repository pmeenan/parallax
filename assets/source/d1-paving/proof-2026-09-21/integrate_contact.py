"""Screened family contact test, local packed edge banks and joint fines.

Load family source in isolated Blender. Every output is separate from earlier tests.
"""
from pathlib import Path
root=Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21')
code=(root/'contact-cycle3/resolved.py').read_text()
code=code.replace('contact-cycle3','family-contact1')
code=code.replace("o.name.startswith('Paver ')","o.name in {'Family A','Family B','Family C'}")
code=code.replace("if o.name.startswith(('Recessed earth bed', 'Fine loose mineral aggregate')):","if o.type=='MESH' and o not in stones:")
pos=code.index('def soil_height(p):')
code=code[:pos]+'''# Nearest real sidewall samples locate packed soil at the stone/earth interface.
from mathutils.kdtree import KDTree
bpy.context.view_layer.update()
edge_points=[]
for stone in stones:
    coords=np.empty(len(stone.data.vertices)*3); normals=np.empty_like(coords)
    stone.data.vertices.foreach_get('co',coords); stone.data.vertices.foreach_get('normal',normals)
    coords=coords.reshape(-1,3); normals=normals.reshape(-1,3)
    mask=(coords[:,2]>.054)&(coords[:,2]<.076)&(np.abs(normals[:,2])<.7)
    for p in coords[mask][::4]:
        w=stone.matrix_world@Vector(p); edge_points.append((w.x,w.y,0))
edge_tree=KDTree(len(edge_points))
for i,p in enumerate(edge_points): edge_tree.insert(p,i)
edge_tree.balance()
def edge_distance(p):
    return np.array([edge_tree.find(Vector((x,y,0)))[2] for x,y in p])

'''+code[pos:]
code=code.replace('return .068 + .005*(field(p,29,51)-.5)',
'return .068 + .005*np.exp(-edge_distance(p)/.010)*(.55+.45*field(p,45,121)) + .005*(field(p,29,51)-.5)')
code=code.replace('range(65000)','range(115000)')
code=code.replace('if rng.random() > .18+.82*density**1.3: continue',
'edge_d=float(edge_distance(np.array([[x,y]]))[0])\n    chance=.09+.41*density**1.3+(.50 if edge_d<.018 else 0)\n    if rng.random() > chance: continue')
code=code.replace("radius=float(rng.choice([.0013,.0022,.0035,.006],p=[.51,.36,.12,.01])*rng.uniform(.65,1.3))",
"radius=float(rng.choice([.0013,.0022,.0035,.006],p=[.51,.36,.12,.01])*rng.uniform(.65,1.3))\n    if edge_d<.018: radius*=.8")
code=code.replace("'baseline':'surface-study-2026-09-21/assembly-cycle11/source.blend'", "'baseline':'family source plus contact3 recipe'")
code=code.replace("'stoneChanges':'none; independent soil test'", "'stoneChanges':'screened family; contact-only integration'")
out=root/'family-contact1';out.mkdir(exist_ok=True)
(out/'resolved.py').write_text(code)
exec(compile(code,str(out/'resolved.py'),'exec'))
