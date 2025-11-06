# Telegram Message Monitor

这是一个 Telegram 消息监控和自动删除工具，适用于监控群组里的抽奖信息或其他需要消息通知。

## 功能特性

- 监控指定群组的消息
- 根据关键词过滤消息
- 自动删除过期消息
- 转发重要消息到通知群组
- 消息去重功能
- 心跳检测保持连接稳定
- 一键删除所有群组的历史消息
- 支持通过关键词触发删除之前发送的通知消息

## Docker 安装和使用

项目已发布到 Docker Hub，可以通过 Docker 直接运行，无需构建。

### 1. 创建配置文件

首先创建一个 `.env` 文件，填入必要的配置信息：

```
复制以下内容保存为 .env 文件
```

配置文件内容示例：
```env
# Telegram App ID (从 https://my.telegram.org 获取)
APP_ID=your_app_id_here

# Telegram App API Hash (从 https://my.telegram.org 获取)
APP_API_HASH=your_app_api_hash_here

# Telegram String Session (通过本地脚本生成)
STRING_SESSION=your_string_session_here

# Telegram Bot Token (用于发送通知的机器人)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# 监控的聊天 ID 列表（用逗号分隔）
MONITOR_CHAT_IDS=chat_id1,chat_id2

# 不监控的聊天 ID 列表（用逗号分隔）
NOT_MONITOR_CHAT_IDS=chat_id3,chat_id4

# 通知发送的目标群组ID
NOTIFICATION_CHAT_ID=your_notification_chat_id_here

# 优先监控的用户ID（多个ID用逗号分隔）
TARGET_USER_IDS=user_id1,user_id2

# 用户特定关键词（多个关键词用逗号分隔）
USER_KEYWORDS=keyword1,keyword2

# 通用监控关键词,多个关键词用逗号分隔(默认为空,为空则不监控)
MONITOR_KEYWORDS=your_monitor_keywords_here

# 删除通知消息关键词（多个关键词用逗号分隔）
DELETE_NOTIFICATION_KEYWORDS=your_delete_notification_keywords_here

# 自动删除消息的时间阈值（分钟），默认10分钟，测试时可以设置更小的值,如不需要则设置为0
AUTO_DELETE_MINUTES=10

# 删除历史消息模式，设置为true时将删除监控群组中的历史消息(这个变量是用于独立的一键删除全部群组历史消息的)
DELETE_HISTORY_MODE=false

# 去重窗口（分钟）
DEDUP_WINDOW_MINUTES=60

# 通知 Webhook URL (你想将消息转发到的地址)
NOTIFICATION_WEBHOOK_URL=

# 支持并发扫描群组(删除当日历史消息)
DELETE_CONCURRENCY=3

# 支持分批删除并在批量失败时退到逐条删除
DELETE_BATCH_SIZE=100

# debug 模式，设置为 true 以启用详细日志记录
DEBUG=false
```

### 2. 使用 Docker Compose

使用以下命令运行容器：

创建 `docker-compose.yml` 文件：

```yaml
services:
  monitor-telegram-message:
    image: hareswit2265/monitor-telegram-message
    container_name: monitor-telegram-message
    volumes:
      # 挂载环境变量文件
      - /path/to/your/.env:/app/.env
    environment:
      - NODE_ENV=production
    # 重启策略
    restart: unless-stopped
```

### 3. 运行其他功能脚本

除了主监控程序外，还可以通过 Docker 运行其他功能脚本：

```bash
# 删除所有历史消息
npm run delete-all-history

# 列出所有群组
npm run list-groups
```

**注意**：本项目基于 Alpine Linux 镜像，默认只提供 `sh` shell，不包含 `bash`。在执行交互式命令时，请使用 `sh` 而不是 `bash`。

## 心跳检测和连接管理

程序实现了心跳检测机制，定期发送心跳包以保持与 Telegram 服务器的连接稳定。同时，程序实现了优雅关闭机制，确保在退出时正确断开连接并清理资源。

## 消息去重功能

系统实现了消息去重机制，通过 `DEDUP_WINDOW_MINUTES` 环境变量配置去重时间窗口，避免重复处理相同的消息。

## 删除通知消息功能

系统支持在通知群组中检测特定关键词，并删除之前发送的通知消息。当在通知群组中检测到 `DELETE_NOTIFICATION_KEYWORDS` 环境变量中配置的关键词时，系统会自动删除之前发送的所有通知消息。

此功能特别适用于抽奖红包等场景，当抽奖结束时，可以在群组中发送触发关键词，系统会自动清理之前发送的所有通知消息。

如果配置了 `TELEGRAM_BOT_TOKEN`，系统会使用机器人 API 删除消息；否则会使用当前用户客户端删除消息。

## 一键删除所有群组的历史消息

程序提供了一个独立的脚本 delete-all-history.js，可以一键删除所有群组中由当前用户发送的历史消息。

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

- `DELETE_HISTORY_MODE`: 设置为 'true' 可删除所有群组消息，否则只删除监控列表中的群组(这个变量是独立一键删除全部群组历史消息的)
- `MONITOR_CHAT_IDS`: 指定要删除消息的群组 ID 列表（用逗号分隔）注意:这个变量是和监控消息功能一起调用的
- `NOT_MONITOR_CHAT_IDS`: 指定要排除删除的群组 ID 列表（用逗号分隔）注意:这个变量是和监控消息功能一起调用的
- `DELETE_BATCH_SIZE`: 每批删除的消息数量（默认 100，符合 Telegram 限制）
- `DELETE_CONCURRENC`: 删除消息的并发数

## 注意事项

1. 确保环境变量配置正确
2. 如果启用通知功能，必须同时设置 `TELEGRAM_BOT_TOKEN` 和 `NOTIFICATION_CHAT_ID`
3. 程序具有优雅关闭功能，响应 SIGINT、SIGTERM 和 SIGQUIT 信号
4. 本地运行时，使用持续监听模式
5. 删除通知消息功能需要在监控群组中检测触发关键词才能激活
6. 在 NAS 系统（如飞牛、群晖等）中使用时，建议使用绝对路径而不是 `$(pwd)` 命令

## Github

本项目托管在 Github 上，请访问 [Github](https://github.com/rabbitwit/monitor-telegram-message)