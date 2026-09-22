"""Restore cycle11 material identity on existing family/contact geometry.
One candidate, isolated background Blender5.2.1. Original sources are read-only.
"""
from pathlib import Path
from datetime import datetime,timezone
import bpy,numpy as np,json,hashlib,time,ast
from mathutils import Vector
ROOT=Path(__file__).parents[2]
OUT=Path(__file__).parent
PREV=ROOT/'proof-2026-09-21'
BASE=PREV/'family-contact2'
ORIGINAL=ROOT/'surface-study-2026-09-21/cycle11/source.blend'
START=time.perf_counter()
assert bpy.app.version[:3]==(5,2,1)
bpy.ops.wm.open_mainfile(filepath=str(BASE/'source.blend'))
scene=bpy.context.scene;scene.name='Restored cycle11 material family'
def mesh_identity(o):
    co=np.empty(len(o.data.vertices)*3,dtype=np.float32);o.data.vertices.foreach_get('co',co)
    vi=np.empty(len(o.data.loops),dtype=np.int32);o.data.loops.foreach_get('vertex_index',vi)
    return {'coordinatesSha256':hashlib.sha256(co.tobytes()).hexdigest(),'loopVertexSha256':hashlib.sha256(vi.tobytes()).hexdigest(),'vertices':len(o.data.vertices),'polygons':len(o.data.polygons),'matrixWorld':[list(row) for row in o.matrix_world]}
before={o.name:mesh_identity(o) for o in scene.objects if o.type=='MESH'}
old_materials={label:scene.objects['Family '+label].data.materials[0] for label in 'ABC'}
with bpy.data.libraries.load(str(ORIGINAL),link=False) as (src,dst):
    names=[n for n in src.materials if n.startswith('Original limestone correlated surface cycle11')]
    assert len(names)==1,names
    dst.materials=names
template=dst.materials[0]
original_images=[n for n in template.node_tree.nodes if n.type=='TEX_IMAGE']
height_node=next(n for n in original_images if 'limestone-height-v1' in n.image.name)
macro_node=next(n for n in original_images if 'Authored mineral plateau field' in n.image.name)
color_node=next(n for n in original_images if 'limestone-albedo-v1' in n.image.name)
assert len(original_images)==3
# Execute only the exact three helper functions from the screened family2 recipe.
recipe=PREV/'family/build_family2.py'
recipe_text=recipe.read_text();tree=ast.parse(recipe_text)
functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'pixels','remap','packed'}]
assert len(functions)==3
exec(compile(ast.Module(body=functions,type_ignores=[]),str(recipe),'exec'),globals())
raw=color_node.image
assert raw.colorspace_settings.name=='sRGB',raw.colorspace_settings.name
# Empirical Blender5.2.1 known128byte PNG reports0.5019608 from .pixels,
# not linear0.2158605. Decode byte sRGB explicitly before interpolation.
# packed() stores the resulting linear samples as float Non-Color.
raw_pixels=pixels(raw)
assert raw.has_data and np.isfinite(raw_pixels).all() and raw_pixels[:,:,:3].max()>.1
assert not raw.is_float,'Byte sRGB decoding assumption must be rechecked for float source'
rgb=raw_pixels[:,:,:3]
raw_pixels[:,:,:3]=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
roles=[]
scene.objects['Family A'].data.materials[0]=template
for label,seed in [('B',787),('C',829)]:
    old_nodes=[n for n in old_materials[label].node_tree.nodes if n.type=='TEX_IMAGE']
    relief=next(n.image for n in old_nodes if f'Family {label} nonlinear relief' in n.image.name)
    mineral=next(n.image for n in old_nodes if f'Family {label} nonlinear mineral regions' in n.image.name)
    generated=packed(f'Family {label} original cycle11 albedo remap linear',remap(raw_pixels,seed))
    restored=template.copy();restored.name=f'Family {label} restored original cycle11 material'
    restored.node_tree.nodes[height_node.name].image=relief
    restored.node_tree.nodes[macro_node.name].image=mineral
    restored.node_tree.nodes[color_node.name].image=generated
    scene.objects['Family '+label].data.materials[0]=restored
    roles.append({'object':'Family '+label,'seed':seed,'height':relief.name,'macro':mineral.name,'albedo':generated.name,'albedoLinearPixelsSha256':hashlib.sha256(pixels(generated).tobytes()).hexdigest(),'colorSpace':generated.colorspace_settings.name})
after={o.name:mesh_identity(o) for o in scene.objects if o.type=='MESH'}
assert before==after,'Geometry/transforms changed during material restoration'
for im in bpy.data.images:
    if im.source=='FILE' and im.has_data and not im.packed_file:im.pack()
camera=scene.camera;light=next(o for o in scene.objects if o.type=='LIGHT')
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
scene.cycles.device='GPU'
views=json.loads((BASE/'receipt.json').read_text())['views']
for name,eye,target,lens,key,energy,size,ambient in views:
    camera.location=eye;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=lens
    light.location=key;light.rotation_euler=(Vector(target)-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=energy;light.data.size=size
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=ambient
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
saved=[]
for label in 'ABC':
    ob=scene.objects['Family '+label];mat=ob.data.materials[0]
    diagnostic=mat.copy();diagnostic.name='Unlit restored family '+label
    nodes=diagnostic.node_tree.nodes;links=diagnostic.node_tree.links
    bs=nodes.get('Principled BSDF');em=nodes.new('ShaderNodeEmission')
    links.new(bs.inputs['Base Color'].links[0].from_socket,em.inputs['Color']);links.new(em.outputs[0],nodes.get('Material Output').inputs['Surface'])
    saved.append((ob,mat));ob.data.materials[0]=diagnostic
scene.render.filepath=str(OUT/'basecolor-unlit.png');bpy.ops.render.render(write_still=True)
for ob,mat in saved:ob.data.materials[0]=mat
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'),compress=True)
inputs=[BASE/'source.blend',ORIGINAL,recipe,Path(__file__),ROOT/'surface-study-2026-09-21/inputs/limestone-albedo-v1.png']
report={'createdUtc':datetime.now(timezone.utc).isoformat(),'seconds':time.perf_counter()-START,'tool':bpy.app.version_string,'author':'Codex paver_refinement agent','scene':scene.name,'materialRestoration':'A original cycle11 material unchanged; B/C copies with existing remapped height/macro and exact family2 remap of original raw albedo. No normalized chromatic modulation reused.','roles':roles,'geometryBefore':before,'geometryAfter':after,'geometryAndTransformsUnchanged':before==after,'views':views,'unlitDiagnostic':'joint-detail camera; only stone Base Color graphs temporarily routed to emission; reset before source save','inputs':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in inputs],'rightsReviewed':False,'sourceOnly':True,'artisticAcceptance':False,'limitations':['Original generated albedo retains embedded pore lighting','Source geometry not changed; exposed smooth sidewall band remains possible','No new library admission, game or performance evidence'],'files':[{'name':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(OUT.iterdir()) if p.suffix in {'.png','.blend'}]}
report['colorSpaceVerification']={'nativeFixture':'Known RGB128 byte PNG loaded as sRGB in isolated Blender5.2.1','pixelsObserved':0.501960813999176,'expectedEncoded':128/255,'expectedLinear':((128/255+.055)/1.055)**2.4,'appliedCorrection':'Explicit standard sRGB decode on RGB before exact remap; alpha unchanged; float Non-Color packed destination','earlyInvalidCaptureSet':'Overwritten after confirmed input encoding correction; not a separate artistic candidate'}
(OUT/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
