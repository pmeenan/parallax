"""Fresh representative transfer of a relocated, soil-fitted moss colony."""
from pathlib import Path
import sys
ROOT=Path(__file__).parent
candidate=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'candidate1'
folder=ROOT/candidate
assert not (folder/'transfer').exists()
recipe=ROOT.parent/'moss/candidate1/transfer.py'
code=recipe.read_text().replace("OUT=Path(__file__).parent/'transfer'", "OUT=folder/'transfer'")
(folder/'resolved-transfer.py').write_text(code)
exec(compile(code,str(recipe),'exec'))
