# 使用官方 Node.js 运行时作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安装项目依赖
RUN npm ci --omit=dev

# 复制项目文件
COPY . .

# 设置执行权限
RUN chmod +x ./docker-entrypoint.sh

# 指定入口点
ENTRYPOINT ["./docker-entrypoint.sh"]

# 创建环境变量文件（如果不存在）
RUN touch .env

# 暴露端口（如果需要）
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD npm run healthcheck || exit 1

# 启动应用
CMD ["npm", "start"]