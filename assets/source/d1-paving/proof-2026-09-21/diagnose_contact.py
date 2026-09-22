"""Matched geometry diagnostics, without modifying retained source or art materials."""
import bpy,json
from pathlib import Path
out=Path(__file__).parent/'profile-contact2'
scene=bpy.context.scene
metadata={'cameraDepthOfField':scene.camera.data.dof.use_dof,
          'cameraFocusDistanceM':scene.camera.data.dof.focus_distance,
          'source':bpy.data.filepath,'diagnostics':'same stored joint-detail camera and light'}
gray=bpy.data.materials.new('Diagnostic neutral clay'); gray.use_nodes=True
bs=gray.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.4,.4,.4,1);bs.inputs['Roughness'].default_value=.85
scene.view_layers[0].material_override=gray
scene.render.filepath=str(out/'diagnostic-gray.png');bpy.ops.render.render(write_still=True)
scene.view_layers[0].material_override=None
def flat(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes;n.clear();e=n.new('ShaderNodeEmission');e.inputs[0].default_value=(*color,1)
    o=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],o.inputs['Surface']);return m
stone=flat('Diagnostic stone',(.65,.65,.65));soil=flat('Diagnostic soil',(.12,.04,.009))
collar=flat('Diagnostic collar',(.03,.4,.03));grit=flat('Diagnostic grit',(.4,.08,.02))
for o in scene.objects:
    if o.type!='MESH':continue
    m=stone if o.name.startswith('Family ') else collar if o.name=='Profile fitted packed earth' else grit if o.name=='Embedded mixed aggregate' else soil
    o.data=o.data.copy();o.data.materials.clear();o.data.materials.append(m)
    for p in o.data.polygons:p.material_index=0
scene.render.filepath=str(out/'diagnostic-regions.png');bpy.ops.render.render(write_still=True)
(out/'diagnostic.json').write_text(json.dumps(metadata,indent=2)+'\n')
