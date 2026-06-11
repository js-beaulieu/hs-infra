# Keycloak

## Bootstrap

`keycloak-bootstrap` creates:

- Realm `home-stack`.
- Groups `/homelab-users`, `/tasks-users`, `/mcp-users`, and `/mcp-writers`.
- Confidential client `oauth2-proxy-tasks` with redirect URIs `https://api.tasks.${DOMAIN}/oauth2/callback` and temporary compatibility URI `https://tasks.${DOMAIN}/oauth2/callback`.
- Public client `tasks-mcp` for initial local MCP testing.
- `mcp` client scope carrying the MCP audience and group claim for dynamically registered MCP clients.
- Group claim mappers and audience mappers.

Create users in Keycloak and assign groups before testing login.

## Token Lifetimes

The realm default access-token lifespan is set from `MCP_ACCESS_TOKEN_LIFESPAN_SECONDS` and defaults to one year. This is intentional for MCP/DCR clients; several current MCP clients have long-standing refresh or expired-token re-authentication bugs, so short-lived MCP access tokens can break otherwise valid integrations.

Do not treat this default as an accidental production-hardening gap unless the MCP client ecosystem behavior changes. The `oauth2-proxy-tasks` client is explicitly pinned back to `OAUTH2_PROXY_ACCESS_TOKEN_LIFESPAN_SECONDS` (default five minutes), so browser/API auth does not inherit the long MCP/DCR lifetime.
