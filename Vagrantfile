# frozen_string_literal: true

VM_NAME = ENV.fetch("VM_NAME", "home-stack-local")
VM_HTTP_PORT = Integer(ENV.fetch("VM_HTTP_PORT", "8080"))
VM_HTTPS_PORT = Integer(ENV.fetch("VM_HTTPS_PORT", "8443"))

Vagrant.configure("2") do |config|
  config.vm.box = "debian/trixie64"
  config.vm.box_check_update = false
  config.vm.define VM_NAME, primary: true
  config.vm.hostname = VM_NAME

  config.vm.synced_folder ".", "/vagrant", disabled: true
  config.vm.synced_folder ".", "/opt/home-stack",
                          type: "rsync",
                          rsync__rsync_path: "sudo rsync",
                          rsync__exclude: [
                            ".git/",
                            ".vagrant/",
                            ".venv/",
                            ".local/",
                            ".ansible/",
                            ".pytest_cache/",
                            ".ruff_cache/",
                            "__pycache__/",
                            "test-results/",
                            ".env",
                            ".env.local",
                            ".vault-pass",
                            "ansible/inventories/production/hosts.yml",
                            "ansible/inventories/production/group_vars/all.yml",
                            "ansible/inventories/production/group_vars/vault.yml",
                            "tests/flows/*.env",
                            "tests/flows/.generated-users.json",
                            "tests/flows/.generated-tokens.json",
                            "tests/flows/.testcontainers-*.env",
                            "tests/flows/.testcontainers-state.json"
                          ]

  config.vm.network "forwarded_port", guest: VM_HTTP_PORT, host: VM_HTTP_PORT, host_ip: "127.0.0.1"
  config.vm.network "forwarded_port", guest: VM_HTTPS_PORT, host: VM_HTTPS_PORT, host_ip: "127.0.0.1"

  config.vm.provider :libvirt do |libvirt|
    libvirt.cpus = 2
    libvirt.memory = 4096
    libvirt.driver = "kvm"
  end

  config.vm.provision "shell", privileged: true, inline: <<~SHELL
    set -eu
    if ! command -v python3 >/dev/null 2>&1 || ! command -v sudo >/dev/null 2>&1 || ! command -v rsync >/dev/null 2>&1; then
      apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y python3 sudo rsync
    fi
  SHELL
end
