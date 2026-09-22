"""Resolve final-cycle authoring script from retained candidate1, without editing it."""
from pathlib import Path
OUT=Path(__file__).parent
s=(OUT.parent/'candidate1/build.py').read_text()
s=s.replace('candidate1','candidate2').replace('STEP=.14','STEP=1/7').replace('random.Random(922407)','random.Random(922408)')
s=s.replace('attempts>200000','attempts>2500')
s=s.replace('if rng.random()<.58:','if rng.random()<.12:')
s=s.replace('assert tile() and len(tiles)<=190', '''def seam_score(candidate):
    owners=np.zeros((N,N),dtype=int)
    for i,(_,x,y,w,h) in enumerate(candidate):owners[y:y+h,x:x+w]=i+1
    runs=[]
    for boundary in [owners[:,:-1]!=owners[:,1:],(owners[:-1,:]!=owners[1:,:]).T]:
        for col in boundary.T:
            run=0
            for value in list(col)+[False]:
                if value:run+=1
                elif run:runs.append(run);run=0
    return sum(max(0,r-5)**3 for r in runs),max(runs)
best=None
for trial in range(80):
    occupied[:]=False;tiles=[];attempts=0
    try: success=tile()
    except RuntimeError:success=False
    if not success:continue
    score=seam_score(tiles)
    if best is None or score<best[0]:best=(score,tiles.copy())
assert best is not None
layout_seam_score,tiles=best
assert len(tiles)<=190''')
s=s.replace("gap=rng.uniform(.010,.014)","gap=rng.uniform(.010,.012)")
s=s.replace("ob.rotation_euler=(0,0,angle);ob.scale=(sx,sy,1)",'''sx=min(sx,1.08);sy=min(sy,1.08)
    # Adjacent same-family placements alternate their 180-degree landmark orientation.
    neighbors=[item for item in layout if item['family']==label and abs(item['grid'][0]-gx)<=4 and abs(item['grid'][1]-gy)<=4]
    if neighbors:
        previous=neighbors[-1]['rotationZRadians']
        if math.cos(angle-previous)>.5:angle+=math.pi
    ob.rotation_euler=(0,0,angle);ob.scale=(sx,sy,1)''')
start=s.index('xx,yy=np.meshgrid(');end=s.index('def stone_at(',start)
s=s[:start]+'''# One welded adaptive triangulation: no separate overlaid bank geometry.
from mathutils.geometry import delaunay_2d_cdt
xx,yy=np.meshgrid(np.linspace(-2.1,2.1,45),np.linspace(-2.1,2.1,45));points=list(zip(xx.ravel(),yy.ravel()))
for a in rects:
    for expansion in [-.004,.004,.012,.025]:
        bounds=[a[0]-expansion,a[1]-expansion,a[2]+expansion,a[3]+expansion]
        corners=np.array([[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]]])
        for k in range(4):
            u,w=corners[k],corners[(k+1)%4]
            for t in np.linspace(0,1,max(2,int(np.linalg.norm(w-u)/.024)+1)):points.append(tuple(u*(1-t)+w*t))
for radius in [2.3,2.6,30]:
    for t in np.linspace(-radius,radius,17 if radius<3 else 2):points.extend([(t,-radius),(t,radius),(-radius,t),(radius,t)])
cdt=delaunay_2d_cdt([Vector(p) for p in points],[],[],0,1e-6)
p=np.array([q[:] for q in cdt[0]]);z=soil_height(p);blend=np.clip((np.max(np.abs(p),axis=1)-2.1)/.5,0,1);z=z*(1-blend)+.059*blend
soil=mesh('Continuous adaptive compacted earth',np.column_stack((p,z)).tolist(),cdt[2],earth)
''' +s[end:]
s=s.replace('>=100:','>=2500:').replace('range(30000)','range(200000)')
s=s.replace("r=rng.uniform(.0015,.004)","r=rng.choices([.0015,.0025,.004,.006],weights=[.30,.45,.22,.03])[0]*rng.uniform(.7,1.3)")
s=s.replace("grit=mesh('Sparse embedded aggregate',verts,faces,gritmat)",'''grit=mesh('Sparse embedded aggregate',verts,faces,gritmat)
for color in [(.065,.043,.018),(.09,.075,.042),(.17,.135,.075)]:
    gm=gritmat.copy();gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*color,1);grit.data.materials.append(gm)
for poly in grit.data.polygons:poly.material_index=(poly.index//20)%4''')
start=s.index('# Broadleaf geometry:');end=s.index('counts={',start)
s=s[:start]+'''# Rounded ovate blades with a cupped midrib, raised crown and seated roots.
leafmat=bpy.data.materials.new('Muted living broadleaf');leafmat.use_nodes=True;n,l=leafmat.node_tree.nodes,leafmat.node_tree.links;bs=n['Principled BSDF'];bs.inputs['Roughness'].default_value=.78
coord=n.new('ShaderNodeTexCoord');tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=160;tex.inputs['Detail'].default_value=2;l.new(coord.outputs['Object'],tex.inputs['Vector'])
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.014,.033,.003,1);ramp.color_ramp.elements[1].color=(.06,.105,.010,1);l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],bs.inputs['Base Color'])
stemmat=bpy.data.materials.new('Short green brown stems');stemmat.use_nodes=True;stemmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.055,.07,.008,1);stemmat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.85
veinmat=stemmat.copy();veinmat.name='Subtle living midrib';veinmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.07,.105,.018,1)
roots=[]
for trial in range(200000):
    if len(roots)>=8:break
    x,y=rng.uniform(-1.7,1.7),rng.uniform(-1.7,1.7)
    if stone_at(x,y,.005) or any(math.hypot(x-a,y-b)<.6 for a,b,z in roots):continue
    z=float(soil_height(np.array([[x,y]]))[0])-.004;roots.append([x,y,z])
lv=[];lf=[];sv=[];sf=[];vv=[];vf=[]
def stem(a,b,r=.001):
    axis=(b-a).normalized();u=axis.cross(Vector((0,0,1)))
    if u.length<.01:u=axis.cross(Vector((1,0,0)))
    u.normalize();w=axis.cross(u);start=len(sv)
    for p in [a,b]:
        for k in range(5):sv.append(tuple(p+r*(math.cos(k*math.tau/5)*u+math.sin(k*math.tau/5)*w)))
    for k in range(5):sf.append((start+k,start+(k+1)%5,start+5+(k+1)%5,start+5+k))
for root_values in roots:
    root=Vector(root_values);crown=root.copy();crown.z=.088
    stem(root,crown,.002)
    for j in range(6):
        angle=rng.uniform(0,math.tau);direction=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-math.sin(angle),math.cos(angle),0))
        length=rng.uniform(.027,.061);width=length*rng.uniform(.53,.70);rise=rng.uniform(.002,.033)
        base=crown+direction*rng.uniform(.004,.016)+Vector((0,0,rng.uniform(.001,.011)));stem(crown,base,rng.uniform(.0007,.0011))
        def center(t):return base+direction*(length*t)+side*(.003*math.sin(math.pi*t))+Vector((0,0,rise*t+.005*math.sin(math.pi*t)))
        start=len(lv);lv.append(tuple(center(0)))
        for k in range(1,10):
            t=k/10;mid=center(t);half=width*math.sqrt(1-(2*t-1)**2)*.5
            for q in [-1,0,1]:lv.append(tuple(mid+side*(q*half*(1.08 if q<0 else .92))+Vector((0,0,abs(q)*.0025*math.sin(math.pi*t)))))
        tip=len(lv);lv.append(tuple(center(1)))
        lf.extend([(start,start+1,start+2),(start,start+2,start+3)])
        for k in range(8):
            for q in range(2):lf.append((start+1+k*3+q,start+1+(k+1)*3+q,start+1+(k+1)*3+q+1,start+1+k*3+q+1))
        lf.extend([(tip-3,tip,tip-2),(tip-2,tip,tip-1)])
        # A narrow raised, gently curved vein follows the blade; no painted line or generated image.
        vstart=len(vv)
        for t in np.linspace(.04,.95,6):
            mid=center(float(t))+Vector((0,0,.00022));half=.0003*(1-.6*t)
            vv.extend([tuple(mid-side*half),tuple(mid+side*half)])
        for k in range(5):vf.append((vstart+k*2,vstart+k*2+1,vstart+k*2+3,vstart+k*2+2))
leaves=mesh('Rounded cupped asymmetric leaves',lv,lf,leafmat);stems=mesh('Rooted crowns and petioles',sv,sf,stemmat);veins=mesh('Readable curved midribs',vv,vf,veinmat)
plant_vertex_conflicts=[]
for ob in [leaves,stems,veins]:
    for i,v in enumerate(ob.data.vertices):
        x,y,z=v.co
        if z<.084 and stone_at(x,y,.001):plant_vertex_conflicts.append([ob.name,i])
assert not plant_vertex_conflicts
''' +s[end:]
s=s.replace("plant_tris=counts[leaves.name]+counts[stems.name]","plant_tris=counts[leaves.name]+counts[stems.name]+counts[veins.name]")
s=s.replace("(3.5,-4.4,4.7)","(4.4,-5.5,5.7)")
s=s.replace("(0,0,6.7)","(0,0,8.7)")
s=s.replace("(.23,-.30,.23)","(.20,-.22,.34)")
s=s.replace("'seed':922407","'seed':922408,'layoutSeamScore':layout_seam_score,'layoutCandidatesScored':80")
s=s.replace("'49x49 base grid plus explicit10mm local edge ribbons at conservative stone AABB edges; high-frequency geometric soil detail approximated, exact shader retained'","'One welded adaptive Delaunay mesh with dense perimeter-neighborhood samples, same64mm/+2mm height formula and exact shader; conservative rectangle distance approximates actual chipped boundary. Source-only ground triangle excess restores contact continuity.'")
s=s.replace("'stoneFieldDimensionsM':[3.92,3.92]","'stoneFieldDimensionsM':[4,4]")
s=s.replace("'rootDepthBelowLocalSoilM':.005","'rootDepthBelowLocalSoilM':.004,'plantVerticesConflictingWithConservativeStoneAtZBelow84mm':plant_vertex_conflicts,'actualXYScaleRange':[min(v for a in layout for v in a['scaleXYZ'][:2]),max(v for a in layout for v in a['scaleXYZ'][:2])],'aggregateCount':len(aggregate_positions)")
s=s.replace("'Coarse soil geometry and rectangle-local banks approximate prior dense contact recipe'","'Adaptive soil uses conservative rectangle proximity; original dense soil topology not copied'")
(OUT/'build.py').write_text(s)

