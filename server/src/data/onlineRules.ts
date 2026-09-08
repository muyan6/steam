export type OnlineNetType = 'cloud_lobby' | 'steamworks' | 'thirdparty' | 'official_server' | 'api_only' | 'single_player' | 'tool';
export type OnlineRecommendScheme = 'scheme1' | 'scheme2' | 'unsupported' | 'single_player';

export interface OnlineRuleItem {
  appId: number;
  name: string;
  nameZh?: string;
  netType: OnlineNetType;
  recommend: OnlineRecommendScheme;
  signals: string[];
  notes: string;
}

export const ONLINE_RULES_VERSION = '2026.09.08.2';
export const ONLINE_RULES_UPDATED_AT = '2026-09-08T18:55:00.000Z';

export const AUTHORITATIVE_ONLINE_RULES: OnlineRuleItem[] = [
  // ==================== 1. 云端大厅强鉴权（未打补丁直启会假启动/报错，必须用方案二） ====================
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
  {
    appId: 1943950,
    name: "Escape the Backrooms",
    nameZh: "逃离后室",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["逃离后室·官方大厅鉴权"],
    notes: "采用官方云端大厅匹配服务，推荐方案二补丁"
  },
  {
    appId: 1985790,
    name: "Inside the Backrooms",
    nameZh: "深入后室",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["深入后室·官方大厅鉴权"],
    notes: "官方大厅鉴权，推荐方案二补丁"
  },
  {
    appId: 1817130,
    name: "The Backrooms 1998",
    nameZh: "后室 1998",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["后室1998·官方网络鉴权"],
    notes: "官方云端大厅鉴权，推荐方案二补丁"
  },
  {
    appId: 1368820,
    name: "DEVOUR",
    nameZh: "吞噬",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["DEVOUR·官方云端大厅"],
    notes: "官方大厅匹配机制，建议使用方案二联机补丁"
  },
  {
    appId: 2097490,
    name: "R.E.P.O.",
    nameZh: "R.E.P.O.",
    netType: "cloud_lobby",
    recommend: "scheme2",
    signals: ["REPO·云端大厅鉴权", "Photon Voice"],
    notes: "官方云端大厅鉴权，建议使用方案二联机补丁"
  },

  // ==================== 2. 第三方网络 / 独立账号服务（不走 Steam P2P 大厅通道，需补丁） ====================
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
  {
    appId: 1568590,
    name: "Goose Goose Duck",
    nameZh: "鹅鸭杀",
    netType: "thirdparty",
    recommend: "scheme2",
    signals: ["鹅鸭杀·Gaggle官方自建网络"],
    notes: "Gaggle 官方自建服务器与账号体系，Steam 免改通道无法接入"
  },

  // ==================== 3. 原生 Steamworks P2P 经典联机（免改任何游戏文件，推荐方案一直启） ====================
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
    appId: 4001890,
    name: "How to Fish",
    nameZh: "钓鱼模拟",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["How to Fish·Steamworks联机"],
    notes: "Steamworks 好友通道，推荐方案一免改直启"
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
    notes: "原生 Steam 大厅建房，推荐使用方案一免改直启"
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
  {
    appId: 632360,
    name: "Risk of Rain 2",
    nameZh: "雨中冒险 2",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["雨中冒险2·Steamworks大厅"],
    notes: "原生 Steamworks 大厅建房，推荐方案一免改直启"
  },
  {
    appId: 550,
    name: "Left 4 Dead 2",
    nameZh: "求生之路 2",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["求生之路2·原生Steam大厅与局域网"],
    notes: "原生大厅与自建局域网，推荐方案一免改直启"
  },
  {
    appId: 211820,
    name: "Starbound",
    nameZh: "星界边境",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["星界边境·Steam大厅好友加入"],
    notes: "原生 Steam 好友大厅，推荐方案一免改直启"
  },
  {
    appId: 251570,
    name: "7 Days to Die",
    nameZh: "七日杀",
    netType: "steamworks",
    recommend: "scheme1",
    signals: ["七日杀·Steam P2P与自建服"],
    notes: "支持 Steam 好友大厅与自建服直连，推荐方案一免改直启"
  },

  // ==================== 4. 纯单机游戏（无需任何联机，直接启动运行） ====================
  {
    appId: 3590,
    name: "Plants vs. Zombies: Game of the Year",
    nameZh: "植物大战僵尸：年度版",
    netType: "single_player",
    recommend: "single_player",
    signals: ["经典纯单机塔防游戏"],
    notes: "纯单机经典游戏，无多人联机网络大厅，直接本地启动即可"
  },
  {
    appId: 646570,
    name: "Slay the Spire",
    nameZh: "杀戮尖塔",
    netType: "single_player",
    recommend: "single_player",
    signals: ["纯单机卡牌构建肉鸽"],
    notes: "纯单机卡牌构建游戏，无多人联机功能，直接本地启动即可"
  },
  {
    appId: 2358720,
    name: "Black Myth: Wukong",
    nameZh: "黑神话：悟空",
    netType: "single_player",
    recommend: "single_player",
    signals: ["国产3A单机动作RPG"],
    notes: "单机动作角色扮演游戏，无多人联机大厅，直接本地启动"
  },
  {
    appId: 1091500,
    name: "Cyberpunk 2077",
    nameZh: "赛博朋克 2077",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机开放世界RPG"],
    notes: "纯单机开放世界角色扮演游戏，直接本地启动"
  },
  {
    appId: 292030,
    name: "The Witcher 3: Wild Hunt",
    nameZh: "巫师 3：狂猎",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机剧情角色扮演"],
    notes: "纯单机史诗 RPG，无多人联机模式，直接本地启动"
  },
  {
    appId: 814380,
    name: "Sekiro: Shadows Die Twice",
    nameZh: "只狼：影逝二度",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机硬核动作冒险"],
    notes: "纯单机动作硬核游戏，无官方多人联机，直接本地启动"
  },
  {
    appId: 367520,
    name: "Hollow Knight",
    nameZh: "空洞骑士",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机类银河恶魔城"],
    notes: "纯单机横版探险游戏，无联机功能，直接本地启动"
  },
  {
    appId: 1145360,
    name: "Hades",
    nameZh: "哈迪斯",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机动作Roguelike"],
    notes: "纯单机动作肉鸽游戏，无多人模式，直接本地启动"
  },
  {
    appId: 250900,
    name: "The Binding of Isaac: Rebirth",
    nameZh: "以撒的结合：重生",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机Roguelike/本地同屏"],
    notes: "以单机/本地同屏双人为主，直接本地启动"
  },
  {
    appId: 377160,
    name: "Fallout 4",
    nameZh: "辐射 4",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机后启示录RPG"],
    notes: "纯单机角色扮演游戏，直接本地启动"
  },
  {
    appId: 489830,
    name: "The Elder Scrolls V: Skyrim Special Edition",
    nameZh: "上古卷轴 5：天际特别版",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机奇幻开放世界"],
    notes: "纯单机游戏，无官方联机功能，直接本地启动"
  },
  {
    appId: 2050650,
    name: "Resident Evil 4",
    nameZh: "生化危机 4 重制版",
    netType: "single_player",
    recommend: "single_player",
    signals: ["单机生存恐怖冒险"],
    notes: "单机剧情冒险游戏，直接本地启动"
  },

  // ==================== 5. 辅助工具 / 实用软件（无需联机） ====================
  {
    appId: 1477830,
    name: "HudSight - crosshair overlay",
    nameZh: "HudSight 准星助手",
    netType: "tool",
    recommend: "single_player",
    signals: ["桌面游戏准星覆盖工具"],
    notes: "实用游戏辅助准星叠加工具，非游戏，无需联机"
  },
  {
    appId: 431960,
    name: "Wallpaper Engine",
    nameZh: "壁纸引擎",
    netType: "tool",
    recommend: "single_player",
    signals: ["动态壁纸桌面软件"],
    notes: "桌面动态壁纸实用工具软件，无需多人联机"
  },
  {
    appId: 396060,
    name: "Soundpad",
    nameZh: "语音音效软件",
    netType: "tool",
    recommend: "single_player",
    signals: ["语音与音效实用软件"],
    notes: "语音音效播放工具软件，无需联机"
  },

  // ==================== 6. 官方竞技服务器（官方专属服务器与 VAC/EAC，不支持破解联机） ====================
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
