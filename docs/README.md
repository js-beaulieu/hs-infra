# Documentation

## Architecture

- [Overview](architecture/overview.md): services, Compose layout, and accepted production tradeoffs.
- [Routes and gateway security](architecture/routes.md): route precedence, trusted headers, CSRF, and app-extension guidance.
- [MCP gateway](architecture/mcp.md): MCP resource metadata, token audience, DCR, and compatibility notes.
- [Keycloak](architecture/keycloak.md): realm bootstrap and token lifetime notes.

## Development

- [Local development](development/local.md): local environment, mkcert TLS, local Docker run, and Vagrant VM flow.

## Deployment

- [Ansible deployment](deployment/ansible.md): production bootstrap, host convergence, deploy workflow, and local VM testing.
- [Production deployment](deployment/production.md): production HTTPS, Cloudflare proxy guidance, and GitHub Actions deploy flow.

## Planning

- [Implementation plan](planning/implementation-plan.md): historical implementation notes and architecture plan.
- [API host migration plan](planning/api-host-migration-plan.md): historical API host migration checklist.
