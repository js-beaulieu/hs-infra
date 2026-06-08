# AGENTS.md

## Architecture

- All Docker Compose config lives in `docker/` — not the repo root.
- `docker/compose.yml` is the thin entrypoint; it includes `docker/core.yml` (shared infra) and `docker/tasks.yml` (Tasks app services).
- Caddy is the only service publishing host ports. Every other service is private-Docker-network only.
- Postgres is shared by Keycloak and tasks-api via separate databases, each on its own Docker network.
- Auth stays at the gateway boundary: APIs consume trusted identity headers (`X-Auth-*`) injected by Caddy, oauth2-proxy, or agentgateway — never write JWT verification into individual APIs.

## Commands

```
task start          # docker compose up -d --build
task stop           # docker compose down
task test           # run Python Playwright/httpx flow tests (current URL shape)
task lint           # validate compose, caddy, oauth2-proxy, agentgateway, shellcheck
task format         # npx prettier --check .
task format:write   # npx prettier --write .
task ci             # run test, lint, format in parallel
```

- `task test` passes args through, so `task test -- tests/flows/migrated.env` works.
- Flow tests use `scripts/run-flow-tests.sh` and require `FLOW_TEST_ENV_FILE` or a `.env` file passed in.

## Testing

- All tests live in `tests/flows/` and use pytest with Playwright for browser checks and httpx for HTTP checks.
- `tests/flows/testcontainers_stack.py` manages an isolated Docker Compose project through testcontainers with randomized ports and project name. Use `FLOW_TEST_USE_TESTCONTAINERS=1` to enable it.
- `tests/flows/keycloak_setup.py` creates Keycloak test users, groups, and MCP tokens via `docker exec` into the Keycloak container.
- Flow tests have two URL shapes: current (`current.env`) and migrated (`migrated.env`). Tests are the same; only URL variables differ.
- Never change non-URL test logic after baseline is green without asking.

## Gotchas

- `docker/compose.*.yml` paths use relative dirs like `../caddy`, `../keycloak` etc. — those resolve relative to the compose file inside `docker/`, so the `-f docker/compose.yml` prefix matters.
- `.env` is gitignored; `.env.example` at the repo root is the template.
- Compose files live in `docker/` so `.env` resolves relative to that dir — always use `--env-file .env` to point at the repo root.
- Keycloak bootstrap is idempotent — runs every start, creates realm/clients/groups/mappers if missing.
- Agentgateway config is rendered from `docker/agentgateway/config.yaml.tmpl` by `agentgateway-bootstrap` at startup; `docker/agentgateway/config.yaml` is gitignored.
- oauth2-proxy must NOT set `user_id_claim` — an oauth2-proxy bug causes email claim corruption when it's set explicitly.
- MCP access tokens default to 1-year lifespan (`MCP_ACCESS_TOKEN_LIFESPAN_SECONDS`) to avoid MCP client re-auth bugs; oauth2-proxy tokens stay at 5 minutes.

## Style

- Compose services always declare explicit `networks:` — no implicit default network.
- Offline one-shot services (agentgateway-bootstrap) use `network_mode: none`.
- Route config lives in `caddy/Caddyfile` (shared) + `caddy/*.caddy` (per-app).
- Taskfile is the canonical task runner — use `task <name>`, not raw `docker compose` commands in CI/docs.
