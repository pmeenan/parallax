"""Second bounded contact candidate: derive top cap farther inside the worn bevel."""
from pathlib import Path
root=Path(__file__).parent
code=(root/'profile-contact1/resolved.py').read_text()
assert 'probe=point-outward*.002' in code
code=code.replace('profile-contact1','profile-contact2')
code=code.replace('Paving profile fitted contact1','Paving profile fitted contact2')
code=code.replace('probe=point-outward*.002','probe=point-outward*.012')
code=code.replace("'profileSamples':len(collar_samples)", "'inwardTopProbeM':.012,'profileSamples':len(collar_samples)")
out=root/'profile-contact2';out.mkdir(exist_ok=True)
(out/'resolved.py').write_text(code)
exec(compile(code,str(out/'resolved.py'),'exec'))
