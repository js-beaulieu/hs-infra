# Flow Tests

These Playwright tests validate the current (pre-migration) and migrated (post-migration) URL shapes for the home-stack auth gateway.

## Prerequisites

1. The Docker Compose stack must be running and healthy.
2. Keycloak must be bootstrapped with the realm, groups, and clients.
3. Test users must exist in Keycloak and be assigned to the correct groups.

## Test Users

- **Allowed user**: A Keycloak user in both `/homelab-users` and `/tasks-users`. Used for browser login and API tests.
- **Denied user**: A Keycloak user in `/homelab-users` but **not** in `/tasks-users`. Used to verify that group enforcement blocks access after authentication.

## Tokens

Some MCP tests require manually generated Keycloak access tokens. Generate these with the correct audience and group claims for your environment, then place them in the `.env` file.

- `MCP_TOKEN_VALID`: Valid token with the correct MCP audience and `/mcp-users` group.
- `MCP_TOKEN_WRONG_AUD`: Token with a different audience.
- `MCP_TOKEN_EXPIRED`: An expired token with the correct audience.
- `MCP_TOKEN_MISSING_GROUP`: Valid token with correct audience but lacking `/mcp-users`.

If tokens are not provided, those specific MCP token tests are skipped.

## Running Tests

### Baseline (current URL shape)

```sh
cp tests/flows/current.env.example tests/flows/current.env
# Edit tests/flows/current.env with real credentials and tokens
scripts/run-flow-tests.sh tests/flows/current.env
```

### Migrated (new URL shape)

```sh
cp tests/flows/migrated.env.example tests/flows/migrated.env
# Edit tests/flows/migrated.env with real credentials and tokens
scripts/run-flow-tests.sh tests/flows/migrated.env
```

## Rules

1. After the baseline is green, test logic, assertions, status expectations, auth expectations, spoofing checks, and security expectations must stay frozen.
2. The only changes allowed between the `current.env` and `migrated.env` runs are the URL variables (`WEB_ORIGIN`, `API_BASE`, `MCP_RESOURCE`, `MCP_METADATA`, `OAUTH2_BASE`).
3. If a non-URL test change appears necessary, stop and ask first.

## Coverage

- `app-login.spec.ts`: Browser SSO login, cookie properties, group denial, and expired/invalid session.
- `api.spec.ts`: Public health, unauthenticated protected API, authenticated API, spoofed headers, CORS preflight, CSRF, and origin checks.
- `mcp.spec.ts`: MCP metadata, unauthenticated challenge, token validation, route boundaries, and bearer forwarding rules.
