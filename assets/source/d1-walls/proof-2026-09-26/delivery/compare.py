# K1 wall delivery comparison boards: approved source | fresh import | pinned Chrome, per view.
# python compare.py <out dir> <fresh-import dir> <chrome dir> [<extra source dir>]
# Source renders come from the accepted source (or <extra source dir>, source_views.py, for delivery-only
# cameras); every panel is scaled to one height.
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = 'candidate20'  # the accepted source (candidate 20 since the 2026-09-27 brace and corner fixes)
SRC = os.path.normpath(os.path.join(HERE, '../../proof-2026-09-25', SOURCE))
out, fresh, chrome = sys.argv[1:4]
extra = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(out, exist_ok=True)
H = 600
VIEWS = ['front', 'corner', 'corner-left', 'right', 'junction', 'close', 'oak', 'window', 'street', 'overview',
         'overcast', 'low']
for view in VIEWS:
    src = os.path.join(SRC, view + '.png')
    if not os.path.exists(src) and extra:
        src = os.path.join(extra, view + '.png')
    panels = [(label, path) for label, path in (('approved source (Cycles)', src),
                                                 ('fresh import of the runtime bytes (Cycles)', os.path.join(fresh, view + '.png')),
                                                 ('pinned Chrome, game lighting', os.path.join(chrome, view + '.png')))
              if os.path.exists(path)]
    if len(panels) < 2:
        continue
    ims = []
    for label, path in panels:
        im = Image.open(path).convert('RGB')
        ims.append((label, im.resize((round(im.width * H / im.height), H), Image.LANCZOS)))
    board = Image.new('RGB', (sum(im.width for _, im in ims) + 12 * (len(ims) - 1), H + 28), (24, 24, 24))
    x = 0
    d = ImageDraw.Draw(board)
    for label, im in ims:
        board.paste(im, (x, 28))
        d.text((x + 8, 8), label, fill=(230, 230, 230))
        x += im.width + 12
    board.save(os.path.join(out, 'compare-%s.png' % view), optimize=True)
    print('compare-%s.png' % view)
