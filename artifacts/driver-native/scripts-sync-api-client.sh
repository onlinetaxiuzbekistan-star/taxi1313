#!/usr/bin/env bash
# Re-sync the vendored API client from the monorepo source of truth.
# Run after the OpenAPI client is regenerated in lib/api-client-react.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../../lib/api-client-react/src" && pwd)"
DST="$(cd "$(dirname "$0")/src/lib/api-client" && pwd)"
rsync -a --delete "$SRC"/ "$DST"/

# The orval-generated files have a latent type issue upstream (an imported
# schema symbol isn't exported). They are generated code, so disable hand
# type-checking on them — re-applied here because rsync overwrites the banner.
for f in "$DST/generated/api.ts" "$DST/generated/api.schemas.ts"; do
  if ! head -1 "$f" | grep -q "@ts-nocheck"; then
    printf '// @ts-nocheck -- vendored generated client (orval); not hand-type-checked.\n%s' "$(cat "$f")" > "$f"
  fi
done

echo "Synced API client: $SRC -> $DST"
