# Batch188 blockout v2 — final planned render cycle

Status: rendered after both v1 screens and root authorization. Both v2 screens/root adjudication pending. No third cycle, imagegen, runtime changes or library admission. V1 files preserved. Approximately10 additional active minutes preparation/verification plus source sampling/root reviews separately; two of two render cycles consumed.

## Method

Verified Blender5.2.1 LTS executable C:/Program Files/Blender Foundation/Blender 5.2/blender.exe, build9e2066aef7ef. Background CLI opens retained [v1 scene](concepts/batch-188/courtyard-layout.blend), executes [v2 script](concepts/batch-188/blockout-v2.py), saves [new v2 scene](concepts/batch-188/courtyard-layout-v2.blend) and renders four camera outputs natively. Source script SHA2567bceb136f75e0cc5354cc02002c8c3e3dcb4a36c570ef298f394f703250b2006. No original files overwritten, no image manipulation or external inputs. Same camera orientations/65degree HFOV and187 horizontal placements throughout.

Terrain input [188-terrain-samples.json](concepts/batch-188/188-terrain-samples.json), SHA256ad2edf0191568c0c8652c7ba5f171688e381129575b3fc46b982c869a04c187a. Source method in [terrain receipt](concept-art-batch-188-terrain.md): direct generator samples,2m grid, not collision-lattice interpolation. Proxy ground uses those vertices; bilinear interpolation seats additions. World game(x,z) to Blender(x+516,z+146,elevation). East road context end clipped from-477 to-478 to fit supplied terrain extent; approved court footprint and6m route widths unchanged.

Ground excludes the stair trench. Road strips follow samples with small offsets; thin overlay seams remain visible and are not a paving design. House floor heights: H1=1.305,H2=1.36,H3=1.60,H4=1.63m. Foundations run below local minimum to local maximum+0.12m; walls6m/ridges9m above those floors. Canopy centered on existing well,2.8mx2m with ridgeN-S. Well at1.21m ground, bench feet adjusted to local terrain.

Camera eye elevations A=3.01m,B=2.98m,C=3.15m, exactly named terrain heights+1.7m; horizontal positions unchanged. Stair approachground1.24m, bottom-0.85m (anchor terrain1.15m minus2m). Entrance retained at anchor, not raised for camera visibility; bank height localentranceground+2.2m. Stair/door dimensions remain concept assumptions, not source collision/engineering approval.

Each court-facing facade has ONE central door marker, TWO lower window markers and THREE upper window markers. H1/H2 fronts face south; H3/H4 fronts face north. Other three elevations per house each have TWO upper markers only. One non-emissive lantern placeholder beside every frontdoor, center2.4m above floor. These are shallow registration markers on blockout walls, NOT finished openings, glazing or fixtures; later model construction must create real apertures. No new footprints or chimneys.

Exactly three capsule stand-ins: Human(-526,-145)1.75m; Skarn(-528,-145)1.95m; Wickfolk(-531,-142)1.3m. Each seated on terrain; no anatomy, actor identity or rig validation implied. Same positions in every view.

## Actual views and stair verification

- [A](concepts/batch-188/blockout-a-v2.png): well/canopy foreground, registered east-house front; Wickfolk partly cropped left. Entrance remains behind the well/low trench lip.
- [B](concepts/batch-188/blockout-b-v2.png): reverse well and stair foregroundright; Human/Skarn silhouettes overlap at fixedpositions.
- [C](concepts/batch-188/blockout-c-v2.png): south approach, all three scale silhouettes, west-house front and separate entrance.
- [Overview](concepts/batch-188/blockout-overview-v2.png): shared layout, facade registrations and conforming terrain visible. Foreshortened staircase remains visually smooth at distance.

Read-only [saved-scene mesh audit](concepts/batch-188/stair-geometry-audit-v2.json), using [audit script](concepts/batch-188/audit-stairs-v2.py), confirms20 actual horizontal box treads, each0.5m deep and3.4m clearwidth, consecutive topheight difference0.1045m. No ramp mesh substituted. Audit opened the savedv2 and wrote JSON only: no rerender or scene mutation. Lower entry/tread occlusion is retained; camera images do not prove entrance-detail readability.

## Native provenance

Scene saved2026-09-19 20:48:53UTC; A20:49:00,B20:49:07,C20:49:14,overview20:49:22UTC. [Run log](concepts/batch-188/blockout-v2-run.log), [scene facts](concepts/batch-188/blockout-v2-scene.json). Cycles24samples, denoising, native1536x1024 PNGs. No image model/seed applies; authored primitive proxy geometry. Rights/library gates unchanged.

| File | Bytes | SHA256 |
| --- | --- | --- |
| blockout-a-v2.png | 1568434 | cd62aa60b6334c86047cd106fc75058b16344c78db346d26cead9049744aad5d |
| blockout-b-v2.png | 1528931 | 2a50c682f29a60492798b606f1977c4dfcfc5d2bf800f18c7d1eff176e388acb |
| blockout-c-v2.png | 1534668 | 118e756ebe945d3772551926b4c91c89c2b21d4baf5d84c014a4d1ec6e4a9ad1 |
| blockout-overview-v2.png | 1659097 | aca73a53b970628af9a2359fac7ac5ee834da9fa9732557a2f1946da87a8a903 |
| courtyard-layout-v2.blend | 214235 | b241396a447c601366b42fa3f1eb7019558f53f37affb09a087f048e2116d318 |

All five binaries staged using existing LFS attributes. Index SHA256/size pointers match native files; all four PNG header dimensions verified. No commit. Both screens/root required before dependent imagegen.

Both independent quality178/theme178 and root actual-view PASS for shared layout/facade/occlusion authority before firstimagegen. Quality confirms terrainingestion and ground+1.7m cameraheights A3.01/B2.98/C3.15m. Not collisiongeometry or fullentranceconstruction approval.
