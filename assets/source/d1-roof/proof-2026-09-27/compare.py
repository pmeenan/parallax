# Reference | candidate comparison boards for human review.
# Run: python compare.py candidateN
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.normpath(os.path.join(HERE, '../../../reference/concepts'))
PAIRS = [
    ('gable', 'batch-088/kit-008-pitched-roof-v1.png', 'KIT-008 A gable roof'),
    ('eave', 'batch-088/kit-008-eave-corner-v1.png', 'KIT-008 B eave corner'),
    ('tile', 'batch-105/mat-011-terracotta-tile-v1.png', 'MAT-011 terracotta'),
    ('street', 'batch-001/dir-002-b-sunny-v1.png', 'DIR-002 B village'),
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
