"""Three distinct authored stones and recessed soil: native contact proof."""
from pathlib import Path
STUDY_CYCLE=11
root=Path('D:/src/parallax/assets/source/d1-paving/surface-study-2026-09-21')
exec(compile((root/'build.py').read_text().split("\nscene=bpy.data.scenes.new")[0],'limestone-library','exec'))
import hashlib
OUT=ROOT/f'assembly-cycle{STUDY_CYCLE}';OUT.mkdir(exist_ok=True)
scene=bpy.data.scenes.new(f'Three stone paving proof cycle{STUDY_CYCLE}');bpy.context.window.scene=scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
stones=[]
for name,seed,hx,hy,location,rotation in [
 ('Paver A',713,.20,.15,(-.207,-.165,0),.005),
 ('Paver B',729,.15,.142,(.161,-.173,.001),-.012),
 ('Paver C',751,.255,.125,(-.072,.129,-.0005),.008)]:
    stone=make_stone(name,seed,hx,hy,.04)
    stone.location=location;stone.rotation_euler.z=rotation;stones.append(stone)
# A shallow real soil bed catches contact shadows and fills the same level joints.
xx,yy=np.meshgrid(np.linspace(-2.2,2.2,281),np.linspace(-2.2,2.2,281))
p=np.column_stack([xx.ravel(),yy.ravel(),np.zeros(xx.size)])
p[:,2]=.061+.0018*(noise(p,180,61)-.5)+.001*(noise(p,32,68)-.5)
ids=np.arange(len(p)).reshape(xx.shape)
faces=np.stack([ids[:-1,:-1],ids[:-1,1:],ids[1:,1:],ids[1:,:-1]],axis=-1).reshape(-1,4)
soil=mesh_object('Recessed earth bed',p.tolist(),faces.tolist())
mat=bpy.data.materials.new('Dry brown silty earth');mat.use_nodes=True
n,l=mat.node_tree.nodes,mat.node_tree.links;bs=n.get('Principled BSDF')
coord=n.new('ShaderNodeTexCoord');tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=850;tex.inputs['Detail'].default_value=3
l.new(coord.outputs['Object'],tex.inputs['Vector'])
col=ramp(n,l,tex.outputs['Fac'],'Earth fine aggregate',[(.20,(.036,.021,.010)),(.55,(.085,.053,.024)),(.80,(.17,.12,.061))]);l.new(col,bs.inputs['Base Color']);bs.inputs['Roughness'].default_value=.93
bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0018;bump.inputs['Strength'].default_value=.8;l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal']);soil.data.materials.append(mat)
# Small real aggregate gives scale without borrowing photographic ground images.
rng=np.random.default_rng(163);verts=[];faces=[]
for i in range(2000):
    center=np.array([rng.uniform(-.7,.7),rng.uniform(-.65,.65),.061]);r=rng.uniform(.0007,.0032)
    start=len(verts)
    template=np.array([(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,.55),(0,0,-.4)])
    verts.extend((template*r+center).tolist())
    faces.extend([tuple(start+j for j in f) for f in [(0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)]])
gravel=mesh_object('Fine loose mineral aggregate',verts,faces)
gravel.data.materials.append(simple_material('Gravel warm mineral',(.16,.12,.074),.86))
studio=bpy.data.scenes[f'Complete limestone study cycle{STUDY_CYCLE}'];scene.world=studio.world.copy()
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.22
camera=studio.camera.copy();camera.data=studio.camera.data.copy();scene.collection.objects.link(camera);scene.camera=camera
light=next(o for o in studio.objects if o.type=='LIGHT').copy();light.data=light.data.copy();scene.collection.objects.link(light)
light.location=(-1.0,-.9,1.5);light.rotation_euler=(Vector((0,0,.06))-light.location).to_track_quat('-Z','Y').to_euler();light.data.energy=145;light.data.size=.5;light.data.color=(1,.94,.86)
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=128;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
views=[('oblique',(.73,-.98,1.10),50),('walking',(.05,-.40,1.70),52),('reverse',(-.81,.77,.78),50)]
for name,eye,lens in views:
    point_camera(eye,(-.04,-.015,.065),lens);scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
point_camera(views[0][1],(-.04,-.015,.065),views[0][2])
light.location=(1.0,.9,1.5);light.rotation_euler=(Vector((0,0,.06))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUT/'reverse-light.png');bpy.ops.render.render(write_still=True)
light.location=(-1.0,-.9,1.5);light.rotation_euler=(Vector((0,0,.06))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUT/'oblique.png')
for im in bpy.data.images:
    if im.source=='FILE' and im.has_data and not im.packed_file:im.pack()
bpy.data.libraries.write(str(OUT/'source.blend'),{scene},fake_user=True,compress=True)
receipt={'createdUtc':datetime.now(timezone.utc).isoformat(),'native':'Blender Cycles 128 samples AgX; no paintover',
 'stones':[{'name':s.name,'seed':s['seed'],'dimensionsM':list(s.dimensions),'triangles':sum(len(p.vertices)-2 for p in s.data.polygons)} for s in stones],
 'soilElevationM':.061,'scope':'Three source variants and contact proof; no runtime acceptance',
 'files':[{'name':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size} for f in sorted(OUT.iterdir()) if f.suffix in {'.png','.blend'}]}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');result=receipt
