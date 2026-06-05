# Flow Tests

These Playwright tests validate the current (pre-migration) and migrated (post-migration) URL shapes for the home-stack auth gateway.

## Prerequisites

1. The Docker Compose stack must be running and healthy.
2. Keycloak must be bootstrapped with the realm, groups, and clients.
3. The flow env file must include Keycloak admin credentials so setup can create and verify temporary test users.

## Test Users

- **Allowed user**: Created automatically with verified email and membership in `/homelab-users` and `/tasks-users`. Used for browser login and API tests.
- **Denied user**: Created automatically with verified email and membership in `/homelab-users` only. Used to verify that group enforcement blocks access after authentication.
- **MCP user**: Created automatically with verified email and membership in `/homelab-users` and `/mcp-users`. Used to obtain valid MCP bearer tokens.

Setup writes generated credentials to `tests/flows/.generated-users.json`; teardown deletes those users and removes that file. `TEST_USER_PREFIX`, `TEST_USER_PASSWORD`, and `TEST_DENIED_USER_PASSWORD` may be set in the env file to customize generated users.

## Tokens

MCP token tests require Keycloak access tokens with specific audience and group claims. These tokens are **generated automatically** during global setup when `KEYCLOAK_ADMIN_PASSWORD` is configured. The setup:

1. Creates a temporary MCP test user in `/mcp-users` and temporary confidential Keycloak clients with the appropriate audience mappers.
2. Uses the Keycloak token endpoint (Resource Owner Password Credentials grant) to obtain:
   - `MCP_TOKEN_VALID`: Valid token with the correct MCP audience and `/mcp-users` group.
   - `MCP_TOKEN_WRONG_AUD`: Token with a different audience.
   - `MCP_TOKEN_EXPIRED`: An expired token (1-second lifespan, waited out).
   - `MCP_TOKEN_MISSING_GROUP`: Valid token with correct audience but lacking `/mcp-users` (uses the denied user).
3. Cleans up the temporary clients after token generation.

Tokens are written to `tests/flows/.generated-tokens.json` and cleaned up by teardown. To override with manually generated tokens, set the environment variables directly.

## Running Tests

### Isolated Testcontainers Stack

This mode starts a disposable Docker Compose project with random host ports and test-scoped volumes, so it does not publish `80`/`443` or reuse the real `home-stack` project resources.

```sh
scripts/run-flow-tests.sh tests/flows/testcontainers.env.example
```

The setup generates the Playwright URL env file after the random HTTPS port is known, creates temporary Keycloak users, and tears the Compose project down at the end.

### Baseline (local stack)

```sh
# Edit tests/flows/local.env with Keycloak admin credentials and optional tokens
scripts/run-flow-tests.sh tests/flows/local.env
```

## Rules

1. After the baseline is green, test logic, assertions, status expectations, auth expectations, spoofing checks, and security expectations must stay frozen.
2. The only changes allowed between the `current.env` and `migrated.env` runs are the URL variables (`WEB_ORIGIN`, `API_BASE`, `MCP_RESOURCE`, `MCP_METADATA`, `OAUTH2_BASE`).
3. If a non-URL test change appears necessary, stop and ask first.

## Coverage

- `app-login.spec.ts`: Browser SSO login, cookie properties, group denial, and expired/invalid session.
- `api.spec.ts`: Public health, unauthenticated protected API, authenticated API, spoofed headers, CORS preflight, CSRF, and origin checks.
- `mcp.spec.ts`: MCP metadata, unauthenticated challenge, token validation, route boundaries, and bearer forwarding rules.
