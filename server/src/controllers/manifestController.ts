import { Request, Response } from 'express';
import fs from 'fs';
import { manifestService } from '../services/manifestService.js';

export const getManifestsForApp = async (req: Request, res: Response) => {
  try {
    const rawAppId = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(rawAppId, 10);
    if (isNaN(appId)) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }

    let dlcs: number[] = [];
    if (req.query.dlcs) {
      if (typeof req.query.dlcs === 'string') {
        dlcs = req.query.dlcs.split(',').map((id) => parseInt(id.trim(), 10)).filter((n) => !isNaN(n));
      }
    }

    const result = await manifestService.getManifestsForApp(appId, dlcs);
    res.json(result);
  } catch (e) {
    console.error('[ManifestController] 获取清单列表异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const downloadManifestFile = async (req: Request, res: Response) => {
  try {
    const depotId = Array.isArray(req.params.depotId) ? req.params.depotId[0] : req.params.depotId;
    const manifestId = Array.isArray(req.params.manifestId) ? req.params.manifestId[0] : req.params.manifestId;

    if (!depotId || !manifestId || !/^\d+$/.test(depotId) || !/^\d+$/.test(manifestId)) {
      return res.status(400).json({ success: false, message: '参数缺失或格式非法' });
    }

    const rawAppId = req.query.appId ? (Array.isArray(req.query.appId) ? req.query.appId[0] : req.query.appId) : undefined;
    const appId = rawAppId ? parseInt(String(rawAppId), 10) : undefined;

    let filePath = manifestService.getLocalManifestFilePath(depotId, manifestId, appId);
    if (!filePath || !fs.existsSync(filePath)) {
      // 本地无缓存，尝试从 ManifestHub3 镜像拉取并沉淀在本地 server/data/manifests/ 目录
      filePath = await manifestService.ensureManifestCached(depotId, manifestId, appId);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '未找到该清单文件缓存且回源拉取失败' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${depotId}_${manifestId}.manifest"`);
    // 文件流错误与客户端中途断开都必须显式销毁，防止读流句柄泄漏
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('[ManifestController] 清单文件读取流出错:', err.message);
      res.destroy();
    });
    res.on('close', () => {
      // 客户端中止下载时取消文件流
      stream.destroy();
    });
    stream.pipe(res);
  } catch (e) {
    console.error('[ManifestController] 清单下载异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const getManifestCode = async (req: Request, res: Response) => {
  try {
    const rawGid = Array.isArray(req.params.gid) ? req.params.gid[0] : req.params.gid;
    const gid = String(rawGid || '').trim();
    if (!gid || !/^\d+$/.test(gid)) {
      return res.status(400).json({ success: false, message: '无效的 GID' });
    }

    // depotId 可选。带上它有两个好处：① 末位兜底源能走更准的 index.php/{depot}/{gid}
    // 而不是已知会失败的 dex.php/{gid}；② 填充 depot→gid 索引，供后续主动补码枚举。
    // 老版内核回调只给 gid，所以它必须可选 —— 缺了也要能正常取码。
    const rawDepot = Array.isArray(req.query.depotId) ? req.query.depotId[0] : req.query.depotId;
    const depotId = rawDepot ? String(rawDepot).trim() : undefined;

    const result = await manifestService.getManifestCode(gid, depotId);
    const code = result.code;

    if (!code) {
      // 404 与 503 的语义必须严格区分，客户端据此决定「写负缓存」还是「立刻重试」：
      //
      // - 404：权威源明确回答「没有这个 gid」。客户端写 CFD_CODE_NEG_TTL 负缓存
      //   是正确的 —— 重复问也不会有码。
      // - 503：上游此刻过载/超时/被质询，我们**并不知道**有没有。客户端绝不能
      //   写负缓存，必须立刻重试。
      //
      // 旧实现把所有失败一律回 404，等于把上游一次 429 抖动翻译成「确认没有」，
      // 再被客户端固化成两分钟负缓存 —— 该 gid 期间对所有客户端都取不到码。
      // 这正是「第一次点下载报无网络、等一两分钟再点才行」的成因。
      if (result.transient && !result.definitiveMiss) {
        return res.status(503).json({ success: false, message: '上游暂时不可用，请稍后重试' });
      }
      return res.status(404).json({ success: false, message: '未找到清单请求代码' });
    }

    // stale 提示：这个码来自过期缓存（上游当下取不到，用旧码顶上）。
    //
    // 它**不代表内容版本旧** —— code 只是下载凭据，内容版本由 gid 决定，
    // 而 gid 只在 depot 内容更新时才变。旧 code 配当前 gid 拉到的仍是当前版本。
    // 真实含义是「这个码可能已失效」：Steam 拿它拉不到清单时会自己重试。
    // 暴露出来是为了排障可观测，不是版本提示。
    const stale = result.stale === true;
    if (stale) res.setHeader('X-Manifest-Code-Stale', '1');

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true, gid, code, stale });
    }
    return res.type('text/plain').send(code);
  } catch (e) {
    console.error('[ManifestController] 获取清单代码异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

/**
 * 客户端上报取码结果 —— 码库最重要的数据来源。
 *
 * 设计要点：
 * - **幂等且只增不减**：同一 (depot, gid) 重复上报只刷新时间戳，不产生副作用。
 * - **不信任任何字段**：逐条校验纯数字，脏数据丢弃而不是整批失败。
 * - **不覆盖更新的码**：客户端可能跑了几分钟才上报，期间服务端已取到更晚的码；
 *   那种情况下保留服务端自己的（更新），丢弃上报的（更旧）。
 * - **永不返回错误码影响业务**：上报是纯增益的旁路，失败也不该让客户端入库失败，
 *   所以除参数明显非法外一律 200。
 */
export const reportManifestCodes = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const rawList = Array.isArray(body) ? body : body?.codes;
    if (!Array.isArray(rawList)) {
      return res.status(400).json({ success: false, message: '请求体应为数组或 { codes: [...] }' });
    }
    // 单次上报上限：防止被当作任意写入的入口塞爆码库
    const list = rawList.slice(0, 500);
    const result = manifestService.reportManifestCodes(
      list.map((e: any) => ({
        depotId: String(e?.depotId ?? ''),
        gid: String(e?.gid ?? ''),
        code: String(e?.code ?? '')
      }))
    );
    // 只接受 depotId 是数字的条目；非数字的计入 rejected 并已丢弃
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[ManifestController] 上报清单代码异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

/** 码库概览（诊断用，不暴露任何具体码值） */
export const getManifestCodeStats = async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...manifestService.getCodeStoreStats() });
  } catch (e) {
    console.error('[ManifestController] 码库统计异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

