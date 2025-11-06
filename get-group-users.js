import { config } from 'dotenv'
config()

import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'

// 从环境变量获取配置
const APP_ID = process.env.APP_ID
const APP_API_HASH = process.env.APP_API_HASH
const STRING_SESSION = process.env.STRING_SESSION

if (!APP_ID || !APP_API_HASH || !STRING_SESSION) {
    console.error('请确保在 .env 文件中设置了 APP_ID, APP_API_HASH 和 STRING_SESSION')
    process.exit(1)
}

async function getGroupUsers() {
    console.log('正在创建 Telegram 客户端...')

    // 创建 Telegram 客户端
    const client = new TelegramClient(
        new StringSession(STRING_SESSION),
        parseInt(APP_ID),
        APP_API_HASH,
        { 
            connectionRetries: 3,
            timeout: 10000,
            retryDelay: 2000,
            autoReconnect: true
        }
    )

    try {
        // 连接到 Telegram
        await client.start({
            botAuthToken: () => Promise.resolve(""),
            onError: (err) => console.error(err)
        })

        console.log('成功连接到 Telegram!')
        
        // 获取指定群组的成员信息
        const groupId = '-1002131053667';
        console.log(`正在获取群组 ${groupId} 的成员信息...`)
        
        try {
            // 获取群组实体
            const groupEntity = await client.getEntity(groupId);
            console.log('群组信息:', groupEntity.title || 'Unknown Group');
            
            // 获取群组成员
            const participants = await client.getParticipants(groupEntity);
            
            console.log(`\n群组成员总数: ${participants.length}`);
            console.log('\n成员列表:');
            console.log('====================================');
            
            for (let i = 0; i < participants.length; i++) {
                const participant = participants[i];
                console.log(`\n成员 ${i + 1}:`);
                console.log(`  ID: ${participant.id}`);
                console.log(`  First Name: ${participant.firstName || 'N/A'}`);
                console.log(`  Last Name: ${participant.lastName || 'N/A'}`);
                console.log(`  Username: ${participant.username || 'N/A'}`);
                console.log(`  Phone: ${participant.phone || 'N/A'}`);
            }
            
            console.log('\n====================================');
            console.log('成员信息获取完成');
            
        } catch (groupError) {
            console.error(`获取群组 ${groupId} 信息时出错:`, groupError);
        }
        
    } catch (error) {
        console.error('获取群组成员时出错:', error)
    } finally {
        // 关闭客户端
        if (client) {
            try {
                await client.destroy()
                console.log('Telegram 客户端已关闭')
            } catch (destroyError) {
                console.error('关闭客户端时发生错误:', destroyError)
            }
        }
    }
}

// 执行获取群组成员信息
getGroupUsers().catch(console.error)