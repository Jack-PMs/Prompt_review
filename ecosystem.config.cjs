const fs = require('node:fs');
const path = require('node:path');

// 读取本地 .env 注入 PM2 生产进程环境变量
function loadDotEnv() {
  const envFile = path.resolve(__dirname, '.env');
  const vars = { NODE_ENV: 'production' };
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      vars[key] = val;
    }
  }
  return vars;
}

const logDir = path.resolve(__dirname, 'data/logs');
fs.mkdirSync(logDir, { recursive: true });

module.exports = {
  apps: [
    {
      name: 'prompt-enhance-6770',
      cwd: __dirname,
      script: './node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 6770',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      max_memory_restart: '1G',
      out_file: path.join(logDir, 'pm2-out.log'),
      error_file: path.join(logDir, 'pm2-error.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: loadDotEnv(),
    },
  ],
};
