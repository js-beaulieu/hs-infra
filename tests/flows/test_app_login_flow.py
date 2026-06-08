from __future__ import annotations

from tests.flows.flow_helpers import expect_cookie_secure_http_only, navigate_to_login, perform_keycloak_login


def test_unauthenticated_browser_navigation_reaches_the_login_start_flow_not_tasks_api(page, flow_env):
    response = page.goto(flow_env.web_origin)
    assert response is not None
    assert response.status == 200
    assert "/realms/homelab/protocol/openid-connect/auth" in page.url


def test_valid_keycloak_user_in_homelab_users_and_tasks_users_can_authenticate(browser, flow_env):
    context = browser.new_context(ignore_https_errors=True)
    try:
        page = context.new_page()
        navigate_to_login(page, flow_env.web_origin, flow_env)
        perform_keycloak_login(page, flow_env.test_user_username, flow_env.test_user_password)
        page.wait_for_url(flow_env.web_origin + "/", timeout=30000)
        assert page.url == flow_env.web_origin + "/"
    finally:
        context.close()


def test_authenticated_browser_returns_to_the_frontend_origin(browser, flow_env):
    context = browser.new_context(ignore_https_errors=True)
    try:
        page = context.new_page()
        navigate_to_login(page, flow_env.web_origin, flow_env)
        perform_keycloak_login(page, flow_env.test_user_username, flow_env.test_user_password)
        page.wait_for_url(flow_env.web_origin + "/", timeout=30000)
        assert page.url == flow_env.web_origin + "/"
    finally:
        context.close()


def test_oauth2_proxy_cookie_is_secure_httponly_and_scoped_intentionally(browser, flow_env):
    context = browser.new_context(ignore_https_errors=True)
    try:
        page = context.new_page()
        navigate_to_login(page, flow_env.web_origin, flow_env)
        perform_keycloak_login(page, flow_env.test_user_username, flow_env.test_user_password)
        page.wait_for_url(flow_env.web_origin + "/", timeout=15000)
        cookies = context.cookies(flow_env.web_origin)
        proxy_cookie = next((cookie for cookie in cookies if cookie["name"] == "__Secure-oauth2_proxy"), None)
        assert proxy_cookie, "__Secure-oauth2_proxy cookie should exist"
        expect_cookie_secure_http_only(proxy_cookie)
    finally:
        context.close()


def test_user_missing_tasks_users_is_denied_app_api_access_after_authentication(browser, flow_env):
    context = browser.new_context(ignore_https_errors=True)
    try:
        page = context.new_page()
        navigate_to_login(page, flow_env.web_origin, flow_env)
        perform_keycloak_login(page, flow_env.test_denied_user_username, flow_env.test_denied_user_password)
        page.wait_for_url(lambda url: str(url).startswith(flow_env.web_origin), timeout=15000)
        status = page.evaluate("() => window.performance?.getEntriesByType('navigation')[0]?.responseStatus")
        body_text = page.locator("body").text_content()
        is_denied = status == 403 or (
            body_text
            and ("403" in body_text or "forbidden" in body_text.lower() or "access denied" in body_text.lower())
        )
        assert is_denied, "User without /tasks-users should be denied"
    finally:
        context.close()


def test_expired_or_invalid_session_cookie_is_rejected(browser, flow_env):
    login_context = browser.new_context(ignore_https_errors=True)
    bad_context = None
    try:
        login_page = login_context.new_page()
        navigate_to_login(login_page, flow_env.web_origin, flow_env)
        perform_keycloak_login(login_page, flow_env.test_user_username, flow_env.test_user_password)
        login_page.wait_for_url(flow_env.web_origin + "/", timeout=30000)

        cookies = login_context.cookies(flow_env.web_origin)
        proxy_cookie = next((cookie for cookie in cookies if cookie["name"] == "__Secure-oauth2_proxy"), None)
        assert proxy_cookie, "No __Secure-oauth2_proxy cookie to tamper with"

        tampered_value = proxy_cookie["value"][:-4] + "XXXX"
        bad_context = browser.new_context(
            ignore_https_errors=True,
            storage_state={
                "cookies": [
                    {
                        "name": proxy_cookie["name"],
                        "value": tampered_value,
                        "domain": proxy_cookie["domain"],
                        "path": proxy_cookie["path"],
                        "expires": -1,
                        "httpOnly": proxy_cookie["httpOnly"],
                        "secure": proxy_cookie["secure"],
                        "sameSite": proxy_cookie["sameSite"],
                    }
                ],
                "origins": [],
            },
        )

        bad_page = bad_context.new_page()
        bad_page.goto(flow_env.web_origin + "/")
        url = bad_page.url
        assert (
            "/oauth2/start" in url or "/realms/homelab/protocol/openid-connect/auth" in url
        ), "Invalid session should be rejected and redirected to login"
    finally:
        login_context.close()
        if bad_context:
            bad_context.close()
