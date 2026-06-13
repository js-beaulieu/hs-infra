# Local Development

## Environment

Copy `.env.example` to `.env` and replace all placeholder secrets.

Required generated secrets:

- `KEYCLOAK_ADMIN_PASSWORD`
- `KEYCLOAK_DB_PASSWORD`
- `OAUTH2_PROXY_CLIENT_SECRET`
- `OAUTH2_PROXY_COOKIE_SECRET`

Generate the cookie secret with:

```sh
openssl rand -base64 32 | tr '+/' '-_'
```

## Local HTTPS

Use mkcert for local TLS so browsers, oauth2-proxy, and agentgateway can trust the same local CA. Local domains use `*.home-stack.localhost`, so `auth.home-stack.localhost`, `api.home-stack.localhost`, and `tasks.home-stack.localhost` resolve to loopback without editing `/etc/hosts`.

```sh
mkcert -install
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem auth.home-stack.localhost api.home-stack.localhost tasks.home-stack.localhost
cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem
```

The local `.env` values intentionally do not use Cloudflare as a trusted proxy. Local admin access is controlled by direct/private peer ranges:

```dotenv
DOMAIN=home-stack.localhost
CADDY_TLS_DIRECTIVE="tls /certs/local.pem /certs/local-key.pem"
CADDY_TRUSTED_PROXIES="127.0.0.1/32 ::1/128"
KEYCLOAK_ADMIN_REMOTE_IP_RANGES="private_ranges"
KEYCLOAK_ADMIN_CLIENT_IP_RANGES="private_ranges"
OAUTH2_PROXY_PROVIDER_CA_FILES=/certs/rootCA.pem
AGENTGATEWAY_SSL_CERT_FILE=/certs/rootCA.pem
```

## Run Locally

```sh
task start
```

Initial checks:

```sh
curl -i https://api.${DOMAIN}/tasks/health
curl -i https://api.${DOMAIN}/tasks/openapi.json
curl -i https://api.${DOMAIN}/tasks/docs
curl -i https://api.${DOMAIN}/tasks
curl -i https://api.${DOMAIN}/tasks/users/me
curl -i https://api.${DOMAIN}/tasks/mcp
curl -i https://api.${DOMAIN}/tasks/.well-known/oauth-protected-resource/mcp
```

## Local VM

Use the Taskfile VM targets for a disposable Debian 13 Vagrant/libvirt VM. Vagrant owns VM lifecycle and syncs this checkout into `/opt/home-stack` with rsync. Ansible uses the committed `ansible/inventories/local-vagrant/` inventory and Vagrant's generated SSH config at `.local/vm/ssh-config`.

Required local tooling:

- Vagrant
- `vagrant-libvirt` plugin
- libvirt/KVM packages such as `qemu-kvm`, `libvirt-daemon-system`, and `libvirt-clients`

```sh
task vm:up
task vm:provision
task vm:deploy
task vm:test
```

`task vm:provision` runs `bootstrap.yml` and `site.yml` against the VM. `task vm:deploy` runs `vagrant rsync` first, then deploys the synced checkout from `/opt/home-stack` using `home_stack_source_mode: local_copy`.

`task vm:deploy` requires the local TLS files from the Local HTTPS section. The local VM example uses test-only defaults for app secrets. Override them through environment variables if needed:

```sh
export HOME_STACK_LOCAL_VM_KEYCLOAK_ADMIN_PASSWORD=...
export HOME_STACK_LOCAL_VM_KEYCLOAK_DB_PASSWORD=...
export HOME_STACK_LOCAL_VM_OAUTH2_PROXY_CLIENT_SECRET=...
export HOME_STACK_LOCAL_VM_OAUTH2_PROXY_COOKIE_SECRET=...
export HOME_STACK_LOCAL_VM_TASKS_DB_PASSWORD=...
```

Only conflict-prone values are exposed. Override them when ports or state paths collide on a workstation:

```sh
task vm:up VM_HTTP_PORT=8081 VM_HTTPS_PORT=9443 VM_STATE_DIR=.local/vm-2
```

The default VM forwards these loopback ports:

```txt
127.0.0.1:8080 -> VM:8080 (HTTP)
127.0.0.1:8443 -> VM:8443 (HTTPS)
```

Stop or remove the VM with:

```sh
task vm:down
task vm:destroy
```
