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
        ADMIN_SECRET: 'steammaster_admin_8888'
      }
    }
  ]
};
