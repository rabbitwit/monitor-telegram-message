import { config } from 'dotenv'
import { Api, TelegramClient } from 'telegram'
import { parseChatIds } from './utils/formatUtils.js'
import { isDeletableMessage } from './utils/messageUtils.js'
import { StringSession } from 'telegram/sessions/index.js'

config();

/**
 * 配置对象，存储应用程序的各种配置参数
 * 包含Telegram客户端连接信息、监控设置和操作参数
 */
const CONFIG = {
    APP_ID: process.env.APP_ID,
    APP_API_HASH: process.env.APP_API_HASH,
    STRING_SESSION: process.env.STRING_SESSION,
    MONITOR_CHAT_IDS: process.env.MONITOR_CHAT_IDS,
    NOT_MONITOR_CHAT_IDS: process.env.NOT_MONITOR_CHAT_IDS,
    DELETE_HISTORY_MODE: process.env.DELETE_HISTORY_MODE,
    BATCH_SIZE: 100, // 每批删除的消息数（Telegram 限制）
    FETCH_LIMIT: 100, // 每次获取的消息数
    BATCH_DELAY: 1000, // 批次间延迟（毫秒）
    CHAT_DELAY: 2000, // 群组间延迟（毫秒）
    CLIENT_OPTIONS: {
        connectionRetries: 3,
        timeout: 10000,
        retryDelay: 2000,
        autoReconnect: true
    }
}

/**
 * 验证配置文件中的必要环境变量
 *
 * 该函数检查 CONFIG 对象中是否包含必要的环境变量，
 * 包括 APP_ID、APP_API_HASH 和 STRING_SESSION。
 * 如果缺少任何必需的变量，将输出错误信息并退出程序。
 *
 * @returns {void} 无返回值，验证失败时会直接退出进程
 */
function validateConfig() {
    const required = ['APP_ID', 'APP_API_HASH', 'STRING_SESSION'];
    const missing = required.filter(key => !CONFIG[key]);

    if (missing.length > 0) {
        console.error(`❌ 缺少必要的环境变量: ${missing.join(', ')}`);
        console.error('请在 .env 文件中设置: APP_ID, APP_API_HASH, STRING_SESSION');
        process.exit(1);
    }
}

/**
 * 创建一个延迟执行的Promise对象，用于实现异步等待功能
 * @param {number} ms - 延迟等待的毫秒数
 * @returns {Promise} 返回一个在指定毫秒数后resolve的Promise对象
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 记录进度日志信息到控制台
 * @param {string} type - 日志类型，可选值：'info'、'success'、'warning'、'error'
 * @param {string} message - 要记录的日志消息内容
 * @returns {void}
 */
function logProgress(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const icons = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌'
    }
    console.log(`[${timestamp}] ${icons[type] || ''} ${message}`);
}

/**
 * 处理 Flood Wait 限流错误和通用重试逻辑
 * @param {Error} error - 捕获的错误对象
 * @param {number} retries - 当前重试次数，默认为 0
 * @returns {Promise<boolean>} 返回 Promise，resolve 时返回布尔值，true 表示需要重试，false 表示放弃重试
 */
async function handleFloodWait(error, retries = 0) {
    const maxRetries = 3;

    // 检查是否是 Flood Wait 错误
    if (error?.message?.includes('FLOOD_WAIT')) {
        const match = error.message.match(/FLOOD_WAIT_(\d+)/);
        if (match) {
            const waitSeconds = parseInt(match[1])
            logProgress('warning', `触发限流，等待 ${waitSeconds} 秒...`);
            await sleep(waitSeconds * 1000);
            return true
        }
    }

    // 其他错误重试
    if (retries < maxRetries) {
        logProgress('warning', `操作失败，${2 ** retries} 秒后重试 (${retries + 1}/${maxRetries})`);
        await sleep(1000 * (2 ** retries));
        return true
    }

    return false
}

/**
 * 判断是否应该处理指定的聊天对象
 * @param {Object} chat - 聊天对象
 * @param {string} chat.className - 聊天对象类型（'User'、'Channel'等）
 * @param {boolean} [chat.broadcast] - 是否为广播频道
 * @returns {boolean} 如果应该处理该聊天对象则返回true，否则返回false
 */
function shouldProcessChat(chat) {
    // 排除私人对话
    if (chat.className === 'User') return false;

    // 排除广播频道（只读的公告频道）
    if (chat.className === 'Channel' && chat.broadcast) return false;

    // 允许群组和超级群组（包括频道形式的群组）
    return true;
}

/**
 * 从指定聊天中获取当前用户发送的所有可删除历史消息。
 *
 * @param {Object} client - Telegram 客户端实例，用于调用 API。
 * @param {Object} chat - 聊天对象，表示要从中获取消息的聊天。
 * @param currentUserId - 当前用户的 ID，用于过滤消息来源。
 * @param currentUserAccessHash - 当前用户的访问哈希值，用于构造 InputPeer。
 * @returns {Promise<Array>} 返回一个包含所有符合条件消息的数组。
 */
async function fetchMessagesFromChat(client, chat, currentUserId, currentUserAccessHash) {
    const messages = [];
    const pageSize = CONFIG.FETCH_LIMIT;
    const maxPages = 20;
    let offsetId = 0;
    let hasMore = true;
    let pageNum = 0;

    logProgress('info', `开始获取 ${chat.title || 'Unknown'} 中的所有历史消息`);

    try {
        // 循环分页拉取消息，直到没有更多或达到最大页数限制
        while (hasMore && pageNum < maxPages) {
            pageNum++

            const result = await client.invoke(
                new Api.messages.Search({
                    peer: chat,
                    q: '',
                    filter: new Api.InputMessagesFilterEmpty(),
                    fromId: new Api.InputPeerUser({
                        userId: currentUserId,
                        accessHash: currentUserAccessHash || 0
                    }),
                    minDate: 0,
                    maxDate: 0,
                    limit: pageSize,
                    offsetId: offsetId,
                    addOffset: 0,
                    maxId: 0,
                    minId: 0,
                    hash: BigInt(0)
                })
            );

            const batch = result?.messages || (Array.isArray(result) ? result : []);

            // 如果没有获取到消息，则停止继续拉取
            if (!batch || batch.length === 0) {
                hasMore = false;
                break;
            }

            // 过滤出当前用户发送的可删除消息
            const validMessages = batch.filter(msg => {
                // 检查是否为有效消息
                if (!msg || !msg.id) {
                    return false;
                }

                // 检查是否由当前用户发送
                const fromUserId = msg.fromId?.userId ? msg.fromId.userId.toString() : null;
                const currentUserIdStr = currentUserId.toString();

                if (fromUserId !== currentUserIdStr) {
                    return false;
                }

                return isDeletableMessage(msg);
            });

            // 统计被过滤掉的消息数量
            const filteredCount = batch.length - validMessages.length;

            messages.push(...validMessages);

            // 更新 offsetId 为最后一条消息的 ID，以便下一页继续拉取
            offsetId = batch[batch.length - 1].id;
            let logMsg = `第 ${pageNum} 页: 获取 ${validMessages.length} 条有效消息`;
            if (filteredCount > 0) {
                logMsg += ` (过滤掉 ${filteredCount} 条消息)`;
            }
            logProgress('info', logMsg);

            // 如果获取的消息数量少于页面大小，说明没有更多消息了
            if (batch.length < pageSize) {
                hasMore = false;
            }

            // 延迟以避免触发限流
            if (hasMore) {
                await sleep(CONFIG.BATCH_DELAY);
            }
        }
    } catch (error) {
        logProgress('error', `获取消息时出错: ${error.message}`);
        if (!(await handleFloodWait(error))) {
            throw error;
        }
    }

    logProgress('success', `完成获取 ${chat.title || 'Unknown'} 的消息，总共找到 ${messages.length} 条当前用户发送的有效消息`);
    return messages;
}

/**
 * 分批删除指定聊天中的消息ID列表。
 *
 * 该函数会将 messageIds 按 CONFIG.BATCH_SIZE 分割成多个批次，逐批调用 client.deleteMessages 删除。
 * - 在多批次时会输出每批次的开始/成功日志并在批次间按 CONFIG.BATCH_DELAY 延迟以避免限流。
 * - 若遇到 FLOOD_WAIT 或可重试错误，会利用 handleFloodWait 实现等待或指数退避重试。
 * - 删除失败时会记录警告并继续处理后续批次，保证整体流程不中断。
 *
 * @param {TelegramClient} client - 已登录的 Telegram 客户端实例
 * @param {Object} chat - 要删除消息的聊天对象（dialog.entity）
 * @param {Array<number>} messageIds - 需要删除的消息 ID 数组
 */
async function deleteMessagesInBatches(client, chat, messageIds) {
    // 如果没有要删除的消息则直接返回
    if (messageIds.length === 0) {
        logProgress('info', `群组 ${chat.title} 中没有需要删除的消息`);
        return;
    }

    logProgress('info', `开始删除群组 ${chat.title} 中的 ${messageIds.length} 条消息`);

    // 计算总批次数以及已删除计数
    const totalBatches = Math.ceil(messageIds.length / CONFIG.BATCH_SIZE);
    let deletedCount = 0;

    // 按批次循环删除
    for (let i = 0; i < messageIds.length; i += CONFIG.BATCH_SIZE) {
        const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
        const batch = messageIds.slice(i, i + CONFIG.BATCH_SIZE);

        try {
            if (totalBatches > 1) {
                logProgress('info', `删除第 ${batchNum}/${totalBatches} 批消息 (${batch.length} 条)`);
            }

            // 调用客户端 API 删除当前批消息，revoke: true 表示撤回对方可见的消息（视权限而定）
            await client.deleteMessages(chat, batch, { revoke: true });

            // 成功则累加删除计数
            deletedCount += batch.length;

            // 输出批次成功日志（多批次时）
            if (totalBatches > 1) {
                logProgress('success', `成功删除第 ${batchNum} 批: ${batch.length} 条消息`);
            }

            // 如果还有后续批次，在批次间等待以降低被限流的风险
            if (totalBatches > 1 && i + CONFIG.BATCH_SIZE < messageIds.length) {
                await sleep(CONFIG.BATCH_DELAY);
            }

        } catch (error) {
            logProgress('error', `删除消息时出错: ${error.message}`);

            // 若为限流或可重试错误，handleFloodWait 会执行等待或退避逻辑并返回 true 表示应重试
            if (await handleFloodWait(error)) {
                // 将循环索引回退一个批次，以便重试当前批次
                i -= CONFIG.BATCH_SIZE;
                continue;
            }

            // 若不可重试，则记录并继续处理下一批，不中断整体流程
            logProgress('warning', `跳过本批消息，继续处理下一批`);
        }
    }

    logProgress('success', `群组 ${chat.title} 总共删除了 ${deletedCount} 条消息`);
}

/**
 * 处理单个群组：获取当前用户在该群组的可删除消息并执行删除操作。
 *
 * 主要流程：
 * 1. 从 dialog.entity 中提取 chat 信息（id、title 等）。
 * 2. 调用 fetchMessagesFromChat 获取当前用户在该群组的所有可删除消息。
 * 3. 若存在消息，调用 deleteMessagesInBatches 分批删除。
 * 4. 在群组之间根据 CONFIG.CHAT_DELAY 添加延迟以降低被限流的风险。
 * 5. 捕获并记录错误，保证单个群组出错不会中断整体流程，返回结构化结果用于汇总统计。
 *
 * @param {TelegramClient} client - 已登录的 Telegram 客户端实例
 * @param {Object} dialog - 对话对象（包含 entity 字段）
 * @param {number|BigInt} currentUserId - 当前用户 ID，用于过滤消息来源
 * @param {number|BigInt} currentUserAccessHash - 当前用户 accessHash，用于某些 API 调用（若可用）
 * @param {number} chatIndex - 当前处理的群组序号（从 1 开始）
 * @param {number} totalChats - 总共需要处理的群组数量
 * @returns {Promise<{chatTitle: string, messageCount: number, error?: string}>}
 */
async function processChat(client, dialog, currentUserId, currentUserAccessHash, chatIndex, totalChats) {
    // 从 dialog.entity 获取聊天对象
    const chat = dialog.entity
    const chatId = chat.id?.toString() || 'Unknown'
    // 优先使用 title；若为私人则拼接 firstName/lastName；兜底为 'Unknown'
    const chatTitle = chat.title || (chat.firstName?.concat(chat.lastName ? ` ${chat.lastName}` : '')) || 'Unknown'

    logProgress('info', `[${chatIndex}/${totalChats}] 处理群组: ${chatTitle} (ID: ${chatId})`)

    try {
        // 拉取当前用户在此群组发送的所有可删除消息（包含分页与限流保护）
        const userMessages = await fetchMessagesFromChat(client, chat, currentUserId, currentUserAccessHash)

        // 如果没有找到任何消息，直接返回并记录日志
        if (userMessages.length === 0) {
            logProgress('info', `群组 ${chatTitle} 中没有当前用户发送的消息`)
            return { chatTitle, messageCount: 0 }
        }

        logProgress('info', `群组 ${chatTitle} 中找到 ${userMessages.length} 条当前用户发送的消息`)

        // 将消息对象映射为 id 列表并分批删除
        const messageIds = userMessages.map(msg => msg.id)
        await deleteMessagesInBatches(client, chat, messageIds)

        // 仅在还有后续群组要处理时添加群组间延迟，避免短时间内处理过多群组导致限流
        if (chatIndex < totalChats) {
            logProgress('info', `等待 ${CONFIG.CHAT_DELAY}ms 后处理下一个群组...`)
            await sleep(CONFIG.CHAT_DELAY)
        }

        // 返回本群组处理结果，供上层汇总统计
        return { chatTitle, messageCount: userMessages.length }

    } catch (error) {
        logProgress('error', `处理群组 ${chatTitle} 时出错: ${error.message}`)
        console.error(error.stack)
        return { chatTitle, messageCount: 0, error: error.message }
    }
}

/**
 * 主流程：删除符合条件的群组中当前用户的历史消息并输出汇总。
 *
 * 功能概述：
 * 1. 验证必要环境变量。
 * 2. 解析监控与排除的群组 ID 配置，确定运行模式（全部/限制）。
 * 3. 初始化并登录 Telegram Client。
 * 4. 获取当前用户信息与所有对话（dialogs）。
 * 5. 过滤 dialogs 得到待处理的群组列表（支持排除列表与监控列表）。
 * 6. 逐个调用 processChat 处理群组（获取消息并分批删除），并在群组间添加延迟以防限流。
 * 7. 汇总并输出处理结果，最后关闭客户端连接。
 *
 * 注意：
 * - 使用 CONFIG 与环境变量控制行为（BATCH_SIZE、BATCH_DELAY、MONITOR_CHAT_IDS 等）。
 * - 对单个群组失败采取局部捕获以保证整体流程继续。
 *
 * @returns {Promise<void>}
 */
async function deleteAllHistory() {
    // 验证配置完整性
    validateConfig()

    // 解析监控与排除列表（从环境变量字符串转为数组）
    const monitorChatIds = parseChatIds(CONFIG.MONITOR_CHAT_IDS, true);
    const notMonitorChatIds = parseChatIds(CONFIG.NOT_MONITOR_CHAT_IDS); // 获取不监控的群组ID
    const isLimitedMode = monitorChatIds.length > 0

    // 创建 Telegram 客户端实例
    const client = new TelegramClient(
        new StringSession(CONFIG.STRING_SESSION),
        parseInt(CONFIG.APP_ID),
        CONFIG.APP_API_HASH,
        CONFIG.CLIENT_OPTIONS
    )

    // 待处理的对话列表（初始化为空）
    let dialogsToProcess = [];

    try {
        // 启动并登录客户端
        logProgress('info', '正在连接到 Telegram...')
        await client.start({
            botAuthToken: () => Promise.resolve(''),
            onError: (err) => logProgress('error', `连接错误: ${err.message}`)
        })
        logProgress('success', '成功连接到 Telegram!')

        // 获取当前用户信息（用于消息过滤）
        const me = await client.getMe()

        // 获取所有对话（包含私聊、群组、频道等）
        const dialogs = await client.getDialogs()

        // 统一的群组过滤器：排除私聊、广播频道与 NOT_MONITOR 列表，并在限制模式下只保留 MONITOR 列表中的群组
        const filterDialogs = (dialogs, mode) => {
            return dialogs.filter(d => {
                const chat = d.entity;
                const chatId = chat.id?.toString();
                
                // 排除明确配置为不监控的群组
                if (notMonitorChatIds.includes(chatId)) {
                    logProgress('info', `跳过不监控的群组: ${chat.title || 'Unknown'} (ID: ${chatId})`);
                    return false;
                }
                
                // 使用通用规则排除私人对话与广播频道
                if (!shouldProcessChat(chat)) {
                    return false;
                }
                
                // 若为限制模式，则仅处理监控列表中的群组
                return !(mode === 'limited' && !monitorChatIds.includes(chatId));
            });
        };

        // 根据运行模式选择过滤策略
        if (CONFIG.DELETE_HISTORY_MODE === 'true') {
            // 全量删除模式：处理所有符合 shouldProcessChat 且不在 NOT_MONITOR 列表中的群组
            dialogsToProcess = filterDialogs(dialogs, 'all');
        } else if (isLimitedMode) {
            // 限制模式：只处理 MONITOR_CHAT_IDS 中列出的群组（并排除 NOT_MONITOR）
            dialogsToProcess = filterDialogs(dialogs, 'limited');
        } else {
            // 默认：处理所有群组（与 deleteHistoryMode 相同的行为）
            dialogsToProcess = filterDialogs(dialogs, 'all');
        }

        // 若没有需要处理的群组，则提前退出
        if (dialogsToProcess.length === 0) {
            logProgress('warning', CONFIG.DELETE_HISTORY_MODE === 'true' 
                ? '未找到任何群组进行处理' 
                : isLimitedMode 
                    ? '未找到匹配的监控群组，请检查 MONITOR_CHAT_IDS 配置' 
                    : '未找到任何群组进行处理');
            return;
        }

        // 输出运行配置信息与模式提示
        logProgress('success', '开始删除 Telegram 历史消息');
        logProgress('info', `配置 - 批量删除大小: ${CONFIG.BATCH_SIZE}, 批次延迟: ${CONFIG.BATCH_DELAY}ms`);
        
        if (CONFIG.DELETE_HISTORY_MODE === 'true') {
            logProgress('info', '模式: 删除所有群组中的历史消息');
        } else if (isLimitedMode) {
            logProgress('info', `限制模式 - 只处理指定的群组: ${monitorChatIds.join(', ')}`);
        }
        
        // 显示被跳过的群组（若有）
        if (notMonitorChatIds.length > 0) {
            logProgress('info', `跳过的群组: ${notMonitorChatIds.join(', ')}`);
        }
        
        logProgress('info', `准备处理 ${dialogsToProcess.length} 个群组`);
        logProgress('info', `当前用户ID: ${me.id}`);

        // 逐个处理群组（串行处理以便更好地控制限流）
        const results = []
        for (let i = 0; i < dialogsToProcess.length; i++) {
            // processChat 内部已包含错误捕获与延迟，返回结构化结果用于汇总
            const result = await processChat(client, dialogsToProcess[i], me.id, me.accessHash, i + 1, dialogsToProcess.length);
            results.push(result);
        }

        // 汇总并输出结果统计
        const totalDeleted = results.reduce((sum, r) => sum + (r.messageCount || 0), 0);
        logProgress('success', `✨ 所有历史消息删除完成！`);
        logProgress('success', `📊 总计删除消息: ${totalDeleted} 条`);
        logProgress('success', `📋 处理群组数量: ${results.length} 个`);
        
        // 列出各群组删除详情（仅显示有删除记录的群组）
        results.filter(r => r.messageCount > 0).forEach(r => {
            logProgress('info', `${r.chatTitle}: ${r.messageCount} 条`);
        })

    } catch (error) {
        // 捕获顶层错误并记录（确保在 finally 中关闭客户端）
        logProgress('error', `执行过程中出错: ${error.message}`);
        console.error(error.stack);
    } finally {
        // 始终尝试关闭客户端连接，释放资源
        try {
            logProgress('info', '正在关闭客户端连接...');
            await client.destroy()
            logProgress('success', '客户端已关闭');
        } catch (destroyError) {
            logProgress('error', `关闭客户端时出错: ${destroyError.message}`);
        }
    }
}

deleteAllHistory()
    .then(() => {
        logProgress('success', '脚本执行完成，准备退出。');
        // 短延迟确保所有日志输出完成后退出
        setTimeout(() => process.exit(0), 200);
    })
    .catch(err => {
        logProgress('error', `致命错误: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    });