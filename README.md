# Ltool Content Factory

Ltool connects local `sync-doc` documents to a browser extension that can use logged-in creator sessions to create platform drafts or publish them.

## Local Commands

```powershell
npm install
npm run smoke
npm test
npm run ltool -- token show
npm run ltool -- token set <your-token>
npm run ltool -- status --timeout 30000
npm run ltool -- sync-doc .\sync-doc --platforms all
npm run workflow:toutiao:edge -- --dir C:\Users\Administrator\Documents\temp --timeout 180000
npm run workflow:baijiahao:edge -- --dir C:\Users\Administrator\Documents\temp --timeout 240000 --schedule-publish
npm run mcp
```

## Edge Workflows

Use `npm run edge:ltool -- --platform <platform>` to open the dedicated Edge profile for login. After login succeeds, return to the terminal and press Enter; Ltool saves the Edge storage state to `.playwright/ltool-edge-state.json`.

The Edge workflows launch a separate profile at `.playwright/ltool-edge-profile`, load `Ltool/extension`, write the local bridge token into extension storage, and create platform drafts through the shared extension API. By default Edge uses bridge port `9528`; override it with `--port <port>` or `LTOOL_EDGE_WS_PORT`.

### Baijiahao

The Baijiahao workflow is intentionally one clean production path:

```powershell
npm run workflow:baijiahao:edge -- --dir C:\Users\Administrator\Documents\temp --timeout 240000 --schedule-publish
```

It creates a Baijiahao draft, opens the returned `rc/edit` URL, clears stale local editor draft cache, uploads the same-folder cover image, waits for the cover to appear in the Baijiahao cover slot, saves the draft, and then submits the platform scheduled-publish dialog when `--schedule-publish` is present.

## Extension

Load `C:\Users\Administrator\Documents\content-factory\Ltool\extension` as an unpacked browser extension. The popup shows bridge connection status, token configuration, platform login status, and the latest sync batch.

The extension keeps platform sessions in the browser. The CLI/MCP process only sends normalized article payloads through the local WebSocket bridge.
