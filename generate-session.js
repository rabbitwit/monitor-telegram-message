import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import readline from 'readline';

// 加载 .env 文件
import { config } from 'dotenv';
config()

// 从环境变量获取配置
const APP_ID = parseInt(process.env.APP_ID);
const APP_API_HASH = process.env.APP_API_HASH;
const USER_PHONE = 'your_phone';

// 创建 readline 接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function generateStringSession() {
    if (!APP_ID || !APP_API_HASH || !USER_PHONE) {
        console.error('请设置环境变量: APP_ID, APP_API_HASH, USER_PHONE')
        process.exit(1)
    }

    console.log('正在创建客户端...')

    // 创建 Telegram 客户端
    const client = new TelegramClient(
        new StringSession(""),
        APP_ID,
        APP_API_HASH,
        { connectionRetries: 5 }
    )

    await client.start({
        phoneNumber: USER_PHONE,
        password: async () => {
            return new Promise((resolve) => {
                rl.question('请输入密码: ', (password) => {
                    resolve(password);
                });
            });
        },
        phoneCode: async () => {
            return new Promise((resolve) => {
                rl.question('请输入收到的验证码: ', (code) => {
                    resolve(code);
                });
            });
        },
        onError: (err) => console.error(err),
    })

    console.log('您已成功登录!')
    console.log('STRING_SESSION:')
    console.log(client.session.save())
    
    rl.close();
    await client.destroy()
    process.exit(0)
}

// 运行脚本
generateStringSession().catch(console.error)