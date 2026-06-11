# Production Deployment

## HTTPS

For production, leave `CADDY_TLS_DIRECTIVE` empty and point DNS:

- `auth.${DOMAIN}` -> VPS/Caddy
- `api.tasks.${DOMAIN}` -> VPS/Caddy
- `tasks.${DOMAIN}` -> CDN/static host

Caddy will use ACME/Let's Encrypt for the API host.

Production deploys default to Cloudflare origin protection. When `home_stack_firewall_web_exposure: cloudflare`, Ansible fetches Cloudflare edge CIDRs from Cloudflare's official `ips-v4` and `ips-v6` endpoints during `site.yml` and `deploy.yml`, then uses those ranges for the host firewall, Caddy trusted proxies, and Keycloak admin remote-IP checks.

Set in `vault.sops.yml`:

- `home_stack_admin_cidrs` to your real admin public CIDR allowlist.
- `home_stack_keycloak_admin_client_ip_ranges` only if Keycloak admin access should use a different client CIDR list.

This enforces both required checks for Keycloak admin paths: the immediate peer must be Cloudflare, and the derived client IP must be an allowed admin IP. Do not trust `CF-Connecting-IP` or `X-Forwarded-For` from arbitrary direct peers. Prefer firewalling origin ports `80` and `443` to Cloudflare ranges plus explicit management networks.

Override `home_stack_cloudflare_cidrs`, `home_stack_caddy_trusted_proxies`, or `home_stack_keycloak_admin_remote_ip_ranges` only when you intentionally need a static or non-Cloudflare edge list.

## GitHub Actions

Routine production runs use `.github/workflows/deploy.yml` on pushes to `main` and `workflow_dispatch`. The workflow runs `ansible/playbooks/site.yml` first to converge the host baseline, then `ansible/playbooks/deploy.yml` to deploy the stack.

Bootstrap is local-only and should be run once from your workstation to create the VM baseline, users, and SSH access. See [Ansible deployment](ansible.md).
