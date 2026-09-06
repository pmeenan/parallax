# Asset storage

D-190 keeps creative originals versioned with their metadata without putting their
bytes into ordinary Git history. `.lfsconfig` selects the shared service at
`https://git-lfs.meenan.dev/api/pmeenan/parallax`; `.gitattributes` selects binary
formats beneath `assets/`. Files retain their original paths and full-resolution
bytes in a hydrated working tree. Git stores SHA-256/size pointers instead.

| Content | Storage |
| --- | --- |
| Concept images, contact sheets, rights-cleared reference media | Git LFS under `assets/reference/` |
| Retained authored Blender files, textures, audio and other creative binaries | Git LFS under `assets/source/` |
| Prompts, target records, rights/provenance metadata, hashes, manifests and generation scripts | Ordinary Git |
| Admitted runtime objects under `assets/library/objects/` | Ignored D-186 content-addressed store |
| Reproducible build outputs, caches and temporary intermediates | Ignored; never force-add them to LFS |

All objects on this LFS service are publicly readable. Rights review still governs
third-party media; private or uncleared inputs must not be uploaded. LFS does not
admit an asset to the runtime library or establish artistic/rights acceptance.

## Machine setup

Install Git LFS, then run in the checkout:

```sh
git lfs install --local
git lfs pull
git lfs env
```

Confirm the endpoint is `https://git-lfs.meenan.dev/api/pmeenan/parallax` before
uploading. A pre-existing local `lfs.url` or remote-specific override can take
precedence over `.lfsconfig`; remove an obsolete override deliberately. Machines
with an existing custom pre-push hook must integrate LFS's hook instead of overwriting
it. Normal Git pushes upload needed LFS objects through the hook. Agents still never
commit or push Git refs; an explicitly authorized asset upload can use `git lfs push
--object-id origin <sha256>`, which transfers LFS bytes without changing Git refs.

On LAN development machines, add the following administrator-owned hosts entry:

```text
192.168.0.7 git-lfs.meenan.dev
```

Peers in `192.168.0.0/16` can upload without credentials. Public reads go through
Cloudflare. Off-LAN writers need credentials and a direct transfer route for objects
above Cloudflare's upload limit; see [server setup](../deploy/lfs/README.md).
CI/build machines need Git LFS and access to the endpoint when their job consumes
creative originals. Code-only jobs may skip hydration with `GIT_LFS_SKIP_SMUDGE=1`;
run `git lfs pull` before any operation that needs the actual images/source files.

## Adding and changing assets

Use lowercase extensions listed in `.gitattributes`. Before adding a new binary
format, add an appropriate scoped LFS rule and verify it:

```sh
git check-attr filter diff merge text -- assets/reference/example.png
```

Expect `filter`, `diff`, and `merge` to be `lfs`, and `text` to be `unset`.
Stage the asset normally; do not force-add ignored library objects. Confirm the index
contains a pointer, while the working file remains the original:

```sh
git show :assets/reference/example.png
git lfs ls-files --long --size
```

The indexed representation must start with `version https://git-lfs.github.com/spec/v1`
and contain the original SHA-256 and byte size. Target records continue to hash the
original bytes, not this pointer. New versions produce new objects; keep historical
objects available for old revisions. SVG, JSON, Markdown and source code stay textual.

## Migration and durability

The initial migration converts current reference images, including five previously
tracked PNGs, to LFS pointers on the next human commit. Existing history is preserved:
old revisions still contain those five ordinary Git blobs. There is no history rewrite.
New generated originals enter Git as pointers from their first commit.

LFS objects are uploaded before handoff and verified against the original hashes.
The server is a durable-storage destination only to the extent it is backed up;
off-machine backup remains unconfigured. Keep local originals and LFS caches until
backup/restore is established. See the [operations and backup procedure](../deploy/lfs/README.md).
