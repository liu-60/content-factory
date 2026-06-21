/**
 * ============================================================================
 * inject-api.beautified.js — 页面注入层 API（运行在网页上下文 / Main World）
 * ============================================================================
 *
 * 【架构位置】
 *   网页 JS 上下文 (Main World)
 *       ↕ window.postMessage（事件 ID 回调模式）
 *   Content Script（api.ts-CHQebYkU.js，隔离世界 / Isolated World）
 *       ↕ chrome.runtime.sendMessage / onMessage
 *   Service Worker（后台脚本）
 *
 * 【职责】
 *   向宿主页面暴露 window.$poster / window.$syncer 对象，
 *   让网页（如 wechatsync.com 管理后台）可以：
 *     - 查询已登录的平台账号 (getAccounts)
 *     - 发起同步任务 (addTask)
 *     - 调用平台特定方法 (magicCall)，包括上传图片 (uploadImage)
 *     - 调用已废弃的旧版 API (updateDriver, startInspect)
 *
 * 【消息传递协议 — 事件 ID 回调模式】
 *   1. 调用方（网页）通过 callFunc() 给每条消息分配唯一 eventID
 *   2. 回调函数以 eventID 为键存入 eventCb 字典
 *   3. 消息通过 window.postMessage 发送到 Content Script
 *   4. Content Script 处理后回传带 callReturn=true + 相同 eventID 的消息
 *   5. message 监听器匹配 eventID，触发回调，清理字典
 *
 *   这解决了 postMessage 没有"请求-响应"语义的问题——
 *   通过 eventID 将异步响应与原始请求关联起来。
 *
 * 【任务状态推送】
 *   addTask 发起同步后，Content Script 会持续推送 taskUpdate 消息。
 *   这不是通过 eventID 回调的，而是通过专门的 _statueandler 回调。
 *   推送包含每个目标平台的实时状态（uploading / done / failed 等）。
 * ============================================================================
 */

(function() {
    console.log('api ready');

    // ========== 全局 API 对象 ==========
    var poster = {
        versionNumber: 1001,  // API 版本号，用于兼容性检查
        dev: location.hostname === 'localhost' || location.hostname === '127.0.0.1',
        // dev 标记：本地开发时为 true，可能用于调试日志
    };

    // ========== 事件 ID 回调注册表 ==========
    // 键: eventID（由 callFunc 生成的唯一标识）
    // 值: callback(err, result) 函数
    var eventCb = {};

    // addTask 的状态回调 —— 接收持续的同步进度推送
    var _statueandler = null;  // 注：原文拼写如此，应为 _statusHandler

    // startInspect 的控制台日志回调 —— 接收来自扩展的 console 输出
    var _consolehandler = null;

    /**
     * callFunc — 核心消息发送函数（事件 ID 回调模式的发送端）
     *
     * 流程：
     *   1. 为消息生成唯一 eventID = floor(Date.now() + random * 100)
     *      注意：这不是加密安全的，高并发下有极小概率冲突，
     *      但对于用户级操作完全够用。
     *   2. 将 cb 存入 eventCb[eventID]
     *   3. 通过 window.postMessage 将 JSON 序列化后的消息广播
     *   4. Content Script 监听 message 事件，处理后回传
     *
     * @param {Object} msg  - 要发送的消息体（包含 method 等字段）
     * @param {Function} cb - 回调函数，签名为 cb(result)
     */
    function callFunc(msg, cb) {
        // 生成 eventID：当前时间戳 + 随机偏移
        // 例如 Date.now()=1700000000000, random*100=42 → eventID=1700000000042
        msg.eventID = Math.floor(Date.now() + Math.random() * 100);

        // 注册回调到字典
        eventCb[msg.eventID] = function(err, res) {
            cb(err, res);
        };

        // 通过 postMessage 发送到 Content Script（隔离世界）
        // Content Script 的 window 和页面的 window 共享同一个 postMessage 通道
        window.postMessage(JSON.stringify(msg), '*');
    }

    // ========================================================================
    // 公开 API 方法
    // ========================================================================

    /**
     * getAccounts — 获取所有已认证的平台账号列表
     *
     * 消息流：
     *   inject-api → {method: "getAccounts", eventID} → Content Script
     *   Content Script → {type: "CHECK_ALL_AUTH"} → Service Worker
     *   Service Worker → {platforms: [...]} → Content Script
     *   Content Script → {eventID, result: [{type, title, ...}]} → inject-api
     *
     * 返回的每个账号包含：
     *   - type: 平台标识 (如 "wechat", "zhihu", "toutiao")
     *   - title: 用户名
     *   - displayName: 平台显示名
     *   - icon / avatar: 头像 URL
     *   - uid: 用户唯一标识
     *   - home: 主页链接
     *   - supportTypes: 支持的内容类型 (固定为 ["html"])
     *
     * @param {Function} cb - 回调 cb(result)，result 为账号数组
     */
    poster.getAccounts = function(cb) {
        callFunc({
                method: 'getAccounts',
            },
            cb
        );
    };

    /**
     * addTask — 发起文章同步任务
     *
     * 这是核心 API，将一篇文章同步到一个或多个平台。
     *
     * 消息流：
     *   inject-api → {method: "addTask", task: {post, accounts}} → Content Script
     *   Content Script → {type: "SYNC_ARTICLE", payload: {...}} → Service Worker
     *   Service Worker 逐平台同步，期间持续推送：
     *     Content Script → {method: "taskUpdate", task: {accounts: [...]}} → inject-api
     *   最终完成：
     *     Content Script → {eventID, result} → inject-api
     *
     * task 结构：
     *   {
     *     post: { title, content (html), markdown, thumb (封面) },
     *     accounts: [{ type, title, uid, ... }]
     *   }
     *
     * @param {Object}   task          - 同步任务描述
     * @param {Function} statueandler  - 状态推送回调，持续接收 taskUpdate
     * @param {Function} cb            - 最终完成回调
     */
    poster.addTask = function(task, statueandler, cb) {
        // 保存状态回调，后续 taskUpdate 消息会调用它
        _statueandler = statueandler;
        callFunc({
                method: 'addTask',
                task: task,
            },
            cb
        );
    };

    /**
     * magicCall — 通用远程方法调用
     *
     * 用于调用 Service Worker 中注册的各种平台方法，
     * 比如获取草稿列表、发布文章等平台特定操作。
     *
     * 消息流（非 uploadImage 时）：
     *   inject-api → {method: "magicCall", methodName, data} → Content Script
     *   Content Script → {type: "MAGIC_CALL", payload: {methodName, data}} → Service Worker
     *   Service Worker → result → Content Script → inject-api
     *
     * 当 methodName === "uploadImage" 时走专用路径（见下方 uploadImage）。
     *
     * @param {Object}   data - 调用参数，必须包含 methodName 字段
     * @param {Function} cb   - 回调
     */
    poster.magicCall = function(data, cb) {
        callFunc({
                method: 'magicCall',
                methodName: data.methodName,
                data: data,
            },
            cb
        );
    };

    /**
     * updateDriver — [已废弃] 更新平台适配器驱动
     *
     * v1 版本中用于动态更新平台的适配器代码。
     * v2 中已不再需要，Content Script 会返回 {success: true, deprecated: true}。
     * 仅当消息来源是白名单域名时才处理（wechatsync.com / developer.wechatsync.com / localhost:8080）。
     */
    poster.updateDriver = function(data, cb) {
        callFunc({
                method: 'updateDriver',
                data: data,
            },
            cb
        );
    };

    /**
     * startInspect — [已废弃] 启动页面内容检测
     *
     * v1 版本中用于启动对页面编辑器内容的实时监控。
     * v2 中已废弃，同 updateDriver。
     * _consolehandler 用于接收来自扩展的 console 日志输出。
     */
    poster.startInspect = function(handler, cb) {
        _consolehandler = handler;
        callFunc({
                method: 'startInspect',
            },
            cb
        );
    };

    /**
     * uploadImage — 上传图片到指定平台
     *
     * 这是 magicCall 的便捷封装，固定 methodName 为 "uploadImage"。
     *
     * 消息流（走专用快速通道，不经 MAGIC_CALL）：
     *   inject-api → {method: "magicCall", methodName: "uploadImage", data} → Content Script
     *   Content Script → {type: "UPLOAD_IMAGE", payload: {src, platform}} → Service Worker
     *   Service Worker 将图片上传到目标平台的图床，返回新 URL
     *   Content Script → {eventID, result: {url: "..."}} → inject-api
     *
     * data 结构：
     *   {
     *     src: "原始图片 URL",
     *     account: { type: "平台标识" }  // 可选，默认 "weibo"
     *   }
     *
     * @param {Object}   data - {src, account: {type}}
     * @param {Function} cb   - 回调 cb(result)，result 包含上传后的 URL
     */
    poster.uploadImage = function(data, cb) {
        callFunc({
                method: 'magicCall',
                methodName: 'uploadImage',
                data: data,
            },
            cb
        );
    };

    // ========================================================================
    // 消息监听器 — 事件 ID 回调模式的接收端 + 状态推送接收
    // ========================================================================

    window.addEventListener('message', function(evt) {
        try {
            var action = JSON.parse(evt.data);

            // ---------- 任务状态推送（非 eventID 回调） ----------
            // Content Script 将 Service Worker 的 SYNC_PROGRESS / SYNC_DETAIL_PROGRESS
            // 转换为 taskUpdate 格式推送过来
            if (action.method && action.method === 'taskUpdate') {
                if (_statueandler != null) _statueandler(action.task);
                return;
            }

            // ---------- 控制台日志推送（非 eventID 回调） ----------
            // 用于 startInspect 场景，将扩展内部的 console 输出转发到页面
            if (action.method && action.method === 'consoleLog') {
                if (_consolehandler != null) _consolehandler(action.args);
                return;
            }

            // ---------- eventID 回调响应 ----------
            // callReturn=true 标记这是 callFunc 的响应
            if (!action.callReturn) return;

            if (action.eventID && eventCb[action.eventID]) {
                // 触发回调，传入结果
                eventCb[action.eventID](action.result);
                // 清理：一次性回调，用后即删
                delete eventCb[action.eventID];
            }
        } catch (e) {
            // 忽略非 JSON 消息（页面上可能有其他 postMessage 通信）
        }
    });

    // ========== 挂载到全局 ==========
    // 网页代码可以通过 window.$poster 或 window.$syncer 访问 API
    // 两个名称指向同一个对象，$syncer 可能是后期添加的语义化别名
    window.$poster = poster;
    window.$syncer = poster;

})();
