"""One representative broad-source transfer; standard glTF, not admission."""
from pathlib import Path
import bpy
import json
import hashlib

folder = Path(__file__).parent
proof = folder.parent
recipe = proof/'transfer/build.py'
code = recipe.read_text()
code = code.replace('OUT=Path(__file__).parent', "OUT=Path(__file__).parent/'transfer';OUT.mkdir(exist_ok=True)")
code = code.replace("BASE=OUT.parent/'restored-family/source.blend'", "BASE=OUT.parent/'candidate2/source.blend'")
code = code.replace("BASELINE=OUT.parents[1]/'surface-study-2026-09-21'", "BASELINE=OUT.parents[2]/'surface-study-2026-09-21'")
code = code.replace("enumerate('ABC')", "enumerate('A')")
code = code.replace("'Family '+label", "'Broad source '+label")
code = code.replace("Family {label}", "Broad source {label}")
code = code.replace("'Restored '+label", "'Broad '+label")
code = code.replace("Vector((.52,-.68,.67))", "Vector((1.25,-1.60,1.45))")
code = code.replace("Vector((-.7,-.8,1))", "Vector((-3,-4,6))")
code = code.replace("Vector((.7,.8,1))", "Vector((3,4,6))")
code = code.replace('light.data.energy=190;light.data.size=.65', 'light.data.energy=2200;light.data.size=1')
code = code.replace('cycle=301+index', 'cycle=401+index')
code = code.replace("'source':'../../restored-family/source.blend'", "'source':'../../candidate2/source.blend'")
# Name the exact evolving scripts and class limitations in a separate report;
# retained earlier bake/verify recipes remain read-only.
assert 'assert hashlib.sha256(BASE.read_bytes()).hexdigest()==source_hash' in code
compile(code, str(folder/'transfer-resolved.py'), 'exec')
(folder/'transfer-resolved.py').write_text(code)
exec(compile(code, str(folder/'transfer-resolved.py'), 'exec'), {'__file__': __file__})
result_path = folder/'transfer/results.json'
report = json.loads(result_path.read_text())
report['productionClassLimits'] = {
    'class': 'individual-stone-variants',
    'path': 'assets/qa/d1-stone-variants.json',
    'sourceDimensionsExceedCurrentWidthBounds': True,
    'fullAdmissionRun': False,
    'explanation': 'The representative broad slab exceeds current 0.8 m class width. This focused export changes no admission rule.',
}
report['scripts'] = [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                     for p in [Path(__file__), folder/'transfer-resolved.py', recipe]]
result_path.write_text(json.dumps(report, indent=2)+'\n')
