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

async function getAllGroups() {
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
        console.log('正在获取所有对话...')

        // 获取用户参与的所有对话
        const dialogs = await client.getDialogs()
        console.log(`总共获取到 ${dialogs.length} 个对话`)

        console.log('\n=== 所有群组和频道 ===')
        let groupCount = 0
        
        // 遍历所有对话
        for (const dialog of dialogs) {
            try {
                const chat = dialog.entity
                
                // 只处理群组和频道，跳过私人对话
                if (chat.className === 'User') {
                    continue
                }
                
                groupCount++
                const chatId = chat.id.toString()
                const chatTitle = chat.title || (chat.firstName + (chat.lastName ? ' ' + chat.lastName : '')) || 'Unknown Group'
                
                console.log(`\n${groupCount}.`)
                console.log(`   名称: ${chatTitle}`)
                console.log(`   ID: ${chatId}`)
                console.log(`   类型: ${chat.className}`)
                
                // 如果是频道，显示更多信息
                if (chat.className === 'Channel') {
                    console.log(`   用户名: ${chat.username || 'N/A'}`)
                    console.log(`   成员: ${chat.participantsCount || 'N/A'}`)
                }
            } catch (error) {
                console.error('处理对话时出错:', error.message)
            }
        }
        
        console.log(`\n=== 总结 ===`)
        console.log(`共找到 ${groupCount} 个群组/频道`)
        console.log('\n请将需要监控的群组ID添加到 .env 文件中的 MONITOR_CHAT_IDS 变量中')
        console.log('多个ID请用逗号分隔，例如: MONITOR_CHAT_IDS=-123456789,-100987654321')
        console.log('注意：请严格按照上面显示的完整ID格式填写，包括所有的负号和数字')

    } catch (error) {
        console.error('获取群组时出错:', error)
        console.error(error.stack)
    } finally {
        if (client) {
            try {
                await client.destroy()
                console.log('\nTelegram 客户端已关闭')
            } catch (destroyError) {
                console.error('关闭客户端时发生错误:', destroyError)
            }
        }
    }
}

// 运行函数
getAllGroups().catch(console.error)