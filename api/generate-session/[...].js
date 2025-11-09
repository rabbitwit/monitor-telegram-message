import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { appId, apiHash, phone } = request.body;

    if (!appId || !apiHash || !phone) {
      return response.status(400).json({ 
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
      parseInt(appIdStr),
      apiHashStr,
      { 
        connectionRetries: 5,
        useWSS: false
      }
    );

    // 连接到 Telegram 服务器
    await client.connect();

    // 发送验证码到用户手机
    const sendResult = await client.sendCode(
      {
        apiId: parseInt(appIdStr),
        apiHash: apiHashStr
      },
      phoneStr
    );

    const phoneCodeHash = sendResult.phoneCodeHash;

    return response.status(200).json({
      success: true,
      message: '验证码已发送到您的 Telegram，请查看消息。',
      phoneCodeHash: phoneCodeHash,
      appId: appIdStr,
      apiHash: apiHashStr,
      phone: phoneStr
    });
  } catch (error) {
    console.error('Error in generate-session:', error);
    return response.status(500).json({ 
      error: 'Error sending code: ' + error.message 
    });
  }
}