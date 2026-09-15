import { Request, Response } from 'express';
import { depotService } from '../services/depotService.js';

export const getDepotsForGame = async (req: Request, res: Response) => {
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

    // 对外接口默认不返回启发式相邻分包（会把 AppID 邻近的无关游戏 depot 一起下发）；
    // 需要旧行为的调用方可显式传 ?heuristic=1。
    // 同时跳过 Store API 头图查询：本接口只返回密钥映射，不需要头图，
    // 而该上游在服务器侧实测不可达，会白等 4 秒超时。
    const includeHeuristic = req.query.heuristic === '1';
    const depots = await depotService.getDepotsForGame(appId, dlcs, {
      skipRemoteHeader: true,
      includeHeuristic
    });
    res.json({ success: true, data: depots });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
    }
};

export const getSingleDepotKey = async (req: Request, res: Response) => {
  try {
    const depotId = Array.isArray(req.params.depotId) ? req.params.depotId[0] : req.params.depotId;
    const key = depotService.getDepotKey(depotId);
    if (!key) {
      return res.status(404).json({ success: false, message: '未找到该 Depot 解密密钥' });
    }
    res.json({ success: true, data: { depotId, key } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
    }
};
