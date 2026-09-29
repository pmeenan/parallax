# House kit GPU memory round, step 2b: shared tiling detail tiles (K2 delivery).
# "C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe" detail.py <today maps dir> <out dir>
#
# The low-density variant keeps each material's macro structure; one small periodic tile per material
# class restores the grain above that density. Each tile is the high-frequency part of the material's
# own delivered level-0 maps (the accepted look), taken from a full interior window and made seamless
# with Moisan's periodic-plus-smooth decomposition, so orientation and handedness match the runtime
# normal maps exactly.
#   R, G  detail normal x, y (tangent space, same convention as the base normal maps), 0.5 = flat
#   B     albedo ratio against its low-pass, 0.5 = 1.0, full scale ±ALB_RANGE
#   A     255
import json, math, os, sys

import numpy as np

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
ALB_RANGE = 0.5

# class: (map base name, delivered texel mm, macro texel mm in the low variant, tile width, tile height).
# Oak strips run along each member (u), so its tile is a strip too: a square window would cross arrises.
CLASSES = {
    'plaster': ('plaster-g-plain', 1.0, float(os.environ.get('DETAIL_PLASTER_MACRO_MM', '4.0')), 512, 512),
    'oak': ('kit-oak', 1.5, 3.0, 512, 128),
    'stone': ('kit-stone', 2.5, 5.0, 256, 256),
}


def level0(role):
    meta = json.load(open(os.path.join(SRC, 'maps.json'), encoding='utf-8'))
    m = next(x for x in meta['maps'] if x['role'] == role)
    l0 = m['levels'][0]
    a = np.fromfile(os.path.join(SRC, l0['file']), np.uint8).reshape(l0['height'], l0['width'], 4)
    return a.astype(np.float32) / 255.0


def blur(a, sigma):
    """Periodic Gaussian blur of a 2-D array (sigma in texels)."""
    h, w = a.shape
    ky = np.fft.fftfreq(h)[:, None]
    kx = np.fft.rfftfreq(w)[None, :]
    k = np.exp(-2 * math.pi ** 2 * sigma ** 2 * (kx ** 2 + ky ** 2))
    return np.fft.irfft2(np.fft.rfft2(a) * k, s=a.shape)


def periodic(u):
    """Moisan's periodic component: u minus the smooth field that carries its boundary jumps."""
    h, w = u.shape
    v = np.zeros_like(u)
    v[0, :] += u[-1, :] - u[0, :]
    v[-1, :] += u[0, :] - u[-1, :]
    v[:, 0] += u[:, -1] - u[:, 0]
    v[:, -1] += u[:, 0] - u[:, -1]
    q = np.arange(h)[:, None]
    r = np.arange(w)[None, :]
    den = 2 * np.cos(2 * math.pi * q / h) + 2 * np.cos(2 * math.pi * r / w) - 4
    den[0, 0] = 1.0
    s = np.fft.fft2(v) / den
    s[0, 0] = 0.0
    return u - np.real(np.fft.ifft2(s))


def pick_window(n, alb, tw, th, sigma):
    """A tw x th window with no empty (unpacked) texels, at least median detail energy, and the fewest
    outliers (flakes, pits, knots and checks repeat visibly on a tile)."""
    h, w = n.shape[:2]
    flat = (n[..., 0] == 128 / 255) & (n[..., 1] == 128 / 255) & (n[..., 2] == 1.0)   # unpacked atlas texels
    lum = alb[..., :3].mean(-1)
    cands = []
    for y in range(0, h - th + 1, max(8, th // 4)):
        for x in range(0, w - tw + 1, tw // 4):
            if flat[y:y + th, x:x + tw].mean() > 0.01 or lum[y:y + th, x:x + tw].min() < 0.02:
                continue
            win = n[y:y + th, x:x + tw, :2] * 2 - 1
            fine = win - np.stack([blur(win[..., c], sigma) for c in (0, 1)], -1)
            e = float(fine.std())
            peak = float(np.quantile(np.abs(fine), 0.9995)) / max(e, 1e-6)
            lum_w = lum[y:y + th, x:x + tw]
            cands.append((e, peak + float(lum_w.std() / max(lum_w.mean(), 1e-3)) * 4, y, x))
    if not cands:
        raise SystemExit('no clean window in %s' % (n.shape,))
    med = float(np.median([c[0] for c in cands]))
    good = [c for c in cands if c[0] >= med]
    good.sort(key=lambda c: c[1])
    return good[0][2:]


receipt = {'stage': 'detail-tiles', 'source': os.path.abspath(SRC), 'albedoRange': ALB_RANGE, 'classes': {}}
for cls, (base, px_mm, macro_mm, tw, th) in CLASSES.items():
    n = level0(base + '-normal')
    a = level0(base + '-basecolor')
    fy, fx = -(-n.shape[0] // a.shape[0]), -(-n.shape[1] // a.shape[1])   # colour ships at a coarser density
    a = np.repeat(np.repeat(a, fy, 0), fx, 1)[:n.shape[0], :n.shape[1]]
    sigma = 0.5 * macro_mm / px_mm        # the low variant's texel as a Gaussian cutoff
    y, x = pick_window(n, a, tw, th, sigma)
    out = np.zeros((th, tw, 4), np.float32)
    # Periodic first, then an exact (FFT) high-pass: high-passing the raw window wraps its opposite
    # edges into each other and leaves gradients and seam blobs in the tile.
    for c in (0, 1):
        ch = periodic(n[y:y + th, x:x + tw, c] * 2 - 1)
        fine = ch - blur(ch, sigma)
        out[..., c] = np.clip(fine * 0.5 + 0.5, 0, 1)
    lum = a[y:y + th, x:x + tw, :3].mean(-1)
    lin = periodic(np.where(lum <= 0.04045, lum / 12.92, ((lum + 0.055) / 1.055) ** 2.4))
    ratio = lin / np.maximum(blur(lin, sigma), 1e-4) - 1.0
    out[..., 2] = np.clip(ratio / ALB_RANGE * 0.5 + 0.5, 0, 1)
    out[..., 3] = 1.0
    raw = np.round(out * 255).astype(np.uint8)
    raw.tofile(os.path.join(OUT, cls + '-detail.rgba'))
    receipt['classes'][cls] = dict(source=base, window=[int(x), int(y)], size=[tw, th], texelMillimetres=px_mm,
                                   tileMetres=[tw * px_mm / 1000.0, th * px_mm / 1000.0], cutoffMillimetres=macro_mm,
                                   normalStd=float((out[..., :2] * 2 - 1).std()), albedoStd=float(ratio.std()))
    print(cls, receipt['classes'][cls], flush=True)
json.dump(receipt, open(os.path.join(OUT, 'detail.json'), 'w'), indent=1)
