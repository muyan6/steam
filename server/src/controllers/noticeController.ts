import { Request, Response } from 'express';
import { noticeService } from '../services/noticeService.js';

export const getLatestNotice = (req: Request, res: Response) => {
  try {
    const notice = noticeService.getLatestNotice();
    res.json({ success: true, data: notice });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
