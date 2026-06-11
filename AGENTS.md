# AGENTS.md

## Architecture

- All Docker Compose config lives in `docker/` — not the repo root.
- `docker/compose.yml` is the thin entrypoint; it includes `docker/core.yml` (shared infra) and `docker/tasks.yml` (Tasks app services).
- Caddy is the only service publishing host ports. Every other service is private-Docker-network only.
- Postgres is shared by Keycloak and tasks-api via separate databases, each on its own Docker network.
- Auth stays at the gateway boundary: APIs consume trusted identity headers (`X-Auth-*`) injected by Caddy, oauth2-proxy, or agentgateway — never write JWT verification into individual APIs.
- Human-facing docs live in `docs/`; keep `README.md` as a concise entrypoint and keep agent-specific instructions in this file.

## Commands

```
task start          # docker compose up -d --build
task stop           # docker compose down
task test           # run Python Playwright/httpx flow tests in Testcontainers
task lint           # validate compose, caddy, oauth2-proxy, agentgateway, github-actions, sh
task format         # ruff, yamlfix, and mdformat checks
task format:write   # run ruff, yamlfix, and mdformat in-place
task ci             # run test, lint, format in parallel
task sops:keygen    # generate age key pair, write .sops.yaml with recipient
task sops:edit      # decrypt, open vault in $EDITOR, re-encrypt on save
task sops:view      # decrypt and print the full vault to stdout
task sops:get -- KEY # print a single vault value
task sops:encrypt   # encrypt vault.sops.yml in place
```

- `task test` always starts an isolated Testcontainers Compose project; no pre-existing local stack is used.
- Flow tests use `scripts/run-flow-tests.sh` and require `FLOW_TEST_ENV_FILE` or a `.env` file passed in.
- Local VM work uses Vagrant/libvirt through `task vm:up`, `task vm:provision`, `task vm:deploy`, and `task vm:test`.

## Testing

- All tests live in `tests/flows/` and use pytest with Playwright for browser checks and httpx for HTTP checks.
- `tests/flows/testcontainers_stack.py` manages an isolated Docker Compose project through testcontainers with randomized ports and project name. This is the only supported Python flow-test mode.
- `tests/flows/keycloak_setup.py` creates Keycloak test users, groups, and MCP tokens via `docker exec` into the Keycloak container.
- Flow tests generate their URL shape from the disposable Testcontainers stack at runtime. Do not add local-stack conditionals to `tests/flows/conftest.py`.
- Never change non-URL test logic after baseline is green without asking.

## Gotchas

- `docker/compose.*.yml` paths use relative dirs like `../caddy`, `../keycloak` etc. — those resolve relative to the compose file inside `docker/`, so the `-f docker/compose.yml` prefix matters.
- `.env` is gitignored; `.env.example` at the repo root is the template.
- Compose files live in `docker/` so `.env` resolves relative to that dir — always use `--env-file .env` to point at the repo root.
- Keycloak bootstrap is idempotent — runs every start, creates realm/clients/groups/mappers if missing.
- Agentgateway config is rendered from `docker/agentgateway/config.yaml.tmpl` by `agentgateway-bootstrap` at startup; `docker/agentgateway/config.yaml` is gitignored.
- oauth2-proxy must NOT set `user_id_claim` — an oauth2-proxy bug causes email claim corruption when it's set explicitly.
- MCP access tokens intentionally default to 1-year lifespan (`MCP_ACCESS_TOKEN_LIFESPAN_SECONDS`) to work around long-standing MCP client refresh/re-auth bugs; oauth2-proxy tokens stay at 5 minutes. Do not flag this as an accidental production-readiness issue unless the user asks to revisit the MCP compatibility tradeoff. Context: https://github.com/anthropics/claude-code/issues/26281, https://github.com/axiomhq/mcp/pull/63, https://github.com/Doist/todoist-mcp/issues/400#issuecomment-4096763597.
- `ghcr.io/js-beaulieu/tasks-api:latest` is intentional for this single-environment homelab stack and planned Watchtower-style updates. Do not flag the user's own mutable app image tag as a production-readiness issue; third-party service tags should still stay explicit.
- App APIs own their own database migrations. This repo provisions Postgres databases/users/grants only; do not flag missing app migration orchestration here unless the user asks to revisit that boundary.
- Backups/restore automation is intentionally deferred. You may mention it only when the user asks for backup/DR work, not as a repeated production-readiness finding.
- `tasks-web` is a temporary placeholder/local static frontend. Do not treat the placeholder as a blocker unless the task is specifically about frontend production rollout.
- MCP Dynamic Client Registration is intentionally enabled for connector onboarding. Do not tighten or remove DCR without explicit user direction; document and test the current allowlist behavior instead.
- Production bootstrap is local-only and one-time from the user's workstation. GitHub Actions deploys run `site.yml` then `deploy.yml` on `main`.
- Local Vagrant inventory is `ansible/inventories/local-vagrant/`; do not reintroduce the old `local-vm` inventory path.
- yamlfix must exclude `**/*.sops.yml` and `.sops.yaml` — the Taskfile handles this, but manual yamlfix runs that skip these excludes will corrupt encrypted SOPS files.

## Documentation Invariants

When editing workflow files, role defaults, or deployment docs, verify these mappings stay consistent:

- Secrets and vars listed in `docs/deployment/ansible.md` must match exactly what `.github/workflows/deploy.yml` references via `${{ secrets.* }}` and `${{ vars.* }}`.
- Role default variables referenced in docs must still exist in `ansible/roles/*/defaults/main.yml`.
- Inventory env lookups in `ansible/inventories/production/hosts.github-actions.yml` must have corresponding vars/secrets in the workflow, or a fallback expression.
- If a workflow env var has a fallback (like `GIT_REPO` defaulting to the current repo URL), the docs must note it as optional with its fallback.
- When adding or removing a workflow step that uses a secret or var, update the docs' required secrets/vars lists to match.

## Style

- Compose services always declare explicit `networks:` — no implicit default network.
- Offline one-shot services (agentgateway-bootstrap) use `network_mode: none`.
- Route config lives in `caddy/Caddyfile` (shared) + `caddy/*.caddy` (per-app).
- Taskfile is the canonical task runner — use `task <name>`, not raw `docker compose` commands in CI/docs.
