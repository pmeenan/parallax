# Photoreal paving delivery: copy the retained captures into the source package, build the
# comparison strips, and write a consolidated receipt of the ignored stage receipts.
# blender -b --factory-startup --python-exit-code 1 --python evidence.py -- --results <candidate dir>
#   --candidate <name> --out <package dir> [--maps <stage-2 dir>]
import argparse
import hashlib
import json
import os
import shutil
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--results', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--maps', help='stage-2 directory (default: <results>/maps)')
ap.add_argument('--candidate', required=True)
A = ap.parse_args(argv)
RES = os.path.abspath(A.results)
OUT = os.path.abspath(A.out)
if os.path.isdir(OUT) and os.listdir(OUT):
    sys.exit('refusing to overwrite existing output %s' % OUT)
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-22/photoreal/candidate1'))


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)


def save(path, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new('out', w, h)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def crop(arr, x0, y0, w, h):  # (x0, y0) from the top-left, as in image viewers
    H = arr.shape[0]
    return arr[H - y0 - h:H - y0, x0:x0 + w]


def strip(panels, gap=6):
    h = panels[0].shape[0]
    sep = np.ones((h, gap, 4), np.float32)
    out = []
    for p in panels:
        out += [p, sep]
    return np.concatenate(out[:-1], 1)


def half(arr):
    return 0.25 * (arr[0::2, 0::2] + arr[1::2, 0::2] + arr[0::2, 1::2] + arr[1::2, 1::2])


copies = {
    'import/walking-matched.png': 'reimport-lod0/walking-matched.png',
    'import/close.png': 'reimport-lod0/close.png',
    'import/joint.png': 'reimport-lod0/joint.png',
    'import/grazing.png': 'reimport-lod0/grazing.png',
    'import/join.png': 'reimport-lod0/join.png',
    'import/gray.png': 'reimport-lod0/gray.png',
    'import/walking-mixed-lod.png': 'reimport-mixed/walking.png',
    'import/joint-default-terminator-diagnostic.png': 'reimport-lod0-default-terminator/joint.png',
    'import/close-coincident-plants-diagnostic.png': 'reimport-lod0-coincident-plants/close.png',
    'chrome/walking-matched.png': 'chrome1/walking-matched.png',
    'chrome/close.png': 'chrome1/close.png',
    'chrome/joint.png': 'chrome1/joint.png',
    'chrome/join.png': 'chrome1/join.png',
    'chrome/mid-mixed-lod.png': 'chrome1/mid-mixed.png',
    'chrome/walking-matched-bright-diagnostic.png': 'chrome-diag2/wm-bright.png',
}
for dst, src in copies.items():
    os.makedirs(os.path.dirname(os.path.join(OUT, dst)), exist_ok=True)
    shutil.copyfile(os.path.join(RES, src), os.path.join(OUT, dst))

wm = [load(os.path.join(BASE, 'walking-matched.png')), load(os.path.join(RES, 'reimport-lod0/walking-matched.png')),
      load(os.path.join(RES, 'chrome1/walking-matched.png'))]
save(os.path.join(OUT, 'compare-walking-matched.png'), strip([half(x) for x in wm]))
save(os.path.join(OUT, 'compare-walking-matched-crop.png'), strip([crop(x, 250, 850, 700, 450) for x in wm]))
# 4K walking view (game LOD selection), native-resolution near crop.
k4 = load(os.path.join(RES, 'chrome1/walking-4k-mixed.png'))
save(os.path.join(OUT, 'chrome/walking-4k-mixed-crop.png'), crop(k4, 960, 1080, 1920, 1080))
tex = [load(os.path.join(RES, 'chrome-cost/close-4k.png')), load(os.path.join(RES, 'chrome-tex2048/close-4k.png'))]
save(os.path.join(OUT, 'chrome/texture-4096-vs-2048.png'), strip([crop(x, 1500, 600, 800, 500) for x in tex]))

# Rim diagnostic: ambient-only and sun-only, each with and without the ground normal map.
rim = [load(os.path.join(RES, 'chrome-rim', n + '.png')) for n in
       ('close-ambient-only', 'close-ambient-only-flat-normal', 'close-sun-only', 'close-sun-only-flat-normal')]
save(os.path.join(OUT, 'chrome/rim-diagnostic.png'), strip([crop(x, 0, 60, 760, 380) for x in rim]))

pack = json.load(open(os.path.join(RES, 'pack/pack.json'), encoding='utf-8'))
MAPS = os.path.abspath(A.maps) if A.maps else os.path.join(RES, 'maps')
maps = json.load(open(os.path.join(MAPS, 'maps.json'), encoding='utf-8'))
previews = {}
for d in ('chrome1', 'chrome-cost', 'chrome-tex2048', 'chrome-diag2', 'chrome-rim', 'chrome-lossless-normal'):
    p = os.path.join(RES, d, 'preview.json')
    if not os.path.exists(p):
        continue
    r = json.load(open(p, encoding='utf-8'))
    previews[d] = dict(
        sha256=sha(p), textureGpuBytes=r['textureGpuBytes'], uploadMs=r['uploadMs'],
        browserErrors=len(r['browserErrors']), externalRequests=len(r['externalRequests']),
        views=[dict(view=v['view'], visibleTriangles=v['visibleTriangles'], drawCalls=v['drawCalls'],
                    gpuFrameMs=None if v['gpuFrameMs'] is None else
                    dict(p50=round(v['gpuFrameMs']['p50'], 3), p95=round(v['gpuFrameMs']['p95'], 3)))
               for v in r['views']])
first = json.load(open(os.path.join(RES, 'chrome1/preview.json'), encoding='utf-8'))
validation = json.load(open(os.path.join(RES, 'pack/validation.json'), encoding='utf-8'))
receipt = dict(
    scenario='photoreal-paving-delivery@1',
    candidate=A.candidate,
    sourceReceiptSha256=sha(os.path.join(BASE, 'receipt.json')),
    stageReceipts={k: sha(os.path.join(RES, v)) for k, v in
                   dict(pack='pack/pack.json', validation='pack/validation.json').items()} | {'maps': sha(os.path.join(MAPS, 'maps.json'))},
    pebbleGeometryMinimumMm=maps['pebbleGeometryMinimumMm'], pebbleGeometryInstances=maps['pebbleGeometryInstances'],
    pebbles=maps['pebbles'], pebbleMapCoverageFraction=round(maps['pebbleMapCoverageFraction'], 5),
    geometry=[dict(part=g['part'], lod=g['lod'], vertices=g['vertices'], triangles=g['triangles'],
                   meshoptBytes=g['vertexStream']['bytes'] + g['indexStream']['bytes'], rawBytes=g['rawBytes'],
                   **({'simplifierErrorMm': round(g['simplifierErrorMm'], 3), 'grid': g['grid'],
                       'steepestFaceDegrees': round(g['steepestFaceDegrees'], 2)} if 'grid' in g else {}),
                   **({'instances': g['instances']} if 'instances' in g else {}))
              for g in pack['geometry']],
    textures=[dict(role=t['role'], width=t['width'], height=t['height'], runtimeBytes=t['ktx2']['bytes'],
                   format=t['format'], zstdBytes=t['zstdBytes'], rgba8DecodedBytes=t['rgba8DecodedBytes'],
                   bc7LogicalBytes=t['bc7LogicalBytes'], level0MeanAbsError=round(t['level0MeanAbsError'], 3),
                   level0MaxAbsError=t['level0MaxAbsError'], sha256=t['ktx2']['sha256'])
              for t in pack['textures']],
    glb=[dict(lod=i, bytes=pack['lod%dGlb' % i]['bytes'], sha256=pack['lod%dGlb' % i]['sha256'],
              validatorErrors=validation['reports'][i]['issues']['numErrors'],
              validatorWarnings=validation['reports'][i]['issues']['numWarnings']) for i in range(3)],
    validator=validation['validator'],
    chrome=dict(browser=first['browser'], renderer=first['renderer'], adapter=first['adapter']['info'],
                lodBoundaries=first['lodBoundaries'], runs=previews),
    retained={f: sha(os.path.join(OUT, f)) for f in sorted(
        os.path.relpath(os.path.join(dp, n), OUT).replace(os.sep, '/')
        for dp, _, fs in os.walk(OUT) for n in fs if n.endswith('.png'))},
    budgetAuthority='none: source-package inspection; costs are isolated-preview diagnostics',
)
with open(os.path.join(OUT, 'receipt.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(receipt, f, indent=2)
    f.write('\n')
print('EVIDENCE_DONE', OUT, flush=True)
