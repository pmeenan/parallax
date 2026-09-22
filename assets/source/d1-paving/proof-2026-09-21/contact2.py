"""Second bounded contact candidate: dense embedded fines and irregular matrix.

Execute against a fresh isolated copy of assembly-cycle11/source.blend.
"""
from pathlib import Path
root=Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21')
code=(root/'contact.py').read_text()
code=code.replace('contact-cycle1','contact-cycle2').replace('contact study 2026-09-21 cycle1','contact study 2026-09-21 cycle2')
code=code.replace("return .064 + .003*(field(p,29,51)-.5) + .0015*(field(p,150,62)-.5) + .0008*(field(p,430,77)-.5)",
"return .068 + .005*(field(p,29,51)-.5) + .003*(field(p,150,62)-.5) + .0014*(field(p,430,77)-.5)")
code=code.replace('np.linspace(-1.05,1.05,601)','np.linspace(-.82,.82,801)')
code=code.replace("(.035,.019,.008,1)","(.018,.009,.0035,1)").replace("(.115,.075,.034,1)","(.065,.035,.012,1)")
code=code.replace("default_value=.0008", "default_value=.002").replace("default_value=.55", "default_value=.8")
start=code.index('template=np.array('); end=code.index('for i in range(26000):',start)
code=code[:start]+'''# Native low subdivision icosphere template: irregular rounded grains, not diamonds.
import bmesh
bm=bmesh.new(); bmesh.ops.create_icosphere(bm,subdivisions=1,radius=1)
bm.verts.ensure_lookup_table(); bm.verts.index_update()
template=np.array([v.co[:] for v in bm.verts])
triangles=[tuple(v.index for v in f.verts) for f in bm.faces]; bm.free()
for i in range(115000):
'''+code[end+len('for i in range(26000):\n'):]
code=code.replace("[.001,.0018,.0034,.0055],p=[.40,.36,.20,.04]", "[.0014,.0026,.0045,.007],p=[.40,.38,.19,.03]")
code=code.replace("rng.uniform(.75,1.2,(7,3))", "rng.uniform(.88,1.12,template.shape)")
code=code.replace("rng.uniform(.4,.9)", "rng.uniform(.5,.8)")
code=code.replace('z-radius*.15','z-radius*.20')
code=code.replace("(.10,.060,.026),(.15,.105,.052),(.21,.17,.11),(.082,.073,.057),(.29,.25,.18)",
"(.045,.024,.010),(.075,.045,.020),(.13,.10,.060),(.050,.044,.032),(.19,.15,.095)")
code=code.replace('for poly,index in zip(grit.data.polygons,shades): poly.material_index=index',
'for poly,index in zip(grit.data.polygons,shades):\n    poly.material_index=index; poly.use_smooth=True')
code=code.replace("'soilNominalHeightM':.064", "'soilNominalHeightM':.068")
out=root/'contact-cycle2';out.mkdir(exist_ok=True)
(out/'resolved.py').write_text(code)
exec(compile(code,str(out/'resolved.py'),'exec'))
