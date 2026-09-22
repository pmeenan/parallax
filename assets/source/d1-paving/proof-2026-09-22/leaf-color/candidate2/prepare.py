"""Final color-only cycle; preserve corrected first-cycle delivery representation."""
from pathlib import Path
OUT=Path(__file__).parent
s=(OUT.parent/'candidate1/build.py').read_text().replace('922701','922702')
s=s.replace("factor=.83+.33*field;factor=factor*(1-main*.65)+main*.65",'''# Soft chlorophyll pockets lie between secondary veins; varied broad regions, not speckles.
pockets=np.zeros_like(u)
for side in [-1,1]:
    d=side*(u-.5)
    for k,level in enumerate([.17,.30,.43,.57,.69,.80]):
        center_u=.5+side*(.24+.045*math.sin(k*2.1+side));center_v=level+.09
        local_v=v-center_v-.20*(np.abs(u-.5)-.25)
        patch=np.exp(-((u-center_u)/(.15+.025*math.sin(k)))**2-(local_v/(.038+.009*math.cos(k*1.7)))**2)
        pockets+=patch*([-.32,.16,-.24,.12,-.30,.14][(k+(side>0))%6])
factor=np.clip(.78+.40*field+pockets,.60,1.30);factor=factor*(1-main*.40)+main*.40''')
s=s.replace("linear[:,:,0]*=1+.045*(field-.5);linear[:,:,2]*=1-.08*(field-.5)","linear[:,:,0]*=1+.11*(field-.5)-.10*pockets;linear[:,:,2]*=1-.14*(field-.5)+.08*pockets")
s=s.replace("worn=not seedling and len(records)%7==2;blemish=not seedling and len(records)%9==5", "worn=not seedling and not young and (i==2 or len(records)%6==1);blemish=not seedling and len(records)%11==5")
s=s.replace("edge=max(0,(abs(x-.5)*2-.63)/.37)*(.4+.6*y);value*=np.array([1+.16*edge,1+.02*edge,1-.12*edge])", "edge=max(0,(x-.66)/.34)*math.exp(-((y-.64)/.24)**2);value*=np.array([1+.85*edge,1+.12*edge,1-.32*edge])")
s=s.replace("'First color-only candidate, no shape/relief/roughness edits'", "'Second final color-only candidate, no shape/relief/roughness edits'")
s=s.replace("'Authored map explicitly sRGB encoded/reloaded; per-leaf LeafAgeTint FLOAT_COLOR corner attribute multiplied by basecolor and1.6 common material gain'", "'Authored map explicitly sRGB encoded/reloaded with1.6 common image gain; per-leaf LeafAgeTint FLOAT_COLOR corner attribute divided by1.6; explicit COLOR_0 export preserves exact native product'")
(OUT/'build.py').write_text(s)
(OUT/'transfer.py').write_text((OUT.parent/'candidate1/transfer.py').read_text())
