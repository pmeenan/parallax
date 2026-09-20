"""Batch188 isolated courtyard camera blockout; Blender 5.2.1.
Approved horizontal plan: batch187-a. Heights explicitly provisional.
World game (x,z) maps to Blender (x+516,z+146,height). No game files consumed/mutated.
"""
import bpy, math, json, pathlib, datetime
from mathutils import Vector
OUT=pathlib.Path(r"D:/src/parallax/assets/reference/concepts/batch-188")
OUT.mkdir(parents=True,exist_ok=True)
if (OUT/"courtyard-layout.blend").exists():
    raise RuntimeError("Refusing overwrite of existing scene")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.unit_settings.system="METRIC"
scene.render.engine="CYCLES"
scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.resolution_x=1536
scene.render.resolution_y=1024
scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"
scene.world=bpy.data.worlds.new("Neutral sky")
scene.world.use_nodes=True
scene.world.node_tree.nodes["Background"].inputs[0].default_value=(0.65,0.7,0.75,1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value=0.6
scene.view_settings.view_transform="AgX"
def mat(name,rgb):
    m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,1);m.use_nodes=True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value=(*rgb,1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value=0.85
    return m
clay=mat("Building neutral clay",(0.58,0.56,0.51))
roof=mat("Roof mass",(0.32,0.28,0.25))
stone=mat("Well and stair stone",(0.42,0.45,0.45))
ground=mat("Courtyard datum",(0.46,0.45,0.4))
road=mat("Six metre circulation",(0.57,0.55,0.48))
earth=mat("Provisional earth bank",(0.34,0.37,0.3))
dark=mat("Opaque entrance leaf",(0.16,0.14,0.12))
wood=mat("Well support and bench",(0.3,0.25,0.2))
def box(name,x0,x1,z0,z1,h0,h1,material):
    bpy.ops.mesh.primitive_cube_add(size=1,location=((x0+x1)/2+516,(z0+z1)/2+146,(h0+h1)/2))
    ob=bpy.context.object;ob.name=name;ob.dimensions=(x1-x0,z1-z0,h1-h0)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    ob.data.materials.append(material)
    ob["world_xz_bounds"]=[x0,x1,z0,z1];ob["provisional_height_bounds"]=[h0,h1]
    return ob
def mesh(name,verts,faces,material):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.data.materials.append(material);return ob
# Court substrate has a real stair trench, no ground surface across the descent.
xs=[-551,-514,-510,-480]; zs=[-181,-138,-128,-113]
for i in range(3):
 for j in range(3):
    if i==1 and j==1: continue
    box("Datum substrate",xs[i],xs[i+1],zs[j],zs[j+1],-0.3,0,ground)
box("E-W route 6m",-549,-477,-154,-148,0,0.008,road)
box("South spur 6m",-521,-515,-182,-148,0.009,0.016,road)
houses=[("House1",-540,-527,-136,-122),("House2",-506,-492,-136,-122),("House3",-540,-528,-170,-159),("House4",-505,-492,-170,-159)]
for name,x0,x1,z0,z1 in houses:
    box(name+" 6m wall mass",x0,x1,z0,z1,0,6,clay)
    # Pitched prism entirely inside footprint, ridge north-south; no invented eave overhang.
    a,b,c,d=x0+516,x1+516,z0+146,z1+146;m=(a+b)/2
    mesh(name+" pitched roof",[(a,c,6),(b,c,6),(m,c,9),(a,d,6),(b,d,6),(m,d,9)],[(0,2,1),(3,4,5),(0,3,5,2),(2,5,4,1),(0,1,4,3)],roof)
# Well ring outer diameter2.5m matches SVG's circle; opening is real annular geometry.
verts=[];faces=[];n=48
for h,r in [(0,1.25),(1,1.25),(1,0.88),(0,0.88)]:
 for k in range(n):
    a=2*math.pi*k/n;verts.append((-6+r*math.cos(a),7+r*math.sin(a),h))
for layer in range(3):
 for k in range(n):
    q=(k+1)%n;faces.append((layer*n+k,layer*n+q,(layer+1)*n+q,(layer+1)*n+k))
mesh("Separate working well ring",verts,faces,stone)
for x in [-523.12,-520.88]:
 box("Well support",x-0.12,x+0.12,-139.12,-138.88,0,2.7,wood)
box("Well crossbeam",-523.4,-520.6,-139.13,-138.87,2.5,2.75,wood)
# Single bench indicated in187 plan, no additional dressing.
box("Bench seat",-532.375,-527.5,-140.125,-138.625,0.42,0.55,wood)
for x in [-531.8,-528.1]:
 box("Bench support",x-0.15,x+0.15,-139.95,-138.8,0,0.42,wood)
# Stairs go north into a separate opaque entrance at fixed anchor.
for k in range(20):
    level=-0.1*(k+1)
    box("Stair tread %02d"%k,-513.7,-510.3,-138+k*0.5,-137.5+k*0.5,-2.3,level,stone)
for x0,x1 in [(-514,-513.7),(-510.3,-510)]:
 box("Stair retaining wall",x0,x1,-138,-128,-2.3,0.45,stone)
# Bank motif sits beyond stair end, distinct from house masses; height provisional.
box("Earth bank west",-527,-514,-128,-122,0,2.2,earth)
box("Earth bank east",-510,-506,-128,-122,0,2.2,earth)
box("Earth above closed entrance",-514,-510,-127.7,-122,0.9,2.2,earth)
box("Opaque separate entrance at anchor",-513.4,-510.6,-128,-127.8,-2,0.6,dark)
box("Entrance left pier",-514,-513.4,-128.1,-127.6,-2,0.9,stone)
box("Entrance right pier",-510.6,-510,-128.1,-127.6,-2,0.9,stone)
box("Entrance lintel",-514,-510,-128.1,-127.6,0.6,0.9,stone)
bpy.ops.object.light_add(type="SUN",location=(0,0,25))
sun=bpy.context.object;sun.name="Shared soft daylight";sun.rotation_euler=(math.radians(26),math.radians(-20),math.radians(-35));sun.data.energy=2;sun.data.angle=math.radians(12)
cams={}
for name,x,z,tx,tz in [("a",-534,-154,-515.125,-135.875),("b",-498,-145,-519.25,-139.75),("c",-518,-164,-520.25,-144)]:
    bpy.ops.object.camera_add(location=(x+516,z+146,1.7))
    cam=bpy.context.object;cam.name="Camera "+name.upper();cam.data.type="PERSP";cam.data.sensor_fit="HORIZONTAL"
    cam.data.sensor_width=36;cam.data.lens=36/(2*math.tan(math.radians(65)/2))
    target=Vector((tx+516,tz+146,1.7));cam.rotation_euler=(target-cam.location).to_track_quat("-Z","Y").to_euler()
    cam.data.clip_end=200;cams[name]=cam
bpy.ops.object.camera_add(location=(42,-60,50))
overview=bpy.context.object;overview.name="Overview";overview.data.type="ORTHO";overview.data.ortho_scale=72
overview.rotation_euler=(Vector((0,0,0))-overview.location).to_track_quat("-Z","Y").to_euler();cams["overview"]=overview
scene["purpose"]="Shared concept blockout only; not game asset"
scene["world_origin_xz"]=[-516,-146]
scene["heights"]="Provisional local datum0, walls6, ridges9, well1, stair drop2, earth bank2.2"
scene.camera=cams["a"]
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"courtyard-layout.blend"))
for name,cam in cams.items():
    scene.camera=cam;scene.render.filepath=str(OUT/("blockout-"+name+".png"))
    bpy.ops.render.render(write_still=True)
    print("READY "+scene.render.filepath,flush=True)
summary={"blender":bpy.app.version_string,"created_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"world_origin":[-516,-146],"house_footprints":houses,"cameras":{k:{"blender_location":list(v.location),"hfov_degrees":math.degrees(v.data.angle_x) if v.data.type=="PERSP" else None}for k,v in cams.items()},"shared_scene_objects":len(scene.objects),"provisional_elevations":True}
(OUT/"blockout-scene.json").write_text(json.dumps(summary,indent=2))

