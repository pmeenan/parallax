"""Matched original-material control on A; no source geometry edits or acceptance."""
import bpy,json,hashlib
from pathlib import Path
from mathutils import Vector
root=Path(__file__).parent; previous=root.parent/'proof-2026-09-21'
out=root/'material-control';out.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(previous/'family-contact2/source.blend'))
scene=bpy.context.scene;scene.name='Matched material diagnosis A only'
original=root.parent/'surface-study-2026-09-21/cycle11/source.blend'
with bpy.data.libraries.load(str(original),link=False) as (src,dst):
    names=[n for n in src.materials if n.startswith('Original limestone correlated surface cycle11')]
    assert len(names)==1,names
    dst.materials=names
scene.objects['Family A'].data.materials[0]=dst.materials[0]
camera=scene.camera;light=next(o for o in scene.objects if o.type=='LIGHT')
views=json.loads((previous/'family-contact2/receipt.json').read_text())['views']
for name,eye,target,lens,key,energy,size,ambient in views:
    if name not in {'oblique','joint-detail','reverse-light'}:continue
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
    scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True)
for im in bpy.data.images:
    if im.source=='FILE' and im.has_data and not im.packed_file:im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'),compress=True)
(out/'receipt.json').write_text(json.dumps({'geometryAndPlacement':'unchanged family-contact2',
    'changedMaterial':'Family A only; original cycle11 material; B/C unchanged controls',
    'scope':'Matched diagnostic, not a new accepted candidate or clean albedo claim',
    'sourceMaterial':str(original),'sourceOnly':True,'rightsReviewed':False,
    'files':[{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.iterdir()) if p.suffix in {'.png','.blend'}]},indent=2)+'\n')
