import { Request, Response } from 'express';
import { appLinksService } from '../services/appLinksService.js';

/**
 * 公开：客户端获取应用内跳转链接（教程 / FAQ）。
 * 未配置的链接返回空字符串，客户端按钮置灰显示"暂未开放"。
 */
export function getAppLinks(_req: Request, res: Response) {
  try {
    res.json({ success: true, data: appLinksService.getLinks() });
  } catch (e: any) {
    res.status(500).json({ success: false, message: `获取链接配置失败: ${e.message}` });
  }
}

/**
 * 管理端：更新应用内跳转链接（受 requireAdmin 保护）
 */
export function updateAppLinks(req: Request, res: Response) {
  try {
    const { tutorialUrl, faqUrl } = req.body || {};
    if (tutorialUrl !== undefined && typeof tutorialUrl !== 'string') {
      return res.status(400).json({ success: false, message: 'tutorialUrl 必须为字符串或空' });
    }
    if (faqUrl !== undefined && typeof faqUrl !== 'string') {
      return res.status(400).json({ success: false, message: 'faqUrl 必须为字符串或空' });
    }
    const data = appLinksService.updateLinks({ tutorialUrl, faqUrl });
    res.json({ success: true, message: '链接配置已更新', data });
  } catch (e: any) {
    res.status(500).json({ success: false, message: `更新链接配置失败: ${e.message}` });
  }
}
