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

if ! "$KC" config credentials --server "$SERVER" --realm master --user "$KEYCLOAK_ADMIN_USERNAME" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1; then
  echo "Keycloak is not ready or credentials are invalid. Exiting."
  exit 1
fi

if ! "$KC" get realms/$REALM >/dev/null 2>&1; then
  "$KC" create realms -s realm=$REALM -s enabled=true -s registrationAllowed=false -s loginWithEmailAllowed=true -s duplicateEmailsAllowed=false
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
  "redirectUris": ["https://tasks.$DOMAIN/oauth2/callback"],
  "webOrigins": ["https://tasks.$DOMAIN"],
  "attributes": {
    "pkce.code.challenge.method": "S256"
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
  "redirectUris": ["http://localhost:7777/callback", "http://localhost:*/*", "https://tasks.$DOMAIN/*"],
  "webOrigins": ["+"],
  "attributes": {
    "pkce.code.challenge.method": "S256"
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
