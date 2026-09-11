/**
 * 版本号比较的唯一权威实现，供 versionService / noticeService 共用。
 *
 * 历史背景：2026-09 的 710beaf 提交曾误将客户端版本标记为 5.6.0，而项目正式发布
 * 序列为 2.x。若按纯语义化比较，5.6.0 > 2.7.1，会让仍停留在 5.6.0 的客户端永远
 * 收不到更新。
 *
 * 这里只把「本次真实误发布的 5.6.0」显式登记为退役版本，而不是像旧实现那样粗暴
 * 地把整个 5.x 主版本都当作旧版：后者会误伤未来任何合法的 5.x 版本，并且同一段
 * 逻辑在 versionService / noticeService / 客户端各复制了一份，容易各自漂移。
 *
 * 待到确认全网已无客户端停留在 5.6.0 后，清空 RETIRED_VERSIONS 即可恢复纯语义化比较。
 */
export const RETIRED_VERSIONS: ReadonlySet<string> = new Set<string>(['5.6.0']);

/** 去掉前缀 v/V 与首尾空白，得到可比较的版本串 */
export const normalizeVersion = (v: string): string => (v || '0').replace(/^v/i, '').trim();

/** 是否属于历史误发布、应按「早于所有正式版本」对待的退役版本 */
export const isRetiredVersion = (v: string): boolean => RETIRED_VERSIONS.has(normalizeVersion(v));

/**
 * 语义化版本号比较：v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0。
 * 退役版本恒低于任何非退役版本；两个退役版本之间仍按语义化比较。
 */
export function compareVersions(v1: string, v2: string): number {
  const clean1 = normalizeVersion(v1);
  const clean2 = normalizeVersion(v2);

  const retired1 = RETIRED_VERSIONS.has(clean1);
  const retired2 = RETIRED_VERSIONS.has(clean2);
  if (retired1 !== retired2) {
    return retired1 ? -1 : 1;
  }

  const parts1 = clean1.split('.').map((n) => parseInt(n, 10) || 0);
  const parts2 = clean2.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}
