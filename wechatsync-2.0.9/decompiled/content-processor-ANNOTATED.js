/**
 * ============================================================================
 * WechatSync v2.0.9 - Content Processor 模块 (content-processor-COHfnfLF.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 核心 HTML 内容清洗和转换管道。接收原始 HTML，根据可配置的处理选项执行
 * 一系列清洗步骤，输出干净的 HTML 和对应的 Markdown。
 *
 * 【处理管道】（按执行顺序）
 * 1.  processCodeBlocks    - 简化代码块：移除行号、合并多行代码、提取语言标识
 * 2.  removeComments       - 移除 HTML 注释节点
 * 3.  removeIframes        - 移除 <iframe> 元素
 * 4.  removeSpecialTags    - 移除微信特有标签（mpprofile/qqmusic/mpvoice 等）
 * 5.  removeSvgImages      - 将 SVG data URI 图片替换为 data-src 或移除
 * 6.  removeScripts        - 移除 <script>/<style>/<noscript>
 * 7.  removeLinks          - 将 <a> 链接转为 <span>（可保留指定域名）
 * 8.  processLazyImages    - 处理懒加载图片（data-src → src）
 * 9.  removeEmptyElements  - 移除空元素（无文本且无媒体子元素）
 * 10. removeEmptyImages    - 移除无 src 的图片
 * 11. removeDataAttributes - 移除 data-* 属性（保留 data-src）
 * 12. removeSrcset/sizes   - 移除响应式图片属性
 * 13. convertSection       - 将 <section> 转为 <div> 或 <p>
 * 14. removeTrailingBr     - 移除块级元素尾部的 <br>
 * 15. unwrapNestedFigures  - 展平嵌套的 <figure>
 * 16. flattenNestedBold    - 展平嵌套的 <b>/<strong>
 * 17. unwrapSingleChildSpans - 展平单子元素的 <span>
 * 18. unwrapSingleChildContainers - 展平单子元素的容器
 * 19. compactHtml          - 移除元素间的空白文本节点
 * 20. convertTablesToText  - 将表格转为纯文本格式
 * 21. removeEmptyLines     - 移除只含空行或 <br> 的元素
 * 22. removeEmptyDivs      - 移除空 <div>
 * 23. removeNestedEmptyContainers - 递归移除嵌套空容器
 *
 * 【导出函数】
 * - processContent (p): 完整的内容处理管道，返回 { html, markdown }
 * - backupAndSimplifyCodeBlocks (b/Z): 简化所有 <pre> 代码块
 * - quickClean (c/Y): 快速清洗 HTML（移除常见垃圾）
 * - basicClean (a/V): 原地清洗 DOM 元素
 * - restoreCodeBlocks (r/ee): 恢复之前备份的代码块
 */

import {
    h as w   // htmlToMarkdown: HTML 转 Markdown（来自 jszip 模块）
} from "./jszip.min-DpCewD43.js";
import {
    c as B   // createLogger: 创建日志器
} from "./logger-CvfM-6aa.js";

const h = B("ContentProcessor");

// ============================================================================
// 主处理管道
// ============================================================================

/**
 * processContent - 可配置的 HTML 内容处理管道
 * @param {string} o - 原始 HTML 字符串
 * @param {Object} r - 配置选项对象
 * @returns {{ html: string, markdown: string }} 处理后的 HTML 和 Markdown
 *
 * 配置选项（均为 boolean，默认 false）:
 * - processCodeBlocks: 简化代码块
 * - removeComments: 移除注释
 * - removeIframes: 移除 iframe
 * - removeSpecialTags: 移除微信专有标签
 * - removeSpecialTagsWithParent: 连同父元素一起移除
 * - removeSvgImages: 处理 SVG 图片
 * - keepStyles: 保留 <style> 标签
 * - removeLinks: 移除链接（转为 span）
 * - keepLinkDomains: 保留包含这些域名的链接
 * - processLazyImages: 处理懒加载图片
 * - removeEmptyElements: 移除空元素
 * - removeEmptyImages: 移除空图片
 * - removeDataAttributes: 移除 data-* 属性
 * - removeSrcset / removeSizes: 移除响应式图片属性
 * - convertSectionToDiv / convertSectionToP: section 标签转换
 * - removeTrailingBr: 移除尾部 <br>
 * - unwrapNestedFigures: 展平嵌套 figure
 * - flattenNestedBold: 展平嵌套加粗标签
 * - unwrapSingleChildSpans: 展平单子 span
 * - unwrapSingleChildContainers: 展平单子容器
 * - compactHtml: 压缩空白
 * - convertTablesToText: 表格转文本
 * - removeEmptyLines / removeEmptyDivs / removeNestedEmptyContainers: 清理空元素
 */
function Q(o, r) {
    const e = document.createElement("div");
    e.innerHTML = o;

    // 按顺序执行配置的处理步骤
    r.processCodeBlocks && C(e);           // 1. 简化代码块
    r.removeComments && g(e);              // 2. 移除注释
    r.removeIframes && d(e, ["iframe"]);   // 3. 移除 iframe
    r.removeSpecialTags && (               // 4. 移除微信专有标签
        r.removeSpecialTagsWithParent
            ? (k(e, ["mpprofile", "qqmusic"]),
               d(e, ["mpvoice", "mpcps", "mp-miniprogram", "mp-common-product"]))
            : d(e, ["mpprofile", "qqmusic", "mpvoice", "mpcps", "mp-miniprogram", "mp-common-product"])
    );
    r.removeSvgImages && T(e);             // 5. 处理 SVG 图片
    // 6. 移除脚本/样式/非脚本标签
    d(e, r.keepStyles ? ["script", "noscript"] : ["script", "style", "noscript"]);
    r.removeLinks && M(e, r.keepLinkDomains);   // 7. 处理链接
    r.processLazyImages && N(e);                // 8. 处理懒加载图片
    r.removeEmptyElements && L(e);              // 9. 移除空元素
    r.removeEmptyImages && I(e);                // 10. 移除空图片
    r.removeDataAttributes && x(e);             // 11. 移除 data-* 属性
    (r.removeSrcset || r.removeSizes) && q(e, r); // 12. 移除 srcset/sizes
    r.convertSectionToDiv ? v(e, "div")         // 13a. section → div
        : r.convertSectionToP && v(e, "p");     // 13b. section → p
    r.removeTrailingBr && R(e);                 // 14. 移除尾部 <br>
    r.unwrapNestedFigures && $(e);              // 15. 展平嵌套 figure
    r.flattenNestedBold && W(e);                // 16. 展平嵌套加粗
    r.unwrapSingleChildSpans && j(e);           // 17. 展平单子 span
    r.unwrapSingleChildContainers && z(e);      // 18. 展平单子容器
    r.compactHtml && P(e);                      // 19. 压缩空白节点
    r.convertTablesToText && U(e);              // 20. 表格转文本
    r.removeEmptyLines && F(e);                 // 21. 移除空行
    r.removeEmptyDivs && X(e);                  // 22. 移除空 div
    r.removeNestedEmptyContainers && G(e);      // 23. 递归移除空容器

    // 返回处理后的 HTML 和转换的 Markdown
    const t = e.innerHTML,
        n = w(t);  // htmlToMarkdown 转换
    return {
        html: t,
        markdown: n
    }
}

// ============================================================================
// 各个处理步骤的实现
// ============================================================================

/**
 * 移除 HTML 注释节点
 * 使用 NodeIterator 遍历所有注释节点并批量删除
 */
function g(o) {
    const r = document.createNodeIterator(o, NodeFilter.SHOW_COMMENT, null),
        e = [];
    let t;
    for (; t = r.nextNode();) e.push(t);
    e.forEach(n => n.remove())
}

/**
 * 移除指定标签名的元素
 * @param {Element} o - 父容器
 * @param {string[]} r - 要移除的标签名列表
 */
function d(o, r) {
    const e = r.join(", ");
    o.querySelectorAll(e).forEach(t => t.remove())
}

/**
 * 移除指定标签及其父元素（如果父元素不是根容器）
 * 用于微信专有标签如 mpprofile，它们通常包裹在无意义的父 div 中
 */
function k(o, r) {
    const e = r.join(", ");
    o.querySelectorAll(e).forEach(t => {
        const n = t.parentElement;
        n && n !== o ? n.remove() : t.remove()
    })
}

/**
 * 处理 SVG data URI 图片
 * 如果图片有 data-src 属性（真实图片地址），则替换 src；否则直接移除
 * 常见于微信公众号文章的占位图
 */
function T(o) {
    o.querySelectorAll('img[src^="data:image/svg"]').forEach(e => {
        const t = e.getAttribute("data-src");
        t ? e.setAttribute("src", t) : e.remove()
    })
}

/**
 * 处理链接：将 <a> 标签替换为 <span>，保留文本内容
 * @param {Element} o - 父容器
 * @param {string[]} r - 要保留的域名列表（匹配的链接不会被替换）
 */
function M(o, r) {
    o.querySelectorAll("a").forEach(t => {
        var l;
        const n = t.getAttribute("href");
        // 如果链接 URL 包含保留域名，则跳过
        if (n && (r != null && r.length) && r.some(c => n.includes(c))) return;
        // 将 <a> 替换为 <span>
        const s = document.createElement("span");
        s.innerHTML = t.innerHTML;
        (l = t.parentNode) == null || l.replaceChild(s, t)
    })
}

/**
 * 处理懒加载图片
 * 尝试从 data-src / data-original / data-actualsrc / _src 等属性获取真实图片地址
 * 替换到 src 属性上，并清理所有 data-* 懒加载属性
 *
 * 支持的懒加载属性（按优先级）:
 * - data-src（最常见）
 * - data-original（知乎等）
 * - data-actualsrc
 * - _src
 */
function N(o) {
    const r = o.querySelectorAll("img"),
        e = ["data-src", "data-original", "data-actualsrc", "_src"];
    r.forEach(t => {
        for (const n of e) {
            const s = t.getAttribute(n);
            if (s && !s.startsWith("data:image/svg")) {
                // 仅当 src 为空或是 SVG 占位图时才替换
                (!t.src || t.src.startsWith("data:image/svg")) && (t.src = s);
                break
            }
        }
        // 清理所有懒加载属性
        e.forEach(n => t.removeAttribute(n))
    })
}

/**
 * 检测元素是否是行号列表（用于代码块行号移除）
 * 判断逻辑：
 * - <ul>/<ol> 中所有 <li> 内容都是连续数字（1, 2, 3...）
 * - 或所有 <li> 都为空且数量匹配
 */
function O(o, r) {
    var n;
    if (o.tagName === "UL" || o.tagName === "OL") {
        const s = o.querySelectorAll("li");
        // 空列表检测
        if (s.length >= 2 && s.length === r && Array.from(s).every(i => {
                var c;
                return !((c = i.textContent) != null && c.trim())
            })) return !0;
        // 连续数字列表检测（行号特征）
        if (s.length >= 2) {
            let l = !0;
            if (s.forEach((i, c) => {
                    var m;
                    parseInt(((m = i.textContent) == null ? void 0 : m.trim()) || "", 10) !== c + 1 && (l = !1)
                }), l) return !0
        }
    }
    // 纯文本数字行检测
    const t = (((n = o.textContent) == null ? void 0 : n.trim()) || "").split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);
    return !!(t.length >= 2 && t.every((l, i) => parseInt(l, 10) === i + 1))
}

/**
 * 移除 <pre> 元素旁边的行号列表
 * 查找相邻的兄弟元素中匹配的行号列表并移除
 */
function _(o) {
    var n;
    const r = o.parentElement;
    if (!r) return;
    const e = o.querySelectorAll("code"),
        t = e.length > 1 ? e.length : ((n = o.textContent) == null ? void 0 : n.split(`\n`).length) || 0;
    Array.from(r.children).forEach(s => {
        s !== o && O(s, t) && s.remove()
    })
}

// 允许作为代码行容器的标签名集合
const H = new Set(["CODE", "DIV", "SPAN", "P", "LI"]);

/**
 * 检测一组子元素是否都是同类型的代码行
 * 用于识别 <pre> 内的多行代码容器
 */
function D(o) {
    var t;
    if (o.length < 2) return !1;
    const r = o[0].tagName;
    if (r === "BR") return !1;
    if (H.has(r)) {
        if (!o.every(l => l.tagName === r)) return !1;
        // 如果父元素有非空文本节点，则不是纯代码行容器
        const s = o[0].parentElement;
        if (s) {
            for (const l of Array.from(s.childNodes))
                if (l.nodeType === Node.TEXT_NODE && ((t = l.textContent) != null && t.trim())) return !1
        }
        return !0
    }
    // 或者所有子元素都是 display:block 样式
    return o.every(n => {
        const s = n.getAttribute("style") || "";
        return s.includes("display:block") || s.includes("display: block")
    })
}

/**
 * 递归查找 <pre> 内的代码行容器
 * 如果 <pre> 只有一个子元素，递归深入查找
 * @param {Element} o - 要搜索的元素
 * @param {number} r - 递归深度（最大 4）
 */
function S(o, r) {
    if (r > 4) return null;
    const e = Array.from(o.children);
    return D(e) ? o : e.length === 1 ? S(e[0], r + 1) : null
}

/**
 * 查找 <pre> 内最深的代码行容器
 */
function A(o) {
    return S(o, 0)
}

/**
 * 处理代码块：简化 <pre> 元素
 * 步骤：
 * 1. 移除常见代码高亮库的行号元素（Prism.js、highlight.js 等）
 * 2. 移除相邻的行号列表
 * 3. 提取代码文本，合并多行
 * 4. 检测编程语言并设置 data-lang 和 class
 * 5. 对代码内容进行 HTML 转义
 */
function C(o) {
    // 移除各代码高亮库的行号元素
    d(o, ["ul.code-snippet__line-index", ".code-snippet__line-index", ".line-numbers-rows", ".hljs-ln-numbers", ".gutter"]);

    o.querySelectorAll("pre").forEach(e => {
        try {
            if (e.hasAttribute("data-code-simplified")) return;
            _(e);  // 移除相邻行号列表

            const t = A(e);  // 查找代码行容器
            h.debug("[processCodeBlocks] pre.innerHTML:", e.innerHTML.slice(0, 200));
            h.debug("[processCodeBlocks] linesContainer:", t?.tagName, "children:", t?.children.length);

            let n;
            if (t) {
                // 有结构化行容器：逐行提取文本
                const l = [];
                Array.from(t.children).forEach(i => {
                    const c = i.textContent || "";
                    l.push(E(c))  // HTML 转义
                });
                n = l.join(`\n`);
            } else {
                // 无结构化容器：直接获取 innerText
                const l = e.innerText || e.textContent || "";
                n = `<code>${E(l)}</code>`;
            }

            // 规范化换行符
            n = n.replace(/\r\n/g, `\n`).replace(/\r/g, `\n`).replace(/^\n+/, "").replace(/\n+$/, "");

            // 空代码块直接移除
            if (!n.trim()) {
                e.remove();
                return;
            }

            // 检测编程语言
            const s = b(e);
            e.innerHTML = n;
            e.removeAttribute("class");
            e.removeAttribute("style");
            e.removeAttribute("data-lang");
            // 设置语言标识
            if (s) {
                e.setAttribute("data-lang", s);
                e.className = `language-${s}`;
            }
        } catch (t) {
            h.error("processCodeBlocks error:", t);
        }
    });
}

/**
 * 检测代码块的编程语言
 * 依次检查 <pre> 和内部 <code> 的以下属性：
 * - data-lang 属性
 * - class 中的 language-xxx / lang-xxx / highlight-xxx 模式
 * - class 中的 code-snippet__xxx 模式（掘金等平台）
 */
function b(o) {
    const r = [o, o.querySelector("code")].filter(Boolean);
    for (const e of r) {
        const t = e.getAttribute("data-lang");
        if (t) return t.trim().toLowerCase();
        const n = e.className.match(/(?:language|lang|highlight)-(\w+)/);
        if (n) return n[1].toLowerCase();
        const s = e.className.match(/code-snippet__(\w+)/);
        if (s) return s[1].toLowerCase();
    }
    return null;
}

/**
 * 移除空图片（无 src 或 src 为当前页面 URL 的图片）
 */
function I(o) {
    o.querySelectorAll("img").forEach(r => {
        (!r.src || r.src === window.location.href) && r.remove()
    })
}

/**
 * 递归移除空元素（最多 3 轮）
 * 保留包含媒体子元素（img/video/audio/iframe/canvas/svg）的空元素
 */
function L(o) {
    for (let r = 0; r < 3; r++) {
        const e = o.querySelectorAll("p, div, section, span, figure");
        let t = 0;
        e.forEach(n => {
            var i;
            const s = (i = n.textContent)?.trim();
            const l = n.querySelector("img, video, audio, iframe, canvas, svg");
            !s && !l && (n.remove(), t++);
        });
        // 如果没有移除任何元素，提前退出
        if (t === 0) break;
    }
}

/**
 * 移除所有 data-* 属性（保留 data-src）
 */
function x(o) {
    o.querySelectorAll("*").forEach(e => {
        Array.from(e.attributes).forEach(n => {
            n.name.startsWith("data-") && n.name !== "data-src" && e.removeAttribute(n.name);
        });
    });
}

/**
 * 移除图片的 srcset、sizes、loading、decoding 属性
 */
function q(o, r) {
    o.querySelectorAll("img").forEach(t => {
        r.removeSrcset && t.removeAttribute("srcset");
        r.removeSizes && t.removeAttribute("sizes");
        t.removeAttribute("loading");
        t.removeAttribute("decoding");
    });
}

/**
 * 将 <section> 标签转换为指定标签（div 或 p）
 */
function v(o, r) {
    o.querySelectorAll("section").forEach(t => {
        var s;
        const n = document.createElement(r);
        n.innerHTML = t.innerHTML;
        Array.from(t.attributes).forEach(l => { n.setAttribute(l.name, l.value) });
        (s = t.parentNode)?.replaceChild(n, t);
    });
}

/**
 * 移除块级元素（p/div/section）尾部的 <br> 标签
 */
function R(o) {
    o.querySelectorAll("p, div, section").forEach(e => {
        var t;
        for (; ((t = e.lastElementChild)?.tagName) === "BR";) e.lastElementChild.remove();
    });
}

/**
 * 展平嵌套的加粗标签（如 <b><b>text</b></b> → text）
 * 支持 b-b / b-strong / strong-b / strong-strong 嵌套
 * 最多循环 5 次以处理深层嵌套
 */
function W(o) {
    const r = ["b b", "b strong", "strong b", "strong strong"];
    for (let e = 0; e < 5; e++) {
        let t = 0;
        for (const n of r) o.querySelectorAll(n).forEach(s => {
            const l = s.parentNode;
            if (l) {
                for (; s.firstChild;) l.insertBefore(s.firstChild, s);
                l.removeChild(s);
                t++;
            }
        });
        if (t === 0) break;
    }
}

/**
 * 展平只包含元素子节点（无直接文本）的 <span> 标签
 * 最多循环 10 次以处理深层嵌套
 */
function j(o) {
    for (let r = 0; r < 10; r++) {
        let e = 0;
        const t = Array.from(o.querySelectorAll("span"));
        for (const n of t) {
            if (!n.parentNode || n.childNodes.length === 0 || Array.from(n.childNodes).some(i => {
                    var c;
                    return i.nodeType === Node.TEXT_NODE && !!((c = i.textContent)?.trim());
                })) continue;
            const l = n.parentNode;
            for (; n.firstChild;) l.insertBefore(n.firstChild, n);
            l.removeChild(n);
            e++;
        }
        if (e === 0) break;
    }
}

/**
 * 展平嵌套的 <figure> 元素（如 figure > figure → 只保留内层）
 */
function $(o) {
    for (let r = 0; r < 5; r++) {
        const e = o.querySelectorAll("figure > figure");
        if (e.length === 0) break;
        e.forEach(t => {
            var s;
            const n = t.parentElement;
            (n?.tagName) === "FIGURE" && (n.parentNode?.replaceChild(t, n));
        });
    }
}

/**
 * 展平只包含单个子容器的 div
 * 如 <div><div>content</div></div> → <div>content</div>
 * 处理的标签: DIV / ARTICLE / P / SECTION
 */
function z(o) {
    for (let r = 0; r < 5; r++) {
        let e = 0;
        o.querySelectorAll("div").forEach(n => {
            var l;
            const s = Array.from(n.childNodes).filter(i => {
                var c;
                return i.nodeType === Node.ELEMENT_NODE || i.nodeType === Node.TEXT_NODE && ((c = i.textContent)?.trim());
            });
            if (s.length === 1 && s[0].nodeType === Node.ELEMENT_NODE) {
                const i = s[0];
                ["DIV", "ARTICLE", "P", "SECTION"].includes(i.tagName) && ((l = n.parentNode)?.replaceChild(i, n), e++);
            }
        });
        if (e === 0) break;
    }
}

/**
 * 压缩 HTML：移除两个元素节点之间的纯空白文本节点
 * 保留 <pre>/<code> 内部的空白
 */
function P(o) {
    var n;
    const r = document.createTreeWalker(o, NodeFilter.SHOW_TEXT, null),
        e = [];
    let t;
    for (; t = r.nextNode();)
        if (t.textContent && /^\s+$/.test(t.textContent)) {
            const s = t.previousSibling,
                l = t.nextSibling,
                i = t.parentNode;
            // 仅当两侧都是元素节点（非文本）且不在 pre/code 中时才移除
            if (i && !(n = i.closest)?.call(i, "pre, code") &&
                (!s || s.nodeType === Node.ELEMENT_NODE) &&
                (!l || l.nodeType === Node.ELEMENT_NODE)) {
                e.push(t);
            }
        }
    e.forEach(s => s.remove());
}

/**
 * 移除只包含空白或 <br> 的 <p> 和 <section> 元素
 */
function F(o) {
    o.querySelectorAll("p, section").forEach(e => {
        Array.from(e.childNodes).every(n => {
            var s;
            return n.nodeType === Node.TEXT_NODE ? !((s = n.textContent)?.trim()) : n.nodeType === Node.ELEMENT_NODE ? n.tagName === "BR" : !0;
        }) && e.remove();
    });
}

/**
 * 移除空的 <div> 元素（不包含媒体子元素的）
 */
function X(o) {
    o.querySelectorAll("div").forEach(e => {
        if (e.querySelector("img, video, audio, canvas, svg, iframe")) return;
        Array.from(e.childNodes).every(n => {
            var s;
            return n.nodeType === Node.TEXT_NODE ? !((s = n.textContent)?.trim()) : n.nodeType === Node.ELEMENT_NODE ? n.tagName === "BR" : !0;
        }) && e.remove();
    });
}

/**
 * 递归移除嵌套的空容器（最多 5 轮）
 * 处理 div/section/article/span 中的空嵌套
 */
function G(o) {
    for (let r = 0; r < 5; r++) {
        let e = 0;
        o.querySelectorAll("div, section, article, span").forEach(n => {
            var i;
            if (n.querySelector("img, video, audio, canvas, svg, iframe")) return;
            const s = ((i = n.textContent)?.trim()) || "";
            const l = n.children.length > 0;
            // 无文本且无子元素 → 移除
            if (!s && !l) { n.remove(); e++; return; }
            // 无文本且子元素全是 <br> → 移除
            if (!s && l && Array.from(n.children).every(a => a.tagName === "BR")) { n.remove(); e++; }
        });
        if (e === 0) break;
    }
}

/**
 * 将 HTML 表格转换为纯文本格式
 * 格式: "列头1: 值1 | 列头2: 值2 | ..."
 * 如果无表头，则直接: "值1 | 值2 | ..."
 * 每行生成一个 <p> 元素
 */
function U(o) {
    o.querySelectorAll("table").forEach(e => {
        // 提取表头
        const t = [], n = e.querySelector("thead tr");
        n && n.querySelectorAll("th, td").forEach(c => {
            var a;
            t.push(((a = c.textContent)?.trim()) || "");
        });

        // 提取表体行数据
        const s = [], l = e.querySelectorAll("tbody tr, tr");
        l.forEach(c => {
            var u;
            if ((u = c.parentElement)?.tagName === "THEAD") return;
            const a = c.querySelectorAll("td, th");
            // 如果没有 thead 且第一行全是 th，视为表头
            if (t.length === 0 && c === l[0] && Array.from(a).every(f => f.tagName === "TH")) {
                a.forEach(f => { var y; return t.push(((y = f.textContent)?.trim()) || "") });
                return;
            }
            const m = [];
            a.forEach(p => { var f; m.push(((f = p.textContent)?.trim()) || "") });
            if (m.length > 0) s.push(m);
        });

        // 生成纯文本替代元素
        const i = document.createDocumentFragment();
        if (t.length > 0) {
            // 有表头：格式为 "表头: 值"
            s.forEach(c => {
                const a = c.map((u, p) => {
                    const f = t[p] || "";
                    return f ? `${f}: ${u}` : u;
                });
                const m = document.createElement("p");
                m.textContent = a.join(" | ");
                i.appendChild(m);
            });
        } else {
            // 无表头：直接用 " | " 分隔值
            s.forEach(c => {
                const a = document.createElement("p");
                a.textContent = c.join(" | ");
                i.appendChild(a);
            });
        }
        e.replaceWith(i);
    });
}

/**
 * HTML 特殊字符转义
 */
function E(o) {
    return o.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ============================================================================
// 导出的高层 API
// ============================================================================

/**
 * basicClean (a/V) - 原地清洗 DOM 元素
 * 执行一组固定的基础清洗步骤（不可配置）
 * 用于微信公众号文章的原地清洗
 */
function V(o) {
    g(o);   // 移除注释
    d(o, ["iframe", "script", "style", "noscript"]);  // 移除危险标签
    d(o, ["mpprofile", "qqmusic", "mpvoice", "mpcps", "mp-miniprogram", "mp-common-product"]);  // 移除微信专有标签
    T(o);   // 处理 SVG 图片
    N(o);   // 处理懒加载图片
    C(o);   // 简化代码块
    L(o);   // 移除空元素
    x(o);   // 移除 data-* 属性
    q(o, { removeSrcset: !0, removeSizes: !0 });  // 移除 srcset/sizes
}

/**
 * quickClean (c/Y) - 快速清洗 HTML 字符串
 * 创建临时 div，执行 basicClean，返回清洗后的 HTML 字符串
 */
function Y(o) {
    const r = document.createElement("div");
    r.innerHTML = o;
    V(r);
    return r.innerHTML;
}

/**
 * backupAndSimplifyCodeBlocks (b/Z) - 简化所有 <pre> 代码块
 * 先隐藏行号元素，提取纯代码文本，备份原始 innerHTML
 * 返回备份数组，可通过 restoreCodeBlocks 恢复
 *
 * @param {Element} [o=document.body] - 要处理的根元素
 * @returns {Array<{element, originalHTML}>} 备份信息数组
 */
function Z(o = document.body) {
    const r = [];
    // 各代码高亮库的行号选择器
    const e = [".gutter", ".line-numbers-rows", ".hljs-ln-numbers", ".code-snippet__line-index", "ul.code-snippet__line-index", '[class*="line-number"]', '[class*="lineNumber"]'].join(", ");

    o.querySelectorAll("pre").forEach(t => {
        try {
            const n = t.innerHTML;
            // 临时隐藏行号元素
            const s = t.querySelectorAll(e);
            const l = [];
            s.forEach((m, u) => { l[u] = m.style.display; m.style.display = "none"; });

            // 查找代码行容器并提取文本
            const i = A(t);
            let c;
            if (i) {
                const m = [];
                Array.from(i.children).forEach(u => { m.push(u.textContent || "") });
                c = m.join(`\n`);
            } else {
                c = (t.querySelector("code") || t).innerText || "";
            }

            // 恢复行号元素的显示
            s.forEach((m, u) => { m.style.display = l[u]; });

            // 规范化换行
            c = c.replace(/\r\n/g, `\n`).replace(/\r/g, `\n`).replace(/^\n+/, "").replace(/\n+$/, "");
            if (!c.trim()) return;

            h.debug("[backupAndSimplifyCodeBlocks] original:", n.slice(0, 100));
            h.debug("[backupAndSimplifyCodeBlocks] cleaned text:", c.slice(0, 100));

            // 检测语言并简化
            const a = b(t);
            r.push({ element: t, originalHTML: n });
            t.innerHTML = `<code>${E(c)}</code>`;
            t.setAttribute("data-code-simplified", "true");
            if (a) { t.setAttribute("data-lang", a); t.className = `language-${a}`; }
        } catch (n) {
            h.error("[backupAndSimplifyCodeBlocks] error:", n);
        }
    });

    return r;
}

/**
 * restoreCodeBlocks (r/ee) - 恢复之前备份的代码块
 * 将原始 innerHTML 还原回 <pre> 元素
 */
function ee(o) {
    o.forEach(({ element: r, originalHTML: e }) => {
        r.innerHTML = e;
    });
}

// 导出函数映射
export {
    V as a,   // basicClean
    Z as b,   // backupAndSimplifyCodeBlocks
    Y as c,   // quickClean
    Q as p,   // processContent
    ee as r   // restoreCodeBlocks
};
