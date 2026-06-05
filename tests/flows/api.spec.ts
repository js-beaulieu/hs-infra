import { test, expect } from '@playwright/test';
import { API_BASE, WEB_ORIGIN } from './env';
import { ensureNoAuthRedirect } from './helpers';

test.describe('api flow', () => {
  test('public health endpoint returns success without auth', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.ok(), `health should return 2xx, got ${res.status()}`).toBe(true);
  });

  test('protected API without valid session returns 401 or 403, not 302', async ({ request }) => {
    const res = await request.get(`${API_BASE}/users/me`);
    ensureNoAuthRedirect(res);
  });

  test('protected API without valid session returns 401 or 403 for exact /api', async ({ request }) => {
    const res = await request.get(API_BASE);
    ensureNoAuthRedirect(res);
  });

  test('spoofed identity header X-Auth-Subject is stripped', async ({ request }) => {
    const res = await request.get(`${API_BASE}/users/me`, {
      headers: {
        'X-Auth-Subject': 'attacker',
        'X-Auth-Email': 'attacker@evil.com',
        'X-Auth-Groups': '/admin',
      },
    });
    expect(res.status()).not.toBe(200);
    ensureNoAuthRedirect(res);
  });

  test('inbound Authorization header is stripped on normal browser API', async ({ request }) => {
    const res = await request.get(`${API_BASE}/users/me`, {
      headers: {
        Authorization: 'Bearer fake-token',
      },
    });
    ensureNoAuthRedirect(res);
  });

  test('unsafe methods without valid Origin or Referer are rejected before proxying', async ({ request }) => {
    const res = await request.post(`${API_BASE}/users/me`, {
      data: {},
    });
    expect(res.status()).toBe(403);
  });

  test('OPTIONS preflight from allowed origin is accepted', async ({ request }) => {
    const res = await request.fetch(`${API_BASE}/users/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: WEB_ORIGIN,
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect([200, 204]).toContain(res.status());
    expect(res.headers()['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(res.headers()['access-control-allow-credentials']).toBe('true');
    expect(res.headers()['access-control-allow-methods']).toContain('POST');
    expect(res.headers()['access-control-allow-headers'] || '').toContain('Content-Type');
  });

  test('API responses from allowed origin include credentialed CORS headers', async ({ request }) => {
    const res = await request.get(`${API_BASE}/users/me`, {
      headers: {
        Origin: WEB_ORIGIN,
      },
    });
    ensureNoAuthRedirect(res);
    expect(res.headers()['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(res.headers()['access-control-allow-credentials']).toBe('true');
  });

  test('OPTIONS preflight from untrusted origin is rejected or not permissive', async ({ request }) => {
    const res = await request.fetch(`${API_BASE}/users/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    const allowedOrigin = res.headers()['access-control-allow-origin'];
    if (allowedOrigin) {
      expect(allowedOrigin).not.toBe('https://evil.example.com');
      expect(allowedOrigin).not.toBe('*');
    }
  });

  test('unsafe method from allowed origin is allowed only when authenticated', async ({ browser }) => {
    const context = await browser.newContext();
    const request = context.request;
    const res = await request.post(`${API_BASE}/users/me`, {
      headers: {
        Origin: WEB_ORIGIN,
      },
      data: {},
    });
    expect([401, 403]).toContain(res.status());
    await context.close();
  });
});
