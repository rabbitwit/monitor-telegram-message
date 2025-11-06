#!/bin/sh

# 检查 .env 文件是否存在
if [ ! -f ".env" ]; then
  echo "警告: 未找到 .env 文件"
  echo "请确保通过卷挂载提供 .env 文件"
fi

# 检查必要环境变量
if [ -z "$APP_ID" ] || [ -z "$APP_API_HASH" ] || [ -z "$STRING_SESSION" ]; then
  echo "警告: 缺少必要的 Telegram 配置"
  echo "请确保设置了 APP_ID, APP_API_HASH 和 STRING_SESSION"
fi

# 如果没有提供命令参数，则默认运行主监控程序
if [ $# -eq 0 ]; then
  echo "启动 Telegram Message Monitor..."
  exec npm start
else
  echo "执行命令: $@"
  # 执行传入的命令
  exec "$@"
fi