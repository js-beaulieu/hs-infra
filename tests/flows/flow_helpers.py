from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from playwright.sync_api import BrowserContext, Page

from tests.flows.flow_env import FlowEnv


def navigate_to_login(page: Page, target_url: str, env: FlowEnv) -> None:
    page.goto(target_url)
    page.wait_for_url(lambda url: str(url).startswith(env.keycloak_origin), timeout=15000)


def perform_keycloak_login(page: Page, username: str, password: str) -> None:
    page.fill("#username", username)
    page.fill("#password", password)
    page.click("#kc-login")


def login_and_return(page: Page, target_url: str, env: FlowEnv) -> None:
    navigate_to_login(page, target_url, env)
    perform_keycloak_login(page, env.test_user_username, env.test_user_password)
    page.wait_for_url(target_url, timeout=15000)


def get_oauth2_proxy_cookie(context: BrowserContext) -> str | None:
    for cookie in context.cookies():
        if cookie["name"] == "__Secure-oauth2_proxy":
            return f"{cookie['name']}={cookie['value']}"
    return None


def expect_cookie_secure_http_only(cookie: Mapping[str, Any]) -> None:
    assert cookie.get("secure") is True, "cookie must be Secure"
    assert cookie.get("httpOnly") is True, "cookie must be HttpOnly"


def ensure_no_auth_redirect_status(status: int) -> None:
    assert status >= 400, f"Expected 401/403 for unauthenticated API, got {status}"
    assert status < 500, f"Expected 401/403 for unauthenticated API, got {status}"
