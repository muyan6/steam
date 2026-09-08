export type OnlineNetType = 'cloud_lobby' | 'steamworks' | 'thirdparty' | 'official_server' | 'api_only';
export type OnlineRecommendScheme = 'scheme1' | 'scheme2' | 'unsupported';

export interface OnlineRuleItem {
  appId: number;
  name: string;
  nameZh?: string;
  netType: OnlineNetType;
  recommend: OnlineRecommendScheme;
  signals: string[];
  notes: string;
}

export const ONLINE_RULES_VERSION = '2026.09.08.1';
export const ONLINE_RULES_UPDATED_AT = '2026-09-08T18:45:00.000Z';

export const AUTHORITATIVE_ONLINE_RULES: OnlineRuleItem[] = [
  // 1. 云端大厅强鉴权（未打补丁直启会报错 AccessDenied 或开不了房，必须用方案二安装补丁）
  {
    appId: 1966720,
    name: "Lethal Company",
    nameZh: "致命公司",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["致命公司·Valve官方云端大厅强鉴权", "Facepunch.Steamworks"],
    notes: "采用 Facepunch.Steamworks 强鉴权，未购账号方案一直启会被 Valve 拒绝创建大厅，必须使用方案二联机补丁"
  },
  {
    appId: 739630,
    name: "Phasmophobia",
    nameZh: "恐鬼症",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["恐鬼症·官方云端大厅强鉴权", "Photon Voice"],
    notes: "官方云端大厅验票，必须使用方案二联机补丁"
  },
  {
    appId: 2881650,
    name: "Content Warning",
    nameZh: "内容警告",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["内容警告·官方云端大厅强鉴权", "Photon Realtime"],
    notes: "官方云端大厅强鉴权，必须使用方案二联机补丁"
  },
  {
    appId: 252490,
    name: "Rust",
    nameZh: "腐蚀",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["Rust·Facepunch官方网络与EAC鉴权"],
    notes: "Facepunch 官方网络鉴权与 EAC 反作弊，官服无法直入，社区自建破解服必须通过方案二打补丁"
  },

  // 2. 第三方网络 / 独立账号服务（不走 Steam P2P 大厅通道，需补丁或自建服）
  {
    appId: 1260320,
    name: "Party Animals",
    nameZh: "猛兽派对",
    netType: "thirdparty",
    recommend: "scheme2",
    signals: ["猛兽派对·自建官方网络账号服务"],
    notes: "自建官方网络账号体系，无法通过 Steam 通道免改联机，建议使用方案二补丁"
  },
  {
    appId: 1623730,
    name: "Palworld",
    nameZh: "幻兽帕鲁",
    netType: "thirdparty",
    recommend: "scheme2",
    signals: ["幻兽帕鲁·社区服/自建网络", "Epic Online Services SDK"],
    notes: "采用 Epic Online Services (EOS) 与社区专用服，建议使用方案二联机补丁"
  },

  // 3. 原生 Steamworks P2P 经典联机（免改任何游戏文件，推荐方案一直启）
  {
    appId: 105600,
    name: "Terraria",
    nameZh: "泰拉瑞亚",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["泰拉瑞亚·原生P2P/直连"],
    notes: "原生 Steamworks P2P 与 IP 直连双通道，推荐使用方案一免改直启"
  },
  {
    appId: 204360,
    name: "Castle Crashers",
    nameZh: "城堡毁灭者",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["城堡毁灭者·P2P对战"],
    notes: "原生 Steamworks P2P 联机对战，推荐使用方案一免改直启"
  },
  {
    appId: 880940,
    name: "Pummel Party",
    nameZh: "混战派对",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["Pummel Party·原生P2P"],
    notes: "原生 Steamworks 房间匹配，推荐使用方案一免改直启"
  },
  {
    appId: 1426210,
    name: "It Takes Two",
    nameZh: "双人成行",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["双人成行·Steam好友联机通道"],
    notes: "通过 Steamworks 好友邀请或官方好友通行证，推荐方案一免改直启"
  },
  {
    appId: 242760,
    name: "The Forest",
    nameZh: "森林",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["森林·原生Steamworks大厅"],
    notes: "原生 Steam 大厅大厅建房，推荐使用方案一免改直启"
  },
  {
    appId: 1326470,
    name: "Sons Of The Forest",
    nameZh: "森林之子",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["森林之子·Steamworks大厅"],
    notes: "原生 Steamworks 大厅联机，推荐使用方案一免改直启"
  },
  {
    appId: 477160,
    name: "Human: Fall Flat",
    nameZh: "人类一败涂地",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["人类一败涂地·原生Steam大厅"],
    notes: "原生 Steamworks 大厅，推荐方案一免改直启"
  },
  {
    appId: 322330,
    name: "Don't Starve Together",
    nameZh: "饥荒联机版",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["饥荒联机版·Steamworks专用大厅"],
    notes: "支持局域网直连或 Steamworks 专用大厅，推荐方案一免改直启"
  },
  {
    appId: 892970,
    name: "Valheim",
    nameZh: "英灵神殿",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["英灵神殿·Steam跨平台网络"],
    notes: "原生 SteamNetworkingSockets，推荐方案一免改直启"
  },
  {
    appId: 1144200,
    name: "Ready or Not",
    nameZh: "严阵以待",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["严阵以待·Steamworks战术大厅"],
    notes: "Steamworks 好友战术大厅，推荐方案一免改直启"
  },
  {
    appId: 448510,
    name: "Overcooked! 2",
    nameZh: "胡闹厨房2",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["胡闹厨房2·Steamworks联机"],
    notes: "Steamworks 好友大厅，推荐方案一免改直启"
  },
  {
    appId: 648800,
    name: "Raft",
    nameZh: "木筏求生",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["木筏求生·Steamworks好友联机"],
    notes: "原生 Steamworks P2P，推荐方案一免改直启"
  },

  // 4. 官方竞技服务器（带官方专属服务器与严格 VAC/EAC 反作弊，不支持破解联机）
  {
    appId: 730,
    name: "Counter-Strike 2",
    nameZh: "反恐精英 2",
    netType: "official_server",
    recommend: "unsupported",
    signals: ["CS2·Valve官方竞技服务器", "Valve Anti-Cheat (VAC)"],
    notes: "Valve 官方竞技专用服务器，严格验证账号 VAC 凭证，无法自建大厅，不支持破解联机"
  },
  {
    appId: 1172470,
    name: "Apex Legends",
    nameZh: "Apex 英雄",
    netType: "official_server",
    recommend: "unsupported",
    signals: ["Apex·Respawn官方专用服务器", "Easy Anti-Cheat (EAC)"],
    notes: "EA/Respawn 官方大型竞技服务器与 EAC 强反作弊，不支持破解联机"
  },
  {
    appId: 570,
    name: "Dota 2",
    nameZh: "刀塔 2",
    netType: "official_server",
    recommend: "unsupported",
    signals: ["Dota 2·Valve官方竞技服务器", "Game Coordinator"],
    notes: "Valve 官方 GC 服务器权威匹配，不支持破解联机"
  },
  {
    appId: 578080,
    name: "PUBG: BATTLEGROUNDS",
    nameZh: "绝地求生",
    netType: "official_server",
    recommend: "unsupported",
    signals: ["PUBG·Krafton官方竞技服务器", "BattlEye/Zakynthos"],
    notes: "Krafton 官方竞技服务器与多重内核反作弊，不支持破解联机"
  },
  {
    appId: 440,
    name: "Team Fortress 2",
    nameZh: "军团要塞 2",
    netType: "official_server",
    recommend: "unsupported",
    signals: ["TF2·Valve官方服务器与VAC"],
    notes: "Valve 官方服务器与社区服务器，社区服可直连，官方匹配大厅需正版"
  },
  {
    appId: 381210,
    name: "Dead by Daylight",
    nameZh: "黎明杀机",
    netType: "official_server",
    recommend: "unsupported",
    signals: ["DBD·Behaviour官方云端服务器", "EAC"],
    notes: "官方云端专用服务器与 EAC 反作弊，官方匹配不支持破解联机"
  }
];
