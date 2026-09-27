import { Request, Response } from 'express';
import { licenseService, LicenseType } from '../services/licenseService.js';
import { deviceService } from '../services/deviceService.js';

/// 卡密码长度上限：真实卡密远短于此，封顶可防超长 body 撑大 license_keys.json
const MAX_CODE_LEN = 64;

/**
 * 校验并规整管理员接口的卡密入参。返回 null 表示非法（调用方回 400）。
 */
function parseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  if (!code || code.length > MAX_CODE_LEN) return null;
  return code;
}

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
    // 长度与类型校验：防止超大字符串直接写入卡密库文件
    if (typeof code !== 'string' || code.length > 64 || typeof deviceId !== 'string' || deviceId.length > 128) {
      return res.status(400).json({
        success: false,
        message: '激活码或设备码格式非法'
      });
    }

    const result = licenseService.activate(code, deviceId);
    if (result.success) {
      try {
        deviceService.updateDeviceActivation(
          deviceId,
          true,
          code,
          result.license?.type
        );
      } catch (err) {
        console.warn('[LicenseController] 同步设备状态失败:', err);
      }
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
  } catch (e) {
    console.error('[LicenseController] 激活异常:', e);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误'
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
    if (typeof deviceId !== 'string' || deviceId.length > 128 || (code && (typeof code !== 'string' || code.length > 64))) {
      return res.status(400).json({
        success: false,
        message: '设备码或激活码格式非法'
      });
    }

    const info = licenseService.verify(deviceId, code);
    return res.json({
      success: true,
      data: info
    });
  } catch (e) {
    console.error('[LicenseController] 验签异常:', e);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误'
    });
  }
}

/**
 * 换机迁移：凭卡密 + 原设备码将绑定关系迁移到新设备。
 * 仅当卡密处于激活态且原设备码与绑定记录完全匹配时放行，
 * 避免知道卡密即可任意抢绑。
 */
export async function rebindLicense(req: Request, res: Response) {
  try {
    const { code, oldDeviceId, newDeviceId } = req.body;
    if (!code || !oldDeviceId || !newDeviceId) {
      return res.status(400).json({
        success: false,
        message: '激活码 (code)、原设备码 (oldDeviceId) 与新设备码 (newDeviceId) 均为必填项'
      });
    }
    if (
      typeof code !== 'string' || code.length > 64 ||
      typeof oldDeviceId !== 'string' || oldDeviceId.length > 128 ||
      typeof newDeviceId !== 'string' || newDeviceId.length > 128
    ) {
      return res.status(400).json({
        success: false,
        message: '激活码或设备码格式非法'
      });
    }

    const result = licenseService.rebind(code, oldDeviceId, newDeviceId);
    if (result.success) {
      try {
        deviceService.updateDeviceActivation(oldDeviceId, false);
        deviceService.updateDeviceActivation(newDeviceId, true, code, result.license?.type);
      } catch (err) {
        console.warn('[LicenseController] 迁移同步设备状态失败:', err);
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.license
      });
    }
    return res.status(400).json({
      success: false,
      message: result.message
    });
  } catch (e) {
    console.error('[LicenseController] 迁移异常:', e);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误'
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
  } catch (e) {
    console.error('[LicenseController] 接口异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
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
  } catch (e) {
    console.error('[LicenseController] 接口异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
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
  } catch (e) {
    console.error('[LicenseController] 接口异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理员批量生成卡密
 */
export async function generateLicensesAdmin(req: Request, res: Response) {
  try {
    const { type, count, prefix, remark } = req.body;
    if (!type || !['trial', 'monthly', 'quarterly', 'yearly', 'lifetime'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: '卡密类型无效，支持: trial, monthly, quarterly, yearly, lifetime'
      });
    }
    // 自定义前缀白名单校验：仅允许字母/数字/连字符，最长 16 位
    const cleanPrefix = prefix ? String(prefix).trim() : '';
    if (cleanPrefix && !/^[A-Za-z0-9-]{0,16}$/.test(cleanPrefix)) {
      return res.status(400).json({
        success: false,
        message: '卡密前缀格式非法：仅允许字母、数字与连字符，最长 16 位'
      });
    }

    const user = (req as any).adminUser || { username: 'admin' };
    const result = licenseService.generateBatch({
      type: type as LicenseType,
      count: Number(count) || 1,
      prefix: cleanPrefix || undefined,
      // 备注封顶 128 字符：body 上限 1MB，不封顶会让单张卡密携带近 1MB 备注入库
      remark: remark ? String(remark).trim().slice(0, 128) : undefined,
      createdBy: user.username
    });

    // 批量生成失败（如持久化失败）须返回失败结果而不是假成功
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.message
      });
    }

    return res.json({
      success: true,
      message: result.message,
      data: {
        generatedCount: result.generatedKeys.length,
        keys: result.generatedKeys
      }
    });
  } catch (e) {
    console.error('[LicenseController] 接口异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理员一键解绑设备 (允许换机)
 */
export async function unbindLicenseAdmin(req: Request, res: Response) {
  try {
    const code = parseCode(req.body?.code);
    if (!code) {
      return res.status(400).json({ success: false, message: '请提供要解绑的激活码（长度需 ≤ 64）' });
    }

    const result = licenseService.unbind(code);
    if (result.success && result.oldDeviceId && result.oldDeviceId !== '无') {
      try {
        deviceService.updateDeviceActivation(result.oldDeviceId, false);
      } catch (err) {
        console.warn('[LicenseController] 解绑同步设备状态失败:', err);
      }
    }
    // 卡密不存在属"未找到"，回 404 而非 200+success:false，便于客户端与监控正确区分
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.error('[LicenseController] 接口异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理员冻结 / 恢复卡密
 */
export async function toggleLicenseAdmin(req: Request, res: Response) {
  try {
    const code = parseCode(req.body?.code);
    if (!code) {
      return res.status(400).json({ success: false, message: '请提供要操作的激活码（长度需 ≤ 64）' });
    }

    const result = licenseService.toggleStatus(code, Boolean(req.body?.disabled));
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.error('[LicenseController] 接口异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理员删除卡密
 */
export async function deleteLicenseAdmin(req: Request, res: Response) {
  try {
    const { code } = req.params;
    const sCode = Array.isArray(code) ? code[0] : String(code || '');
    if (!sCode || sCode.length > MAX_CODE_LEN) {
      return res.status(400).json({ success: false, message: '请提供要删除的激活码（长度需 ≤ 64）' });
    }

    const result = licenseService.deleteKey(sCode);
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.error('[LicenseController] 接口异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理员为卡密延期
 */
export async function extendLicenseAdmin(req: Request, res: Response) {
  try {
    const code = parseCode(req.body?.code);
    if (!code) {
      return res.status(400).json({ success: false, message: '请提供要延期的激活码（长度需 ≤ 64）' });
    }
    // 延期天数夹取：负数会反向扣减、超大值会造成整数问题
    const rawDays = Number(req.body?.additionalDays);
    const days = Number.isFinite(rawDays) ? Math.min(3650, Math.max(1, Math.trunc(rawDays))) : 30;

    const result = licenseService.extendDays(code, days);
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (e) {
    console.error('[LicenseController] 接口异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}
