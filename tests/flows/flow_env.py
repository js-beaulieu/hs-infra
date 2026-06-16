from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


FLOW_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = FLOW_DIR / "testcontainers.env.example"
GENERATED_USERS_PATH = FLOW_DIR / ".generated-users.json"
GENERATED_TOKENS_PATH = FLOW_DIR / ".generated-tokens.json"


def flow_env_file() -> Path:
    return Path(os.environ.get("FLOW_TEST_ENV_FILE", DEFAULT_ENV_FILE)).resolve()


def load_env_file(path: Path | str, *, override: bool = True) -> None:
    env_path = Path(path).resolve()
    if not env_path.exists():
        raise FileNotFoundError(f"Env file not found: {env_path}")

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if override or key not in os.environ:
            os.environ[key] = value


def read_json_file(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def require_var(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def keycloak_origin_for(web_origin: str) -> str:
    try:
        url = urlparse(web_origin)
        parts = url.hostname.split(".") if url.hostname else []
        domain = ".".join(parts[1:])
        port = f":{url.port}" if url.port else ""
        return f"https://auth.{domain}{port}"
    except Exception:
        return "https://auth.home-stack.localhost"


@dataclass(frozen=True)
class FlowEnv:
    web_origin: str
    api_base: str
    mcp_resource: str
    mcp_metadata: str
    mcp_as_metadata: str
    mcp_dcr: str
    oauth2_base: str
    keycloak_origin: str
    test_user_username: str
    test_user_password: str
    test_denied_user_username: str
    test_denied_user_password: str
    mcp_token_valid: str
    mcp_token_wrong_aud: str
    mcp_token_expired: str
    mcp_token_missing_group: str
    keycloak_admin_username: str
    keycloak_admin_password: str
    watchtower_origin: str
    watchtower_api_token: str

    @classmethod
    def load(cls) -> "FlowEnv":
        load_env_file(flow_env_file(), override=True)
        generated_users = read_json_file(GENERATED_USERS_PATH)
        generated_tokens = read_json_file(GENERATED_TOKENS_PATH)

        web_origin = require_var("WEB_ORIGIN")
        api_base = require_var("API_BASE")
        mcp_resource = require_var("MCP_RESOURCE")
        mcp_metadata = require_var("MCP_METADATA")

        test_user = generated_users.get("testUser", {})
        denied_user = generated_users.get("deniedUser", {})

        return cls(
            web_origin=web_origin,
            api_base=api_base,
            mcp_resource=mcp_resource,
            mcp_metadata=mcp_metadata,
            mcp_as_metadata=f"{api_base}/.well-known/oauth-authorization-server/mcp",
            mcp_dcr=f"{api_base}/.well-known/oauth-authorization-server/mcp/client-registration",
            oauth2_base=require_var("OAUTH2_BASE"),
            keycloak_origin=keycloak_origin_for(web_origin),
            test_user_username=test_user.get("username")
            or os.environ.get("TEST_USER_USERNAME", ""),
            test_user_password=test_user.get("password")
            or os.environ.get("TEST_USER_PASSWORD", ""),
            test_denied_user_username=denied_user.get("username")
            or os.environ.get("TEST_DENIED_USER_USERNAME", ""),
            test_denied_user_password=denied_user.get("password")
            or os.environ.get("TEST_DENIED_USER_PASSWORD", ""),
            mcp_token_valid=os.environ.get("MCP_TOKEN_VALID")
            or generated_tokens.get("MCP_TOKEN_VALID", ""),
            mcp_token_wrong_aud=os.environ.get("MCP_TOKEN_WRONG_AUD")
            or generated_tokens.get("MCP_TOKEN_WRONG_AUD", ""),
            mcp_token_expired=os.environ.get("MCP_TOKEN_EXPIRED")
            or generated_tokens.get("MCP_TOKEN_EXPIRED", ""),
            mcp_token_missing_group=os.environ.get("MCP_TOKEN_MISSING_GROUP")
            or generated_tokens.get("MCP_TOKEN_MISSING_GROUP", ""),
            keycloak_admin_username=os.environ.get("KEYCLOAK_ADMIN_USERNAME", ""),
            keycloak_admin_password=os.environ.get("KEYCLOAK_ADMIN_PASSWORD", ""),
            watchtower_origin=os.environ.get("WATCHTOWER_ORIGIN", ""),
            watchtower_api_token=os.environ.get("WATCHTOWER_API_TOKEN", ""),
        )
