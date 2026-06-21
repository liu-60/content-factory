/**
 * ============================================================================
 * WechatSync v2.0.9 - Preprocessor 模块 (preprocessor-n7jhDIUx.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 内容脚本预处理器，注入到网页中，负责在发送文章到各平台之前，
 * 对原始 HTML 进行平台特定的清洗和转换。
 *
 * 【工作流程】
 * 1. 监听来自 background/popup 的 "PREPROCESS_FOR_PLATFORMS" 消息
 * 2. 接收原始 HTML 和目标平台列表及各平台的配置（configs）
 * 3. 对每个平台，调用 content-processor 的 processContent() 函数，
 *    根据该平台的配置（如是否移除链接、是否转换表格等）进行定制化处理
 * 4. 如果某个平台没有配置，则使用默认清洗流程（backupAndSimplifyCodeBlocks + 基础清洗）
 * 5. 返回各平台对应的处理后 HTML 和 Markdown
 *
 * 【关键依赖】
 * - content-processor 模块: processContent(p) 和 backupAndSimplifyCodeBlocks(f)
 * - jszip 模块中的 htmlToMarkdown(h) 函数
 *
 * 【导出】无（纯消息监听器模块）
 */

// 导入模块依赖
import "./modulepreload-polyfill-B5Qt9EMX.js";
import {
    p as c,   // processContent: 可配置的内容处理管道
    a as f     // backupAndSimplifyCodeBlocks: 代码块简化的回退方案
} from "./content-processor-COHfnfLF.js";
import {
    h as l     // htmlToMarkdown: HTML 转 Markdown
} from "./jszip.min-DpCewD43.js";
import "./logger-CvfM-6aa.js";
import "./_commonjsHelpers-BosuxZz1.js";

/**
 * 监听来自 background 或 popup 的消息
 *
 * 消息类型: PREPROCESS_FOR_PLATFORMS
 * payload: {
 *   rawHtml: string,           // 原始文章 HTML
 *   platforms: string[],       // 目标平台 ID 列表，如 ["zhihu", "juejin", "csdn"]
 *   configs: {                 // 各平台的处理配置
 *     [platformId]: {
 *       processCodeBlocks: boolean,
 *       removeComments: boolean,
 *       removeLinks: boolean,
 *       convertTablesToText: boolean,
 *       ... (详见 content-processor 模块的配置项)
 *     }
 *   }
 * }
 *
 * 响应: {
 *   platformContents: {
 *     [platformId]: {
 *       html: string,          // 处理后的 HTML
 *       markdown: string       // 转换后的 Markdown
 *     }
 *   }
 * }
 */
chrome.runtime.onMessage.addListener((e, d, a) => {
    if (e.type === "PREPROCESS_FOR_PLATFORMS") {
        const {
            rawHtml: n,
            platforms: i,
            configs: p
        } = e.payload, o = {};

        // 遍历每个目标平台，根据配置进行定制化内容处理
        for (const t of i) {
            const s = p[t];
            if (s) {
                // 有平台特定配置：使用 processContent 管道处理
                o[t] = c(n, s);
            } else {
                // 无平台特定配置：使用默认的基础清洗流程
                const r = document.createElement("div");
                r.innerHTML = n;
                // 基础清洗：移除注释、iframe、脚本、特殊标签、SVG 图片、懒加载图片、代码块简化等
                f(r);
                const m = r.innerHTML;
                o[t] = {
                    html: m,
                    markdown: l(m)  // 同时生成 Markdown 版本
                }
            }
        }

        // 返回各平台处理后的内容
        a({
            platformContents: o
        })
    }
    return !1  // 不保持消息通道（同步响应）
});
