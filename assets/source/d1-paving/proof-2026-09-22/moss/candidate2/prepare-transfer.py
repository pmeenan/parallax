"""Reuse the isolated transfer harness; retain final moss vertex colors explicitly."""
from pathlib import Path
P=Path(__file__).parent
s=(P.parents[1]/'leaf-color/candidate2/transfer.py').read_text()
s=s.replace("['Broadleaf weed 0','Broadleaf weed 0 petioles']","['Leafy moss colony 0']")
s=s.replace("Vector((.11,-.15,.17))","Vector((.025,-.035,.045))")
s=s.replace('camera.data.lens=58','camera.data.lens=58;camera.data.clip_start=.001')
s=s.replace('min(v.z for v in coords)+.002','min(v.z for v in coords)-.0002')
s=s.replace('representative-weed.glb','representative-moss.glb').replace("export_vertex_color_name='LeafAgeTint'","export_vertex_color_name='MossColor'")
s=s.replace('Representative leaf/petiole','Representative explicit moss').replace('Native2.5percent subsurface shader may not transfer into standard glTF; no material tuning done to hide differences','No intentional shader mismatch; explicit MossColor exported as COLOR_0. No texture maps used for moss.')
(P/'transfer.py').write_text(s)
