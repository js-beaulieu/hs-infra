from __future__ import annotations


def test_home_stack_realm_oidc_metadata_is_public(http_client, flow_env):
    res = http_client.get(
        f"{flow_env.keycloak_origin}/realms/home-stack/.well-known/openid-configuration"
    )
    assert res.status_code == 200
    assert res.json().get("issuer") == f"{flow_env.keycloak_origin}/realms/home-stack"


def test_master_realm_oidc_metadata_is_not_public(http_client, flow_env):
    res = http_client.get(
        f"{flow_env.keycloak_origin}/realms/master/.well-known/openid-configuration"
    )
    assert res.status_code in {403, 404}


def test_arbitrary_realm_oidc_metadata_is_not_public(http_client, flow_env):
    res = http_client.get(
        f"{flow_env.keycloak_origin}/realms/unexpected/.well-known/openid-configuration"
    )
    assert res.status_code in {403, 404}
