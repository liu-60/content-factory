/**
 * ============================================================================
 * WechatSync v2.0.9 - Toutiao Platform Handler (toutiao.ts-Brq6w7IU.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 今日头条 (Toutiao) 平台的内容脚本。作为 fetch 代理运行，
 * 允许 background script 通过内容脚本的上下文发起带有用户凭据的 HTTP 请求。
 *
 * 【适用页面】
 * 注入到今日头条相关页面（mp.toutiao.com 等）
 *
 * 【工作原理】
 * Background script 不能直接跨域请求头条 API（受 CORS 限制），
 * 因此通过 chrome.runtime.sendMessage 将请求转发给注入到头条页面的内容脚本，
 * 内容脚本在页面上下文中执行 fetch（自动携带 cookie），然后将结果返回给 background。
 *
 * 【消息协议】
 * 请求消息:
 *   type: "TOUTIAO_PAGE_FETCH"
 *   payload: {
 *     url: string,        // 要请求的 URL
 *     options: Object     // fetch 选项（method, headers, body 等）
 *   }
 *
 * 响应消息:
 *   成功: { success: true, data: Object|string }   // 尝试 JSON 解析，失败则返回文本
 *   失败: { success: false, error: string }
 *
 * 【关键设计】
 * - credentials: "include" 确保请求携带用户 cookie
 * - 响应体先尝试 JSON.parse，失败则返回原始文本
 * - 使用 !0 (true) 返回值保持消息通道以支持异步响应
 */

import {
    c as u   // createLogger
} from "./logger-CvfM-6aa.js";

const r = u("ToutiaoCS");

/**
 * 消息监听器：处理来自 background 的 fetch 请求
 *
 * 当 background 需要同步文章到头条时，会通过此代理发送 API 请求
 * （如发布文章、上传图片、获取 token 等）
 */
chrome.runtime.onMessage.addListener((c, d, o) => {
    if (c.type === "TOUTIAO_PAGE_FETCH") {
        const { url: s, options: n } = c.payload;

        r.debug("Received fetch request:", s);

        // 在页面上下文中执行 fetch（自动携带 cookie）
        fetch(s, {
            ...n,
            credentials: "include"   // 强制携带 cookie
        }).then(async e => {
            const a = await e.text();
            let t;
            try {
                t = JSON.parse(a);   // 尝试解析 JSON
            } catch {
                t = a;               // 回退为纯文本
            }
            r.debug("Fetch response:", t);
            o({ success: !0, data: t });
        }).catch(e => {
            r.error("Fetch error:", e);
            o({ success: !1, error: e.message });
        });

        return !0;  // 保持消息通道（异步响应）
    }
});

// 模块加载日志
r.debug("Toutiao content script loaded");
