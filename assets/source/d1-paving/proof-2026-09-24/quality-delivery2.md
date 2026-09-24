# Delivery candidate 2 — independent quality screen

**Verdict:** passes, with no blocking defects. The previous candidate's slivers, faceted pebbles and far-plant cutoff are fixed. One asset item should be fixed (plant shading) and two are minor. The rest of the gap is runtime lighting.

Method: I compared each view against the baseline at native resolution with crops (2–6×), difference images, near-black pixel counts and colour statistics in Blender. For Chrome handedness I correlated the normal-map lighting delta (`wm-game` minus `wm-flat-normal`) with Cycles `gray` relief, split by edge orientation.

## Previous defects: resolved
- **Black slivers in walking-matched.** Both spots, (320,590) and (875,1308), are clean in `reimport-lod0/walking-matched.png`, in the default-terminator render and in Chrome. Pixels below 3% luminance: 26.3k, against 35.2k in the baseline. Chrome `walking-matched`/`joint` have none below 2%.
- **Shards in joint.png.** The large folded shards are gone. A tiny residue remains; see A2.
- **Faceted pebbles.** 3D pebble silhouettes are now smooth, e.g. `reimport-lod0/joint.png` (1150–1250, 560–680) and (1340–1400, 940–1000).
- **Plants cut off in mid-mixed.** Fixed. In `chrome1/mid-mixed.png`, plant-pixel counts in every distance band are within 10% of `mid-lod0`, including the farthest band (y 418–458: 98 vs 109).

## What passes
- **Global look.** Mean colour is within 1% of the baseline in every view, overcast included. At walking distance the stone albedo, mineral grain, soil, pebble scatter and joint depth all match (walking-matched joint crops, walking y≈270–330 band).
- **Tile joins.** No seam line, shading step or texture break around the centre corner of `reimport-lod0/join.png` or `chrome1/join.png` under the low sun.
- **LOD.** `reimport-mixed` differs from `reimport-lod0` by a mean absolute 0.0002 (walking), 0.0002 (grazing) and 0.0007 (overview). The only differences are sparse speckles on the far tiles, and there is no visible pop. Chrome mid-mixed vs mid-lod0: 0.0025.
- **Chrome orientation.** The UV layout is identical to Cycles. Normal-map handedness is correct: correlation is positive for both vertical-edge (+0.71) and horizontal-edge (+0.75) relief. A flipped green channel would make the horizontal edges negative.
- **A small improvement.** A faint bluish line in the baseline `walking.png` at y≈297 is not present in the candidate.

## Asset-representation defects (seen in A against the baseline)
1. **A1. Plants are about 24% darker when lit** (should fix). In the unlit views the plant albedo matches (mean G 0.326 vs 0.322), but in every lit view the plants are darker:
   - `gray`: G 0.218 → 0.166.
   - `close` plant (570–870, 420–710): 0.200 → 0.157.
   - `walking-matched` (930–1050, 1040–1160): 0.221 → 0.171.

   The leaves lose the pale backlit glow and the vein contrast, most visibly on the lower leaf in `close.png` (620–760, 600–700). Albedo is unchanged, so the likely cause is the plant material: translucency or transmission dropped in export, or two-sided normals flipped on back faces.
2. **A2. Residual dark needles in the 22 cm joint view** (minor). In `reimport-lod0/joint.png`:
   - A straight-edged black wedge hangs under a pebble at about (146–166, 890–935).
   - A small black spike sits at about (244–249, 424–430).

   Neither is in the baseline. The default-terminator render has more of these, e.g. a needle across the stone face at about (905–930, 490–500), which offset 1.0 hides. Both views read as cast shadow, and none of this shows at walking distance.
3. **A3. Small pebbles drawn into the maps read flat at 22 cm** (minor, by design). In `joint.png` (1100–1250, 440–650) and (1300–1420, 930–1020), the baseline's crisp small pebbles with contact shadows become soft, shadowless blobs. The 3D pebbles have lost the granular micro-surface the baseline pebbles show, so they look smooth, e.g. around (1360, 975). All of this passes at walking distance.

## Runtime / lighting differences (B only; not asset defects)
- **Flat, dim render.** With no tone mapping, AO or small-scale shadows, joints read shallow and the low sun gives no raking relief (`chrome1/grazing.png` vs baseline, `chrome1/join.png`). This is known engine work.
- **Pebbles read as bright specks.** Small pebbles drawn into the maps show as flat bright white specks ("salt") in dark soil, because nothing shadows them. See `chrome1/walking-4k-mixed.png`, lower third (about 900–1900, 1500–1900), and the joints in `chrome1/join.png`. AO or contact shadows should fix this.
- **Fuzzy stone rims** (should fix, engine side). Stone rims and tops have a fuzzy, felt-like bright fringe, e.g. `chrome1/close.png` (450–870, 400–450) and the near stones of `walking-4k-mixed`. Cycles doesn't show it. The likely cause is that all relief comes from a minified full-height normal map with no specular AA or normal-variance roughness. The engine needs that, or the asset needs roughness adjusted per normal-map mip.
- **Plants in Chrome.** Matte, with no translucency. This is consistent with the engine material.
- **Diagnostic note.** `chrome-cost/close-no-ambient-specular.png` is byte-identical to `chrome1/close.png` (zero difference), so that toggle did not take effect.

## Not verifiable from these renders
- **Flat normals and runtime shadows.** The ground has flat vertex normals, so the Cycles images need the terminator offset to hide self-shadowing on steep joint walls. In Babylon, CSM normal-offset bias uses the vertex normal. Once small-scale shadows are enabled, acne or light leaks on joint walls are a risk that no current Chrome view exercises.
