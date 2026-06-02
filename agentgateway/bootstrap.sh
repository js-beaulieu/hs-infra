#!/bin/sh
set -eu

# Render agentgateway config from template inside the container.
# Keep this offline-safe because this one-off container has no network.

TMPL="${AGENTGATEWAY_CONFIG_TMPL:-/etc/agentgateway/config.yaml.tmpl}"
OUT="${AGENTGATEWAY_CONFIG_OUT:-/etc/agentgateway/config.yaml}"

: "${AGENTGATEWAY_ISSUER:?AGENTGATEWAY_ISSUER must be set}"
: "${AGENTGATEWAY_JWKS_URL:?AGENTGATEWAY_JWKS_URL must be set}"
: "${MCP_RESOURCE_URI:?MCP_RESOURCE_URI must be set}"

mkdir -p "$(dirname "$OUT")"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\\&|]/\\&/g'
}

issuer=$(escape_sed_replacement "$AGENTGATEWAY_ISSUER")
jwks_url=$(escape_sed_replacement "$AGENTGATEWAY_JWKS_URL")
resource_uri=$(escape_sed_replacement "$MCP_RESOURCE_URI")

sed \
  -e "s|\${AGENTGATEWAY_ISSUER}|$issuer|g" \
  -e "s|\${AGENTGATEWAY_JWKS_URL}|$jwks_url|g" \
  -e "s|\${MCP_RESOURCE_URI}|$resource_uri|g" \
  "$TMPL" > "$OUT"

echo "agentgateway config rendered to $OUT"
