# Ansible Deployment

This deployment setup targets a Debian 13 VPS and keeps real infrastructure data out of git.

## Privacy Rule

Do not commit real domains, emails, VPS IPs, admin CIDRs, hostnames, SSH keys, or app secrets.

Committed inventory files are examples only. Real files are ignored by git:

```txt
ansible/inventories/production/hosts.yml
ansible/inventories/production/group_vars/all.yml
ansible/inventories/production/group_vars/vault.yml
ansible/inventories/local-vm/hosts.yml
ansible/inventories/local-vm/group_vars/all.yml
ansible/inventories/local-vm/group_vars/vault.yml
```

## User Model

There are two non-root users:

```txt
debian
  OVH default admin user with full sudo.
  Runs site.yml for host convergence.
  Receives SSH keys during bootstrap.

deploy
   Used for routine GitHub Actions app deploys.
   Not in the docker group.
   Can write the generated env file and desired release marker.
   Can run /usr/local/sbin/home-stack-deploy through sudo.
```

In production, `/opt/home-stack` is root-owned. The sudo wrapper reads the deploy-owned release marker, checks out that version from the configured repository as root, and runs Docker Compose as root so Caddy can bind `80/443`. Treat the `deploy` user as privileged to deploy any reachable commit from the configured repository, but not as a general-purpose root user.

## Playbooks

```txt
ansible/playbooks/bootstrap.yml
  Manual first run through OVH's default debian user on a fresh VPS.
  Installs python3/sudo, adds SSH keys to debian, creates deploy user.

ansible/playbooks/site.yml
  Protected/manual host convergence as debian (with become).
  Installs base packages, Docker, UFW, fail2ban, SSH hardening, and the deploy wrapper.

ansible/playbooks/deploy.yml
  Routine app deployment as deploy.
  Updates the source checkout, renders .env, calls /usr/local/sbin/home-stack-deploy, and checks health.
```

## Source Modes

Production uses Git:

```yaml
home_stack_source_mode: git
home_stack_git_repo: https://github.com/OWNER/REPO.git
home_stack_git_version: main
home_stack_env_file: /home/deploy/home-stack.env
home_stack_release_file: /home/deploy/home-stack.release
```

The wrapper runs Git as root on the target host. Private SSH repositories require root-side Git credentials and known-host setup on the VPS; the playbooks do not install a GitHub deploy key.

Local VM testing uses a mounted source tree:

```yaml
home_stack_source_mode: mounted
home_stack_app_dir: /opt/home-stack
home_stack_env_file: /home/deploy/home-stack.env
```

Mounted mode skips source checkout entirely. It exists only so the VM can run directly from the host working tree without pushing first. The env file stays outside the mounted repo so local VM deploys do not overwrite the host `.env`.

## Fresh VPS Flow

Copy the examples, fill real values locally, and keep them untracked:

```sh
cp ansible/inventories/production/hosts.yml.example ansible/inventories/production/hosts.yml
cp ansible/inventories/production/group_vars/all.yml.example ansible/inventories/production/group_vars/all.yml
```

Run bootstrap once through OVH's default `debian` user with sudo:

```sh
uv run ansible-galaxy collection install -r ansible/requirements.yml
uv run ansible-playbook -i ansible/inventories/production/hosts.yml ansible/playbooks/bootstrap.yml --become
```

If you are testing against a fresh local VM that still permits root SSH, override the user explicitly:

```sh
uv run ansible-playbook -i ansible/inventories/local-vm/hosts.yml ansible/playbooks/bootstrap.yml -u root
```

Run host convergence as the debian user:

```sh
uv run ansible-playbook -i ansible/inventories/production/hosts.yml ansible/playbooks/site.yml
```

Run app deployment as the deploy user:

```sh
uv run ansible-playbook -i ansible/inventories/production/hosts.yml ansible/playbooks/deploy.yml
```

## GitHub Actions

Routine deploys run `.github/workflows/deploy.yml` on pushes to `main` and `workflow_dispatch`.

Protected host convergence runs `.github/workflows/provision.yml` manually through `workflow_dispatch` and should use a protected `production` environment.

Required GitHub Environment variables include:

```txt
PROD_VPS_HOST
PROD_VPS_SSH_PORT
PROD_ADMIN_USER
PROD_DEPLOY_USER
PROD_GIT_REPO
PROD_DOMAIN
PROD_ACME_EMAIL
PROD_ADMIN_CIDRS
PROD_WEB_EXPOSURE
```

Required GitHub Environment secrets include:

```txt
PROD_SSH_PRIVATE_KEY
PROD_KNOWN_HOSTS
PROD_KEYCLOAK_ADMIN_PASSWORD
PROD_KEYCLOAK_DB_PASSWORD
PROD_OAUTH2_PROXY_CLIENT_SECRET
PROD_OAUTH2_PROXY_COOKIE_SECRET
PROD_TASKS_DB_PASSWORD
```

Ansible Vault can replace the GitHub-secret rendered app vars later. The roles are written around `home_stack_*` variables, so the secret source can change without rewriting the deployment logic.

## Local Debian 13 VM Test

A disposable local VM can be tested with ignored inventory under `ansible/inventories/local-vm/`.

The current test VM uses QEMU user networking with SSH forwarded to `127.0.0.1:2222`. It uses fake test-only credentials and a temporary SSH key under `/tmp/opencode/home-stack-debian13-vm`.

For reachable local testing, start the VM with host forwards:

```txt
127.0.0.1:2222 -> VM:22
127.0.0.1:8080 -> VM:80
127.0.0.1:8443 -> VM:443
```

The local inventory uses `*.home-stack.localhost` and Caddy `tls internal`, so the health endpoint is reachable from the host with certificate verification disabled:

```sh
curl -k https://api.tasks.home-stack.localhost:8443/health
```

The host repo is mounted read-only at `/opt/home-stack` in the VM for local testing. On this machine QEMU 9p/virtiofs were unavailable, so the current VM uses a filtered read-only QEMU FAT directory view created under `/tmp/opencode/home-stack-debian13-vm/repo-mount`.

Run the same flow against the VM:

```sh
uv run ansible-galaxy collection install -r ansible/requirements.yml
uv run ansible-playbook -i ansible/inventories/local-vm/hosts.yml ansible/playbooks/site.yml
uv run ansible-playbook -i ansible/inventories/local-vm/hosts.yml ansible/playbooks/deploy.yml
```

## Firewall Modes

`home_stack_firewall_web_exposure: direct` allows public `80/443`.

`home_stack_firewall_web_exposure: cloudflare` restricts `80/443` to `home_stack_cloudflare_cidrs` plus `home_stack_firewall_extra_web_cidrs`.

The firewall role configures UFW and a Docker `DOCKER-USER` chain script because Docker-published ports can otherwise bypass normal UFW assumptions.
