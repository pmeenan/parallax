"""Source-only shared material/LOD proof; never overwrites approved source or evidence."""
import bpy, json, hashlib, time, sys
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / 'production/candidate3/source.blend'
OUT = ROOT / (sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'candidate1')
assert not OUT.exists(), 'Refuse evidence overwrite'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == '61a22f7efdb3ef0f665cfbb7983e15674561034acf91c487b0dc6bcb068dd421'
assert bpy.app.version[:3] == (5, 2, 1)
OUT.mkdir()
START = time.perf_counter()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.refresh_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
scene.cycles.device = 'GPU'; scene.cycles.samples = 64
assets = [o for o in scene.objects if o.type == 'MESH' and not o.get('excludeFromRuntime')]
assert len([o for o in assets if o.name.startswith('Paver ')]) == 137
meshes = list({o.data for o in assets})
geometry = {m.name: hashlib.sha256(repr(([tuple(v.co) for v in m.vertices], [tuple(p.vertices) for p in m.polygons])).encode()).hexdigest() for m in meshes}
views = json.loads((ROOT.parent/'cobble-study/candidate1/receipt.json').read_text())['views']

def capture(name, state):
    _, eye, target, lens, key, energy, size, ambient = state
    camera = scene.camera; light = scene.objects['Patch area light']
    camera.location = eye; camera.rotation_euler = (Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.lens = lens
    light.location = key; light.rotation_euler = (Vector(target)-light.location).to_track_quat('-Z','Y').to_euler()
    light.data.energy = energy; light.data.size = size
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = ambient
    scene.render.filepath = str(OUT/(name+'.png')); bpy.ops.render.render(write_still=True)

def pixels(image):
    a = np.empty(len(image.pixels), np.float32); image.pixels.foreach_get(a)
    return a.reshape(image.size[1], image.size[0], 4)

def scaled(image, width):
    clone = image.copy(); clone.scale(width, width); result = pixels(clone); bpy.data.images.remove(clone)
    return result

def image(name, array, color=False):
    h,w,_ = array.shape
    im = bpy.data.images.new(name, width=w, height=h, alpha=True)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    im.pixels.foreach_set(array.ravel()); im.update()
    im.filepath_raw = str(OUT/(name+'.png')); im.file_format='PNG'; im.save(); im.pack()
    return im

def blank(width, value):
    return np.broadcast_to(np.array(value,np.float32), (width,width,4)).copy()

def material(name, arrays, colors=False):
    mat = bpy.data.materials.new(name); mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links; bs=nodes['Principled BSDF']
    ims=[]
    for role, arr in zip(['basecolor','normal','orm'], arrays):
        im=image(name+'-'+role,arr,role=='basecolor'); ims.append(im)
        n=nodes.new('ShaderNodeTexImage'); n.image=im; n.interpolation='Linear'; n.extension='EXTEND'
        if role=='basecolor':
            if colors:
                c=nodes.new('ShaderNodeVertexColor'); c.layer_name='DeliveryColor'
                mix=nodes.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=1
                links.new(n.outputs['Color'],mix.inputs[1]); links.new(c.outputs['Color'],mix.inputs[2]); links.new(mix.outputs[0],bs.inputs['Base Color'])
            else: links.new(n.outputs['Color'],bs.inputs['Base Color'])
        elif role=='normal':
            normal=nodes.new('ShaderNodeNormalMap'); links.new(n.outputs['Color'],normal.inputs['Color']); links.new(normal.outputs[0],bs.inputs['Normal'])
        else:
            split=nodes.new('ShaderNodeSeparateColor'); links.new(n.outputs['Color'],split.inputs[0]); links.new(split.outputs['Green'],bs.inputs['Roughness']); links.new(split.outputs['Blue'],bs.inputs['Metallic'])
    return mat,ims

for idx in [0,1,2,3,5,6,7]: capture('control-'+views[idx][0],views[idx])

# Three independent stone bakes occupy guarded atlas tiles. Resolution loss is 0.8%.
stone_meshes=sorted({o.data for o in assets if o.name.startswith('Paver ')},key=lambda m:m.name)
stone_arrays=[blank(4096,(.5,.5,.5,1)),blank(4096,(.5,.5,1,1)),blank(4096,(1,.9,0,1))]
for i,m in enumerate(stone_meshes):
    old=m.materials[0]; nodes=old.node_tree.nodes; x=(i%2)*2048; y=(i//2)*2048
    tiles=[scaled(nodes['Image Texture'].image,2032),scaled(nodes['Image Texture.001'].image,2032)]
    rough=scaled(nodes['Image Texture.002'].image,2032); orm=blank(2032,(1,0,0,1)); orm[:,:,1]=rough[:,:,0]; tiles.append(orm)
    for atlas,tile in zip(stone_arrays,tiles): atlas[y:y+2048,x:x+2048]=np.pad(tile,((8,8),(8,8),(0,0)),mode='edge')
    for uv in m.uv_layers.active.data:
        assert min(uv.uv)>=-1e-5 and max(uv.uv)<=1.00001
        uv.uv=((uv.uv.x*2032+x+8)/4096,(uv.uv.y*2032+y+8)/4096)
stone_mat,stone_maps=material('delivery-limestone',stone_arrays)
for m in stone_meshes: m.materials.clear(); m.materials.append(stone_mat)

# Bake only soil's procedural color and tangent normal; never bake scene illumination.
soil=scene.objects['Continuous adaptive compacted earth']; old=soil.data.materials[0]
uv=soil.data.uv_layers.new(name='DeliveryUV')
for loop in soil.data.loops:
    co=soil.data.vertices[loop.vertex_index].co; uv.data[loop.index].uv=((co.x+2)/4,(co.y+2)/4)
soil.data.uv_layers.active=uv
bpy.ops.object.select_all(action='DESELECT'); soil.select_set(True); bpy.context.view_layer.objects.active=soil
soil_tiles=[]
for role,bake_type in [('color','DIFFUSE'),('normal','NORMAL')]:
    im=bpy.data.images.new('Soil bake '+role,width=2000,height=2000,alpha=True)
    im.colorspace_settings.name='sRGB' if role=='color' else 'Non-Color'
    node=old.node_tree.nodes.new('ShaderNodeTexImage'); node.image=im; old.node_tree.nodes.active=node
    scene.render.bake.use_pass_direct=False; scene.render.bake.use_pass_indirect=False; scene.render.bake.use_pass_color=True
    scene.render.bake.margin=8; bpy.ops.object.bake(type=bake_type)
    soil_tiles.append(pixels(im)); old.node_tree.nodes.remove(node)
ground_arrays=[blank(2048,(1,1,1,1)),blank(2048,(.5,.5,1,1)),blank(2048,(1,.9,0,1))]
for j in range(2): ground_arrays[j][:2016,:2016]=np.pad(soil_tiles[j],((8,8),(8,8),(0,0)),mode='edge')
ground_arrays[2][:2016,:2016,1]=.94
for v in uv.data: v.uv=((v.uv.x*2000+8)/2048,(v.uv.y*2000+8)/2048)
grit=scene.objects['Sparse embedded aggregate']; guv=grit.data.uv_layers.new(name='DeliveryUV')
for p in grit.data.polygons:
    color=grit.data.materials[p.material_index].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
    x=2016; y=p.material_index*32; ground_arrays[0][y:y+32,x:x+32]=color
    for li in p.loop_indices: guv.data[li].uv=((x+16)/2048,(y+16)/2048)
ground_mat,ground_maps=material('delivery-earth-grit',ground_arrays)
for ob in [soil,grit]:
    ob.data.materials.clear(); ob.data.materials.append(ground_mat)
    for p in ob.data.polygons: p.material_index=0

# Shared foliage atlas: original leaf maps + neutral swatch, retaining exact tint streams.
leaf_old=bpy.data.materials['Authored joint weed color normal roughness']; nodes=leaf_old.node_tree.nodes
plant_arrays=[blank(1024,(1,1,1,1)),blank(1024,(.5,.5,1,1)),blank(1024,(1,.88,0,1))]
plant_arrays[0][:528,:528]=np.pad(pixels(nodes['Image Texture'].image),((8,8),(8,8),(0,0)),mode='edge')
plant_arrays[1][:528,:528]=np.pad(pixels(nodes['Image Texture.002'].image),((8,8),(8,8),(0,0)),mode='edge')
plant_arrays[2][:528,:528,1]=np.pad(pixels(nodes['Image Texture.001'].image)[:,:,0],8,mode='edge')
plant_arrays[2][600:700,600:700,1]=.86
plants=[o for o in assets if o not in [soil,grit] and not o.name.startswith('Paver ')]
plant_mat,plant_maps=material('delivery-plants',plant_arrays,True)
for ob in plants:
    mesh=ob.data; oldslots=list(mesh.materials)
    prior=mesh.color_attributes.active_color
    tint={loop.index:tuple(prior.data[loop.index if prior.domain=='CORNER' else loop.vertex_index].color) for loop in mesh.loops} if prior else None
    col=mesh.color_attributes.new(name='DeliveryColor',type='FLOAT_COLOR',domain='CORNER'); mesh.color_attributes.active_color=col
    uv=mesh.uv_layers.active or mesh.uv_layers.new(name='DeliveryUV')
    for p in mesh.polygons:
        old=oldslots[p.material_index]; leaf=old==leaf_old; moss=old.name.startswith('Moss living')
        constant=old.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
        for li in p.loop_indices:
            col.data[li].color=tint[li] if leaf or moss else constant
            if leaf: uv.data[li].uv=((uv.data[li].uv.x*512+8)/1024,(uv.data[li].uv.y*512+8)/1024)
            else: uv.data[li].uv=(650/1024,650/1024) if moss else (.9,.9)
        p.material_index=0
    mesh.materials.clear(); mesh.materials.append(plant_mat)

assert geometry=={m.name:hashlib.sha256(repr(([tuple(v.co) for v in m.vertices],[tuple(p.vertices) for p in m.polygons])).encode()).hexdigest() for m in meshes}
assert len({m for o in assets for m in o.data.materials})==3
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'shared.blend'),compress=True)
for idx in [0,1,2,3,5,6,7]: capture('shared-'+views[idx][0],views[idx])

def export(lod):
    for o in scene.objects: o.select_set(o in assets)
    bpy.context.view_layer.objects.active=assets[0]
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'lod{lod}.glb'),export_format='GLB',use_selection=True,
        export_materials='EXPORT',export_vertex_color='NAME',export_vertex_color_name='DeliveryColor',export_all_vertex_colors=False)
    raw=(OUT/f'lod{lod}.glb').read_bytes(); g=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')])
    triangles=[sum(g['accessors'][p['indices']]['count']//3 for p in m['primitives']) for m in g['meshes']]
    return {'lod':lod,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'uniqueTriangles':sum(triangles),
        'placedTriangles':sum(triangles[n['mesh']] for n in g['nodes'] if 'mesh' in n),'meshes':len(g['meshes']),
        'materials':len(g['materials']),'colorPrimitives':sum('COLOR_0' in p['attributes'] for m in g['meshes'] for p in m['primitives'])}

lods=[export(0)]
for lod,ratio in [(1,.5),(2,.4)]:
    for mesh in list({o.data for o in assets}):
        owners=[o for o in assets if o.data==mesh]; ob=owners[0]
        if mesh.users>1: ob.data=mesh.copy()
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob
        mod=ob.modifiers.new('Explicit distance LOD','DECIMATE'); mod.ratio=ratio; mod.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for other in owners[1:]: other.data=ob.data
    lods.append(export(lod))
    state=list(views[0]); state[1]=[v*(2 if lod==1 else 4) for v in state[1]]
    capture(f'lod{lod}-distance',state)

# Full fresh import checks exported glTF material/color and transforms, not engine behavior.
bpy.ops.wm.open_mainfile(filepath=str(OUT/'shared.blend')); scene=bpy.context.scene
assets=[o for o in scene.objects if o.type=='MESH' and not o.get('excludeFromRuntime')]
for o in assets: bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'lod0.glb'))
for idx in [0,3,5,6,7]: capture('reimport-'+views[idx][0],views[idx])
result={'blender':bpy.app.version_string,'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'lod0GeometryUnchanged':True,'lods':lods,'seconds':time.perf_counter()-START,
    'limits':['source proof only','no class recalibration','no engine or installed proof','no rights/admission','leaf subsurface omitted in standard glTF','LOD transition/mip behavior unqualified']}
(OUT/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
print('DELIVERY_READY',json.dumps(result))
