# Homelab Auth Gateway

Docker Compose stack for a personal homelab auth gateway. Auth stays at the gateway boundary: private APIs consume trusted identity headers injected by Caddy, oauth2-proxy, or agentgateway.

## Architecture

- Caddy is the only public entrypoint and the only service publishing host ports.
- Keycloak provides the `home-stack` realm.
- oauth2-proxy handles browser SSO/session checks.
- agentgateway handles MCP OAuth/resource gateway routes.
- Postgres is shared privately by Keycloak and Tasks with separate databases and Docker networks.
- Tasks API and Tasks web run behind the gateway; APIs trust gateway-injected identity headers, not direct JWT verification.

See [architecture overview](docs/architecture/overview.md) for service details and Compose layout.

## Quick Start

Copy `.env.example` to `.env`, replace placeholder secrets, then run:

```sh
task start
```

Useful commands:

```sh
task start          # docker compose up -d --build
task stop           # docker compose down
task test           # isolated Testcontainers flow tests
task lint           # compose, caddy, oauth2-proxy, agentgateway, shellcheck
task format         # ruff, yamlfix, and mdformat checks
task ci             # test, lint, and format
```

See [local development](docs/development/local.md) for local TLS, initial checks, and VM testing.

## Production

Production host bootstrap is local-only and should be run once from your workstation. Routine production runs happen through `.github/workflows/deploy.yml` on pushes to `main` or manual dispatch; the workflow runs `site.yml` first, then `deploy.yml`.

See [Ansible deployment](docs/deployment/ansible.md) and [production deployment](docs/deployment/production.md).

## Documentation

- [Docs index](docs/README.md)
- [Architecture overview](docs/architecture/overview.md)
- [Routes and gateway security](docs/architecture/routes.md)
- [MCP gateway](docs/architecture/mcp.md)
- [Keycloak](docs/architecture/keycloak.md)
- [Local development](docs/development/local.md)
- [Production deployment](docs/deployment/production.md)
- [Ansible deployment](docs/deployment/ansible.md)
