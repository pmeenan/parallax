"""Read-only focused mesh comparison against baseline; no render or scene edits."""
import bpy,numpy as np,json,hashlib
from pathlib import Path
ROOT=Path(__file__).parent
BASE=ROOT.parents[1]/'proof-2026-09-21/family-contact2/source.blend'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source.blend'))
current={name:bpy.data.objects[name] for name in ['Family A','Family B','Family C']}
with bpy.data.libraries.load(str(BASE),link=False) as (src,dst):dst.objects=list(current)
def co(ob):
    p=np.empty(len(ob.data.vertices)*3,dtype=np.float64);ob.data.vertices.foreach_get('co',p);return p.reshape(-1,3)
results=[]
for prior in dst.objects:
    name=prior.name.split('.')[0];ob=current[name];a,b=co(prior),co(ob)
    assert a.shape==b.shape
    prior.data.calc_loop_triangles();tri=np.empty(len(prior.data.loop_triangles)*3,dtype=np.int32);prior.data.loop_triangles.foreach_get('vertices',tri);tri=tri.reshape(-1,3)
    edited=np.any(np.linalg.norm((b-a)[tri],axis=2)>1e-8,axis=1)
    ids=np.flatnonzero(edited);sample=ids[np.linspace(0,len(ids)-1,min(len(ids),20000)).astype(int)]
    t=tri[sample]
    na=np.cross(a[t[:,1]]-a[t[:,0]],a[t[:,2]]-a[t[:,0]])
    nb=np.cross(b[t[:,1]]-b[t[:,0]],b[t[:,2]]-b[t[:,0]])
    la=np.linalg.norm(na,axis=1);lb=np.linalg.norm(nb,axis=1)
    valid=(la>1e-14)&(lb>1e-14);cos=np.sum(na*nb,axis=1)[valid]/(la[valid]*lb[valid])
    results.append({'object':name,'allCoordinatesFinite':bool(np.isfinite(b).all()),'boundsLocalM':[b.min(axis=0).tolist(),b.max(axis=0).tolist()],'topologyVertexAndFaceCountsUnchanged':len(prior.data.vertices)==len(ob.data.vertices) and len(prior.data.polygons)==len(ob.data.polygons),'editedTriangles':len(ids),'sampledEditedTriangles':len(sample),'sampleNormalFlips':int(np.count_nonzero(cos<=0)),'minimumSampleNormalCosine':float(cos.min()),'sampleBaselineDegenerates':int(np.count_nonzero(la<=1e-14)),'sampleCandidateDegenerates':int(np.count_nonzero(lb<=1e-14))})
report={'scope':'Full finite-coordinate check and deterministic maximum20000 edited baseline triangles per stone; degeneracy threshold cross-product norm1e-14m2. Not a full self-intersection test.','sourceSha256':hashlib.sha256((ROOT/'source.blend').read_bytes()).hexdigest(),'objects':results}
(ROOT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
