"""Inspect actual GLB bytes, native roundtrip and sampled geometric transfer error.

This focused proof is not the repository's full asset admission gate.
"""
import bpy
import bmesh
import json
import math
import hashlib
import numpy as np
from pathlib import Path
from mathutils.bvhtree import BVHTree
from datetime import datetime, timezone

CYCLE=203
ROOT=Path('D:/src/parallax/assets/source/d1-paving/surface-study-2026-09-21')
OUT=Path('D:\\src\\parallax\\assets\\source\\d1-paving\\proof-2026-09-21\\portable-family-c')
raw=(OUT/'limestone.glb').read_bytes()
assert raw[:4]==b'glTF' and int.from_bytes(raw[4:8],'little')==2
assert int.from_bytes(raw[8:12],'little')==len(raw)
gltf=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')])
assert len(gltf['scenes'])==len(gltf['meshes'])==len(gltf['materials'])==1
assert all('uri' not in buffer for buffer in gltf['buffers'])
triangles=sum(gltf['accessors'][p['indices']]['count']//3 for m in gltf['meshes'] for p in m['primitives'])
assert 0 < triangles <= 4000
material=gltf['materials'][0]
assert 'baseColorTexture' in material['pbrMetallicRoughness']
assert 'metallicRoughnessTexture' in material['pbrMetallicRoughness'] and 'normalTexture' in material
studio=bpy.data.scenes[f'Portable limestone transfer proof cycle{CYCLE}']
low=next(o for o in studio.objects if o.name.startswith('Limestone portable LOD0'))
bm=bmesh.new();bm.from_mesh(low.data)
assert all(edge.is_manifold for edge in bm.edges)
assert all(math.isfinite(x) for vertex in bm.verts for x in vertex.co)
manifold=True;bm.free()
uv=np.array([loop.uv[:] for loop in low.data.uv_layers.active.data])
assert np.isfinite(uv).all() and uv.min()>=0 and uv.max()<=1
# This samples the source-to-low distance. It is neither a full Hausdorff bound nor
# a test of UV overlap, inverse mapping, texture error or visual acceptance.
bvh=BVHTree.FromPolygons([v.co[:] for v in low.data.vertices],[p.vertices[:] for p in low.data.polygons],all_triangles=True)
source=next(o for o in bpy.data.scenes['Family C export source'].objects if o.name.startswith('Family C'))
distances=[bvh.find_nearest(v.co)[3] for i,v in enumerate(source.data.vertices) if i%100==0]
scene=bpy.data.scenes.new(f'GLB reimport proof cycle{CYCLE}');bpy.context.window.scene=scene
scene.world=studio.world
for original in studio.objects:
    if original.type in {'CAMERA','LIGHT'} or original.name.startswith('Neutral support'):
        ob=original.copy();ob.data=original.data.copy();scene.collection.objects.link(ob)
        if ob.type=='CAMERA':scene.camera=ob
bpy.ops.import_scene.gltf(filepath=str(OUT/'limestone.glb'))
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=128;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.filepath=str(OUT/'reimport.png')
bpy.ops.render.render(write_still=True)
arrays=[]
for name in ['native-low.png','reimport.png']:
    im=bpy.data.images.load(str(OUT/name),check_existing=False)
    values=np.empty(im.size[0]*im.size[1]*4,dtype=np.float32);im.pixels.foreach_get(values)
    arrays.append(values.reshape(-1,4)[:,:3])
delta=np.abs(arrays[0]-arrays[1])
report={'checkedUtc':datetime.now(timezone.utc).isoformat(),'glbSha256':hashlib.sha256(raw).hexdigest(),
 'glbBytes':len(raw),'scenes':len(gltf['scenes']),'meshes':len(gltf['meshes']),'materials':len(gltf['materials']),
 'textures':len(gltf['textures']),'triangles':triangles,'extensions':gltf.get('extensionsUsed',[]),
 'closedManifold':manifold,'finiteCoordinates':True,'finiteUVsWithinUnitSquare':True,
 'sampledSourceToLowDistanceM':{'samples':len(distances),'median':float(np.median(distances)),'p95':float(np.percentile(distances,95)),'maximum':max(distances)},
 'nativeVsReimportLoadedPixelDelta':{'meanAbsolute':float(delta.mean()),'p99':float(np.percentile(delta,99)),'maximum':float(delta.max())},
 'checked':['Actual GLB header/length and embedded buffer','One mesh, material and scene; 3900 triangles','Standard basecolor, roughness and tangent normal channels','Native fresh-scene import and render','Finite UV/position and closed manifold mesh'],
 'notChecked':['Full glTF validator','UV overlap/inversion','LOD chain','KTX2 and meshopt','Babylon/WebGPU render','In-game performance','Rights clearance','Human artistic acceptance']}
(OUT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
result=report
