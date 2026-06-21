/**
 * ============================================================================
 * WechatSync v2.0.9 - WeChat Platform Handler (weixin.ts-DnI7OB4I.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 微信公众号文章阅读页内容脚本。注入到 mp.weixin.qq.com 的文章页面，
 * 负责检测文章、提取内容、显示悬浮同步按钮，以及处理同步对话框交互。
 *
 * 【适用页面】
 * https://mp.weixin.qq.com/s/... (微信公众号文章阅读页)
 *
 * 【文章检测机制】
 * 通过检查页面是否存在 #js_content 元素来判断是否为微信文章页
 * 同时检查 #wechatsync-fab 是否已存在，避免重复创建 FAB
 *
 * 【文章提取流程】
 * 1. 获取标题: #activity-name 元素的文本
 * 2. 获取内容: #js_content 元素的 innerHTML
 * 3. 获取封面: meta[property="og:image"] 的 content
 * 4. 获取摘要: meta[property="og:description"] 的 content
 * 5. 对内容进行清洗（basicClean + restoreCodeBlocks）
 * 6. 转换为 Markdown 格式
 *
 * 【同步对话框流程】
 * 1. 用户点击 FAB → 显示加载动画
 * 2. 并行提取文章 + 获取已认证平台列表 (CHECK_ALL_AUTH)
 * 3. 创建 iframe 加载 src/sync-dialog/index.html
 * 4. 通过 postMessage 与 iframe 通信
 * 5. 发送 INIT_DATA（文章+平台列表）
 * 6. 接收 START_SYNC → 转发给 background → 返回结果
 *
 * 【消息监听】
 * - EXTRACT_ARTICLE: 供 popup 调用，提取当前文章
 * - PREPROCESS_FOR_PLATFORMS: 为各平台预处理内容
 * - SYNC_PROGRESS / SYNC_DETAIL_PROGRESS: 同步进度转发到 iframe
 *
 * 【数据追踪】
 * 通过 TRACK_ARTICLE_EXTRACT 消息向 background 报告提取结果（成功/失败、
 * 标题/内容/封面是否存在、内容长度）
 */

import {
    h as w   // htmlToMarkdown
} from "./jszip.min-DpCewD43.js";
import {
    p as x,  // processContent
    b as E,  // backupAndSimplifyCodeBlocks
    r as h,  // restoreCodeBlocks
    a as R   // basicClean
} from "./content-processor-COHfnfLF.js";
import {
    c as T   // createFab
} from "./fab-W2bspDnB.js";
import "./_commonjsHelpers-BosuxZz1.js";
import "./logger-CvfM-6aa.js";

// ============================================================================
// 自执行匿名函数：模块入口
// ============================================================================
(() => {
    let n = null,   // iframe 元素（同步对话框）
        r = null;   // 对话框遮罩层元素

    /**
     * 初始化：检查是否为微信文章页，如果是则创建悬浮同步按钮
     *
     * 检测条件：
     * - 页面存在 #js_content（微信文章内容容器）
     * - 页面不存在 #wechatsync-fab（避免重复创建）
     */
    function u() {
        if (!document.querySelector("#js_content") || document.querySelector("#wechatsync-fab")) return;
        const e = T({ onClick: () => S() });
        document.body.appendChild(e);
    }

    /**
     * 显示同步对话框
     *
     * 流程：
     * 1. 创建全屏遮罩层 + 加载动画
     * 2. 并行执行：提取文章 + 获取已认证平台列表
     * 3. 发送追踪数据（提取成功/失败）
     * 4. 创建 iframe 加载同步对话框 UI
     * 5. 等待 iframe 发送 SYNC_DIALOG_READY，然后发送 INIT_DATA
     */
    async function S() {
        var d;
        if (r) return;  // 防止重复打开

        // 创建遮罩层（z-index: 2147483647，最高层级）
        r = document.createElement("div");
        r.id = "wechatsync-dialog-overlay";
        r.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.3);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;
        // 点击遮罩层空白区域关闭对话框
        r.addEventListener("click", c => { c.target === r && y() });

        // 创建加载动画（绿色旋转圆圈 + "正在提取文章..."）
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
        r.appendChild(t);
        document.body.appendChild(r);

        // 并行提取文章和平台列表
        const [e, s] = await Promise.all([
            Promise.resolve(f()),  // 提取文章（同步）
            chrome.runtime.sendMessage({ type: "CHECK_ALL_AUTH" }).catch(() => ({ platforms: [] }))
        ]);

        // 提取失败：发送追踪数据并关闭对话框
        if (!e) {
            chrome.runtime.sendMessage({
                type: "TRACK_ARTICLE_EXTRACT",
                payload: { source: "weixin", success: !1 }
            }).catch(() => {});
            y();
            return;
        }

        // 提取成功：发送追踪数据
        chrome.runtime.sendMessage({
            type: "TRACK_ARTICLE_EXTRACT",
            payload: {
                source: "weixin",
                success: !0,
                hasTitle: !!e.title,
                hasContent: !!e.content,
                hasCover: !!e.cover,
                contentLength: ((d = e.content)?.length) || 0
            }
        }).catch(() => {});

        const o = s.platforms || [];
        if (!r) return;  // 遮罩层已被关闭

        // 移除加载动画，创建同步对话框 iframe
        t.remove();
        n = document.createElement("iframe");
        n.src = chrome.runtime.getURL("src/sync-dialog/index.html");
        n.style.cssText = `
    width: 400px; height: 520px; border: none;
    border-radius: 12px; overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  `;
        r.appendChild(n);

        // 监听 iframe 的 SYNC_DIALOG_READY 消息，发送初始数据
        const i = c => {
            var a;
            try {
                (typeof c.data == "string" ? JSON.parse(c.data) : c.data).type === "SYNC_DIALOG_READY" && (
                    window.removeEventListener("message", i),
                    (a = n?.contentWindow)?.postMessage(JSON.stringify({
                        type: "INIT_DATA",
                        article: e,
                        platforms: o
                    }), "*")
                );
            } catch {}
        };
        window.addEventListener("message", i);
    }

    /**
     * 关闭同步对话框
     */
    function y() {
        r && (r.remove(), r = null, n = null);
    }

    // ========================================================================
    // iframe 消息监听：处理对话框的操作事件
    // ========================================================================
    window.addEventListener("message", t => {
        try {
            const e = typeof t.data == "string" ? JSON.parse(t.data) : t.data;

            if (e.type === "CLOSE_SYNC_DIALOG") {
                // 关闭对话框
                y();
            } else if (e.type === "START_SYNC") {
                // 开始同步：将请求转发给 background script
                const s = e.syncId;
                chrome.runtime.sendMessage({
                    type: "SYNC_ARTICLE",
                    payload: {
                        article: e.article,
                        platforms: e.platforms,
                        source: "weixin",
                        syncId: s
                    }
                }).then(o => {
                    var i;
                    // 同步完成：将结果转发给 iframe
                    (i = n?.contentWindow)?.postMessage(JSON.stringify({
                        type: "SYNC_COMPLETE",
                        results: o.results,
                        rateLimitWarning: o.rateLimitWarning,
                        syncId: s
                    }), "*");
                }).catch(o => {
                    var i;
                    // 同步失败：将错误转发给 iframe
                    (i = n?.contentWindow)?.postMessage(JSON.stringify({
                        type: "SYNC_ERROR",
                        error: o.message,
                        syncId: s
                    }), "*");
                });
            }
        } catch {}
    });

    // ========================================================================
    // Background 消息监听：转发同步进度到 iframe
    // ========================================================================
    chrome.runtime.onMessage.addListener(t => {
        var e, s, o;
        if (n) {
            // 平台级同步进度
            if (t.type === "SYNC_PROGRESS") {
                (s = n.contentWindow)?.postMessage(JSON.stringify({
                    type: "SYNC_PROGRESS",
                    result: (e = t.payload)?.result,
                    syncId: t.syncId
                }), "*");
            }
            // 详细同步进度（图片上传等）
            if (t.type === "SYNC_DETAIL_PROGRESS") {
                (o = n.contentWindow)?.postMessage(JSON.stringify({
                    type: "SYNC_DETAIL_PROGRESS",
                    progress: t.payload,
                    syncId: t.syncId
                }), "*");
            }
        }
    });

    // ========================================================================
    // Background 消息监听：文章提取和预处理请求
    // ========================================================================
    chrome.runtime.onMessage.addListener((t, e, s) => {
        if (t.type === "EXTRACT_ARTICLE") {
            // popup 请求提取当前文章
            const o = f();
            s({ article: o });
            return !0;
        }
        if (t.type === "PREPROCESS_FOR_PLATFORMS") {
            // 为各平台预处理 HTML 内容
            const { rawHtml: o, platforms: i, configs: d } = t.payload;
            const c = {};
            for (const a of i) {
                const l = d[a];
                if (l) c[a] = x(o, l);  // processContent
            }
            s({ platformContents: c });
            return !0;
        }
    });

    /**
     * 从微信文章页面提取文章内容
     *
     * 提取策略：
     * 1. 标题: #activity-name 元素文本
     * 2. 内容: #js_content 元素的 HTML
     * 3. 封面: meta[property="og:image"]
     * 4. 摘要: meta[property="og:description"]
     *
     * 内容处理流程：
     * raw HTML → backupAndSimplifyCodeBlocks → basicClean → restoreCodeBlocks
     * 然后生成清理后的 HTML 和 Markdown
     *
     * @returns {Object|null} 文章数据对象，或 null（如果无法提取）
     */
    function f() {
        var c, a, l, g;
        const t = (a = (c = document.querySelector("#activity-name"))?.textContent)?.trim();
        const e = document.querySelector("#js_content");
        const s = (l = document.querySelector('meta[property="og:image"]'))?.getAttribute("content");
        const o = (g = document.querySelector('meta[property="og:description"]'))?.getAttribute("content");

        // 必须有标题和内容容器
        if (!t || !e) return null;

        const i = e.innerHTML;      // 原始 HTML
        const d = E(e);             // 简化代码块（返回备份）

        try {
            const p = e.cloneNode(!0);
            h(d);                   // 恢复代码块
            R(p);                   // 基础清洗
            const m = p.innerHTML;  // 清洗后的 HTML
            const C = w(m);         // 转换为 Markdown

            return {
                title: t,
                html: m,
                content: m,
                rawHtml: i,
                markdown: C,
                summary: o || void 0,
                cover: s || void 0,
                source: {
                    url: window.location.href,
                    platform: "weixin"
                }
            };
        } catch (p) {
            h(d);   // 出错也要恢复代码块
            throw p;
        }
    }

    // 初始化：页面加载完成后创建 FAB
    document.readyState === "loading"
        ? document.addEventListener("DOMContentLoaded", u)
        : u();
})();
