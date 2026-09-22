"""Additional unchanged moss visibility evidence; source is not saved."""
import bpy,json
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).parent;bpy.ops.wm.open_mainfile(filepath=str(OUT/'source.blend'));scene=bpy.context.scene;camera=scene.camera
r=json.loads((OUT/'receipt.json').read_text());prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
for index in [2,3]:
    root=Vector([p for p in r['plants'] if p['type']=='moss'][index]['root']);eye=root+Vector((.025,-.025,.13));camera.location=eye;camera.rotation_euler=(root-eye).to_track_quat('-Z','Y').to_euler();camera.data.lens=58
    scene.render.filepath=str(OUT/f'moss-pocket-{index}.png');bpy.ops.render.render(write_still=True)
