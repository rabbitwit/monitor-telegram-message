#!/usr/bin/env node

/**
 * 健康检查脚本
 * 用于 Docker 容器健康检查
 */

import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';

// 加载环境变量
config();

// 检查基本文件是否存在
const requiredFiles = ['.env'];
const missingFiles = requiredFiles.filter(file => !fs.existsSync(path.join(process.cwd(), file)));

if (missingFiles.length > 0) {
  console.log(`Missing required files: ${missingFiles.join(', ')}`);
  process.exit(1);
}

// 检查必要环境变量
const requiredEnvVars = ['APP_ID', 'APP_API_HASH', 'STRING_SESSION'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.log(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// 检查环境变量格式
if (process.env.APP_ID && isNaN(process.env.APP_ID)) {
  console.log('APP_ID must be a number');
  process.exit(1);
}

console.log('Health check passed');
process.exit(0);