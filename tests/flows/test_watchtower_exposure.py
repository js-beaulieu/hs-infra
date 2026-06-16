from __future__ import annotations


def test_watchtower_update_endpoint_rejects_get(http_client, flow_env):
    res = http_client.get(f"{flow_env.watchtower_origin}/v1/update")
    assert res.status_code == 404, (
        f"GET /v1/update should return 404 (blocked by Caddy), got {res.status_code}"
    )


def test_watchtower_update_endpoint_rejects_unauthorized_post(http_client, flow_env):
    res = http_client.post(f"{flow_env.watchtower_origin}/v1/update")
    assert res.status_code == 401, (
        f"POST /v1/update without token should return 401, got {res.status_code}"
    )


def test_watchtower_update_endpoint_accepts_authorized_post(http_client, flow_env):
    res = http_client.post(
        f"{flow_env.watchtower_origin}/v1/update",
        headers={"Authorization": f"Bearer {flow_env.watchtower_api_token}"},
    )
    assert res.status_code in {200, 202, 429}, (
        f"POST /v1/update with valid token should return 200/202/429, got {res.status_code}"
    )


def test_watchtower_root_path_returns_404(http_client, flow_env):
    res = http_client.get(f"{flow_env.watchtower_origin}/")
    assert res.status_code == 404, (
        f"GET / on watchtower subdomain should return 404, got {res.status_code}"
    )


def test_watchtower_arbitrary_path_returns_404(http_client, flow_env):
    res = http_client.get(f"{flow_env.watchtower_origin}/v1/metrics")
    assert res.status_code == 404, (
        f"GET /v1/metrics should return 404 (blocked by Caddy), got {res.status_code}"
    )
