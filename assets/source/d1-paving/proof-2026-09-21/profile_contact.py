"""Profile-fitted compacted soil collars. Load unchanged family2 source in Blender."""
from pathlib import Path
root=Path(__file__).parent
code=(root/'family-contact2/resolved.py').read_text()
code=code.replace('family-contact2','profile-contact1')
code=code.replace("scene.name = 'Paving screened family contact2'", "scene.name = 'Paving profile fitted contact1'")
anchor='# Real embedded aggregates, varied and partly buried, distributed more densely in joints.'
collar=r'''
# A ring follows actual sidewall intersections. Its upper contact is constrained by
# a second ray onto the local top, not inferred from a nominal stone bounding box.
base_soil_height=soil_height
collar_samples=[]; collar_vertices=[]; collar_faces=[]; contact_clearances=[]
for stone,tree in trees:
    inv=stone.matrix_world.inverted(); centre=stone.matrix_world.translation
    for j in range(768):
        angle=math.tau*j/768
        outward=Vector((math.cos(angle),math.sin(angle),0))
        xy=np.array([[centre.x+.2*outward.x,centre.y+.2*outward.y]])
        z=.072 + .004*(float(field(xy,19,138)[0])-.5)
        point=None; top_z=None
        for iteration in range(4):
            origin=Vector((centre.x,centre.y,z))+outward
            direction=(inv.to_3x3()@(-outward)).normalized()
            hit=tree.ray_cast(inv@origin,direction,1.2)[0]
            if hit is None: break
            point=stone.matrix_world@hit
            probe=point-outward*.002
            top=tree.ray_cast(inv@Vector((probe.x,probe.y,.3)),Vector((0,0,-1)),.5)[0]
            if top is None: break
            top_z=(stone.matrix_world@top).z
            z=min(z,top_z-.005)
        assert point is not None and top_z is not None
        # Recompute at final height, so the collar does not preserve an earlier hit.
        origin=Vector((centre.x,centre.y,z))+outward
        point=stone.matrix_world@tree.ray_cast(inv@origin,(inv.to_3x3()@(-outward)).normalized(),1.2)[0]
        width=.011+.012*float(field(np.array([[point.x,point.y]]),36,813)[0])
        start=len(collar_vertices)
        for k in range(6):
            t=k/5
            pos=point+outward*(-.0007+(width+.0007)*t)
            base=float(base_soil_height(np.array([[pos.x,pos.y]]))[0])
            h=base+(z-base)*(1-t)**1.35
            collar_vertices.append((pos.x,pos.y,h))
        collar_samples.append((point.x,point.y,z,width))
        contact_clearances.append(top_z-z)
    ring_start=len(collar_vertices)-768*6
    for j in range(768):
        for k in range(5):
            a=ring_start+j*6+k; b=ring_start+((j+1)%768)*6+k
            collar_faces.append((a,b,b+1,a+1))
collar=mesh('Profile fitted packed earth',collar_vertices,collar_faces,mat)
for polygon in collar.data.polygons: polygon.use_smooth=True
collar_tree=KDTree(len(collar_samples))
for i,p in enumerate(collar_samples): collar_tree.insert((p[0],p[1],0),i)
collar_tree.balance()
def soil_height(p):
    result=base_soil_height(p)
    for k,(x,y) in enumerate(p):
        _,i,d=collar_tree.find((x,y,0)); sample=collar_samples[i]
        if d<sample[3]:
            result[k]=max(result[k],result[k]+(sample[2]-result[k])*(1-d/sample[3])**1.35)
    return result
(OUT/'profile-metrics.json').write_text(json.dumps({
    'profileSamples':len(collar_samples),'collarTriangles':len(collar_faces)*2,
    'nominalTopClearanceM':.005,'sampledTopClearanceMinimumM':min(contact_clearances),
    'contactHeightMinM':min(p[2] for p in collar_samples),
    'contactHeightMaxM':max(p[2] for p in collar_samples),
    'method':'horizontal sidewall ray, local inward top probe, outer blend to existing soil',
    'limitations':'Sampled collar construction is not a watertight collision proof.'
},indent=2)+'\n')
'''
assert anchor in code
code=code.replace(anchor,collar+'\n'+anchor)
out=root/'profile-contact1';out.mkdir(exist_ok=True)
(out/'resolved.py').write_text(code)
exec(compile(code,str(out/'resolved.py'),'exec'))
