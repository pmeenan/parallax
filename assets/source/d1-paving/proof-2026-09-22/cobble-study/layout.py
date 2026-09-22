"""Bounded local retiling of small paving stones, with unchanged source dimensions."""
import json, random, math, time
from pathlib import Path
import numpy as np

ROOT=Path(__file__).parent
RNG=random.Random(922931)
N=28
SHAPES=[(2,2),(3,2),(2,3),(4,2),(2,4)]

def audit(tiles):
    owner=np.full((N,N),-1,dtype=np.int32)
    for i,(x,y,w,h) in enumerate(tiles):
        assert np.all(owner[y:y+h,x:x+w]==-1)
        owner[y:y+h,x:x+w]=i
    assert np.all(owner>=0)
    runs=[]
    for mask in [owner[:,:-1]!=owner[:,1:],(owner[:-1,:]!=owner[1:,:]).T]:
        for col in mask.T:
            switches=np.flatnonzero(np.diff(np.r_[False,col,False]))
            runs.extend((switches[1::2]-switches[::2]).tolist())
    longest=max(runs)
    penalty=sum(max(0,r-4)**3 for r in runs)
    return longest*3000+penalty+max(0,len(tiles)-142)*800,longest,penalty

def retile(w,h,mask=None):
    used=np.zeros((h,w),dtype=bool) if mask is None else mask.copy();placed=[];calls=0
    def recurse():
        nonlocal calls
        calls+=1
        if calls>250:return False
        free=np.argwhere(~used)
        if not len(free):return True
        y,x=map(int,free[0]);choices=SHAPES.copy();RNG.shuffle(choices)
        for tw,th in choices:
            if x+tw>w or y+th>h or np.any(used[y:y+th,x:x+tw]):continue
            used[y:y+th,x:x+tw]=True;placed.append((x,y,tw,th))
            if recurse():return True
            placed.pop();used[y:y+th,x:x+tw]=False
        return False
    return placed if recurse() else None

def main():
    started=time.perf_counter()
    source=ROOT.parent/'layout-study/layout2.json'
    current=[tuple(t['grid']) for t in json.loads(source.read_text())['tiles']]
    score=audit(current);before=score;best=(score,current.copy());valid=0;accepted=0
    for step in range(6000):
        # Remove whole stones around a local window; retile the resulting
        # irregular hole while preserving every outside placement exactly.
        x,y=RNG.randrange(N),RNG.randrange(N)
        w=RNG.randint(3,8);h=RNG.randint(3,8)
        inside=[];outside=[]
        for t in current:
            a,b,c,d=t
            if a<x+w and a+c>x and b<y+h and b+d>y:
                inside.append(t)
            else:outside.append(t)
        if len(inside)<2:continue
        x=min(t[0] for t in inside);y=min(t[1] for t in inside)
        w=max(t[0]+t[2] for t in inside)-x;h=max(t[1]+t[3] for t in inside)-y
        mask=np.ones((h,w),dtype=bool)
        for a,b,c,d in inside:mask[b-y:b-y+d,a-x:a-x+c]=False
        local=retile(w,h,mask)
        if local is None:continue
        candidate=outside+[(x+a,y+b,c,d) for a,b,c,d in local]
        if not 105<=len(candidate)<=142:continue
        value=audit(candidate);valid+=1
        temp=1600*(1-step/6000)+20
        if value[0]<score[0] or RNG.random()<math.exp(min(0,(score[0]-value[0])/temp)):
            current,score=candidate,value;accepted+=1
            if score[0]<best[0][0]:best=(score,current.copy())
    value,tiles=best
    result={'seed':922931,'grid':[N,N],'fieldMetres':[4,4],
        'proposalLimit':6000,'validRetilings':valid,'acceptedRetilings':accepted,
        'beforeLongestInternalSeamCells':before[1],
        'longestInternalSeamCells':value[1],'longSeamPenalty':value[2],
        'stoneCount':len(tiles),'seconds':time.perf_counter()-started,
        'tiles':[{'family':'B' if w==h else 'A' if 3 in (w,h) else 'C',
                  'grid':[x,y,w,h]} for x,y,w,h in sorted(tiles,key=lambda t:(t[1],t[0]))]}
    output=ROOT/'layout.json';assert not output.exists()
    output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='tiles'}))

if __name__=='__main__':main()
