/**
 * ============================================================================
 * WechatSync v2.0.9 - Extractor 模块 (extractor.ts-ysAklU8v.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 通用内容提取器，是整个 WechatSync 扩展最核心、最复杂的模块（约 198KB）。
 * 负责从任意网页中提取文章正文内容，支持多种提取策略和特定平台的专用提取器。
 *
 * 【架构概览】
 *
 *                    Nt() 主入口
 *                       │
 *          ┌────────────┼────────────┐
 *          │            │            │
 *     微信页面?    飞书页面?    其他平台?
 *     └─Kt()    └─Zt()     └─re()+ne()
 *          │            │            │
 *          └────────────┴─────┬──────┘
 *                             │
 *                         oe() 通用提取
 *                             │
 *              ┌──────────────┼──────────────┐
 *              │              │              │
 *         Safari Reader   Defuddle     Readability
 *         (Gt/Wt)         (Jt)         (Xt)
 *              │              │              │
 *              └──────────────┼──────────────┘
 *                             │
 *                      bt() 评分比较
 *                             │
 *                      选取得分最高的结果
 *                             │
 *                      回退: <article> 标签
 *
 * 【核心提取策略】
 *
 * 1. 平台专用提取器 (re + ne):
 *    - 检查当前域名是否在已知平台列表中
 *    - 如果是，使用平台专用的提取逻辑
 *
 * 2. 微信文章提取 (Kt):
 *    - 从 #activity-name 提取标题
 *    - 从 #js_content 提取内容
 *    - 从 og:image / og:description 提取封面和摘要
 *
 * 3. 飞书文档提取 (Zt):
 *    - 通过 fetch 获取页面 HTML
 *    - 解析 clientVars JSON 提取文档内容
 *
 * 4. 通用提取器 (oe) - 三路竞争:
 *    a. Safari Reader (Gt): 基于 Apple 的 Safari Reader 算法
 *    b. Defuddle (Jt): 基于 Defuddle 库（本文件主体），综合评分+选择器
 *    c. Readability (Xt): 基于 Mozilla 的 Readability 算法
 *    - 三者并行提取，通过 bt() 评分函数选取得分最高的结果
 *    - 最终回退: 直接提取 <article> 标签内容 (Vt)
 *
 * 【Defuddle 库（本文件主体，约 5000 行）】
 *
 * Defuddle 是一个类似 Readability 的内容提取库，核心流程：
 *
 * 1. 预处理:
 *    - 提取 Schema.org 结构化数据 (JSON-LD)
 *    - 收集 Meta 标签信息
 *    - 评估 CSS 媒体查询（移动端样式）
 *    - 展平 Shadow DOM
 *    - 解析 React Suspense 流式内容
 *
 * 2. 内容查找 (findMainContent):
 *    - 入口元素优先级: #post > .article-content > article > main > #content > body
 *    - 候选元素评分 (ContentScorer):
 *      + 正面信号: 段落数、文本长度、<p>标签密度
 *      - 负面信号: 链接密度、短文本、表单元素
 *
 * 3. 噪声移除:
 *    a. 隐藏元素: display:none / visibility:hidden / opacity:0
 *    b. 精确选择器匹配 (EXACT_SELECTORS):
 *       - 广告、导航、页眉页脚、侧边栏、评论区、社交分享等
 *       - 约 200+ 个 CSS 选择器
 *    c. 部分选择器匹配 (PARTIAL_SELECTORS):
 *       - 约 500+ 个 class/id 关键词模式匹配
 *       - 如 "article-author", "sidebar", "newsletter" 等
 *    d. 内容评分移除 (ContentScorer):
 *       - 对剩余元素评分，移除低分元素
 *    e. 内容模式移除 (removeByContentPattern):
 *       - 日期/阅读时间元数据
 *       - 博客分类/标签列表
 *       - 面包屑导航
 *    f. 小图片移除: 宽高 < 33px 的图片
 *
 * 4. 内容标准化 (standardizeContent):
 *    - 移除 HTML 注释
 *    - H1 → H2 降级
 *    - 代码块格式化
 *    - 脚注标准化
 *    - LaTeX 数学公式保留
 *    - YouTube 嵌入转换
 *
 * 5. 安全清理 (_stripUnsafeElements):
 *    - 移除 script/style/noscript
 *    - 移除事件处理器属性 (on*)
 *    - 移除危险 URL (javascript:, data:)
 *
 * 【ExtractorRegistry - 特定平台提取器注册表】
 *
 * 注册的平台提取器:
 * - Twitter/X (XArticleExtractor, TwitterExtractor, XOembedExtractor)
 * - Reddit (RedditExtractor)
 * - YouTube (YoutubeExtractor)
 * - Hacker News (HackerNewsExtractor)
 * - ChatGPT (ChatGPTExtractor) - 对话提取
 * - Claude (ClaudeExtractor) - 对话提取
 * - Grok (GrokExtractor) - 对话提取
 * - Gemini (GeminiExtractor) - 对话提取
 * - GitHub (GitHubExtractor)
 *
 * 提取器基类层次:
 * - BaseExtractor: 基础类，提供 canExtract/extract 接口
 * - ConversationExtractor: 对话类提取器基类
 *   提取消息列表 → 构建 HTML → Defuddle 清理
 *
 * 【编辑器 UI 管理】
 *
 * 本模块还管理全屏编辑器 UI 的生命周期:
 * - createFloatingButton (Ot): 创建悬浮同步按钮
 * - removeFloatingButton (ae): 移除悬浮按钮
 * - openEditor (le): 创建全屏 iframe 编辑器
 * - sendDataToEditor (qt): 向编辑器发送文章和平台数据
 * - closeEditor (ce): 关闭编辑器
 *
 * 【消息监听】
 *
 * chrome.runtime.onMessage:
 * - EXTRACT_ARTICLE: 提取当前页面文章（非微信页面时）
 * - OPEN_EDITOR: 提取文章并打开全屏编辑器
 * - PREPROCESS_FOR_PLATFORMS: 为各平台预处理内容
 * - SYNC_PROGRESS / SYNC_DETAIL_PROGRESS / SYNC_COMPLETE / SYNC_ERROR:
 *   转发同步进度到编辑器 iframe
 *
 * window.addEventListener("message"):
 * - CLOSE_EDITOR: 关闭编辑器
 * - START_SYNC: 从编辑器发起同步（先预处理内容）
 */

// ============================================================================
// 导入依赖
// ============================================================================

import { c as It, g as Pt } from "./_commonjsHelpers-BosuxZz1.js";
import { c as Mt } from "./logger-CvfM-6aa.js";
import { h as ct } from "./jszip.min-DpCewD43.js";  // htmlToMarkdown
import {
    p as Dt,   // processContent
    a as ft,   // basicClean
    b as St,   // backupAndSimplifyCodeBlocks
    r as ut    // restoreCodeBlocks
} from "./content-processor-COHfnfLF.js";
import { c as Ht } from "./fab-W2bspDnB.js";  // createFab

// ============================================================================
// 选择器常量 (模块 640)
// ============================================================================

/**
 * 入口元素选择器列表（按优先级排列）
 * 用于 findMainContent 中查找文章主内容容器
 */
// ENTRY_POINT_ELEMENTS = [
//     "#post", ".post-content", ".post-body",
//     ".article-content", "#article-content", ".article_post",
//     ".article-wrapper", ".entry-content", ".content-article",
//     ".instapaper_body", ".post", ".markdown-body",
//     "article", '[role="article"]', "main", '[role="main"]',
//     "#content", "body"
// ]

/**
 * 精确选择器列表（约 200+ 个）
 * 匹配到的元素会被直接移除（噪声元素）
 * 包括: 广告、导航、页头页脚、侧边栏、评论区、社交按钮等
 */
// EXACT_SELECTORS = ["noscript", "script", ".ad", "header", "nav",
//     "footer", ".sidebar", ".comments", "#newsletter", ...]

/**
 * 部分选择器模式（约 500+ 个）
 * 通过 class/id 属性中的关键词匹配来识别噪声元素
 * 如: "article-author", "sidebar-item", "newsletter-signup" 等
 */
// PARTIAL_SELECTORS = ["author-bio", "sidebar", "newsletter", "comments", ...]

// ============================================================================
// Defuddle 核心类 (模块 628)
// ============================================================================

/**
 * Defuddle - 内容提取引擎
 *
 * 使用方式:
 *   const result = new Defuddle(document, options).parse();
 *   // result = { content, title, description, domain, favicon, image,
 *   //            language, published, author, site, wordCount, parseTime }
 *
 * 关键方法:
 * - parse(): 主解析入口（带自动重试逻辑）
 * - parseInternal(): 内部解析实现
 * - findMainContent(): 查找文章主内容容器
 * - removeHiddenElements(): 移除隐藏元素
 * - removeBySelector(): 按选择器移除噪声
 * - removeByContentPattern(): 按内容模式移除
 */

// class Defuddle {
//     parse() {
//         let r = this.parseInternal();
//
//         // 重试策略1: 如果提取内容太少（< 200 词），不使用部分选择器重试
//         if (r.wordCount < 200) {
//             const a = this.parseInternal({ removePartialSelectors: false });
//             if (a.wordCount > 2 * r.wordCount) r = a;
//         }
//
//         // 重试策略2: 如果仍然很少（< 50 词），不移除隐藏元素重试
//         if (r.wordCount < 50) {
//             const a = this.parseInternal({ removeHiddenElements: false });
//             if (a.wordCount > 2 * r.wordCount) r = a;
//             // 尝试找到最大的隐藏内容区域
//             const d = this.findLargestHiddenContentSelector();
//             if (d) { /* 使用该内容选择器重试 */ }
//         }
//
//         // 重试策略3: 如果仍不够，关闭所有评分/选择器移除
//         if (r.wordCount < 50) {
//             const a = this.parseInternal({
//                 removeLowScoring: false,
//                 removePartialSelectors: false,
//                 removeContentPatterns: false
//             });
//             if (a.wordCount > r.wordCount) r = a;
//         }
//
//         // 安全清理
//         this._stripUnsafeElements();
//
//         // 如果 Schema.org 文本比提取内容更多，使用 Schema.org 文本
//         const o = this._getSchemaText(r.schemaOrgData);
//         if (o && this.countHtmlWords(o) > r.wordCount) {
//             const a = this._findContentBySchemaText(o);
//             if (a) r.content = a;
//         }
//
//         return r;
//     }
// }

// ============================================================================
// 内容评分器 (ContentScorer, 模块 968)
// ============================================================================

/**
 * ContentScorer - 对 DOM 元素进行内容相关性评分
 *
 * 正面信号:
 * - 段落数量多
 * - 文本长度长
 * - class/id 包含 "content", "article", "post" 等关键词
 * - 包含 <pre>, <table> 等内容元素
 *
 * 负面信号:
 * - 链接密度高（导航/列表页特征）
 * - class/id 包含 "sidebar", "comment", "footer" 等关键词
 * - 卡片网格布局（多个短标题 + 多图片）
 * - 包含日期/作者/标签等元数据
 */

// class ContentScorer {
//     static isLikelyContent(n) {
//         // 通过 role/class/id/文本长度/段落密度判断
//     }
//     static scoreNonContentBlock(n) {
//         // 对非内容块评分（用于移除决策）
//     }
//     static isCardGrid(n, wordCount) {
//         // 检测是否为卡片网格布局（首页/列表页特征）
//     }
// }

// ============================================================================
// ExtractorRegistry - 特定平台提取器注册表 (模块 917)
// ============================================================================

/**
 * 提取器注册表
 * 在 initialize() 中注册所有已知平台的提取器
 *
 * 匹配逻辑:
 * - 字符串模式: 检查 URL hostname 是否包含该字符串
 * - 正则模式: 对完整 URL 进行正则匹配
 *
 * 注册的平台:
 * - x.com / twitter.com → XArticleExtractor, TwitterExtractor, XOembedExtractor
 * - reddit.com → RedditExtractor
 * - youtube.com / youtu.be → YoutubeExtractor
 * - news.ycombinator.com → HackerNewsExtractor
 * - chatgpt.com → ChatGPTExtractor
 * - claude.ai → ClaudeExtractor
 * - grok.com → GrokExtractor
 * - gemini.google.com → GeminiExtractor
 * - github.com → GitHubExtractor
 */

// class ExtractorRegistry {
//     static mappings = [];
//     static initialize() { /* 注册所有提取器 */ }
//     static register({ patterns, extractor }) { /* 添加映射 */ }
//     static findExtractor(doc, url, schemaOrgData, options) {
//         // 根据 URL 查找匹配的提取器
//         // 返回 canExtract() 为 true 的提取器实例
//     }
// }

// ============================================================================
// BaseExtractor 和 ConversationExtractor (模块 279, 181)
// ============================================================================

/**
 * BaseExtractor - 提取器基类
 * 构造函数: (document, url, schemaOrgData, options)
 * 接口方法:
 * - canExtract(): boolean - 是否能提取当前页面
 * - extract(): { contentHtml, variables } - 执行提取
 */

/**
 * ConversationExtractor - 对话类提取器基类
 * 继承 BaseExtractor，专门处理 AI 对话页面
 *
 * 提取流程:
 * 1. extractMessages() → [{author, content, metadata, timestamp}]
 * 2. getMetadata() → {title, site, description}
 * 3. createContentHtml(messages, footnotes) → HTML 字符串
 * 4. 使用 Defuddle 清理生成的 HTML
 *
 * 生成的 HTML 结构:
 * <div class="message message-{author}">
 *   <div class="message-header"><strong>{Author}</strong></div>
 *   <div class="message-content">{content}</div>
 * </div>
 * <hr>
 * ...
 */

// ============================================================================
// 具体平台提取器示例
// ============================================================================

/**
 * ChatGPTExtractor (模块 632)
 * - canExtract: 检测 article[data-testid^="conversation-turn-"] 元素
 * - extractMessages: 从每个 conversation-turn 提取作者角色和消息内容
 * - 处理引用链接为脚注格式
 * - 清理零宽字符和空段落
 */

/**
 * ClaudeExtractor (模块 397)
 * - canExtract: 检测 div[data-testid="user-message"] 和 div.font-claude-response
 * - 区分用户消息和 Claude 回复
 */

// ============================================================================
// 通用提取器函数
// ============================================================================

const xt = Mt("Extractor");

/**
 * gt - 移除 WechatSync UI 元素
 * 在提取前清理页面上的 FAB 和编辑器等注入元素
 */
function gt(q) {
    q.querySelectorAll("[data-wechatsync-ui]").forEach(x => x.remove());
}

/**
 * vt - 移除空元素的基础清洗
 */
function vt(q) { /* 移除空 p/div/span 等 */ }

/**
 * Safari Reader 提取 (Gt/Wt)
 * 基于 Apple Safari Reader 算法的 JavaScript 实现
 * 返回: { title, content, textContent, excerpt, byline, siteName, ... }
 */

/**
 * Defuddle 提取 (Jt)
 * 使用 Defuddle 库进行提取
 * 克隆文档 → 移除 UI 元素 → Defuddle.parse() → 清洗 → 提取封面
 */
function Jt() {
    try {
        const q = document.cloneNode(!0);
        q.querySelectorAll("[data-wechatsync-ui]").forEach(x => x.remove());
        const O = new Defuddle(q, {
            standardize: !1,
            url: window.location.href
        }).parse();
        if (!O.content) return null;
        const j = document.createElement("div");
        j.innerHTML = O.content;
        gt(j); vt(j);
        return {
            title: O.title || document.title,
            content: j.innerHTML,
            textContent: j.textContent || void 0,
            excerpt: O.description || void 0,
            byline: O.author || void 0,
            siteName: O.site || void 0,
            leadingImage: /* 最大图片 */,
            extractor: "defuddle"
        };
    } catch (q) { return null; }
}

/**
 * Readability 提取 (Xt)
 * 基于 Mozilla Readability 算法
 */
function Xt() {
    try {
        const q = document.cloneNode(!0);
        q.querySelectorAll("[data-wechatsync-ui]").forEach(B => B.remove());
        const O = new Readability(q).parse();
        if (!O) return null;
        // 清洗 + 返回
        return {
            title: O.title || document.title,
            content: /* cleaned HTML */,
            extractor: "readability"
        };
    } catch (q) { return null; }
}

/**
 * <article> 标签回退提取 (Vt)
 * 当所有提取器都失败时，直接获取 <article> 标签内容
 */
function Vt() {
    const q = document.querySelector("article");
    if (!q) return null;
    // 克隆 + 清洗 + 返回
    return { title: document.title, content: O.outerHTML, extractor: "article-tag" };
}

/**
 * bt - 提取结果评分函数
 * 对提取结果进行评分，用于选择最佳结果
 *
 * 评分因素:
 * - 文本长度（正比）
 * - 段落密度（正比）
 * - 图片数量（适量加分）
 * - 链接密度（反比）
 */

/**
 * Yt - 通用提取入口（三路竞争 + 回退）
 *
 * 执行三个提取器，评分后选取得分最高的结果
 * 如果都失败，使用 <article> 标签作为回退
 */
function Yt() {
    // 保存/隐藏 UI → 三路提取 → 评分比较 → 恢复 UI
    const O = Gt();   // Safari Reader
    const j = Jt();   // Defuddle
    const G = Xt();   // Readability

    const U = [];
    if (O) U.push({ result: O, score: bt(O) });
    if (j) U.push({ result: j, score: bt(j) });
    if (G) U.push({ result: G, score: bt(G) });

    if (U.length > 0) {
        U.sort((N, M) => M.score - N.score);
        return U[0].result;  // 返回得分最高的
    }

    const B = Vt();  // article 标签回退
    return B || null;
}

// ============================================================================
// 主入口函数
// ============================================================================

/**
 * Nt() - 文章提取主入口
 *
 * 路由逻辑:
 * 1. 微信公众号页面 → Kt() 专用提取
 * 2. 飞书文档 → Zt() 专用提取（异步，需要 fetch）
 * 3. 已知平台 → re() + ne() 平台提取器
 * 4. 通用网页 → oe()（三路竞争提取）
 */
async function Nt() {
    // 微信公众号文章
    if (window.location.href.includes("mp.weixin.qq.com")) return Kt();

    // 飞书文档
    if (window.location.hostname.endsWith(".feishu.cn") ||
        window.location.hostname.endsWith(".larksuite.com")) {
        const O = await Zt();
        if (O) return O;
    }

    // 已知平台提取器
    const I = re(window.location.hostname);
    if (I) {
        const O = ne(I);
        if (O) return O;
    }

    // 通用提取
    return oe();
}

/**
 * Kt() - 微信公众号文章提取
 * 从 #activity-name 获取标题，#js_content 获取内容
 * 使用 content-processor 进行清洗
 */

/**
 * Zt() - 飞书文档提取（异步）
 * 通过 fetch 获取页面 → 解析 clientVars JSON → 提取文档内容
 * clientVars 是飞书页面中嵌入的客户端初始化数据
 */

// ============================================================================
// 编辑器 UI 管理
// ============================================================================

/**
 * 悬浮按钮管理
 */
let mt = null;  // FAB 元素引用

function Ot() {
    // 创建悬浮按钮
    // 使用 createFab() 创建，绑定点击事件
    // 点击后: 显示加载动画 → 提取文章 → 打开编辑器
}

function ae() {
    // 移除悬浮按钮
    if (mt) { mt.remove(); mt = null; }
}

// 根据用户设置决定是否显示悬浮按钮
chrome.storage.local.get("floatingButtonEnabled", q => {
    if (q.floatingButtonEnabled) Ot();
});

// 监听设置变化
chrome.storage.onChanged.addListener(q => {
    if (q.floatingButtonEnabled) {
        q.floatingButtonEnabled.newValue ? Ot() : ae();
    }
});

/**
 * 全屏编辑器管理
 */
let et = null,   // iframe 元素
    at = null;   // 编辑器容器

/**
 * le - 打开全屏编辑器
 * 创建全屏 iframe 加载 src/editor/index.html
 * 等待 EDITOR_READY 消息后发送文章和平台数据
 */
function le(q, I, O) {
    // 创建全屏容器 (position:fixed, z-index:2147483647)
    at = document.createElement("div");
    at.id = "wechatsync-editor-container";
    // 创建 iframe
    et = document.createElement("iframe");
    et.src = chrome.runtime.getURL("src/editor/index.html");
    // 等待 EDITOR_READY 后发送数据
}

/**
 * qt - 向编辑器发送数据
 * 发送 ARTICLE_DATA 和 PLATFORMS_DATA
 */
function qt(q, I, O) {
    et?.contentWindow?.postMessage(JSON.stringify({
        type: "ARTICLE_DATA",
        article: {
            title: q.title,
            content: q.html || q.markdown,
            cover: q.cover,
            url: q.source.url,
            extractor: q.source.platform
        }
    }), "*");
    et?.contentWindow?.postMessage(JSON.stringify({
        type: "PLATFORMS_DATA",
        platforms: I,
        selectedPlatformIds: O
    }), "*");
}

/**
 * ce - 关闭编辑器
 */
function ce() {
    if (at) { at.remove(); at = null; et = null; document.body.style.overflow = ""; }
}

// ============================================================================
// 平台内容预处理
// ============================================================================

/**
 * Rt - 为各平台预处理 HTML 内容
 * 根据各平台的配置（configs）对 HTML 进行定制化清洗
 * 返回: { [platformId]: { html, markdown } }
 */
function Rt(q, I, O) {
    const j = {};
    for (const G of I) {
        const U = O[G];
        if (U) {
            j[G] = Dt(q, U);  // processContent with config
        } else {
            const B = document.createElement("div");
            B.innerHTML = q;
            ft(B);  // basicClean
            const x = B.innerHTML;
            j[G] = { html: x, markdown: ct(x) };
        }
    }
    return j;
}

// ============================================================================
// 消息监听
// ============================================================================

/**
 * iframe 编辑器消息处理
 */
window.addEventListener("message", async q => {
    try {
        const I = typeof q.data == "string" ? JSON.parse(q.data) : q.data;
        if (I.type === "CLOSE_EDITOR") {
            ce();
        } else if (I.type === "START_SYNC") {
            // 先预处理各平台内容，再发起同步
            const O = I.article.content || "";
            const j = I.platforms || [];
            const G = await chrome.runtime.sendMessage({
                type: "GET_PREPROCESS_CONFIGS", platforms: j
            });
            const U = G?.configs || {};
            const B = Rt(O, j, U);  // 预处理
            chrome.runtime.sendMessage({
                type: "START_SYNC_FROM_EDITOR",
                article: { ...I.article, html: O, markdown: ct(O), platformContents: B },
                platforms: j,
                syncId: I.syncId
            });
        }
    } catch (I) {}
});

/**
 * Background 消息处理
 */
chrome.runtime.onMessage.addListener((q, I, O) => {
    if (q.type === "EXTRACT_ARTICLE") {
        // 提取文章（跳过微信页面，由 weixin.ts 处理）
        const x = window.location.href;
        if (x.includes("mp.weixin.qq.com/cgi-bin/appmsg") || x.includes("mp.weixin.qq.com/s"))
            return !1;
        const N = Et();  // 显示加载动画
        Nt().then(M => { N.remove(); O({ article: M }); })
            .catch(() => { N.remove(); O({ article: null }); });
        return !0;
    }
    if (q.type === "OPEN_EDITOR") {
        // 提取文章 + 打开编辑器
        Nt().then(N => {
            N ? (le(N, q.platforms, q.selectedPlatforms), O({ success: !0 }))
              : O({ success: !1, error: "无法提取文章内容" });
        });
        return !0;
    }
    if (q.type === "PREPROCESS_FOR_PLATFORMS") {
        const { rawHtml: x, platforms: N, configs: M } = q.payload;
        O({ platformContents: Rt(x, N, M) });
    }
    // 同步进度转发到编辑器 iframe
    if (q.type === "SYNC_PROGRESS")
        et?.contentWindow?.postMessage(JSON.stringify({ type: "SYNC_PROGRESS", result: q.result, syncId: q.syncId }), "*");
    if (q.type === "SYNC_DETAIL_PROGRESS")
        et?.contentWindow?.postMessage(JSON.stringify({ type: "SYNC_DETAIL_PROGRESS", progress: q.payload, syncId: q.syncId }), "*");
    if (q.type === "SYNC_COMPLETE")
        et?.contentWindow?.postMessage(JSON.stringify({ type: "SYNC_COMPLETE", rateLimitWarning: q.rateLimitWarning, syncId: q.syncId }), "*");
    if (q.type === "SYNC_ERROR")
        et?.contentWindow?.postMessage(JSON.stringify({ type: "SYNC_ERROR", error: q.error, syncId: q.syncId }), "*");
    return !0;
});
