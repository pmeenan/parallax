# Generated library outputs

Generated library binaries and cell bundles do not live in git (assets rule 6 / P-004).
For D1 greybox v1, `pnpm build` validates the generator and emits one immutable,
content-addressed JSON bundle per cell plus a content-addressed district index under
`dist/immutable/`. The build manifest classifies the index as `game-specific`.

Only those validated build outputs are loadable package artifacts; files under
`assets/source/` are provenance metadata and are never runtime inputs.
