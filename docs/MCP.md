# MCP

**The MCP implementation is a first-class HTTP API surface, not a sidecar.** The web service mounts it at **`/mcp`**, where it serves a per-request `McpServer` over **Streamable HTTP** using `@modelcontextprotocol/sdk`.

A good mental model is:

1. **Discovery and auth**
   - OAuth discovery is exposed from the main app via `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`.
   - Dynamic client registration is available at `/oauth/register` when enabled.
   - The MCP endpoint accepts **MCP, OAuth, or API auth**, but the team must have **`TeamPreference.MCP`** enabled.

2. **Server construction**
   - `server/routes/mcp/index.ts` creates a **fresh MCP server per request**.
   - It appends built-in usage instructions plus optional team-specific **`guidanceMCP`**.
   - Registered tools are filtered by the caller’s **granted OAuth scopes**.

3. **Tool surface**
   - Tool groups live in `server/tools/`.
   - Main tools are:
     - **documents**: `list_documents`, `list_collection_documents`, `create_document`, `move_document`, `update_document`, `delete_document`
     - **collections**: `list_collections`, `create_collection`, `update_collection`, `delete_collection`
     - **comments**: `list_comments`, `create_comment`, `update_comment`, `delete_comment`
     - **users**: `list_users`
     - **attachments**: `create_attachment`
     - **fetch**: fetches a document, collection, user, or attachment payload by id/reference

4. **How it stays consistent with the rest of the app**
   - MCP tools mostly **reuse existing app internals** instead of reimplementing logic:
     - authorization via `authorize` / `can`
     - document mutations via normal **commands** like `documentCreator`, `documentUpdater`, `documentMover`
     - response shaping via **presenters**
     - search through the normal **SearchProviderManager**
   - `server/tools/util.ts` builds a minimal **APIContext** from MCP auth so those existing commands can run unchanged.

5. **Operational details**
   - MCP requests are rate-limited to **1000/hour**.
   - Tool invocations are wrapped with **Datadog tracing** under service name `mcp`.
   - The built-in MCP instructions enforce a few Outline-specific rules, like:
     - document markdown should **not** start with an H1
     - mentions use `@[Display Name](mention://user/userId)`
     - attachments/images should be read through the **`fetch`** tool

So overall, the MCP part is essentially **an authenticated, scope-aware tool layer over Outline’s existing backend domain logic**, exposed at `/mcp` with OAuth discovery and registration around it.
