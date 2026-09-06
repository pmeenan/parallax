import bpy, math, random
from mathutils import Vector

def build_stone(width,length,seed,target):
    scene=bpy.context.scene
    # Irregular fractured outline, broad rectangular character without rounded waves.
    outline=[(-.195,-.137),(-.131,-.148),(-.052,-.143),(.044,-.149),(.139,-.14),(.182,-.115),(.193,-.055),(.186,.029),(.194,.097),(.161,.135),(.094,.141),(.009,.132),(-.074,.14),(-.149,.127),(-.186,.108),(-.198,.038),(-.188,-.048)]
    
    rng=random.Random(seed)
    outline=[(x+rng.uniform(-.002,.002),y+rng.uniform(-.002,.002)) for x,y in outline]
    def polygon_distance(x,y,poly):
        distance=1;inside=False;nearest=0
        for j,((ax,ay),(bx,by)) in enumerate(zip(poly,poly[1:]+poly[:1])):
            if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:inside=not inside
            dx,dy=bx-ax,by-ay;t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
            d=math.hypot(x-ax-t*dx,y-ay-t*dy)
            if d<distance:distance=d;nearest=j
        return distance if inside else -distance,nearest
    
    # Shape patches have independent polygon boundaries and tilted floors. Their
    # placement is authored, sparse and asymmetrical, leaving most of the face worn.
    patches=[([(-.142,-.098),(-.103,-.109),(-.079,-.091),(-.094,-.065),(-.124,-.067),(-.15,-.08)],.0042,.006),
             ([(.068,.047),(.099,.027),(.139,.038),(.153,.067),(.128,.088),(.094,.079)],.0030,.008),
             ([(-.026,-.039),(.009,-.048),(.035,-.028),(.026,-.006),(-.004,.003),(-.028,-.013)],.0018,.010),
             ([(-.197,.057),(-.154,.063),(-.141,.088),(-.158,.113),(-.192,.107)],.006,.006)]
    shoulder_width=[.009,.004,.013,.006,.019,.003,.011,.006,.015,.003,.008,.014,.005,.017,.006,.010,.004]
    edge_drop=[.005,.003,.007,.002,.010,.003,.004,.003,.008,.002,.006,.009,.004,.007,.003,.004,.002]
    
    shift_x=rng.uniform(-.012,.012);shift_y=rng.uniform(-.01,.01)
    patches=[([(x+shift_x,y+shift_y) for x,y in poly],depth*rng.uniform(.75,1.2),ramp) for poly,depth,ramp in patches]
    shoulder_width=[v*rng.uniform(.65,1.35) for v in shoulder_width]
    edge_drop=[v*rng.uniform(.7,1.25) for v in edge_drop]
    def height(x,y):
        distance,j=polygon_distance(x,y,outline)
        z=.073+.004*x-.002*y
        # Broad calm wear sag, not a center mound.
        z-=.0008*max(0,1-(x/.2)**2-(y/.15)**2)
        ax,ay=outline[j];bx,by=outline[(j+1)%len(outline)]
        segment_t=max(0,min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)))
        blend=.5-.5*math.cos(segment_t*math.pi)
        w=shoulder_width[j]*(1-blend)+shoulder_width[(j+1)%len(outline)]*blend
        drop=edge_drop[j]*(1-blend)+edge_drop[(j+1)%len(outline)]*blend
        t=max(0,1-distance/w);z-=drop*t*t
        for poly,depth,ramp in patches:
            d,_=polygon_distance(x,y,poly)
            if d>0:
                blend=min(1,d/(ramp*1.25));blend=blend*blend*(3-2*blend)
                z-=depth*blend
        return z
    
    # Dense radial study is decimated to the stone budget. Boundary corners and
    # shallow polygonal fractures survive more naturally than a uniform coarse grid.
    segments=136;rings=36
    def border(theta):
        dx,dy=math.cos(theta),math.sin(theta);best=10
        for (ax,ay),(bx,by) in zip(outline,outline[1:]+outline[:1]):
            ex,ey=bx-ax,by-ay;det=dx*(-ey)-(-ex)*dy
            if abs(det)<1e-10:continue
            t=(ax*(-ey)+ex*ay)/det;s=(dx*ay-dy*ax)/det
            if t>0 and 0<=s<=1:best=min(best,t)
        return (dx*best,dy*best)
    vertices=[(0,0,height(0,0))];faces=[]
    for ring in range(1,rings+1):
        radius=ring/rings
        for j in range(segments):
            x,y=border(math.tau*j/segments);x*=radius;y*=radius;vertices.append((x,y,height(x,y)))
        start=1+(ring-1)*segments
        for j in range(segments):
            k=(j+1)%segments
            if ring==1:faces.append((0,start+j,start+k))
            else:
                prev=start-segments;faces.extend(((prev+j,start+j,start+k),(prev+j,start+k,prev+k)))
    last=1+(rings-1)*segments;bottom=len(vertices)
    for j in range(segments):
        x,y,_=vertices[last+j];vertices.append((x*.99,y*.99,0))
    for j in range(segments):
        k=(j+1)%segments;faces.extend(((last+j,bottom+j,bottom+k),(last+j,bottom+k,last+k)))
    center=len(vertices);vertices.append((0,0,0))
    for j in range(segments):faces.append((center,bottom+(j+1)%segments,bottom+j))
    mesh=bpy.data.meshes.new('original-fractured-limestone');mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new('hero-limestone',mesh);scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    mod=obj.modifiers.new('budgeted-planar-preservation','DECIMATE');mod.ratio=target/len(faces);bpy.ops.object.modifier_apply(modifier=mod.name)
    # Smooth only shallow changes; actual fractured ridges keep their angular normals.
    for face in obj.data.polygons:face.use_smooth=True
    obj.data.set_sharp_from_angle(angle=1.1)
    
    mesh=obj.data
    scale_x=width/.392;scale_y=length/.29
    for vertex in mesh.vertices:
        vertex.co.x*=scale_x;vertex.co.y*=scale_y
    mesh.update()
    bpy.data.objects.remove(obj,do_unlink=True)
    mesh.use_fake_user=True
    return mesh

