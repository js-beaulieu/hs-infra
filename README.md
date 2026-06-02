# Homelab Auth Gateway

Greenfield Docker Compose stack for a homelab auth gateway. Auth stays at the gateway boundary: private APIs consume trusted identity headers injected by Caddy, oauth2-proxy, or agentgateway.

## Services

- `caddy`: only public entrypoint, publishes `80` and `443`.
- `keycloak`: IdP at `https://auth.${DOMAIN}/realms/homelab`.
- `postgres`: shared private database for Keycloak and tasks-api.
- `oauth2-proxy`: browser SSO/session checks for `tasks.${DOMAIN}`.
- `redis`: private oauth2-proxy session store.
- `agentgateway`: MCP OAuth/resource gateway for `/api/mcp`.
- `tasks-api`: private placeholder API on the `tasks` network.
- `tasks-web`: private static placeholder for browser `/`.
- `postgres-bootstrap`: idempotently creates databases, users, and grants for every service that needs Postgres, on every start.
- `keycloak-bootstrap`: idempotently creates the realm, groups, clients, and protocol mappers, on every start.
- `agentgateway-bootstrap`: renders `agentgateway/config.yaml` from `config.yaml.tmpl` via `envsubst` inside a container, on every start.

Every service has explicit network membership. There is no implicit shared default app network. Postgres is attached to separate Keycloak and tasks database networks so app services do not join the Keycloak DB network directly.

## Environment

Copy `.env.example` to `.env` and replace all placeholder secrets.

Required generated secrets:

- `KEYCLOAK_ADMIN_PASSWORD`
- `KEYCLOAK_DB_PASSWORD`
- `OAUTH2_PROXY_CLIENT_SECRET`
- `OAUTH2_PROXY_COOKIE_SECRET`

Generate the cookie secret with:

```sh
openssl rand -base64 32 | tr '+/' '-_'
```

Image versions live directly in `docker-compose.yml`. Use the latest stable major/current release tags published by each upstream registry; `tasks-api` currently uses `latest` because the upstream image does not publish version tags yet.

## Local HTTPS

Use mkcert for local TLS so browsers, oauth2-proxy, and agentgateway can trust the same local CA. Local domains use `*.home-stack.localhost`, so `auth.home-stack.localhost` and `tasks.home-stack.localhost` resolve to loopback without editing `/etc/hosts`.

```sh
mkcert -install
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem auth.home-stack.localhost tasks.home-stack.localhost
cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem
```

The local `.env` values intentionally do not use Cloudflare as a trusted proxy. Local admin access is controlled by direct/private peer ranges:

```dotenv
DOMAIN=home-stack.localhost
CADDY_TLS_DIRECTIVE="tls /certs/local.pem /certs/local-key.pem"
CADDY_TRUSTED_PROXIES="127.0.0.1/32 ::1/128"
KEYCLOAK_ADMIN_REMOTE_IP_RANGES="private_ranges"
KEYCLOAK_ADMIN_CLIENT_IP_RANGES="private_ranges"
OAUTH2_PROXY_PROVIDER_CA_FILES=/certs/rootCA.pem
AGENTGATEWAY_SSL_CERT_FILE=/certs/rootCA.pem
```

## Production HTTPS

For production, leave `CADDY_TLS_DIRECTIVE` empty and point DNS for `auth.${DOMAIN}` and `tasks.${DOMAIN}` to the Caddy host. Caddy will use ACME/Let's Encrypt.

If the origin is behind Cloudflare proxy, set:

- `CADDY_TRUSTED_PROXIES` to the current Cloudflare IPv4 and IPv6 CIDR list.
- `KEYCLOAK_ADMIN_REMOTE_IP_RANGES` to the same Cloudflare CIDR list.
- `KEYCLOAK_ADMIN_CLIENT_IP_RANGES` to your real admin public CIDR allowlist.

This enforces both required checks for Keycloak admin paths: the immediate peer must be Cloudflare, and the derived client IP must be an allowed admin IP. Do not trust `CF-Connecting-IP` or `X-Forwarded-For` from arbitrary direct peers. Prefer firewalling origin ports `80` and `443` to Cloudflare ranges plus explicit management networks. Keep `KEYCLOAK_PROXY_TRUSTED_ADDRESSES` scoped to Caddy's fixed `auth` network IP, `172.30.1.10/32`, not the whole Docker subnet.

Cloudflare CIDRs are managed statically in `.env` for now. If automatic updates are needed, replace the standard Caddy image with a custom build that includes a Cloudflare trusted-proxy module, or regenerate `.env` from Cloudflare's published `ips-v4` and `ips-v6` endpoints.

## Route Precedence

`tasks.${DOMAIN}` is routed in this order:

1. `/oauth2/*` goes directly to oauth2-proxy.
2. MCP OAuth metadata exact paths go to agentgateway.
3. Exact `GET`/`HEAD /api/health` strips `/api` and goes to `tasks-api` `/health` without auth.
4. Exact `/api/mcp` and `/api/mcp/*` go to agentgateway and must not browser-redirect.
5. Exact `/api` and `/api/*` use oauth2-proxy auth checks, strip `/api`, and return `401/403`, not login redirects.
6. `/` uses oauth2-proxy auth checks and sends unauthenticated browsers to `/oauth2/start`, where oauth2-proxy creates OAuth state and redirects to Keycloak.

Do not use `/api/mcp*`. It would also match unwanted paths such as `/api/mcpfoo`. This config uses `/api/mcp` and `/api/mcp/*` only.

## Trusted Headers

Private APIs may read these headers only because public routes strip inbound spoofed values before auth and the gateway injects trusted values after auth:

- `X-Auth-Subject`
- `X-Auth-Email`
- `X-Auth-Groups`
- `X-Auth-Name`
- `X-Auth-Preferred-Username`

`tasks-api` consumes `X-User-ID`, `X-User-Name`, and `X-User-Email`. Caddy maps the trusted `X-Auth-*` values into those headers after auth. Use `GET /api/users/me` for initial verification; it strips to `tasks-api` `/users/me` and returns the authenticated user record that was looked up or auto-provisioned from gateway headers.

## Browser API CSRF

Unsafe methods on `/api` and `/api/*` require a same-origin `Origin` or `Referer` before proxying to `tasks-api`. MCP is separate and uses bearer auth on `/api/mcp`; do not weaken browser cookie CSRF checks to support future external API clients.

Future external API clients should get explicit bearer-auth routes, separate hosts, or separate gateway policies.

## Keycloak Bootstrap

`keycloak-bootstrap` creates:

- Realm `homelab`.
- Groups `/homelab-users`, `/tasks-users`, `/mcp-users`, and `/mcp-writers`.
- Confidential client `oauth2-proxy-tasks` with redirect URI `https://tasks.${DOMAIN}/oauth2/callback`.
- Public client `tasks-mcp` for initial local MCP testing.
- Group claim mappers and audience mappers.

Create users in Keycloak and assign groups before testing login.

## MCP Status

The intended MCP resource URI is:

```txt
https://tasks.${DOMAIN}/api/mcp
```

The protected-resource metadata route is:

```txt
https://tasks.${DOMAIN}/.well-known/oauth-protected-resource/api/mcp
```

MCP access tokens must include audience `https://tasks.${DOMAIN}/api/mcp` and group `/mcp-users`. The external `/api/mcp` route is handled by agentgateway and proxied to the real `tasks-api` Streamable HTTP MCP endpoint at `/api/mcp`. The agentgateway config is rendered from `agentgateway/config.yaml.tmpl` via the `agentgateway-bootstrap` service, so issuer, JWKS, and resource metadata stay environment-driven and no host-side script is required. Validate full MCP initialize/session behavior with Claude, ChatGPT custom MCPs, or an MCP inspector.

The MCP auth policy pattern is intended for all MCP resources, including future apps. Each MCP resource still needs its own exact OAuth protected-resource metadata path, `resource` URI, token audience, backend target, and any app-specific route match. Keep the shared requirements the same unless deliberately changed: strict MCP auth, issuer/JWKS validation, audience validation, `/mcp-users`, spoofed-header stripping, and no bearer-token forwarding to app APIs.

DCR is not enabled by default. Enable public Dynamic Client Registration only if a real remote MCP client requires it, and then restrict redirect hosts, scopes, flows, consent, and registration limits in Keycloak.

## Internal Issuer Resolution

Keycloak emits the public issuer `https://auth.${DOMAIN}/realms/homelab`. Containers must fetch that same URL internally so issuer validation does not split between internal and external names.

Compose gives Caddy a stable `auth` network IP, `172.30.1.10`, and adds `auth.${DOMAIN}` to `/etc/hosts` for oauth2-proxy and agentgateway. This is especially important for local `*.home-stack.localhost`, because many resolvers treat `.localhost` as loopback before querying Docker DNS.

## Add Another App

For each new app:

- Create a dedicated Docker network for that app.
- Attach Caddy and only the app-specific private services to that network.
- Add app-specific route precedence to `caddy/Caddyfile`.
- Add a Keycloak group such as `/newapp-users` and enforce it at the gateway, not inside the API.
- Register callback URIs or create a per-app oauth2-proxy client if shared callback handling becomes ambiguous.

## Future Service-to-Service

Future service-to-service calls should go through an internal gateway that verifies signed JWTs, strips spoofable identity headers, and injects the same trusted header contract. APIs should continue consuming trusted headers and should not each grow custom JWT verification logic.

## Run

```sh
docker compose config
docker compose up -d --build
```

Initial checks:

```sh
curl -i https://tasks.${DOMAIN}/api/health
curl -i https://tasks.${DOMAIN}/api
curl -i https://tasks.${DOMAIN}/api/users/me
curl -i https://tasks.${DOMAIN}/api/mcp
curl -i https://tasks.${DOMAIN}/.well-known/oauth-protected-resource/api/mcp
```

Only Caddy publishes host ports. Direct host access to backend API, Keycloak, Redis, Postgres, oauth2-proxy, and agentgateway ports should fail.
