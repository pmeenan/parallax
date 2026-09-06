#!/bin/bash
# Disposable qualification on plex. No sudo, production config or production data.
set -euo pipefail
cd -- "$(dirname -- "$(readlink -f -- "$0")")"
scratch=$(mktemp -d /home/pmeenan/lfs-qualification-XXXXXX)
project="lfs-qualification-$(basename "$scratch" | tr '[:upper:]' '[:lower:]')"
cleanup() {
    status=$?
    trap - EXIT
    if [[ -f $scratch/nginx.pid ]]; then nginx -p "$scratch/" -c nginx.conf -s quit || true; fi
    docker compose --project-name "$project" -f "$scratch/compose.yaml" down || true
    echo "Qualification artifacts retained at $scratch (including test data; safe to remove after inspection)."
    exit "$status"
}
trap cleanup EXIT
export LFS_UID=$(id -u) LFS_GID=$(id -g)
mkdir "$scratch/data"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$scratch/key.pem" -out "$scratch/cert.pem" -days 1 -subj /CN=git-lfs.meenan.dev >/dev/null 2>&1
umask 077
openssl rand -hex 32 >"$scratch/password"
hash=$(openssl passwd -6 -stdin <"$scratch/password")
printf 'pmeenan:%s\n' "$hash" >"$scratch/htpasswd"
python3 - "$scratch" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
compose = pathlib.Path("compose.yaml").read_text().replace("/srv/git-lfs:/data", f"{p}/data:/data")
(p / "compose.yaml").write_text(compose)
site = pathlib.Path("git-lfs.meenan.dev.conf").read_text()
site = site[site.index("server {", site.index("server {") + 1):]
site = site.replace("listen 443 ssl;", "listen 127.0.0.1:18443 ssl;\n    listen 192.168.0.7:18443 ssl;")
site = site.replace("/etc/letsencrypt/live/git-lfs.meenan.dev/fullchain.pem", str(p / "cert.pem"))
site = site.replace("/etc/letsencrypt/live/git-lfs.meenan.dev/privkey.pem", str(p / "key.pem"))
site = site.replace("/etc/nginx/git-lfs.htpasswd", str(p / "htpasswd"))
(p / "nginx.conf").write_text(f"pid {p}/nginx.pid;\nerror_log {p}/error.log;\nevents {{}}\nhttp {{\naccess_log {p}/access.log;\nclient_body_temp_path {p}/body;\nproxy_temp_path {p}/proxy;\n" + site + "\n}\n")
PY
bash -n install.sh
docker compose --project-name "$project" -f "$scratch/compose.yaml" up -d
curl --fail --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:18781/ >/dev/null
nginx -p "$scratch/" -c nginx.conf -t
nginx -p "$scratch/" -c nginx.conf
python3 verify.py "$scratch" | tee "$scratch/result.txt"
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' "$(docker compose --project-name "$project" -f "$scratch/compose.yaml" ps -q)"
