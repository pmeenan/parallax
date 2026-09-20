"""Batch188 second/final blockout cycle. Run against retained courtyard-layout.blend.
Terrain source is 188-terrain-samples.json. No v1 outputs overwritten.
"""
import bpy, math, pathlib, json, bisect, datetime, hashlib
OUT=pathlib.Path(r"D:/src/parallax/assets/reference/concepts/batch-188")
if (OUT/"courtyard-layout-v2.blend").exists(): raise RuntimeError("Refusing overwrite")
scene=bpy.context.scene
terrain=json.loads((OUT/"188-terrain-samples.json").read_text())
X,Z,H=terrain["x"],terrain["z"],terrain["heights"]
def height(x,z):
 i=max(0,min(len(X)-2,bisect.bisect_right(X,x)-1));j=max(0,min(len(Z)-2,bisect.bisect_right(Z,z)-1))
 u=(x-X[i])/(X[i+1]-X[i]);v=(z-Z[j])/(Z[j+1]-Z[j])
 return (1-v)*((1-u)*H[j][i]+u*H[j][i+1])+v*((1-u)*H[j+1][i]+u*H[j+1][i+1])
def mesh(name,verts,faces,material):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update()
 o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.data.materials.append(material);return o
def box(name,x0,x1,z0,z1,h0,h1,material):
 bpy.ops.mesh.primitive_cube_add(size=1,location=((x0+x1)/2+516,(z0+z1)/2+146,(h0+h1)/2))
 o=bpy.context.object;o.name=name;o.dimensions=(x1-x0,z1-z0,h1-h0)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material);return o
stone=bpy.data.materials["Well and stair stone"];ground=bpy.data.materials["Courtyard datum"];road=bpy.data.materials["Six metre circulation"]
wood=bpy.data.materials["Well support and bench"];roof=bpy.data.materials["Roof mass"];dark=bpy.data.materials["Opaque entrance leaf"]
def surface(name,xs,zs,material,offset=0,trench=False):
 verts=[(x+516,z+146,height(x,z)+offset) for z in zs for x in xs];faces=[];n=len(xs)
 for j in range(len(zs)-1):
  for i in range(n-1):
   mx=(xs[i]+xs[i+1])/2;mz=(zs[j]+zs[j+1])/2
   if trench and -514<mx<-510 and -138<mz<-128:continue
   a=j*n+i;faces.append((a,a+1,a+n+1,a+n))
 return mesh(name,verts,faces,material)
def cuts(lo,hi,grid):
 return sorted(set([lo,hi]+[v for v in grid if lo<v<hi]))
for o in list(scene.objects):
 if o.name.startswith(("Datum substrate","E-W route","South spur","Stair retaining")):
  bpy.data.objects.remove(o,do_unlink=True)
surface("Sampled ground with stair trench",X,Z,ground,trench=True)
surface("E-W six metre conforming route",cuts(-549,-478,X),cuts(-154,-148,Z),road,0.012)
surface("South six metre conforming route",cuts(-521,-515,X),cuts(-182,-148,Z),road,0.024)
# All door/window elements below are registration markers, not finished openings.
floors={}
houses=[("House1",-540,-527,-136,-122,False),("House2",-506,-492,-136,-122,False),("House3",-540,-528,-170,-159,True),("House4",-505,-492,-170,-159,True)]
for name,x0,x1,z0,z1,north in houses:
 vals=[height(x,z) for x in cuts(x0,x1,X) for z in cuts(z0,z1,Z)]
 floor=max(vals)+0.12;floors[name]=floor
 bpy.data.objects[name+" 6m wall mass"].location.z+=floor;bpy.data.objects[name+" pitched roof"].location.z+=floor
 box(name+" foundation plinth",x0,x1,z0,z1,min(vals)-0.08,floor,stone)
 front=z1 if north else z0;direction=1 if north else -1;cx=(x0+x1)/2
 def frontmark(label,xc,w,base,tall,zface=front,out=direction):
  return box(name+" "+label,xc-w/2,xc+w/2,zface+min(0.008,out*0.05),zface+max(0.008,out*0.05),floor+base,floor+base+tall,dark)
 frontmark("front door marker",cx,1.2,0,2.2)
 for k,xx in enumerate([x0+(x1-x0)*0.25,x0+(x1-x0)*0.75]):
  frontmark("front lower window marker "+str(k),xx,1.15,1.2,1.3)
 for k,frac in enumerate([0.22,0.5,0.78]):
  frontmark("front upper window marker "+str(k),x0+(x1-x0)*frac,1.15,4,1.3)
 # Opposite elevation and two end sides: two upper window markers each.
 back=z0 if north else z1
 for k,frac in enumerate([0.3,0.7]):
  frontmark("rear upper window marker "+str(k),x0+(x1-x0)*frac,1.15,4,1.3,back,-direction)
 for side,xx,sgn in [("west",x0,-1),("east",x1,1)]:
  for k,frac in enumerate([0.3,0.7]):
   zz=z0+(z1-z0)*frac
   box(name+" "+side+" upper window marker "+str(k),xx+min(0.008,sgn*0.05),xx+max(0.008,sgn*0.05),zz-0.575,zz+0.575,floor+4,floor+5.3,dark)
 # Fixed non-emissive lamp placeholder beside central doorway.
 lz=front+direction*0.18
 box(name+" lantern registration",cx+0.9,cx+1.15,lz-0.12,lz+0.12,floor+2.2,floor+2.6,dark)
 # Modest threshold connects approved door registration to sampled ground.
 box(name+" threshold",cx-0.7,cx+0.7,front-0.25,front+0.25,height(cx,front)-0.02,floor,stone)
wellbase=terrain["namedPoints"]["well"]["y"]
for o in scene.objects:
 if o.name.startswith(("Separate working well","Well support","Well crossbeam")):o.location.z+=wellbase
# Low annular footing seats the level ring on the slight terrain gradient.
n=48;verts=[]
for h,r in [(min(height(-522+1.25*math.cos(k*2*math.pi/n),-139+1.25*math.sin(k*2*math.pi/n)) for k in range(n))-0.03,1.25),(wellbase,1.25),(wellbase,0.88)]:
 for k in range(n):
  a=k*2*math.pi/n;verts.append((-6+r*math.cos(a),7+r*math.sin(a),h))
faces=[]
for j in range(2):
 for k in range(n):
  q=(k+1)%n;faces.append((j*n+k,j*n+q,(j+1)*n+q,(j+1)*n+k))
mesh("Well annular terrain footing",verts,faces,stone)
# Canopy2.8m east-west by2m north-south, ridgeN-S, same shared geometry.
a,b,c,d=-7.4,-4.6,6,8;m=-6;base=wellbase+2.7;peak=wellbase+3.35
mesh("Well gabled canopy",[(a,c,base),(b,c,base),(m,c,peak),(a,d,base),(b,d,base),(m,d,peak)],[(0,2,1),(3,4,5),(0,3,5,2),(2,5,4,1),(0,1,4,3)],roof)
benchbase=height(-529.94,-139.375)
for o in scene.objects:
 if o.name.startswith("Bench"):
  o.location.z+=benchbase
  if o.name.startswith("Bench support"):
   # Extend feet a few centimetres into local grade; no floating block.
   local=height(o.location.x-516,o.location.y-146)
   top=benchbase+0.42;o.location.z=(local-0.02+top)/2;o.dimensions.z=top-local+0.02
starth=height(-512,-138);endh=terrain["namedPoints"]["entrance"]["y"]-2
for k in range(20):
 o=bpy.data.objects["Stair tread %02d"%k];top=starth+(endh-starth)*(k+1)/20;bottom=endh-0.3
 o.location.z=(top+bottom)/2;o.dimensions.z=top-bottom
# Retaining walls with terrain-following cap and deep base.
for name,xa,xb in [("West",-514,-513.7),("East",-510.3,-510)]:
 vs=[];zs=[-138+i*0.5 for i in range(21)]
 for z in zs:
  vs += [(xa+516,z+146,endh-0.3),(xb+516,z+146,endh-0.3),(xb+516,z+146,height(xb,z)+0.45),(xa+516,z+146,height(xa,z)+0.45)]
 fs=[]
 for k in range(20):
  p=4*k;q=p+4
  for a,b in [(0,1),(1,2),(2,3),(3,0)]:fs.append((p+a,p+b,q+b,q+a))
 fs.extend([(0,3,2,1),(80,81,82,83)])
 mesh(name+" terrain stair retaining wall",vs,fs,stone)
entrybase=terrain["namedPoints"]["entrance"]["y"]
for o in scene.objects:
 if o.name.startswith(("Opaque separate entrance","Entrance left","Entrance right","Entrance lintel")):o.location.z+=entrybase
 if o.name.startswith("Earth"):
  o.location.z+=entrybase
  if "above" not in o.name:
   bounds=o.get("world_xz_bounds")
   lo=min(height(x,z) for x in cuts(bounds[0],bounds[1],X) for z in cuts(bounds[2],bounds[3],Z))-0.05
   top=entrybase+2.2;o.location.z=(lo+top)/2;o.dimensions.z=top-lo
for letter in ["A","B","C"]:
 cam=bpy.data.objects["Camera "+letter];cam.location.z=terrain["namedPoints"][letter]["y"]+1.7
 # Preserve initial horizontal look direction and65degHFOV; no new framing adjustment.
standins=[("Human",-526,-145,1.75),("Skarn",-528,-145,1.95),("Wickfolk",-531,-142,1.3)]
for name,x,z,tall in standins:
 base=height(x,z);r=tall*0.12
 bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=r,depth=tall-2*r,location=(x+516,z+146,base+tall/2))
 proxy=bpy.context.object;proxy.name=name+" scale capsule";proxy.data.materials.append(dark)
 proxy["world_position_height"]=[x,z,base,tall]
 for h in [base+r,base+tall-r]:
  bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=r,location=(x+516,z+146,h))
  bpy.context.object.name=name+" capsule end";bpy.context.object.data.materials.append(dark)
scene["scale_standins"]="Human(-526,-145)1.75m; Skarn(-528,-145)1.95m; Wickfolk(-531,-142)1.3m; capsules only"
scene["heights"]="Sampled source terrain; eyes1.7m above named source points; foundations localmax+0.12;6mwall9mridge; stairendentranceground-2"
scene["terrain_source"]="188-terrain-samples.json; source2mgrid/bilinear concept proxy, not collisionmesh"
scene.camera=bpy.data.objects["Camera A"]
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"courtyard-layout-v2.blend"))
for name,objname in [("a","Camera A"),("b","Camera B"),("c","Camera C"),("overview","Overview")]:
 scene.camera=bpy.data.objects[objname];scene.render.filepath=str(OUT/("blockout-"+name+"-v2.png"))
 bpy.ops.render.render(write_still=True);print("READY "+scene.render.filepath,flush=True)
(OUT/"blockout-v2-scene.json").write_text(json.dumps({"blender":bpy.app.version_string,"completed_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"terrain_sha256":hashlib.sha256((OUT/"188-terrain-samples.json").read_bytes()).hexdigest(),"house_floor_heights":floors,"stair_top":starth,"stair_bottom":endh,"cameras":{s:{"world_eye_y":bpy.data.objects["Camera "+s].location.z,"hfov_deg":math.degrees(bpy.data.objects["Camera "+s].data.angle_x)} for s in ["A","B","C"]},"note":"Front6markers+1lamp; other3faces2uppermarkers each. Markers are not openings. Far eastern road end clipped1m to supplied sample bound; approved court layout unchanged."},indent=2))
