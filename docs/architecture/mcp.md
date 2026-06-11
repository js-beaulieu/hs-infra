# MCP Gateway

## Resource URI

The intended MCP resource URI is:

```txt
https://api.tasks.${DOMAIN}/mcp
```

The protected-resource metadata route is:

```txt
https://api.tasks.${DOMAIN}/.well-known/oauth-protected-resource/mcp
```

MCP access tokens must include audience `https://api.tasks.${DOMAIN}/mcp` and group `/mcp-users`. Dynamically registered MCP clients should request the `mcp` scope, which carries the required audience and groups mapper.

The external `/mcp` route is handled by agentgateway and proxied to the real `tasks-api` Streamable HTTP MCP endpoint at `/api/mcp`. The agentgateway config is rendered from `agentgateway/config.yaml.tmpl` via the `agentgateway-bootstrap` service, so issuer, JWKS, and resource metadata stay environment-driven and no host-side script is required.

Validate full MCP initialize/session behavior with Claude, ChatGPT custom MCPs, or an MCP inspector.

## Token Lifespan

Tokens intentionally default to a long one-year `expires_in` via `MCP_ACCESS_TOKEN_LIFESPAN_SECONDS` because current MCP clients can mishandle token refresh or expired-token re-auth.

The `oauth2-proxy-tasks` client is explicitly pinned back to `OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS` (default five minutes), so browser/API auth does not inherit the long MCP/DCR lifetime.

Context:

- https://github.com/anthropics/claude-code/issues/26281
- https://github.com/axiomhq/mcp/pull/63
- https://github.com/Doist/todoist-mcp/issues/400#issuecomment-4096763597

## Dynamic Client Registration

DCR is enabled for MCP onboarding with scopes limited to `openid`, `profile`, `email`, and `mcp`, and trusted redirect/client hosts seeded for Claude and ChatGPT. Treat that as a first-pass allowlist: tighten it further after testing the real hosted connector flows.

## Backwards Compatibility

The old paths on `https://tasks.${DOMAIN}/api/mcp` and metadata at `https://tasks.${DOMAIN}/.well-known/oauth-protected-resource/api/mcp` are still routed for transition, but tokens must use the new canonical audience `https://api.tasks.${DOMAIN}/mcp`. Existing clients with tokens audience-bound to the old resource URI must be updated.

## Pattern For Future MCP Resources

The MCP auth policy pattern is intended for all MCP resources, including future apps. Each MCP resource still needs its own exact OAuth protected-resource metadata path, `resource` URI, token audience, backend target, and any app-specific route match.

Keep the shared requirements the same unless deliberately changed: strict MCP auth, issuer/JWKS validation, audience validation, `/mcp-users`, spoofed-header stripping, and no bearer-token forwarding to app APIs.
