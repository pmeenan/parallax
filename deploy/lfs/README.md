# Shared Git LFS on plex

Rudolfs 0.3.8, pinned by image digest in `compose.yaml`, serves local objects from
`/srv/git-lfs`. nginx provides HTTPS at `git-lfs.meenan.dev`. This is shared personal
infrastructure, separate from the Parallax webroot and release deployment.

**All namespaces are publicly readable.** Namespaces organize projects; they do not
provide private storage. Actual socket peers in `192.168.0.0/16` can upload without
authentication (explicit operator requirement). Other writers need HTTP Basic auth.
`$realip_remote_addr` prevents forwarded headers from granting LAN privileges. A
router that source-NATs incoming public traffic into this subnet would grant those
connections LAN privileges too: preserve external source addresses on the forwarding
path. Ordinary Cloudflare connections must arrive with Cloudflare source addresses.

## Install

1. Create a proxied Cloudflare A record for `git-lfs.meenan.dev` pointing at the
   public static IP. Route TCP 80/443 to `192.168.0.7`. Do not expose backend 18781.
2. Allow `/.well-known/acme-challenge/` over HTTP without Access, bot challenges or
   a forced edge HTTPS redirect during certificate bootstrap. The installer uses
   the existing certbot account and HTTP-01 webroot validation. It does not change
   DNS, routing, Cloudflare settings or another nginx site's configuration.
3. Files are staged at `/home/pmeenan/git-lfs-setup`. From the development machine:

   ```powershell
   ssh -t plex 'sudo bash /home/pmeenan/git-lfs-setup/install.sh'
   ```

   To restage after edits:

   ```powershell
   scp deploy/lfs/compose.yaml deploy/lfs/git-lfs.meenan.dev.conf deploy/lfs/install.sh plex:/home/pmeenan/git-lfs-setup/
   ```

The installer creates a dedicated `git-lfs` service user, starts the digest-pinned
container with its data directory, installs the site's nginx include, obtains a
publicly trusted certificate and adds a certificate-renewal nginx reload hook.
nginx replacements restore the previous site if validation or reload fails.
If certificate issuance fails, HTTP-only challenge serving and the loopback backend
remain available; fix DNS/routing and rerun. Existing asset bytes are never deleted.
Repeated installs preserve credentials. Backend updates/restarts are not transactional;
if startup fails, inspect `docker compose` logs before rerunning.

After certificate issuance, use Cloudflare **Full (strict)** mode. Permit the small
LFS batch POST requests as well as object GET/HEAD. Cache successful object GETs at
`/api/<org>/<project>/object/<sha256>` using a cache eligibility rule for those paths;
honor origin cache headers and bypass caching for `/objects/batch` and
`/objects/verify`. Do not enable caching for the entire API. Cloudflare's ordinary
Free/Pro/Business cacheable-object ceiling is 512 MB; larger objects are not cached.

On each LAN development machine, add this hosts entry with administrator rights:

```text
192.168.0.7 git-lfs.meenan.dev
```

This makes both upload and download traffic local. The TLS hostname and certificate
remain the same. The installer does not modify Windows hosts files.

## Repository configuration

Parallax's checked-in `.lfsconfig` selects:

```ini
[lfs]
    url = https://git-lfs.meenan.dev/api/pmeenan/parallax
```

Use a different org/project pair for each project; allowed namespace characters are
ASCII letters, digits, underscore and hyphen. D-190 switches Parallax's creative
binaries to `.gitattributes` LFS tracking, superseding D-188; see
[asset storage](../../assets/storage.md). Initial reference originals have been
uploaded with their next-revision pointers staged for human review. This server
installer itself never changes repository contents or Git history.

For off-LAN writers, retrieve the generated password privately:

```sh
sudo cat /root/git-lfs-writer.txt
```

Username is `pmeenan`. Store it in a credential manager; never put it in `.lfsconfig`.
For a client that needs credentials before batch negotiation, set the repository's
`lfs.<full-endpoint-url>.access` to `basic` and supply the password through its Git
credential helper. LAN writers need neither this setting nor a password.

The public batch endpoint can return upload URLs, but cannot write data. Every PUT
is independently checked by nginx. The local backend has no presigned S3 URLs that
could bypass this check. Switching backends requires a new access-control review.
Public verify requests only check object existence/size. Other routes are rejected.
JSON request bodies are capped at 1 MiB; object uploads are streamed without the
host's inherited 500 MB request cap or nginx temporary-file buffering. Invalid
object hashes are rejected without replacing valid data. Range/resumable downloads
are not provided by this pinned Rudolfs backend; qualification covers full transfers.

## Operations and durability

```sh
sudo docker compose --project-name git-lfs --project-directory /opt/git-lfs ps
sudo docker compose --project-name git-lfs --project-directory /opt/git-lfs logs --tail 100
df -h /srv/git-lfs
```

Back up `/srv/git-lfs`, `/opt/git-lfs`, `/etc/nginx/git-lfs.htpasswd`, this site's
nginx configuration and the certbot configuration off-machine. Stop writers/the
container for a consistent filesystem backup or use a consistent snapshot. Test a
restore by retrieving objects and checking their SHA-256 against Git pointers.
**No off-machine backup has been configured by this installer.** Do not prune objects
based solely on the current branch: old commits and other projects still need them.
Container logs rotate at 3 x 10 MB; nginx uses the host's existing logging/rotation.
Storage capacity, external bandwidth and backup monitoring remain operator-owned.

To take the service down, stop its compose project and disable only this site's
nginx symlink, then validate and reload nginx. Retain `/srv/git-lfs` and credentials.

## Qualification

`qualify.sh` runs without sudo on plex using disposable data, a self-signed test
certificate, a separate nginx process and the exact pinned image/config. It requires
ports 18781 and 18443 to be unused (run before production installation). `verify.py`
tests LAN uploads, off-LAN auth, anonymous GET/HEAD and batch negotiation, forged
headers, malformed hashes, method restrictions, a bounded batch body and a streamed
2 GiB + 17 byte round trip. The test process stops its nginx/container and retains
scratch evidence/data under `/home/pmeenan/lfs-qualification-*` for inspection.

After installation, verify a real Git LFS client through LAN DNS and the public
Cloudflare path. Confirm unauthenticated PUT is rejected (401 at the origin, or an
edge denial), valid object downloads match hashes, and production TLS validates.

Production verification on 2026-09-05 passed: the service is running, the development
hosts override resolves to `192.168.0.7`, and a real Git LFS client uploaded a 1 MiB
random object without credentials, then retrieved it through a cold-cache checkout.
SHA-256 was `191c825279af5656683b6e04e6948fe32959aa3c585e045d4aa1c0eb3116a2a9`.
An explicit connection to a public-DNS Cloudflare address (bypassing the LAN hosts
override) returned identical bytes and a valid download batch response over trusted
HTTPS. Direct non-LAN origin PUTs returned 401, including spoofed LAN headers;
the Cloudflare path rejected the spoofed unauthenticated PUT with 403. The 1 MiB
test object remains in the separate `qualification/live-check` namespace. This
checks the Cloudflare path from this machine, not a separate off-site client.

Sources: [Rudolfs](https://github.com/jasonwhite/rudolfs),
[LFS Batch API](https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md),
[Cloudflare cache limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/).
