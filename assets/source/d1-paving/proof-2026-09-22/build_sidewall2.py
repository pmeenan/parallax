"""Second bounded candidate: variable worn shoulder across exposed sidewall height."""
from pathlib import Path
root=Path(__file__).parent
code=(root/'sidewall1/build.py').read_text()
code=code.replace("proof-2026-09-22/sidewall1", "proof-2026-09-22/sidewall2")
code=code.replace('Paving sidewall wear candidate1','Paving varied shoulder candidate2')
start=code.index('    # Local hand-directed facet centers')
end=code.index("    ob.data.vertices.foreach_set",start)
code=code[:start]+'''    # Keep buried lower section; incline the exposed shoulder rather than
    # decorating the existing nearly vertical band with isolated small chips.
    features=[]
    z=before[:,2]+ob.location.z
    vertical=smooth(.055,.080,z)
    for axis,half,other in [(0,hx,hy),(1,hy,hx)]:
        tangent=1-axis
        for sign in [-1,1]:
            phase=si*1.71+axis*.93+sign*.63
            along=before[:,tangent]
            variation=.70+.30*(.5+.5*np.sin(along*37+phase))
            # Broad variation leaves steeper sections between worn patches.
            depth=.018*variation
            side=smooth(half-.050,half-.009,sign*before[:,axis])
            p[:,axis]-=sign*depth*side*vertical
            features.append({'axis':axis,'sign':sign,'maximumRecessionM':.018,
                             'transitionWidthM':.041,'exposedHeightRangeM':[.055,.080],
                             'variation':'broad metric shoulder-width variation'})
'''+code[end:]
code=code.replace('hx-.023','hx-.051').replace('hy-.023','hy-.051')
code=code.replace("'author':'Codex paver_refinement agent'", "'author':'Codex lead; adapted retained first-candidate script'")
out=root/'sidewall2';out.mkdir(exist_ok=True)
(out/'build.py').write_text(code)
exec(compile(code,str(out/'build.py'),'exec'),{'__file__':str(out/'build.py')})
