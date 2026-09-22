"""Cycle11 continuation, isolated Blender5.2.1. Never runs original outputs.

Uses retained source construction with explicit, asserted substitutions. No new image
generation. Grain attenuation affects relief and shading jointly. Palette is authored
reflectance; photographic albedo is deliberately disconnected, not color-only baked.
"""
from pathlib import Path
import hashlib, json, time
ROOT=Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21/stone')
BASE=ROOT.parents[1]/'surface-study-2026-09-21'
original=(BASE/'build.py').read_text()
source=original
def replace(old,new):
    global source
    assert old in source, old
    source=source.replace(old,new)
replace("OUT = ROOT / f'cycle{CYCLE}'", "OUT = Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21/stone/candidate1')")
replace("CYCLE = int(globals().get('STUDY_CYCLE', 11))", "CYCLE = 101")
replace("scene=bpy.data.scenes.new(f'Complete limestone study cycle{CYCLE}')", "scene=bpy.data.scenes.new('Paving proof stone candidate1')")
replace("stone=make_stone('Surface study master')", "stone=make_stone('Paving proof stone candidate1 master')")
replace("for _ in range(20):", "for _ in range(160):")
replace("relief=(np.minimum(scalar,.61)-.57)*.0045+(broad-.5)*.0012", "wear=1-smoothstep(.60,.69,macro_scalar)\n    relief=(np.minimum(macro_scalar,.61)-.57)*.0045+(np.minimum(scalar,.61)-np.minimum(macro_scalar,.61))*.0045*(1-.72*wear)+(broad-.5)*.0012")
start=source.index("    albedo=n.new('ShaderNodeTexImage')")
end=source.index("    return mat",start)
source=source[:start]+'''    # The reference mineral boundaries remain, but brightness is not photographic.
    # No albedo image or pore-scale scalar connects to Base Color.
    col=ramp(n,l,macro_tex.outputs['Color'],'Authored mineral reflectance, no pore light',[
        (.25,(.14,.127,.108)),(.43,(.12,.119,.108)),(.60,(.135,.13,.117)),
        (.665,(.215,.196,.163)),(.735,(.34,.30,.235)),(.87,(.36,.315,.25))])
    l.new(col,bs.inputs['Base Color'])
    rough=n.new('ShaderNodeMapRange');rough.inputs['From Min'].default_value=.5;rough.inputs['From Max'].default_value=.75
    rough.inputs['To Min'].default_value=.67;rough.inputs['To Max'].default_value=.86
    l.new(macro_tex.outputs['Color'],rough.inputs['Value']);l.new(rough.outputs[0],bs.inputs['Roughness'])
    strength=n.new('ShaderNodeMapRange');strength.inputs['From Min'].default_value=.60;strength.inputs['From Max'].default_value=.70
    strength.inputs['To Min'].default_value=.10;strength.inputs['To Max'].default_value=.32
    l.new(macro_tex.outputs['Color'],strength.inputs['Value'])
    bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00010
    l.new(strength.outputs[0],bump.inputs['Strength'])
    l.new(height_tex.outputs['Color'],bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal'])
'''+source[end:]
replace("(OUT/'build.py').write_text((ROOT/'build.py').read_text())", "(OUT/'resolved_build.py').write_text(SOURCE_TEXT)")
namespace={'SOURCE_TEXT':source}
t=time.perf_counter()
exec(compile(source,str(ROOT/'candidate1/resolved_build.py'),'exec'),namespace)
capture=(BASE/'capture.py').read_text()
capture=capture.replace("CYCLE=int(globals().get('STUDY_CYCLE',11))",'CYCLE=101')
capture=capture.replace("OUT=ROOT/f'cycle{CYCLE}'","OUT=Path('D:/src/parallax/assets/source/d1-paving/proof-2026-09-21/stone/candidate1')")
capture=capture.replace("scene=bpy.data.scenes[f'Complete limestone study cycle{CYCLE}']","scene=bpy.data.scenes['Paving proof stone candidate1']")
capture=capture.replace("o.name.startswith('Surface study master')","o.name.startswith('Paving proof stone candidate1 master')")
(ROOT/'candidate1/resolved_capture.py').write_text(capture)
exec(compile(capture,str(ROOT/'candidate1/resolved_capture.py'),'exec'),namespace)
import bpy
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'candidate1/source.blend'),compress=True)
capture_receipt=json.loads((ROOT/'candidate1/captures.json').read_text())
capture_receipt['files']=[{'name':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in sorted((ROOT/'candidate1').iterdir()) if f.suffix in {'.png','.blend'}]
(ROOT/'candidate1/captures.json').write_text(json.dumps(capture_receipt,indent=2)+'\n')
paths=[BASE/'build.py',BASE/'cycle11/source.blend',BASE/'inputs/limestone-height-v1.png',BASE/'provenance.json',ROOT/'build_candidate.py',ROOT/'candidate1/resolved_build.py',ROOT/'candidate1/resolved_capture.py',Path('D:/src/parallax/assets/reference/concepts/batch-104/kit-002-stone-family-v4.png'),Path('D:/src/parallax/assets/reference/concepts/batch-108/mat-001-cream-limestone-v1.png')]
receipt={'author':'Codex paver_refinement agent; exact model not independently verified','tool':bpy.app.version_string,'seconds':time.perf_counter()-t,'scene':namespace['scene'].name,'object':namespace['stone'].name,'material':namespace['stone'].data.materials[0].name,'changes':['Remove generated photographic albedo from reflectance','Low-pass broad mineral classification; authored gray/cream palette','Attenuate fine geometric relief by72percent on worn plateaus; retain low broad relief','Reduce and regionally control bump'], 'limitations':['Synthetic scalar input is artist interpreted, not calibrated height','Reflectance classification can retain large source-region structure; visual screen required','No portable export or library QA yet'], 'rightsReviewedForShipping':False,'baselineProvenance':str(BASE/'provenance.json'),'inputs':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in paths]}
(ROOT/'candidate1/provenance.json').write_text(json.dumps(receipt,indent=2)+'\n')
