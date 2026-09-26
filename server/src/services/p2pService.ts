import { P2pGamePreset, P2pConfigResponse } from '../types/index.js';

export const P2P_DEFAULT_PRESETS: P2pGamePreset[] = [
  {
    id: 'palworld',
    name: '幻兽帕鲁 (专用服务器)',
    remotePort: 8211,
    localPort: 8212,
    protocol: 'udp',
    category: '热门自建服',
    note: '连接成功后，在游戏内加入多人游戏，输入 127.0.0.1:8212 直连',
  },
  {
    id: 'minecraft_java',
    name: '我的世界 Minecraft (Java 版)',
    remotePort: 25565,
    localPort: 25565,
    protocol: 'tcp',
    category: '经典联机',
    note: '连接成功后，在多人游戏添加服务器地址 127.0.0.1:25565',
  },
  {
    id: 'terraria',
    name: '泰拉瑞亚 Terraria',
    remotePort: 7777,
    localPort: 7776,
    protocol: 'tcp',
    category: '经典联机',
    note: '房主开启多人游戏Host，客机通过 IP 加入输入 127.0.0.1 端口 7776',
  },
  {
    id: 'dont_starve',
    name: '饥荒联机版 (局域网直连)',
    remotePort: 10999,
    localPort: 10999,
    protocol: 'udp',
    category: '生存冒险',
    note: '在游戏控制台输入 c_connect("127.0.0.1", 10999) 即可一键加入',
  },
  {
    id: 'stardew_valley',
    name: '星露谷物语 (IP 直连)',
    remotePort: 24642,
    localPort: 24641,
    protocol: 'udp',
    category: '休闲农场',
    note: '房主需开启允许IP连接并建好小屋，客机输入 127.0.0.1:24641 加入',
  },
  {
    id: 'enshrouded',
    name: '雾锁王国 Enshrouded',
    remotePort: 15636,
    localPort: 15637,
    protocol: 'udp',
    category: '生存冒险',
    note: '连接成功后通过本地专用服端口 127.0.0.1:15637 直连',
  },
  {
    id: 'seven_days_to_die',
    name: '七日杀 7 Days to Die',
    remotePort: 26900,
    localPort: 26900,
    protocol: 'udp',
    category: '生存冒险',
    note: '房主设置为公开，客机在加入游戏底部输入 IP 127.0.0.1 端口 26900',
  },
  {
    id: 'unturned',
    name: '未转变者 Unturned',
    remotePort: 25444,
    localPort: 25444,
    protocol: 'udp',
    category: '末日生存',
    note: '通过 IP 127.0.0.1 端口 25444 进入游戏',
  },
  {
    id: 'risk_of_rain',
    name: '雨中冒险 2 Risk of Rain 2',
    remotePort: 7777,
    localPort: 7777,
    protocol: 'udp',
    category: '肉鸽动作',
    note: '通过控制台或直接连接 127.0.0.1:7777',
  },
  {
    id: 'civ6',
    name: '文明 6 (局域网对战)',
    remotePort: 27016,
    localPort: 27016,
    protocol: 'udp',
    category: '策略回合',
    note: '局域网大厅直连或输入 127.0.0.1:27016',
  },
  {
    id: 'custom',
    name: '自定义游戏端口',
    remotePort: 8080,
    localPort: 8080,
    protocol: 'tcp',
    category: '通用自定义',
    note: '支持任意 TCP 或 UDP 自定义端口映射',
  },
];

export class P2pService {
  public getP2pConfig(): P2pConfigResponse {
    return {
      success: true,
      publicToken: '11602319472897248650',
      serverHost: 'api.openp2p.cn',
      serverPort: 27183,
      presets: P2P_DEFAULT_PRESETS,
    };
  }
}

export const p2pService = new P2pService();
