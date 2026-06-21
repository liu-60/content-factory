/**
 * ============================================================================
 * WechatSync v2.0.9 - Logger 模块 (logger-CvfM-6aa.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 轻量级日志系统，支持分级日志（debug / info / warn / error）。
 * 日志级别可通过 chrome.storage.local 中的 "loggerConfig" 键动态配置。
 * 每个模块通过 createLogger("模块名") 创建带前缀的日志实例。
 *
 * 【配置机制】
 * - 启动时异步读取 chrome.storage.local 中的 loggerConfig
 * - 默认级别为 "warn"，即只输出 warn 和 error
 * - 可通过设置 { level: "debug", enabled: true } 开启全量调试日志
 *
 * 【导出】
 * - createLogger (别名 c): 工厂函数，创建带命名空间的日志器
 */

// 日志级别枚举：数字越大，优先级越高
const l = {
    debug: 0,  // 最低级别，调试信息
    info: 1,   // 一般信息
    warn: 2,   // 警告信息
    error: 3   // 错误信息（最高级别）
};

// 全局日志配置，默认为启用状态，级别为 warn
let n = {
    enabled: !0,    // 是否启用日志
    level: "warn"   // 当前日志级别阈值
};

/**
 * 异步加载持久化的日志配置
 * 从 chrome.storage.local 读取 "loggerConfig" 键
 * 合并到全局配置 n 中
 */
async function g() {
    try {
        const e = await chrome.storage.local.get("loggerConfig");
        e.loggerConfig && (n = {
            ...n,
            ...e.loggerConfig
        })
    } catch {}
}
// 模块加载时立即异步读取配置（不阻塞）
g();

/**
 * 创建命名日志器
 * @param {string} e - 模块名称，会作为日志前缀显示，如 "[ContentProcessor]"
 * @returns {Object} 包含 debug/info/warn/error 四个方法的日志器对象
 *
 * 使用示例:
 *   const log = createLogger("WeixinEditor");
 *   log.debug("Extracting article...");  // 输出: [WeixinEditor] Extracting article...
 *   log.error("Failed:", err);           // 输出: [WeixinEditor] Failed: Error...
 */
function t(e) {
    // 判断给定级别是否应该输出
    const r = o => n.enabled ? l[o] >= l[n.level] : !1;
    return {
        debug: (...o) => {
            r("debug") && console.log(`[${e}]`, ...o)
        },
        info: (...o) => {
            r("info") && console.log(`[${e}]`, ...o)
        },
        warn: (...o) => {
            r("warn") && console.warn(`[${e}]`, ...o)
        },
        error: (...o) => {
            r("error") && console.error(`[${e}]`, ...o)
        }
    }
}

// 导出 createLogger 函数（在打包中被别名为 c）
export {
    t as c
};
