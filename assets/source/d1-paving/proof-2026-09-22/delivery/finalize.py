"""Bind measured evidence without admitting a failed visual candidate."""
import bpy, json, hashlib, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent; REPO=ROOT.parents[4]
NODE=Path('C:/Users/patme/.cache/parallax-node-v24.18.1/node-v24.18.1-win-x64/node.exe')
BIOME=REPO/'node_modules/@biomejs/biome/bin/biome'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def identity(p):return {'path':p.relative_to(REPO).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)}
source=ROOT.parent/'production/candidate3/source.blend'
assert digest(source)=='61a22f7efdb3ef0f665cfbb7983e15674561034acf91c487b0dc6bcb068dd421'
def geometry(path):
    bpy.ops.wm.open_mainfile(filepath=str(path)); result={}
    for ob in bpy.context.scene.objects:
        if ob.type!='MESH' or ob.get('excludeFromRuntime'):continue
        m=ob.data
        result[ob.name]=hashlib.sha256(repr(([list(row) for row in ob.matrix_world],
            [tuple(v.co) for v in m.vertices],[tuple(p.vertices) for p in m.polygons],
            [tuple(n.vector) for n in m.corner_normals])).encode()).hexdigest()
    return result
baseline=geometry(source);shared=geometry(ROOT/'candidate2-corrected/shared.blend')
assert baseline==shared,'LOD0 source positions, polygons, transforms and corner normals must be exact'
for candidate in ['candidate1','candidate2-corrected']:
    folder=ROOT/candidate;receipt=json.loads((folder/'receipt.json').read_text())
    for lod in receipt['lods']:
        p=folder/f"lod{lod['lod']}.glb";assert p.stat().st_size==lod['bytes'] and digest(p)==lod['sha256']
for p in ROOT.rglob('*.py'):compile(p.read_bytes(),str(p),'exec')
ktx=json.loads((ROOT/'candidate2-corrected/ktx-receipt.json').read_text())
for row in ktx['maps']:
    path=REPO/'harness/results/paving-delivery-ktx-20260923'/(row['name']+'.ktx2')
    assert digest(path)==row['sha256'] and path.stat().st_size==row['bytes']
provenance={'status':'failed-soil-fidelity-source-proof-only','generatingAgent':'OpenAI Codex',
    'source':identity(source),'candidate':identity(ROOT/'candidate2-corrected/shared.blend'),
    'sourceGeometryTransformsCornerNormalsExact':True,'objectCount':len(baseline),
    'originalSourceSignatures':baseline,'blender':bpy.app.version_string,
    'rightsReview':'pending; inherited references and image-generation provenance unchanged',
    'lineage':identity(ROOT.parent/'production/provenance.json'),
    'newGeneration':'none; local Blender material consolidation and LOD export only',
    'references':['KIT-001/002/003','MAT-001/018','VEG-001','LIGHT-001/002'],
    'humanApproval':False,'libraryAdmission':False,'runtimeQA':False}
(ROOT/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
subprocess.run([str(NODE),str(BIOME),'format','--write',str(ROOT)],cwd=REPO,check=True)
files=[identity(p) for p in sorted(ROOT.rglob('*')) if p.is_file() and p.name!='file-inventory.json']
(ROOT/'file-inventory.json').write_text(json.dumps({'files':files,'scope':'integrity only, not artistic/QA/runtime acceptance'},indent=2)+'\n')
subprocess.run([str(NODE),str(BIOME),'format','--write',str(ROOT/'file-inventory.json')],cwd=REPO,check=True)
for row in files:
    p=REPO/row['path'];assert p.stat().st_size==row['bytes'] and digest(p)==row['sha256']
print('VERIFIED',len(files),'files;',len(baseline),'exact near-detail objects')
