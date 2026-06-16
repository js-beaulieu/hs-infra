# API Host Migration Implementation Plan

## Goal

Move the first app to this public URL shape:

- `https://tasks.${DOMAIN}`: frontend/static app, eligible for CDN/object hosting.
- `https://api.${DOMAIN}/tasks`: Caddy/API gateway route on the VPS.
- `https://api.${DOMAIN}/tasks/mcp`: MCP endpoint through agentgateway.
- `https://auth.${DOMAIN}`: Keycloak issuer host.

This lets DNS point the frontend host at a CDN while the API host still points at the VPS. MCP remains part of the app API instead of becoming a separate `mcp.tasks.${DOMAIN}` resource host.

## Non-Negotiable Test Discipline

Flow tests always run against the disposable Testcontainers stack managed by `tests/flows/testcontainers_stack.py`. Do not add local-stack test modes, env-var switches, or URL-shape conditionals to `tests/flows/conftest.py`.

Do not change assertions, status expectations, auth expectations, spoofing checks, or test logic to make an implementation change pass. If a test contract change appears necessary, stop and ask first.

## Test Files To Add First

Add an executable Python pytest harness before changing the stack behavior.

- `pyproject.toml`: pytest, Playwright, httpx, and testcontainers runner/dependency config.
- `tests/flows/README.md`: explains prerequisites, generated test users/tokens, and the Testcontainers-only flow-test contract.
- `tests/flows/testcontainers.env.example`: optional test-only overrides for the generated disposable stack.
- `tests/flows/flow_env.py`: reads and validates required environment variables for all tests.
- `tests/flows/test_app_login_flow.py`: real browser app login, oauth2-proxy, Keycloak redirect/form, cookie, successful user, denied user, and expired/invalid session checks.
- `tests/flows/test_api_flow.py`: httpx and Playwright request tests for health, unauthenticated protected API, spoofed identity headers, stripped authorization headers, CORS preflight, and CSRF/origin behavior.
- `tests/flows/test_mcp_flow.py`: httpx and Playwright request tests for MCP metadata, unauthenticated challenge, invalid/tampered token, wrong audience or expired token, missing group, valid token, and route boundary checks.
- `tests/flows/flow_helpers.py`: shared login, cookie/session, token, and assertion helpers used by the tests.
- `scripts/run-flow-tests.sh`: validates required tooling, loads optional Testcontainers overrides, and runs `uv run pytest`.

Use pytest for all validation tests. Browser flows use Playwright pages/contexts; API, gateway, and MCP checks use httpx unless Playwright browser context behavior is under test.

## Required Test Coverage

App login flow:

- Unauthenticated browser navigation reaches the intended login start flow, not `tasks-api`.
- Valid Keycloak user in `/homelab-users` and `/tasks-users` can authenticate.
- Authenticated browser returns to the frontend origin.
- The oauth2-proxy cookie is `Secure`, `HttpOnly`, and scoped intentionally.
- User missing `/tasks-users` is denied app/API access after authentication.
- Expired or invalid session cookie is rejected.

Normal API flow:

- Public health endpoint returns success without auth.
- Protected API route without a valid session returns `401` or `403`, not `302`.
- Protected API route with a valid session reaches `tasks-api`.
- API identity response shows Keycloak `sub` as the stable user identity.
- Spoofed inbound identity headers such as `X-Auth-Subject: attacker` are stripped and do not affect the backend identity.
- Browser API routes strip inbound `Authorization` unless an explicit bearer route is being tested.
- Unsafe methods without valid `Origin` or strict `Referer` are rejected before proxying.
- Unsafe methods from the allowed frontend origin are allowed only when authenticated.
- Cross-origin preflight accepts only the configured frontend origin after migration.
- Cross-origin preflight from an untrusted origin is rejected or returns no permissive CORS headers.

MCP flow:

- Protected-resource metadata is public and returns `resource` exactly equal to the configured MCP resource URI.
- Unauthenticated MCP request returns MCP bearer auth behavior with `WWW-Authenticate`, not oauth2-proxy browser redirect behavior.
- Browser SSO cookies alone do not authorize MCP.
- Invalid, tampered, wrong-audience, expired, or missing-group token is rejected.
- Valid MCP token with the configured audience and `/mcp-users` is accepted.
- MCP bearer token is passed only to agentgateway and is not forwarded to `tasks-api`.
- Route boundary is exact: `/tasks/mcpfoo` does not match the MCP route.

## Implementation Phases

### Phase 1: Baseline Behavior

1. Add the flow test files and script listed above.
1. Run `scripts/run-flow-tests.sh`.
1. Fix stack behavior only if tests reveal a real bug.
1. Repeat until the Testcontainers flow suite is green.
1. Freeze test logic after green; implementation changes should not weaken the test contract.

### Phase 2: Change Gateway URL Shape

1. Change the stack implementation to generate the intended API/MCP URL shape in the disposable Testcontainers environment.
1. Do not change test expectations unless the API contract itself is deliberately changing.
1. Run `scripts/run-flow-tests.sh` and confirm failures are implementation failures.

### Phase 3: Caddy Routing

Update `caddy/Caddyfile` and `caddy/tasks.caddy`.

- Keep `auth.{$DOMAIN}` behavior unchanged unless required for callback/DCR compatibility.
- Add `api.{$DOMAIN}` as the public API site.
- Move `/oauth2/*` handling from `tasks.{$DOMAIN}` to shared `api.{$DOMAIN}/oauth2/*`.
- Move public health from `/api/health` to `/tasks/health`.
- Keep Huma-generated `GET /tasks/openapi.json`, `/tasks/openapi.yaml`, `/tasks/openapi-3.0.json`, `/tasks/openapi-3.0.yaml`, `/tasks/docs`, and `/tasks/schemas/{schema}` public before the protected API catch-all.
- Move MCP from `/api/mcp` and `/api/mcp/*` to `/tasks/mcp` and `/tasks/mcp/*`.
- Move MCP protected-resource metadata from `/.well-known/oauth-protected-resource/api/mcp` to `/tasks/.well-known/oauth-protected-resource/mcp`.
- Keep agentgateway authorization-server proxy routes only if we deliberately keep agentgateway AS-proxy/DCR compatibility.
- Strip `/tasks` before proxying normal API routes to `tasks-api`.
- Add strict CORS on browser API responses for `Origin: https://tasks.{$DOMAIN}`.
- Add `OPTIONS` preflight handling before oauth2-proxy auth for allowed browser API routes.
- Keep unsafe-method CSRF checks before proxying to `tasks-api`.
- Keep `/tasks/mcp` and MCP metadata routes before normal API catch-all.
- Return `401` or `403` for unauthenticated API fetches, not browser redirects.
- Strip spoofable identity headers on every public route.
- Strip inbound `Authorization` on normal browser API routes.
- Preserve `Authorization` only as far as agentgateway on MCP routes.

If production DNS points `tasks.${DOMAIN}` to a CDN, Caddy should not be the authoritative public route for that host in production. Keep any `tasks.{$DOMAIN}` site block only for local/dev placeholder serving or intentional fallback.

### Phase 4: oauth2-proxy

Update `oauth2-proxy/oauth2-proxy.cfg` only if needed.

- Keep one oauth2-proxy instance.
- Change cookie name from `__Host-oauth2_proxy` to `__Secure-oauth2_proxy` because `__Host-` cookies cannot share across subdomains. The frontend (`tasks.${DOMAIN}`) and API gateway (`api.${DOMAIN}`) must share the SSO session.
- Add `cookie_domains = [".${DOMAIN}"]` so the browser sends the session cookie to both `tasks.${DOMAIN}` and `api.${DOMAIN}`.
- Keep `cookie_secure = true` and `cookie_httponly = true`.
- Keep `cookie_samesite = "lax"` unless testing proves the API-host login flow requires a different value.
- Keep `set_xauthrequest = true`.
- Do not set `user_id_claim`.
- Do not set `prefer_email_to_user`.

Update `docker/core.yml` oauth2-proxy environment:

- `OAUTH2_PROXY_REDIRECT_URL=https://api.${DOMAIN}/oauth2/callback`.
- `OAUTH2_PROXY_WHITELIST_DOMAINS` includes the frontend return host and API host as required by oauth2-proxy redirect validation.

### Phase 5: Keycloak Bootstrap

Update `keycloak/bootstrap.sh`.

- Change the `oauth2-proxy-tasks` redirect URI to `https://api.$DOMAIN/oauth2/callback`.
- Set browser client web origins to include `https://tasks.$DOMAIN` and `https://api.$DOMAIN` where Keycloak requires it.
- Keep groups and group mappers unchanged.
- Keep the MCP audience mapper driven by `$MCP_RESOURCE_URI`.
- Review the `tasks-mcp` public client redirect URIs and web origins for `api.$DOMAIN`.
- Do not enable anonymous DCR unless registration policies are explicitly configured.

### Phase 6: agentgateway

Update `agentgateway/config.yaml.tmpl`.

- Change protected-resource metadata match to `/tasks/.well-known/oauth-protected-resource/mcp`.
- Change MCP traffic matches to exact `/tasks/mcp` and prefix `/tasks/mcp/`.
- Set protected-resource metadata `resource` to `${MCP_RESOURCE_URI}`.
- Keep issuer, JWKS, audience validation, `/mcp-users`, spoofed-header stripping, and trusted-header injection.
- Keep backend target as `http://tasks-api:8080/mcp`.
- Treat `/tasks/.well-known/oauth-authorization-server/mcp` and `/tasks/.well-known/oauth-authorization-server/mcp/client-registration` as optional agentgateway AS-proxy/DCR compatibility routes, not RFC-required protected-resource metadata.

Update `docker/core.yml` agentgateway/keycloak bootstrap environment:

- `MCP_RESOURCE_URI=https://api.${DOMAIN}/tasks/mcp`.

### Phase 7: Environment And Local TLS

Update `.env.example`.

- Add `api.home-stack.localhost` to the mkcert command.
- Document production DNS:
  - `auth.${DOMAIN}` points to the VPS/Caddy.
  - `api.${DOMAIN}` points to the VPS/Caddy.
  - `tasks.${DOMAIN}` points to the CDN/static host.
- Keep local docs clear that `tasks-web` is a local placeholder if the frontend is otherwise CDN-hosted.

### Phase 8: Documentation

Update `README.md` and `docs/planning/implementation-plan.md`.

- Replace `tasks.${DOMAIN}/api` with `api.${DOMAIN}/tasks`.
- Replace `tasks.${DOMAIN}/api/mcp` with `api.${DOMAIN}/tasks/mcp`.
- Replace MCP metadata path with `api.${DOMAIN}/tasks/.well-known/oauth-protected-resource/mcp`.
- Explain that CDN/static frontend hosting moves auth enforcement to API/data calls.
- Document that frontend fetches must use credentials.
- Document CORS and CSRF expectations.
- Document that agentgateway AS-proxy/DCR routes are optional compatibility routes if kept.
- Update curl checks and validation checklist.

Update `tasks-web/index.html` if it remains in the repo.

- Change copy to say API is on `api.${DOMAIN}/tasks` and MCP is `/tasks/mcp`.
- Keep it clearly positioned as a local placeholder if production frontend is CDN-hosted.

## Development Loop

Run this loop after Phase 2.

1. Run `task lint`.
1. Run Caddy validation if the container/tooling is available.
1. Start or restart the stack.
1. Run `scripts/run-flow-tests.sh`.
1. Fix implementation files only.
1. Do not modify tests to weaken the contract.
1. If a test contract change appears necessary, stop and ask.
1. Repeat until all flow tests pass.

## Acceptance Criteria

1. The repo contains executable Playwright flow tests and a script that runs them.
1. The tests validate and lock in green flows for app login, API, and MCP using an isolated Testcontainers stack.
1. The tests cover authenticated, unauthenticated, spoofed-header, invalid or expired credential, app login, normal API, and MCP flows.
1. After the baseline is green, implementation changes must preserve the same test contract unless a contract change is explicitly approved.
1. The implementation loop runs the Testcontainers flow tests repeatedly until they pass.
1. No test logic, assertions, status expectations, auth expectations, spoofing expectations, or security expectations are changed after the baseline is green without asking first.
1. `tasks.${DOMAIN}` can be hosted by a CDN/static provider without proxying through the VPS for `/api` path routing.
1. `api.${DOMAIN}` serves public `/tasks/health`, public Huma docs/spec/schema routes, normal protected `/tasks` API routes, `/tasks/mcp`, and MCP metadata through Caddy on the VPS.
1. Browser API calls from `tasks.${DOMAIN}` to `api.${DOMAIN}/tasks` work only with strict allowed-origin CORS and credentials.
1. Untrusted origins do not receive permissive credentialed CORS.
1. Unsafe browser API methods are protected by gateway-level CSRF origin checks.
1. Unauthenticated API requests return `401` or `403`, not browser login redirects.
1. MCP requests never receive oauth2-proxy browser redirects.
1. MCP protected-resource metadata advertises `resource` exactly equal to `https://api.${DOMAIN}/tasks/mcp`.
1. Keycloak MCP audience mapper and agentgateway audience validation both use `https://api.${DOMAIN}/tasks/mcp`.
1. Spoofed inbound identity headers are stripped before reaching backends.
1. Browser API routes do not forward inbound `Authorization` headers.
1. MCP bearer tokens are sent only to agentgateway and are not forwarded to `tasks-api`.
1. Existing security controls for Keycloak admin exposure, trusted proxies, and private backend ports remain intact.
