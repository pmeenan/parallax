# Texture compression A/B — brief (engine package 3, 2026-09-24)

Follows the [geometry result](geometry-results.md). Accepted paving candidate 6 ships every map
as UASTC `LEVEL_SLOWER`, transcoded to BC7 in the decode worker (D-199). Its maps are 52.5 MB on
disk and on the GPU:

| Map | Size | Bytes on disk and GPU |
| --- | --- | ---: |
| Ground base colour | 4096² | 22.4 MB |
| Ground normal | 4096² | 22.4 MB |
| Ground ORM | 2048² | 5.6 MB |
| Three plant maps | 1024 × 512 each | 2.1 MB |

The paving cell holds 65.9 MB of GPU memory, loads in 154–157 ms, and its decode takes 82 ms.
A zstd-19 pass on the current UASTC saves only 12% (22.4 → 19.6 MB), so HTTP compression buys
little without rate-distortion optimisation (RDO).

**Scene and states.** The installed D1 courtyard and its eight capture views
([install/capture.mjs](install/capture.mjs)). For map-resolution questions, add the isolated
preview's close, joint, grazing and walking views ([delivery/chrome-preview.mjs](delivery/chrome-preview.mjs)).

**Question.** Which maps can go smaller on the GPU or in the download with materially similar
quality (D-200)? What does each option save in GPU memory, download and cell load?

**Options, with their expected saving before measurement.**
- **BC1 base colours.** UASTC transcodes to BC1 in the decode worker. The pinned decoder
  chooses `BC1_RGB` when only `s3tc` is offered. BC1 is 8 bytes per 4 × 4 block, so the
  ground and plant base colours drop from 23.1 to 11.5 MB on the GPU. The download is
  unchanged. This is an engine format (`bc1`) plus a per-map GPU-format choice in the library
  manifest.
- **2048² ground normal.** 22.4 → 5.6 MB on the GPU and on disk. An earlier test made *all*
  maps 2048², and that looked visibly softer near the camera. This option tests the normal
  alone.
- **RDO UASTC with HTTP zstd.** This is a download-only saving: OPFS and the GPU keep the same
  bytes. Measure RDO λ against map error and zstd size. The deploy side (`Content-Encoding:
  zstd` for `.ktx2`) is a human-admin nginx change and stays out of scope here.
- **Dropped: BC4 ORM and BC5 normals.** BC5 is 16 bytes per block, the same as BC7, so it saves
  nothing. The BC7 normal was already indistinguishable from lossless (texture result). BC4
  would save 2.8 MB, but it needs a transcoder call outside the pinned decision tree plus a
  roughness swizzle in the shader. The `MaterialPlugin` route stays noted for pebble instancing.

**Cycles.**
1. **Engine and GPU-side A/B.** Add the `bc1` format end to end: descriptor, decode, upload
   and packaging choice. Then A/B the BC1 base colours in game against candidate 6, and the
   2048² normal in the preview.
2. **Download A/B.** Measure RDO UASTC and zstd for the 4096² maps and the resulting map error.
   Then assemble the accepted options into paving candidate 7 for human acceptance.

**Must fix.** Any decode, upload or GPU validation failure, or any cell-load regression. A
visible change beyond a disclosed, slight D-200 trade also counts.

**Allowance.** Two cycles in one work session (4 active hours). This is a remote session:
captures and costs are advisory, and the physical smoke waits until the optimisation packages
finish (human direction). The decoder 9.28.0 review is eligible only from 2026-09-25T07:43Z,
so it moves to the next package that touches the decoder.

**Ending decision.** Adopt each option with measured savings and human acceptance of the look,
or drop it with the measured reason. Adopting `bc1` extends D-199's texture contract, and the
decision log records that.
