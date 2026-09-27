# Engine package 7: fit the lighting model to calibrate.py's and dome.py's measurements.
# blender -b --factory-startup --python-exit-code 1 --python fit.py -- \
#     <calibration.json> <dome.npz> <out.json>
# (Blender's Python supplies NumPy.)
#
# 1. Sky dome. Per sun elevation, the sky-only radiance an albedo-1 Lambert surface shows is
#    integrated from dome.py's panoramas for 801 normals, plus the exact ground bounce
#    ((1 - n.y) / 2 of the ground's radiance, albedo x the up value). The sky part is fitted per
#    channel, relative to the up value (pinned, so the paving's calibrated look is kept exactly), as
#       dome(n) = c0 + c1 y + c2 y^2 + c3 h + c4 h y + c5 s^2 + c6 h^2 y^2 + c7 s^4 + c8 h^3 y
#    in the sun's frame: y = n.y (up), h = n . (horizontal toward the sun), s = n . (horizontal
#    across). The first six are the second-order spherical harmonics the sky's symmetry allows;
#    alone they leave low-sun walls 8% out. The last three were chosen greedily from the fourth
#    order. Errors are relative, so dim anti-sun and downward surfaces count as much as lit ones.
#    calibrate.py's Cycles probes join the fit at a higher weight: they are the reference.
# 2. Tone map. The AgX inset and outset matrices (the sigmoid, log2 range and display power stay
#    D-205's) are fitted by Levenberg-Marquardt to Blender's AgX High Contrast on the colour grid,
#    minimising CIELAB error weighted toward the game's palette.
import json
import math
import sys

import numpy as np

cal_path, dome_path, out_path = sys.argv[sys.argv.index('--') + 1:][:3]
cal = json.load(open(cal_path, encoding='utf-8'))
dome_data = np.load(dome_path)
albedo = np.array(cal['groundAlbedo'])
DIRS = dome_data['dirs'].astype(np.float64)
DOMEGA = dome_data['domega'].astype(np.float64)
TERMS = ('1', 'y', 'y^2', 'h', 'h*y', 's^2', 'h^2*y^2', 's^4', 'h^3*y')


def features(n, to_sun):
    """Basis values for normals n (k x 3, z up) with the sun toward to_sun."""
    n = np.atleast_2d(np.asarray(n, float))
    ts = np.asarray(to_sun, float)
    h_dir = np.array([ts[0], ts[1], 0.0])
    h_dir /= np.linalg.norm(h_dir)
    s_dir = np.array([-h_dir[1], h_dir[0], 0.0])
    y, h, s = n[:, 2], n @ h_dir, n @ s_dir
    return np.stack([np.ones_like(y), y, y * y, h, h * y, s * s, h * h * y * y, s ** 4, h ** 3 * y], 1)


def sky_radiance(L, n):
    """An albedo-1 Lambert surface's sky-only radiance (E / pi) for normals n, from a panorama."""
    return (np.maximum(np.atleast_2d(n) @ DIRS.T, 0) * DOMEGA) @ L / math.pi


count = 800
i = np.arange(count) + 0.5
polar, turn = np.arccos(1 - 2 * i / count), math.pi * (1 + 5 ** 0.5) * i
NORMALS = np.vstack([[0.0, 0.0, 1.0],
                     np.stack([np.sin(polar) * np.cos(turn), np.sin(polar) * np.sin(turn), np.cos(polar)], 1)])
WALLS = NORMALS[:, 2] > -0.3  # walls, roofs and the paving; not soffits
PANO_SUN = [1.0, 0.0, 0.0]  # dome.py renders the sun at azimuth 0 (only its elevation matters)
X = features(NORMALS, PANO_SUN)

table = []
by_el = {}
for p in cal['sweep']:
    by_el.setdefault(p['elevationDeg'], []).append(p)
for el in sorted(by_el):
    L = dome_data['el%d' % el].astype(np.float64)
    up = sky_radiance(L, [0.0, 0.0, 1.0])[0]
    ground = albedo * up * (1 - NORMALS[:, 2:3]) / 2
    total = sky_radiance(L, NORMALS) + ground
    rows = by_el[el]
    up_probe = np.array(next(r['skyOnlyRadiance'] for r in rows if r['orientation'] == 'up'))
    # calibrate.py's 13 Cycles probes join the dense normals at weight 10 each (relative to their
    # own up probe): they are the reference, and the panoramas sit 1.3-2.2% from them.
    Xp = features(np.array([r['normal'] for r in rows]), rows[0]['toSun'])
    Tp = np.array([r['skyOnlyRadiance'] for r in rows]) / up_probe
    Gp = albedo * (1 - np.array([r['normal'][2] for r in rows]))[:, None] / 2
    C = np.zeros((len(TERMS), 3))
    for ch in range(3):
        w = up[ch] / total[:, ch]
        w[0] *= 100.0  # the up normal
        wp = 10.0 / Tp[:, ch]
        C[:, ch], *_ = np.linalg.lstsq(
            np.vstack([X * w[:, None], Xp * wp[:, None]]),
            np.concatenate([(total[:, ch] - ground[:, ch]) / up[ch] * w, (Tp[:, ch] - Gp[:, ch]) * wp]), rcond=None)
    rel = np.abs((X @ C) * up + ground - total) / total
    # The panoramas against the Cycles probes at this elevation (relative to up).
    probe_rel = 0.0
    for r in rows:
        pano = (sky_radiance(L, r['normal'])[0] + albedo * up * (1 - r['normal'][2]) / 2) / up
        probe_rel = max(probe_rel, float(np.abs(pano / (np.array(r['skyOnlyRadiance']) / up_probe) - 1).max()))
    table.append(dict(elevationDeg=el, coefficients=C.T.round(5).tolist(),
                      maxRelativeErrorWalls=float(rel[WALLS].max()), maxRelativeErrorAll=float(rel.max()),
                      meanRelativeError=float(rel.mean()), panoramaVsProbes=probe_rel))
    print('dome %2d walls max %.3f all max %.3f mean %.3f; panorama vs probes %.3f' % (
        el, rel[WALLS].max(), rel.max(), rel.mean(), probe_rel))


def dome_at(el):
    els = [t['elevationDeg'] for t in table]
    i = max(0, min(len(els) - 2, int(np.searchsorted(els, el)) - 1))
    a, b = table[i], table[i + 1]
    w = (el - a['elevationDeg']) / (b['elevationDeg'] - a['elevationDeg'])
    return ((1 - w) * np.array(a['coefficients']) + w * np.array(b['coefficients'])).T


# The model (interpolated by elevation, as the engine does) against every Cycles probe.
val = []
cases = [p for p in cal['probes'] if p['case'] != 'wall-overcast-34']
for pool in [[p for p in cases if p['case'] == c] for c in sorted({p['case'] for p in cases})] + list(by_el.values()):
    up = np.array(next(q['skyOnlyRadiance'] for q in pool if q['orientation'] == 'up'))
    for p in pool:
        pred = (features(p['normal'], p['toSun']) @ dome_at(p['elevationDeg']))[0] * up \
            + albedo * up * (1 - p['normal'][2]) / 2
        rel = float((np.abs(pred - np.array(p['skyOnlyRadiance'])) / np.array(p['skyOnlyRadiance'])).max())
        val.append(dict(case=p.get('case', 'sweep-%d' % p['elevationDeg']), orientation=p['orientation'],
                        normalUp=p['normal'][2], maxRelativeError=rel))
worst_val = max(v['maxRelativeError'] for v in val)
worst_walls = max(v['maxRelativeError'] for v in val if v['normalUp'] > -0.3)
print('model vs Cycles probes: max rel err %.3f, walls %.3f (%d probes)' % (worst_val, worst_walls, len(val)))
for v in sorted(val, key=lambda v: -v['maxRelativeError'])[:6]:
    print('  %-14s %-14s %.3f' % (v['case'], v['orientation'], v['maxRelativeError']))

# ---------------------------------------------------------------- AgX
LMIN, LMAX, P = -13.65, 1.75, 2.55
INSET0 = np.array([[0.842479062253094, 0.0423282422610123, 0.0423756549057051],
                   [0.0784335999999992, 0.878468636469772, 0.0784336],
                   [0.0792237451477643, 0.0791661274605434, 0.879142973793104]]).T  # rows = output
OUTSET0 = np.array([[1.19687900512017, -0.0528968517574562, -0.0529716355144438],
                    [-0.0980208811401368, 1.15190312990417, -0.0980434501171241],
                    [-0.0990297440797205, -0.0989611768448433, 1.15107367264116]]).T


def agx(lin, inset, outset):
    v = np.maximum(lin, 0) @ inset.T
    x = (np.clip(np.log2(np.maximum(v, 1e-10)), LMIN, LMAX) - LMIN) / (LMAX - LMIN)
    x2 = x * x
    x4 = x2 * x2
    d = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232
    d = np.clip(d, 0, 1) ** P
    o = d @ outset.T
    return np.maximum(o, 0)  # display-encoded (the engine then returns o^2.2 for Lite's 1/2.2)


def lab(d):
    d = np.clip(d, 0, 1)
    c = np.where(d <= 0.04045, d / 12.92, ((d + 0.055) / 1.055) ** 2.4)
    xyz = c @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    xyz = xyz / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (841 / 108) * xyz + 4 / 29)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def delta_e(a, b):
    return np.linalg.norm(lab(a) - lab(b), axis=1)


samples = cal['agxGrid'] + cal['agxHighContrast']
L = np.array([s['linear'] for s in samples])
D = np.array([s['display'] for s in samples])
# Weights: the game's colours are mostly earth tones, sky and foliage; extreme primaries count
# least, and the named palette patches (all but the primaries) most. The neutral axis is pinned:
# D-205's neutral curve must not move. (A log-space saturation term was tried too: it trades
# against the outset gain, and the fit drove it to 0.05 with outset entries near 27.)
sat = (L.max(1) - L.min(1)) / np.maximum(L.max(1), 1e-6)
W = 1.0 / (1.0 + 6.0 * sat ** 2)
for i, s_ in enumerate(cal['agxHighContrast']):
    if s_['patch'] not in ('red', 'green', 'blue'):
        W[len(cal['agxGrid']) + i] = 3.0
NEUTRAL = np.array([[v, v, v] for v in 0.18 * 2.0 ** np.arange(-8, 5.01, 0.25)])
LAB_D = lab(D)


def unpack(params):
    return params[:9].reshape(3, 3), params[9:].reshape(3, 3)


def residual(params):
    inset, outset = unpack(params)
    # CIELAB difference (the brief's ΔE target), weighted toward the game's palette.
    colour = ((lab(agx(L, inset, outset)) - LAB_D) * W[:, None]).ravel() / 100.0
    neutral = 20.0 * (agx(NEUTRAL, inset, outset) - agx(NEUTRAL, INSET0, OUTSET0)).ravel()
    return np.concatenate([colour, neutral])


params = np.concatenate([INSET0.ravel(), OUTSET0.ravel()])
lam = 1e-3
for it in range(300):
    r = residual(params)
    J = np.zeros((r.size, params.size))
    for k in range(params.size):
        dp = np.zeros_like(params)
        dp[k] = 1e-6
        J[:, k] = (residual(params + dp) - r) / 1e-6
    A_ = J.T @ J
    g = J.T @ r
    step = np.linalg.solve(A_ + lam * np.diag(np.diag(A_) + 1e-12), -g)
    if (residual(params + step) ** 2).sum() < (r ** 2).sum():
        params += step
        lam = max(lam / 3, 1e-9)
    else:
        lam *= 5
    if np.abs(step).max() < 1e-9:
        break
inset, outset = unpack(params)
e0 = delta_e(agx(L, INSET0, OUTSET0), D)
e1 = delta_e(agx(L, inset, outset), D)
earth = sat < 0.6
for name, mask in (('all', np.ones_like(earth)), ('earth', earth)):
    print('%s dE max before %.2f after %.2f; p90 before %.2f after %.2f (%d samples)' % (
        name, e0[mask].max(), e1[mask].max(), np.percentile(e0[mask], 90), np.percentile(e1[mask], 90), mask.sum()))
patches = [dict(patch=s_['patch'], linear=s_['linear'], deltaE=round(float(e), 3))
           for s_, e in zip(cal['agxHighContrast'], e1[len(cal['agxGrid']):])]
for p_ in patches:
    print('  %-9s %s dE %.2f' % (p_['patch'], ' '.join('%.3f' % v for v in p_['linear']), p_['deltaE']))
# Neutral curve check: the fit must keep D-205's neutral tone curve.
neutral = np.array([[v, v, v] for v in 0.18 * 2.0 ** np.arange(-8, 5.01, 0.5)])
neutral_change = float(np.abs(agx(neutral, inset, outset) - agx(neutral, INSET0, OUTSET0)).max())
print('neutral change max %.4f' % neutral_change)

json.dump(dict(groundAlbedo=albedo.tolist(), domeTerms=TERMS,
               domeFrame='sun frame: y up, h toward the sun horizontally, s across; relative to the up value',
               dome=table, domeValidation=val, domeValidationWorst=worst_val, domeValidationWorstWalls=worst_walls,
               agx=dict(insetRows=inset.round(8).tolist(), outsetRows=outset.round(8).tolist(),
                        deltaEMaxBefore=float(e0.max()), deltaEMaxAfter=float(e1.max()),
                        earthDeltaEMaxBefore=float(e0[earth].max()), earthDeltaEMaxAfter=float(e1[earth].max()),
                        neutralChangeMax=neutral_change, patches=patches, samples=len(samples))),
          open(out_path, 'w', encoding='utf-8'), indent=1)
print('FIT_DONE')
