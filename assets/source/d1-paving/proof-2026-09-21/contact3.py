"""Final initial-package contact pass: compacted matrix with buried clustered grit."""
from pathlib import Path
root=Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21')
code=(root/'contact-cycle2/resolved.py').read_text()
code=code.replace('contact-cycle2','contact-cycle3').replace('contact study 2026-09-21 cycle2','contact study 2026-09-21 cycle3')
code=code.replace('subdivisions=1,radius=1','subdivisions=2,radius=1')
code=code.replace('range(115000)','range(65000)')
code=code.replace("if stone_at(x,y): continue", "if stone_at(x,y): continue\n    density=float(field(np.array([[x,y]]),18,904)[0])\n    if rng.random() > .18+.82*density**1.3: continue")
code=code.replace('[.0014,.0026,.0045,.007],p=[.40,.38,.19,.03]','[.0013,.0022,.0035,.006],p=[.51,.36,.12,.01]')
code=code.replace('rng.uniform(.88,1.12,template.shape)','rng.uniform(.75,1.25,template.shape)')
code=code.replace('z-radius*.20','z-radius*.45')
code=code.replace("grit.data.materials.append(m)","""nodes,links=m.node_tree.nodes,m.node_tree.links
    tc=nodes.new('ShaderNodeTexCoord'); micro=nodes.new('ShaderNodeTexNoise'); micro.inputs['Scale'].default_value=1600
    links.new(tc.outputs['Object'],micro.inputs['Vector'])
    rr=nodes.new('ShaderNodeValToRGB'); rr.color_ramp.elements[0].color=tuple(v*.55 for v in color)+(1,); rr.color_ramp.elements[1].color=tuple(v*1.3 for v in color)+(1,)
    links.new(micro.outputs['Fac'],rr.inputs[0]); links.new(rr.outputs[0],shader.inputs['Base Color'])
    bb=nodes.new('ShaderNodeBump'); bb.inputs['Distance'].default_value=.00018; bb.inputs['Strength'].default_value=.55
    links.new(micro.outputs['Fac'],bb.inputs['Height']); links.new(bb.outputs[0],shader.inputs['Normal'])
    grit.data.materials.append(m)""")
out=root/'contact-cycle3';out.mkdir(exist_ok=True)
(out/'resolved.py').write_text(code)
exec(compile(code,str(out/'resolved.py'),'exec'))
