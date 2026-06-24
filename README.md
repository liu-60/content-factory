# Ltool Content Factory

Ltool connects local `sync-doc` documents to a Chrome extension that can use logged-in creator sessions to create platform drafts or publish them.

## Local Commands

```powershell
npm install
npm run smoke
npm test
npm run ltool -- token show
npm run ltool -- token set <your-token>
npm run ltool -- status --timeout 30000
npm run ltool -- sync-doc .\sync-doc --platforms all
npm run workflow:toutiao -- --dir C:\Users\Administrator\Documents\temp
npm run workflow:toutiao:edge -- --dir C:\Users\Administrator\Documents\temp
npm run mcp
```

## Edge Workflow

Chrome scripts are kept as references. Use Edge for the live Toutiao flow:

```powershell
npm run edge:ltool
npm run workflow:toutiao:edge -- --dir C:\Users\Administrator\Documents\temp --timeout 180000
```

Use `npm run edge:ltool` to open the dedicated Edge profile for login. After login succeeds, return to the terminal and press Enter; Ltool saves the Edge storage state to `.playwright/ltool-edge-state.json` and closes Edge cleanly. The workflow restores that saved state before checking the Toutiao editor, then saves it again when the run finishes.

The Edge workflow launches a separate profile at `.playwright/ltool-edge-profile`, loads `Ltool/extension`, writes the local bridge token into the Edge extension storage, creates the Toutiao draft through the extension, and only after a draft URL is returned opens that URL in `Ltool/recordings/toutiao-cover.edge.js`. The Edge script switches the cover mode to single image, uploads the local cover, clicks preview, confirms publish, saves the Edge session, and closes the browser after a success/review state is detected. By default Edge uses bridge port `9528`, while the existing Chrome/CLI flow keeps `9527`; override it with `--port <port>` or `LTOOL_EDGE_WS_PORT` if needed.

## Record Cover Upload

Use Playwright codegen after an article draft URL is created:

```powershell
npm run codegen:cover -- --platform toutiao --url "https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=..."
npm run codegen:cover -- --platform baijiahao --url "https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=..."
```

The recording is saved under `Ltool/recordings/`. Record only the cover upload interaction, then close the codegen window.

## Extension

Load `C:\Users\Administrator\Documents\content-factory\Ltool\extension` as an unpacked Chrome extension. The popup shows:

- CLI/MCP bridge connection status
- token configuration status
- refreshable platform login status
- latest CLI or MCP caller and latest sync batch

The extension keeps the platform sessions in the browser. The CLI/MCP process only sends normalized article payloads through the local WebSocket bridge.
