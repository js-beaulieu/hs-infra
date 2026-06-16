from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import httpx
from testcontainers.compose import DockerCompose


FLOW_DIR = Path(__file__).resolve().parent
REPO_ROOT = FLOW_DIR.parents[1]
STATE_PATH = FLOW_DIR / ".testcontainers-state.json"


@contextmanager
def compose_environment(project_name: str) -> Iterator[None]:
    previous = os.environ.get("COMPOSE_PROJECT_NAME")
    os.environ["COMPOSE_PROJECT_NAME"] = project_name
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("COMPOSE_PROJECT_NAME", None)
        else:
            os.environ["COMPOSE_PROJECT_NAME"] = previous


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def write_env_file(path: Path, values: dict[str, str]) -> None:
    path.write_text(
        "\n".join(f"{key}={value}" for key, value in values.items()) + "\n",
        encoding="utf-8",
    )


def wait_for_url(url: str, timeout_seconds: int = 120) -> None:
    deadline = time.monotonic() + timeout_seconds
    with httpx.Client(
        verify=False, follow_redirects=True, timeout=10.0, trust_env=False
    ) as client:
        while time.monotonic() < deadline:
            try:
                response = client.get(url)
                if response.status_code < 500:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(1)
    raise TimeoutError(f"Timed out waiting for {url}")


def docker_compose(env_file: Path) -> DockerCompose:
    return DockerCompose(
        REPO_ROOT,
        compose_file_name=[
            "docker/compose.yml",
            "docker/core.yml",
            "docker/tasks.yml",
            "docker/test.yml",
        ],
        build=True,
        wait=True,
        env_file=str(env_file),
    )


def print_compose_diagnostics(project_name: str, env_file: Path) -> None:
    env = {**os.environ, "COMPOSE_PROJECT_NAME": project_name}
    base_cmd = [
        "docker",
        "compose",
        "--env-file",
        str(env_file),
        "-f",
        str(REPO_ROOT / "docker/compose.yml"),
        "-f",
        str(REPO_ROOT / "docker/core.yml"),
        "-f",
        str(REPO_ROOT / "docker/tasks.yml"),
        "-f",
        str(REPO_ROOT / "docker/test.yml"),
    ]
    for args in (["ps"], ["logs", "--no-color", "--tail", "200"]):
        result = subprocess.run(
            [*base_cmd, *args],
            check=False,
            cwd=REPO_ROOT,
            env=env,
            text=True,
            capture_output=True,
        )
        print(f"--- docker compose {' '.join(args)} ---")
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)


def compose_down(project_name: str, env_file: Path) -> None:
    with compose_environment(project_name):
        docker_compose(env_file).stop(down=True)


def compose_env_file_from_state(state: dict) -> Path | None:
    if not state.get("composeEnvFile"):
        return None
    return Path(state["composeEnvFile"])


def start_testcontainers_stack() -> None:
    if STATE_PATH.exists():
        previous = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        previous_compose_env_file = compose_env_file_from_state(previous)
        if previous_compose_env_file:
            try:
                compose_down(previous["projectName"], previous_compose_env_file)
            except Exception:
                pass
        if previous.get("envFile"):
            Path(previous["envFile"]).unlink(missing_ok=True)
        if previous_compose_env_file:
            previous_compose_env_file.unlink(missing_ok=True)
        STATE_PATH.unlink(missing_ok=True)

    project_name = f"home-stack-flow-{int(time.time() * 1000):x}-{os.getpid()}".lower()
    domain = os.environ.get("FLOW_TEST_DOMAIN", "home-stack.localhost")
    https_port = get_free_port()
    http_port = get_free_port()
    web_origin = f"https://tasks.{domain}:{https_port}"
    oauth2_origin = f"https://api.{domain}:{https_port}"
    api_origin = f"{oauth2_origin}/tasks"
    auth_origin = f"https://auth.{domain}:{https_port}"
    mcp_resource = f"{api_origin}/mcp"
    keycloak_admin_username = os.environ.get("KEYCLOAK_ADMIN_USERNAME", "admin")
    keycloak_admin_password = os.environ.get(
        "KEYCLOAK_ADMIN_PASSWORD", f"admin-{secrets.token_hex(6)}"
    )
    env_file = FLOW_DIR / f".testcontainers-{project_name}.env"
    compose_env_file = FLOW_DIR / f".testcontainers-{project_name}.compose.env"

    compose_env = {
        "DOMAIN": domain,
        "PUBLIC_AUTH_ORIGIN": auth_origin,
        "PUBLIC_WEB_ORIGIN": web_origin,
        "PUBLIC_OAUTH2_ORIGIN": oauth2_origin,
        "PUBLIC_API_ORIGIN": api_origin,
        "MCP_RESOURCE_URI": mcp_resource,
        "MCP_ACCESS_TOKEN_LIFESPAN_SECONDS": os.environ.get(
            "MCP_ACCESS_TOKEN_LIFESPAN_SECONDS", "31536000"
        ),
        "OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS": os.environ.get(
            "OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS", "300"
        ),
        "CADDY_HTTP_PORT": str(http_port),
        "CADDY_HTTPS_PORT": str(https_port),
        "ACME_EMAIL": "test@example.invalid",
        "CADDY_TLS_DIRECTIVE": "tls /certs/local.pem /certs/local-key.pem",
        "CADDY_TRUSTED_PROXIES": "private_ranges",
        "KEYCLOAK_ADMIN_REMOTE_IP_RANGES": "private_ranges",
        "KEYCLOAK_ADMIN_CLIENT_IP_RANGES": "private_ranges",
        "KEYCLOAK_ADMIN_USERNAME": keycloak_admin_username,
        "KEYCLOAK_ADMIN_PASSWORD": keycloak_admin_password,
        "KEYCLOAK_DB_NAME": "keycloak",
        "KEYCLOAK_DB_USER": "keycloak",
        "KEYCLOAK_DB_PASSWORD": f"kc-{secrets.token_hex(12)}",
        "OAUTH2_PROXY_CLIENT_SECRET": secrets.token_urlsafe(32),
        "OAUTH2_PROXY_COOKIE_SECRET": secrets.token_urlsafe(32),
        "OAUTH2_PROXY_PROVIDER_CA_FILES": "/certs/rootCA.pem",
        "OAUTH2_PROXY_WHITELIST_DOMAINS": f"tasks.{domain}:{https_port},api.{domain}:{https_port}",
        "AGENTGATEWAY_SSL_CERT_FILE": "/certs/rootCA.pem",
        "TASKS_DB_NAME": "tasks",
        "TASKS_DB_USER": "tasks",
        "TASKS_DB_PASSWORD": f"tasks-{secrets.token_hex(12)}",
    }

    print(
        f"Starting isolated Compose project {project_name} on https port {https_port}"
    )
    write_env_file(compose_env_file, compose_env)
    try:
        with compose_environment(project_name):
            print("Starting Docker Compose services...")
            docker_compose(compose_env_file).start()
            print("Docker Compose services started, waiting for health endpoints...")

        wait_for_url(f"{api_origin}/health")
        wait_for_url(f"{api_origin}/users/me")
        wait_for_url(f"{web_origin}/")
    except Exception:
        print_compose_diagnostics(project_name, compose_env_file)
        try:
            compose_down(project_name, compose_env_file)
        except Exception:
            pass
        compose_env_file.unlink(missing_ok=True)
        raise

    write_env_file(
        env_file,
        {
            "WEB_ORIGIN": web_origin,
            "API_BASE": api_origin,
            "MCP_RESOURCE": mcp_resource,
            "MCP_METADATA": f"{api_origin}/.well-known/oauth-protected-resource/mcp",
            "OAUTH2_BASE": f"{oauth2_origin}/oauth2",
            "KEYCLOAK_ADMIN_USERNAME": keycloak_admin_username,
            "KEYCLOAK_ADMIN_PASSWORD": keycloak_admin_password,
            "KEYCLOAK_CONTAINER_NAME": f"{project_name}-keycloak-1",
            "TEST_USER_PREFIX": os.environ.get("TEST_USER_PREFIX", "flowtest"),
            "TEST_USER_PASSWORD": os.environ.get("TEST_USER_PASSWORD", "ChangeMe123"),
            "TEST_DENIED_USER_PASSWORD": os.environ.get(
                "TEST_DENIED_USER_PASSWORD",
                os.environ.get("TEST_USER_PASSWORD", "ChangeMe123"),
            ),
            "MCP_TOKEN_VALID": os.environ.get("MCP_TOKEN_VALID", ""),
            "MCP_TOKEN_WRONG_AUD": os.environ.get("MCP_TOKEN_WRONG_AUD", ""),
            "MCP_TOKEN_EXPIRED": os.environ.get("MCP_TOKEN_EXPIRED", ""),
            "MCP_TOKEN_MISSING_GROUP": os.environ.get("MCP_TOKEN_MISSING_GROUP", ""),
        },
    )

    STATE_PATH.write_text(
        json.dumps(
            {
                "projectName": project_name,
                "envFile": str(env_file),
                "composeEnvFile": str(compose_env_file),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    os.environ["FLOW_TEST_ENV_FILE"] = str(env_file)
    for key, value in {**compose_env, "FLOW_TEST_ENV_FILE": str(env_file)}.items():
        os.environ[key] = value


def stop_testcontainers_stack() -> None:
    if not STATE_PATH.exists():
        return
    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    compose_env_file = compose_env_file_from_state(state)
    if os.environ.get("FLOW_TEST_KEEP_TESTCONTAINERS") == "1":
        print(f"Keeping isolated Compose project {state['projectName']} for debugging")
        return
    try:
        if compose_env_file:
            compose_down(state["projectName"], compose_env_file)
    finally:
        if state.get("envFile"):
            Path(state["envFile"]).unlink(missing_ok=True)
        if compose_env_file:
            compose_env_file.unlink(missing_ok=True)
        STATE_PATH.unlink(missing_ok=True)
