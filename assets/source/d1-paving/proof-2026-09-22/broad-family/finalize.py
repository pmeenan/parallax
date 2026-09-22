"""Format and bind this source study's evidence; no binary/legacy writes."""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).parent
repo = Path(__file__).parents[5]
registry = json.loads((repo/'.parallax-toolchain.local.json').read_text())
node = next(tool['path'] for tool in registry['tools'] if tool['id'] == 'node')
biome = repo/'node_modules/@biomejs/biome/bin/biome'

def read(path):
    return json.loads(path.read_text())

def write(path, data):
    assert path.resolve().is_relative_to(root.resolve())
    raw = json.dumps(data, indent=2)+'\n'
    formatted = subprocess.run([node, str(biome), 'format', '--stdin-file-path', str(path)],
                               input=raw, text=True, capture_output=True, check=True, cwd=repo).stdout
    path.write_text(formatted, encoding='utf-8', newline='\n')

def identity(path):
    return {'path': path.as_posix(), 'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

def check(row):
    actual = identity(Path(row['path']))
    assert row['sha256'] == actual['sha256'], row['path']
    if 'bytes' in row:
        assert row['bytes'] == actual['bytes'], row['path']

for path in sorted(root.rglob('*.json')):
    if path.name != 'file-inventory.json':
        write(path, read(path))

# Correct the initial invalid preflight's script locator to its byte-exact
# retained snapshot. Its original recorded hash must match before changing it.
preflight = root/'candidate1/receipt.json'
data = read(preflight)
snapshot = root/'invalid-preflight-build.py'
assert data['buildScript']['sha256'] == identity(snapshot)['sha256']
data['buildScript']['path'] = snapshot.as_posix()
data['disposition'] = 'Invalid precision preflight; excluded from artistic candidates.'
write(preflight, data)
native_checks = 0
for path in [preflight, root/'candidate1-corrected/receipt.json', root/'candidate2/receipt.json']:
    receipt = read(path)
    for row in [*receipt['inputs'], *receipt['outputs'], receipt['buildScript']]:
        check(row)
        native_checks += 1
    for key in ['resolvedBuild', 'materialRecipe']:
        if key in receipt:
            check(receipt[key])
            native_checks += 1

for name in ['transfer', 'transfer-explicit-object', 'transfer-target-field']:
    folder = root/name
    member = folder/'a'
    verification_path = member/'verification.json'
    verification = read(verification_path)
    # The reused runtime recipe inventories an earlier version of itself before
    # rewriting its own verification. Exclude self and bind final other bytes.
    verification['files'] = [dict(name=p.name, bytes=p.stat().st_size,
        sha256=hashlib.sha256(p.read_bytes()).hexdigest())
        for p in sorted(member.iterdir()) if p.is_file() and p.name != 'verification.json']
    verification['sourceToBakeVisualFidelityPassed'] = False
    verification['visualLimit'] = 'Matched walking/grazing captures show source-to-bake mineral differences; low/import agreement is a separate check.'
    write(verification_path, verification)
    results_path = folder/'results.json'
    results = read(results_path)
    results['members'] = [verification]
    results['sourceToBakeVisualFidelityPassed'] = False
    results['productionClassLimits'] = {'class': 'individual-stone-variants',
        'classFile': 'assets/qa/d1-stone-variants.json',
        'sourceDimensionsExceedCurrentWidthBounds': True, 'fullAdmissionRun': False}
    check({'path': results['source'], 'sha256': results['sourceSha256']})
    write(results_path, results)
    for path in member.glob('*views.json'):
        report = read(path)
        for row in [*report['inputs'], *report['outputs']]:
            check(row)
    if (member/'color-diagnostic.json').exists():
        report = read(member/'color-diagnostic.json')
        for row in [*report['inputs'], *report['outputs']]:
            check(row)

allowed = {'.py', '.json', '.png', '.blend', '.glb', '.md'}
files = [identity(p) for p in sorted(root.rglob('*'))
         if p.is_file() and p.suffix in allowed and p.name != 'file-inventory.json']
write(root/'file-inventory.json', {
    'scope': 'Retained native candidates and failed source-to-bake diagnostics, not admitted assets.',
    'nativeRecordedIdentitiesChecked': native_checks,
    'files': files,
})
for row in read(root/'file-inventory.json')['files']:
    check(row)
print(json.dumps({'inventoryFiles': len(files), 'nativeRecordedIdentitiesChecked': native_checks,
                  'allMatched': True, 'assetAdmission': False}))
