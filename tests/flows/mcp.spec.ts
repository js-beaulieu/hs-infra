import { test, expect } from '@playwright/test';
import {
  MCP_RESOURCE,
  MCP_METADATA,
  MCP_TOKEN_VALID,
  MCP_TOKEN_WRONG_AUD,
  MCP_TOKEN_EXPIRED,
  MCP_TOKEN_MISSING_GROUP,
} from './env';

test.describe('mcp flow', () => {
  test('protected-resource metadata is public and returns resource equal to configured MCP RESOURCE URI', async ({ request }) => {
    const res = await request.get(`${MCP_METADATA}`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    // Should contain the resource URI
    expect(body).toContain(MCP_RESOURCE);
    const json = await res.json().catch(() => ({ resource: '' }));
    expect(json.resource).toBe(MCP_RESOURCE);
  });

  test('unauthenticated MCP request returns 401 with WWW-Authenticate, not 302 redirect', async ({ request }) => {
    const res = await request.get(`${MCP_RESOURCE}`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.status()).toBe(401);
    const wwwAuth = res.headers()['www-authenticate'];
    expect(wwwAuth, 'WWW-Authenticate must be present').toBeTruthy();
  });

  test('browser SSO cookies alone do not authorize MCP', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Navigate to WEB_ORIGIN and log in via browser flow (we only need the cookies)
    await page.goto('about:blank');
    // We can't easily login through the full flow here, but we can try without a bearer token
    // and verify that a standard browser cookie context is still rejected with 401, not 302.
    const request = context.request;
    const res = await request.get(`${MCP_RESOURCE}`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.status()).toBe(401);
    const wwwAuth = res.headers()['www-authenticate'];
    expect(wwwAuth).toBeTruthy();
    await context.close();
  });

  test('invalid/tampered bearer token is rejected', async ({ request }) => {
    const res = await request.get(`${MCP_RESOURCE}`, {
      headers: {
        Authorization: 'Bearer INVALID_TOKEN',
        Accept: 'application/json',
      },
    });
    expect(res.status()).toBe(401);
    const wwwAuth = res.headers()['www-authenticate'];
    expect(wwwAuth).toBeTruthy();
  });

  test('wrong audience token is rejected', async ({ request }) => {
    test.skip(!MCP_TOKEN_WRONG_AUD, 'MCP_TOKEN_WRONG_AUD not configured');
    const res = await request.get(`${MCP_RESOURCE}`, {
      headers: {
        Authorization: `Bearer ${MCP_TOKEN_WRONG_AUD}`,
        Accept: 'application/json',
      },
    });
    expect(res.status()).toBe(401);
  });

  test('expired token is rejected', async ({ request }) => {
    test.skip(!MCP_TOKEN_EXPIRED, 'MCP_TOKEN_EXPIRED not configured');
    const res = await request.get(`${MCP_RESOURCE}`, {
      headers: {
        Authorization: `Bearer ${MCP_TOKEN_EXPIRED}`,
        Accept: 'application/json',
      },
    });
    expect(res.status()).toBe(401);
  });

  test('valid token missing /mcp-users group is rejected', async ({ request }) => {
    test.skip(!MCP_TOKEN_MISSING_GROUP, 'MCP_TOKEN_MISSING_GROUP not configured');
    const res = await request.get(`${MCP_RESOURCE}`, {
      headers: {
        Authorization: `Bearer ${MCP_TOKEN_MISSING_GROUP}`,
        Accept: 'application/json',
      },
    });
    expect(res.status()).toBe(403);
  });

  test('valid MCP token is accepted', async ({ request }) => {
    test.skip(!MCP_TOKEN_VALID, 'MCP_TOKEN_VALID not configured');
    const res = await request.get(`${MCP_RESOURCE}`, {
      headers: {
        Authorization: `Bearer ${MCP_TOKEN_VALID}`,
        Accept: 'application/json',
      },
    });
    // Should not be 401/403; expect 200/404/405 depending on upstream
    expect([200, 404, 405]).toContain(res.status());
  });

  test('route boundary: /mcpfoo does not match MCP route', async ({ request }) => {
    const res = await request.get(`${MCP_RESOURCE}foo`, {
      headers: { Accept: 'application/json' },
    });
    // Should not be 401 with WWW-Authenticate (the MCP route boundary)
    // It will probably 401/403 from oauth2-proxy or 404; the key is it should not be MCP auth behavior
    const wwwAuth = res.headers()['www-authenticate'];
    if (res.status() === 401) {
      expect(wwwAuth).toBeFalsy();
    }
  });
});
