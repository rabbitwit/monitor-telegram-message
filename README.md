# Telegram Message Monitor

这是一个 Telegram 消息监控和自动删除工具，仅支持本地运行。

## 功能特性

- 监控指定群组的消息
- 根据关键词过滤消息
- 自动删除过期消息
- 转发重要消息到通知群组
- 消息去重功能
- 心跳检测保持连接稳定
- 一键删除所有群组的历史消息
- 支持通过关键词触发删除之前发送的通知消息

## 环境变量配置

### 必需配置
- `APP_ID`: Telegram 应用 ID (从 https://my.telegram.org 获取)
- `APP_API_HASH`: Telegram 应用 API Hash (从 https://my.telegram.org 获取)
- `STRING_SESSION`: Telegram 字符串会话 (通过本地脚本生成)

### 通知功能配置
- `TELEGRAM_BOT_TOKEN`: Telegram Bot Token (用于发送通知，如果设置了通知功能则必需)
- `NOTIFICATION_CHAT_ID`: 通知发送的目标群组 ID (如果设置了通知功能则必需)

### 删除通知消息功能配置
- `DELETE_NOTIFICATION_KEYWORDS`: 触发删除通知消息的关键词（用逗号分隔），当在通知群组中检测到这些关键词时，会删除之前发送的通知消息

### 自动删除消息功能配置
- `AUTO_DELETE_MINUTES`: 自动删除消息的时间阈值（分钟），设置为0或负数可完全禁用自动删除功能

### 可选配置
- `MONITOR_CHAT_IDS`: 监控的聊天 ID 列表（用逗号分隔）
- `NOT_MONITOR_CHAT_IDS`: 不监控的聊天 ID 列表（用逗号分隔）
- `MONITOR_KEYWORDS`: 监控关键词（用逗号分隔）
- `TARGET_USER_IDS`: 优先监控的用户 ID 列表
- `USER_KEYWORDS`: 用户特定关键词
- `DEDUP_WINDOW_MINUTES`: 去重窗口（分钟）
- `NOTIFICATION_WEBHOOK_URL`: 通知 Webhook URL
- `DELETE_HISTORY_MODE`: 删除历史消息模式
- `DELETE_MESSAGES_LIMIT`: 删除消息数量限制
- `DELETE_CONCURRENC`: 删除消息并发数
- `DELETE_BATCH_SIZE`: 批量删除消息数量

## Docker 安装和使用

项目已发布到 Docker Hub，可以通过 Docker 直接运行，无需构建。

### 1. 创建配置文件

首先创建一个 `.env` 文件，填入必要的配置信息：

```bash
# 创建配置文件
touch .env
# 编辑配置文件，填入你的配置
nano .env
```

配置文件内容示例：
```env
# 必需配置
APP_ID=your_app_id
APP_API_HASH=your_api_hash
STRING_SESSION=your_string_session

# 通知功能配置（可选）
TELEGRAM_BOT_TOKEN=your_bot_token
NOTIFICATION_CHAT_ID=your_notification_chat_id

# 删除通知消息功能配置（可选）
DELETE_NOTIFICATION_KEYWORDS=参与人数够啦！！开奖~,红包ID： 123

# 其他可选配置
AUTO_DELETE_MINUTES=10
MONITOR_CHAT_IDS=chat_id1,chat_id2
MONITOR_KEYWORDS=keyword1,keyword2
```

### 2. 运行容器

使用以下命令运行容器：

```bash
# 基本运行方式
docker run -d \
  --name monitor-telegram-message \
  --restart unless-stopped \
  -v $(pwd)/.env:/app/.env \
  hareswit2265/monitor-telegram-message

# 查看运行日志
docker logs -f monitor-telegram-message
```

### 3. 运行其他功能脚本

除了主监控程序外，还可以通过 Docker 运行其他功能脚本：

```bash
# 删除所有历史消息
docker run --rm -v $(pwd)/.env:/app/.env hareswit2265/monitor-telegram-message npm run delete-all-history

# 列出所有群组
docker run --rm -v $(pwd)/.env:/app/.env hareswit2265/monitor-telegram-message npm run list-groups

# 在容器中执行 shell（注意：Alpine Linux 默认使用 sh 而不是 bash）
docker exec -it monitor-telegram-message sh
```

### 4. 使用 Docker Compose（推荐）

创建 `docker-compose.yml` 文件：

```yaml
version: '3.8'
services:
  monitor-telegram-message:
    image: hareswit2265/monitor-telegram-message
    container_name: monitor-telegram-message
    volumes:
      # 挂载环境变量文件
      - ./.env:/app/.env
    environment:
      - NODE_ENV=production
    # 重启策略
    restart: unless-stopped
```

启动服务：
```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

**注意**：本项目基于 Alpine Linux 镜像，默认只提供 `sh` shell，不包含 `bash`。在执行交互式命令时，请使用 `sh` 而不是 `bash`：

```bash
# 正确的方式
docker exec -it monitor-telegram-message sh

# 错误的方式（在Alpine中会报错）
docker exec -it monitor-telegram-message bash
```

**NAS 系统用户注意事项**：
在 NAS 系统（如飞牛、群晖等）中使用时，建议使用绝对路径而不是 `$(pwd)` 命令：

```bash
# 推荐方式（替换 /path/to/your 为实际路径）
docker run -d \
  --name monitor-telegram-message \
  --restart unless-stopped \
  -v /path/to/your/.env:/app/.env \
  hareswit2265/monitor-telegram-message
```

## 本地运行

如果您不想使用 Docker，也可以直接在本地运行：

1. 安装依赖:
   ```bash
   npm install
   ```

2. 配置环境变量:
   ```bash
   cp .env.example .env
   # 编辑 .env 文件填入你的配置
   ```

3. 启动监控:
   ```bash
   npm start
   ```

## 心跳检测和连接管理

程序实现了心跳检测机制，定期发送心跳包以保持与 Telegram 服务器的连接稳定。同时，程序实现了优雅关闭机制，确保在退出时正确断开连接并清理资源。

## 消息去重功能

系统实现了消息去重机制，通过 `DEDUP_WINDOW_MINUTES` 环境变量配置去重时间窗口，避免重复处理相同的消息。

## 删除通知消息功能

系统支持在通知群组中检测特定关键词，并删除之前发送的通知消息。当在通知群组中检测到 `DELETE_NOTIFICATION_KEYWORDS` 环境变量中配置的关键词时，系统会自动删除之前发送的所有通知消息。

此功能特别适用于抽奖红包等场景，当抽奖结束时，可以在群组中发送触发关键词，系统会自动清理之前发送的所有通知消息。

如果配置了 `TELEGRAM_BOT_TOKEN`，系统会使用机器人 API 删除消息；否则会使用当前用户客户端删除消息。

## 一键删除所有群组的历史消息

程序提供了一个独立的脚本 [delete-all-history.js](file:///f:/Development/monitor-telegram-message/delete-all-history.js)，可以一键删除所有群组中由当前用户发送的历史消息。

### 使用方法

```bash
npm run delete-all-history
```

### 功能特点

- 自动扫描所有群组和频道
- 只删除当前用户发送的消息
- 智能处理 Telegram 的频率限制（Flood Wait）
- 支持配置要处理或排除的特定群组
- 分批删除确保稳定性和安全性

### 配置选项

- `DELETE_HISTORY_MODE`: 设置为 'true' 可删除所有群组消息，否则只删除监控列表中的群组
- `MONITOR_CHAT_IDS`: 指定要删除消息的群组 ID 列表（用逗号分隔）
- `NOT_MONITOR_CHAT_IDS`: 指定要排除删除消息的群组 ID 列表（用逗号分隔）
- `DELETE_BATCH_SIZE`: 每批删除的消息数量（默认 100，符合 Telegram 限制）
- `DELETE_CONCURRENC`: 删除消息的并发数

## 注意事项

1. 确保环境变量配置正确
2. 如果启用通知功能，必须同时设置 `TELEGRAM_BOT_TOKEN` 和 `NOTIFICATION_CHAT_ID`
3. 程序具有优雅关闭功能，响应 SIGINT、SIGTERM 和 SIGQUIT 信号
4. 本地运行时，使用持续监听模式
5. 删除通知消息功能需要在通知群组中发送触发关键词才能激活
6. 在 NAS 系统（如飞牛、群晖等）中使用时，建议使用绝对路径而不是 `$(pwd)` 命令