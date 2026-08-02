# Production serving and deployment

Production is the fixed origin `https://parallax-web.com`, served directly by nginx
from `/var/www/parallax-web.com` (D-011/D-121). The frozen placeholder source remains
in `site/`; production deployment publishes the verified application `dist/` and never
reads `site/`. The webroot is exclusively owned by Parallax deployment: do not place
unrelated files or ACME HTTP-01 challenge files beneath it. Certificate validation that
needs a writable webroot must use a location outside `/var/www/parallax-web.com`.

## Install the versioned nginx configuration

The deployment script deliberately cannot modify `/etc/nginx` or reload nginx. A human
with server-administration authority must install the reviewed configuration first.
The deployer fails closed unless both `/var/www` and `/var/www/parallax-web.com` are
non-symlink directories owned by the SSH user and neither is group- nor world-writable.
The exact one-time prerequisite for the current `pmeenan` operator is:

```powershell
ssh -t plex 'sudo chown pmeenan:pmeenan /var/www /var/www/parallax-web.com && sudo chmod 0755 /var/www /var/www/parallax-web.com'
```

That prerequisite has been applied and read-only verified for the current candidate.
To install the reviewed nginx include with automatic restoration of the prior include
if `nginx -t` or reload fails:

```powershell
scp deploy/nginx/parallax-web.com.conf deploy/Install-Nginx-Production.sh plex:
ssh -t plex 'status=0; sudo sh /home/pmeenan/Install-Nginx-Production.sh /home/pmeenan/parallax-web.com.conf || status=$?; if test "$status" -eq 0; then rm -f /home/pmeenan/parallax-web.com.conf; else echo "nginx candidate retained at /home/pmeenan/parallax-web.com.conf" >&2; fi; rm -f /home/pmeenan/Install-Nginx-Production.sh; exit "$status"'
```

The existing `/etc/nginx/sites-enabled/parallax-web.com` symlink remains in place.
The installer treats the candidate include as caller-owned and never removes it. The
wrapper above removes it only after success, so a failed candidate remains available
for inspection and retry; restoration failures are reported explicitly.
After reload, verify `/` and a content-addressed `/immutable/` resource on both 200 and
conditional 304 responses. Each must retain
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; mutable responses must require
revalidation and immutable responses must use
`public, max-age=31536000, immutable`.
The stable `/service-worker.js` path is an exact nginx location, is listed and hashed
by build-manifest v15/install-manifest v1, and remains `no-cache`; every `.js`
representation is pinned to exact `application/javascript` by the versioned nginx
types table (parameters are normalized only during validation). Its MIME, COOP, COEP,
and `nosniff` headers are part of local/deployment validation. It is stable
only to avoid a self-referential worker-update URL—release generations still bind its
exact bytes and SHA-256.

## Provision the pinned model content

D-130's five generated GGUF split files are install-only production resources, not
`dist` artifacts. `model-content.json` v2 retains only their logical source identity
and exact resource set. The host directory is resolved from the
`production-model-content` entry in the ignored `.parallax-toolchain.local.json`.
Deployment and verification share the same bounded resolver and fail closed unless
that entry has the exact model version and an absolute, canonical, existing directory
with no reparse-point ancestor.
The default command streams and verifies all 2,620,371,552 local bytes, inventories the
fixed remote paths, and prints an exact skip/upload/block plan without mutation:

```powershell
pnpm deploy:model-content
```

After review, request upload explicitly:

```powershell
pnpm deploy:model-content:apply
```

The package script launches a fixed no-argument wrapper, which invokes the bounded
model-content deployer in the same PowerShell process with real `Deploy` and disabled
`Confirm` switch values. The outer command accepts no remote host, path, or deletion
target.

No remote host or path argument exists: the command can target only
`plex:/var/www/parallax-web.com/immutable`. It reuses the webroot owner, mode,
non-symlink, stable-inode, no-descendant-mount, and exclusive
`.parallax-deploy.lock` guards. Each missing/wrong object is copied to a private
lock-owned `.partial`, remotely verified with `stat` and `sha256sum`, chmodded 0644,
and moved to `model-<sha256>.gguf`. The immutable directory and final files must use the
guarded webroot UID/GID and exact 0755/0644 modes. Safely owned wrong modes may be
normalized only after explicit approval; wrong ownership blocks. The inventory is
re-read under the owned lock before any normalization or upload, and exact objects are
skipped. Interrupted uploads are removed with the owned lock. Unsafe final types and
unexpected `model-*.gguf` objects block deployment and are never deleted automatically.
The uploader never touches ordinary application files.

After the five objects are published, run the bounded HTTP source check:

```powershell
pnpm harness:model-source-verification
```

It records strict pending-then-passed/failed JSON and state-honest Markdown. A fixed
`ssh.exe plex` preflight first hashes and stats the exact five public files, proving
their full remote byte identity plus type/UID/GID/mode before HTTP begins. HTTP then
records HEAD, `bytes=0-0`, unsatisfiable Range, and matching/stale `If-Range` transport
evidence for every shard. It reads exactly two successful one-byte bodies per shard
(plain range and matching `If-Range`); HEAD reads no body, the 416 body is bounded, and
the stale-validator 200 response is cancelled immediately. It never downloads a full
model body. Full 200 responses must advertise byte ranges and retain exact object
headers; 206 may omit `Accept-Ranges` but binds exact partial metadata and the stable
strong ETag; nginx-shaped 416 binds only the unsatisfied range, bounded body, and
semantic `no-cache`. Every request carrying `Range`, including stale `If-Range`
resolved as 200, must be `no-cache`. This is source/transport evidence, not a D-097
browser gate.

## Preview and deploy the app

The default command builds and verifies a fresh `dist`, prints the local and remote
inventories, verifies the exact remote target, and makes no remote changes:

```powershell
pnpm deploy:production
```

After review, request the destructive replacement explicitly:

```powershell
pnpm deploy:production:apply
```

The package script launches a fixed no-argument wrapper, which invokes the bounded app
deployer in the same PowerShell process with real `Deploy` and disabled `Confirm`
switch values. The outer command accepts no remote host, path, or deletion target.

The script has fixed host `plex` and fixed target `/var/www/parallax-web.com`. A
destructive app deployment requires the exact five pinned model objects first; preview
reports the blocker but never mutates. Before preview or deployment reaches the remote
target, the deployer independently parses the hash-verified built install manifest and
requires its complete five-resource model projection (ID, kind, scope, target, source,
bytes, and SHA-256) to equal `model-content.json`; missing, extra, duplicate, or drifted
models and noncanonical sources/paths fail closed. It
atomically acquires an internal `.parallax-deploy.lock`, rejects webroot/descendant
mounts (including same-filesystem bind mounts), freezes the exact local manifest
inventory as deterministic LF bytes, makes and verifies the webroot owner-only, moves
the exact verified model set into that private lock, deletes only its non-lock children,
and recursively copies the frozen `dist` children via OpenSSH `scp`. It then restores the
preserved objects. While the webroot remains 0700, it rejects symlinks, normalizes only
descendant directories/files to 0755/0644, and remotely checks every file's mode, path,
size, and SHA-256 against the exact union of `dist` and the five model objects, with no
extras; FIFOs, sockets, devices, and every other non-lock entry that is neither a
regular file nor a directory fail verification. It revalidates the frozen local source
after copy and again immediately before publication. Only after those source boundaries
and the exact private-root inventory
comparison succeed may it chmod the webroot 0755 and release its owned lock. Any failure
after privatization restores already-preserved model objects only inside the private
root, retains the owned lock for manual recovery (including partial model-preservation
or restoration failure), and reports guarded private-root/lock
status without republishing partially copied bytes.

### Recover a retained deployment lock

Preview fails closed with
`deployment-lock-present:/var/www/parallax-web.com/.parallax-deploy.lock` when an
earlier app deployment retained private recovery state. Do not delete the lock or
rerun deployment: its token is the authority for the private tree, and the webroot may
still be mode 0700 with application bytes or exact pinned models in
`.parallax-deploy.lock/preserved-models`.

Recovery is a manual, reviewed operation. Inspect the fixed webroot, lock directory,
token, and `preserved-models` without changing them. For every exact remote name in
`model-content.json`, require any preserved object to be a regular non-symlink file
with the guarded webroot UID/GID, mode 0644, exact byte length, and exact SHA-256. Move
an accepted preserved object back to `immutable/` only when its final path is absent;
never overwrite a final object. Recheck the complete five-model set and the combined
application/model inventory, remove `preserved-models` only after it is empty, and
restore root mode 0755 and remove the lock only with the inspected token after the
published tree is exact. If the token, ownership, modes, hashes, application inventory,
or restoration state cannot be proven, retain the 0700 root and lock for further
manual recovery.

There is intentionally no staged publish, app backup, `rsync`, or `site/` publish path.
When the standing D-097 trigger applies, a final production-target harness run must
validate the public origin before that runtime-affecting candidate is accepted.

## Deployment contract tests

The normal unit gate runs portable static and PowerShell-mocked deployment tests for
both app deployment and the destructive model-content uploader. Optional POSIX semantic
fixtures are outside the acceptance gate; set `PARALLAX_RUN_POSIX_DEPLOY_TESTS=1` only
on a developer machine where `sh.exe` and `wsl.exe` are already available on `PATH`.
