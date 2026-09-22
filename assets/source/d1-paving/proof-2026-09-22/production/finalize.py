"""Bind retained reduction evidence after checking its declared file identities."""
from pathlib import Path
import hashlib, json, subprocess

ROOT=Path(__file__).parent
REPO=ROOT.parents[4]
NODE=Path('C:/Users/patme/.cache/parallax-node-v24.18.1/node-v24.18.1-win-x64/node.exe')
BIOME=REPO/'node_modules/@biomejs/biome/bin/biome'

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def identity(p):return {'path':p.relative_to(REPO).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)}

for path in ROOT.rglob('receipt.json'):
    data=json.loads(path.read_text())
    for entry in data.get('files',[]):
        file=Path(entry['path']) if 'path' in entry else path.parent/entry['name']
        assert file.stat().st_size==entry['bytes'] and digest(file)==entry['sha256'], str(file)
for path in ROOT.rglob('*.py'):compile(path.read_bytes(),str(path),'exec')

source=ROOT.parent/'cobble-study/candidate1/source.blend'
chosen=ROOT/'candidate3/source.blend'
assert digest(source)=='c5778d6d17cede747e546d6b4792d7db73f01e31b59bb399e69441b297feea20'
assert digest(chosen)=='61a22f7efdb3ef0f665cfbb7983e15674561034acf91c487b0dc6bcb068dd421'
verification=json.loads((ROOT/'candidate3/native-verification.json').read_text())
assert verification['candidateSha256']==digest(chosen)
assert verification['stonesAndTransformsExact'] and verification['activeMaterialsAndPackedPixelsExact']
assert verification['retainedGritComponents']==2311
assert verification['gritPreservation']['processedSourcePieces']==2500
assert verification['gritPreservation']['fullyBuriedPiecesRemoved']==189
assert verification['mossMinimumLeafClearanceM']>0
for path in (ROOT/'candidate3/transfer').rglob('representative.glb'):
    raw=path.read_bytes();assert raw[:4]==b'glTF' and int.from_bytes(raw[8:12],'little')==len(raw)
    gltf=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')]);assert gltf['asset']['version']=='2.0'
    report=json.loads((path.parent/'receipt.json').read_text());assert report['sha256']==digest(path)

provenance={'schemaVersion':1,'status':'retained-native-reduction-not-admitted',
    'generatingAgent':'OpenAI Codex','tool':'Blender 5.2.1 LTS 9e2066aef7ef',
    'source':identity(source),'candidate':identity(chosen),
    'humanApprovedSource':'proof-2026-09-22/cobble-results.md approval dated 2026-09-22',
    'newHumanApproval':False,'runtimeQA':False,'libraryAdmission':False,
    'references':['KIT-001 batch103 with human smaller-stone direction','KIT-002 batch104','MAT-001/MAT-018 batch108','VEG-001 batch116'],
    'lineage':[identity(p) for p in [ROOT.parent/'cobble-study/provenance.json',
        ROOT.parent/'cobble-study/candidate1/receipt.json',
        ROOT.parent.parent/'surface-study-2026-09-21/provenance.json']],
    'generation':'Existing authored geometry and previously generated limestone surfaces reused; no new image generation or paid provider job',
    'rightsReview':{'scope':'public-build','status':'pending','note':'Source visual approval does not clear inherited reference/input/output rights'},
    'policy':'assets/qa/d1-stone-variants.json unchanged; ground/vegetation/material conformance remains unmet',
    'builders':[identity(ROOT/name) for name in ['build.py','verify.py','transfer.py','finalize.py']]}
(ROOT/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
subprocess.run([str(NODE),str(BIOME),'format','--write',str(ROOT)],cwd=REPO,check=True)
files=[identity(p) for p in sorted(ROOT.rglob('*')) if p.is_file() and p.name!='file-inventory.json']
report={'schemaVersion':1,'root':ROOT.relative_to(REPO).as_posix(),'files':files,
    'verification':'Declared candidate/transfer file hashes, original source hash, reopened-source receipt and GLB containers checked; Python sources compile',
    'limits':'Inventory integrity is not production asset QA or runtime acceptance'}
(ROOT/'file-inventory.json').write_text(json.dumps(report,indent=2)+'\n')
subprocess.run([str(NODE),str(BIOME),'format','--write',str(ROOT/'file-inventory.json')],cwd=REPO,check=True)
for entry in files:
    p=REPO/entry['path'];assert p.stat().st_size==entry['bytes'] and digest(p)==entry['sha256']
print('FINALIZED',len(files),'files; native and transfer identities verified')
