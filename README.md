# Telegram Session Generator

这是一个用于生成 Telegram Session 的工具，允许用户通过手机号码获取 Telegram 的认证会话。

## 项目结构

```
monitor-telegram-message/
├── telegram-session-frontend/     # 前端 React 应用
├── telegram-backend/              # Express.js 后端实现
│   └── server.js                 # 后端入口文件
├── worker/                       # Cloudflare Workers 实现
│   └── index.js                  # Worker 入口文件
├── wrangler.toml                 # Cloudflare Workers 配置
└── README.md                     # 本说明文件
```

## 功能介绍

该工具通过两步验证流程帮助用户生成 Telegram StringSession：

1. 输入 Telegram API 凭据（API ID、API Hash）和手机号码
2. 输入收到的验证码完成验证
3. 获取 StringSession 字符串用于后续 Telegram API 调用

## 部署选项

本项目支持两种部署方式：

### 1. Cloudflare Workers 部署

使用 [worker/index.js](file:///F:/Development/session/monitor-telegram-message/worker/index.js) 实现，专为 Cloudflare Workers 环境设计。

#### 部署步骤：
```bash
# 构建前端应用
cd telegram-session-frontend
npm run build

# 部署到 Cloudflare Workers
cd ..
npx wrangler deploy
```

#### 特点：
- 使用 Cloudflare Workers API
- 无服务器架构
- 全球分布式部署

### 2. Vercel/传统 Node.js 部署

使用 [telegram-backend/server.js](file:///F:/Development/session/monitor-telegram-message/telegram-backend/server.js) 实现，基于 Express.js 框架。

#### 部署步骤：
```bash
# 构建前端应用
cd telegram-session-frontend
npm run build

# 部署后端服务到 Vercel 或其他 Node.js 平台
cd ../telegram-backend
npm start
```

#### 特点：
- 基于 Express.js 框架
- 适用于各种 Node.js 环境
- 更容易调试和开发

## API 接口

无论使用哪种部署方式，都提供相同的两个 API 接口：

### 1. 生成会话
```
POST /api/generate-session
```

**请求体：**
```json
{
  "appId": "your_api_id",
  "apiHash": "your_api_hash",
  "phone": "your_phone_number"
}
```

**响应：**
```json
{
  "success": true,
  "message": "验证码已发送到您的 Telegram，请查看消息。",
  "phoneCodeHash": "code_hash",
  "clientId": "client_id"
}
```

### 2. 验证代码
```
POST /api/verify-code
```

**请求体：**
```json
{
  "appId": "your_api_id",
  "apiHash": "your_api_hash",
  "phone": "your_phone_number",
  "phoneCodeHash": "received_from_previous_step",
  "code": "verification_code",
  "clientId": "received_from_previous_step"
}
```

**响应：**
```json
{
  "success": true,
  "message": "成功生成 StringSession！",
  "stringSession": "your_string_session"
}
```

## 环境要求

- Node.js >= 14
- Telegram API ID 和 API Hash (可以从 https://my.telegram.org 获取)

## 使用说明

1. 克隆项目
2. 安装依赖：
   ```
   cd telegram-session-frontend && npm install
   cd ../telegram-backend && npm install
   ```
3. 构建前端：
   ```
   cd telegram-session-frontend && npm run build
   ```
4. 根据需要选择部署方式并启动服务

## 注意事项

- 该项目仅用于获取 Telegram StringSession，不存储任何用户凭证
- 请妥善保管生成的 StringSession，它相当于您的 Telegram 登录凭证
- 该工具仅供学习和合法用途使用