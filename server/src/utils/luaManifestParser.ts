// 上游 Lua 规则（OpenSteamTool / GreenLuma 风格）统一解析器。
//
// 为什么必须收敛成一份实现：
// 原先 manifestService 有三处内联解析（unpackZipAndExtractManifests、
// fetchFromManifestHub 的 lua 兜底、parseLuaFromZip），metadataController 还有
// 第四份（parseManifestHub3Lua）。四份正则并不一致 —— 例如 setManifestid 的 GID
// 一处要求 `\d{5,}`、另两处只要求 `\d+`，导致同一份上游 Lua 在不同源/不同链路下
// 被判为有效或无效，分包集合与 GID 会随命中源漂移。现在统一走本文件。

/** 一次解析产出的全部规则数据 */
export interface ParsedLuaManifest {
  /** depotId -> 32 位以上十六进制解密密钥（已剔除全 0 占位符） */
  depotKeys: Map<string, string>;
  /** depotId -> manifest GID（已剔除 "0"） */
  manifestGids: Map<string, string>;
  /** 纯挂载 addappid(id) 且不等于目标 AppID 的条目，通常是 DLC AppID */
  dlcIds: string[];
  /** addtoken(appId, "<hex>") 提取到的 PICS AccessToken */
  accessToken?: string;
}

/** 密钥必须是 32 位以上十六进制且不能是全 0 占位符 */
function isValidDepotKey(key: string): boolean {
  return /^[0-9a-fA-F]{32,}$/.test(key) && !/^0+$/.test(key);
}

/**
 * 解析 Lua 规则文本。
 *
 * @param lua 上游 Lua 全文（多文件拼接亦可）
 * @param targetAppId 目标 AppID：纯挂载行与之相等时不视为 DLC
 */
export function parseLuaManifestText(lua: string, targetAppId?: number | string): ParsedLuaManifest {
  const depotKeys = new Map<string, string>();
  const manifestGids = new Map<string, string>();
  const dlcIds: string[] = [];
  const sTarget = targetAppId !== undefined && targetAppId !== null ? String(targetAppId) : '';
  let accessToken: string | undefined;

  if (!lua) return { depotKeys, manifestGids, dlcIds, accessToken };

  for (const rawLine of lua.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // setDepotKey(<depot>, "<key>")
    const setKeyMatch = line.match(/^setDepotKey\((\d+)\s*,\s*"([0-9a-fA-F]+)"\s*\)/);
    if (setKeyMatch) {
      if (isValidDepotKey(setKeyMatch[2])) depotKeys.set(setKeyMatch[1], setKeyMatch[2]);
      continue;
    }

    // addappid(<id>, 0|1, "<key>") —— 带密钥的挂载
    const addKeyMatch = line.match(/^addappid\((\d+)\s*,\s*\d+\s*,\s*"([0-9a-fA-F]+)"\s*\)/);
    if (addKeyMatch) {
      if (isValidDepotKey(addKeyMatch[2])) depotKeys.set(addKeyMatch[1], addKeyMatch[2]);
      continue;
    }

    // addappid(<id>) / addappid(<id>, 0|1) —— 无密钥的纯挂载，通常为 DLC
    const simpleAddMatch = line.match(/^addappid\((\d+)\s*(?:,\s*\d+)?\s*\)/);
    if (simpleAddMatch) {
      const id = simpleAddMatch[1];
      if (id !== sTarget && !dlcIds.includes(id)) dlcIds.push(id);
      continue;
    }

    // setManifestid(<depot>, "<gid>"[, 0])
    // GID 只排除 "0"：不同上游会出现位数不同的历史 GID，此处不做位数收窄，
    // 否则同一份 Lua 会在不同调用点被判为有效/无效（旧实现的漂移根因）。
    const gidMatch = line.match(/^setManifestid\((\d+)\s*,\s*"(\d+)"/);
    if (gidMatch && gidMatch[2] !== '0') {
      manifestGids.set(gidMatch[1], gidMatch[2]);
      continue;
    }

    // addtoken(<appid>, "<hex>")
    const tokenMatch = line.match(/^addtoken\((\d+)\s*,\s*"([0-9a-fA-F]+)"\s*\)/);
    if (tokenMatch) {
      accessToken = tokenMatch[2];
    }
  }

  return { depotKeys, manifestGids, dlcIds, accessToken };
}