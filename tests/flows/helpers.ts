import { expect, BrowserContext, Page, APIRequestContext } from '@playwright/test';
import {
  OAUTH2_BASE,
  KEYCLOAK_ORIGIN,
  TEST_USER_USERNAME,
  TEST_USER_PASSWORD,
} from './env';

export async function navigateToLogin(page: Page, targetUrl: string) {
  await page.goto(targetUrl);
  // Should end up at Keycloak login (different Keycloak versions may use different exact paths)
  await page.waitForURL((url) => url.toString().startsWith(KEYCLOAK_ORIGIN), { timeout: 15000 });
}

export async function performKeycloakLogin(page: Page, username: string, password: string) {
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#kc-login');
}

export async function loginAndReturn(page: Page, targetUrl: string): Promise<void> {
  await navigateToLogin(page, targetUrl);
  await performKeycloakLogin(page, TEST_USER_USERNAME, TEST_USER_PASSWORD);
  // Wait until redirected back to the target
  await page.waitForURL(targetUrl, { timeout: 15000 });
}

export async function getOauth2ProxyCookie(context: BrowserContext): Promise<string | undefined> {
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === '__Secure-oauth2_proxy');
  return cookie ? `${cookie.name}=${cookie.value}` : undefined;
}

export function expectCookieSecureHttpOnly(cookie: { secure?: boolean; httpOnly?: boolean; sameSite?: string }) {
  expect(cookie.secure, 'cookie must be Secure').toBe(true);
  expect(cookie.httpOnly, 'cookie must be HttpOnly').toBe(true);
}

export async function ensureNoAuthRedirect(response: Awaited<ReturnType<APIRequestContext['get']>> | Awaited<ReturnType<APIRequestContext['post']>> | Awaited<ReturnType<APIRequestContext['fetch']>>) {
  const status = response.status();
  expect(status, `Expected 401/403 for unauthenticated API, got ${status}`).toBeGreaterThanOrEqual(400);
  expect(status, `Expected 401/403 for unauthenticated API, got ${status}`).toBeLessThan(500);
}
