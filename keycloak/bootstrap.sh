#!/bin/sh
set -eu

KC=/opt/keycloak/bin/kcadm.sh
SERVER=http://keycloak:8080
REALM=homelab

require_json_string_safe() {
  name=$1
  value=$2
  case "$value" in
    *\"*|*\\*)
      echo "$name must not contain quote or backslash characters"
      exit 1
      ;;
  esac
}

require_json_string_safe DOMAIN "$DOMAIN"
require_json_string_safe OAUTH2_PROXY_CLIENT_SECRET "$OAUTH2_PROXY_CLIENT_SECRET"
require_json_string_safe MCP_RESOURCE_URI "$MCP_RESOURCE_URI"

MCP_ACCESS_TOKEN_LIFESPAN_SECONDS=${MCP_ACCESS_TOKEN_LIFESPAN_SECONDS:-31536000}
OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS=${OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS:-300}
case "$MCP_ACCESS_TOKEN_LIFESPAN_SECONDS" in
  ''|*[!0-9]*)
    echo "MCP_ACCESS_TOKEN_LIFESPAN_SECONDS must be an integer number of seconds"
    exit 1
    ;;
esac
case "$OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS" in
  ''|*[!0-9]*)
    echo "OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS must be an integer number of seconds"
    exit 1
    ;;
esac

PUBLIC_WEB_ORIGIN=${PUBLIC_WEB_ORIGIN:-https://tasks.$DOMAIN}
PUBLIC_API_ORIGIN=${PUBLIC_API_ORIGIN:-https://api.tasks.$DOMAIN}
require_json_string_safe PUBLIC_WEB_ORIGIN "$PUBLIC_WEB_ORIGIN"
require_json_string_safe PUBLIC_API_ORIGIN "$PUBLIC_API_ORIGIN"

if ! "$KC" config credentials --server "$SERVER" --realm master --user "$KEYCLOAK_ADMIN_USERNAME" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1; then
  echo "Keycloak is not ready or credentials are invalid. Exiting."
  exit 1
fi

if ! "$KC" get realms/$REALM >/dev/null 2>&1; then
  "$KC" create realms -s realm=$REALM -s enabled=true -s registrationAllowed=false -s loginWithEmailAllowed=true -s duplicateEmailsAllowed=false -s accessTokenLifespan="$MCP_ACCESS_TOKEN_LIFESPAN_SECONDS"
else
  "$KC" update realms/$REALM -s accessTokenLifespan="$MCP_ACCESS_TOKEN_LIFESPAN_SECONDS"
fi

for group in homelab-users tasks-users mcp-users mcp-writers; do
  if ! "$KC" get groups -r "$REALM" -q search="$group" | grep -q '"name" : "'"$group"'"'; then
    "$KC" create groups -r "$REALM" -s name="$group"
  fi
done

ensure_client_file() {
  client_id=$1
  client_file=$2
  existing_id=$("$KC" get clients -r "$REALM" -q clientId="$client_id" --fields id --format csv --noquotes | tail -n 1 || true)
  if [ -n "$existing_id" ]; then
    "$KC" update clients/$existing_id -r "$REALM" -f "$client_file"
  else
    "$KC" create clients -r "$REALM" -f "$client_file"
  fi
}

client_uuid() {
  "$KC" get clients -r "$REALM" -q clientId="$1" --fields id --format csv --noquotes | tail -n 1
}

ensure_mapper() {
  client_id=$1
  mapper_name=$2
  mapper_file=$3
  cid=$(client_uuid "$client_id")
  "$KC" get clients/$cid/protocol-mappers/models -r "$REALM" --fields id,name --format csv --noquotes >/tmp/mappers.csv || true
  while IFS=, read -r id name; do
    if [ "$name" = "$mapper_name" ]; then
      "$KC" delete clients/$cid/protocol-mappers/models/$id -r "$REALM"
    fi
  done </tmp/mappers.csv
  "$KC" create clients/$cid/protocol-mappers/models -r "$REALM" -f "$mapper_file"
}

cat >/tmp/oauth2-proxy-client.json <<JSON
{
  "clientId": "oauth2-proxy-tasks",
  "protocol": "openid-connect",
  "publicClient": false,
  "serviceAccountsEnabled": false,
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false,
  "implicitFlowEnabled": false,
  "secret": "$OAUTH2_PROXY_CLIENT_SECRET",
  "redirectUris": ["$PUBLIC_WEB_ORIGIN/oauth2/callback", "$PUBLIC_API_ORIGIN/oauth2/callback"],
  "webOrigins": ["$PUBLIC_WEB_ORIGIN", "$PUBLIC_API_ORIGIN"],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "access.token.lifespan": "$OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS"
  }
}
JSON

cat >/tmp/tasks-mcp-client.json <<JSON
{
  "clientId": "tasks-mcp",
  "protocol": "openid-connect",
  "publicClient": true,
  "serviceAccountsEnabled": false,
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false,
  "implicitFlowEnabled": false,
  "redirectUris": ["http://localhost:7777/callback", "http://localhost:*/*", "$PUBLIC_WEB_ORIGIN/*", "$PUBLIC_API_ORIGIN/*"],
  "webOrigins": ["+"],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "access.token.lifespan": "$MCP_ACCESS_TOKEN_LIFESPAN_SECONDS"
  }
}
JSON

ensure_client_file oauth2-proxy-tasks /tmp/oauth2-proxy-client.json
ensure_client_file tasks-mcp /tmp/tasks-mcp-client.json

cat >/tmp/groups-mapper.json <<'JSON'
{
  "name": "groups",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-group-membership-mapper",
  "config": {
    "claim.name": "groups",
    "full.path": "true",
    "id.token.claim": "true",
    "access.token.claim": "true",
    "userinfo.token.claim": "true"
  }
}
JSON

cat >/tmp/oauth2-audience-mapper.json <<'JSON'
{
  "name": "oauth2-proxy-audience",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-audience-mapper",
  "config": {
    "included.client.audience": "oauth2-proxy-tasks",
    "id.token.claim": "false",
    "access.token.claim": "true"
  }
}
JSON

cat >/tmp/mcp-audience-mapper.json <<JSON
{
  "name": "tasks-mcp-audience",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-audience-mapper",
  "config": {
    "included.custom.audience": "$MCP_RESOURCE_URI",
    "id.token.claim": "false",
    "access.token.claim": "true"
  }
}
JSON

for client in oauth2-proxy-tasks tasks-mcp; do
  ensure_mapper "$client" groups /tmp/groups-mapper.json
done

ensure_mapper oauth2-proxy-tasks oauth2-proxy-audience /tmp/oauth2-audience-mapper.json
ensure_mapper tasks-mcp tasks-mcp-audience /tmp/mcp-audience-mapper.json

# Enable OAuth 2.0 Dynamic Client Registration (RFC 7591) for MCP client onboarding.
# Configures existing Keycloak anonymous DCR policies via the components API.
# See IMPLEMENTATION_PLAN.md: disable anonymous DCR if static clients suffice.

# Trusted Hosts: restrict which hosts may initiate DCR.
# host-sending-registration-request-must-match is false because requests
# arrive via Caddy reverse proxy, so the source IP is Caddy's, not the client.
# client-uris-must-match remains true to prevent open redirect abuse.
TRUSTED_HOSTS_CID=$("$KC" get components -r "$REALM" --fields id,providerId,subType --format csv --noquotes 2>/dev/null | grep ",trusted-hosts,anonymous" | cut -d, -f1 || true)
if [ -n "$TRUSTED_HOSTS_CID" ]; then
  "$KC" update components/$TRUSTED_HOSTS_CID -r "$REALM" \
    -s 'config.host-sending-registration-request-must-match=["false"]' \
    -s "config.trusted-hosts=[\"auth.$DOMAIN\",\"api.tasks.$DOMAIN\",\"localhost\",\"127.0.0.1\"]" \
    -s 'config.client-uris-must-match=["true"]'
fi

# Allowed Client Scopes for anonymous DCR: restrict to openid, profile, email.
SCOPES_CID=$("$KC" get components -r "$REALM" --fields id,providerId,subType --format csv --noquotes 2>/dev/null | grep ",allowed-client-templates,anonymous" | cut -d, -f1 || true)
if [ -n "$SCOPES_CID" ]; then
  "$KC" update components/$SCOPES_CID -r "$REALM" \
    -s 'config.allow-default-scopes=["true"]' \
    -s 'config.allowed-client-scopes=["openid","profile","email"]'
fi
