# Remote MCP for Claude

Fixes #81.

## Decisions
- **One set of tools.** `done-mcp` gets a `Tasks` trait over the nine calls its tools make; the tasks
  file (`Store`) and the server (`Remote`, one account in Postgres) both implement it. No second MCP server.
- **Transport:** Streamable HTTP in its simplest form: one JSON-RPC message per POST, one JSON reply,
  202 for notifications, 405 for GET. No tool sends anything unasked, so no stream or session.
- **Auth:** OAuth 2.1 with PKCE and dynamic registration (MCP authorization spec, what Claude's
  connectors use). Stateless like the session: client ids, codes and refresh tokens are text signed
  with the server key. Access tokens are the same sealed session the apps hold.
- **Consent page** before any code is issued; the session cookie is SameSite=Lax so a cross-site
  post cannot approve. A redirect address the client did not register is never sent anything.
- **Time zone:** an MCP client does not say where its person is; `DONE_TIME_ZONE` (default
  America/Los_Angeles) decides "today" for `/mcp`. The apps are unaffected.

## Limits
- Tokens cannot be revoked one by one (30 days; refresh a year). Signing out does not end them.
- Apple and App Review accounts cannot connect yet: the web sign-in page offers Google only.
