#!/usr/bin/env bash
# Atomic deploy script for taxi1313-api
# Replaces /opt/taxi1313/artifacts/api-server/dist/index.mjs without race window
# and auto-rolls back if systemd reports failure.
#
# Usage on VPS:   /opt/taxi1313/deploy/deploy.sh /tmp/index.mjs.new
# Usage from dev: scp index.mjs root@vps:/tmp/index.mjs.new && \
#                 ssh root@vps "/opt/taxi1313/deploy/deploy.sh /tmp/index.mjs.new"

set -euo pipefail

NEW_BUNDLE="${1:-}"
DIST_DIR="/opt/taxi1313/artifacts/api-server/dist"
TARGET="${DIST_DIR}/index.mjs"
BACKUP="${DIST_DIR}/index.mjs.bak"
STAGED="${DIST_DIR}/index.mjs.staged"
SVC="taxi1313-api"
HEALTH_WAIT_SEC="${HEALTH_WAIT_SEC:-8}"

if [[ -z "$NEW_BUNDLE" ]]; then
  echo "Usage: $0 /path/to/new/index.mjs" >&2
  exit 2
fi
if [[ ! -f "$NEW_BUNDLE" ]]; then
  echo "[deploy] ERROR: $NEW_BUNDLE not found" >&2
  exit 2
fi

# Same FS check (mv is atomic only within same filesystem)
NEW_FS=$(stat -c '%m' "$NEW_BUNDLE")
DIST_FS=$(stat -c '%m' "$DIST_DIR")
if [[ "$NEW_FS" != "$DIST_FS" ]]; then
  echo "[deploy] WARN: $NEW_BUNDLE on different FS ($NEW_FS) than $DIST_DIR ($DIST_FS); copying first to staged path"
fi

echo "[deploy] $(date -Is) starting deploy"
echo "[deploy] new bundle: $NEW_BUNDLE ($(stat -c '%s' "$NEW_BUNDLE") bytes)"
if [[ -f "$TARGET" ]]; then
  echo "[deploy] current  : $TARGET ($(stat -c '%s' "$TARGET") bytes, mtime $(stat -c '%y' "$TARGET"))"
fi

echo "[deploy] (1) staging new bundle on dist FS"
cp "$NEW_BUNDLE" "$STAGED"
chmod 644 "$STAGED"

echo "[deploy] (2) backing up current bundle"
if [[ -f "$TARGET" ]]; then
  cp -p "$TARGET" "$BACKUP"
fi

echo "[deploy] (3) atomic mv staged -> target"
mv "$STAGED" "$TARGET"

echo "[deploy] (4) restarting $SVC"
systemctl restart "$SVC"

echo "[deploy] (5) waiting ${HEALTH_WAIT_SEC}s and checking is-active"
sleep "$HEALTH_WAIT_SEC"

if ! systemctl is-active --quiet "$SVC"; then
  echo "[deploy] !!! $SVC FAILED to stay active. Rolling back."
  if [[ -f "$BACKUP" ]]; then
    mv "$BACKUP" "$TARGET"
    systemctl restart "$SVC"
    sleep 5
    if systemctl is-active --quiet "$SVC"; then
      echo "[deploy] rollback OK — $SVC is active on previous bundle"
    else
      echo "[deploy] !!! ROLLBACK ALSO FAILED — manual intervention required"
      journalctl -u "$SVC" -n 50 --no-pager
      exit 3
    fi
  else
    echo "[deploy] !!! No backup available — manual intervention required"
    exit 3
  fi
  exit 1
fi

echo "[deploy] (6) $SVC is active. Recent logs:"
journalctl -u "$SVC" -n 20 --no-pager | tail -20

echo "[deploy] $(date -Is) deploy successful"
