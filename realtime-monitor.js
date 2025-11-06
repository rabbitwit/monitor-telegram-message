import { config } from 'dotenv';
import { createTelegramClient, initializeMonitoring, startCleanupInterval, 
         startHeartbeatInterval, startAutoDeleteInterval } from './core/telegram-monitor.js';
import { deleteExpiredMessages } from './core/message-deleter.js';

config();

const APP_ID = process.env.APP_ID;
const APP_API_HASH = process.env.APP_API_HASH;
const STRING_SESSION = process.env.STRING_SESSION;
const MONITOR_CHAT_IDS_RAW = process.env.MONITOR_CHAT_IDS;
const NOT_MONITOR_CHAT_IDS_RAW = process.env.NOT_MONITOR_CHAT_IDS;
const MONITOR_KEYWORDS_RAW = process.env.MONITOR_KEYWORDS;
const AUTO_DELETE_MINUTES = parseInt(process.env.AUTO_DELETE_MINUTES) || 10;
const NOTIFICATION_CHAT_ID = process.env.NOTIFICATION_CHAT_ID;  // 通知发送的目标群组ID
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;  // 用于发送通知的机器人Token
const TARGET_USER_IDS_RAW = process.env.TARGET_USER_IDS;  // 优先监控的用户ID列表
const USER_KEYWORDS_RAW = process.env.USER_KEYWORDS;       // 用户特定关键词
const DEDUP_WINDOW_MINUTES = parseInt(process.env.DEDUP_WINDOW_MINUTES) || Math.max(1, AUTO_DELETE_MINUTES);
const DELETE_NOTIFICATION_KEYWORDS = process.env.DELETE_NOTIFICATION_KEYWORDS; // 触发删除通知的关键词

// 验证必要环境变量
if (!APP_ID || !APP_API_HASH || !STRING_SESSION) {
    console.error('请确保在 .env 文件中设置了 APP_ID, APP_API_HASH 和 STRING_SESSION');
    process.exit(1);
}

// 验证数值型配置
if (isNaN(AUTO_DELETE_MINUTES) || AUTO_DELETE_MINUTES <= 0) {
    console.warn(`AUTO_DELETE_MINUTES 设置无效 (${AUTO_DELETE_MINUTES})，使用默认值 10`);
}

if (isNaN(DEDUP_WINDOW_MINUTES) || DEDUP_WINDOW_MINUTES <= 0) {
    console.warn(`DEDUP_WINDOW_MINUTES 设置无效 (${DEDUP_WINDOW_MINUTES})，使用默认值 ${Math.max(1, AUTO_DELETE_MINUTES)}`);
}

// 如果启用了通知功能，验证通知相关环境变量
if (TELEGRAM_BOT_TOKEN) {
    console.log('检测到 TELEGRAM_BOT_TOKEN，将使用机器人发送通知');
} else {
    console.log('未检测到 TELEGRAM_BOT_TOKEN，将使用当前用户客户端发送通知');
}

let cleanupInterval;
let heartbeatInterval;
let deleteInterval;
let telegramClient; // 保存 Telegram 客户端实例的引用
let isShuttingDown = false; // 标记是否正在关闭

/**
 * 停止监控服务并清理相关资源。
 * 包括清除定时任务和销毁 Telegram 客户端连接。
 * 
 * @returns {Promise<void>} 返回一个 Promise，在客户端关闭后 resolve。
 */
const stopMonitoring = async () => {
    if (isShuttingDown) {
        return; // 防止重复调用
    }
    
    isShuttingDown = true;
    console.log("正在停止监控服务...");
    
    // 清除所有定时器
    if (cleanupInterval) clearInterval(cleanupInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (deleteInterval) clearInterval(deleteInterval);
    
    // 断开 Telegram 客户端连接
    if (telegramClient) {
        try {
            console.log("正在断开 Telegram 客户端连接...");
            
            // 尝试正常断开连接
            try {
                await telegramClient.disconnect();
            } catch (err) {
                console.warn("断开连接时出错:", err.message);
            }
            
            // 销毁客户端
            try {
                await telegramClient.destroy();
            } catch (err) {
                console.warn("销毁客户端时出错:", err.message);
            }
            
            console.log("✅ Telegram 客户端已断开连接");
        } catch (error) {
            console.error("❌ 断开 Telegram 客户端连接时出错:", error.message);
        }
    }
    
    console.log("✅ 监控服务已停止");
    process.exit(0); // 正常退出，返回码为0表示成功
};

// 注册系统中断信号处理函数，用于优雅地停止监控
const signalHandler = () => {
    console.log('收到关闭信号，正在优雅关闭...');
    stopMonitoring();
};

process.on('SIGINT', signalHandler);
process.on('SIGTERM', signalHandler);
process.on('SIGQUIT', signalHandler);

// 捕获未处理的异常
process.on('uncaughtException', (err) => {
    console.error('未捕获的异常:', err);
    stopMonitoring();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的 Promise 拒绝:', reason);
    stopMonitoring();
});

/**
 * 启动 Telegram 监控服务。
 *
 * @returns {Promise<void>} 返回一个 Promise，在监控启动完成或发生错误时 resolve 或 reject。
 */
async function startMonitoring() {
    console.log('正在创建 Telegram 客户端...');

    try {
        // 创建 Telegram 客户端
        telegramClient = createTelegramClient({
            appId: APP_ID,
            apiHash: APP_API_HASH,
            stringSession: STRING_SESSION
        });

        // 添加连接状态监听
        telegramClient.addEventHandler((update) => {
            if (update.className === 'UpdateConnectionState') {
                console.log('连接状态变化:', update.state);
            }
        });

        // 初始化监控服务
        const monitoringData = await initializeMonitoring(telegramClient, {
            monitorChatIdsRaw: MONITOR_CHAT_IDS_RAW,
            notMonitorChatIdsRaw: NOT_MONITOR_CHAT_IDS_RAW,
            monitorKeywordsRaw: MONITOR_KEYWORDS_RAW,
            autoDeleteMinutes: AUTO_DELETE_MINUTES,
            notificationChatId: NOTIFICATION_CHAT_ID,
            telegramBotToken: TELEGRAM_BOT_TOKEN,
            targetUserIdsRaw: TARGET_USER_IDS_RAW,
            userKeywordsRaw: USER_KEYWORDS_RAW,
            dedupWindowMinutes: DEDUP_WINDOW_MINUTES,
            deleteNotificationKeywords: DELETE_NOTIFICATION_KEYWORDS // 传递删除通知关键词
        });

        // 启动定时清理任务
        cleanupInterval = startCleanupInterval(monitoringData.cleanupProcessedMessages);
        
        // 启动心跳检测
        heartbeatInterval = startHeartbeatInterval(telegramClient);
        
        // 启动自动删除过期间隔
        const intervalMs = monitoringData.autoDeleteMinutes > 0 ? Math.max(1, monitoringData.autoDeleteMinutes) * 60 * 1000 : 0;
        deleteInterval = startAutoDeleteInterval(telegramClient, intervalMs, deleteExpiredMessages);

        console.log('✅ 监控已启动，按 Ctrl+C 停止');
    } catch (error) {
        console.error('❌ 启动监控时出错:', error);
        await stopMonitoring();
    }
}

// 启动监控
startMonitoring().catch(console.error);