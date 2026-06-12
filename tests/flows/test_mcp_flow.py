from __future__ import annotations


MCP_POST_ACCEPT = "application/json, text/event-stream"
MCP_GET_ACCEPT = "text/event-stream"


def test_metadata_endpoint_returns_200_with_required_fields(http_client, flow_env):
    res = http_client.get(flow_env.mcp_metadata)
    assert res.status_code == 200
    payload = res.json()
    assert payload["resource"] == flow_env.mcp_resource
    assert payload.get("authorization_servers") is not None
    assert "header" in payload.get("bearer_methods_supported", [])


def test_metadata_resource_uri_matches_the_configured_mcp_resource_exactly(
    http_client, flow_env
):
    res = http_client.get(flow_env.mcp_metadata)
    assert res.status_code == 200
    payload = res.json()
    assert payload["resource"] == flow_env.mcp_resource


def test_as_metadata_endpoint_returns_200_with_required_fields(http_client, flow_env):
    res = http_client.get(flow_env.mcp_as_metadata)
    assert res.status_code == 200
    payload = res.json()
    assert payload.get("issuer") is not None
    assert payload.get("authorization_endpoint") is not None
    assert payload.get("token_endpoint") is not None


def test_resource_relative_metadata_endpoint_returns_200_with_required_fields(
    http_client, flow_env
):
    res = http_client.get(
        f"{flow_env.mcp_resource}/.well-known/oauth-protected-resource"
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["resource"] == flow_env.mcp_resource
    assert payload.get("authorization_servers") is not None


def test_resource_relative_as_metadata_endpoint_returns_200_with_required_fields(
    http_client, flow_env
):
    res = http_client.get(
        f"{flow_env.mcp_resource}/.well-known/oauth-authorization-server"
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload.get("issuer") is not None
    assert payload.get("authorization_endpoint") is not None
    assert payload.get("token_endpoint") is not None


def test_resource_relative_dcr_endpoint_registers_a_new_mcp_client_and_returns_client_id(
    http_client, flow_env
):
    res = http_client.post(
        f"{flow_env.mcp_resource}/.well-known/oauth-authorization-server/client-registration",
        headers={"Content-Type": "application/json"},
        json={
            "client_name": "flow-test-resource-relative-mcp-client",
            "redirect_uris": ["http://localhost:7777/callback"],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": "openid profile email mcp",
        },
    )
    assert res.status_code == 201
    payload = res.json()
    assert payload.get("client_id")
    assert "authorization_code" in payload.get("grant_types", [])


def test_dcr_endpoint_registers_a_new_public_mcp_client_and_returns_client_id(
    http_client, flow_env
):
    res = http_client.post(
        flow_env.mcp_dcr,
        headers={"Content-Type": "application/json"},
        json={
            "client_name": "flow-test-mcp-client",
            "redirect_uris": ["http://localhost:7777/callback"],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": "openid profile email mcp",
        },
    )
    assert res.status_code == 201
    payload = res.json()
    assert payload.get("client_id")
    assert not payload.get("client_secret")
    assert payload["token_endpoint_auth_method"] == "none"
    assert "authorization_code" in payload.get("grant_types", [])


def test_dcr_rejects_registration_with_disallowed_scope(http_client, flow_env):
    res = http_client.post(
        flow_env.mcp_dcr,
        headers={"Content-Type": "application/json"},
        json={
            "client_name": "flow-test-bad-scope",
            "redirect_uris": ["http://localhost:7777/callback"],
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": "openid profile email mcp admin",
        },
    )
    assert res.status_code in {400, 403}


def test_mcp_request_without_token_returns_401_with_www_authenticate(
    http_client, flow_env
):
    res = http_client.get(flow_env.mcp_resource, headers={"Accept": MCP_GET_ACCEPT})
    assert res.status_code == 401
    assert res.headers.get("www-authenticate")


def test_mcp_post_without_token_returns_401(http_client, flow_env):
    res = http_client.post(
        flow_env.mcp_resource,
        headers={"Accept": MCP_POST_ACCEPT, "Content-Type": "application/json"},
        json={"jsonrpc": "2.0", "method": "initialize", "id": 1, "params": {}},
    )
    assert res.status_code == 401


def test_browser_sso_cookies_alone_do_not_authorize_mcp(browser, flow_env):
    context = browser.new_context(ignore_https_errors=True)
    try:
        page = context.new_page()
        page.goto("about:blank")
        res = context.request.get(
            flow_env.mcp_resource, headers={"Accept": MCP_GET_ACCEPT}
        )
        assert res.status == 401
    finally:
        context.close()


def test_invalid_bearer_token_returns_401(http_client, flow_env):
    res = http_client.get(
        flow_env.mcp_resource,
        headers={"Authorization": "Bearer INVALID_TOKEN", "Accept": MCP_GET_ACCEPT},
    )
    assert res.status_code == 401
    assert res.headers.get("www-authenticate")


def test_wrong_audience_token_returns_401(http_client, flow_env):
    res = http_client.get(
        flow_env.mcp_resource,
        headers={
            "Authorization": f"Bearer {flow_env.mcp_token_wrong_aud}",
            "Accept": MCP_GET_ACCEPT,
        },
    )
    assert res.status_code == 401


def test_expired_token_returns_401(http_client, flow_env):
    res = http_client.get(
        flow_env.mcp_resource,
        headers={
            "Authorization": f"Bearer {flow_env.mcp_token_expired}",
            "Accept": MCP_GET_ACCEPT,
        },
    )
    assert res.status_code == 401
    assert res.headers.get("www-authenticate")


def test_valid_token_missing_mcp_users_group_returns_403(http_client, flow_env):
    res = http_client.get(
        flow_env.mcp_resource,
        headers={
            "Authorization": f"Bearer {flow_env.mcp_token_missing_group}",
            "Accept": MCP_GET_ACCEPT,
        },
    )
    assert res.status_code == 403


def test_valid_mcp_token_passes_auth_on_get_422_session_required(http_client, flow_env):
    res = http_client.get(
        flow_env.mcp_resource,
        headers={
            "Authorization": f"Bearer {flow_env.mcp_token_valid}",
            "Accept": MCP_GET_ACCEPT,
        },
    )
    assert res.status_code == 422


def test_valid_mcp_token_initializes_session_via_post(http_client, flow_env):
    res = http_client.post(
        flow_env.mcp_resource,
        headers={
            "Authorization": f"Bearer {flow_env.mcp_token_valid}",
            "Accept": MCP_POST_ACCEPT,
            "Content-Type": "application/json",
        },
        json={
            "jsonrpc": "2.0",
            "method": "initialize",
            "id": 1,
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "flow-test", "version": "1.0"},
            },
        },
    )
    assert res.status_code == 200


def test_mcpfoo_does_not_match_mcp_route_and_has_no_mcp_www_authenticate(
    http_client, flow_env
):
    res = http_client.get(
        f"{flow_env.mcp_resource}foo", headers={"Accept": MCP_GET_ACCEPT}
    )
    www_auth = res.headers.get("www-authenticate")
    if res.status_code == 401:
        assert not www_auth
