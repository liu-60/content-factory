/**
 * ============================================================================
 * WechatSync v2.0.9 - WeChat Editor Handler (weixin-editor.ts-BvjP2fPl.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 微信公众号图文编辑器内容脚本。注入到微信公众号后台的文章编辑页面，
 * 允许用户将正在编辑的文章同步到其他平台（知乎、掘金、CSDN 等）。
 *
 * 【适用页面】
 * https://mp.weixin.qq.com/cgi-bin/appmsg?...&action=edit...
 * （微信公众号后台的图文编辑页面）
 *
 * 【与 weixin.ts 的区别】
 * - weixin.ts 处理的是已发布的文章阅读页（/s/...）
 * - weixin-editor.ts 处理的是编辑中的草稿页面（/cgi-bin/appmsg）
 * - 编辑器中的内容在 UEditor iframe 中，需要跨 iframe 访问
 * - 标题在 input 元素中而非文本节点
 *
 * 【文章提取策略（多层次回退）】
 * 1. 标题提取（按优先级尝试多个选择器）:
 *    #js_title_place → #title → input[name="title"] → .weui-desktop-form__input 等
 *
 * 2. 内容提取（按优先级）:
 *    a. UEditor iframe (#ueditor_0) → contentDocument.body.innerHTML
 *    b. 回退选择器: .edui-body-container / .rich_media_content / #js_content
 *    c. 如果本地提取失败且有 appmsgid 参数，调用 API 获取已发布版本
 *
 * 3. API 回退机制:
 *    调用 appmsg?action=get_temp_url 获取临时访问链接
 *    然后 fetch 该链接并解析为标准微信文章页面
 *
 * 【FAB 触发机制】
 * 检测到编辑页面后，延迟 1.5 秒创建悬浮按钮（等待编辑器加载完成）
 * 编辑页面的 FAB 使用圆形按钮样式（与阅读页的药丸按钮不同）
 *
 * 【消息通信】
 * - EXTRACT_ARTICLE: 提取编辑器中的文章
 * - EXPAND_SYNC_PANEL: 打开同步面板（由 popup 触发）
 * - SYNC_PROGRESS / SYNC_DETAIL_PROGRESS: 同步进度转发
 */

import { c as O } from "./logger-CvfM-6aa.js";
import { h as T } from "./jszip.min-DpCewD43.js";
import {
    b as v,   // backupAndSimplifyCodeBlocks
    r as R,   // restoreCodeBlocks
    c as k    // quickClean
} from "./content-processor-COHfnfLF.js";
import "./_commonjsHelpers-BosuxZz1.js";

const _ = O("WeixinEditor");

// ============================================================================
// 自执行匿名函数：模块入口
// ============================================================================
(() => {
    let i = null,   // iframe 元素（同步对话框）
        d = null;   // 对话框遮罩层元素

    /**
     * 检测当前页面是否为微信公众号编辑器页面
     * 通过 URL 中包含 cgi-bin/appmsg 和 action=edit 或 appmsg_edit 来判断
     */
    function C() {
        const t = window.location.href;
        return t.includes("mp.weixin.qq.com/cgi-bin/appmsg") &&
               (t.includes("action=edit") || t.includes("appmsg_edit"));
    }

    /**
     * 创建编辑器页面的悬浮同步按钮
     * 使用圆形按钮（48x48px），位于右下角 bottom:80px
     * 比阅读页的 FAB 位置更高，避免与编辑器底部工具栏重叠
     */
    function A() {
        if (document.querySelector("#wechatsync-editor-fab")) return;

        const t = document.createElement("button");
        t.id = "wechatsync-editor-fab";
        t.title = "同步助手";
        // 使用微信同步图标的 SVG
        t.innerHTML = `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
    </svg>
  `;
        // 圆形绿色渐变按钮
        t.style.cssText = `
    position: fixed; right: 20px; bottom: 80px; z-index: 2147483647;
    width: 48px; height: 48px; border-radius: 50%;
    background: linear-gradient(135deg, #07c160 0%, #06ad56 100%);
    border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 12px rgba(7, 193, 96, 0.4);
    transition: all 0.2s;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

        // 鼠标悬停效果
        t.addEventListener("mouseenter", () => {
            t.style.transform = "scale(1.05)";
            t.style.boxShadow = "0 6px 16px rgba(7, 193, 96, 0.5)";
        });
        t.addEventListener("mouseleave", () => {
            t.style.transform = "scale(1)";
            t.style.boxShadow = "0 4px 12px rgba(7, 193, 96, 0.4)";
        });

        // 点击打开同步面板
        t.addEventListener("click", () => L());
        document.body.appendChild(t);
    }

    /**
     * 打开同步面板
     * 流程与 weixin.ts 中的 S() 函数类似，但来源标记为 "weixin-editor"
     */
    async function L() {
        var l;
        if (d) return;

        // 创建遮罩层 + 加载动画
        d = document.createElement("div");
        d.id = "wechatsync-dialog-overlay";
        d.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;
        d.addEventListener("click", u => { u.target === d && h(); });

        const t = document.createElement("div");
        t.style.cssText = `
    background: white; padding: 20px 32px; border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    display: flex; align-items: center; gap: 12px;
  `;
        t.innerHTML = `
    <div style="width:20px;height:20px;border:3px solid #e5e5e5;border-top-color:#07c160;border-radius:50%;animation:wcs-spin 0.8s linear infinite;"></div>
    <span style="font-size:14px;color:#333;">正在提取文章...</span>
    <style>@keyframes wcs-spin { to { transform: rotate(360deg); } }</style>
  `;
        d.appendChild(t);
        document.body.appendChild(d);

        // 并行提取文章 + 获取平台列表
        const [n, o] = await Promise.all([
            E(),  // 从编辑器提取文章
            chrome.runtime.sendMessage({ type: "CHECK_ALL_AUTH" }).catch(() => ({ platforms: [] }))
        ]);

        if (!n) {
            chrome.runtime.sendMessage({
                type: "TRACK_ARTICLE_EXTRACT",
                payload: { source: "weixin-editor", success: !1 }
            }).catch(() => {});
            h();
            return;
        }

        // 发送提取追踪数据
        chrome.runtime.sendMessage({
            type: "TRACK_ARTICLE_EXTRACT",
            payload: {
                source: "weixin-editor", success: !0,
                hasTitle: !!n.title, hasContent: !!n.content,
                hasCover: !!n.cover,
                contentLength: ((l = n.content)?.length) || 0
            }
        }).catch(() => {});

        const r = o.platforms || [];
        if (!d) return;

        // 创建 iframe 同步对话框
        t.remove();
        i = document.createElement("iframe");
        i.src = chrome.runtime.getURL("src/sync-dialog/index.html");
        i.style.cssText = `
    width: 400px; height: 520px; border: none;
    border-radius: 12px; overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  `;
        d.appendChild(i);
        document.body.appendChild(d);

        // 等待 iframe 就绪后发送初始数据
        const s = u => {
            var y;
            try {
                (typeof u.data == "string" ? JSON.parse(u.data) : u.data).type === "SYNC_DIALOG_READY" && (
                    window.removeEventListener("message", s),
                    (y = i?.contentWindow)?.postMessage(JSON.stringify({
                        type: "INIT_DATA", article: n, platforms: r
                    }), "*")
                );
            } catch {}
        };
        window.addEventListener("message", s);
    }

    /**
     * 关闭同步对话框
     */
    function h() {
        d && (d.remove(), d = null, i = null);
    }

    // ========================================================================
    // iframe 消息监听
    // ========================================================================
    window.addEventListener("message", t => {
        try {
            const n = typeof t.data == "string" ? JSON.parse(t.data) : t.data;
            if (n.type === "CLOSE_SYNC_DIALOG") h();
            else if (n.type === "START_SYNC") {
                const o = n.syncId;
                chrome.runtime.sendMessage({
                    type: "SYNC_ARTICLE",
                    payload: {
                        article: n.article, platforms: n.platforms,
                        source: "weixin-editor", syncId: o
                    }
                }).then(r => {
                    var s;
                    (s = i?.contentWindow)?.postMessage(JSON.stringify({
                        type: "SYNC_COMPLETE", results: r.results,
                        rateLimitWarning: r.rateLimitWarning, syncId: o
                    }), "*");
                }).catch(r => {
                    var s;
                    (s = i?.contentWindow)?.postMessage(JSON.stringify({
                        type: "SYNC_ERROR", error: r.message, syncId: o
                    }), "*");
                });
            }
        } catch {}
    });

    // Background 进度转发
    chrome.runtime.onMessage.addListener(t => {
        var n, o, r;
        if (i) {
            if (t.type === "SYNC_PROGRESS")
                (o = i.contentWindow)?.postMessage(JSON.stringify({
                    type: "SYNC_PROGRESS", result: (n = t.payload)?.result, syncId: t.syncId
                }), "*");
            if (t.type === "SYNC_DETAIL_PROGRESS")
                (r = i.contentWindow)?.postMessage(JSON.stringify({
                    type: "SYNC_DETAIL_PROGRESS", progress: t.payload, syncId: t.syncId
                }), "*");
        }
    });

    // Background 命令处理
    chrome.runtime.onMessage.addListener((t, n, o) => {
        if (t.type === "EXTRACT_ARTICLE" && C()) {
            // 提取编辑器文章
            E().then(r => { o({ article: r }) })
                .catch(() => { o({ article: null }) });
            return !0;
        }
        if (t.type === "EXPAND_SYNC_PANEL") {
            // 由 popup 触发的打开同步面板
            L();
            o({ success: !0 });
            return !0;
        }
    });

    /**
     * 从微信编辑器页面提取文章
     *
     * 标题提取：尝试多个选择器，覆盖不同版本的编辑器 UI
     * 内容提取：
     *   1. 尝试访问 UEditor iframe（#ueditor_0）
     *   2. 回退到 .edui-body-container 等容器
     *   3. 如果都失败且有 appmsgid，通过 API 获取已发布版本
     *
     * 封面提取：.appmsg_thumb img / .js_cover img 等
     * 摘要提取：[name="digest"] / #digest 等
     */
    async function E() {
        var t, n, o;
        try {
            _.debug("Extracting article...");

            // 标题选择器列表（按优先级排列）
            const r = [
                "#js_title_place", "#title", 'input[name="title"]',
                ".weui-desktop-form__input", ".title_input input",
                ".js_title", '[data-id="title"]',
                ".appmsg_title input", ".appmsg-edit-title input"
            ];
            let s = "";
            for (const c of r) {
                const e = document.querySelector(c);
                const a = ((t = e?.value)?.trim()) || ((n = e?.textContent)?.trim());
                if (a) { s = a; break; }
            }

            // 内容提取：首先尝试 UEditor iframe
            let l = "";
            const u = [
                "#ueditor_0", 'iframe[id^="ueditor"]',
                ".edui-editor iframe", "iframe.edui-body-container"
            ];
            for (const c of u) try {
                const e = document.querySelector(c);
                if ((o = e?.contentDocument)?.body) {
                    const a = e.contentDocument.body;
                    const p = a.innerHTML;
                    // 检查内容是否有效（非空占位符）
                    if (p && p.trim() && p.trim() !== "<p><br></p>" && p.length > 10) {
                        const b = v(a);  // 简化代码块
                        l = a.innerHTML;
                        R(b);            // 恢复代码块
                        break;
                    }
                }
            } catch {}

            // 回退：尝试直接 DOM 选择器
            if (!l) {
                const c = [".edui-body-container", ".rich_media_content", "#js_content", ".appmsg-edit-content"];
                for (const e of c) {
                    const a = document.querySelector(e);
                    if (a?.innerHTML && a.innerHTML.trim().length > 10) {
                        const p = v(a);
                        l = a.innerHTML;
                        R(p);
                        break;
                    }
                }
            }

            // API 回退：如果有 appmsgid 但本地提取失败
            const y = new URLSearchParams(window.location.search).get("appmsgid");
            if (y && (!l || !s)) {
                const c = await M(y);
                if (c) return c;
            }

            if (!s || !l) return null;

            // 封面提取
            const f = [".appmsg_thumb img", ".js_cover img", ".cover-img img", ".appmsg_thumb_wrap img"];
            let x = "";
            for (const c of f) {
                const e = document.querySelector(c);
                if (e?.src && !e.src.includes("data:")) { x = e.src; break; }
            }

            // 摘要提取
            const w = ['[name="digest"]', "#digest", "textarea.digest", ".appmsg_desc textarea"];
            let S = "";
            for (const c of w) {
                const e = document.querySelector(c);
                if (e?.value) { S = e.value; break; }
            }

            const m = k(l);       // quickClean: 快速清洗 HTML
            const g = T(m);       // htmlToMarkdown
            return {
                title: s, html: m, content: m, markdown: g,
                summary: S, cover: x,
                source: { url: window.location.href, platform: "weixin-editor" }
            };
        } catch (r) {
            return _.error("Extract failed:", r), null;
        }
    }

    /**
     * API 回退：通过 appmsgid 获取已发布文章的临时访问链接
     *
     * 流程：
     * 1. 从 URL 提取 token 参数
     * 2. 调用 WeChat API: appmsg?action=get_temp_url
     * 3. fetch 临时链接并用 DOMParser 解析
     * 4. 按照标准微信文章的方式提取内容
     *
     * @param {string} t - appmsgid 参数
     * @returns {Object|null} 文章数据或 null
     */
    async function M(t) {
        var n, o, r, s;
        try {
            const l = window.location.search.match(/token=(\d+)/);
            if (!l) return null;
            const u = l[1];

            // 获取临时访问链接
            const f = await (await fetch(
                `https://mp.weixin.qq.com/cgi-bin/appmsg?action=get_temp_url&appmsgid=${t}&itemidx=1&token=${u}&lang=zh_CN&f=json&ajax=1`,
                { credentials: "include" }
            )).json();
            if (!f.temp_url) return null;

            // fetch 并解析临时链接页面
            const w = await (await fetch(f.temp_url)).text();
            const m = new DOMParser().parseFromString(w, "text/html");

            const g = (o = (n = m.querySelector("#activity-name"))?.textContent)?.trim();
            const c = m.querySelector("#js_content");
            const e = (r = m.querySelector('meta[property="og:image"]'))?.getAttribute("content");
            const a = (s = m.querySelector('meta[property="og:description"]'))?.getAttribute("content");

            if (!g || !c) return null;

            const p = k(c.innerHTML);   // quickClean
            const b = T(p);             // htmlToMarkdown
            return {
                title: g, html: p, content: p, markdown: b,
                summary: a, cover: e,
                source: { url: f.temp_url, platform: "weixin" }
            };
        } catch (l) {
            return _.error("API fetch failed:", l), null;
        }
    }

    /**
     * 模块初始化入口
     * 仅在编辑器页面生效，延迟 1.5 秒创建 FAB（等待 UEditor 加载）
     */
    function N() {
        if (!C()) return;
        const t = () => setTimeout(A, 1500);
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", t)
            : t();
    }
    N();
})();
