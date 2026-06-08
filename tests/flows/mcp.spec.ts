import { test, expect } from "@playwright/test";
import {
  MCP_RESOURCE,
  MCP_METADATA,
  MCP_AS_METADATA,
  MCP_DCR,
  MCP_TOKEN_VALID,
  MCP_TOKEN_WRONG_AUD,
  MCP_TOKEN_EXPIRED,
  MCP_TOKEN_MISSING_GROUP,
} from "./env";

const MCP_POST_ACCEPT = "application/json, text/event-stream";
const MCP_GET_ACCEPT = "text/event-stream";

test.describe("mcp flow", () => {
  test.describe("protected resource metadata (RFC 9728)", () => {
    test("metadata endpoint returns 200 with required fields", async ({
      request,
    }) => {
      const res = await request.get(`${MCP_METADATA}`);
      expect(res.status()).toBe(200);
      const json = await res.json();
      expect(json.resource).toBe(MCP_RESOURCE);
      expect(json.authorization_servers).toBeDefined();
      expect(json.bearer_methods_supported).toContain("header");
    });

    test("metadata resource URI matches the configured MCP resource exactly", async ({
      request,
    }) => {
      const res = await request.get(`${MCP_METADATA}`);
      expect(res.status()).toBe(200);
      const json = await res.json();
      expect(json.resource).toBe(MCP_RESOURCE);
    });
  });

  test.describe("authorization server metadata (RFC 8414)", () => {
    test("AS metadata endpoint returns 200 with required fields", async ({
      request,
    }) => {
      const res = await request.get(`${MCP_AS_METADATA}`);
      expect(res.status()).toBe(200);
      const json = await res.json();
      expect(json.issuer).toBeDefined();
      expect(json.authorization_endpoint).toBeDefined();
      expect(json.token_endpoint).toBeDefined();
    });
  });

  test.describe("dynamic client registration (RFC 7591)", () => {
    test("DCR endpoint registers a new public MCP client and returns client_id", async ({
      request,
    }) => {
      const res = await request.post(`${MCP_DCR}`, {
        headers: { "Content-Type": "application/json" },
        data: {
          client_name: "flow-test-mcp-client",
          redirect_uris: ["http://localhost:7777/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "openid profile email mcp",
        },
      });
      expect(res.status()).toBe(201);
      const json = await res.json();
      expect(json.client_id).toBeTruthy();
      expect(json.client_secret).toBeFalsy();
      expect(json.token_endpoint_auth_method).toBe("none");
      expect(json.grant_types).toContain("authorization_code");
    });

    test("DCR rejects registration with disallowed scope", async ({
      request,
    }) => {
      const res = await request.post(`${MCP_DCR}`, {
        headers: { "Content-Type": "application/json" },
        data: {
          client_name: "flow-test-bad-scope",
          redirect_uris: ["http://localhost:7777/callback"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "openid profile email mcp admin",
        },
      });
      expect([400, 403]).toContain(res.status());
    });
  });

  test.describe("unauthenticated access", () => {
    test("MCP request without token returns 401 with WWW-Authenticate", async ({
      request,
    }) => {
      const res = await request.get(`${MCP_RESOURCE}`, {
        headers: { Accept: MCP_GET_ACCEPT },
      });
      expect(res.status()).toBe(401);
      const wwwAuth = res.headers()["www-authenticate"];
      expect(wwwAuth).toBeTruthy();
    });

    test("MCP POST without token returns 401", async ({ request }) => {
      const res = await request.post(`${MCP_RESOURCE}`, {
        headers: {
          Accept: MCP_POST_ACCEPT,
          "Content-Type": "application/json",
        },
        data: { jsonrpc: "2.0", method: "initialize", id: 1, params: {} },
      });
      expect(res.status()).toBe(401);
    });

    test("browser SSO cookies alone do not authorize MCP", async ({
      browser,
    }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("about:blank");
      const req = context.request;
      const res = await req.get(`${MCP_RESOURCE}`, {
        headers: { Accept: MCP_GET_ACCEPT },
      });
      expect(res.status()).toBe(401);
      await context.close();
    });
  });

  test.describe("token validation", () => {
    test("invalid bearer token returns 401", async ({ request }) => {
      const res = await request.get(`${MCP_RESOURCE}`, {
        headers: {
          Authorization: "Bearer INVALID_TOKEN",
          Accept: MCP_GET_ACCEPT,
        },
      });
      expect(res.status()).toBe(401);
      const wwwAuth = res.headers()["www-authenticate"];
      expect(wwwAuth).toBeTruthy();
    });

    test("wrong audience token returns 401", async ({ request }) => {
      test.skip(!MCP_TOKEN_WRONG_AUD, "MCP_TOKEN_WRONG_AUD not configured");
      const res = await request.get(`${MCP_RESOURCE}`, {
        headers: {
          Authorization: `Bearer ${MCP_TOKEN_WRONG_AUD}`,
          Accept: MCP_GET_ACCEPT,
        },
      });
      expect(res.status()).toBe(401);
    });

    test("expired token returns 401", async ({ request }) => {
      test.skip(!MCP_TOKEN_EXPIRED, "MCP_TOKEN_EXPIRED not configured");
      const res = await request.get(`${MCP_RESOURCE}`, {
        headers: {
          Authorization: `Bearer ${MCP_TOKEN_EXPIRED}`,
          Accept: MCP_GET_ACCEPT,
        },
      });
      expect(res.status()).toBe(401);
      const wwwAuth = res.headers()["www-authenticate"];
      expect(wwwAuth).toBeTruthy();
    });

    test("valid token missing /mcp-users group returns 403", async ({
      request,
    }) => {
      test.skip(
        !MCP_TOKEN_MISSING_GROUP,
        "MCP_TOKEN_MISSING_GROUP not configured",
      );
      const res = await request.get(`${MCP_RESOURCE}`, {
        headers: {
          Authorization: `Bearer ${MCP_TOKEN_MISSING_GROUP}`,
          Accept: MCP_GET_ACCEPT,
        },
      });
      expect(res.status()).toBe(403);
    });

    test("valid MCP token passes auth on GET (422 session required)", async ({
      request,
    }) => {
      test.skip(!MCP_TOKEN_VALID, "MCP_TOKEN_VALID not configured");
      const res = await request.get(`${MCP_RESOURCE}`, {
        headers: {
          Authorization: `Bearer ${MCP_TOKEN_VALID}`,
          Accept: MCP_GET_ACCEPT,
        },
      });
      expect(res.status()).toBe(422);
    });

    test("valid MCP token initializes session via POST", async ({
      request,
    }) => {
      test.skip(!MCP_TOKEN_VALID, "MCP_TOKEN_VALID not configured");
      const res = await request.post(`${MCP_RESOURCE}`, {
        headers: {
          Authorization: `Bearer ${MCP_TOKEN_VALID}`,
          Accept: MCP_POST_ACCEPT,
          "Content-Type": "application/json",
        },
        data: {
          jsonrpc: "2.0",
          method: "initialize",
          id: 1,
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "flow-test", version: "1.0" },
          },
        },
      });
      expect(res.status()).toBe(200);
    });
  });

  test.describe("route boundary", () => {
    test("/mcpfoo does not match MCP route and has no MCP WWW-Authenticate", async ({
      request,
    }) => {
      const res = await request.get(`${MCP_RESOURCE}foo`, {
        headers: { Accept: MCP_GET_ACCEPT },
      });
      const wwwAuth = res.headers()["www-authenticate"];
      if (res.status() === 401) {
        expect(wwwAuth).toBeFalsy();
      }
    });
  });
});
