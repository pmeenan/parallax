"""Bind retained source evidence and format only this work package's JSON."""
import json, hashlib, subprocess
from pathlib import Path

ROOT=Path(__file__).parent
REPO=ROOT.parents[4]
registry=json.loads((REPO/'.parallax-toolchain.local.json').read_text())
node=next(t['path'] for t in registry['tools'] if t['id']=='node')
biome=REPO/'node_modules/@biomejs/biome/bin/biome'
def read(p):return json.loads(p.read_text())
def write(p,data):
    result=subprocess.run([node,str(biome),'format','--stdin-file-path',str(p)],
        input=json.dumps(data,indent=2)+'\n',text=True,capture_output=True,check=True,cwd=REPO)
    p.write_bytes(result.stdout.encode())
def identity(p):return {'path':p.as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def check(row):
    actual=identity(Path(row['path']))
    assert actual['sha256']==row['sha256'],row['path']
    if 'bytes' in row:assert actual['bytes']==row['bytes'],row['path']

folder=ROOT/'candidate1'
receipt=read(folder/'receipt.json')
# Preserve the exact consumed layout bytes before formatting its public JSON.
# The native receipt's digest must match this byte-exact retained input.
for row in receipt['inputs']:
    if Path(row['path']).name=='layout.json':
        snapshot=folder/'consumed-layout.txt'
        assert not snapshot.exists()
        check(row);snapshot.write_bytes(Path(row['path']).read_bytes())
        row['path']=snapshot.as_posix();check(row)
receipt['layoutInputRetention']='consumed-layout.txt retains exact layout bytes; formatted layout.json is semantically identical.'
snapshot=folder/'build-snapshot.py'
assert not snapshot.exists()
check(receipt['buildScript']);snapshot.write_bytes(Path(receipt['buildScript']['path']).read_bytes())
receipt['buildScript']['path']=snapshot.as_posix();check(receipt['buildScript'])
receipt['outputs'].append(identity(snapshot))
for row in receipt['inputs']+receipt['outputs']:check(row)
write(folder/'receipt.json',receipt)
for path in sorted(ROOT.rglob('*.json')):
    if path.name not in {'file-inventory.json','provenance.json'}:write(path,read(path))
assert read(ROOT/'layout.json')==read(folder/'consumed-layout.txt')
transfer=read(folder/'transfer/receipt.json')
for row in transfer['files']:
    check({'path':str(folder/'transfer'/row['name']),'bytes':row['bytes'],'sha256':row['sha256']})
glb=folder/'transfer/representative-moss.glb';raw=glb.read_bytes()
assert raw[:4]==b'glTF' and int.from_bytes(raw[4:8],'little')==2 and int.from_bytes(raw[8:12],'little')==len(raw)
g=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')])
assert len(g['meshes'])==1 and len(g['materials'])==1
assert all('COLOR_0' in p['attributes'] for m in g['meshes'] for p in m['primitives'])
provenance={'agent':'Codex','model':'Exact runtime model identifier unavailable',
    'humanDirection':'Earlier smaller slabs looked better, more like cobblestone; proceed with arrangement and variation while retaining approved contact, lighting, leaves and moss.',
    'generation':'Original deterministic local layout and placement, existing authored Blender meshes/materials; no new generated images, external inputs, provider calls or paid jobs.',
    'blender':{'version':'5.2.1 LTS','build':'9e2066aef7ef'},
    'referenceIds':['KIT-001 batch103, size superseded by current human direction','KIT-002 batch104','MAT-001/MAT-018 batch108','VEG-001 batch116'],
    'retainedRightsLineage':'../../surface-study-2026-09-21/provenance.json and existing referenced source packages retain image prompts, model/rights notes; no new rights approval is implied.',
    'rightsReviewed':False,'assetAdmission':False,'artisticAcceptance':False,
    'sources':receipt['inputs'],'layoutSeed':922931,'vegetationPlacementSeed':922932,
    'changes':'Local whole-stone retiling; rigid plant relocation; rigid per-shoot moss fitting with preserved shapes/topology/colors/material maps.'}
write(ROOT/'provenance.json',provenance)
allowed={'.py','.json','.txt','.blend','.png','.glb','.md'}
files=[identity(p) for p in sorted(ROOT.rglob('*')) if p.is_file() and p.suffix in allowed and p.name!='file-inventory.json']
write(ROOT/'file-inventory.json',{'scope':'Source appearance proof; full QA/admission/rights/runtime acceptance incomplete','files':files})
for row in read(ROOT/'file-inventory.json')['files']:check(row)
print(json.dumps({'inventoryFiles':len(files),'allMatched':True,'sourceInputsVerified':len(receipt['inputs']),'mossGlbColor0Verified':True}))
