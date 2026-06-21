/**
 * ============================================================================
 * WechatSync v2.0.9 - Remote Config 模块 (remote-config-BEX-YVxx.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 远程配置加载器。从阿里云 OSS 获取配置文件（主要是 Banner 广告/公告），
 * 支持版本过滤、时间窗口控制、优先级排序和用户手动关闭。
 *
 * 【配置文件地址】
 * https://wpics.oss-cn-shanghai.aliyuncs.com/wechatsync-config.json
 *
 * 【配置文件结构（推测）】
 * {
 *   "banners": [
 *     {
 *       "id": "banner_001",
 *       "title": "...",
 *       "content": "...",
 *       "startDate": "2025-01-01",
 *       "endDate": "2025-12-31",
 *       "targetVersion": ">=2.0.0",      // 可选：版本过滤
 *       "priority": 10                    // 优先级（越高越靠前）
 *     }
 *   ]
 * }
 *
 * 【缓存策略】
 * - 配置缓存在 chrome.storage.local 的 "remoteBanners" 键中
 * - 上次拉取时间记录在 "remoteBanners_lastFetch" 中
 * - 拉取间隔：6 小时（m = 6）
 * - 用户关闭的 banner ID 记录在 "dismissedBanners" 数组中
 *
 * 【导出函数】
 * - ensureConfig (a/p): 确保配置已加载（带缓存检查）
 * - dismissBanner (d/D): 记录用户关闭的 banner
 * - fetchConfig (f/l): 强制拉取远程配置
 * - getActiveBanner (g/y): 获取当前有效的 Banner（未被关闭且在时间窗口内）
 */

import { c as u } from "./logger-CvfM-6aa.js";

const c = u("RemoteConfig");

// 远程配置文件 URL（阿里云 OSS）
const h = "https://wpics.oss-cn-shanghai.aliyuncs.com/wechatsync-config.json";

// chrome.storage.local 中的键名
const i = "remoteBanners";              // 缓存的 Banner 列表
const f = "remoteBanners_lastFetch";    // 上次拉取时间戳
const r = "dismissedBanners";           // 用户关闭的 Banner ID 列表

// 拉取间隔：6 小时
const m = 6;

/**
 * 版本号匹配函数
 * 支持精确匹配和 >= 前缀匹配
 * @param {string} t - 规则版本（如 ">=2.0.0" 或 "2.0.0"）
 * @param {string} e - 当前扩展版本
 * @returns {boolean} 是否匹配
 */
function d(t, e) {
    const s = t.match(/^>=(.+)$/);
    if (!s) return t === e;  // 精确匹配
    // >= 语义版本比较
    const o = s[1].split(".").map(Number);
    const n = e.split(".").map(Number);
    for (let a = 0; a < 3; a++) {
        if ((n[a] || 0) > (o[a] || 0)) return !0;  // 当前版本更高
        if ((n[a] || 0) < (o[a] || 0)) return !1;  // 规则版本更高
    }
    return !0;  // 版本相等
}

/**
 * 检查 Banner 是否在有效时间窗口内
 * @param {Object} t - Banner 对象
 * @returns {boolean} 是否在有效期内
 */
function g(t) {
    const e = Date.now();
    return !(
        (t.startDate && new Date(t.startDate).getTime() > e) ||  // 尚未开始
        (t.endDate && new Date(t.endDate).getTime() < e)          // 已过期
    );
}

/**
 * 从远程拉取配置文件
 * 步骤：
 * 1. fetch 配置文件（禁用缓存）
 * 2. 过滤：时间窗口有效 + 版本匹配
 * 3. 按优先级排序（高优先级在前）
 * 4. 存入 chrome.storage.local
 */
async function l() {
    try {
        const t = await fetch(h, {
            cache: "no-cache",
            headers: { Accept: "application/json" }
        });
        if (!t.ok) {
            c.warn("Config fetch failed:", t.status);
            return;
        }
        const e = await t.json();
        const s = chrome.runtime.getManifest().version;

        // 过滤 + 排序
        const o = (e.banners || [])
            .filter(n => g(n))                                    // 时间窗口过滤
            .filter(n => !n.targetVersion || d(n.targetVersion, s)) // 版本过滤
            .sort((n, a) => (a.priority || 0) - (n.priority || 0)); // 优先级降序

        await chrome.storage.local.set({
            [i]: o,
            [f]: Date.now()
        });
        c.debug("Config updated:", o.length, "banners");
    } catch (t) {
        c.warn("Failed to fetch config:", t);
    }
}

/**
 * 确保配置已加载（带缓存检查）
 * 如果距离上次拉取不足 6 小时，使用缓存
 */
async function p() {
    try {
        const e = (await chrome.storage.local.get(f))[f];
        (!e || Date.now() - e >= m * 60 * 60 * 1e3) && await l();
    } catch {
        await l();
    }
}

/**
 * 获取当前有效的 Banner
 * 遍历缓存的 Banner 列表，返回第一个未被用户关闭且在时间窗口内的 Banner
 * @returns {Object|null} Banner 对象或 null
 */
async function y() {
    try {
        const t = await chrome.storage.local.get([i, r]);
        const e = t[i] || [];
        const s = t[r] || [];
        const o = new Set(s);
        return e.find(n => !o.has(n.id) && g(n)) || null;
    } catch {
        return null;
    }
}

/**
 * 记录用户关闭的 Banner
 * 将 Banner ID 添加到 dismissedBanners 列表中
 * @param {string} t - Banner ID
 */
async function D(t) {
    try {
        const s = (await chrome.storage.local.get(r))[r] || [];
        if (!s.includes(t)) {
            await chrome.storage.local.set({ [r]: [...s, t] });
        }
    } catch {}
}

// 导出函数映射
export {
    p as a,   // ensureConfig
    D as d,   // dismissBanner
    l as f,   // fetchConfig
    y as g    // getActiveBanner
};
