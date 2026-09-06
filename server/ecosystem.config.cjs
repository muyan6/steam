module.exports = {
  apps: [
    {
      name: 'steammaster-server',
      script: './dist/server.js',
      instances: 1, // 商业基础版单实例；密钥库+游戏库常驻约 130-180MB
      autorestart: true,
      watch: false,
      // 数据稳定占用 ~130MB，每日定时同步解析 18MB 密钥库时存在瞬时尖峰，
      // 阈值过低会把同步中的进程强杀（表现为服务随机重启），给足一倍余量
      max_memory_restart: '512M',
      // 收紧 V8 老生代上限：数据规模固定时让 GC 提前介入，
      // 避免低负载下堆长期缓慢膨胀（RSS 稳定在 ~200MB 内）
      node_args: '--max-old-space-size=384',
      env: {
        NODE_ENV: 'production',
        PORT: 1257,
        // 密钥从环境注入；服务端启动时 dotenv 也会自动读取 server/.env。
        // 生成方式见 update.sh 第 3 步提示（一次性写入 server/.env 即可，无需手动 export）
        JWT_SECRET: process.env.JWT_SECRET,
        // 反向代理部署时配置（true / 1 / 代理层数 / IP），限流与审计才能取到真实客户端 IP
        TRUST_PROXY: process.env.TRUST_PROXY
      }
    }
  ]
};
