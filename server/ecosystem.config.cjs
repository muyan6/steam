module.exports = {
  apps: [
    {
      name: 'steammaster-server',
      script: './dist/server.js',
      instances: 1, // 商业基础版单实例，内存占用极小 (~50MB)
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 1257,
        // 密钥从环境注入；服务端启动时 dotenv 也会自动读取 server/.env。
        // 生成方式见 update.sh 第 3 步提示（一次性写入 server/.env 即可，无需手动 export）
        ADMIN_SECRET: process.env.ADMIN_SECRET,
        JWT_SECRET: process.env.JWT_SECRET
      }
    }
  ]
};
