#!/bin/sh
# Human-admin-only, rollback-safe installation of D-121's reviewed nginx include.
set -eu

candidate=${1:-}
active=/etc/nginx/sites-available/parallax-web.com
case "$candidate" in
  /*) ;;
  *) echo "candidate must be an absolute path" >&2; exit 64 ;;
esac
test -f "$candidate"

backup=$(mktemp /etc/nginx/sites-available/.parallax-web.com.backup.XXXXXX)
had_active=0
installed=0
if test -f "$active"; then
  cp -p -- "$active" "$backup"
  had_active=1
fi

restore_active() {
  if test "$had_active" -eq 1; then
    if ! cp -p -- "$backup" "$active"; then
      echo "failed to restore prior nginx include from $backup" >&2
      return 1
    fi
  else
    if ! rm -f -- "$active"; then
      echo "failed to remove candidate nginx include during restoration" >&2
      return 1
    fi
  fi
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e
  recovery_failed=0
  if test "$status" -ne 0 && test "$installed" -eq 1; then
    echo "nginx candidate failed; restoring the prior active include" >&2
    if ! restore_active; then
      echo "prior nginx include restoration failed; manual intervention required" >&2
      recovery_failed=1
    elif ! nginx -t; then
      echo "restored nginx configuration did not validate; manual intervention required" >&2
      recovery_failed=1
    elif ! systemctl reload nginx; then
      echo "restored nginx configuration validated but reload failed; manual intervention required" >&2
      recovery_failed=1
    fi
  fi
  if test "$recovery_failed" -eq 1; then
    echo "internal nginx backup retained at $backup" >&2
  elif ! rm -f -- "$backup"; then
    echo "failed to remove internal nginx backup $backup; manual cleanup required" >&2
  fi
  echo "caller-owned candidate retained at $candidate" >&2
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

installed=1
install -o root -g root -m 0644 -- "$candidate" "$active"
nginx -t
systemctl reload nginx
installed=0

rm -f -- "$backup"
trap - EXIT HUP INT TERM
