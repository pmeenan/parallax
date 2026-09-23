"""Export mip inputs from retained atlas images into ignored measurement storage."""
import bpy, json, hashlib, sys
import numpy as np
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:]; source=Path(args[0]).resolve(); out=Path(args[1]).resolve()
assert not out.exists(); out.mkdir(parents=True)
bpy.ops.wm.open_mainfile(filepath=str(source/'shared.blend'))
records=[]
for mat in sorted([m for m in bpy.data.materials if m.name.startswith('delivery-')],key=lambda m:m.name):
    for node in mat.node_tree.nodes:
        if node.type!='TEX_IMAGE': continue
        im=node.image; width=im.size[0]; arr=np.array(im.pixels[:],np.float32).reshape(width,width,4)
        record={'name':im.name,'levels':[]}
        for level in range(width.bit_length()):
            rgba=np.rint(np.clip(arr,0,1)*255).astype(np.uint8).tobytes()
            file=f'{im.name}-{level}.rgba'; (out/file).write_bytes(rgba)
            record['levels'].append({'width':len(arr),'file':file,'sha256':hashlib.sha256(rgba).hexdigest()})
            if len(arr)==1: break
            if im.name.endswith('basecolor'):
                rgb=arr[:,:,:3]; arr[:,:,:3]=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
            n=len(arr)//2; arr=arr.reshape(n,2,n,2,4).mean(axis=(1,3))
            if im.name.endswith('basecolor'):
                rgb=arr[:,:,:3]; arr[:,:,:3]=np.where(rgb<=.0031308,rgb*12.92,1.055*np.maximum(rgb,0)**(1/2.4)-.055)
            elif im.name.endswith('normal'):
                vec=arr[:,:,:3]*2-1; vec/=np.maximum(np.linalg.norm(vec,axis=2,keepdims=True),1e-8); arr[:,:,:3]=vec*.5+.5
        records.append(record)
(out/'mips.json').write_text(json.dumps(records,indent=2)+'\n')
