from __future__ import annotations

import json
import os
import subprocess
import time
from urllib.parse import urlparse, urlunparse

import httpx

from tests.flows.flow_env import (
    GENERATED_TOKENS_PATH,
    GENERATED_USERS_PATH,
    keycloak_origin_for,
)
from tests.flows.testcontainers_stack import stop_testcontainers_stack


REALM = "homelab"
KC = "/opt/keycloak/bin/kcadm.sh"
SERVER = "http://keycloak:8080"


def kc_exec(cmd: str) -> str:
    keycloak_admin_username = os.environ.get("KEYCLOAK_ADMIN_USERNAME", "")
    keycloak_admin_password = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "")
    keycloak_container = os.environ.get(
        "KEYCLOAK_CONTAINER_NAME", "home-stack-keycloak-1"
    )
    script = "\n".join(
        [
            f'"{KC}" config credentials --server "{SERVER}" --realm master --user "{keycloak_admin_username}" --password "{keycloak_admin_password}" >/dev/null 2>&1 || exit 1',
            cmd,
        ]
    )
    result = subprocess.run(
        ["docker", "exec", "-i", keycloak_container, "/bin/sh"],
        input=script,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Keycloak command failed: {cmd}\n{result.stderr or result.stdout}"
        )
    return result.stdout


def create_user(username: str, password: str, email: str) -> str:
    print(f"Creating user {username}")
    kc_exec(
        f'"{KC}" create users -r "{REALM}" -s username="{username}" -s enabled=true -s email="{email}" -s emailVerified=true -s firstName="Flow" -s lastName="Test"'
    )
    uid = kc_exec(
        f'"{KC}" get users -r "{REALM}" -q username="{username}" --fields id --format csv --noquotes | tail -n 1'
    ).strip()
    kc_exec(
        f'"{KC}" set-password --username "{username}" -r "{REALM}" --new-password "{password}" --temporary=false'
    )
    return uid


def group_id(group: str) -> str:
    return kc_exec(
        f'"{KC}" get groups -r "{REALM}" -q search="{group}" --fields id,name --format csv --noquotes | grep ",{group}$" | cut -d, -f1 || true'
    ).strip()


def user_id(username: str) -> str:
    return kc_exec(
        f'"{KC}" get users -r "{REALM}" -q username="{username}" --fields id --format csv --noquotes | tail -n 1'
    ).strip()


def join_groups(username: str, groups: list[str]) -> None:
    uid = user_id(username)
    for group in groups:
        gid = group_id(group)
        if gid:
            print(f"Adding {username} to {group}")
            try:
                kc_exec(f'"{KC}" update users/{uid}/groups/{gid} -r "{REALM}"')
            except Exception:
                pass


def leave_groups(username: str, groups: list[str]) -> None:
    uid = user_id(username)
    for group in groups:
        gid = group_id(group)
        if gid:
            try:
                kc_exec(f'"{KC}" delete users/{uid}/groups/{gid} -r "{REALM}"')
            except Exception:
                pass


def delete_protocol_mappers(client_id: str, cid: str) -> None:
    groups_mapper_name = f"{client_id}-groups"
    audience_mapper_name = f"{client_id}-audience"
    mappers = kc_exec(
        f'"{KC}" get clients/{cid}/protocol-mappers/models -r "{REALM}" --fields id,name --format csv --noquotes || true'
    ).strip()
    for line in mappers.splitlines():
        parts = line.split(",")
        name = ",".join(parts[1:])
        if name in {groups_mapper_name, audience_mapper_name}:
            try:
                kc_exec(
                    f'"{KC}" delete clients/{cid}/protocol-mappers/models/{parts[0]} -r "{REALM}"'
                )
            except Exception:
                pass


def create_ropc_client(
    client_id: str,
    client_secret: str,
    audience: str,
    access_token_lifespan_seconds: int | None = None,
) -> str:
    existing_id = kc_exec(
        f'"{KC}" get clients -r "{REALM}" -q clientId="{client_id}" --fields id --format csv --noquotes | tail -n 1 || true'
    ).strip()
    if existing_id:
        kc_exec(f'"{KC}" delete clients/{existing_id} -r "{REALM}"')

    client_json = json.dumps(
        {
            "clientId": client_id,
            "secret": client_secret,
            "publicClient": False,
            "standardFlowEnabled": False,
            "directAccessGrantsEnabled": True,
            "serviceAccountsEnabled": False,
            "implicitFlowEnabled": False,
            "redirectUris": [],
            "attributes": {"access.token.lifespan": str(access_token_lifespan_seconds)}
            if access_token_lifespan_seconds
            else {},
        }
    )
    tmp_file = f"/tmp/mcp-test-client-{client_id}.json"
    kc_exec(
        f'cat > {tmp_file} <<\'CLIENTJSON\'\n{client_json}\nCLIENTJSON\n"{KC}" create clients -r "{REALM}" -f "{tmp_file}"\nrm -f {tmp_file}'
    )
    cid = kc_exec(
        f'"{KC}" get clients -r "{REALM}" -q clientId="{client_id}" --fields id --format csv --noquotes | tail -n 1'
    ).strip()

    delete_protocol_mappers(client_id, cid)
    kc_exec(
        f'"{KC}" create clients/{cid}/protocol-mappers/models -r "{REALM}" -s name="{client_id}-groups" -s protocol=openid-connect -s protocolMapper=oidc-group-membership-mapper -s \'config."claim.name"=groups\' -s \'config."full.path"=true\' -s \'config."access.token.claim"=true\' -s \'config."id.token.claim"=true\' -s \'config."userinfo.token.claim"=true\''
    )
    kc_exec(
        f'"{KC}" create clients/{cid}/protocol-mappers/models -r "{REALM}" -s name="{client_id}-audience" -s protocol=openid-connect -s protocolMapper=oidc-audience-mapper -s \'config."included.custom.audience"={audience}\' -s \'config."access.token.claim"=true\' -s \'config."id.token.claim"=false\''
    )
    return cid


def create_wrong_aud_client(
    client_id: str, client_secret: str, wrong_audience: str
) -> str:
    return create_ropc_client(client_id, client_secret, wrong_audience)


def delete_client(client_id: str) -> None:
    existing_id = kc_exec(
        f'"{KC}" get clients -r "{REALM}" -q clientId="{client_id}" --fields id --format csv --noquotes | tail -n 1 || true'
    ).strip()
    if existing_id:
        kc_exec(f'"{KC}" delete clients/{existing_id} -r "{REALM}"')


def token_url() -> str:
    configured = os.environ.get("KEYCLOAK_TOKEN_URL")
    if configured:
        return configured

    web_origin = os.environ.get("WEB_ORIGIN", "https://tasks.home-stack.localhost")
    origin = keycloak_origin_for(web_origin)
    parsed = urlparse(origin)
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            f"/realms/{REALM}/protocol/openid-connect/token",
            "",
            "",
            "",
        )
    )


def get_token(client_id: str, client_secret: str, username: str, password: str) -> str:
    data = {
        "grant_type": "password",
        "client_id": client_id,
        "client_secret": client_secret,
        "username": username,
        "password": password,
    }
    with httpx.Client(verify=False, timeout=15.0, trust_env=False) as client:
        response = client.post(
            token_url(),
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    payload = response.json()
    access_token = payload.get("access_token")
    if not access_token:
        raise RuntimeError(f"Failed to obtain token for {username}: {payload}")
    return access_token


def setup_keycloak_flow_state() -> None:
    if not os.environ.get("KEYCLOAK_ADMIN_PASSWORD"):
        raise RuntimeError("KEYCLOAK_ADMIN_PASSWORD is required for flow test setup")

    for group in ["homelab-users", "tasks-users", "mcp-users"]:
        try:
            kc_exec(
                f'"{KC}" get groups -r "{REALM}" -q search="{group}" | grep \'"name" : "{group}"\''
            )
        except Exception:
            print(f"Creating group {group}")
            kc_exec(f'"{KC}" create groups -r "{REALM}" -s name="{group}"')

    run_id = f"{int(time.time() * 1000)}-{os.getpid()}"
    user_prefix = os.environ.get("TEST_USER_PREFIX", "flowtest")
    test_user = f"{user_prefix}-allowed-{run_id}"
    denied_user = f"{user_prefix}-denied-{run_id}"
    test_pass = os.environ.get("TEST_USER_PASSWORD", "ChangeMe123")
    denied_pass = os.environ.get("TEST_DENIED_USER_PASSWORD", test_pass)

    create_user(test_user, test_pass, f"{test_user}@example.com")
    create_user(denied_user, denied_pass, f"{denied_user}@example.com")

    join_groups(test_user, ["homelab-users", "tasks-users"])
    leave_groups(test_user, ["mcp-users"])

    join_groups(denied_user, ["homelab-users"])
    leave_groups(denied_user, ["tasks-users", "mcp-users"])

    mcp_user = f"{user_prefix}-mcp-{run_id}"
    mcp_pass = os.environ.get("MCP_USER_PASSWORD", test_pass)
    create_user(mcp_user, mcp_pass, f"{mcp_user}@example.com")
    join_groups(mcp_user, ["homelab-users", "mcp-users"])

    mcp_resource_uri = os.environ.get("MCP_RESOURCE") or os.environ.get(
        "MCP_RESOURCE_URI", ""
    )
    existing_tokens = {
        "MCP_TOKEN_VALID": os.environ.get("MCP_TOKEN_VALID", ""),
        "MCP_TOKEN_WRONG_AUD": os.environ.get("MCP_TOKEN_WRONG_AUD", ""),
        "MCP_TOKEN_EXPIRED": os.environ.get("MCP_TOKEN_EXPIRED", ""),
        "MCP_TOKEN_MISSING_GROUP": os.environ.get("MCP_TOKEN_MISSING_GROUP", ""),
    }

    generated_tokens: dict[str, str] = {}
    mcp_clients_to_cleanup: list[str] = []

    if mcp_resource_uri and not all(existing_tokens.values()):
        try:
            run_id_short = "".join(ch for ch in run_id if ch.isalnum() or ch == "-")[
                :12
            ]
            valid_client_secret = os.environ.get(
                "MCP_TEST_CLIENT_SECRET", f"mcp-valid-{run_id_short}"
            )
            wrong_aud_client_secret = os.environ.get(
                "MCP_WRONG_AUD_CLIENT_SECRET", f"mcp-wrong-aud-{run_id_short}"
            )
            expired_client_secret = os.environ.get(
                "MCP_EXPIRED_CLIENT_SECRET", f"mcp-expired-{run_id_short}"
            )

            valid_client_id = f"mcp-test-valid-{run_id_short}"
            wrong_aud_client_id = f"mcp-test-wrong-aud-{run_id_short}"
            expired_client_id = f"mcp-test-expired-{run_id_short}"
            mcp_clients_to_cleanup = [
                valid_client_id,
                wrong_aud_client_id,
                expired_client_id,
            ]

            print("Creating temporary Keycloak clients for MCP token generation")
            create_ropc_client(valid_client_id, valid_client_secret, mcp_resource_uri)
            create_wrong_aud_client(
                wrong_aud_client_id,
                wrong_aud_client_secret,
                f"{mcp_resource_uri}-wrong",
            )
            create_ropc_client(
                expired_client_id, expired_client_secret, mcp_resource_uri, -120
            )

            print("Generating MCP tokens via Keycloak token endpoint")
            generated_tokens["MCP_TOKEN_VALID"] = get_token(
                valid_client_id, valid_client_secret, mcp_user, mcp_pass
            )
            generated_tokens["MCP_TOKEN_MISSING_GROUP"] = get_token(
                valid_client_id, valid_client_secret, denied_user, denied_pass
            )
            generated_tokens["MCP_TOKEN_WRONG_AUD"] = get_token(
                wrong_aud_client_id, wrong_aud_client_secret, mcp_user, mcp_pass
            )
            generated_tokens["MCP_TOKEN_EXPIRED"] = get_token(
                expired_client_id, expired_client_secret, mcp_user, mcp_pass
            )
        finally:
            if mcp_clients_to_cleanup:
                print("Cleaning up temporary Keycloak clients")
            for client_id in mcp_clients_to_cleanup:
                try:
                    delete_client(client_id)
                except Exception:
                    pass

    for key, value in existing_tokens.items():
        if mcp_resource_uri and value:
            generated_tokens[key] = value

    if mcp_resource_uri:
        missing_tokens = [
            key for key in existing_tokens if not generated_tokens.get(key)
        ]
        if missing_tokens:
            raise RuntimeError(
                f"Missing MCP tokens after flow test setup: {', '.join(missing_tokens)}"
            )

    for key, value in generated_tokens.items():
        os.environ[key] = value

    GENERATED_USERS_PATH.write_text(
        json.dumps(
            {
                "testUser": {"username": test_user, "password": test_pass},
                "deniedUser": {"username": denied_user, "password": denied_pass},
                "mcpUser": {"username": mcp_user, "password": mcp_pass},
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    if generated_tokens:
        GENERATED_TOKENS_PATH.write_text(
            json.dumps(generated_tokens, indent=2), encoding="utf-8"
        )
    else:
        GENERATED_TOKENS_PATH.unlink(missing_ok=True)


def delete_user(username: str) -> None:
    uid = kc_exec(
        f'"{KC}" get users -r "{REALM}" -q username="{username}" --fields id --format csv --noquotes 2>/dev/null | tail -n 1 || true'
    ).strip()
    if uid:
        print(f"Deleting test user {username}")
        kc_exec(f'"{KC}" delete users/{uid} -r "{REALM}"')


def teardown_keycloak_flow_state() -> None:
    try:
        if (
            not os.environ.get("KEYCLOAK_ADMIN_PASSWORD")
            or not GENERATED_USERS_PATH.exists()
        ):
            return

        generated_users = json.loads(GENERATED_USERS_PATH.read_text(encoding="utf-8"))
        for username in [
            generated_users.get("testUser", {}).get("username"),
            generated_users.get("deniedUser", {}).get("username"),
            generated_users.get("mcpUser", {}).get("username"),
        ]:
            if username:
                delete_user(username)

        GENERATED_USERS_PATH.unlink(missing_ok=True)
        GENERATED_TOKENS_PATH.unlink(missing_ok=True)
    finally:
        stop_testcontainers_stack()
