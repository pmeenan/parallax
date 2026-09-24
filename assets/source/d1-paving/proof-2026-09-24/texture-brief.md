# GPU-compressed streamed textures — brief (engine package 2, 2026-09-24)

Follows the [install result](install-results.md). The installed paving cell loads in 367 ms
against the 250 ms cell-load p95 budget, and uploading its maps stalls the render worker for
146 ms against the 50 ms hitch budget. Both costs come from shipping every map to the GPU as
RGBA8: 237 MB decoded, 210 MB of it textures, with 65 ms spent transcoding the base colour to
RGBA8. D-006's reopen trigger (decode and transcode dominating cell load) is met.

**Scene and states.** The installed D1 courtyard and its capture views: walking, walking
matched, close, joint, 12° grazing sun, overcast, overview and far. The runtime-route capture
is [install/capture.mjs](install/capture.mjs); the installed profile is
`pnpm harness:scale-streaming`.

**Question.** Can streamed PBR textures reach the GPU block-compressed, with no visible loss in
the capture views? What load time, stall and GPU memory result, and what is the best 1 byte per
texel form of the ground normal?

**Work.**
- **Descriptors.** Streamed KTX2 descriptors declare their GPU format: `rgba8` or `bc7`.
  Expected byte sizes, cache keys and validation follow the format.
- **Decode worker.** UASTC transcodes to BC7 with the pinned Babylon `uastc_bc7.wasm`, shipped
  as a decode-worker artifact. Raw RGBA8 KTX2 stays `rgba8`.
- **Render worker.** Uploads BC7 mip chains in block rows as `bc7-rgba-unorm(-srgb)`.
  `texture-compression-bc` becomes a required device feature. It fails closed: no RGBA8 shim.
- **Asset.** Re-encode the UASTC maps at a higher UASTC level. The delivery used libktx's
  default, `LEVEL_FASTEST`.
- **Normal.** Choose between the lossless RGBA8 normal and a high-level UASTC normal
  transcoded to BC7. Decide on measured angular error and a Chrome A/B of the grazing, joint
  and close views.
- **Upload stall.** If the batch upload still exceeds the 50 ms hitch budget, spread texture
  uploads across frames.

**Must fix.**
- Any decode, upload or GPU validation failure.
- A visible regression in the capture A/B.
- A cell-load or frame-time regression against the install result.

**Allowance.** Two implementation, capture and evaluation cycles within one work session (4
active hours). Focused tests, then `pnpm check`, the runtime-route capture and the installed
scale-streaming run. Physical `smoke@1` stays at M4.5 exit (D-181).

**Ending decision.** Either BC7 streaming is adopted with measured costs and a decision entry
(it changes the texture contract and makes BC a device requirement), or a named failing
contract with its measured cause. Lighting, ambient occlusion and small-scale shadows are later
packages.
