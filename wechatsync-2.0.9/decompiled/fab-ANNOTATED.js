/**
 * ============================================================================
 * WechatSync v2.0.9 - FAB (Floating Action Button) 模块 (fab-W2bspDnB.beautified.js)
 * ============================================================================
 *
 * 【模块概述】
 * 悬浮同步按钮组件。在支持的网页（如微信公众号文章页）右下角显示一个绿色的
 * "同步" 按钮，用户点击后触发文章提取和跨平台同步流程。
 *
 * 【视觉设计】
 * - 绿色渐变圆角按钮（#07c160 → #06ad56），与微信品牌色一致
 * - 包含同步图标（SVG 循环箭头）和 "同步" 文字
 * - 首次出现时播放 3 次脉冲动画（pulse），吸引用户注意
 * - 鼠标悬停时放大 1.05 倍，显示 tooltip "点击同步文章到多平台"
 *
 * 【触发机制】
 * 1. 由 weixin.ts 或 extractor.ts 内容脚本在检测到可同步文章后创建
 * 2. 通过 createFab({ onClick }) 工厂函数创建 DOM 元素
 * 3. 调用方将返回的元素 append 到 document.body
 *
 * 【z-index 策略】
 * 使用 2147483646（接近 32 位有符号整数最大值），确保浮于所有页面元素之上
 * 同步对话框使用 2147483647，比 FAB 高一层
 *
 * 【导出】
 * - createFab (别名 c): 工厂函数，参数为 { onClick: Function, bottom?: string }
 */

// CSS 脉冲动画：按钮首次出现时闪烁 3 次吸引注意力
const r = `
  @keyframes wcs-pulse {
    0%, 100% { box-shadow: 0 4px 12px rgba(7,193,96,0.35); }
    50% { box-shadow: 0 4px 20px rgba(7,193,96,0.6), 0 0 0 8px rgba(7,193,96,0.1); }
  }
`;

/**
 * 创建悬浮同步按钮
 * @param {Object} n - 配置对象
 * @param {Function} n.onClick - 点击按钮的回调函数
 * @param {string} [n.bottom="88px"] - 按钮距底部的距离
 * @returns {HTMLDivElement} 创建的 FAB DOM 元素
 */
function p(n) {
    const {
        onClick: a,
        bottom: i = "88px"
    } = n, t = document.createElement("div");

    // 设置 FAB 的 ID、标题和内联样式
    t.id = "wechatsync-fab";
    t.title = "同步文章";
    t.style.cssText = `
    position: fixed !important;
    right: 24px !important;
    bottom: ${i} !important;
    height: 40px !important;
    padding: 0 16px !important;
    border-radius: 20px !important;
    background: linear-gradient(135deg, #07c160 0%, #06ad56 100%) !important;
    box-shadow: 0 4px 12px rgba(7, 193, 96, 0.35) !important;
    cursor: pointer !important;
    z-index: 2147483646 !important;
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s !important;
    user-select: none !important;
    color: white !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    border: none !important;
  `;

    // 按钮内容：同步图标 SVG + "同步" 文字
    t.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
    </svg>
    <span style="color:white;font-size:14px;font-weight:500;">同步</span>
  `;

    // 注入脉冲动画样式到页面 <head>
    const e = document.createElement("style");
    e.textContent = r;
    document.head.appendChild(e);
    // 播放 3 次脉冲动画（每次 1.2 秒）
    t.style.animation = "wcs-pulse 1.2s ease-in-out 3";

    // 创建悬停提示气泡："点击同步文章到多平台"
    const o = document.createElement("div");
    o.textContent = "点击同步文章到多平台";
    o.style.cssText = `
    position: absolute !important;
    right: 100% !important;
    top: 50% !important;
    transform: translateY(-50%) !important;
    margin-right: 10px !important;
    padding: 6px 12px !important;
    background: rgba(0,0,0,0.75) !important;
    color: white !important;
    font-size: 12px !important;
    border-radius: 6px !important;
    white-space: nowrap !important;
    pointer-events: none !important;
    opacity: 0 !important;
    transition: opacity 0.2s !important;
  `;
    t.appendChild(o);

    // 鼠标悬停交互：放大按钮 + 增强阴影 + 显示提示气泡
    t.addEventListener("mouseenter", () => {
        t.style.transform = "scale(1.05)";
        t.style.boxShadow = "0 6px 20px rgba(7, 193, 96, 0.45)";
        o.style.opacity = "1";
    });

    // 鼠标离开：恢复原始状态
    t.addEventListener("mouseleave", () => {
        t.style.transform = "scale(1)";
        t.style.boxShadow = "0 4px 12px rgba(7, 193, 96, 0.35)";
        o.style.opacity = "0";
    });

    // 绑定点击回调
    t.addEventListener("click", a);

    return t;
}

// 导出 createFab 工厂函数
export {
    p as c
};
