#!/bin/sh
# Launch an interactive Pi session routed through the ModelPatrol gateway.
# Does not start the gateway, write credentials, or change Pi's saved defaults.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONFIG="${CODEPATROL_CONFIG:-$ROOT/codepatrol.json}"
LOCAL_ENV="${MODELPATROL_LOCAL_ENV:-$ROOT/../modelpatrol/deploy/local.env}"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

if [ ! -f "$CONFIG" ]; then
  die "CodePatrol config not found: $CONFIG"
fi

eval "$(
  python3 - "$CONFIG" <<'PY'
import json, shlex, sys
from pathlib import Path

config = json.loads(Path(sys.argv[1]).read_text())
gateway = config.get("modelpatrol")
if not isinstance(gateway, dict):
    raise SystemExit("codepatrol.json is missing the modelpatrol section")
fields = {
    "MP_BASE_URL": gateway.get("baseUrl") or "http://127.0.0.1:4318",
    "MP_MODEL": gateway.get("model") or "auto",
    "MP_API": gateway.get("api") or "chat",
    "MP_API_KEY_ENV": gateway.get("apiKeyEnv") or "MODELPATROL_API_KEY",
    "MP_HARNESS": gateway.get("harness") or "pi",
    "MP_PROJECT": gateway.get("project") or "codepatrol",
}
for key, value in fields.items():
    if not isinstance(value, str) or not value:
        raise SystemExit(f"Invalid modelpatrol field for {key}")
    print(f"{key}={shlex.quote(value)}")
PY
)"

if [ -z "${MODELPATROL_API_KEY:-}" ] && [ -f "$LOCAL_ENV" ]; then
  # Operator-owned local deploy file; do not print it.
  set -a
  # shellcheck disable=SC1090
  . "$LOCAL_ENV"
  set +a
fi

export MODELPATROL_BASE_URL="${MODELPATROL_BASE_URL:-$MP_BASE_URL}"
export MODELPATROL_MODEL="${MODELPATROL_MODEL:-$MP_MODEL}"
export MODELPATROL_API="${MODELPATROL_API:-$MP_API}"
export MODELPATROL_API_KEY_ENV="${MODELPATROL_API_KEY_ENV:-$MP_API_KEY_ENV}"
export MODELPATROL_HEADERS="${MODELPATROL_HEADERS:-{\"x-patrol-harness\":\"$MP_HARNESS\",\"x-patrol-project\":\"$MP_PROJECT\"}}"

eval "KEY=\${$MODELPATROL_API_KEY_ENV-}"
[ -n "$KEY" ] || die "Missing gateway credential \$$MODELPATROL_API_KEY_ENV"

require_cmd python3
require_cmd modelpatrol
require_cmd pi

EXTENSION=$(modelpatrol integration-path pi) || die "modelpatrol integration-path pi failed"
[ -f "$EXTENSION" ] || die "Pi adapter not found: $EXTENSION"

python3 - "$MODELPATROL_BASE_URL" <<'PY' || die "ModelPatrol gateway is not reachable"
import sys, urllib.request
from urllib.error import HTTPError, URLError

url = sys.argv[1].rstrip("/") + "/v1/models"
try:
    urllib.request.urlopen(url, timeout=2)
except HTTPError:
    pass
except URLError as error:
    raise SystemExit(error.reason)
PY

cd "$ROOT"
exec pi --extension "$EXTENSION" --provider modelpatrol --model "$MODELPATROL_MODEL" "$@"
