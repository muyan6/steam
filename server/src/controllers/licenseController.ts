import { Request, Response } from 'express';
import { licenseService, LicenseType } from '../services/licenseService.js';

// ==================== 1. 公开客户端接口 ====================

/**
 * 客户端核销激活卡密并绑定设备
 */
export async function activateLicense(req: Request, res: Response) {
  try {
    const { code, deviceId } = req.body;
    if (!code || !deviceId) {
      return res.status(400).json({
        success: false,
        message: '激活码 (code) 与设备码 (deviceId) 均为必填项'
      });
    }

    const result = licenseService.activate(code, deviceId);
    if (result.success) {
      return res.json({
        success: true,
        message: result.message,
        data: result.license
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (e: any) {
    console.error('[LicenseController] 激活异常:', e);
    return res.status(500).json({
      success: false,
      message: `激活失败: ${e.message}`
    });
  }
}

/**
 * 客户端验证设备授权状态
 */
export async function verifyLicense(req: Request, res: Response) {
  try {
    const { deviceId, code } = req.body;
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: '设备码 (deviceId) 不能为空'
      });
    }

    const info = licenseService.verify(deviceId, code);
    return res.json({
      success: true,
      data: info
    });
  } catch (e: any) {
    console.error('[LicenseController] 验签异常:', e);
    return res.status(500).json({
      success: false,
      message: `验签失败: ${e.message}`
    });
  }
}

/**
 * 快速查询某设备的激活状态
 */
export async function getDeviceLicenseStatus(req: Request, res: Response) {
  try {
    const { deviceId } = req.params;
    const sDeviceId = Array.isArray(deviceId) ? deviceId[0] : String(deviceId || '');
    if (!sDeviceId) {
      return res.status(400).json({ success: false, message: '设备码不能为空' });
    }

    const info = licenseService.verify(sDeviceId);
    return res.json({
      success: true,
      data: info
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ==================== 2. 管理员受保护接口 ====================

/**
 * 管理员获取卡密列表 (支持分页与检索)
 */
export async function getLicenseListAdmin(req: Request, res: Response) {
  try {
    const { search, type, status, page, limit } = req.query;
    const result = licenseService.getList({
      search: search as string,
      type: type as string,
      status: status as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/**
 * 管理员获取卡密全局统计
 */
export async function getLicenseStatsAdmin(req: Request, res: Response) {
  try {
    const stats = licenseService.getStats();
    return res.json({
      success: true,
      data: stats
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/**
 * 管理员批量生成卡密
 */
export async function generateLicensesAdmin(req: Request, res: Response) {
  try {
    const { type, count, prefix, remark } = req.body;
    if (!type || !['monthly', 'quarterly', 'yearly', 'lifetime'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: '卡密类型无效，支持: monthly, quarterly, yearly, lifetime'
      });
    }

    const user = (req as any).adminUser || { username: 'admin' };
    const result = licenseService.generateBatch({
      type: type as LicenseType,
      count: Number(count) || 1,
      prefix: prefix ? String(prefix).trim() : undefined,
      remark: remark ? String(remark).trim() : undefined,
      createdBy: user.username
    });

    return res.json({
      success: true,
      message: result.message,
      data: {
        generatedCount: result.generatedKeys.length,
        keys: result.generatedKeys
      }
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/**
 * 管理员一键解绑设备 (允许换机)
 */
export async function unbindLicenseAdmin(req: Request, res: Response) {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: '请提供要解绑的激活码' });
    }

    const result = licenseService.unbind(code);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/**
 * 管理员冻结 / 恢复卡密
 */
export async function toggleLicenseAdmin(req: Request, res: Response) {
  try {
    const { code, disabled } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: '请提供要操作的激活码' });
    }

    const result = licenseService.toggleStatus(code, Boolean(disabled));
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/**
 * 管理员删除卡密
 */
export async function deleteLicenseAdmin(req: Request, res: Response) {
  try {
    const { code } = req.params;
    const sCode = Array.isArray(code) ? code[0] : String(code || '');
    if (!sCode) {
      return res.status(400).json({ success: false, message: '请提供要删除的激活码' });
    }

    const result = licenseService.deleteKey(sCode);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/**
 * 管理员为卡密延期
 */
export async function extendLicenseAdmin(req: Request, res: Response) {
  try {
    const { code, additionalDays } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: '请提供要延期的激活码' });
    }

    const result = licenseService.extendDays(code, Number(additionalDays) || 30);
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}
