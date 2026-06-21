/**
 * ============================================================================
 * WechatSync v2.0.9 - Popup UI 模块 (popup-BNNxEQIB.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 浏览器扩展弹出窗口（Popup）的主入口文件。当用户点击扩展图标时显示的界面。
 * 这是一个约 82KB 的大型模块，包含 React Router、Zustand 状态管理、
 * 多个页面组件、MCP 桥接设置、CMS 账户管理和 v1→v2 数据迁移。
 *
 * 【技术栈】
 * - React 18 + ReactDOM.createRoot
 * - React Router v7.12.0（Hash History 模式）
 * - Zustand（轻量级状态管理）
 * - Tailwind CSS（样式）
 *
 * 【页面路由】
 * - "/"         → 主同步页面 (ua 组件)
 * - "/add-cms"  → 添加 CMS 账户页面 (ma 组件)
 * - "/history"  → 同步历史页面 (fa 组件)
 * - "/about"    → 关于页面 (ha 组件)
 *
 * 【状态管理 - Zustand Store (G)】
 * 状态字段:
 * - status: "loading" | "idle" | "syncing" | "completed"
 * - article: 当前提取的文章数据
 * - platforms: 可用平台列表（带认证状态）
 * - selectedPlatforms: 用户选中的平台 ID 数组
 * - results: 同步结果数组
 * - error: 错误消息
 * - currentSyncId: 当前同步会话 ID
 * - imageProgress: 图片上传进度
 * - platformProgress: 各平台详细进度 Map
 * - history: 同步历史记录
 * - recovered: 是否已恢复同步状态
 * - rateLimitWarning: 频率限制警告
 *
 * Store Actions:
 * - recoverSyncState: 从 background 恢复同步状态（防止 popup 关闭后丢失进度）
 * - loadPlatforms: 加载已认证的平台列表
 * - loadArticle: 从当前标签页或 pendingArticle 提取文章
 * - loadHistory: 加载同步历史
 * - togglePlatform / selectAll / deselectAll: 平台选择
 * - checkRateLimit: 检查频率限制
 * - startSync: 发起同步
 * - retryFailed: 重试失败的平台
 * - reset: 重置同步状态
 * - updateProgress / updateImageProgress / updateDetailProgress: 进度更新
 *
 * 【同步流程】
 * 1. loadArticle → EXTRACT_ARTICLE → 内容脚本提取文章
 * 2. loadPlatforms → CHECK_ALL_AUTH → background 返回已认证平台
 * 3. 用户选择目标平台
 * 4. startSync → SYNC_ARTICLE → background 执行多平台同步
 * 5. 监听 SYNC_PROGRESS / SYNC_DETAIL_PROGRESS 更新进度
 * 6. 完成或失败后显示结果
 *
 * 【设置面板功能】
 * - MCP/CLI 桥接开关和 Token 管理
 * - 服务器地址配置（WebSocket）
 * - 悬浮同步按钮开关
 * - CMS 账户管理（WordPress 等）
 *
 * 【v1→v2 数据迁移 (ga)】
 * 从 localStorage 中的旧格式账户数据迁移到 chrome.storage.local
 * 迁移完成后标记 "v2_migration_done"
 *
 * 【消息监听】
 * chrome.runtime.onMessage 监听:
 * - SYNC_PROGRESS: 平台级同步结果
 * - IMAGE_PROGRESS: 图片上传进度
 * - SYNC_DETAIL_PROGRESS: 详细进度（阶段/百分比）
 * 通过 syncId 过滤确保只处理当前会话的消息
 */

// ============================================================================
// 导入依赖
// ============================================================================

import "./modulepreload-polyfill-B5Qt9EMX.js";
import {
    r as d,       // React
    c as S,       // createRoot (别名)
    R as qe,      // StrictMode
    j as o,       // JSX runtime
    a as V,       // classNames 工具
    X as se,      // X (关闭) 图标
    C as Mt,      // CheckCircle 图标
    S as Bt,      // SyncPanel 组件
    L as Ye,      // Loader 组件
    E as J,       // ExternalLink 图标
    b as Tt       // ReactDOM
} from "./globals-Cn4U41aQ.js";
import { g as $t } from "./_commonjsHelpers-BosuxZz1.js";
import {
    t as _e,      // churnSignal
    a as It,      // draftClick
    b as Ot,      // syncRetry
    c as Ut,      // featureUse (funnel)
    d as Ht,      // implicitFeedback (multiple failures)
    e as Wt,      // checkRateLimit
    f as he,      // platformSelection
    g as zt,      // contentProfile
    h as Ke,      // featureDiscovery
    i as je,      // pageView
    j as Vt,      // dismissVersion
    k as Gt,      // getUpdateInfo
    l as qt       // platformExpansion
} from "./version-check-C8cm5ItJ.js";
import { c as ue } from "./logger-CvfM-6aa.js";
import "./remote-config-BEX-YVxx.js";

// ============================================================================
// React Router v7.12.0 (内嵌打包)
// 使用 Hash History 模式（适配 chrome-extension:// 协议）
// ============================================================================

// --- React Router 核心实现（约 900 行）---
// 包含：路由匹配、URL 解析、导航、数据路由、错误边界等
// 关键函数：
// - Yt (createHashHistory): 创建 Hash 路由历史
// - ct (useRoutes): 路由渲染 hook
// - Wr (Router): 路由容器组件
// - zr (Routes): 路由定义组件
// - X (Route): 路由配置组件

// [此处省略 React Router 内部实现代码 - 约 900 行]
// 关键路由配置在文件底部 pa() 函数中

var De = "popstate";

// React Router 内部实现（hash history、路由匹配、导航等）
// 完整实现见原文件 47-999 行

// ============================================================================
// Zustand Store 定义
// ============================================================================

const k = ue("SyncStore");

/**
 * 分析文章内容特征并发送追踪事件
 */
function ze(e, r) {
    if (!e.content) return;
    const t = e.content;
    const s = t.replace(/<[^>]+>/g, "").length;  // 字数
    const a = t.match(/<img[^>]+>/gi);
    const l = (a?.length) || 0;                    // 图片数
    const u = /<pre[^>]*>|<code[^>]*>/i.test(t);  // 是否有代码块
    const i = /<video[^>]*>|<iframe[^>]*>/i.test(t); // 是否有视频
    zt({ source: r, wordCount: s, imageCount: l, hasCode: u, hasCover: !!e.cover, hasVideo: i }).catch(() => {});
}

// 选中平台的存储键名
const Ee = "selectedPlatforms";

/** 保存选中平台到 storage */
async function ve(e) {
    try { await chrome.storage.local.set({ [Ee]: e }); }
    catch (r) { k.error("Failed to save selected platforms:", r); }
}

/** 从 storage 加载选中平台 */
async function la() {
    try { return (await chrome.storage.local.get(Ee))[Ee] || null; }
    catch (e) { return k.error("Failed to load selected platforms:", e), null; }
}

/**
 * Zustand Store (G) - 全局状态管理
 *
 * 使用方式: const { article, platforms, startSync } = G();
 *
 * 状态流转:
 * loading → idle → syncing → completed
 *          ↑                    ↓
 *          └────── reset ←──────┘
 */
const G = St((e, r) => ({
    status: "loading",
    article: null,
    platforms: [],
    selectedPlatforms: [],
    results: [],
    error: null,
    currentSyncId: null,
    imageProgress: null,
    platformProgress: new Map,
    history: [],
    recovered: !1,
    rateLimitWarning: null,

    /**
     * 从 background 恢复同步状态
     * 当用户关闭 popup 再重新打开时，之前的同步可能还在进行中
     * 通过 GET_SYNC_STATE 获取 background 中保存的状态
     */
    recoverSyncState: async () => {
        if (!r().recovered) try {
            const t = await chrome.runtime.sendMessage({ type: "GET_SYNC_STATE" });
            const n = t?.syncState;
            if (n) {
                k.debug("Recovering sync state:", n.status, n.syncId);
                e({
                    status: n.status,
                    article: n.article,
                    selectedPlatforms: n.selectedPlatforms,
                    results: n.results || [],
                    currentSyncId: n.syncId || null,
                    recovered: !0
                });
                if (n.status === "syncing") k.debug("Sync in progress, listening for updates...");
            } else e({ recovered: !0 });
        } catch (t) {
            k.error("Failed to recover sync state:", t);
            e({ recovered: !0 });
        }
    },

    /** 清除 background 中的同步状态 */
    clearSyncState: async () => {
        try { await chrome.runtime.sendMessage({ type: "CLEAR_SYNC_STATE" }); }
        catch (t) { k.error("Failed to clear sync state:", t); }
    },

    /** 更新文章数据（合并更新） */
    updateArticle: t => {
        const n = r().article;
        if (n) e({ article: { ...n, ...t } });
    },

    /**
     * 加载已认证的平台列表
     * 通过 CHECK_ALL_AUTH 消息向 background 查询所有平台的认证状态
     * 过滤出已认证的平台，并从 storage 恢复用户之前的选择
     */
    loadPlatforms: async () => {
        const t = r().status;
        const n = t === "syncing" || t === "completed";
        if (!n) e({ status: "loading" });
        try {
            const a = ((await chrome.runtime.sendMessage({ type: "CHECK_ALL_AUTH" }))
                .platforms || []).filter(c => c.isAuthenticated);
            const l = await la();
            const u = a.map(c => c.id);
            let i = [];
            if (l && l.length > 0) i = l.filter(c => u.includes(c));
            e(n ? { platforms: a } : { platforms: a, status: "idle", selectedPlatforms: i });
        } catch (s) {
            k.error("Failed to load platforms:", s);
            if (!n) e({ status: "idle", error: s.message });
        }
    },

    /**
     * 加载文章内容
     * 优先级：
     * 1. 如果正在同步/已完成，使用已恢复的文章
     * 2. 从 chrome.storage 的 pendingArticle（由 FAB 预提取）
     * 3. 向当前标签页发送 EXTRACT_ARTICLE 消息
     */
    loadArticle: async () => {
        const { article: t, status: n } = r();
        if (t && (n === "syncing" || n === "completed")) return;
        try {
            const s = await chrome.storage.local.get("pendingArticle");
            if (s.pendingArticle) {
                k.debug("loadArticle - found pending article:", s.pendingArticle.title);
                e({ article: s.pendingArticle });
                ze(s.pendingArticle, "popup");
                await chrome.storage.local.remove("pendingArticle");
                return;
            }
            const [a] = await chrome.tabs.query({ active: !0, currentWindow: !0 });
            if (!a?.id) return;
            const l = await chrome.tabs.sendMessage(a.id, { type: "EXTRACT_ARTICLE" });
            if (l?.article) {
                e({ article: l.article });
                ze(l.article, "popup");
            }
        } catch (s) {
            k.error("Failed to extract article:", s);
        }
    },

    /** 加载同步历史 */
    loadHistory: async () => {
        try {
            const t = await chrome.storage.local.get("syncHistory");
            e({ history: t.syncHistory || [] });
        } catch (t) { k.error("Failed to load history:", t); }
    },

    /** 切换平台选中状态 */
    togglePlatform: t => {
        const { selectedPlatforms: n } = r();
        const s = n.includes(t);
        const a = s ? n.filter(l => l !== t) : [...n, t];
        e({ selectedPlatforms: a });
        ve(a);
        he(s ? "deselect" : "select", t, a.length).catch(() => {});
    },

    /** 全选已认证平台 */
    selectAll: () => {
        const { platforms: t } = r();
        const n = t.filter(s => s.isAuthenticated).map(s => s.id);
        e({ selectedPlatforms: n });
        ve(n);
    },

    /** 取消全选 */
    deselectAll: () => { e({ selectedPlatforms: [] }); ve([]); },

    /** 检查频率限制 */
    checkRateLimit: async () => {
        const { selectedPlatforms: t } = r();
        return Wt(t);
    },

    /**
     * 开始同步
     * 生成唯一的 syncId，发送 SYNC_ARTICLE 消息到 background
     * background 负责实际的 API 调用和内容发布
     */
    startSync: async () => {
        const { article: t, selectedPlatforms: n, platforms: s } = r();
        if (!t) { e({ error: "未检测到文章内容" }); return; }
        if (n.length === 0) { e({ error: "请选择要同步的平台" }); return; }

        Ut("sync_started", "popup", { platform_count: n.length }).catch(() => {});
        const a = `sync_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        e({ status: "syncing", results: [], error: null, imageProgress: null, platformProgress: new Map, currentSyncId: a });

        try {
            const l = await chrome.runtime.sendMessage({
                type: "SYNC_ARTICLE",
                payload: { article: t, platforms: n, syncId: a }
            });
            const u = l.results || [];
            const i = l.rateLimitWarning || null;
            const c = u.map(g => ({
                ...g,
                platformName: g.platformName || s.find(b => b.id === g.platform)?.name || g.platform
            }));
            const m = (await chrome.storage.local.get("syncHistory")).syncHistory || [];
            e({ status: "completed", results: c, history: m, imageProgress: null, rateLimitWarning: i });

            const p = c.filter(g => !g.success).length;
            if (p >= 3) Ht("multiple_failures", { failed_count: p, total_count: c.length }).catch(() => {});
        } catch (l) {
            e({ error: l.message, status: "idle", imageProgress: null });
        }
    },

    /** 重试失败的平台 */
    retryFailed: async () => {
        const { article: t, results: n, platforms: s } = r();
        if (!t) { e({ error: "未检测到文章内容" }); return; }
        const a = n.filter(i => !i.success).map(i => i.platform);
        if (a.length === 0) return;
        const l = n.filter(i => i.success);

        const u = `sync_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        e({ status: "syncing", results: l, error: null, imageProgress: null, platformProgress: new Map, currentSyncId: u });

        try {
            const f = ((await chrome.runtime.sendMessage({
                type: "SYNC_ARTICLE",
                payload: { article: t, platforms: a, skipHistory: !0, syncId: u }
            })).results || []).map(y => ({
                ...y,
                platformName: y.platformName || s.find(v => v.id === y.platform)?.name || y.platform
            }));
            const m = [...l, ...f];
            const g = (await chrome.storage.local.get("syncHistory")).syncHistory || [];
            if (g.length > 0) {
                const y = [...g];
                y[0] = { ...y[0], results: m };
                await chrome.storage.local.set({ syncHistory: y });
                e({ history: y });
            }
            e({ status: "completed", results: m, imageProgress: null });
        } catch (i) {
            e({ error: i.message, status: "completed", imageProgress: null });
        }
    },

    /** 重置同步状态 */
    reset: () => {
        e({ status: "idle", results: [], error: null, imageProgress: null, platformProgress: new Map });
        chrome.runtime.sendMessage({ type: "CLEAR_SYNC_STATE" }).catch(() => {});
    },

    /** 更新单个平台的同步结果 */
    updateProgress: t => {
        e(n => {
            const s = [...n.results, t];
            const a = n.status === "syncing" && s.length >= n.selectedPlatforms.length;
            return { results: s, ...a ? { status: "completed", imageProgress: null } : {} };
        });
    },

    /** 更新图片上传进度 */
    updateImageProgress: t => { e({ imageProgress: t }); },

    /** 更新平台详细进度 */
    updateDetailProgress: t => {
        e(n => {
            const s = new Map(n.platformProgress);
            s.set(t.platform, t);
            return { platformProgress: s };
        });
    },

    /** 草稿点击追踪 */
    onDraftClick: t => { It().catch(() => {}); },

    /** 立即重试（流失信号） */
    onImmediateRetry: () => { _e().catch(() => {}); },

    /** 清除频率限制警告 */
    clearRateLimitWarning: () => { e({ rateLimitWarning: null }); }
}));

// ============================================================================
// 实时消息监听：接收 background 推送的同步进度
// ============================================================================

chrome.runtime.onMessage.addListener(e => {
    var t;
    const { currentSyncId: r } = G.getState();
    // syncId 过滤：忽略其他会话的消息
    if (e.syncId && r && e.syncId !== r) return;

    if (e.type === "SYNC_PROGRESS") {
        const n = (t = e.payload)?.result;
        if (n) G.getState().updateProgress(n);
    }
    if (e.type === "IMAGE_PROGRESS" && e.payload) G.getState().updateImageProgress(e.payload);
    if (e.type === "SYNC_DETAIL_PROGRESS") {
        const n = e.payload;
        if (n?.platform) G.getState().updateDetailProgress(n);
    }
});

// ============================================================================
// 设置面板组件 (ia)
// ============================================================================

/**
 * 设置面板 - 右侧滑出抽屉
 * 功能:
 * - MCP/CLI 桥接：启用/禁用 WebSocket 连接，显示 Token
 * - 服务器地址配置（ws://localhost:9527）
 * - 悬浮同步按钮开关
 * - CMS 账户管理（查看/删除已连接的 WordPress 等账户）
 */
function ia({ open: e, onClose: r }) {
    // [设置面板 UI 代码 - 约 200 行]
    // 包含 MCP 连接管理、悬浮按钮开关、CMS 账户列表
}

// ============================================================================
// 页面组件
// ============================================================================

/**
 * 主同步页面 (ua) - 路由 "/"
 * 显示: 文章标题 + 平台选择列表 + 同步按钮 + 同步进度
 */
function ua() { /* [主页面 UI] */ }

/**
 * 添加 CMS 页面 (ma) - 路由 "/add-cms"
 * 支持 WordPress、Typecho 等 CMS 的账户连接
 */
function ma() { /* [CMS 添加 UI] */ }

/**
 * 同步历史页面 (fa) - 路由 "/history"
 * 显示历史同步记录和结果
 */
function fa() { /* [历史页面 UI] */ }

/**
 * 关于页面 (ha) - 路由 "/about"
 * 显示: 版本号、GitHub 链接、官网链接、作者信息、反馈入口
 */
function ha() {
    // 包含以下链接:
    // - GitHub: https://github.com/wechatsync/Wechatsync
    // - 官网: https://www.wechatsync.com/
    // - 作者: https://fun0.netlify.app/about/
    // - 反馈: https://txc.qq.com/products/105772
}

// ============================================================================
// 路由配置和应用入口
// ============================================================================

/**
 * Popup 应用根组件
 * 使用 React Router Hash History 模式
 * 定义四个路由页面
 */
function pa() {
    return o.jsx(pn, {
        children: o.jsx("div", {
            className: "flex flex-col h-full min-h-[500px]",
            children: o.jsxs(zr, {
                children: [
                    o.jsx(X, { path: "/", element: o.jsx(ua, {}) }),
                    o.jsx(X, { path: "/add-cms", element: o.jsx(ma, {}) }),
                    o.jsx(X, { path: "/history", element: o.jsx(fa, {}) }),
                    o.jsx(X, { path: "/about", element: o.jsx(ha, {}) })
                ]
            })
        })
    });
}

// ============================================================================
// v1 → v2 数据迁移
// ============================================================================

const _ = ue("Migration");
const Ce = "v2_migration_done";

/**
 * 从 v1 版本的 localStorage 迁移 CMS 账户数据到 v2 的 chrome.storage.local
 *
 * v1 格式: localStorage.accounts = JSON.stringify([{type, params: {wpUrl, wpUser, wpPwd, meta}, title}])
 * v2 格式: chrome.storage.local.cmsAccounts = [{id, type, name, url, username, isConnected}]
 *         chrome.storage.local.cms_pwd_{id} = password
 */
async function ga() {
    var e;
    try {
        if ((await chrome.storage.local.get(Ce))[Ce]) return;  // 已迁移过

        const t = localStorage.getItem("accounts");
        if (!t) { await ae(); return; }

        const n = JSON.parse(t);
        if (!n.length) { await ae(); return; }

        _.info(`Found ${n.length} old accounts to migrate`);
        const a = (await chrome.storage.local.get("cmsAccounts")).cmsAccounts || [];
        const l = [];
        const u = {};

        for (const c of n) {
            if (a.some(g => g.url === c.params.wpUrl)) continue;  // 已存在
            const m = `cms_${Date.now()}_${Math.random().toString(36).slice(2,11)}`;
            const p = {
                id: m, type: c.type,
                name: c.title || (e = c.params.meta)?.blogName || c.params.wpUrl,
                url: c.params.wpUrl, username: c.params.wpUser, isConnected: !0
            };
            l.push(p);
            u[`cms_pwd_${m}`] = c.params.wpPwd;
        }

        if (l.length === 0) { await ae(); return; }

        const i = [...a, ...l];
        await chrome.storage.local.set({ cmsAccounts: i, ...u });
        _.info(`Successfully migrated ${l.length} accounts`);
        await ae();
    } catch (r) {
        _.error("Migration failed:", r);
    }
}

/** 标记迁移完成 */
async function ae() {
    await chrome.storage.local.set({ [Ce]: Date.now() });
}

// 执行迁移
ga();

// ============================================================================
// 应用挂载
// ============================================================================

Tt.createRoot(document.getElementById("root")).render(o.jsx(qe.StrictMode, {
    children: o.jsx(pa, {})
}));
