"""Read-only native source topology audit; no save or render."""
import bpy, bmesh, json, pathlib, struct
out=pathlib.Path(__file__).parent
stones=[]
for ob in bpy.data.objects:
    if ob.type!='MESH' or not ob.name.startswith('Limestone '): continue
    bm=bmesh.new();bm.from_mesh(ob.data)
    stones.append({'name':ob.name,'vertices':len(bm.verts),'faces':len(bm.faces),
        'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),
        'dimensions_m':list(ob.dimensions)})
    bm.free()
images=[]
for p in out.glob('*.png'):
    data=p.read_bytes();w,h=struct.unpack('>II',data[16:24])
    images.append({'file':p.name,'width':w,'height':h})
report={'method':'Read existing source.blend in Blender; no scene save or render',
    'stone_count':len(stones),'stones':stones,'images':images,
    'materials':len(bpy.data.materials),'packed_images':[im.name for im in bpy.data.images if im.packed_file],
    'limits':'Closed stone topology only. Does not establish leaf collision, material quality, export or runtime validity.'}
(out/'source-topology.json').write_text(json.dumps(report,indent=2))
print('AUDIT',len(stones),'stones;',sum(s['nonmanifold_edges'] for s in stones),'nonmanifold edges')
