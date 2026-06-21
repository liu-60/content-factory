/**
 * ============================================================================
 * api.ts-CHQebYkU.beautified.js — Content Script 层 API 桥接器（隔离世界 / Isolated World）
 * ============================================================================
 *
 * 【架构位置】
 *   网页 JS 上下文 (inject-api.js, Main World)
 *       ↕ window.postMessage
 *   ★ 本文件：Content Script（Isolated World） ★
 *       ↕ chrome.runtime.sendMessage / onMessage
 *   Service Worker（后台脚本）
 *
 * 【职责】
 *   作为网页上下文和扩展后台之间的双向消息桥梁：
 *   1. 接收 inject-api.js 的 postMessage 请求，转译为 chrome.runtime 消息发给 Service Worker
 *   2. 接收 Service Worker 的推送通知（同步进度/完成/错误），转译为 postMessage 推回页面
 *   3. 维护当前同步任务的本地状态（账号列表 d、同步 ID l）
 *   4. 注入 inject-api.js 脚本到页面上下文
 *
 * 【完整消息流概览】
 *
 *   ┌─────────────┐  postMessage   ┌──────────────────┐  chrome.runtime   ┌────────────────┐
 *   │ inject-api  │ ──────────────→│  本文件 (Content  │ ────────────────→ │ Service Worker │
 *   │ (页面上下文) │ ←──────────────│  Script 桥接器)  │ ←──────────────── │ (后台脚本)     │
 *   └─────────────┘  postMessage   └──────────────────┘  onMessage         └────────────────┘
 *
 *   请求方向（页面 → 扩展）：
 *     getAccounts   → CHECK_ALL_AUTH   → 返回已认证平台列表
 *     addTask       → SYNC_ARTICLE     → 启动文章同步
 *     magicCall     → MAGIC_CALL       → 通用远程调用
 *     uploadImage   → UPLOAD_IMAGE     → 图片上传（走专用快速通道）
 *     updateDriver  → [已废弃，直接返回]
 *     startInspect  → [已废弃，直接返回]
 *
 *   推送方向（扩展 → 页面）：
 *     SYNC_PROGRESS       → taskUpdate（简化格式）
 *     SYNC_DETAIL_PROGRESS→ taskUpdate（带阶段细节）
 *     SYNC_COMPLETE       → 清理本地状态
 *     consoleLog          → consoleLog（转发日志）
 *
 * 【同步 ID (syncId) 机制】
 *   每次 addTask 会生成唯一 syncId = "sync_{时间戳}_{随机串}"。
 *   后续 Service Worker 的推送消息都带 syncId，用于：
 *   - 防止不同同步任务的进度消息互相干扰
 *   - 如果收到不属于当前 syncId 的消息则忽略
 * ============================================================================
 */

// ========== 依赖导入 ==========
// y = JSZip 的 html2markdown 转换函数（用于将 HTML 内容转为 Markdown）
import {
    h as y
} from "./jszip.min-DpCewD43.js";

// g = 日志工厂函数，创建带命名空间的 logger
import {
    c as g
} from "./logger-CvfM-6aa.js";
import "./_commonjsHelpers-BosuxZz1.js";

// 创建带 "Wechatsync" 前缀的 logger 实例
const m = g("Wechatsync");

// ========== 白名单域名列表 ==========
// 只有来自这些域名的废弃 API 调用（updateDriver / startInspect）才会被处理
// 这是安全措施，防止任意网页调用扩展的旧版管理接口
const I = [
    "https://www.wechatsync.com",      // 官网
    "https://developer.wechatsync.com", // 开发者站点
    "http://localhost:8080"             // 本地开发环境
];

// ========== 同步状态变量 ==========

// l = 当前同步任务的 syncId
// null 表示没有正在进行的同步任务
let l = null;

// d = 当前同步任务的目标账号状态数组
// 每个元素: { type, title, displayName, icon, avatar, uid, home, supportTypes, status, msg, error, editResp }
// status 可取: "uploading" | "done" | "failed"
let d = [];


// ============================================================================
// 向页面发送消息的工具函数
// ============================================================================

/**
 * i() — 向页面上下文发送带 callReturn 标记的响应消息
 *
 * 这是"事件 ID 回调模式"的响应端：
 * - callReturn=true 告诉 inject-api.js 这是一条 RPC 响应
 * - eventID 与原始请求匹配，触发对应的回调函数
 *
 * @param {Object} e - 消息体，通常包含 eventID 和 result
 */
function i(e) {
    e.callReturn = !0;  // 标记为"调用返回"，inject-api.js 据此区分响应和推送
    window.postMessage(JSON.stringify(e), "*");
}

/**
 * h() — 向页面上下文推送任务状态更新
 *
 * 这不是 RPC 响应，而是主动推送（taskUpdate 方法）。
 * inject-api.js 中的 _statueandler 回调会收到这个推送。
 *
 * @param {Object} e - 任务状态，格式为 { accounts: [...] }
 */
function h(e) {
    window.postMessage(JSON.stringify({
        method: "taskUpdate",  // inject-api.js 根据此字段路由到 _statueandler
        task: e
    }), "*");
}


// ============================================================================
// 监听来自 Service Worker 的消息（推送方向：扩展 → 页面）
// ============================================================================

chrome.runtime.onMessage.addListener((e, p, r) => {
    // e = 消息对象, p = sender, r = sendResponse
    var a, s, t;
    try {
        // ---- syncId 过滤 ----
        // 如果消息带有 syncId，且不等于当前任务的 syncId，则忽略
        // 防止上一次同步的延迟消息干扰新同步
        if (e.syncId && l && e.syncId !== l) return;

        // ---- 任务状态更新（简化格式） ----
        // Service Worker 直接转发 taskUpdate 给页面
        if (e.method === "taskUpdate") {
            i({
                task: e.task,
                method: "taskUpdate"
            });
            return;
        }

        // ---- 控制台日志转发 ----
        // 将 Service Worker 的日志输出转发到页面的 _consolehandler
        if (e.method === "consoleLog") {
            i({
                args: e.args,
                method: "consoleLog"
            });
            return;
        }

        // ---- SYNC_PROGRESS：平台级同步结果 ----
        // 某个平台同步完成（成功或失败）时触发
        //
        // 消息格式（两种可能的来源格式）：
        //   格式 A: { type: "SYNC_PROGRESS", result: { platform, success, error, postUrl/url } }
        //   格式 B: { type: "SYNC_PROGRESS", payload: { result: { ... } } }
        if (e.type === "SYNC_PROGRESS") {
            // 兼容两种格式，优先取 e.result，其次取 e.payload.result
            const n = e.result || ((a = e.payload) == null ? void 0 : a.result);
            if (n) {
                // 在本地状态数组 d 中找到对应平台的条目
                const o = d.find(u => u.type === n.platform);
                if (o) {
                    // 更新该平台的状态
                    o.status = n.success ? "done" : "failed";
                    o.error = n.error;
                    o.msg = void 0;  // 清除进度提示文字

                    // 成功时保存草稿链接（用于后续在 UI 上显示"查看"按钮）
                    o.editResp = n.success ? {
                        draftLink: n.postUrl || n.url
                    } : null;
                }
                // 推送更新后的完整账号列表到页面
                h({ accounts: d });
            }
        }

        // ---- SYNC_DETAIL_PROGRESS：细粒度进度更新 ----
        // 同步过程中的阶段性进度（如"上传图片 3/10"、"保存中..."）
        //
        // 消息格式：
        //   { type: "SYNC_DETAIL_PROGRESS", platform, stage, imageProgress: {current, total} }
        //   或 { type: "SYNC_DETAIL_PROGRESS", payload: { platform, stage, ... } }
        if (e.type === "SYNC_DETAIL_PROGRESS") {
            const n = e.payload || e;  // 兼容两种格式
            const o = d.find(u => u.type === n.platform);
            if (o) {
                o.status = "uploading";  // 保持 uploading 状态

                // 根据 stage 生成可读的进度文字
                o.msg = n.stage === "uploading_images"
                    ? `上传图片 ${(s = n.imageProgress) == null ? void 0 : s.current}/${(t = n.imageProgress) == null ? void 0 : t.total}`
                    // 例如: "上传图片 3/10"
                    : n.stage === "saving"
                    ? "保存中..."
                    : n.stage;  // 其他阶段直接用 stage 名称
            }
            h({ accounts: d });
        }

        // ---- SYNC_COMPLETE：所有平台同步完成 ----
        // 清理本地状态，准备接受下一次同步
        if (e.type === "SYNC_COMPLETE") {
            l = null;  // 重置 syncId
            d = [];    // 清空账号状态数组
        }

    } catch (n) {
        m.error("Error handling message:", n);
    }
});


// ============================================================================
// 监听来自页面上下文的消息（请求方向：页面 → 扩展）
// ============================================================================

window.addEventListener("message", async e => {
    var p;
    try {
        // 解析来自 inject-api.js 的 JSON 消息
        const r = JSON.parse(e.data);

        // 没有 method 字段的消息不是我们的协议消息，忽略
        if (!r.method) return;

        // ================================================================
        // getAccounts — 获取已认证的平台账号列表
        // ================================================================
        //
        // 请求: { method: "getAccounts", eventID: xxx }
        // 转发: { type: "CHECK_ALL_AUTH" } → Service Worker
        // 响应: { eventID: xxx, callReturn: true, result: [{type, title, ...}] }
        //
        if (r.method === "getAccounts" && chrome.runtime.sendMessage(
            { type: "CHECK_ALL_AUTH" },
            a => {
                // 错误处理：Service Worker 可能无响应（如扩展被禁用/更新中）
                if (chrome.runtime.lastError) {
                    m.error("getAccounts error:", chrome.runtime.lastError);
                    i({
                        eventID: r.eventID,
                        result: []  // 出错时返回空数组，避免页面端挂起
                    });
                    return;
                }

                // 从 Service Worker 的响应中提取平台列表
                // platforms 数组中每个平台包含：id, isAuthenticated, username, name, icon, homepage 等
                const s = ((a == null ? void 0 : a.platforms) || [])
                    // 只返回已认证（已登录）的平台
                    .filter(t => t.isAuthenticated)
                    .map(t => ({
                        type: t.id,           // 平台标识符 (如 "wechat", "zhihu")
                        title: t.username || t.name,  // 用户名（优先用 username）
                        displayName: t.name,  // 平台显示名（如 "微信公众号"）
                        icon: t.icon,         // 平台图标 URL
                        avatar: t.icon,       // 用户头像（复用平台图标）
                        uid: t.username,      // 用户 ID
                        home: t.homepage,     // 用户在平台上的主页 URL
                        supportTypes: ["html"] // 支持的内容格式（目前固定为 html）
                    }));

                // 通过 eventID 回调模式返回结果
                i({
                    eventID: r.eventID,
                    result: s
                });
            }
        ),

        // ================================================================
        // addTask — 发起文章同步任务
        // ================================================================
        //
        // 请求: { method: "addTask", task: { post: {title, content, thumb}, accounts: [...] }, eventID }
        // 转发: { type: "SYNC_ARTICLE", payload: { article, platforms, source, syncId } } → Service Worker
        //
        // 这是整个扩展的核心流程：
        // 1. 生成唯一 syncId
        // 2. 初始化本地账号状态数组
        // 3. 提取文章内容（HTML → Markdown 转换）
        // 4. 发送给 Service Worker 启动同步
        // 5. 后续通过 onMessage 接收进度推送
        //
        r.method === "addTask") {

            const { task: a } = r;
            const { post: s, accounts: t } = a;

            // 提取目标平台标识符数组（如 ["wechat", "zhihu", "juejin"]）
            const n = t.map(c => c.type);

            // 生成同步 ID，格式: "sync_1700000000000_a1b2c3d4e"
            // 用于关联后续进度消息，防止多次同步互相干扰
            l = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // 初始化每个目标平台的状态对象
            d = t.map(c => ({
                type: c.type,
                title: c.title,
                displayName: c.displayName,
                icon: c.icon,
                avatar: c.avatar,
                uid: c.uid,
                home: c.home,
                supportTypes: c.supportTypes,
                status: "uploading",       // 初始状态：上传中
                msg: "准备同步...",         // 初始提示文字
                error: void 0,             // 暂无错误
                editResp: null             // 暂无草稿链接
            }));

            // 立即推送初始状态到页面，让 UI 显示"准备同步..."
            h({ accounts: d });

            // 提取文章内容
            const o = s.content || "";  // HTML 内容

            // Markdown 内容：优先使用已有的 markdown 字段，
            // 否则用 JSZip 模块中的 html2markdown 函数转换
            // 这确保了即使页面只提供 HTML，也能生成 Markdown 给需要 Markdown 的平台
            const u = s.markdown || (o ? y(o) : "");

            // 发送同步请求到 Service Worker
            chrome.runtime.sendMessage({
                type: "SYNC_ARTICLE",
                payload: {
                    article: {
                        title: s.title,     // 文章标题
                        content: o,          // HTML 内容
                        html: o,             // HTML 内容（冗余字段，兼容不同平台适配器）
                        markdown: u,         // Markdown 内容
                        cover: s.thumb       // 封面图 URL
                    },
                    platforms: n,            // 目标平台标识符数组
                    source: "legacy-api",    // 来源标识（区分来自旧版 API 还是新版 sync dialog）
                    syncId: l                // 同步 ID，Service Worker 会在推送中回传
                }
            }, c => {
                // Service Worker 的即时响应（非最终结果）
                // 最终结果通过 onMessage 的 SYNC_PROGRESS / SYNC_COMPLETE 推送
                if (chrome.runtime.lastError) {
                    m.error("addTask error:", chrome.runtime.lastError);
                }
            });
        }

        // ================================================================
        // magicCall — 通用远程方法调用（含 uploadImage 专用快速通道）
        // ================================================================
        //
        // 请求: { method: "magicCall", methodName: "...", data: {...}, eventID }
        //
        // 两种路由：
        //   A. methodName === "uploadImage" → { type: "UPLOAD_IMAGE", payload }
        //      图片上传走专用通道，参数经过提取和简化
        //   B. 其他 methodName → { type: "MAGIC_CALL", payload: { methodName, data } }
        //      透传到 Service Worker，由后台路由到对应平台适配器
        //
        if (r.method === "magicCall") {
            const { methodName: a, data: s } = r;

            if (a === "uploadImage") {
                // ---- 图片上传（专用通道） ----
                //
                // 用途：将文章中的图片上传到目标平台的图床，
                //       避免跨域引用导致的图片防盗链问题。
                //       例如微信的图片必须上传到微信图床才能正常显示。
                //
                // payload:
                //   src: 原始图片 URL
                //   platform: 目标平台（默认 "weibo"）
                //
                chrome.runtime.sendMessage({
                    type: "UPLOAD_IMAGE",
                    payload: {
                        src: s.src,
                        // 从 account.type 取平台标识，默认用微博图床
                        platform: ((p = s.account) == null ? void 0 : p.type) || "weibo"
                    }
                }, t => {
                    if (chrome.runtime.lastError) {
                        i({
                            eventID: r.eventID,
                            result: { error: chrome.runtime.lastError.message }
                        });
                        return;
                    }
                    // 返回上传结果（通常包含新 URL）
                    i({
                        eventID: r.eventID,
                        result: t
                    });
                });

            } else {
                // ---- 通用远程方法调用 ----
                //
                // 透传 methodName 和 data 到 Service Worker，
                // Service Worker 根据 methodName 路由到对应的平台适配器方法。
                // 例如：获取草稿列表、发布文章等平台特定操作。
                //
                chrome.runtime.sendMessage({
                    type: "MAGIC_CALL",
                    payload: {
                        methodName: a,
                        data: s
                    }
                }, t => {
                    if (chrome.runtime.lastError) {
                        i({
                            eventID: r.eventID,
                            result: { error: chrome.runtime.lastError.message }
                        });
                        return;
                    }
                    i({
                        eventID: r.eventID,
                        result: t
                    });
                });
            }
        }

        // ================================================================
        // 已废弃的 v1 API（仅白名单域名可调用）
        // ================================================================
        //
        // updateDriver 和 startInspect 是 v1 版本的管理接口：
        //   - updateDriver: 动态更新平台适配器代码
        //   - startInspect: 启动页面内容检测模式
        // v2 中这些功能已内建，不再需要页面端触发。
        //
        // 安全限制：仅白名单域名（wechatsync.com 等）可调用，
        // 防止恶意网页通过 postMessage 操控扩展行为。
        //
        if (I.indexOf(e.origin) > -1) {
            if (r.method === "updateDriver") {
                m.warn("updateDriver is deprecated in v2");
                i({
                    eventID: r.eventID,
                    result: { success: !0, deprecated: !0 }
                });
            }
            if (r.method === "startInspect") {
                m.warn("startInspect is deprecated in v2");
                i({
                    eventID: r.eventID,
                    result: { success: !0, deprecated: !0 }
                });
            }
        }

    } catch {
        // 忽略非 JSON 消息或其他解析错误
        // 页面上可能有大量无关的 postMessage 通信
    }
});


// ============================================================================
// 脚本注入 — 将 inject-api.js 注入到页面上下文
// ============================================================================

/**
 * f() — 注入 inject-api.js 到页面
 *
 * Content Script 运行在隔离世界（Isolated World），无法直接被页面 JS 访问。
 * 因此需要通过 <script> 标签将 inject-api.js 注入到页面的主世界（Main World），
 * 让它能够设置 window.$poster / window.$syncer。
 *
 * 注入流程：
 *   1. 创建 <script> 标签
 *   2. 设置 src 为扩展内的 inject-api.js 文件 URL
 *      (通过 chrome.runtime.getURL 获取，manifest.json 中需声明为 web_accessible_resources)
 *   3. 添加到 DOM（head 或 documentElement）
 *   4. 加载完成后移除标签（保持 DOM 干净）
 *
 * 延迟 50ms 执行：确保页面 DOM 已基本就绪，
 * 避免在 head 尚未创建时就尝试 appendChild。
 */
function f() {
    setTimeout(function() {
        const e = document.createElement("script");
        e.src = chrome.runtime.getURL("inject-api.js");
        e.onload = function() {
            e.remove();  // 注入完成后清理，脚本已执行，标签不再需要
        };
        (document.head || document.documentElement).appendChild(e);
    }, 50);
}

// 根据文档加载状态决定注入时机：
// - 还在加载中 → 等 DOMContentLoaded 后注入
// - 已加载完成 → 立即注入
// 这确保了无论 Content Script 何时被注入，都能正确执行
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", f);
} else {
    f();
}
