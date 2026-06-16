# Production Deployment

## HTTPS

Caddy uses DNS-01 ACME challenges via the Cloudflare DNS plugin for TLS certificates. This is required when domains are behind the Cloudflare proxy (orange cloud), because HTTP-01 challenges cannot reach the origin directly.

The Caddyfile includes a `dns_cloudflare` snippet that reads `{$CF_API_TOKEN}` for DNS-01 challenges. Set `home_stack_cloudflare_api_token` in `vault.sops.yml` to a Cloudflare API token with **Zone:DNS:Edit** permission on the relevant zone. Create the token at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) with the following settings:

- Permissions: Zone - DNS - Edit
- Zone Resources: Include - Specific zone - `your-domain.com`

Leave `home_stack_caddy_tls_include` as `tls_cloudflare.caddy` (the default) for production — Caddy will obtain and renew certificates automatically via DNS-01 when `CF_API_TOKEN` is set.

The custom Caddy image (`ghcr.io/js-beaulieu/caddy-cloudflare:2-alpine`) includes the `caddy-dns/cloudflare` plugin required for DNS-01 challenges.

Production deploys default to Cloudflare origin protection. When `home_stack_firewall_web_exposure: cloudflare`, Ansible fetches Cloudflare edge CIDRs from Cloudflare's official `ips-v4` and `ips-v6` endpoints during `site.yml` and `deploy.yml`, then uses those ranges for the host firewall, Caddy trusted proxies, and Keycloak admin remote-IP checks.

Set in `vault.sops.yml`:

- `home_stack_admin_cidrs` to your real admin public CIDR allowlist.
- `home_stack_keycloak_admin_client_ip_ranges` only if Keycloak admin access should use a different client CIDR list.

This enforces both required checks for Keycloak admin paths: the immediate peer must be Cloudflare, and the derived client IP must be an allowed admin IP. Do not trust `CF-Connecting-IP` or `X-Forwarded-For` from arbitrary direct peers. Prefer firewalling origin ports `80` and `443` to Cloudflare ranges plus explicit management networks.

Override `home_stack_cloudflare_cidrs`, `home_stack_caddy_trusted_proxies`, or `home_stack_keycloak_admin_remote_ip_ranges` only when you intentionally need a static or non-Cloudflare edge list.

## GitHub Actions

Routine production runs use `.github/workflows/deploy.yml` on pushes to `main` and `workflow_dispatch`. The workflow runs `ansible/playbooks/deploy.yml` to deploy the stack. It also runs a `build-caddy` job that rebuilds and pushes the Caddy image to GHCR when `caddy/Dockerfile` changes.

Bootstrap is local-only and should be run once from your workstation to create the VM baseline, users, and SSH access. See [Ansible deployment](ansible.md).
