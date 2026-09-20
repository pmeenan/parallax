# Batch188 terrain sampling receipt

Executed unmodified coordinateValue, matches, mix32, layerHeight and sampleGreyboxTerrain source from game/src/world/greybox-generator.ts using Node module.stripTypeScriptTypes in memory. Terrain object and generator seed read directly from game/src/world/district-1.data.ts. Pinned Node24.18.1 verified. No runtime source edits.

Output: concepts/batch-188/188-terrain-samples.json. Schema1: x[38] and z[36] ascending coordinate axes at2m spacing; heights[zIndex][xIndex] in meters; namedPoints maps names to {x,z,y}. Bounds x[-552,-478], z[-182,-112], inclusive. Seed 1592643841. Direct terrain samples, NOT16m collision-lattice interpolation.

Named house corners c0..c3 are (xmin,zmin),(xmin,zmax),(xmax,zmin),(xmax,zmax). These samples support a concept proxy only; no terrain modification, collision validation or asset admission.
