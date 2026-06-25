# AGENTS.md — Ltool Content Factory

> 本文件供所有 AI 编码助手（WorkBuddy / Claude / Cursor / Copilot / Windsurf 等）读取。
> 读完后即可对齐项目上下文，无需从头摸索。最后更新：2026-06-25。

## 项目定位

Ltool 是多平台内容发布自动化工具：把本地 Markdown/HTML 文档，通过浏览器扩展复用已登录的创作者会话，自动创建平台草稿或发布。所有数据本地处理，无第三方服务器。

## 架构（数据流）

```
本地文档(sync-doc) → CLI/MCP进程 → WebSocket Bridge(ws) → 浏览器扩展(Chrome/Edge) → 平台API
```

- **CLI/MCP**：Node.js ESM，负责文档解析、调度、bridge 通信
- **Bridge**：本地 WebSocket（端口 9527 默认 / 9528 Edge），token 鉴权
- **扩展**：Chrome/Edge unpacked extension，持有平台登录态，调平台 API
- **浏览器**：Playwright launchPersistentContext + 独立 userDataDir 保存登录

## 技术栈

- Node.js ESM（`"type": "module"`，顶层 await）
- Playwright（浏览器自动化，chromium）
- @modelcontextprotocol/sdk（MCP server）
- ws（WebSocket）
- zod（校验）
- 测试：`node --test`（内置，不依赖 jest）

## 目录结构

```
Ltool/
  bin/          ltool.js(CLI入口) ltool-mcp.js(MCP入口)
  src/          核心库
    bridge.js         WebSocket Bridge（扩展通信）
    config.js         配置(~/.ltool/config.json)
    edge-ltool.js     浏览器启动+扩展加载+登录态
    platforms.js      平台注册表
    sync-doc.js       文档采集
    markdown.js       Markdown 处理
    playwright-cover.js  封面生成
  scripts/      工作流脚本(workflow-wechat-edge.js 等)
  extension/    浏览器扩展(background/popup/sync-engine)
  recordings/   录制的页面操作流程
  test/         node --test 测试
.playwright/    浏览器 profile + state（gitignore，勿提交）
Wechatsync-2/   开源 Wechatsync v2 参考（monorepo/pnpm/TS/适配器架构）
wechatsync-2.0.9/ 旧版参考
```

## 常用命令

```bash
npm install
npm test                    # node --test
npm run smoke               # 冒烟测试
npm run ltool -- token show
npm run ltool -- token set <token>
npm run ltool -- status --timeout 30000
npm run ltool -- sync-doc ./sync-doc --platforms all

# 平台工作流（需要先登录）
npm run workflow:wechat:chrome  -- --dir <文档目录> --timeout 180000
npm run workflow:toutiao:edge   -- --dir <文档目录> --timeout 180000
npm run workflow:baijiahao:edge -- --dir <文档目录> --timeout 240000 --schedule-publish
npm run mcp                 # 启动 MCP server
```

## 关键约定

- **ESM only**：import/export，顶层 await，无 require
- **轻量自研**：不依赖 commander/yargs，自己写 parseArgs；不依赖 dotenv，直接读 env
- **容错编程**：大量 `.catch(() => {})` 静默容错；try/catch/finally 确保资源清理（bridge.stop / context.close）
- **日志**：中英混合，`console.log` 状态、`console.error` 错误，结果用 `OK`/`FAIL` 前缀
- **Git**：单 master 分支；commit message 中文 + 中文冒号 `feat：` `fix：`
- **路径**：代码用 `resolve()` 处理跨平台；文档示例用 PowerShell
- **配置**：`~/.ltool/config.json`，token 首次自动生成（randomBytes hex）
- **.playwright/ 勿提交**：含登录态，已在 .gitignore

## 踩坑清单（重要，避免重复踩）

### 浏览器扩展 + Playwright

1. **扩展加载参数**：必须 `ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages']`，否则扩展不加载
2. **--load-extension 与 --disable-extensions-except 必须同时用**
3. **反检测**：`--disable-blink-features=AutomationControlled` 防止被平台识别为自动化
4. **Service Worker 不稳定**：需 `waitForLtoolWorker` 轮询；reload 后要重新等待；`seedLtoolSettings` 可能因 "Service worker restarted" 失败，需重试
5. **Chromium 路径**：Playwright 自带路径可能不存在，fallback 到 `%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win64/chrome.exe`

### 登录态管理（最易踩坑）

6. **微信登录会过期**：需 `isLoginFailure` 检测（正则 `/not logged in|login|登录|token/i`）
7. **登录重试流程**：首次失败 → 打开登录页 → 点击登录入口 → 轮询 `checkAuth`（每3秒）→ 保存 state → 重试
8. **登录入口选择器脆弱**：多候选（getByRole/getByText/locator.filter），逐个尝试
9. **默认不恢复 state**：`restoreState` 默认 false，避免旧 cookie 覆盖新登录；仅 `LTOOL_EDGE_RESTORE_STATE=true` 时恢复
10. **持久化 context**：`launchPersistentContext` + 独立 userDataDir（.playwright/ltool-*-profile）保存登录

### WebSocket Bridge

11. **端口约定**：9527（默认 config）/ 9528（Edge 默认）；Chrome 用 `LTOOL_CHROME_WS_PORT`
12. **启动顺序**：`bridge.start()` → 启动浏览器 → `waitForConnection`，顺序不能反
13. **请求超时**：默认 360000ms（6分钟），平台操作慢，勿随意调小

### 百家号特定

14. 需清除本地编辑器草稿缓存
15. 封面上传后要等待封面出现在槽位
16. `--schedule-publish` 触发定时发布对话框

### 通用

17. Windows 路径用 `resolve()`，勿硬编码反斜杠
18. `node_modules` 勿全局安装
19. 平台 API 响应格式可能变化，导致解析失败（401/403 → 查 Cookie/CSRF；CORS → 查 Header 规则）

## 平台支持

| 平台 | ID | 工作流状态 |
|------|-----|-----------|
| 微信公众号 | weixin | ✅ wechat:chrome/edge |
| 头条 | toutiao | ✅ toutiao:edge |
| 百家号 | baijiahao | ✅ baijiahao:edge |
| 小红书 | xiaohongshu | ⏳ 注册表已有，工作流待实现 |
| B站 | bilibili | ⏳ 同上 |
| 知乎 | zhihu | ⏳ 同上 |
| X | x | ⏳ 同上 |

## AI 协作提示

- 修改工作流脚本前，先读对应 `scripts/workflow-*.js` 理解登录重试逻辑
- 新增平台：先在 `platforms.js` 注册，再写 `scripts/workflow-<platform>-edge.js`
- 调试扩展：读 `extension/background.js` + `extension/sync-engine.js`
- 参考实现：`Wechatsync-2/packages/core/src/adapters/` 有各平台适配器
- 遇坑解决后，同步更新本文件踩坑清单 + `.workbuddy/memory/` 记忆
