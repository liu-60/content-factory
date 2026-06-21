/**
 * ============================================================================
 * WechatSync v2.0.9 - Version Check + Analytics 模块 (version-check-C8cm5ItJ.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 这是一个复合模块，包含三大功能：
 *
 * 1. **版本检查系统** - 从远程服务器检查是否有新版本可用
 * 2. **数据分析/追踪系统** - 记录用户行为事件（同步、提取、平台选择等）
 * 3. **频率限制检测** - 防止用户短时间内频繁同步导致平台封禁
 *
 * 【版本检查】
 * - 远程版本信息 URL: https://wpics.oss-cn-shanghai.aliyuncs.com/wechatsync-version.json
 * - 检查间隔: 24 小时
 * - 存储键: version_last_check, version_update_info, version_dismissed
 * - 比较逻辑: 语义化版本号比较（major.minor.patch）
 *
 * 【数据分析系统】
 * 所有事件通过空的 s() 函数发送（实际可能被混淆或动态注入）
 * 事件类型包括：
 * - sync_start / platform_sync / sync_complete: 同步流程事件
 * - article_extract: 文章提取
 * - extension_lifecycle: 扩展生命周期
 * - page_view / feature_use: 页面和功能使用
 * - auth_check: 认证检查
 * - sync_retry: 同步重试
 * - content_profile: 内容特征分析（字数、图片数、是否有代码/视频等）
 * - platform_selection / draft_click: 用户交互
 * - milestone: 里程碑事件（第5次/10次/50次同步、多平台使用）
 * - churn_signal: 流失信号
 * - growth_metrics: 增长指标
 *
 * 【频率限制】
 * - 记录 5 分钟内的同步历史
 * - 如果目标平台在 5 分钟内已同步过，弹出警告
 * - 同步历史保留 24 小时
 *
 * 【错误分类器 classifyError(j)】
 * 将错误消息分类为：auth_expired, rate_limit, network, content_blocked,
 * image_upload, parse_error, api_error, unknown
 */

import { c as _ } from "./logger-CvfM-6aa.js";

// ============================================================================
// 数据分析事件发送（当前为空实现，可能通过其他机制注入）
// ============================================================================

/**
 * 底层事件发送函数
 * 当前为空实现 - 可能通过运行时动态注入实际的追踪逻辑
 * 或因为 decompile 过程中某些动态加载代码未被还原
 */
async function s(e, t = {}) {}

// ============================================================================
// 同步事件追踪
// ============================================================================

/** 同步开始 */
async function M(e, t) {
    await s("sync_start", {
        target_count: t.length,
        targets: t.slice(0, 10).join(",")
    });
}

/** 单个平台同步结果 */
async function R(e, t, a, n = {}) {
    n.duration;
    await s("platform_sync", {
        draft_only: n.draftOnly ? "true" : "false",
        error_type: n.errorType || ""
    });
}

/** 同步完成汇总 */
async function U(e) {
    await s("sync_complete", {
        source: e.source,
        total_platforms: e.total,
        success_count: e.success,
        failed_count: e.failed,
        success_rate: e.total > 0 ? Math.round(e.success / e.total * 100) : 0,
        targets: e.platforms.slice(0, 10).join(","),
        duration_ms: e.duration
    });
}

/** 文章提取事件 */
async function N(e, t, a) { await s("article_extract", {}); }

/** 扩展生命周期事件（安装/更新） */
async function P(e, t) {
    await s("extension_lifecycle", { current_version: chrome.runtime.getManifest().version });
}

/** CMS 同步事件 */
async function V(e, t, a) { await s("cms_sync", {}); }

/** 页面浏览 */
async function b(e) { await s("page_view", {}); }

/** 功能使用 */
async function O(e, t) { await s("feature_use", { ...t }); }

/** 认证检查 */
async function F(e, t) { await s("auth_check", {}); }

// ============================================================================
// 错误分类器
// ============================================================================

/**
 * 根据错误消息文本对错误进行分类
 * 支持中英文关键词匹配
 *
 * @param {string} e - 错误消息
 * @returns {string} 错误类型: auth_expired | rate_limit | network | content_blocked |
 *                    image_upload | parse_error | api_error | unknown
 */
function j(e) {
    const t = e.toLowerCase();
    return t.includes("login") || t.includes("登录") || t.includes("auth") ||
           t.includes("token") || t.includes("session") || t.includes("credential")
        ? "auth_expired"
        : t.includes("rate") || t.includes("limit") || t.includes("频繁") ||
          t.includes("too many") || t.includes("429")
        ? "rate_limit"
        : t.includes("network") || t.includes("fetch") || t.includes("timeout") ||
          t.includes("连接") || t.includes("econnrefused") || t.includes("网络")
        ? "network"
        : t.includes("blocked") || t.includes("审核") || t.includes("违规") ||
          t.includes("敏感") || t.includes("forbidden") || t.includes("reject")
        ? "content_blocked"
        : t.includes("image") || t.includes("图片") || t.includes("upload") || t.includes("上传")
        ? "image_upload"
        : t.includes("parse") || t.includes("json") || t.includes("解析")
        ? "parse_error"
        : t.includes("api") || t.includes("server") || t.includes("500") ||
          t.includes("502") || t.includes("503")
        ? "api_error"
        : "unknown";
}

// ============================================================================
// 更多追踪事件
// ============================================================================

/** 同步重试 */
async function x(e, t, a, n) {
    await s("sync_retry", {
        platforms: t.slice(0, 10).join(","),
        platform_count: t.length
    });
}

/** 内容特征分析（字数、图片数、是否含代码/封面/视频） */
async function H(e) {
    // 字数阈值分析（代码中未使用结果，可能是占位）
    e.wordCount < 500 || e.wordCount < 1e3 || e.wordCount < 2e3 || e.wordCount < 5e3;
    await s("content_profile", {
        source: e.source,
        word_count: e.wordCount,
        image_count: e.imageCount,
        has_code: e.hasCode ? "true" : "false",
        has_cover: e.hasCover ? "true" : "false",
        has_video: e.hasVideo ? "true" : "false"
    });
}

/** 平台选择事件 */
async function L(e, t, a) { await s("platform_selection", {}); }

/** 草稿点击 */
async function K(e) { await s("draft_click", {}); }

/** CMS 管理事件 */
async function G(e, t, a) { await s("cms_management", {}); }

/** MCP 使用事件 */
async function Y(e, t) { await s("mcp_usage", {}); }

/** 漏斗事件 */
async function $(e, t, a) { await s("funnel", { ...a }); }

// ============================================================================
// 里程碑系统
// ============================================================================

/** 记录安装时间戳（仅首次） */
async function z() {
    (await chrome.storage.local.get("install_timestamp")).install_timestamp ||
        await chrome.storage.local.set({ install_timestamp: Date.now() });
}

/**
 * 记录里程碑事件
 * 每个里程碑只记录一次（通过 chrome.storage.local 标记）
 * 里程碑包括：fifth_sync, tenth_sync, power_user(50次), multi_platform(3+平台)
 */
async function u(e, t) {
    const a = `milestone_${e}`;
    if ((await chrome.storage.local.get(a))[a]) return;
    const c = await chrome.storage.local.get("install_timestamp");
    if (c.install_timestamp) Math.floor((Date.now() - c.install_timestamp) / (24 * 60 * 60 * 1e3));
    await s("milestone", { ...t });
    await chrome.storage.local.set({ [a]: Date.now() });
}

/** 流失信号 */
async function q(e, t) { await s("churn_signal", { ...t }); }

/** 平台组合分析 */
async function B(e) {
    if (e.length < 2) return;
    [...e].sort();
    await s("platform_combination", { platform_count: e.length });
}

/** 使用时间分析 */
async function W() {
    const e = new Date;
    e.getHours(); e.getDay();
    await s("usage_time", {});
}

/** 功能发现 */
async function J(e, t) { await s("feature_discovery", {}); }

/** 隐式反馈 */
async function Q(e, t) { await s("implicit_feedback", { ...t }); }

/** 增长指标汇总 */
async function X() {
    const e = await chrome.storage.local.get(["total_syncs", "total_articles", "platforms_used", "install_timestamp"]);
    const t = e.platforms_used || [];
    if (e.install_timestamp) Math.floor((Date.now() - e.install_timestamp) / (24 * 60 * 60 * 1e3));
    await s("growth_metrics", { platforms_count: t.length });
}

/**
 * 更新同步计数和平台使用记录
 * 在特定里程碑（5/10/50 次同步）触发里程碑事件
 */
async function Z(e) {
    const t = await chrome.storage.local.get(["total_syncs", "platforms_used"]);
    const a = (t.total_syncs || 0) + 1;
    const n = new Set(t.platforms_used || []);
    e.forEach(c => n.add(c));
    await chrome.storage.local.set({ total_syncs: a, platforms_used: Array.from(n) });

    // 里程碑触发
    if (a === 5) u("fifth_sync").catch(() => {});
    else if (a === 10) u("tenth_sync").catch(() => {});
    else if (a === 50) u("power_user").catch(() => {});
    if (n.size >= 3) u("multi_platform", { platform_count: n.size }).catch(() => {});
}

/** 平台扩展事件 */
async function tt(e, t) { await s("platform_expansion", {}); }

// ============================================================================
// 频率限制系统
// ============================================================================

const f = "syncRateLimitHistory";     // 同步历史记录键名
const p = 5 * 60 * 1e3;              // 5 分钟窗口
const w = 24 * 60 * 60 * 1e3;        // 24 小时保留期

/** 读取同步历史记录 */
async function y() {
    try { return (await chrome.storage.local.get(f))[f] || []; }
    catch { return []; }
}

/** 保存同步历史 */
async function g(e) { await chrome.storage.local.set({ [f]: e }); }

/** 过滤掉 24 小时前的旧记录 */
function k(e) {
    const t = Date.now() - w;
    return e.filter(a => a.timestamp > t);
}

/** 记录一次同步操作 */
async function et(e) {
    const t = await y();
    const a = k(t);
    a.push({ timestamp: Date.now(), platforms: e });
    await g(a);
}

/**
 * 检查频率限制
 * 如果目标平台在 5 分钟内已同步过，返回警告消息
 *
 * @param {string[]} e - 目标平台 ID 列表
 * @returns {string|null} 警告消息或 null
 */
async function at(e) {
    const t = await y();
    const a = Date.now();
    // 筛选 5 分钟内的同步记录
    const n = t.filter(o => a - o.timestamp < p);
    if (n.length === 0) return null;

    // 收集最近同步过的平台
    const c = new Set;
    n.forEach(o => { o.platforms.forEach(h => c.add(h)); });

    // 检查目标平台是否有重叠
    if (e.filter(o => c.has(o)).length > 0) {
        const o = n[n.length - 1];
        return `您在 ${Math.floor((a - o.timestamp) / 6e4) || "不到 1"} 分钟前刚同步过，频繁发布可能导致平台限制。确定要继续吗？`;
    }
    return null;
}

// ============================================================================
// 版本检查系统
// ============================================================================

const l = _("VersionCheck");
const C = "https://wpics.oss-cn-shanghai.aliyuncs.com/wechatsync-version.json";
const S = 24;                              // 检查间隔：24 小时
const m = "version_last_check";           // 上次检查时间
const i = "version_update_info";          // 更新信息缓存
const d = "version_dismissed";            // 用户忽略的版本号

/**
 * 语义化版本号比较
 * @returns {number} 1 表示 e > t，-1 表示 e < t，0 表示相等
 */
function v(e, t) {
    const a = e.split(".").map(Number);
    const n = t.split(".").map(Number);
    for (let c = 0; c < Math.max(a.length, n.length); c++) {
        const r = a[c] || 0, o = n[c] || 0;
        if (r > o) return 1;
        if (r < o) return -1;
    }
    return 0;
}

/** 获取当前扩展版本号 */
function E() { return chrome.runtime.getManifest().version; }

/** 检查是否需要更新（距上次检查是否超过 24 小时） */
async function D() {
    try {
        const t = (await chrome.storage.local.get(m))[m];
        if (!t) return !0;
        const n = Date.now() - t, c = S * 60 * 60 * 1e3;
        return n >= c;
    } catch { return !0; }
}

/** 记录检查时间 */
async function T() { await chrome.storage.local.set({ [m]: Date.now() }); }

/** 从远程获取最新版本信息 */
async function A() {
    try {
        const e = await fetch(C, { cache: "no-cache", headers: { Accept: "application/json" } });
        return e.ok ? await e.json() : (l.warn("Version check failed:", e.status), null);
    } catch (e) {
        return l.warn("Failed to fetch version info:", e), null;
    }
}

/**
 * 检查更新（主入口）
 * @param {boolean} [e=false] - 是否强制检查（忽略缓存）
 * @returns {Object} { hasUpdate, currentVersion, latestVersion?, info? }
 */
async function nt(e = !1) {
    const t = E();

    // 如果不需要强制检查且未过期，使用缓存
    if (!e && !await D()) {
        const r = await chrome.storage.local.get(i);
        return r[i] ? r[i] : { hasUpdate: !1, currentVersion: t };
    }

    l.info("Checking for updates...");
    const a = await A();
    await T();

    if (!a) return { hasUpdate: !1, currentVersion: t };

    // 比较版本号
    const n = v(a.version, t) > 0;
    const c = {
        hasUpdate: n,
        currentVersion: t,
        latestVersion: a.version,
        info: n ? a : void 0
    };

    await chrome.storage.local.set({ [i]: c });

    if (n) l.info(`New version available: ${a.version} (current: ${t})`);
    else l.info(`Already up to date: ${t}`);

    return c;
}

/** 获取缓存的更新信息 */
async function st() {
    try { return (await chrome.storage.local.get(i))[i] || null; }
    catch { return null; }
}

/** 检查用户是否已忽略某版本的更新提示 */
async function ct(e) {
    try { return (await chrome.storage.local.get(d))[d] === e; }
    catch { return !1; }
}

/** 标记用户已忽略某版本的更新提示 */
async function ot(e) {
    await chrome.storage.local.set({ [d]: e });
}

// ============================================================================
// 导出映射（按字母序排列）
// ============================================================================
export {
    O as A,   // featureUse
    G as B,   // cmsManagement
    P as C,   // extensionLifecycle
    z as D,   // recordInstallTimestamp
    X as E,   // growthMetrics
    nt as F,  // checkForUpdates
    ct as G,  // isVersionDismissed
    K as a,   // draftClick
    x as b,   // syncRetry
    $ as c,   // funnel
    q as d,   // churnSignal
    at as e,  // checkRateLimit
    L as f,   // platformSelection
    H as g,   // contentProfile
    J as h,   // featureDiscovery
    b as i,   // pageView
    ot as j,  // dismissVersion
    st as k,  // getUpdateInfo
    tt as l,  // platformExpansion
    F as m,   // authCheck
    u as n,   // recordMilestone
    M as o,   // syncStart
    W as p,   // usageTime
    B as q,   // platformCombination
    U as r,   // syncComplete
    R as s,   // platformSync
    Q as t,   // implicitFeedback
    Z as u,   // updateSyncStats
    j as v,   // classifyError
    et as w,  // recordSync
    N as x,   // articleExtract
    Y as y,   // mcpUsage
    V as z    // cmsSync
};
