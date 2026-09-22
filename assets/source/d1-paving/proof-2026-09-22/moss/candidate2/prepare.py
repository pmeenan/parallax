"""Derive final bounded refinement from retained first-candidate construction."""
from pathlib import Path
P=Path(__file__).parent
s=(P.parent/'candidate1/build.py').read_text()
s=s.replace('random.Random(922801)','random.Random(922802)').replace("'seed':922801","'seed':922802")
s=s.replace('len(roots)<390','len(roots)<260')
s=s.replace("if rng.random()<.12:continue", "fringe=max(0,1-rad/r)\n        if rng.random()>(.16+.84*fringe**.45):continue")
s=s.replace("height=rng.uniform(.002,.0043)","height=rng.uniform(.002,.0043)*(.48+.52*fringe**.35)")
a=s.index('            length=rng.uniform(');b=s.index('        if any(blocked',a)
s=s[:a]+'''            length=rng.uniform(.00065,.00105)*(1-.25*t);width=length*rng.uniform(.105,.16);q=len(local)
            # Three narrow cross sections with smoothly changing rise and curled tip.
            local.append(origin);tints.append(base*.72)
            curl=rng.uniform(.35,.75)
            for section in [.28,.57,.82]:
                mid=origin+direction*(length*section)+Vector((0,0,length*(.35*section+curl*section*section)))
                half=width*math.sin(math.pi*section)**.8
                ridge=mid+Vector((0,0,.000035*math.sin(math.pi*section)))
                local.extend([mid-side*half,ridge,mid+side*half]);tints.extend([base,base*1.07,base*.96])
            local.append(origin+direction*(length*.94)+Vector((0,0,length*(.35+curl))))
            tints.append(base*1.10)
            polys.extend([(q,q+1,q+2),(q,q+2,q+3)])
            for row in range(2):
                a=q+1+row*3;b=a+3
                polys.extend([(a,b,b+1),(a,b+1,a+1),(a+1,b+1,b+2),(a+1,b+2,a+2)])
            polys.extend([(q+7,q+10,q+8),(q+8,q+10,q+9)])
''' + s[b:]
s=s.replace("cs=(camera.location.copy(),camera.rotation_euler.copy(),camera.data.lens);ls=", "cs=(camera.location.copy(),camera.rotation_euler.copy(),camera.data.lens);oldclip=camera.data.clip_start;camera.data.clip_start=.001;ls=")
s=s.replace('camera.location,camera.rotation_euler,camera.data.lens=cs;light.location','camera.location,camera.rotation_euler,camera.data.lens=cs;camera.data.clip_start=oldclip;light.location')
s=s.replace("'views':views,'sourceOnly'", "'views':views,'closeCaptureNearClipM':.001,'sourceCameraNearClipM':oldclip,'sourceOnly'")
(P/'build.py').write_text(s)
