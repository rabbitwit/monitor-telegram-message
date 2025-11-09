import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { appId, apiHash, phone, phoneCodeHash, code } = request.body;

    if (!appId || !apiHash || !phone || !phoneCodeHash || !code) {
      return response.status(400).json({ 
        error: 'Missing required fields: appId, apiHash, phone, phoneCodeHash, code' 
      });
    }

    // 确保参数类型正确
    const appIdStr = appId.toString();
    const apiHashStr = apiHash.toString();
    const phoneStr = phone.toString();
    const codeStr = code.toString();

    // 创建 Telegram 客户端实例
    const client = new TelegramClient(
      new StringSession(""),
      parseInt(appIdStr),
      apiHashStr,
      { 
        connectionRetries: 5,
        useWSS: false
      }
    );

    // 连接到 Telegram 服务器
    await client.connect();

    // 使用验证码完成登录
    const user = await client.signInUser(
      {
        apiId: parseInt(appIdStr),
        apiHash: apiHashStr
      },
      {
        phoneNumber: phoneStr,
        phoneCodeHash: phoneCodeHash,
        phoneCode: () => Promise.resolve(codeStr)
      }
    );

    // 获取 StringSession
    const stringSession = client.session.save();

    // 断开连接
    await client.destroy();

    return response.status(200).json({
      success: true,
      message: '成功生成 StringSession！',
      stringSession: stringSession
    });
  } catch (error) {
    console.error('Error in verify-code:', error);
    return response.status(500).json({ 
      error: 'Error processing verification: ' + error.message 
    });
  }
}