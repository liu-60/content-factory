/**
 * ============================================================================
 * sync-dialog-B0jLMiJM.beautified.js — 同步对话框 UI（React 组件，运行在 iframe 中）
 * ============================================================================
 *
 * 【架构位置】
 *   本文件是一个 React 应用，渲染在 Content Script 创建的 iframe 中。
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  网页                                                │
 *   │  ┌─────────────────────────────────────────┐        │
 *   │  │  iframe (sync-dialog)                    │        │
 *   │  │  ┌─────────────────────────────────┐    │        │
 *   │  │  │ 本文件: React 同步对话框 UI      │    │        │
 *   │  │  │   ↕ window.parent.postMessage    │    │        │
 *   │  │  └─────────────────────────────────┘    │        │
 *   │  │       ↕ postMessage                      │        │
 *   │  └─────────────────────────────────────────┘        │
 *   │       ↕ window.postMessage / chrome.runtime          │
 *   │  Content Script (api.ts)                             │
 *   │       ↕ chrome.runtime                               │
 *   │  Service Worker                                      │
 *   └─────────────────────────────────────────────────────┘
 *
 * 【通信协议】
 *   本组件通过 window.parent.postMessage 与父窗口（Content Script）通信：
 *
 *   发出消息（→ Content Script）：
 *     - SYNC_DIALOG_READY : 对话框已加载，请求初始化数据
 *     - START_SYNC        : 开始同步，附带文章数据和目标平台列表
 *     - CLOSE_SYNC_DIALOG : 关闭对话框
 *
 *   接收消息（← Content Script）：
 *     - INIT_DATA           : 初始化数据（文章信息、平台列表、已选平台）
 *     - SYNC_PROGRESS       : 单个平台的同步结果（成功/失败）
 *     - SYNC_DETAIL_PROGRESS: 细粒度进度（上传图片 X/Y、保存中等）
 *     - SYNC_COMPLETE       : 所有平台同步完成
 *     - SYNC_ERROR          : 同步过程发生错误
 *
 * 【状态机】
 *
 *   ┌─────────┐    INIT_DATA     ┌──────┐   START_SYNC   ┌─────────┐
 *   │ loading │ ───────────────→ │ idle │ ─────────────→ │ syncing │
 *   └─────────┘                  └──────┘                 └─────────┘
 *                                   ↑        SYNC_         │    │
 *                                   │     COMPLETE         │    │
 *                                   └──────────────────────┘    │
 *                                   ↑ onReset()                 │
 *                                   │                           │
 *                                   └─────── SYNC_ERROR ────────┘
 *                                              (error 存入 D)
 *
 *   状态说明：
 *   - "loading"   : 组件已挂载，等待 INIT_DATA（显示加载动画）
 *   - "idle"      : 就绪，用户可以选择平台、点击"开始同步"
 *   - "syncing"   : 同步进行中，显示各平台进度
 *   - "completed" : 所有平台同步结束（可能有部分失败）
 *
 * 【平台选择持久化】
 *   - 用户选中的平台 ID 列表通过 chrome.storage.local 持久化
 *   - 键名: "selectedPlatforms"
 *   - 每次用户切换平台选中状态时立即保存
 *   - 下次打开对话框时从 storage 恢复（只恢复仍有效的、已认证的平台）
 *
 * 【进度跟踪】
 *   - results (u) 数组: 收集每个平台的最终结果 {platform, success, error}
 *   - platformProgress (M) Map: 实时细粒度进度 {platform → {stage, imageProgress}}
 *   - 当 results.length >= selectedPlatforms.length 时自动切换到 "completed"
 *
 * 【重试失败平台】
 *   - completed 状态下可以一键重试所有失败的平台
 *   - 只保留成功的 results，清除失败的，重新发起 START_SYNC
 * ============================================================================
 */

// ========== 依赖导入 ==========
import "./modulepreload-polyfill-B5Qt9EMX.js";
import {
    r as s,    // React 核心（useState, useEffect, useCallback, useRef 等）
    j as o,    // JSX 运行时（jsx, jsxs）
    X as $,    // X 图标组件（关闭按钮）
    S as k,    // SyncPanel 组件（实际的同步面板 UI，本文件中只引用不定义）
    d as F     // ReactDOM.createRoot（React 18 的并发渲染入口）
} from "./globals-Cn4U41aQ.js";
import "./logger-CvfM-6aa.js";
import "./_commonjsHelpers-BosuxZz1.js";
import "./remote-config-BEX-YVxx.js";


// ========== 常量 ==========

// chrome.storage.local 中保存已选平台列表的键名
const P = "selectedPlatforms";


// ========== 持久化工具函数 ==========

/**
 * R() — 保存已选平台 ID 列表到 chrome.storage.local
 *
 * 每次用户切换平台的选中/取消选中状态时调用。
 * 使用 fire-and-forget 模式（.catch 静默忽略错误），
 * 因为存储失败不影响 UI 交互，只是下次打开时无法恢复选择。
 *
 * @param {string[]} a - 平台 ID 数组，如 ["wechat", "zhihu", "juejin"]
 */
function R(a) {
    chrome.storage.local.set({
        [P]: a  // 等价于 { selectedPlatforms: a }
    }).catch(() => {});
}


// ============================================================================
// 主组件 J — 同步对话框
// ============================================================================

function J() {
    // ========== 状态声明 ==========
    // 这个组件使用了大量的 useState，每个状态变量用单字母命名（混淆后的结果）

    const [a, I] = s.useState(null);       // a = article（文章数据: {title, content, html, markdown, cover}）
    const [A, T] = s.useState([]);         // A = platforms（所有可用平台列表，来自 Service Worker）
    const [f, i] = s.useState([]);         // f = selectedPlatforms（用户选中的平台 ID 数组）
    const [g, c] = s.useState("loading");  // g = status（状态机的当前状态: "loading"|"idle"|"syncing"|"completed"）
    const [u, p] = s.useState([]);         // u = results（各平台同步结果数组: [{platform, success, error}]）
    const [D, y] = s.useState(null);       // D = error（全局错误信息，仅 SYNC_ERROR 时设置）
    const [M, S] = s.useState(new Map);    // M = platformProgress（细粒度进度 Map: platform → progress object）
    const [C, x] = s.useState(null);       // C = syncId（当前同步任务的唯一标识）

    // w = syncId 的 ref 镜像
    // 为什么需要 ref？因为 message 事件监听器在 useEffect 中只绑定一次，
    // 如果直接读 state 会拿到闭包中的旧值（stale closure）。
    // 通过 ref 始终能拿到最新的 syncId。
    const w = s.useRef(null);

    // 同步 ref：每当 syncId state 变化时更新 ref
    s.useEffect(() => {
        w.current = C;
    }, [C]);


    // ========== 主 Effect：消息监听与初始化 ==========

    s.useEffect(() => {
        /**
         * t() — 消息事件处理器（接收来自 Content Script 的所有消息）
         *
         * 这是状态机转换的驱动源：
         * - INIT_DATA → loading → idle
         * - SYNC_PROGRESS → 更新 results
         * - SYNC_DETAIL_PROGRESS → 更新 platformProgress
         * - SYNC_COMPLETE → syncing → completed
         * - SYNC_ERROR → syncing → idle（保留 error）
         */
        const t = l => {
            var n;
            try {
                // 兼容字符串和对象两种格式
                const e = typeof l.data == "string" ? JSON.parse(l.data) : l.data;

                // ---- syncId 过滤 ----
                // 如果消息带有 syncId 且不匹配当前任务，忽略
                // 防止快速连续点击导致的消息串扰
                if (e.syncId && w.current && e.syncId !== w.current) return;

                // ============================================================
                // INIT_DATA — 初始化数据（loading → idle 转换）
                // ============================================================
                //
                // Content Script 在收到 SYNC_DIALOG_READY 后发送此消息。
                // 包含：
                //   - article: 当前页面的文章信息
                //   - platforms: 所有可用平台及其认证状态
                //   - selectedPlatformIds: 上一次选择的平台（如果有）
                //
                if (e.type === "INIT_DATA") {
                    // 保存文章数据
                    I(e.article || null);

                    // 保存完整平台列表（含认证状态、图标等）
                    T(e.platforms || []);

                    // 恢复平台选择：
                    if ((n = e.selectedPlatformIds) != null && n.length) {
                        // 方式 A: Content Script 直接传入了预选列表
                        i(e.selectedPlatformIds);
                    } else {
                        // 方式 B: 从 chrome.storage.local 恢复用户上次的选择
                        chrome.storage.local.get(P).then(r => {
                            const d = r[P];  // 存储的平台 ID 数组

                            // 过滤：只保留当前仍然已认证的平台
                            // 防止用户之前选了某个平台，后来退出了该平台的登录
                            const h = (e.platforms || [])
                                .filter(m => m.isAuthenticated)
                                .map(m => m.id);
                            const v = new Set(h);

                            // 取交集：存储的选择 ∩ 当前已认证的平台
                            const G = (d == null ? void 0 : d.filter(m => v.has(m))) || [];
                            i(G);
                        }).catch(() => {
                            i([]);  // 存储读取失败则不选中任何平台
                        });
                    }

                    // 状态转换: loading → idle
                    c("idle");

                // ============================================================
                // SYNC_PROGRESS — 单个平台同步结果
                // ============================================================
                // 某个平台完成同步（成功或失败）时收到。
                // 累积到 results 数组中。
                //
                } else if (e.type === "SYNC_PROGRESS") {
                    if (e.result) {
                        p(r => [...r, e.result]);
                    }
                    // result 结构: { platform: "wechat", success: true/false, error: "...", postUrl: "..." }

                // ============================================================
                // SYNC_DETAIL_PROGRESS — 细粒度进度更新
                // ============================================================
                // 同步过程中间阶段的实时进度：
                //   - stage: "uploading_images" / "saving" / 其他
                //   - imageProgress: { current: 3, total: 10 }
                //
                // 存储在 Map 中以支持每个平台独立的进度条。
                //
                } else if (e.type === "SYNC_DETAIL_PROGRESS") {
                    const r = e.progress;
                    if (r != null && r.platform) {
                        S(d => {
                            const h = new Map(d);
                            h.set(r.platform, r);  // 添加/更新该平台的进度
                            return h;
                        });
                    }

                // ============================================================
                // SYNC_COMPLETE — 同步全部完成
                // ============================================================
                // 状态转换: syncing → completed
                //
                } else if (e.type === "SYNC_COMPLETE") {
                    c("completed");

                // ============================================================
                // SYNC_ERROR — 同步出错
                // ============================================================
                // 状态转换: syncing → idle（保留错误信息供 UI 显示）
                //
                } else if (e.type === "SYNC_ERROR") {
                    y(e.error);   // 保存错误信息
                    c("idle");    // 回到 idle 状态，用户可以重试
                }

            } catch {
                // 忽略非协议消息
            }
        };

        // 绑定消息监听器
        window.addEventListener("message", t);

        // ---- 通知父窗口：对话框已就绪 ----
        // 这是初始化握手：
        // 1. 本组件挂载后发送 SYNC_DIALOG_READY
        // 2. Content Script 收到后发送 INIT_DATA（包含文章和平台信息）
        // 3. 本组件处理 INIT_DATA，状态从 loading → idle
        window.parent.postMessage(JSON.stringify({
            type: "SYNC_DIALOG_READY"
        }), "*");

        // 清理：组件卸载时移除监听器
        return () => window.removeEventListener("message", t);

    }, []);  // 空依赖数组 = 只在挂载时执行一次


    // ========== 自动完成检测 ==========
    //
    // 当处于 syncing 状态，且收到的 results 数量 >= 选中平台数量时，
    // 自动切换到 completed 状态。
    //
    // 这是一个安全网：万一 SYNC_COMPLETE 消息丢失或延迟，
    // 只要所有平台都有了结果，就认为同步完成。
    //
    s.useEffect(() => {
        if (g === "syncing" && u.length > 0 && u.length >= f.length) {
            c("completed");
        }
    }, [u.length, f.length, g]);
    // 依赖: results.length, selectedPlatforms.length, status


    // ========== 事件处理函数 ==========

    /**
     * E() — 向父窗口（Content Script）发送消息的便捷函数
     *
     * 所有从对话框发往 Content Script 的消息都经过这个函数。
     * 消息会被 JSON 序列化后通过 postMessage 发送。
     *
     * @param {Object} t - 消息体
     */
    const E = s.useCallback(t => {
        window.parent.postMessage(JSON.stringify(t), "*");
    }, []);


    /**
     * j() — 切换单个平台的选中状态
     *
     * 使用 Set 进行去重操作：
     * - 如果平台已在选中集合中 → 移除（取消选中）
     * - 如果平台不在集合中 → 添加（选中）
     *
     * 切换后立即持久化到 chrome.storage.local。
     *
     * @param {string} t - 平台 ID
     */
    const j = t => {
        i(l => {
            const n = new Set(l);
            n.has(t) ? n.delete(t) : n.add(t);
            const e = Array.from(n);
            R(e);  // 持久化
            return e;
        });
    };


    /**
     * O() — 全选所有已认证的平台
     *
     * 从 platforms 列表中筛选出 isAuthenticated=true 的平台，
     * 全部设为选中状态，并持久化。
     */
    const O = () => {
        const t = A.filter(l => l.isAuthenticated).map(l => l.id);
        i(t);
        R(t);
    };


    /**
     * b() — 取消全选
     *
     * 清空选中列表，并持久化空数组。
     */
    const b = () => {
        i([]);
        R([]);
    };


    /**
     * Y() — 开始同步（核心操作）
     *
     * 状态转换: idle → syncing
     *
     * 流程：
     * 1. 前置检查：必须有文章数据且至少选中一个平台
     * 2. 生成唯一 syncId（与 Content Script 的 addTask 使用相同格式）
     * 3. 重置状态：清空 results、error、progress
     * 4. 发送 START_SYNC 消息到 Content Script
     *
     * Content Script 收到 START_SYNC 后会转译为 SYNC_ARTICLE 发给 Service Worker，
     * 与旧版 addTask 走相同的后台同步管线。
     */
    const Y = () => {
        // 前置条件检查
        if (!a || f.length === 0) return;

        // 生成 syncId: "sync_1700000000000_a1b2c3d4e"
        const t = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // 保存 syncId（state + ref 同步更新）
        x(t);

        // 状态转换: idle → syncing
        c("syncing");

        // 重置进度相关状态
        p([]);           // 清空 results 数组
        y(null);         // 清空 error
        S(new Map);      // 清空 platformProgress

        // 发送开始同步消息到 Content Script
        // Content Script 会将其转换为 SYNC_ARTICLE 发给 Service Worker
        E({
            type: "START_SYNC",
            article: a,        // 文章数据
            platforms: f,      // 目标平台 ID 数组
            syncId: t          // 同步 ID
        });
    };


    /**
     * L() — 重试失败的平台
     *
     * 仅在 completed 状态下可用。
     * 从 results 中筛选出 success=false 的平台，
     * 只保留成功的结果，然后对这些失败平台重新发起同步。
     *
     * 这比全部重做更高效——只重试需要重试的。
     */
    const L = () => {
        // 筛选出失败的平台 ID
        const t = u.filter(n => !n.success).map(n => n.platform);
        if (t.length === 0 || !a) return;

        // 生成新的 syncId（每次同步任务都有唯一 ID）
        const l = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        x(l);

        // 状态转换: completed → syncing
        c("syncing");

        // 只保留成功的结果，丢弃失败的
        // 这样新的 SYNC_PROGRESS 消息到达时，成功的结果不会丢失
        p(n => n.filter(e => e.success));

        // 清空进度
        S(new Map);

        // 只对失败的平台发起重试
        E({
            type: "START_SYNC",
            article: a,
            platforms: t,    // 仅失败的平台
            syncId: l
        });
    };


    /**
     * N() — 重置 / 取消同步
     *
     * 状态转换: syncing/completed → idle
     * 清空所有进度相关状态，回到就绪状态。
     * 注意：这不会终止后台正在进行的同步，只是重置 UI 状态。
     */
    const N = () => {
        c("idle");       // 回到 idle
        p([]);           // 清空 results
        y(null);         // 清空 error
        S(new Map);      // 清空 progress
        x(null);         // 清空 syncId
    };


    /**
     * _() — 关闭对话框
     *
     * 发送 CLOSE_SYNC_DIALOG 到 Content Script，
     * Content Script 会销毁包含本组件的 iframe。
     */
    const _ = () => {
        E({
            type: "CLOSE_SYNC_DIALOG"
        });
    };


    // ========================================================================
    // JSX 渲染
    // ========================================================================

    return o.jsxs("div", {
        className: "h-full flex flex-col bg-white rounded-xl overflow-hidden shadow-2xl",
        children: [

            // ---- 标题栏 ----
            o.jsxs("div", {
                className: "flex items-center justify-between px-4 py-3 border-b flex-shrink-0",
                children: [
                    // 标题文字
                    o.jsx("span", {
                        className: "font-semibold text-gray-900",
                        children: "文章同步"
                    }),
                    // 关闭按钮（X 图标）
                    o.jsx("button", {
                        onClick: _,
                        className: "p-1 rounded hover:bg-gray-100 transition-colors",
                        children: o.jsx($, {
                            className: "w-4 h-4 text-gray-500"
                        })
                    })
                ]
            }),

            // ---- 同步面板主体 ----
            // 委托给 k (SyncPanel) 组件渲染
            // SyncPanel 接收所有状态和操作回调作为 props
            o.jsx(k, {
                article: a,                   // 文章数据
                platforms: A,                 // 所有可用平台
                status: g,                    // 当前状态 ("loading"|"idle"|"syncing"|"completed")
                selectedPlatforms: f,         // 已选平台 ID 数组
                results: u,                   // 各平台同步结果
                platformProgress: M,          // 细粒度进度 Map
                error: D,                     // 全局错误信息
                onTogglePlatform: j,          // 切换单个平台选中状态
                onSelectAll: O,               // 全选
                onDeselectAll: b,             // 取消全选
                onStartSync: Y,               // 开始同步
                onRetryFailed: L,             // 重试失败平台
                onReset: N,                   // 重置（回到 idle）
                onCancel: N,                  // 取消（同重置）
                onClose: _,                   // 关闭对话框
                className: "flex-1 min-h-0"
            })

        ]
    });
}


// ============================================================================
// 应用挂载
// ============================================================================

// 使用 React 18 的 createRoot API 挂载到 #root 元素
// StrictMode 启用严格模式检查（开发时检测副作用）
F(document.getElementById("root")).render(
    o.jsx(s.StrictMode, {
        children: o.jsx(J, {})
    })
);
