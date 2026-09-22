"""Final bounded cycle; source candidate1 is never overwritten."""
from pathlib import Path
import ast

folder = Path(__file__).parent
source = (folder/'build.py').read_text()
source = source.replace("/ 'candidate1-corrected'", "/ 'candidate2'")
source = source.replace('Broad physical limestone family candidate1', 'Broad physical limestone family candidate2')
start = source.index('def stone_material(')
end = source.index('\nspecs = [', start)
source = source[:start] + (folder/'material2.py').read_text() + source[end:]
old = "exec(compile(code, str(recipe), 'exec'))"
new = '''# Keep side batter in millimetres when constructing a larger stone. The old
# dimensionless percentage otherwise makes the broad face overhang its sidewall.
code = code.replace('p[:, axis] *= 1 - (0.025 + 0.07 * noise(p, 10, seed + 80 + axis)) * (1 - level)',
                    'p[:, axis] -= np.sign(p[:, axis]) * (.001 + .003 * noise(p, 10, seed + 80 + axis)) * (1-level)')
exec(compile(code, str(recipe), 'exec'))'''
assert old in source
source = source.replace(old, new)
source = source.replace("'buildScript': identity(Path(__file__))", "'buildScript': identity(Path(__file__)), 'resolvedBuild': identity(OUT/'resolved-build.py'), 'materialRecipe': identity(Path(__file__).parent/'material2.py')")
source = source.replace("'oldFineDetailPeriodM': .45, 'broadNoisePerMetre': 7.5, 'marginNoisePerMetre': 67", "'oldFineDetailPeriodM': .45, 'metricWarpNoisePerMetre': 5.5, 'metricWarpRangeM': [.11, .11, .04], 'broadReflectanceNoisePerMetre': 3.2")
# Resolve construction before the receipt hashes it. This is retained authoring
# evidence, not a scratch wrapper needed outside the source study.
source = source.replace('assert bpy.app.version[:3] == (5, 2, 1)', "(OUT/'resolved-build.py').write_text(RESOLVED_SOURCE)\nassert bpy.app.version[:3] == (5, 2, 1)")
compile(source, str(folder/'candidate2/resolved-build.py'), 'exec')
exec(compile(source, str(folder/'candidate2/resolved-build.py'), 'exec'), {'__file__': __file__, 'RESOLVED_SOURCE': source})
