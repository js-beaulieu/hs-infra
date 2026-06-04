import { test, expect } from '@playwright/test';
import {
  WEB_ORIGIN,
  KEYCLOAK_ORIGIN,
  TEST_USER_USERNAME,
  TEST_USER_PASSWORD,
  TEST_DENIED_USER_USERNAME,
  TEST_DENIED_USER_PASSWORD,
} from './env';
import {
  navigateToLogin,
  performKeycloakLogin,
  getOauth2ProxyCookie,
  expectCookieSecureHttpOnly,
} from './helpers';

test.describe('app login flow', () => {
  test('unauthenticated browser navigation reaches the login start flow, not tasks-api', async ({ page }) => {
    const response = await page.goto(WEB_ORIGIN);
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
    // Should be at Keycloak login or oauth2-proxy start
    const url = page.url();
    expect(url).toContain('/realms/homelab/protocol/openid-connect/auth');
  });

  test('valid Keycloak user in /homelab-users and /tasks-users can authenticate', async ({ browser }) => {
    test.skip(!TEST_USER_USERNAME || !TEST_USER_PASSWORD, 'Test user credentials not configured');
    const context = await browser.newContext();
    const page = await context.newPage();
    await navigateToLogin(page, WEB_ORIGIN);
    await performKeycloakLogin(page, TEST_USER_USERNAME, TEST_USER_PASSWORD);
    // Allow time for oauth2-proxy callback → redirect to original URL
    await page.waitForURL(WEB_ORIGIN + '/', { timeout: 30000 });
    expect(page.url()).toBe(WEB_ORIGIN + '/');
    await context.close();
  });

  test('authenticated browser returns to the frontend origin', async ({ browser }) => {
    test.skip(!TEST_USER_USERNAME || !TEST_USER_PASSWORD, 'Test user credentials not configured');
    const context = await browser.newContext();
    const page = await context.newPage();
    await navigateToLogin(page, WEB_ORIGIN);
    await performKeycloakLogin(page, TEST_USER_USERNAME, TEST_USER_PASSWORD);
    await page.waitForURL(WEB_ORIGIN + '/', { timeout: 30000 });
    expect(page.url()).toBe(WEB_ORIGIN + '/');
    await context.close();
  });

  test('oauth2-proxy cookie is Secure, HttpOnly, and scoped intentionally', async ({ browser }) => {
    test.skip(!TEST_USER_USERNAME || !TEST_USER_PASSWORD, 'Test user credentials not configured');
    const context = await browser.newContext();
    const page = await context.newPage();
    await navigateToLogin(page, WEB_ORIGIN);
    await performKeycloakLogin(page, TEST_USER_USERNAME, TEST_USER_PASSWORD);
    await page.waitForURL(WEB_ORIGIN + '/', { timeout: 15000 });
    const cookies = await context.cookies(WEB_ORIGIN);
    const proxyCookie = cookies.find((c) => c.name === '__Host-oauth2_proxy');
    expect(proxyCookie, '__Host-oauth2_proxy cookie should exist').toBeTruthy();
    expectCookieSecureHttpOnly(proxyCookie!);
    await context.close();
  });

  test('user missing /tasks-users is denied app/API access after authentication', async ({ browser }) => {
    test.skip(!TEST_DENIED_USER_USERNAME || !TEST_DENIED_USER_PASSWORD, 'Denied test user credentials not configured');
    const context = await browser.newContext();
    const page = await context.newPage();
    await navigateToLogin(page, WEB_ORIGIN);
    await performKeycloakLogin(page, TEST_DENIED_USER_USERNAME, TEST_DENIED_USER_PASSWORD);
    // After login the user should be redirected back but then denied
    await page.waitForURL((url) => url.toString().startsWith(WEB_ORIGIN), { timeout: 15000 });
    // Expect a denial: 403 or an error page
    const status = await page.evaluate(() => (window as any).performance?.getEntriesByType('navigation')[0]?.responseStatus) as number | undefined;
    // Some browsers restrict reading responseStatus; fall back to checking text/content
    const bodyText = await page.locator('body').textContent();
    const isDenied = status === 403 || (bodyText && (bodyText.includes('403') || bodyText.toLowerCase().includes('forbidden') || bodyText.toLowerCase().includes('access denied')));
    expect(isDenied, 'User without /tasks-users should be denied').toBe(true);
    await context.close();
  });

  test('expired or invalid session cookie is rejected', async ({ browser }) => {
    test.skip(!TEST_USER_USERNAME || !TEST_USER_PASSWORD, 'Test user credentials not configured');

    // Step 1: Log in with a fresh context to capture a valid session cookie
    const loginContext = await browser.newContext();
    const loginPage = await loginContext.newPage();
    await navigateToLogin(loginPage, WEB_ORIGIN);
    await performKeycloakLogin(loginPage, TEST_USER_USERNAME, TEST_USER_PASSWORD);
    await loginPage.waitForURL(WEB_ORIGIN + '/', { timeout: 30000 });

    const cookies = await loginContext.cookies(WEB_ORIGIN);
    const proxyCookie = cookies.find((c) => c.name === '__Host-oauth2_proxy');
    test.skip(!proxyCookie, 'No cookie to tamper with');

    // Step 2: Create a clean context with only the TAMPERED cookie—no SSO cookies
    const tamperedValue = proxyCookie.value.slice(0, -4) + 'XXXX';
    const badContext = await browser.newContext({
      storageState: {
        cookies: [
          {
            name: proxyCookie.name,
            value: tamperedValue,
            domain: proxyCookie.domain,
            path: proxyCookie.path,
            expires: -1,
            httpOnly: proxyCookie.httpOnly,
            secure: proxyCookie.secure,
            sameSite: proxyCookie.sameSite as 'Lax' | 'Strict' | 'None',
          },
        ],
        origins: [],
      },
    });

    const badPage = await badContext.newPage();
    await badPage.goto(WEB_ORIGIN + '/');
    // Should redirect back to login flow
    const url = badPage.url();
    expect(
      url.includes('/oauth2/start') || url.includes('/realms/homelab/protocol/openid-connect/auth'),
      'Invalid session should be rejected and redirected to login'
    ).toBe(true);

    await loginContext.close();
    await badContext.close();
  });
});
