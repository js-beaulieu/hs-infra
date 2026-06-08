from __future__ import annotations

from tests.flows.flow_helpers import ensure_no_auth_redirect_status


def test_public_health_endpoint_returns_success_without_auth(http_client, flow_env):
    res = http_client.get(f"{flow_env.api_base}/health")
    assert res.is_success, f"health should return 2xx, got {res.status_code}"


def test_protected_api_without_valid_session_returns_401_or_403_not_302(http_client, flow_env):
    res = http_client.get(f"{flow_env.api_base}/users/me")
    ensure_no_auth_redirect_status(res.status_code)


def test_protected_api_without_valid_session_returns_401_or_403_for_exact_api(http_client, flow_env):
    res = http_client.get(flow_env.api_base)
    ensure_no_auth_redirect_status(res.status_code)


def test_spoofed_identity_header_x_auth_subject_is_stripped(http_client, flow_env):
    res = http_client.get(
        f"{flow_env.api_base}/users/me",
        headers={
            "X-Auth-Subject": "attacker",
            "X-Auth-Email": "attacker@evil.com",
            "X-Auth-Groups": "/admin",
        },
    )
    assert res.status_code != 200
    ensure_no_auth_redirect_status(res.status_code)


def test_inbound_authorization_header_is_stripped_on_normal_browser_api(http_client, flow_env):
    res = http_client.get(f"{flow_env.api_base}/users/me", headers={"Authorization": "Bearer fake-token"})
    ensure_no_auth_redirect_status(res.status_code)


def test_unsafe_methods_without_valid_origin_or_referer_are_rejected_before_proxying(http_client, flow_env):
    res = http_client.post(f"{flow_env.api_base}/users/me", json={})
    assert res.status_code == 403


def test_options_preflight_from_allowed_origin_is_accepted(http_client, flow_env):
    res = http_client.request(
        "OPTIONS",
        f"{flow_env.api_base}/users/me",
        headers={
            "Origin": flow_env.web_origin,
            "Access-Control-Request-Method": "POST",
        },
    )
    assert res.status_code in {200, 204}
    assert res.headers.get("access-control-allow-origin") == flow_env.web_origin
    assert res.headers.get("access-control-allow-credentials") == "true"
    assert "POST" in res.headers.get("access-control-allow-methods", "")
    assert "Content-Type" in res.headers.get("access-control-allow-headers", "")


def test_api_responses_from_allowed_origin_include_credentialed_cors_headers(http_client, flow_env):
    res = http_client.get(f"{flow_env.api_base}/users/me", headers={"Origin": flow_env.web_origin})
    ensure_no_auth_redirect_status(res.status_code)
    assert res.headers.get("access-control-allow-origin") == flow_env.web_origin
    assert res.headers.get("access-control-allow-credentials") == "true"


def test_options_preflight_from_untrusted_origin_is_rejected_or_not_permissive(http_client, flow_env):
    res = http_client.request(
        "OPTIONS",
        f"{flow_env.api_base}/users/me",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    allowed_origin = res.headers.get("access-control-allow-origin")
    if allowed_origin:
        assert allowed_origin != "https://evil.example.com"
        assert allowed_origin != "*"


def test_unsafe_method_from_allowed_origin_is_allowed_only_when_authenticated(browser, flow_env):
    context = browser.new_context(ignore_https_errors=True)
    try:
        res = context.request.post(f"{flow_env.api_base}/users/me", headers={"Origin": flow_env.web_origin}, data={})
        assert res.status in {401, 403}
    finally:
        context.close()
