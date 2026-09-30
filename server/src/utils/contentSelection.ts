/** 下载资格与元数据分离：密钥数量不等于当前平台的分包覆盖率。 */
export interface ContentDepot {
  depotId: string;
  depotKey?: string;
  keyMissing?: boolean;
  osList?: string;
  requiresKey?: boolean;
}

export interface ContentSelection {
  version: 1;
  platform: 'windows';
  baseReady: boolean;
  eligibleDlcIds: string[];
  skippedDlcIds: string[];
  missingBaseDepotIds: string[];
  selectedDepotIds: string[];
  dlcDepotIds: Record<string, string[]>;
}

export const validContentKey = (key?: string): boolean =>
  typeof key === 'string' && /^[0-9a-f]{64}$/i.test(key.trim()) && !/^0+$/.test(key.trim());

export function selectContent(input: {
  depots: ContentDepot[];
  dlcIds: string[];
  dlcDepots: Array<{ dlcAppId: string; depot: ContentDepot }>;
}): ContentSelection {
  const relevant = (d: ContentDepot) => !d.osList?.trim() || d.osList.toLowerCase().split(/[,\s]+/).includes('windows');
  const keyed = (d: ContentDepot) => d.requiresKey === false || validContentKey(d.depotKey);
  const byId = new Map(input.depots.map(d => [d.depotId, d]));
  const owners = new Set<string>();
  const mappings = new Map<string, Set<string>>();
  for (const row of input.dlcDepots) {
    owners.add(row.depot.depotId);
    if (!byId.has(row.depot.depotId)) byId.set(row.depot.depotId, row.depot);
    const ids = mappings.get(row.dlcAppId) || new Set<string>();
    ids.add(row.depot.depotId); mappings.set(row.dlcAppId, ids);
  }
  const candidates = new Set([...input.dlcIds, ...mappings.keys()]);
  const eligibleDlcIds: string[] = [], skippedDlcIds: string[] = [];
  const selected = new Set<string>();
  const dlcDepotIds: Record<string, string[]> = {};
  for (const id of [...candidates].sort()) {
    const mapped = [...(mappings.get(id) || [])].map(d => byId.get(d)!).filter(relevant);
    // 未知映射不是“已证明无内容”；其他平台有密钥也不代表 Windows 可下载。
    if (!mapped.length || mapped.some(d => !keyed(d))) {
      skippedDlcIds.push(id);
      continue;
    }
    eligibleDlcIds.push(id);
    dlcDepotIds[id] = mapped.filter(d => d.requiresKey !== false).map(d => d.depotId).sort();
    for (const d of dlcDepotIds[id]) selected.add(d);
  }
  const base = [...byId.values()].filter(d => !owners.has(d.depotId) && !candidates.has(d.depotId) && relevant(d) && d.requiresKey !== false);
  const missingBaseDepotIds = base.filter(d => !keyed(d)).map(d => d.depotId).sort();
  for (const d of base) selected.add(d.depotId);
  return {
    version: 1, platform: 'windows', baseReady: base.length > 0 && missingBaseDepotIds.length === 0,
    eligibleDlcIds, skippedDlcIds, missingBaseDepotIds, selectedDepotIds: [...selected].sort(), dlcDepotIds
  };
}

/** 返回新的投影；缓存保留原始归属信息，禁止客户端从另一个数组复活被排除的 DLC。 */
export function applyContentSelection<T extends {
  depots: ContentDepot[];
  dlcIds: string[];
  dlcDepots: Array<{ dlcAppId: string; depot: ContentDepot }>;
}>(payload: T): T & { contentSelection: ContentSelection } {
  const contentSelection = selectContent(payload);
  const chosen = new Set(contentSelection.selectedDepotIds);
  const dlcs = new Set(contentSelection.eligibleDlcIds);
  return {
    ...payload,
    depots: payload.depots.filter(d => chosen.has(d.depotId)),
    dlcIds: contentSelection.eligibleDlcIds,
    dlcDepots: payload.dlcDepots.filter(d => dlcs.has(d.dlcAppId) && (chosen.has(d.depot.depotId) || d.depot.requiresKey === false)),
    contentSelection
  };
}
