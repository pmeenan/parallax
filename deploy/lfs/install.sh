#!/bin/bash
# Fixed-host bootstrap; never deletes asset data or edits another site's config.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ $# == 0 ]] || { echo 'No arguments accepted.' >&2; exit 1; }
cd -- "$(dirname -- "$(readlink -f -- "$0")")"
for cmd in docker nginx certbot openssl python3 flock curl; do command -v "$cmd" >/dev/null; done
docker compose version >/dev/null
exec 9>/run/lock/git-lfs-install.lock
flock -n 9 || { echo 'Another LFS installation is running.' >&2; exit 1; }
active=/etc/nginx/sites-available/git-lfs.meenan.dev
enabled=/etc/nginx/sites-enabled/git-lfs.meenan.dev
for path in /srv/git-lfs /opt/git-lfs /var/lib/git-lfs-acme "$active" /etc/nginx/git-lfs.htpasswd; do
    [[ ! -L $path ]] || { echo "Refusing symlink: $path" >&2; exit 1; }
done
if [[ -e $active ]]; then
    grep -q '^# Managed by deploy/lfs/install.sh' "$active" || {
        echo "Existing unmanaged site: $active" >&2; exit 1;
    }
fi
if [[ -e $enabled || -L $enabled ]]; then
    [[ -L $enabled && $(readlink "$enabled") == "$active" ]] || exit 1
fi
if ! id git-lfs >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /srv/git-lfs --no-create-home --shell /usr/sbin/nologin git-lfs
fi
if [[ -d /srv/git-lfs ]]; then
    [[ $(stat -c %u /srv/git-lfs) == $(id -u git-lfs) ]] || {
        echo 'Existing /srv/git-lfs has unexpected owner; inspect manually.' >&2; exit 1;
    }
fi
install -d -o git-lfs -g git-lfs -m 0750 /srv/git-lfs
install -d -o root -g root -m 0755 /opt/git-lfs /var/lib/git-lfs-acme
install -o root -g root -m 0644 compose.yaml /opt/git-lfs/compose.yaml
printf 'LFS_UID=%s\nLFS_GID=%s\n' "$(id -u git-lfs)" "$(id -g git-lfs)" >/opt/git-lfs/.env
chmod 0600 /opt/git-lfs/.env

# Generate once, without exposing the password in logs or process arguments.
# nginx on this host runs as pmeenan; only that worker and root may read the hash.
if [[ ! -f /etc/nginx/git-lfs.htpasswd ]]; then
    umask 077
    password=$(openssl rand -hex 32)
    hash=$(printf '%s\n' "$password" | openssl passwd -6 -stdin)
    printf 'pmeenan:%s\n' "$hash" >/etc/nginx/git-lfs.htpasswd
    printf 'LFS username: pmeenan\nLFS password: %s\n' "$password" >/root/git-lfs-writer.txt
    unset password hash
fi
chown root:pmeenan /etc/nginx/git-lfs.htpasswd
chmod 0640 /etc/nginx/git-lfs.htpasswd
docker compose --project-name git-lfs --project-directory /opt/git-lfs up -d
curl --fail --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:18781/ >/dev/null

# Each nginx replacement rolls back its own config on validation/reload failure.
install_site() {
    local candidate=$1 backup had=0 linked=0
    backup=$(mktemp /etc/nginx/sites-available/.git-lfs-backup.XXXXXX)
    if [[ -f $active ]]; then cp -p "$active" "$backup"; had=1; fi
    install -o root -g root -m 0644 "$candidate" "$active"
    if [[ ! -L $enabled ]]; then ln -s "$active" "$enabled"; linked=1; fi
    if nginx -t && systemctl reload nginx; then
        rm -f "$backup"
        return 0
    fi
    if [[ $had == 1 ]]; then cp -p "$backup" "$active"; else rm -f "$active"; fi
    if [[ $linked == 1 ]]; then rm -f "$enabled"; fi
    if nginx -t && systemctl reload nginx; then
        rm -f "$backup"
    else
        echo "Rollback needs attention; backup retained: $backup" >&2
    fi
    return 1
}

cert=/etc/letsencrypt/live/git-lfs.meenan.dev/fullchain.pem
if [[ ! -f $cert ]]; then
    bootstrap=$(mktemp)
    trap 'rm -f "$bootstrap"' EXIT
    cat >"$bootstrap" <<'NGINX'
# Managed by deploy/lfs/install.sh. HTTP certificate bootstrap only.
server {
    listen 80;
    server_name git-lfs.meenan.dev;
    location ^~ /.well-known/acme-challenge/ { root /var/lib/git-lfs-acme; }
    location / { return 404; }
}
NGINX
    install_site "$bootstrap"
    # Uses the existing certbot account; prompts if registration is required.
    # DNS and public port 80 must already route to plex. Failure leaves HTTP-only
    # challenge serving and the loopback backend; rerun after fixing routing.
    certbot certonly --webroot -w /var/lib/git-lfs-acme -d git-lfs.meenan.dev
fi
install_site git-lfs.meenan.dev.conf
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' >/etc/letsencrypt/renewal-hooks/deploy/git-lfs-nginx.sh
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/git-lfs-nginx.sh
echo 'Installed. Retrieve writer credentials with: sudo cat /root/git-lfs-writer.txt'
echo 'Asset storage: /srv/git-lfs; back this directory up off-machine.'
