import { Request, Response } from 'express';
import { versionService } from '../services/versionService.js';

export const checkVersion = (req: Request, res: Response) => {
  try {
    const currentVersion = (req.query.version as string) || (req.query.current as string) || '1.0.0';
    const result = versionService.checkUpdate(currentVersion);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getLatestVersionInfo = (req: Request, res: Response) => {
  try {
    const info = versionService.getLatestVersion();
    res.json({ success: true, data: info });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
