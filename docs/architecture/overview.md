# Architecture Overview

## Services

- `caddy`: only public entrypoint, publishes `80` and `443`.
- `keycloak`: IdP at `https://auth.${DOMAIN}/realms/home-stack`.
- `postgres`: shared private database for Keycloak and tasks-api.
- `oauth2-proxy`: browser SSO/session checks for app hosts and API hosts sharing a parent-domain session cookie.
- `redis`: private oauth2-proxy session store.
- `agentgateway`: MCP OAuth/resource gateway for `/tasks/mcp` on `api.${DOMAIN}`.
- `tasks-api`: private placeholder API on the `tasks-api` network.
- `tasks-web`: private static placeholder for browser `/` on a separate frontend network.
- `postgres-bootstrap`: idempotently creates databases, users, and grants for every service that needs Postgres, on every start.
- `keycloak-bootstrap`: idempotently creates the realm, groups, clients, and protocol mappers, on every start.
- `agentgateway-bootstrap`: renders `agentgateway/config.yaml` from `config.yaml.tmpl` via `envsubst` inside a container, on every start.

Every service has explicit network membership. There is no implicit shared default app network. Postgres is attached to separate Keycloak and tasks database networks so app services do not join the Keycloak DB network directly.

Auth stays at the gateway boundary. Private APIs consume trusted identity headers injected by Caddy, oauth2-proxy, or agentgateway.

## Compose Layout

`docker/compose.yml` is the default entrypoint and includes the shared platform file plus the Tasks app file:

- `docker/core.yml`: Caddy, Keycloak, oauth2-proxy, Redis, Postgres, agentgateway, and shared networks/volumes.
- `docker/tasks.yml`: Tasks services plus Tasks-specific network attachments for Caddy, agentgateway, and Postgres.
- `caddy/Caddyfile`: shared Caddy options/snippets and Keycloak routes.
- `caddy/tasks.caddy`: Tasks web/API/MCP routes.

Only Caddy publishes host ports. Direct host access to backend API, Keycloak, Redis, Postgres, oauth2-proxy, and agentgateway ports should fail. The frontend container and API container are on separate Docker networks; only Caddy and agentgateway share the private API network with `tasks-api`.

## Accepted Production Tradeoffs

This stack is production-oriented for a personal homelab, not a multi-environment commercial platform. These choices are intentional unless explicitly revisited:

- `tasks-api` uses a mutable `latest` tag for the user's own service. Third-party platform services remain pinned to explicit upstream version tags.
- App APIs own their schema migration process. This repo only provisions the shared Postgres instance, databases, users, and grants.
- Database/volume backups and restore drills are a later operational work item. Persistent volumes are defined, but this repo does not yet automate backups.
- The bundled `tasks-web` service is a temporary local/static placeholder. Production frontend hosting may move to a CDN/static origin while keeping the same gateway/API contract.
- MCP Dynamic Client Registration is deliberately enabled for client onboarding. Scope and trusted-host restrictions are configured here, but further tightening should wait for real Claude/ChatGPT connector validation.

Image versions live in `docker/core.yml` for shared platform services and `docker/tasks.yml` for the Tasks app. The Tasks API intentionally tracks `ghcr.io/js-beaulieu/tasks-api:latest` because this is a single-environment homelab stack and app updates are expected to be automated by Watchtower or an equivalent updater.
