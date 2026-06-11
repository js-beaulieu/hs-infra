# Routes And Gateway Security

## Route Precedence

`api.tasks.${DOMAIN}` is routed in this order:

1. `/oauth2/*` goes directly to oauth2-proxy (callback).
1. MCP OAuth metadata exact paths go to agentgateway.
1. Exact `GET`/`HEAD /health` goes to `tasks-api` `/health` without auth.
1. Exact `/mcp` and `/mcp/*` go to agentgateway and must not browser-redirect.
1. `/` and `/*` use oauth2-proxy auth checks and return `401/403`, not login redirects.
1. Unsafe methods require `Origin: https://tasks.${DOMAIN}` or same-origin `Referer`.
1. `OPTIONS` preflight is handled before auth with CORS for `https://tasks.${DOMAIN}`.

`tasks.${DOMAIN}` is routed in this order:

1. `/oauth2/*` goes directly to oauth2-proxy.
1. MCP OAuth metadata exact paths go to agentgateway (backwards-compatible).
1. Exact `GET`/`HEAD /api/health` strips `/api` and goes to `tasks-api` `/health` without auth.
1. Exact `/api/mcp` and `/api/mcp/*` go to agentgateway.
1. Exact `/api` and `/api/*` use oauth2-proxy auth checks, strip `/api`, and return `401/403`.
1. `/` uses oauth2-proxy auth checks and sends unauthenticated browsers to `/oauth2/start`.

Do not use `/mcp*` or `/api/mcp*`. Use exact and prefix matches only.

`auth.${DOMAIN}` only proxies the intended `home-stack` realm public endpoints. The Keycloak `master` realm and arbitrary additional realms are not public through Caddy.

`tasks.${DOMAIN}` is the frontend host or local placeholder. In production, the API routes on `tasks.${DOMAIN}` are backwards-compatible; the canonical API host is `api.tasks.${DOMAIN}`.

## Trusted Headers

Private APIs may read these headers only because public routes strip inbound spoofed values before auth and the gateway injects trusted values after auth:

- `X-Auth-Subject`
- `X-Auth-Email`
- `X-Auth-Groups`
- `X-Auth-Name`
- `X-Auth-Preferred-Username`

`tasks-api` consumes `X-User-ID`, `X-User-Name`, and `X-User-Email`. Caddy maps oauth2-proxy's trusted subject/user header into `X-User-ID` and keeps email separate as `X-User-Email`; do not set `user_id_claim` unless this is revalidated against the current oauth2-proxy behavior.

Use `GET https://api.tasks.${DOMAIN}/users/me` for initial verification. The old `GET https://tasks.${DOMAIN}/api/users/me` path is kept only as a temporary compatibility route.

## Browser API CSRF

Unsafe browser API methods on `api.tasks.${DOMAIN}` require `Origin: https://tasks.${DOMAIN}` or a strict same-frontend `Referer` before proxying to `tasks-api`. API responses and preflights use credentialed CORS for that exact frontend origin only.

MCP is separate and uses bearer auth on `/mcp`; do not weaken browser cookie CSRF checks to support future external API clients.

Future external API clients should get explicit bearer-auth routes, separate hosts, or separate gateway policies.

## Internal Issuer Resolution

Keycloak emits the public issuer `https://auth.${DOMAIN}/realms/home-stack`, and tokens are validated against that public issuer. Agentgateway fetches JWKS directly from Keycloak at `http://keycloak:8080/realms/home-stack/protocol/openid-connect/certs` on the private `auth` network, avoiding `.localhost` DNS special-casing and fixed Docker IPs.

## Add Another App

For each new app:

- Create a dedicated Docker network for that app.
- Attach Caddy and only the app-specific private services to that network.
- Add app-specific route precedence to `caddy/<app>.caddy`.
- Add a Keycloak group such as `/newapp-users` and enforce it at the gateway, not inside the API.
- Register callback URIs or create a per-app oauth2-proxy client if shared callback handling becomes ambiguous.

Future service-to-service calls should go through an internal gateway that verifies signed JWTs, strips spoofable identity headers, and injects the same trusted header contract. APIs should continue consuming trusted headers and should not each grow custom JWT verification logic.
