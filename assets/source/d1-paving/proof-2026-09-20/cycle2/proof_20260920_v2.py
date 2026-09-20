"""First 4m paving source proof after D195; isolated Blender5.2.1, no export/admission.
Reuses original closed-stone utility; selected concept images are visual authorities only.
"""
import bpy, math, random, json, hashlib, pathlib, sys, datetime
import numpy as np
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=ROOT/"harness/results/d1-paving-proof-2026-09-20/cycle2"
OUT.mkdir(parents=True,exist_ok=True)
if (OUT/"source.blend").exists():raise RuntimeError("Refusing existing proof overwrite")
assert bpy.app.version==(5,2,1)
bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from stone_geometry import build_stone
START=datetime.datetime.now(datetime.timezone.utc).isoformat()
scene=bpy.context.scene;scene.unit_settings.system="METRIC"
scene.render.engine="CYCLES";scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.render.resolution_x=1536;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG";scene.view_settings.view_transform="AgX"
rng=random.Random(20260920)
SURFACE=ROOT/"assets/reference/d1-paving-clean/limestone-single-surface-v1.png"
def material(name,color,rough=.85):
 m=bpy.data.materials.new(name);m.use_nodes=True
 bs=m.node_tree.nodes.get("Principled BSDF");bs.inputs["Base Color"].default_value=(*color,1);bs.inputs["Roughness"].default_value=rough
 return m
stone=material("Selected limestone with authored broad wear",(0.6,0.56,0.49))
n,l=stone.node_tree.nodes,stone.node_tree.links;bs=n.get("Principled BSDF")
uv=n.new("ShaderNodeTexCoord")
img=n.new("ShaderNodeTexImage");img.image=bpy.data.images.load(str(SURFACE));l.new(uv.outputs["UV"],img.inputs["Vector"])
# Reuse the selected generated image, add authored broad tonal variation independent of bump.
noise=n.new("ShaderNodeTexNoise");noise.inputs["Scale"].default_value=11;noise.inputs["Detail"].default_value=2;noise.inputs["Roughness"].default_value=.55
l.new(uv.outputs["Object"],noise.inputs["Vector"])
ramp=n.new("ShaderNodeValToRGB");ramp.color_ramp.elements[0].position=.455;ramp.color_ramp.elements[0].color=(.20,.235,.24,1)
ramp.color_ramp.elements[1].position=.515;ramp.color_ramp.elements[1].color=(.8,.67,.47,1)
ramp.color_ramp.interpolation='EASE'
l.new(noise.outputs["Fac"],ramp.inputs[0])
mul=n.new("ShaderNodeMixRGB");mul.blend_type="MULTIPLY";mul.inputs[0].default_value=1;l.new(img.outputs["Color"],mul.inputs[1]);l.new(ramp.outputs[0],mul.inputs[2])
info=n.new("ShaderNodeObjectInfo");tone=n.new("ShaderNodeMapRange");tone.inputs["To Min"].default_value=.76;tone.inputs["To Max"].default_value=1.0;l.new(info.outputs["Random"],tone.inputs["Value"])
mul2=n.new("ShaderNodeMixRGB");mul2.blend_type="MULTIPLY";mul2.inputs[0].default_value=1;l.new(mul.outputs[0],mul2.inputs[1]);l.new(tone.outputs["Result"],mul2.inputs[2]);l.new(mul2.outputs[0],bs.inputs["Base Color"])
wear=n.new('ShaderNodeAttribute');wear.attribute_name='localized_pale_fracture'
edge=n.new('ShaderNodeMixRGB');l.new(wear.outputs['Fac'],edge.inputs[0]);l.new(mul2.outputs[0],edge.inputs[1]);edge.inputs[2].default_value=(.68,.60,.45,1);l.new(edge.outputs[0],bs.inputs['Base Color'])
fine=n.new("ShaderNodeTexNoise");fine.inputs["Scale"].default_value=230;fine.inputs["Detail"].default_value=2;l.new(uv.outputs["Object"],fine.inputs["Vector"])
bump=n.new("ShaderNodeBump");bump.inputs["Distance"].default_value=.0005;bump.inputs["Strength"].default_value=.3;l.new(fine.outputs["Fac"],bump.inputs["Height"]);l.new(bump.outputs[0],bs.inputs["Normal"])
soil=material("Brown recessed joint earth",(.12,.085,.047),.96)
n,l=soil.node_tree.nodes,soil.node_tree.links;bs=n.get("Principled BSDF")
coord=n.new("ShaderNodeTexCoord");noise=n.new("ShaderNodeTexNoise");noise.inputs["Scale"].default_value=44;noise.inputs["Detail"].default_value=4;l.new(coord.outputs["Object"],noise.inputs["Vector"])
ramp=n.new("ShaderNodeValToRGB");ramp.color_ramp.elements[0].color=(.055,.033,.014,1);ramp.color_ramp.elements[1].color=(.23,.16,.078,1);l.new(noise.outputs["Fac"],ramp.inputs[0]);l.new(ramp.outputs[0],bs.inputs["Base Color"])
bump=n.new("ShaderNodeBump");bump.inputs["Distance"].default_value=.0015;bump.inputs["Strength"].default_value=.5;l.new(noise.outputs["Fac"],bump.inputs["Height"]);l.new(bump.outputs[0],bs.inputs["Normal"])
gritmat=material("Mixed buff soil aggregate",(.26,.2,.125),.93)
leafmats=[material("Broadleaf olive",(.13,.19,.027),.82),material("Broadleaf green",(.055,.12,.012),.86),material("Young leaf",(.17,.23,.025),.8)]
veinmat=material("Leaf midrib",(.18,.21,.035),.85)
def ground_h(x,y):
 return .0025*math.sin(x*4.6+y*.8)+.002*math.sin(y*7.3-x*2.2)+.0014*math.sin(x*15.2+y*11.5)
def mesh_object(name,vs,fs,mat):
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);scene.collection.objects.link(o);me.materials.append(mat);return o
# Nonuniform lattice supplies unequal dimensions; spanning stones break short courses.
stepsx=np.array([rng.uniform(.23,.4) for _ in range(12)]);stepsx*=4/stepsx.sum()
stepsy=np.array([rng.uniform(.23,.4) for _ in range(12)]);stepsy*=4/stepsy.sum()
xs=np.concatenate(([-2],-2+np.cumsum(stepsx)));ys=np.concatenate(([-2],-2+np.cumsum(stepsy)))
grid=np.zeros((12,12),dtype=bool);slots=[]
while not grid.all():
 choices=np.argwhere(~grid);j,i=choices[rng.randrange(len(choices))]
 shapes=[(2,1),(1,2),(2,2),(1,1),(3,1),(1,3)]
 rng.shuffle(shapes)
 for w,h in shapes:
  if i+w<=12 and j+h<=12 and not grid[j:j+h,i:i+w].any():break
 grid[j:j+h,i:i+w]=True;slots.append((int(i),int(j),w,h))
placements=[];hulls=[];stoneobs=[]
for k,(i,j,gw,gh) in enumerate(slots):
 x0,x1=xs[i],xs[i+gw];y0,y1=ys[j],ys[j+gh]
 # Occasional narrow inserts share one nominal cell with a larger neighbour piece.
 parts=[(x0,x1,y0,y1)]
 if gw>=2 and gh==1 and k%9==0:
  cut=x0+(x1-x0)*.2;parts=[(x0,cut,y0,y1),(cut,x1,y0,y1)]
 if gh>=2 and k%4==0:
  cut=y0+(y1-y0)*.24;parts=[(x0,x1,y0,cut),(x0,x1,cut,y1)]
 for part,(x0,x1,y0,y1) in enumerate(parts):
  index=len(stoneobs);gap=rng.uniform(.008,.016);w=x1-x0-gap;h=y1-y0-gap
  me=build_stone(.392,.29,9001+index*83,2300 if max(w,h)>.36 else 1600)
  # Affine taper/skew of the complete closed mesh gives real distinct silhouettes.
  a,b=rng.uniform(-.11,.11),rng.uniform(-.09,.09);shear=rng.uniform(-.055,.055)
  for v in me.vertices:
   x,y=v.co.x/.392,v.co.y/.29;v.co.x=x*(1+a*y)+shear*y;v.co.y=y*(1+b*x)
  lo=[min(v.co[d] for v in me.vertices)for d in [0,1]];hi=[max(v.co[d] for v in me.vertices)for d in [0,1]]
  for v in me.vertices:
   v.co.x=((v.co.x-lo[0])/(hi[0]-lo[0])-.5)*w
   v.co.y=((v.co.y-lo[1])/(hi[1]-lo[1])-.5)*h
  # Independent localized chips deform the existing closed shell, not boolean holes.
  chips=[(rng.choice([-1,1])*w*.47,rng.uniform(-.4,.4)*h,rng.uniform(.015,.04),rng.uniform(.002,.007)) for _ in range(3)]
  chips += [(rng.uniform(-.3,.3)*w,rng.uniform(-.3,.3)*h,rng.uniform(.008,.017),rng.uniform(.001,.003)) for _ in range(2)]
  for v in me.vertices:
   if v.co.z>.045:
    for px,py,rad,depth in chips:
     d=math.hypot(v.co.x-px,v.co.y-py)
     if d<rad:v.co.z-=depth*(1-d/rad)**.55
  wearattr=me.attributes.new('localized_pale_fracture','FLOAT','POINT')
  for v in me.vertices:
   border=max(abs(v.co.x)/(w*.5),abs(v.co.y)/(h*.5))
   localized=max(0,math.sin(v.co.x*39+index)*math.cos(v.co.y*31-index))
   wearattr.data[v.index].value=max(0,min(1,(border-.78)/.18))*localized*.7
  me.update();tex=me.uv_layers.new(name="Selected image independent stone projection")
  flip=index%4
  for poly in me.polygons:
   axis=max(range(3),key=lambda d:abs(poly.normal[d]))
   for li in poly.loop_indices:
    p=me.vertices[me.loops[li].vertex_index].co
    u,v=(p.x/w,p.y/h) if axis==2 else ((p.x/w,p.z/.073-.5) if axis==1 else(p.y/h,p.z/.073-.5))
    if flip%2:u,v=v,u
    if flip>=2:u=-u
    tex.data[li].uv=(u*.94+.5,v*.94+.5)
  ob=bpy.data.objects.new("Limestone %03d"%index,me);scene.collection.objects.link(ob);me.materials.append(stone)
  cx,cy=(x0+x1)/2,(y0+y1)/2
  # Sparse near-flush stones interrupt the continuously exposed historical lip.
  exposure=rng.uniform(.009,.017)
  if abs(cx)>1.7 or abs(cy)>1.7:exposure*=.7
  ob.location=(cx,cy,ground_h(cx,cy)+exposure-.073)
  stoneobs.append(ob);hulls.append((x0+gap/2,x1-gap/2,y0+gap/2,y1-gap/2))
  placements.append({"id":ob.name,"box_xy":[x0+gap/2,x1-gap/2,y0+gap/2,y1-gap/2],"center":list(ob.location),"exposure_at_center":exposure,"triangles":len(me.polygons)})
 print("GEOMETRY "+str(k+1)+"/"+str(len(slots)),flush=True)
# World-space top intersection queries keep substrate below actual stone faces.
from mathutils.bvhtree import BVHTree
bpy.context.view_layer.update()
trees=[]
for ob,box in zip(stoneobs,hulls):
 verts=[ob.matrix_world@v.co for v in ob.data.vertices]
 trees.append((box,BVHTree.FromPolygons(verts,[list(p.vertices) for p in ob.data.polygons],all_triangles=True)))
def top_at(x,y):
 for (a,b,c,d),tree in trees:
  if a-.002<=x<=b+.002 and c-.002<=y<=d+.002:
   hit=tree.ray_cast(Vector((x,y,.2)),Vector((0,0,-1)),.4)[0]
   if hit is not None:return hit.z
 return None
def soil_h(x,y):
 z=ground_h(x,y);top=top_at(x,y)
 if top is not None:z=min(z,top-.009)
 return z
# Fine substrate follows local burial; no global lowering of the earth.
N=360;vs=[];fs=[]
for j in range(N+1):
 y=-2.35+4.7*j/N
 for i in range(N+1):
  x=-2.35+4.7*i/N;vs.append((x,y,soil_h(x,y)))
for j in range(N):
 for i in range(N):
  a=j*(N+1)+i;fs.append((a,a+1,a+N+2,a+N+1))
earth=mesh_object("Continuous earth substrate",vs,fs,soil)
def free_radius(x,y):
 if top_at(x,y) is not None:return -1
 for radius in [.003,.006,.012,.025]:
  if any(top_at(x+radius*math.cos(a),y+radius*math.sin(a)) is not None for a in [0,math.pi/2,math.pi,3*math.pi/2]):return radius*.7
 return .03
# Geometry grit: shared primitive meshes, varied buried fragments only in open soil.
gritmeshes=[]
for q in range(6):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1)
 o=bpy.context.object;o.data.materials.append(material("Aggregate tone %d"%q,[(.19,.16,.11),(.3,.27,.2),(.1,.085,.065),(.39,.34,.24),(.16,.17,.15),(.25,.21,.14)][q]));gritmeshes.append(o.data);o.data.use_fake_user=True;bpy.data.objects.remove(o,do_unlink=True)
grit=0
for attempt in range(170000):
 if grit>=11000:break
 x,y=rng.uniform(-2.03,2.03),rng.uniform(-2.03,2.03);radius=rng.uniform(.002,.010)
 if free_radius(x,y)<radius*.65:continue
 o=bpy.data.objects.new("Embedded grit",gritmeshes[grit%6]);scene.collection.objects.link(o)
 o.location=(x,y,soil_h(x,y)-radius*.2);o.scale=(radius,radius*rng.uniform(.6,1),radius*rng.uniform(.45,.8));o.rotation_euler=(rng.random(),rng.random(),rng.random()*6.28);grit+=1
# Sparse rosettes: visibly broad leaves with a central ridge, shared rooted crown.
roots=[];leafobjects=[]
for attempt in range(10000):
 if len(roots)>=18:break
 x,y=rng.uniform(-1.92,1.92),rng.uniform(-1.92,1.92)
 if free_radius(x,y)<.007 or any(math.hypot(x-a,y-b)<.35 for a,b,z in roots):continue
 z=soil_h(x,y)-.001;roots.append((x,y,z));scale=rng.uniform(.8,1.3)
 for leaf in range(rng.randint(5,8)):
  ang=rng.random()*math.tau;length=rng.uniform(.045,.09)*scale;width=rng.uniform(.012,.022)*scale;rise=rng.uniform(.025,.06)*scale
  vs=[];fs=[];petiole=rng.uniform(.014,.027);twist=rng.uniform(-.3,.3)
  for s in range(13):
   t=s/12;ww=width*math.sin(math.pi*t)**.55
   for across in range(7):
    side=(across-3)/3;along=petiole+length*t;sideways=side*ww
    hh=z+.032+rise*math.sin(math.pi*t*.8)-side*side*.008*math.sin(math.pi*t)+side*twist*ww
    vs.append((x+math.cos(ang)*along-math.sin(ang)*sideways,y+math.sin(ang)*along+math.cos(ang)*sideways,hh))
  for s in range(12):
   for t in range(6):
    a=s*7+t;fs.append((a,a+1,a+8,a+7))
  o=mesh_object("Rooted broad leaf",vs,fs,leafmats[leaf%3]);leafobjects.append(o)
  for p in o.data.polygons:p.use_smooth=True
  # Subtle modeled vein, not a texture sampled from a concept.
  curve=bpy.data.curves.new("Leaf vein","CURVE");curve.dimensions="3D";curve.bevel_depth=.00032;curve.bevel_resolution=0
  poly=curve.splines.new("POLY");poly.points.add(16)
  for s in range(4):
   t=s/4;poly.points[s].co=(x+math.cos(ang)*petiole*t,y+math.sin(ang)*petiole*t,z+.032*t,1)
  for s in range(13):
   p=Vector(vs[s*7+3]);p.z+=.0004;poly.points[s+4].co=(*p,1)
  vob=bpy.data.objects.new("Leaf midrib",curve);scene.collection.objects.link(vob);curve.materials.append(veinmat)
scene.world=bpy.data.worlds.new("Natural daylight");scene.world.use_nodes=True
world=scene.world.node_tree.nodes["Background"];world.inputs[0].default_value=(.65,.75,1,1);world.inputs[1].default_value=.38
bpy.ops.object.light_add(type="SUN",rotation=(.55,-.45,-.7));sun=bpy.context.object;sun.name="Day sun";sun.data.energy=2.3;sun.data.angle=.09
bpy.ops.object.camera_add();cam=bpy.context.object;cam.name="Proof camera";scene.camera=cam
def camera(location,target,lens):
 cam.data.type="PERSP";cam.data.lens=lens;cam.location=location;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat("-Z","Y").to_euler()
def capture(name,loc,target,lens=48):
 camera(loc,target,lens);scene.render.filepath=str(OUT/(name+".png"));bpy.ops.render.render(write_still=True);print("READY "+scene.render.filepath,flush=True)
camera((0,-3.5,1.7),(0,.15,0),40)
# Pack only selected source image for portable native scene; source remains untouched.
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"source.blend"))
refs=["batch-103/kit-001-paving-assembly-v1.png","batch-104/kit-002-stone-family-v4.png","batch-108/mat-001-cream-limestone-v1.png","batch-108/mat-018-joint-soil-v1.png","batch-116/veg-001-courtyard-joint-plants-v1.png"]
facts={"blender":bpy.app.version_string,"started_utc":START,"seed":20260920,"patch_bounds":[-2,2,-2,2],"substrate_bounds":[-2.35,2.35,-2.35,2.35],"stones":placements,"roots":[{"position":p,"crown_radius":.004,"conservative_box_clearance":free_radius(p[0],p[1])}for p in roots],"grit_count":grit,"materials":len(bpy.data.materials),"stone_triangles":sum(len(o.data.polygons) for o in stoneobs),"substrate_triangles":N*N*2,"leaf_triangles":sum(len(o.data.polygons)*2 for o in leafobjects),"source_texture":{"path":str(SURFACE),"sha256":hashlib.sha256(SURFACE.read_bytes()).hexdigest(),"physical_uv_scale":"Artistic per-stone fit, not calibrated"},"selected_visual_refs":[{"path":r,"sha256":hashlib.sha256((ROOT/"assets/reference/concepts"/r).read_bytes()).hexdigest()}for r in refs],"capture_cameras":{"walking":{"location":[0,-3.5,1.7],"target":[0,.15,0],"lens_mm":40},"grazing":{"location":[.5,-2.5,.33],"target":[0,-.65,.005],"lens_mm":55}},"scope":"Source proof only. No export, admission, PBR calibration or runtime acceptance."}
(OUT/"source-metrics.json").write_text(json.dumps(facts,indent=2))
capture("walking-daylight",(0,-3.5,1.7),(0,.15,0),40)
sun.hide_render=True;world.inputs[0].default_value=(.8,.84,.9,1);world.inputs[1].default_value=.85
capture("walking-overcast",(0,-3.5,1.7),(0,.15,0),40)
sun.hide_render=False;world.inputs[0].default_value=(.65,.75,1,1);world.inputs[1].default_value=.38
capture("oblique-assembly",(3.1,-3.2,2.9),(0,0,0),48)
capture("grazing-detail",(.5,-2.5,.33),(0,-.65,.005),55)
cam.data.type="ORTHO";cam.data.ortho_scale=7.2;cam.location=(0,0,6);cam.rotation_euler=(0,0,0)
scene.render.filepath=str(OUT/"top-packing.png");bpy.ops.render.render(write_still=True);print("READY "+scene.render.filepath,flush=True)
facts["completed_utc"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
facts["outputs"]=[{"file":p.name,"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}for p in OUT.iterdir()if p.suffix in [".png",".blend"]]
(OUT/"source-metrics.json").write_text(json.dumps(facts,indent=2))
