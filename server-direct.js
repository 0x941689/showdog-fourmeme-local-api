// 完全独立的启动器 - 不依赖dotenv
const fs = require('fs');
const path = require('path');

// 手动加载环境变量
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          const value = trimmed.substring(equalIndex + 1).trim().replace(/^['"]|['"]$/g, '');
          process.env[key] = value;
        }
      }
    });
  }
}

// 加载环境变量
loadEnv();

// 修改console.log来临时隐藏dotenv输出
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  const message = args.join(' ');
  if (!message.includes('[dotenv@') && !message.includes('injecting env') && !message.includes('tip:')) {
    originalLog.apply(console, args);
  }
};

console.error = function(...args) {
  const message = args.join(' ');
  if (!message.includes('[dotenv@') && !message.includes('injecting env') && !message.includes('tip:')) {
    originalError.apply(console, args);
  }
};

// 运行服务器
require('./dist/src/api/server.js');