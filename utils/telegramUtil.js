import { config } from 'dotenv';
import { processMessageContent, parseLotteryMessage } from './messageUtils.js'
import { buildFormattedMessage, normalizeId } from './formatUtils.js'
config();
// 全局缓存
const senderCache = new Map();
const CACHE_EXPIRE_TIME = 3600000; // 1小时过期

// 更频繁地执行缓存清理（每半小时一次）
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of senderCache.entries()) {
        if (now - value.timestamp > CACHE_EXPIRE_TIME) {
            senderCache.delete(key);
        }
    }
}, CACHE_EXPIRE_TIME / 2);

/**
 * 获取消息发送者信息，优先从缓存中获取，如果缓存不存在或已过期则从客户端重新获取
 * @param {Object} message - 消息对象，应包含 fromId 属性
 * @param {Object} client - 客户端实例，用于获取发送者实体信息
 * @returns {Promise<string>} 返回发送者名称，如果无法获取则返回 'Unknown'
 */
export async function getCachedSenderInfo(message, client) {
    if (!message.fromId) return 'Unknown';

    // 确保 cacheKey 是稳定唯一的字符串表示形式
    const cacheKey = typeof message.fromId === 'object' && message.fromId.userId != null
        ? message.fromId.userId.toString()
        : message.fromId.toString();

    // 检查缓存是否存在且未过期
    if (senderCache.has(cacheKey)) {
        const cached = senderCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_EXPIRE_TIME) {
            return cached.name;
        } else {
            senderCache.delete(cacheKey); // 主动移除已过期缓存
        }
    }

    let senderName = 'Unknown';

    // 尝试通过客户端获取发送者信息
    try {
        if (client) {
            const sender = await client.getEntity(message.fromId);
            senderName = [sender.firstName, sender.lastName].filter(Boolean).join(' ') || 'Unknown';

            // 存入缓存
            senderCache.set(cacheKey, {
                name: senderName,
                timestamp: Date.now()
            });

            return senderName;
        }
    } catch (e) {
        console.warn('无法获取发送者实体:', e.message);
    }

    // 回退方案：使用 userId 作为名称
    senderName = message.fromId.userId ? `User ${message.fromId.userId}` : 'Unknown';

    // 避免重复缓存相同 fallback 数据
    if (!senderCache.has(cacheKey)) {
        senderCache.set(cacheKey, {
            name: senderName,
            timestamp: Date.now()
        });
    }

    return senderName;
}

/**
 * 从聊天对象或消息对象中提取聊天信息
 * @param {Object} chat - 聊天对象，可能包含id、title、firstName、lastName等属性
 * @param {Object} message - 消息对象，当chat对象不存在时用于提取聊天信息
 * @returns {Object} 包含chatId和chatTitle的对象
 *   - chatId: 聊天ID，如果无法获取则为'Unknown'
 *   - chatTitle: 聊天标题，如果无法获取则为'Unknown Group'
 */
export function extractChatInfo(chat, message) {
    let chatId = 'Unknown';
    let chatTitle = 'Unknown Group';

    // 优先从chat对象提取信息
    if (chat && typeof chat === 'object' && chat.id != null) {
        chatId = String(chat.id);
        const firstName = chat.firstName ?? '';
        const lastName = chat.lastName ?? '';
        chatTitle =
            chat.title ||
            [firstName, lastName].filter(Boolean).join(' ') ||
            'Unknown Group';
        return { chatId, chatTitle };
    }

    // 当chat对象不可用时，从message的peerId提取信息
    const peerId = message?.peerId;
    if (peerId) {
        if (peerId.chatId != null) {
            chatId = `-${peerId.chatId}`;
            chatTitle = `Chat ${peerId.chatId}`;
        } else if (peerId.channelId != null) {
            chatId = `-100${peerId.channelId}`;
            chatTitle = `Channel ${peerId.channelId}`;
        } else if (peerId.userId != null) {
            chatId = String(peerId.userId);
            chatTitle = `User ${peerId.userId}`;
        }
    }

    return { chatId, chatTitle };
}

/**
 * 带有重试机制的fetch请求函数
 * 
 * @param {string} url - 请求的URL地址
 * @param {Object} options - fetch请求的配置选项
 * @param {number} maxRetries - 最大重试次数，默认为3次
 * @returns {Promise<Response>} 返回fetch请求的响应结果
 * @throws {Error} 当所有重试都失败时，抛出最后一次遇到的错误
 */
export async function fetchWithRetry(url, options, maxRetries = 3) {
    let lastError;

    // 循环尝试发送请求，直到成功或达到最大重试次数
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fetch(url, options);
        } catch (error) {
            lastError = error;
            console.warn(`⚠️  第 ${attempt + 1} 次发送失败，${attempt < maxRetries - 1 ? '重试中...' : '放弃'} 错误:`, error.message);

            // 在重试前等待，使用指数退避策略避免过于频繁的重试
            if (attempt < maxRetries - 1) {
                // 指数退避：1s, 2s, 4s
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            }
        }
    }

    throw lastError;
}

/**
 * 处理 API 错误响应，解析错误信息并输出友好的日志提示
 * @param {Response} response - fetch 请求返回的响应对象
 * @returns {Object|null} 解析后的错误对象，如果解析失败则返回 null
 */
export async function handleApiError(response) {
    // 安全性增强：确保 response 存在且具备必要方法
    if (!response || typeof response.text !== 'function') {
        console.error('❌ Invalid response object passed to handleApiError');
        return null;
    }

    const errorText = await response.text();
    console.error(`❌ 发送消息失败: ${response.status} ${response.statusText}`);

    try {
        const errorObj = JSON.parse(errorText);
        const { description, parameters } = errorObj;

        // 缓存字段避免多次访问
        const desc = description?.toLowerCase();

        // 处理群组迁移错误：当普通群组升级为超级群组时提示更新配置
        if (desc?.includes('group chat was upgraded to a supergroup chat')) {
            const newChatId = parameters?.migrate_to_chat_id;
            if (newChatId) {
                console.log(`📝 群组已迁移至: ${newChatId}`);
                console.log('   请更新 .env 文件中的 NOTIFICATION_CHAT_ID');
            }
        }

        // 其他常见错误映射表
        const errorMap = [
            { key: 'bot was blocked', msg: '⚠️ 机器人已被阻止，请检查机器人权限' },
            { key: 'chat not found', msg: '⚠️ 找不到聊天，请检查 NOTIFICATION_CHAT_ID 是否正确' },
            { key: 'message is too long', msg: '⚠️ 消息过长，请考虑缩短消息内容' }
        ];

        for (const { key, msg } of errorMap) {
            if (desc?.includes(key)) {
                console.log(msg);
                break;
            }
        }

        return errorObj;
    } catch (parseError) {
        console.error('   无法解析错误详情:', parseError.message);
        return null;
    }
}

/**
 * 获取 Telegram 机器人的基本信息
 * 
 * @param {string} TELEGRAM_BOT_TOKEN - Telegram 机器人的访问令牌
 * @returns {Object} 包含机器人用户ID和用户名的对象
 * @returns {string} returns.BOT_USER_ID_NORMALIZED - 格式化后的机器人用户ID
 * @returns {string} returns.BOT_USERNAME - 机器人的用户名
 */
export async function fetchBotInfo(TELEGRAM_BOT_TOKEN) {
    // 如果没有配置 bot token，直接返回空信息
    if (!TELEGRAM_BOT_TOKEN) return { BOT_USER_ID_NORMALIZED: '', BOT_USERNAME: '' }

    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`

    try {
        const res = await fetch(apiUrl)
        
        // 显式验证响应状态
        if (!res.ok) {
            console.warn(`[fetchBotInfo] 请求失败，HTTP 状态码: ${res.status}`)
            return { BOT_USER_ID_NORMALIZED: '', BOT_USERNAME: '' }
        }

        const json = await res.json()

        // 验证API响应格式并提取机器人信息
        if (json?.ok && json?.result) {
            let BOT_USER_ID_NORMALIZED = ''
            try {
                BOT_USER_ID_NORMALIZED = normalizeId(json.result.id)
            } catch (idErr) {
                console.error('[fetchBotInfo] normalizeId 执行异常:', idErr.message)
                return { BOT_USER_ID_NORMALIZED: '', BOT_USERNAME: '' }
            }

            const BOT_USERNAME = json.result.username || ''
            console.log('检测到通知机器人:', BOT_USERNAME)
            return { BOT_USER_ID_NORMALIZED, BOT_USERNAME }
        } else {
            console.warn('[fetchBotInfo] Telegram API 返回不合法数据:', json?.description || '未知错误')
        }
    } catch (e) {
        // 处理网络请求异常情况
        console.error('[fetchBotInfo] 网络请求异常:', e.message)
    }

    return { BOT_USER_ID_NORMALIZED: '', BOT_USERNAME: '' }
}

/**
 * 发送 Telegram 通知消息，支持将消息推送到多个指定群组。
 * 
 * @param {Object} message - 原始消息对象，包含待处理的消息内容及元数据
 * @param {Object} chat - 聊天上下文对象，用于提取聊天相关信息
 * @param {Object} client - 客户端实例（可能用于后续扩展）
 * @param {string} NOTIFICATION_CHAT_ID - 接收通知的目标群组 ID 列表，以逗号分隔
 * @param {string} TELEGRAM_BOT_TOKEN - Telegram Bot 的访问令牌
 * @param {Array<string>} USER_KEYWORDS - 用户定义的关键字列表，用于识别特定抽奖信息
 * @param {Map} sentNotificationMessages - 存储已发送通知消息的Map
 * @returns {Promise<boolean>} 是否至少成功发送了一条通知消息
 */
export async function sendNotification(message, chat, client, NOTIFICATION_CHAT_ID, TELEGRAM_BOT_TOKEN, USER_KEYWORDS, sentNotificationMessages = new Map()) {
    try {
        // 如果没有设置通知群组，则不发送通知
        if (!NOTIFICATION_CHAT_ID) {
            console.log('⚠️  未配置 NOTIFICATION_CHAT_ID，跳过发送通知');
            console.log('💡 提示：如需接收通知，请在 .env 文件中配置 NOTIFICATION_CHAT_ID 为您的个人账号ID或群组ID');
            return false;
        }

        // 将目标群组 ID 分割并清理空格
        const chatIds = NOTIFICATION_CHAT_ID.split(',').map(id => id.trim());

        // 提取当前聊天的基本信息（如标题、ID等）
        const chatInfo = extractChatInfo(chat, message);
        const { chatId, chatTitle } = chatInfo;

        // 处理原始消息内容，并解析出显示文本与潜在的抽奖关键词匹配结果
        const messageContent = processMessageContent(message);
        const { displayText } = messageContent;
        const lotteryInfo = parseLotteryMessage(displayText, USER_KEYWORDS);

        // 根据提取的信息构建格式化后的通知消息文本
        const formattedMessage = buildFormattedMessage(
            chatTitle,
            chatId,
            message.id,
            lotteryInfo,
            displayText
        );

        // 如果配置了机器人令牌，则使用机器人API发送消息
        if (TELEGRAM_BOT_TOKEN) {
            // 准备 Telegram API 请求地址和解析模式
            const botUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            const PARSE_MODE = 'HTML';

            // 并发向所有目标群组发送消息，并启用重试机制
            const sendResults = await Promise.allSettled(
                chatIds.map(async targetChatId => {
                    const response = await fetchWithRetry(botUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            chat_id: targetChatId,
                            text: formattedMessage,
                            parse_mode: PARSE_MODE
                        })
                    }, 3);
                    
                    // 如果发送成功，记录消息ID
                    if (response.ok) {
                        const result = await response.json();
                        if (result.ok && result.result && result.result.message_id) {
                            if (!sentNotificationMessages.has(targetChatId)) {
                                sentNotificationMessages.set(targetChatId, []);
                            }
                            // 确保消息ID不会重复添加
                            const messageIds = sentNotificationMessages.get(targetChatId);
                            // 记录存储的消息ID用于调试
                            console.log(`存储消息ID ${result.result.message_id} 到聊天 ${targetChatId}`);
                            messageIds.push(result.result.message_id);
                        }
                    }
                    
                    return response;
                })
            );

            // 统计发送成功的数量并记录日志
            let successCount = 0;
            for (let i = 0; i < sendResults.length; i++) {
                const result = sendResults[i];
                const targetChatId = chatIds[i];
                
                if (result.status === 'fulfilled') {
                    if (result.value.ok) {
                        successCount++;
                        // 显示群组名称，这是您实际需要的信息
                        console.log(`✅ 消息已发送到通知目标: ${targetChatId}`);
                    } else {
                        await handleApiError(result.value);
                    }
                } else {
                    console.error(`❌ 发送到目标 ${targetChatId} 失败:`, result.reason.message);
                }
            }

            console.log(`📤 总共发送到 ${successCount}/${chatIds.length} 个目标`);
            return successCount > 0;
        } else {
            // 如果没有配置机器人令牌，则使用当前用户客户端发送消息
            console.log('⚠️  未配置 TELEGRAM_BOT_TOKEN，将使用当前用户客户端发送通知');
            
            try {
                let successCount = 0;
                for (const targetChatId of chatIds) {
                    try {
                        // 尝试通过客户端发送消息
                        // 首先需要获取目标聊天实体
                        let targetChat;
                        try {
                            targetChat = await client.getEntity(targetChatId);
                        } catch (entityError) {
                            console.log(`⚠️  无法直接获取实体 ${targetChatId}，尝试使用InputDialog`);
                            // 如果直接获取失败，尝试使用InputDialog
                            targetChat = await client.getInputEntity(targetChatId);
                        }
                        
                        if (targetChat) {
                            // 发送消息，使用 HTML 解析模式
                            const sentMessage = await client.sendMessage(targetChat, { 
                                message: formattedMessage, 
                                parseMode: "html"
                            });
                            if (sentMessage && sentMessage.id) {
                                // 记录消息ID以便后续可能的删除操作
                                if (!sentNotificationMessages.has(targetChatId)) {
                                    sentNotificationMessages.set(targetChatId, []);
                                }
                                const messageIds = sentNotificationMessages.get(targetChatId);
                                messageIds.push(sentMessage.id);
                                console.log(`✅ 消息已发送到通知目标: ${targetChatId}`);
                                successCount++;
                            }
                        }
                    } catch (error) {
                        console.error(`❌ 使用用户客户端发送消息到 ${targetChatId} 失败:`, error.message);
                    }
                }
                
                console.log(`📤 使用用户客户端总共发送到 ${successCount}/${chatIds.length} 个目标`);
                return successCount > 0;
            } catch (error) {
                console.error('❌ 使用用户客户端发送通知时出错:', error.message);
                return false;
            }
        }
    } catch (error) {
        console.error('❌ 发送通知时出错:', error.message);
        return false;
    }
}

/**
 * 安全获取当前用户信息
 * @param {TelegramClient} client - Telegram 客户端
 * @returns {Promise<Object|null>} 用户信息或 null
 */
export async function safeGetMe(client) {
    try {
        return await client.getMe();
    } catch (err) {
        console.warn("获取当前用户失败:", err.message);
        return null;
    }
}

/**
 * 安全获取用户实体
 * @param {TelegramClient} client - Telegram 客户端
 * @param {string|number} id - 用户ID
 * @returns {Promise<Object|null>} 用户实体或 null
 */
export async function safeGetEntity(client, id) {
    try {
        return await client.getEntity(id);
    } catch (err) {
        console.warn("获取用户实体失败:", err.message);
        return null;
    }
}