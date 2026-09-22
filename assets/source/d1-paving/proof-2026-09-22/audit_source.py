"""Read-only source dependency audit; no asset or material is rewritten."""
import bpy,json
from pathlib import Path
out=Path(__file__).parent
scene=bpy.context.scene
images=[]
for ob in scene.objects:
    if not ob.name.startswith('Family '):continue
    for slot in ob.material_slots:
        for node in slot.material.node_tree.nodes:
            if node.type!='TEX_IMAGE' or not node.image:continue
            im=node.image
            images.append({'object':ob.name,'node':node.name,'image':im.name,
                           'source':im.source,'size':list(im.size),'loaded':im.has_data,
                           'packed':bool(im.packed_file),'path':bpy.path.abspath(im.filepath),
                           'exists':Path(bpy.path.abspath(im.filepath)).is_file(),
                           'linkedOutputs':[o.name for o in node.outputs if o.is_linked]})
(out/'source-audit.json').write_text(json.dumps({'blender':bpy.app.version_string,
    'source':bpy.data.filepath,'cameraDOF':scene.camera.data.dof.use_dof,'images':images},indent=2)+'\n')
