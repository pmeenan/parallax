# Reference | candidate comparison boards for human review.
# Run: python compare.py candidateN
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.normpath(os.path.join(HERE, '../../../reference/concepts'))
PAIRS = [
    ('front', 'batch-087/kit-005-wall-bays-v3.png', 'KIT-005 wall bays'),
    ('corner', 'batch-087/kit-006-oak-corner-v2.png', 'KIT-006 oak corner'),
    ('junction', 'batch-104/mat-008-lime-plaster-v1.png', 'MAT-008 lime plaster'),
    ('window', 'batch-090/kit-010-window-shutters-v3.png', 'KIT-010 window'),
    ('street', 'batch-001/dir-002-b-sunny-v1.png', 'DIR-002 B village'),
    ('oak', 'batch-105/mat-009-structural-oak-v5.png', 'MAT-009 structural oak'),
]
cand = os.path.join(HERE, sys.argv[1])
H = 720
for view, ref, label in PAIRS:
    if not os.path.exists(os.path.join(cand, view + '.png')):
        continue
    a = Image.open(os.path.join(REF, ref)).convert('RGB')
    b = Image.open(os.path.join(cand, view + '.png')).convert('RGB')
    a = a.resize((round(a.width * H / a.height), H), Image.LANCZOS)
    b = b.resize((round(b.width * H / b.height), H), Image.LANCZOS)
    board = Image.new('RGB', (a.width + b.width + 12, H + 28), (24, 24, 24))
    board.paste(a, (0, 28))
    board.paste(b, (a.width + 12, 28))
    d = ImageDraw.Draw(board)
    d.text((8, 8), 'reference: ' + label, fill=(230, 230, 230))
    d.text((a.width + 20, 8), '%s: %s' % (sys.argv[1], view), fill=(230, 230, 230))
    board.save(os.path.join(cand, 'compare-%s.png' % view), optimize=True)
    print('compare-%s.png' % view)
