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
        PORT: 1257
      },
      // 安全策略：密钥不再写入配置文件，pm2 启动前必须先在环境中设置：
      //   export ADMIN_SECRET=<随机强密钥>
      //   export JWT_SECRET=<随机强密钥>
      // 生成方式：node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
      // 缺少任一环境变量时服务端会拒绝启动（防止使用弱默认值）
    }
  ]
};
