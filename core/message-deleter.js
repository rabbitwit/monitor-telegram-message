import { normalizeId, parseChatIds } from '../utils/formatUtils.js';
import { isDeletableMessage, compareSenderId, sleep } from '../utils/messageUtils.js';
import { safeGetMe, safeGetEntity } from '../utils/telegramUtil.js';
import { Api } from 'telegram';

/**
 * 删除过期消息（优化版）
 * - 支持并发扫描群组（DELETE_CONCURRENCY）
 * - 支持分批删除（DELETE_BATCH_SIZE）并在批量失败时退到逐条删除
 * - 更稳健的去重与日志
 *
 * 环境变量：
 * AUTO_DELETE_MINUTES (默认 10，设置为0或负数可禁用自动删除功能)
 * NOT_MONITOR_CHAT_IDS
 * DELETE_CONCURRENCY (默认 3)
 * DELETE_BATCH_SIZE (默认 100)
 *
 * @param {TelegramClient} client
 */
export async function deleteExpiredMessages(client) {
    try {
        const isDebug = process.env.DEBUG === 'true';
        
        const AUTO_DELETE_MINUTES = parseInt(process.env.AUTO_DELETE_MINUTES) || 10;
        
        // 如果AUTO_DELETE_MINUTES设置为0或负数，则禁用自动删除功能
        if (AUTO_DELETE_MINUTES <= 0) {
            if (isDebug) {
                console.log('🚫 自动删除功能已禁用 (AUTO_DELETE_MINUTES <= 0)');
            } else {
                console.log('自动删除功能已禁用');
            }
            return;
        }
        
        if (isDebug) {
            console.log('='.repeat(50));
            console.log('开始定期删除过期消息...');
        } else {
            console.log('开始定期删除过期消息...');
        }

        const me = await safeGetMe(client);
        if (!me || !me.id) throw new Error('无法获取当前用户信息');

        const fullUser = await safeGetEntity(client, me.id);
        if (!fullUser) throw new Error('无法获取完整用户实体');

        const nowTimestamp = Math.floor(Date.now() / 1000);
        const cutoffTime = nowTimestamp - AUTO_DELETE_MINUTES * 60;
        
        if (isDebug) {
            const cutoffDate = new Date(cutoffTime * 1000);
            console.log(`当前时间: ${new Date(nowTimestamp * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
            console.log(`过期阈值: ${cutoffDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
            console.log(`AUTO_DELETE_MINUTES: ${AUTO_DELETE_MINUTES} 分钟\n`);
        }

        // 不监控群组
        const notMonitorChatIdsRaw = process.env.NOT_MONITOR_CHAT_IDS;
        const notMonitorChatIds = parseChatIds(notMonitorChatIdsRaw);

        // 获取所有对话（若对话很多，可考虑分页获取）
        const dialogs = await client.getDialogs();

        const groupDialogs = dialogs.filter(dialog => {
            const chat = dialog.entity;
            if (!chat) return false;
            if (chat.className === 'User') return false;
            if (chat.className === 'Channel' && chat.broadcast === true) return false;
            const chatId = normalizeId(chat.id);
            if (!chatId) return false;
            if (notMonitorChatIds.includes(chatId)) {
                if (isDebug) {
                    console.log(`⏭️  跳过不监控的群组: ${chat.title || 'Unknown'} (ID: ${chat.id})`);
                }
                return false;
            }
            return true;
        });

        if (isDebug) {
            console.log('');
            if (notMonitorChatIds.length > 0) {
                console.log(`🚫 不监控的群组数量: ${notMonitorChatIds.length} 个`);
            } else {
                console.log(`🌐 处理所有群组（无排除列表）`);
            }
            console.log(`✅ 共 ${groupDialogs.length} 个群组需要检查\n`);
        }

        if (groupDialogs.length === 0) {
            if (isDebug) {
                console.log('⚠️  没有符合条件的群组需要处理\n');
            } else {
                console.log('没有符合条件的群组需要处理');
            }
            return;
        }

        // 获取最近消息（实时）
        async function getRecentMessagesRealtime(client, chat, myUserId, cutoffTime) {
            const recentMessages = [];
            const RECENT_LIMIT = 200;
            try {
                const messages = await client.getMessages(chat, { limit: RECENT_LIMIT });
                if (!messages || messages.length === 0) return [];
                for (const msg of messages) {
                    if (!msg) continue;
                    // 只处理最近10分钟内的消息（用于快速捕获）
                    if (msg.date < Math.floor(Date.now() / 1000) - 600) break;
                    if (!isDeletableMessage(msg)) continue;
                    let isMyMessage = false;
                    try {
                        isMyMessage = compareSenderId(msg.senderId, myUserId);
                    } catch {
                        isMyMessage = false;
                    }
                    if (isMyMessage && msg.date < cutoffTime) recentMessages.push(msg);
                }
                return recentMessages;
            } catch (error) {
                if (isDebug) {
                    console.error(`  ⚠️  getMessages 失败: ${error.message}`);
                }
                return [];
            }
        }

        // 使用 messages.Search 查找历史消息（分页）
        async function searchOlderMessages(client, chat, userId, userAccessHash, cutoffTime, todayStartTimestamp) {
            const olderMessages = [];
            let offsetId = 0;
            const pageSize = 100;
            const maxPages = 10;
            let pageNum = 0;
            const searchMaxDate = Math.floor(Date.now() / 1000) - 600;
            try {
                while (pageNum < maxPages) {
                    const result = await client.invoke(
                        new Api.messages.Search({
                            peer: chat,
                            q: '',
                            filter: new Api.InputMessagesFilterEmpty({}),
                            fromId: new Api.InputPeerUser({
                                userId: userId,
                                accessHash: userAccessHash
                            }),
                            minDate: todayStartTimestamp,
                            maxDate: searchMaxDate,
                            limit: pageSize,
                            offsetId,
                            addOffset: 0,
                            maxId: 0,
                            minId: 0,
                            hash: BigInt(0)
                        })
                    );

                    const messages = Array.isArray(result.messages) ? result.messages : (result?.messages || []);
                    if (!messages || messages.length === 0) break;
                    pageNum++;

                    const expiredOnes = messages.filter(msg => isDeletableMessage(msg) && msg.date < cutoffTime);
                    olderMessages.push(...expiredOnes);

                    offsetId = messages[messages.length - 1]?.id || 0;
                    if (messages.length < pageSize) break;
                    await sleep(200);
                }
                return olderMessages;
            } catch (error) {
                if (isDebug) {
                    console.error(`  ⚠️  search 失败: ${error.message}`);
                }
                return [];
            }
        }

        // 并发批处理器（简单实现）
        async function runInBatches(tasks, concurrency) {
            for (let i = 0; i < tasks.length; i += concurrency) {
                const batch = tasks.slice(i, i + concurrency).map(fn => fn());
                await Promise.all(batch);
            }
        }

        // 安全删除：先批量删除，失败退到逐条删除
        async function safeDeleteMessages(client, chat, ids) {
            try {
                await client.deleteMessages(chat, ids, { revoke: true });
                return { deleted: ids.length, failed: 0 };
            } catch (err) {
                if (isDebug) {
                    console.warn(`    ⚠️ 批量删除失败，退到逐条删除: ${err.message}`);
                }
                let deleted = 0;
                let failed = 0;
                for (const id of ids) {
                    try {
                        await client.deleteMessages(chat, [id], { revoke: true });
                        deleted++;
                    } catch (e) {
                        failed++;
                        if (isDebug) {
                            console.debug(`      ❌ 删除消息 ${id} 失败: ${e.message}`);
                        }
                    }
                    await sleep(120);
                }
                return { deleted, failed };
            }
        }

        // 构建每个群组的扫描任务
        const tasks = groupDialogs.map((dialog, index) => async () => {
            const chat = dialog.entity;
            const chatTitle = chat.title || (chat.firstName ? `${chat.firstName}${chat.lastName ? ' ' + chat.lastName : ''}` : 'Unknown');
            try {
                if (isDebug) {
                    console.log(`📍 [${index + 1}/${groupDialogs.length}] 群组: ${chatTitle}`);
                }

                const [recentExpired, olderExpired] = await Promise.all([
                    getRecentMessagesRealtime(client, chat, fullUser.id, cutoffTime),
                    searchOlderMessages(client, chat, fullUser.id, fullUser.accessHash, cutoffTime, 0)
                ]);

                // 合并并去重（以 id 为准）
                const map = new Map();
                for (const msg of [...recentExpired, ...olderExpired]) {
                    const mid = Number(msg.id);
                    if (!map.has(mid)) map.set(mid, msg);
                }
                const allExpiredMessages = Array.from(map.values());

                if (isDebug) {
                    if (allExpiredMessages.length > 0) {
                        console.log(`  ✓ 找到 ${allExpiredMessages.length} 条过期消息 (最近: ${recentExpired.length}, 历史: ${olderExpired.length})`);
                        allExpiredMessages.slice(0, 3).forEach(msg => {
                            const msgTime = new Date(msg.date * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                            const msgType = msg.message ? '文本' : msg.media ? '媒体' : '其他';
                            console.log(`    · ID: ${msg.id}, 时间: ${msgTime}, 类型: ${msgType}`);
                        });
                        if (allExpiredMessages.length > 3) {
                            console.log(`    · ... 还有 ${allExpiredMessages.length - 3} 条`);
                        }
                    } else {
                        console.log('  · 无过期消息');
                    }
                }

                return { chat, chatTitle, expiredMessages: allExpiredMessages };
            } catch (error) {
                if (isDebug) {
                    console.error(`  ❌ 处理失败: ${error.message}`);
                }
                return { chat, chatTitle, expiredMessages: [] };
            }
        });

        const DELETE_CONCURRENCY = Math.max(1, parseInt(process.env.DELETE_CONCURRENCY) || 3);
        const scanResults = [];
        // 分批并发执行扫描任务
        await runInBatches(tasks.map(fn => async () => {
            const res = await fn();
            scanResults.push(res);
        }), DELETE_CONCURRENCY);

        if (isDebug) {
            console.log('\n' + '-'.repeat(50));
            console.log('开始删除过期消息...\n');
        }

        // 删除阶段
        let totalDeleted = 0;
        let totalFailed = 0;
        const DELETE_BATCH_SIZE = Math.max(1, parseInt(process.env.DELETE_BATCH_SIZE) || 100);

        for (const res of scanResults) {
            const { chat, chatTitle, expiredMessages } = res;
            if (!expiredMessages || expiredMessages.length === 0) continue;

            const messageIds = expiredMessages.map(m => Number(m.id));
            try {
                let groupDeleted = 0;
                let groupFailed = 0;
                for (let i = 0; i < messageIds.length; i += DELETE_BATCH_SIZE) {
                    const batch = messageIds.slice(i, i + DELETE_BATCH_SIZE);
                    const { deleted, failed } = await safeDeleteMessages(client, chat, batch);
                    groupDeleted += deleted;
                    groupFailed += failed;
                    totalDeleted += deleted;
                    totalFailed += failed;
                    // 小间隔以防限速
                    await sleep(150);
                }
                
                // 调试模式显示详细信息，非调试模式只显示关键信息
                if (isDebug) {
                    console.log(`✅ 群组 ${chatTitle}: 处理完成 (发现: ${messageIds.length})`);
                } else {
                    // 只显示关键信息：群组名、删除数量、是否成功
                    if (groupFailed > 0) {
                        console.log(`群组 "${chatTitle}" 删除完成: 成功 ${groupDeleted} 条, 失败 ${groupFailed} 条`);
                    } else {
                        console.log(`✅ 群组 "${chatTitle}" 删除完成: 成功删除 ${groupDeleted} 条消息`);
                    }
                }
            } catch (err) {
                if (isDebug) {
                    console.error(`❌ 群组 ${chatTitle}: 删除失败 - ${err.message}`);
                } else {
                    console.error(`群组 "${chatTitle}" 删除失败: ${err.message}`);
                }
            }
        }

        if (totalDeleted === 0 && totalFailed === 0) {
            console.log(`✅ 没有找到可删除的群组消息。`);
        } else {
            if (isDebug) {
                console.log('\n' + '='.repeat(50));
                console.log(`✨ 删除完成！成功: ${totalDeleted} 条${totalFailed > 0 ? `, 失败: ${totalFailed} 条` : ''}`);
                console.log('='.repeat(50) + '\n');
            } else {
                console.log(`✨ 全部删除完成：成功 ${totalDeleted} 条${totalFailed > 0 ? `, 失败 ${totalFailed} 条` : ''}`);
            }
        }
    } catch (error) {
        if (process.env.DEBUG === 'true') {
            console.error('❌ 删除过期消息时出错:', error);
            console.error(error.stack);
        } else {
            console.error('删除过期消息时出错:', error.message);
        }
    }
}
