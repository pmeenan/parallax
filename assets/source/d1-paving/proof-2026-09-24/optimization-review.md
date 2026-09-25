# Paving optimization review (2026-09-24)

Reviewed the uncommitted geometry, compression, build-validation and evidence changes against
HEAD, including the retained comparison images, candidate 8's admitted objects and decode
receipt. No P1/P2 defect was confirmed. Candidate 8's visual acceptance remains pending; the
review does not grant it or qualify the remote-session costs as physical budget evidence.

## Corrected finding

**P3 — count GPU mip bytes by storage format.** `delivery/pack.mjs` divided decoded RGBA byte
totals by eight or four. This misses block padding in the last mips (the pebble BC7 chains are
48 bytes each, not 21), and understated the supported lossless RGBA8 option fourfold. The packer
now sums each mip's whole BC1/BC7 blocks or RGBA8 texels. A focused probe checked the expression
against all eight admitted KTX2 level tables and independent 8/4/2/1 mip examples: 56 bytes BC1,
112 bytes BC7, 340 bytes RGBA8. The QA and runtime accounting already used the correct sizes.

This is a receipt-only correction for future packs. The current source provenance pins the
corrected packer; the library retains candidate 8's original embedded provenance and receipt
identity. No historical receipt was rewritten, no asset was readmitted, and no runtime resource
or build identity changes because of this correction.

## Remaining opportunities, in priority order

1. **Remove the raw texture mip copies.** `compressed-streaming-codecs.ts` still slices every
   BC1/BC7 level into a fresh allocation, copying 24,117,504 bytes for this module. Candidate 8's
   existing Chrome decode receipt records about 5.4 ms for all texture dependencies. A separate
   Node 24.18.1 diagnostic on the exact admitted bytes measured 5.33 ms median / 6.27 ms p95 for
   the copy loop, versus 0.004 ms median to construct views. Those Node numbers isolate the
   operation, not end-to-end Chrome savings. This is the best remaining quality-neutral load
   optimization: carry one transferred container plus level offsets/views to `writeTexture`.
   It needs the worker protocol and validators to preserve offsets and lengths, and both
   transfer lists to deduplicate shared backing buffers. Merely replacing `slice` with
   `subarray` while continuing to use `.buffer` would upload the wrong ranges. Validate exact
   bytes, shared-resource reuse, eviction/reload, and a short installed Chrome capture.
2. **Try a 1024² ground ORM map during the lighting/AO package.** The 2048² BC7 chain costs
   5,592,432 bytes; dropping its first level saves exactly 4,194,304 bytes on disk and GPU.
   This per-map resolution test was omitted from the previous A/B set. Compare grazing light,
   close joints and motion with the upcoming AO enabled. This is a candidate saving, not an
   accepted visual trade. BC1 for ORM is another supported-format A/B worth considering if
   the resolution reduction loses detail: it halves those map bytes without requiring BC4's
   shader swizzle, but its channel precision and correlated endpoints need visual evaluation.
3. **Retain bounds at build time, when next changing the descriptor.** All nine admitted LODs
   already contain exact bounds; recomputing them matched those records. The runtime scans
   274,895 vertices. The same Node diagnostic measured 0.55 ms median / 0.61 ms p95 for all nine
   scans. Removing them is sensible, but the descriptor/cache-key/parser change is less valuable
   now than the texture copies. Validate bounds against decoded positions at build time and
   bind them to the resource identity; do not simply trust unchecked authored bounds.
4. **Defer packed vertices and 16-bit indices.** The current vertex slab is 8,796,640 bytes.
   A hypothetical 20-byte position/packed-normal/UV layout would save 3,298,740 bytes, but needs
   attribute-format support, new PSO states, quantization analysis and visual qualification.
   Seven of nine LODs fit 16-bit indices, saving 709,764 raw/GPU bytes without splitting meshes;
   that is a smaller return for extending the index contract. Pebble instancing remains the
   previously identified option, with its world-planar UV requirement. None has a measured
   frame-time benefit in this review.

**Recommendation:** give the texture transport a short, bounded follow-up if one more load-time
optimization is wanted before moving on. Fold the ORM A/B into the lighting/AO work, where it
can be judged under the intended shading. Do not delay lighting for a bounds-only schema
change, index-width support or new geometry packing. The existing short captures report a
61–65 ms cell load and about 20 ms upload stall; those are advisory, not milestone acceptance.

## Verification

- Focused geometry, decoder, descriptor, PSO, packaging, GPU-ready delivery, assembled build,
  replay source-audit and scale-corpus checks: 9 files / 226 tests passed.
- Receipt arithmetic: all eight current containers and the three independent format cases
  passed; the admitted files' SHA-256 values and all nine geometry bounds were also checked.
- Build, repeatability, typecheck and lint passed. The build manifest remains
  `42700196dc4a9125d3638d6dc25f125fe81cb9c1bafab6f94db69607a98cb402`.
- Full `pnpm check` was **not green**: 219 test files passed, with one failure in
  `scale-streaming-corpus.test.ts` caused by Windows `connect ENOBUFS` on loopback while
  verifying served artifacts (2,720 passed / 1 failed / 1 skipped tests). The scale-corpus
  and provenance files then passed together: 11 tests. One full unit rerun with four workers
  reproduced the same socket failure and the same totals. Lower concurrency did not resolve
  it. This matches the earlier package's reported class of fetch failure, but the review does
  not establish it as pre-existing or relabel either failed run as passing.
- Physical smoke: deferred to M4.5 exit / completion of the optimization packages. No physical
  gate or new visual acceptance is claimed.

The local diagnostic used ten warmup iterations and forty measured iterations on Node
24.18.1, against candidate `51a20ab45d30ab4b332e7ab3e2159ddf400491be129d385ff2fdd54ade60febd`.
It is a review probe, not a new recurring harness or a Chrome performance verdict. Its source,
measurements and both full-suite logs are retained under
`harness/results/paving-photoreal-delivery-2026-09-24/review-2026-09-25/` (ignored, machine-local).
