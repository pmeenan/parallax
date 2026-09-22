"""Resolve final plant-only revision, retaining first candidate and approved patch."""
from pathlib import Path
OUT=Path(__file__).parent
s=(OUT.parent/'candidate1/build.py').read_text().replace('922601','922602')
s=s.replace("if data.ndim==2:data=np.repeat(data[:,:,None],3,axis=2)","if data.ndim==2:data=np.repeat(data[:,:,None],3,axis=2)\n    if space=='sRGB':data=np.where(data<=.0031308,data*12.92,1.055*np.maximum(data,0)**(1/2.4)-.055)")
s=s.replace("scene.render.image_settings.color_depth='16';im.save();im.pack();maps[name]=im;return im", "scene.render.image_settings.color_depth='16';im.save()\n    file=im.filepath_raw;bpy.data.images.remove(im);im=bpy.data.images.load(file,check_existing=False);im.name=name;im.colorspace_settings.name=space;im.pack();maps[name]=im;return im")
start=s.index('def tubes(');end=s.index('anchors=sorted(',start)
s=s[:start]+'''def tubes(name,segments):
    verts=[];faces=[]
    for a,b,r in segments:
        # Smooth curved taper, five rings. Lateral travel accelerates above the joint crown.
        delta=b-a;start=len(verts)
        for ring in range(5):
            t=ring/4;p=a+Vector((delta.x*t*t,delta.y*t*t,delta.z*t));axis=Vector((delta.x*max(.05,2*t),delta.y*max(.05,2*t),delta.z)).normalized();side=axis.cross(Vector((0,0,1)))
            if side.length<.001:side=axis.cross(Vector((1,0,0)))
            side.normalize();other=axis.cross(side);radius=r*(1-.45*t)
            for k in range(5):verts.append(tuple(p+radius*(math.cos(k*math.tau/5)*side+math.sin(k*math.tau/5)*other)))
        for ring in range(4):
            for k in range(5):faces.append((start+ring*5+k,start+ring*5+(k+1)%5,start+(ring+1)*5+(k+1)%5,start+(ring+1)*5+k))
    return mesh(name,verts,faces,stemmat)
def weed(name,x,y,seedling=False):
    root=Vector((x,y,soil_z(x,y)-.003));crown=Vector((x,y,.084));segments=[(root,crown,.00065 if seedling else .0012)]
    verts=[];faces=[];uv=[];num=2 if seedling else 4;phase=rng.uniform(0,math.tau)
    for j in range(num):
        angle=phase+(j*math.pi+rng.uniform(-.15,.15) if seedling else [0,1.45,3.30,4.95][j]+rng.uniform(-.13,.13));direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0))
        length=rng.uniform(.009,.014) if seedling else rng.uniform(.031,.051);width=length*rng.uniform(.64,.78) if seedling else length*rng.uniform(.55,.69)
        rise=rng.uniform(.001,.003) if seedling else rng.uniform(.001,.007);curl=rng.uniform(.001,.004)
        base=crown+direction*rng.uniform(.002,.006)+Vector((0,0,.004 if seedling else .007));segments.append((crown,base,.00040 if seedling else .00065))
        rows=10 if seedling else 18;cols=5 if seedling else 7;start=len(verts);twist=rng.uniform(-.0015,.0015)
        verts.append(tuple(base));uv.append((.5,0))
        for k in range(1,rows):
            t=k/rows;mid=base+direction*length*t+side*(.002*math.sin(math.pi*t))+Vector((0,0,rise*t+.0035*math.sin(math.pi*t)-curl*t**3))
            half=width*.5*math.sin(math.pi*t)**.50*(.88+.12*t)
            for q in np.linspace(-1,1,cols):
                irregular=1+.018*math.sin(t*17+j*2)+(0.04 if q<0 else -.02)
                point=mid+side*(q*half*irregular)+Vector((0,0,(q*q)*.0022*math.sin(math.pi*t)+q*twist*math.sin(t*math.pi)))
                verts.append(tuple(point));uv.append(((q+1)/2,t))
        end=len(verts);verts.append(tuple(base+direction*length+Vector((0,0,rise-curl))));uv.append((.5,1))
        for q in range(cols-1):faces.append((start,start+1+q,start+2+q))
        for k in range(rows-2):
            for q in range(cols-1):faces.append((start+1+k*cols+q,start+1+(k+1)*cols+q,start+2+(k+1)*cols+q,start+2+k*cols+q))
        for q in range(cols-1):faces.append((end-cols+q,end,end-cols+q+1))
    ob=mesh(name,verts,faces,leafmat,uv);tubes(name+' petioles',segments);records.append({'name':name,'type':'seedling' if seedling else 'broadleaf','root':list(root),'crown':list(crown)})
    return ob
''' +s[end:]
start=s.index('for i in range(5):\n    x,y=nearby');end=s.index('after={',start)
s=s[:start]+'''drymat=flatmat('Subdued old grass blade',(.085,.065,.025));grasslight=flatmat('Fresh grass blade',(.038,.073,.013))
for i in range(5):
    x,y=nearby(anchors[[0,1,1,4,7][i]],.20);z=soil_z(x,y)-.002;verts=[];faces=[];material_ids=[]
    for j in range(7):
        angle=rng.uniform(0,math.tau);direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0));height=rng.uniform(.018,.040);reach=rng.uniform(.020,.037);width=rng.uniform(.0013,.0025);start=len(verts);twist=rng.uniform(-1,1)
        for k in range(8):
            t=k/8;mid=Vector((x,y,z))+direction*(reach*t*t)+Vector((0,0,height*math.sin(t*math.pi*.68)));blade_side=side*math.cos(twist*t)+Vector((0,0,1))*math.sin(twist*t)
            for sign in [-1,1]:verts.append(tuple(mid+blade_side*(sign*width*(1-t)**.8*.5)))
        tip=len(verts);verts.append(tuple(Vector((x,y,z))+direction*reach+Vector((0,0,height*math.sin(math.pi*.68)))))
        for k in range(7):faces.append((start+k*2,start+k*2+1,start+k*2+3,start+k*2+2));material_ids.append(1 if j==0 else j%3)
        faces.append((tip-2,tip-1,tip));material_ids.append(1 if j==0 else j%3)
    ob=mesh('Bowed uneven grass '+str(i),verts,faces,grassmat);ob.data.materials.append(drymat);ob.data.materials.append(grasslight)
    for p,m in zip(ob.data.polygons,material_ids):p.material_index=m
    records.append({'name':ob.name,'type':'grass','root':[x,y,z]})
# Fine original moss color/normal maps on connected low organic cushions; no ico pellets.
fine_moss=(np.sin(u*213+np.sin(v*103)*3)*np.sin(v*319+np.sin(u*137)*2)+np.sin(u*457-v*293))*.25+.5
mh=.00010*fine_moss+.00004*np.sin(u*79+v*31)**2
mcolor=np.stack([.016+.010*fine_moss,.029+.024*fine_moss,.004+.006*fine_moss],axis=-1)
mdy,mdx=np.gradient(mh,.055/(S-1),.008/(S-1));mn=np.stack([-mdx,-mdy,np.ones_like(mdx)],axis=-1);mn/=np.linalg.norm(mn,axis=-1)[...,None]
mc=image('moss-basecolor',mcolor,'sRGB');mi=image('moss-normal',mn*.5+.5,'Non-Color');image('moss-height',mh/.0002,'Non-Color')
nodes,links=mossmat.node_tree.nodes,mossmat.node_tree.links;mb=nodes['Principled BSDF'];mb.inputs['Roughness'].default_value=.97
tn=nodes.new('ShaderNodeTexImage');tn.image=mc;links.new(tn.outputs['Color'],mb.inputs['Base Color']);tn=nodes.new('ShaderNodeTexImage');tn.image=mi;nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.45;links.new(tn.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs[0],mb.inputs['Normal'])
for i in range(4):
    x,y=nearby(anchors[[0,1,4,7][i]],.11,.004)
    # Orient cushion along the closest stone edge and keep its boundary seated in soil.
    distances=[]
    for a in rects:distances.extend([(abs(x-a[0]),0),(abs(x-a[2]),0),(abs(y-a[1]),1),(abs(y-a[3]),1)])
    axis=min(distances)[1];along=Vector((0,1,0)) if axis==0 else Vector((1,0,0));across=Vector((1,0,0)) if axis==0 else Vector((0,1,0))
    verts=[];uv=[];faces=[];allowed=[];length=rng.uniform(.040,.065)
    for row in range(19):
        t=row/18;half=.0035*(.65+.35*math.sin(t*17+i))
        for col in range(7):
            q=col/3-1;p=Vector((x,y,0))+along*((t-.5)*length)+across*(q*half);free=not stone_at(p.x,p.y,.0003);height=.0010*max(0,1-q*q)*math.sin(math.pi*t)**.5
            z=soil_z(p.x,p.y)+height-.00025;verts.append((p.x,p.y,z));uv.append((col/6,t));allowed.append(free)
    for row in range(18):
        for col in range(6):
            quad=(row*7+col,row*7+col+1,(row+1)*7+col+1,(row+1)*7+col)
            if all(allowed[k] for k in quad):faces.append(quad)
    mesh('Low connected moss cushion '+str(i),verts,faces,mossmat,uv);records.append({'name':'Low connected moss cushion '+str(i),'type':'moss','root':[x,y,soil_z(x,y)]})
''' +s[end:]
s=s.replace("for mode in ['gray','unlit']:","for mode in ['gray','geometry','unlit']:")
s=s.replace("if mode=='gray':", "if mode in ['gray','geometry']:")
s=s.replace("bs.inputs['Base Color'].default_value=(.18,.18,.18,1)","bs.inputs['Base Color'].default_value=(.18,.18,.18,1)\n            if mode=='geometry':\n                for link in list(bs.inputs['Normal'].links):l.remove(link)")
s=s.replace("('close-unlit','unlit',eye,target,60,False)","('close-unlit','unlit',eye,target,60,False),('close-geometry','geometry',eye,target,60,False)")
s=s.replace("('walking','full',Vector((.15,-1.7,1.7)),Vector((.05,.15,.065)),42,False)","('walking','full',Vector((anchors[0][0]+.1,anchors[0][1]-.55,1.05)),Vector((anchors[0][0],anchors[0][1]+.12,.065)),50,False)")
s=s.replace("'basecolor':'sRGB image from authored linear color, no scene shading'", "'basecolor':'Linear authored colors explicitly sRGB encoded toPNG, then file reloaded/packed; native uses delivered file, no scene shading'")
s=s.replace("'productionGrass4PixelMapCeilingPassed':False", "'productionGrass4PixelMapCeilingPassed':False,'triangleExcessReason':'Final source study spends additional leaf contour/curved petiole and moss cushion triangles to address first-cycle shape failures; no production budget change'")
(OUT/'build.py').write_text(s)
