import express, { json } from 'express';
import cors from 'cors';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(json());

// 存储客户端实例的 Map
const clientStore = new Map();

// API 路由
app.post('/api/generate-session', async (req, res) => {
  try {
    const { appId, apiHash, phone } = req.body;

    if (!appId || !apiHash || !phone) {
      return res.status(400).json({ 
        error: 'Missing required fields: appId, apiHash, phone' 
      });
    }

    // 确保参数类型正确
    const appIdStr = appId.toString();
    const apiHashStr = apiHash.toString();
    const phoneStr = phone.toString();
    
    // 创建 Telegram 客户端实例
    const client = new TelegramClient(
      new StringSession(""),
      parseInt(appIdStr),  // apiId 需要是一个数字
      apiHashStr,          // apiHash 需要是一个字符串
      { 
        connectionRetries: 5,
        useWSS: false
      }
    );

    // 连接到 Telegram 服务器
    await client.connect();

    // 发送验证码到用户手机
    // 使用正确的参数形式
    const sendResult = await client.sendCode(
      {
        apiId: parseInt(appIdStr),
        apiHash: apiHashStr
      },
      phoneStr
    );
    
    // 注意：sendCode 返回的是一个包含 phoneCodeHash 和 isCodeViaApp 的对象
    const phoneCodeHash = sendResult.phoneCodeHash;

    // 存储客户端实例，以便后续使用
    const clientId = Date.now().toString();
    clientStore.set(clientId, { client, phone: phoneStr, appId: appIdStr, apiHash: apiHashStr });

    return res.json({
      success: true,
      message: '验证码已发送到您的 Telegram，请查看消息。',
      phoneCodeHash: phoneCodeHash,
      clientId: clientId
    });
  } catch (error) {
    console.error('Error in generate-session:', error);
    return res.status(500).json({ 
      error: 'Error sending code: ' + error.message 
    });
  }
});

app.post('/api/verify-code', async (req, res) => {
  try {
    const { appId, apiHash, phone, phoneCodeHash, code, clientId } = req.body;

    if (!appId || !apiHash || !phone || !phoneCodeHash || !code || !clientId) {
      return res.status(400).json({ 
        error: 'Missing required fields: appId, apiHash, phone, phoneCodeHash, code, clientId' 
      });
    }

    // 确保参数类型正确
    const appIdStr = appId.toString();
    const apiHashStr = apiHash.toString();
    const phoneStr = phone.toString();
    const codeStr = code.toString();

    // 获取存储的客户端实例
    const storedClient = clientStore.get(clientId);
    if (!storedClient) {
      return res.status(400).json({ 
        error: 'Client session not found or expired' 
      });
    }

    const { client } = storedClient;

    // 使用验证码完成登录
    // 使用正确的 signInUser 方法，并提供必要的回调函数
    const user = await client.signInUser(
      {
        apiId: parseInt(appIdStr),
        apiHash: apiHashStr
      },
      {
        phoneNumber: phoneStr,
        phoneCodeHash: phoneCodeHash,
        phoneCode: () => Promise.resolve(codeStr),
        onError: (err) => {
          console.error('Telegram authentication error:', err);
          return Promise.resolve(false); // 返回 false 表示继续尝试
        }
      }
    );

    // 获取 StringSession
    const stringSession = client.session.save();
    
    // 断开连接并清理存储的客户端实例
    await client.destroy();
    clientStore.delete(clientId);
    
    return res.json({
      success: true,
      message: '成功生成 StringSession！',
      stringSession: stringSession
    });
  } catch (error) {
    console.error('Error in verify-code:', error);
    return res.status(500).json({ 
      error: 'Error processing verification: ' + error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Telegram backend server is running on port ${PORT}`);
});