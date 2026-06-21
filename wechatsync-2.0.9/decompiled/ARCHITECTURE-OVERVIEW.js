// ============================================================================
// WechatSync v2.0.9 — 架构总览（反编译分析）
// ============================================================================
//
// 一、扩展基本信息
//   名称: 文章同步助手 (WechatSync)
//   版本: 2.0.9
//   Manifest: V3
//   功能: 一键同步文章到知乎、头条、掘金、微信公众号等 20+ 平台
//
//
// 二、目录结构与模块分工
//
//   manifest.json                 — 扩展清单，定义权限、内容脚本匹配规则、资源可访问性
//   service-worker-loader.js      — Service Worker 加载器（仅一行 import）
//   inject-api.js                 — 注入到网页 Main World 的 API 桥接
//   reader.js / Readability.js    — Mozilla Readability 内容提取引擎
//
//   assets/
//   ├── index.ts-Bw-475TG.js     — [核心] Service Worker 主逻辑 (227KB)
//   │                              29 个平台适配器 + 同步编排 + MCP 客户端 + XML-RPC
//   ├── api.ts-CHQebYkU.js       — Content Script 消息桥接 (3.7KB)
//   ├── sync-dialog-B0jLMiJM.js  — 同步对话框 React UI (3.2KB)
//   ├── popup-BNNxEQIB.js        — Popup 弹窗 React UI (82KB)
//   ├── editor-91KajDge.js       — 全屏编辑器 React UI (9.3KB)
//   ├── content-processor-COHfnfLF.js — 23 步 HTML 清洗管道 (11KB)
//   ├── extractor.ts-ysAklU8v.js — 文章提取引擎：Defuddle + 10 平台适配 (198KB)
//   ├── fab-W2bspDnB.js          — 浮动操作按钮组件 (2.6KB)
//   ├── weixin.ts-DnI7OB4I.js    — 微信公众号文章页处理器 (4.6KB)
//   ├── weixin-editor.ts-BvjP2fPl.js — 微信编辑器页处理器 (8KB)
//   ├── toutiao.ts-Brq6w7IU.js   — 头条 Fetch 代理 (506B)
//   ├── preprocessor-n7jhDIUx.js — 平台级 HTML 预处理器 (552B)
//   ├── remote-config-BEX-YVxx.js — 远程配置拉取（阿里云 OSS）(1.5KB)
//   ├── version-check-C8vm5ItJ.js — 版本检查 + 分析 + 限流 (6.7KB)
//   ├── logger-CvfM-6aa.js       — 分级日志器 (505B)
//   ├── jszip.min-DpCewD43.js    — JSZip 库（ZIP 打包/HTML→Markdown）
//   └── globals-Cn4U41aQ.js      — React + Tailwind + UI 组件库
//
//   src/
//   ├── popup/index.html          — Popup 入口页
//   ├── editor/index.html         — 编辑器入口页
//   ├── sync-dialog/index.html    — 同步对话框入口页
//   └── preprocessor/index.html   — 预处理器入口页
//
//
// 三、核心数据流
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ 1. 文章提取                                                  │
//   │    Content Script 检测到文章页 →                              │
//   │    平台特定提取器（微信/飞书/Twitter...）优先 →              │
//   │    通用三路竞争（Safari Reader + Defuddle + Readability）→    │
//   │    评分系统选最优结果                                        │
//   └───────────────────┬──────────────────────────────────────────┘
//                       │ {title, content(HTML), markdown, thumb}
//                       ▼
//   ┌──────────────────────────────────────────────────────────────┐
//   │ 2. 内容预处理                                                │
//   │    content-processor 23 步清洗管道：                          │
//   │    移除 iframe/注释/特殊标签 → 处理代码块 →                  │
//   │    懒加载图片解析 → 清理空元素 → 移除 data-* 属性            │
//   └───────────────────┬──────────────────────────────────────────┘
//                       │ 清洗后的 HTML
//                       ▼
//   ┌──────────────────────────────────────────────────────────────┐
//   │ 3. 图片上传                                                  │
//   │    提取 HTML 中所有 <img> src →                              │
//   │    并发上传到目标平台的 CDN（微博/知乎/掘金...）→             │
//   │    替换 HTML 中的图片 URL 为平台 CDN URL                     │
//   └───────────────────┬──────────────────────────────────────────┘
//                       │ 图片已替换的 HTML
//                       ▼
//   ┌──────────────────────────────────────────────────────────────┐
//   │ 4. 格式转换                                                  │
//   │    根据目标平台要求转换格式：                                 │
//   │    - Draft.js JSON（豆瓣等）                                 │
//   │    - ProseMirror JSON（小红书）                              │
//   │    - 富文本 HTML（微信公众号、大多数平台）                   │
//   │    - Markdown（部分平台）                                    │
//   └───────────────────┬──────────────────────────────────────────┘
//                       │ 平台特定格式
//                       ▼
//   ┌──────────────────────────────────────────────────────────────┐
//   │ 5. 发布到平台                                                │
//   │    调用各平台 API 创建草稿/发布文章：                         │
//   │    - REST API（知乎、掘金、CSDN、微博...）                   │
//   │    - XML-RPC（WordPress、Typecho/MetaWeblog）               │
//   │    - GraphQL（部分新平台）                                   │
//   │    返回草稿链接或发布 URL                                    │
//   └──────────────────────────────────────────────────────────────┘
//
//
// 四、三层消息桥接架构
//
//   ┌─────────────────────────────────────┐
//   │ 网页 JS (inject-api.js, Main World) │  window.$poster / window.$syncer
//   │  eventID 回调模式                    │
//   └──────────────┬──────────────────────┘
//                  │ window.postMessage
//   ┌──────────────▼──────────────────────┐
//   │ Content Script (api.ts, Isolated)    │  消息路由 + 进度转发
//   │  同步状态管理 + syncId 防串扰        │
//   └──────────────┬──────────────────────┘
//                  │ chrome.runtime.sendMessage
//   ┌──────────────▼──────────────────────┐
//   │ Service Worker (index.ts)            │  同步编排 + 适配器调度
//   │  认证检查 + 存储管理 + MCP           │
//   └─────────────────────────────────────┘
//
//
// 五、29 个平台适配器一览
//
//   社交/社区: 豆瓣、雪球、搜狐、人人都是产品经理、微博、B站
//   技术:     知乎、掘金、CSDN、51CTO、慕课网、开源中国、
//             SegmentFault、博客园
//   自媒体:   微信公众号、百家号、语雀、大鱼号、网易号、
//             搜狐焦点、头条号、简书、什么值得买、东方财富、
//             一点资讯、小红书
//   国际:     X/Twitter、抖音
//   其他:     ZIP 打包下载
//
//
// 六、关键设计模式
//
//   1. 适配器模式: BaseAdapter 基类定义统一接口，各平台继承实现
//   2. 注册表模式: AdapterRegistry 单例，按平台 ID 懒实例化适配器
//   3. 事件 ID 回调: postMessage 的异步请求-响应关联
//   4. syncId 防串扰: 每次同步生成唯一 ID，过滤无关进度消息
//   5. 三路竞争提取: Safari Reader + Defuddle + Readability 评分择优
//   6. 批量并发: 同步编排器最多 3 个平台并行，AbortController 支持取消
//   7. 认证 TTL 缓存: 减少重复认证请求
//   8. MCP WebSocket: JSON-RPC 2.0 协议，支持外部 AI 工具远程调用
//
// ============================================================================
