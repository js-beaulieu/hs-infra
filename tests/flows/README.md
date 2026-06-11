# Flow Tests

These Python pytest tests use Playwright and httpx to validate the home-stack auth gateway against a disposable Testcontainers-backed Docker Compose stack.

## Prerequisites

1. Docker must be available.
2. Python tooling must be installed through `uv sync --locked`.
3. Playwright Chromium must be installed with `uv run --group dev playwright install chromium`.

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

This mode starts a disposable Docker Compose project with random host ports and test-scoped volumes, so it does not publish `80`/`443` or reuse the real `home-stack` project resources.

```sh
scripts/run-flow-tests.sh tests/flows/testcontainers.env.example
```

or through the Taskfile:

```sh
task test
```

The setup always starts a disposable Compose project with random host ports, generates the runtime flow URL env file after the random HTTPS port is known, creates temporary Keycloak users, and tears the Compose project down at the end. Override files such as `tests/flows/testcontainers.env.example` may set test-only values like `FLOW_TEST_DOMAIN`, `TEST_USER_PREFIX`, and `FLOW_TEST_KEEP_TESTCONTAINERS`; they do not point tests at a pre-existing local stack.

## Rules

1. Flow tests must always use the Testcontainers stack from `tests/flows/testcontainers_stack.py`.
2. Do not add local-stack conditionals or `FLOW_TEST_USE_TESTCONTAINERS`-style switches to `conftest.py`.
3. If a test contract change appears necessary, stop and ask first.

## Coverage

- `test_app_login_flow.py`: Browser SSO login, cookie properties, group denial, and expired/invalid session.
- `test_api_flow.py`: Public health, unauthenticated protected API, authenticated API, spoofed headers, CORS preflight, CSRF, and origin checks.
- `test_mcp_flow.py`: MCP metadata, unauthenticated challenge, token validation, route boundaries, and bearer forwarding rules.
