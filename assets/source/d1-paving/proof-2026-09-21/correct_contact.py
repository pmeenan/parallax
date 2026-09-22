"""One bounded contact-height correction; load screened family/candidate2/source.blend."""
from pathlib import Path
root = Path(__file__).parent
code = (root/'family-contact1/resolved.py').read_text()
code = code.replace('family-contact1', 'family-contact2')
code = code.replace('return .068 + .005*np.exp', 'return .064 + .002*np.exp')
code = code.replace("'soilNominalHeightM':.068", "'soilNominalHeightM':.064")
code = code.replace("scene.name = 'Paving contact study 2026-09-21 cycle3'", "scene.name = 'Paving screened family contact2'")
out = root/'family-contact2'
out.mkdir(exist_ok=True)
(out/'resolved.py').write_text(code)
exec(compile(code,str(out/'resolved.py'),'exec'))
