/**
 * ============================================================================
 * WechatSync v2.0.9 - Editor 模块 (editor-91KajDge.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 全屏编辑器 UI，基于 React 构建。当用户从 extractor.ts 的通用提取器打开
 * 编辑器时，会加载此页面（src/editor/index.html）在一个全屏 iframe 中。
 *
 * 【功能】
 * 1. 文章预览和编辑：标题和内容均可通过 contentEditable 直接修改
 * 2. 平台选择：勾选/取消勾选已认证的同步目标平台
 * 3. 同步操作：发送文章到选中的平台，显示同步进度和结果
 * 4. 错误重试：同步失败的平台可以一键重试
 *
 * 【与 Popup 的区别】
 * - Popup 是浏览器扩展弹窗，受尺寸限制（400x600）
 * - Editor 是全屏页面，提供更舒适的编辑体验
 * - Editor 通过 iframe 嵌入到源网页中
 * - Editor 可以直接修改文章内容后同步
 *
 * 【通信机制】
 * 与宿主页面（extractor.ts）通过 postMessage 通信：
 * - 接收: ARTICLE_DATA, PLATFORMS_DATA, SYNC_PROGRESS, SYNC_DETAIL_PROGRESS, SYNC_COMPLETE, SYNC_ERROR
 * - 发送: EDITOR_READY, CLOSE_EDITOR, START_SYNC
 *
 * 【状态管理】
 * 使用 React useState 管理：
 * - article: 文章数据（标题/内容/封面）
 * - platforms: 可用平台列表
 * - selectedPlatforms: 选中的平台 ID 列表
 * - status: "idle" | "syncing" | "completed"
 * - results: 同步结果数组
 * - platformProgress: 各平台进度 Map
 *
 * 【平台选择持久化】
 * 选中的平台 ID 列表通过 chrome.storage.local 的 "selectedPlatforms" 键持久化
 */

import "./modulepreload-polyfill-B5Qt9EMX.js";
import {
    r,       // React
    j as e,  // JSX 运行时
    L as K,  // Loader 组件（加载动画）
    a as U,  // classNames 工具
    X as I,  // X 图标（关闭按钮）
    S as X,  // SyncPanel 组件（同步面板）
    d as Q   // createRoot
} from "./globals-Cn4U41aQ.js";
import { c as V } from "./logger-CvfM-6aa.js";
import "./_commonjsHelpers-BosuxZz1.js";
import "./remote-config-BEX-YVxx.js";

const g = V("Editor");

// chrome.storage.local 中保存选中平台的键名
const P = "selectedPlatforms";

/**
 * 保存选中的平台 ID 列表到 chrome.storage.local
 */
function S(a) {
    chrome.storage.local.set({ [P]: a }).catch(N => {
        g.error("Failed to save selected platforms:", N);
    });
}

/**
 * 编辑器主组件
 *
 * 状态：
 * - a: article (文章数据)
 * - j: platforms (平台列表)
 * - o: selectedPlatforms (选中的平台 ID)
 * - d: status (idle/syncing/completed)
 * - u: results (同步结果)
 * - E: error (错误信息)
 * - L: rateLimitWarning (频率限制警告)
 * - O: platformProgress (各平台进度 Map)
 * - T: currentSyncId (当前同步 ID)
 * - M: showSyncPanel (是否显示同步面板)
 */
function Z() {
    const [a, N] = r.useState(null);        // article
    const [j, F] = r.useState([]);          // platforms
    const [o, c] = r.useState([]);          // selectedPlatforms
    const [d, m] = r.useState("idle");      // status
    const [u, x] = r.useState([]);          // results
    const [E, h] = r.useState(null);        // error
    const [L, v] = r.useState(null);        // rateLimitWarning
    const [O, p] = r.useState(new Map);     // platformProgress
    const [T, y] = r.useState(null);        // currentSyncId
    const b = r.useRef(null);               // syncId ref（用于消息过滤）
    const [M, R] = r.useState(!1);          // showSyncPanel

    // 同步 syncId ref
    r.useEffect(() => { b.current = T }, [T]);

    const _ = r.useRef(null);   // 标题元素 ref
    const w = r.useRef(null);   // 内容元素 ref

    /**
     * 初始化：监听来自宿主页面的消息
     * 发送 EDITOR_READY 通知宿主页面编辑器已就绪
     */
    r.useEffect(() => {
        const n = l => {
            try {
                const t = typeof l.data == "string" ? JSON.parse(l.data) : l.data;

                // syncId 过滤：忽略其他同步会话的消息
                if (t.syncId) {
                    if (!b.current) y(t.syncId);
                    else if (t.syncId !== b.current) return;
                }

                g.debug("Received message:", t);

                if (t.type === "ARTICLE_DATA") {
                    // 接收文章数据
                    N(t.article);
                    if (w.current && t.article.content) w.current.innerHTML = t.article.content;
                } else if (t.type === "PLATFORMS_DATA") {
                    // 接收平台列表
                    F(t.platforms);
                    if (t.selectedPlatformIds && t.selectedPlatformIds.length > 0) {
                        c(t.selectedPlatformIds);
                        S(t.selectedPlatformIds);
                    } else {
                        // 从 storage 恢复之前选中的平台
                        chrome.storage.local.get(P).then(s => {
                            const i = s[P];
                            const $ = t.platforms.filter(f => f.isAuthenticated).map(f => f.id);
                            const G = new Set($);
                            const q = i ? i.filter(f => G.has(f)) : [];
                            c(q);
                        }).catch(() => c([]));
                    }
                } else if (t.type === "SYNC_PROGRESS") {
                    // 平台级同步结果
                    if (t.result) x(s => [...s, t.result]);
                } else if (t.type === "SYNC_DETAIL_PROGRESS") {
                    // 详细进度（如图片上传进度）
                    const s = t.progress;
                    if (s?.platform) p(i => { const C = new Map(i); C.set(s.platform, s); return C; });
                } else if (t.type === "SYNC_COMPLETE") {
                    m("completed");
                    if (t.rateLimitWarning) { v(t.rateLimitWarning); setTimeout(() => v(null), 8e3); }
                } else if (t.type === "SYNC_ERROR") {
                    h(t.error);
                    m("idle");
                }
            } catch (t) {
                g.error("Failed to parse message:", t);
            }
        };

        window.addEventListener("message", n);
        // 通知宿主页面编辑器已就绪
        window.parent.postMessage(JSON.stringify({ type: "EDITOR_READY" }), "*");
        return () => window.removeEventListener("message", n);
    }, []);

    // 当所有平台都已返回结果时，自动切换到完成状态
    r.useEffect(() => {
        if (d === "syncing" && u.length > 0 && u.length >= o.length) m("completed");
    }, [u.length, o.length, d]);

    // 关闭编辑器
    const z = r.useCallback(() => {
        window.parent.postMessage(JSON.stringify({ type: "CLOSE_EDITOR" }), "*");
    }, []);

    // 获取当前文章数据（从 DOM 读取已编辑的内容）
    const D = r.useCallback(() => {
        var n, l;
        return a ? {
            ...a,
            title: ((n = _.current)?.innerText) || a.title,
            content: ((l = w.current)?.innerHTML) || a.content
        } : null;
    }, [a]);

    // 切换平台选中状态
    const B = n => {
        c(l => {
            const t = new Set(l);
            t.has(n) ? t.delete(n) : t.add(n);
            const s = Array.from(t);
            S(s);
            return s;
        });
    };

    // 全选已认证平台
    const Y = () => {
        const n = j.filter(l => l.isAuthenticated).map(l => l.id);
        c(n); S(n);
    };

    // 取消全选
    const W = () => { c([]); S([]); };

    // 开始同步
    const H = () => {
        const n = D();
        if (!n || o.length === 0) return;
        const l = `sync_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        y(l);
        m("syncing");
        x([]);
        h(null);
        p(new Map);
        // 发送同步请求给宿主页面
        window.parent.postMessage(JSON.stringify({
            type: "START_SYNC", article: n, platforms: o, syncId: l
        }), "*");
    };

    // 重试失败的平台
    const J = () => {
        const n = u.filter(s => !s.success).map(s => s.platform);
        if (n.length === 0) return;
        const l = D();
        if (!l) return;
        const t = `sync_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        y(t);
        m("syncing");
        x(s => s.filter(i => i.success));  // 保留成功的结果
        p(new Map);
        window.parent.postMessage(JSON.stringify({
            type: "START_SYNC", article: l, platforms: n, syncId: t
        }), "*");
    };

    // 重置同步状态
    const A = () => {
        m("idle"); x([]); h(null); p(new Map); y(null); R(!1);
    };

    // 加载中状态
    if (!a) return e.jsx("div", {
        className: "h-screen flex items-center justify-center bg-gray-50",
        children: e.jsxs("div", {
            className: "text-center",
            children: [
                e.jsx(K, { className: "w-8 h-8 animate-spin text-gray-400 mx-auto" }),
                e.jsx("p", { className: "mt-2 text-gray-500", children: "加载文章中..." })
            ]
        })
    });

    const k = j.filter(n => n.isAuthenticated).length;

    // ========================================================================
    // UI 渲染
    // ========================================================================
    return e.jsxs("div", {
        className: "min-h-screen bg-gray-50",
        children: [
            // 顶部导航栏：Logo + 标题 + 同步按钮 + 关闭按钮
            e.jsx("header", {
                className: "fixed top-0 left-0 right-0 bg-white border-b shadow-sm z-50",
                children: e.jsxs("div", {
                    className: "px-6 py-3 flex items-center justify-between",
                    children: [
                        e.jsxs("div", {
                            className: "flex items-center gap-4",
                            children: [
                                e.jsx("img", { src: chrome.runtime.getURL("assets/icon-48.png"), alt: "Logo", className: "w-6 h-6" }),
                                e.jsx("span", { className: "font-medium text-gray-700", children: "同步助手 - 点击内容可直接修改" }),
                                // 调试用：显示使用的提取器类型
                                (a?.extractor) && e.jsx("span", {
                                    className: "px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-500 rounded opacity-0 hover:opacity-100 transition-opacity",
                                    title: "Content extractor used",
                                    children: a.extractor
                                })
                            ]
                        }),
                        e.jsxs("div", {
                            className: "flex items-center gap-2",
                            children: [
                                // 同步按钮
                                e.jsxs("button", {
                                    onClick: () => R(!0),
                                    className: U("px-4 py-2 rounded-lg font-medium transition-colors",
                                        k > 0 ? "bg-blue-500 text-white hover:bg-blue-600" : "bg-gray-200 text-gray-400 cursor-not-allowed"),
                                    disabled: k === 0,
                                    children: ["同步", o.length > 0 ? ` (${o.length})` : ""]
                                }),
                                // 关闭按钮
                                e.jsx("button", {
                                    onClick: z,
                                    className: "p-2 rounded-lg hover:bg-gray-100 transition-colors",
                                    title: "关闭",
                                    children: e.jsx(I, { className: "w-5 h-5 text-gray-500" })
                                })
                            ]
                        })
                    ]
                })
            }),

            // 频率限制警告横幅
            L && e.jsx("div", {
                className: "fixed top-16 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-2 duration-200",
                children: e.jsxs("div", {
                    className: "bg-yellow-50 border border-yellow-200 rounded-lg p-3 shadow-lg flex items-center gap-2 max-w-md",
                    children: [
                        e.jsx("span", { className: "text-lg flex-shrink-0", children: "\u26a0\ufe0f" }),
                        e.jsx("p", { className: "text-sm text-yellow-800 flex-1", children: L }),
                        e.jsx("button", { onClick: () => v(null), className: "text-yellow-600 hover:text-yellow-800 flex-shrink-0",
                            children: e.jsx(I, { className: "w-4 h-4" }) })
                    ]
                })
            }),

            // 文章编辑区域
            e.jsx("main", {
                className: "pt-16 pb-16",
                children: e.jsxs("article", {
                    className: "w-full max-w-4xl mx-auto bg-white shadow-sm px-12 py-10",
                    style: { minHeight: "calc(100vh - 4rem)" },
                    children: [
                        // 封面图片
                        a.cover && e.jsx("img", { src: a.cover, alt: "", className: "w-full max-h-80 object-cover mb-8" }),
                        // 可编辑标题
                        e.jsx("h1", {
                            ref: _,
                            contentEditable: !0,
                            suppressContentEditableWarning: !0,
                            className: "text-3xl font-bold text-gray-900 mb-8 outline-none border border-transparent hover:border-gray-200 focus:border-blue-300 focus:bg-blue-50 rounded px-2 -mx-2 leading-tight transition-colors",
                            children: a.title
                        }),
                        // 可编辑内容
                        e.jsx("div", {
                            ref: w,
                            contentEditable: !0,
                            suppressContentEditableWarning: !0,
                            className: "outline-none border border-transparent hover:border-gray-200 focus:border-blue-300 focus:bg-blue-50/50 rounded transition-colors article-content",
                            style: { fontSize: "16px", lineHeight: "1.8", color: "#333" },
                            dangerouslySetInnerHTML: { __html: a.content }
                        }),
                        // 文章内容的 CSS 样式
                        e.jsx("style", {
                            children: `
            .article-content p { margin-bottom: 1em; }
            .article-content h1 { font-size: 2em; font-weight: bold; margin: 1em 0 0.5em; }
            .article-content h2 { font-size: 1.5em; font-weight: bold; margin: 1em 0 0.5em; }
            .article-content h3 { font-size: 1.25em; font-weight: 600; margin: 0.8em 0 0.4em; }
            .article-content img { max-width: 100%; height: auto; margin: 1em 0; display: block; }
            .article-content pre { background: #f5f5f5; padding: 1em; border-radius: 6px; overflow-x: auto; margin: 1em 0; font-size: 14px; }
            .article-content code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
            .article-content pre code { background: none; padding: 0; }
            .article-content blockquote { border-left: 4px solid #ddd; padding-left: 1em; margin: 1em 0; color: #666; font-style: italic; }
            .article-content ul { list-style: disc; padding-left: 2em; margin: 1em 0; }
            .article-content ol { list-style: decimal; padding-left: 2em; margin: 1em 0; }
            .article-content li { margin-bottom: 0.5em; }
            .article-content a { color: #2563eb; text-decoration: underline; }
            .article-content table { border-collapse: collapse; width: 100%; margin: 1em 0; }
            .article-content th, .article-content td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
            .article-content th { background: #f5f5f5; font-weight: 600; }
            .article-content hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
            .article-content strong { font-weight: 600; }
            .article-content em { font-style: italic; }
          `
                        })
                    ]
                })
            }),

            // 同步面板弹窗
            M && e.jsxs("div", {
                className: "fixed inset-0 z-[55] flex items-center justify-center",
                children: [
                    e.jsx("div", {
                        className: "absolute inset-0 bg-black/30",
                        onClick: () => { if (d === "idle") R(!1); }
                    }),
                    e.jsxs("div", {
                        className: "relative bg-white rounded-xl shadow-2xl w-[400px] max-h-[520px] overflow-hidden",
                        children: [
                            e.jsxs("div", {
                                className: "flex items-center justify-between px-4 py-3 border-b",
                                children: [
                                    e.jsx("span", { className: "font-semibold text-gray-900", children: "文章同步" }),
                                    e.jsx("button", {
                                        onClick: () => { if (d !== "syncing") A(); },
                                        className: "p-1 rounded hover:bg-gray-100 transition-colors",
                                        children: e.jsx(I, { className: "w-4 h-4 text-gray-500" })
                                    })
                                ]
                            }),
                            // 使用全局 SyncPanel 组件
                            e.jsx(X, {
                                article: a,
                                platforms: j,
                                status: d === "idle" ? "idle" : d === "syncing" ? "syncing" : "completed",
                                selectedPlatforms: o,
                                results: u,
                                platformProgress: O,
                                error: E,
                                onTogglePlatform: B,
                                onSelectAll: Y,
                                onDeselectAll: W,
                                onStartSync: H,
                                onRetryFailed: J,
                                onReset: A,
                                onCancel: A,
                                className: "max-h-[460px]"
                            })
                        ]
                    })
                ]
            }),

            // 底部错误提示（非面板状态时）
            E && !M && e.jsxs("div", {
                className: "fixed bottom-4 left-4 bg-red-50 border border-red-200 rounded-lg p-4 max-w-sm z-50",
                children: [
                    e.jsx("p", { className: "text-red-700 text-sm", children: E }),
                    e.jsx("button", { onClick: () => h(null), className: "mt-2 text-red-500 hover:underline text-sm", children: "关闭" })
                ]
            })
        ]
    });
}

// 应用入口：挂载 React 应用
Q(document.getElementById("root")).render(e.jsx(r.StrictMode, {
    children: e.jsx(Z, {})
}));
