import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

export class DeviceService {
  private cachedDeviceId: string | null = null;

  /**
   * 获取当前电脑的唯一硬件设备码 (格式如 CFD-A1B2-C3D4-E5F6-7890)
   */
  public getDeviceId(): string {
    if (this.cachedDeviceId) {
      return this.cachedDeviceId;
    }

    let rawIdentifier = '';

    // 1. Windows: 尝试从注册表读取系统唯一 MachineGuid
    if (process.platform === 'win32') {
      try {
        const stdout = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
          encoding: 'utf-8',
          timeout: 2000,
          windowsHide: true
        });
        const match = stdout.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
        if (match && match[1]) {
          rawIdentifier = `win_guid_${match[1].trim()}`;
        }
      } catch {
        // Fallback
      }
    }

    // 2. 结合主板、CPU、网卡 MAC 与系统特征增强唯一性
    const networkInterfaces = os.networkInterfaces();
    let macAddress = '';
    for (const key of Object.keys(networkInterfaces)) {
      const ifaceList = networkInterfaces[key];
      if (ifaceList) {
        for (const iface of ifaceList) {
          if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
            macAddress += iface.mac;
          }
        }
      }
    }

    const cpuInfo = os.cpus().map(c => c.model).join('|');
    const hostname = os.hostname();
    const platform = os.platform();
    const arch = os.arch();

    const combinedSeed = `${rawIdentifier}|${macAddress}|${cpuInfo}|${hostname}|${platform}|${arch}`;
    const hash = crypto.createHash('sha256').update(combinedSeed).digest('hex').toUpperCase();

    // 格式化为 4 段清晰可读的设备识别码: CFD-XXXX-XXXX-XXXX-XXXX
    const p1 = hash.substring(0, 4);
    const p2 = hash.substring(4, 8);
    const p3 = hash.substring(8, 12);
    const p4 = hash.substring(12, 16);

    this.cachedDeviceId = `CFD-${p1}-${p2}-${p3}-${p4}`;
    console.log(`[DeviceService] 本机唯一设备识别码 (Device ID): ${this.cachedDeviceId}`);
    return this.cachedDeviceId;
  }
}

export const deviceService = new DeviceService();
