# Production Deployment

## HTTPS

For production, leave `CADDY_TLS_DIRECTIVE` empty and point DNS:

- `auth.${DOMAIN}` -> VPS/Caddy
- `api.tasks.${DOMAIN}` -> VPS/Caddy
- `tasks.${DOMAIN}` -> CDN/static host

Caddy will use ACME/Let's Encrypt for the API host.

If the origin is behind Cloudflare proxy, set:

- `CADDY_TRUSTED_PROXIES` to the current Cloudflare IPv4 and IPv6 CIDR list.
- `KEYCLOAK_ADMIN_REMOTE_IP_RANGES` to the same Cloudflare CIDR list.
- `KEYCLOAK_ADMIN_CLIENT_IP_RANGES` to your real admin public CIDR allowlist.

This enforces both required checks for Keycloak admin paths: the immediate peer must be Cloudflare, and the derived client IP must be an allowed admin IP. Do not trust `CF-Connecting-IP` or `X-Forwarded-For` from arbitrary direct peers. Prefer firewalling origin ports `80` and `443` to Cloudflare ranges plus explicit management networks.

Cloudflare CIDRs are managed statically in `.env` for now. If automatic updates are needed, replace the standard Caddy image with a custom build that includes a Cloudflare trusted-proxy module, or regenerate `.env` from Cloudflare's published `ips-v4` and `ips-v6` endpoints.

## GitHub Actions

Routine production runs use `.github/workflows/deploy.yml` on pushes to `main` and `workflow_dispatch`. The workflow runs `ansible/playbooks/site.yml` first to converge the host baseline, then `ansible/playbooks/deploy.yml` to deploy the stack.

Bootstrap is local-only and should be run once from your workstation to create the VM baseline, users, and SSH access. See [Ansible deployment](ansible.md).
