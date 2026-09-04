import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { steamService } from './steamService';
import { ostService } from './ostService';
import { luaGameService } from './luaGameService';
import { manifestDownloadService } from './manifestDownloadService';
import { ToolboxActionResult, ToolboxStatusInfo } from '../../types';

export class ToolboxService {
  /**
   * 1. 清理 Steam 缓存
   * - 结束 Steam 相关进程
   * - 删除 DLL 内核文件、缓存文件相关残留
   * - 重新启动 Steam，重启完成后需重新入库一个游戏
   */
  public async clearSteamCache(): Promise<ToolboxActionResult> {
    const steps: string[] = [];
    let cleanedFilesCount = 0;

    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return {
        success: false,
        message: '未找到 Steam 安装目录，请先在设置中指定 Steam 路径。',
        steps: ['[失败] 无法定位 Steam 目录']
      };
    }

    try {
      // 步骤 1: 结束 Steam 相关进程
      steps.push('正在结束 Steam 及相关进程 (steam.exe, steamwebhelper.exe)...');
      await steamService.killSteam();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      steps.push('✓ 已成功终止所有 Steam 关联进程');

      // 步骤 2: 删除 DLL 内核文件与缓存残留
      steps.push('正在深度清理 DLL 内核文件、CEF/网页缓存及临时日志...');
      const filesToDelete = [
        'OpenSteamTool.dll',
        'dwmapi.dll',
        'xinput1_4.dll',
        'version.dll',
        'hid.dll',
        'SmokeAPI.dll',
        'opensteamtool.toml'
      ];

      for (const f of filesToDelete) {
        const fullPath = path.join(steamPath, f);
        if (fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
            cleanedFilesCount++;
          } catch (e: any) {
            console.warn(`[Toolbox] 清理文件 ${f} 异常:`, e.message);
          }
        }
      }

      // 清理 opensteamtool 缓存目录与日志
      const ostDir = path.join(steamPath, 'opensteamtool');
      if (fs.existsSync(ostDir)) {
        try {
          fs.rmSync(ostDir, { recursive: true, force: true });
          cleanedFilesCount++;
        } catch {}
      }

      // 清理 appcache/httpcache (CEF 网页与网络缓存)
      const httpCacheDir = path.join(steamPath, 'appcache', 'httpcache');
      if (fs.existsSync(httpCacheDir)) {
        try {
          fs.rmSync(httpCacheDir, { recursive: true, force: true });
          cleanedFilesCount++;
        } catch {}
      }

      // 清理 config/htmlcache
      const htmlCacheDir = path.join(steamPath, 'config', 'htmlcache');
      if (fs.existsSync(htmlCacheDir)) {
        try {
          fs.rmSync(htmlCacheDir, { recursive: true, force: true });
          cleanedFilesCount++;
        } catch {}
      }

      // 确保 config/lua 与 depotcache 骨架就绪
      luaGameService.ensureLuaDir(steamPath);
      manifestDownloadService.ensureDepotCacheDir(steamPath);

      steps.push(`✓ 已清理 ${cleanedFilesCount} 项内核残留与临时缓存`);

      // 步骤 3: 重新拉起 Steam 客户端
      steps.push('正在重新启动 Steam 客户端...');
      await new Promise((resolve) => setTimeout(resolve, 800));
      const restarted = await steamService.launchSteam();
      if (restarted) {
        steps.push('✓ Steam 客户端已重新启动');
      } else {
        steps.push('⚠ Steam 客户端启动超时，请稍后手动点击“重启Steam”');
      }

      return {
        success: true,
        message: 'Steam 缓存与 DLL 内核残留已清理完毕，已自动重启 Steam！请重新入库一个游戏进行测试。',
        steps,
        cleanedFilesCount,
        restartedSteam: restarted
      };
    } catch (err: any) {
      return {
        success: false,
        message: `清理 Steam 缓存失败: ${err.message}`,
        steps: [...steps, `[错误] ${err.message}`]
      };
    }
  }

  /**
   * 2. 修复 OpenSteamTool 内核
   * - 先执行清理 Steam 缓存
   * - 下载 / 部署 OpenSteamTool 64位核心 DLL 三件套
   * - 修复 OpenSteamTool 配置文件并启动 Steam
   */
  public async repairOstKernel(): Promise<ToolboxActionResult> {
    const steps: string[] = [];

    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return {
        success: false,
        message: '未找到 Steam 安装目录。',
        steps: ['[失败] 无法定位 Steam 目录']
      };
    }

    try {
      // 步骤 1: 先执行清理 Steam 缓存
      steps.push('1. 正在先执行清理 Steam 缓存并释放文件句柄...');
      await steamService.killSteam();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const oldDlls = ['OpenSteamTool.dll', 'dwmapi.dll', 'xinput1_4.dll', 'version.dll', 'hid.dll'];
      for (const dll of oldDlls) {
        const p = path.join(steamPath, dll);
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch {}
        }
      }
      steps.push('✓ Steam 进程已退出，旧版 DLL 残留已清理');

      // 步骤 2: 重新部署 OpenSteamTool 64 位核心组件 (OpenSteamTool.dll, dwmapi.dll, xinput1_4.dll)
      steps.push('2. 正在部署 64 位 OpenSteamTool 核心组件与依赖模块...');
      const deployRes = await ostService.deployCoreBinaries(steamPath);
      if (!deployRes.success) {
        throw new Error(deployRes.message);
      }
      steps.push(`✓ OpenSteamTool 核心组件部署成功 (${deployRes.deployedCount}/3 核心模块就绪)`);

      // 步骤 3: 写入 toml 并初始化规则/清单目录
      steps.push('3. 正在生成 opensteamtool.toml 并修复配置...');
      ostService.generateTomlConfig(steamPath, 'steamrun');
      luaGameService.ensureLuaDir(steamPath);
      manifestDownloadService.ensureDepotCacheDir(steamPath);
      steps.push('✓ 内核配置文件已修复就绪');

      steps.push('正在启动 Steam 客户端...');
      await new Promise((resolve) => setTimeout(resolve, 800));
      const restarted = await steamService.launchSteam();
      if (restarted) {
        steps.push('✓ Steam 客户端已启动');
      }

      return {
        success: true,
        message: 'OpenSteamTool 64位内核已成功修复并就绪，Steam 已重新拉起！',
        steps,
        restartedSteam: restarted
      };
    } catch (err: any) {
      return {
        success: false,
        message: `修复 OpenSteamTool 内核失败: ${err.message}`,
        steps: [...steps, `[错误] ${err.message}`]
      };
    }
  }

  /**
   * 3. 补齐 Open 内核 SHA256 校验包
   * - 结束 Steam 相关进程
   * - 删除旧的 opensteamtool 文件夹
   * - 下载内核相关文件并解压/写入到 opensteamtool
   * - 重新启动 Steam
   */
  public async fillSha256Checksums(): Promise<ToolboxActionResult> {
    const steps: string[] = [];

    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return {
        success: false,
        message: '未找到 Steam 安装目录。',
        steps: ['[失败] 无法定位 Steam 目录']
      };
    }

    try {
      // 步骤 1: 结束 Steam 相关进程
      steps.push('1. 正在结束 Steam 相关进程...');
      await steamService.killSteam();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      steps.push('✓ Steam 进程已安全退出');

      // 步骤 2: 删除旧的 opensteamtool 文件夹
      steps.push('2. 正在删除旧版 opensteamtool 文件夹...');
      const ostDir = path.join(steamPath, 'opensteamtool');
      if (fs.existsSync(ostDir)) {
        try {
          fs.rmSync(ostDir, { recursive: true, force: true });
        } catch (e: any) {
          console.warn('[Toolbox] 删除旧 opensteamtool 文件夹警告:', e.message);
        }
      }
      steps.push('✓ 旧版 opensteamtool 缓存目录已清理');

      // 步骤 3: 重新创建 opensteamtool 目录并写入内核 SHA256 字典与校验数据
      steps.push('3. 正在生成并补齐全量 SHA256 校验包与离线数据字典...');
      if (!fs.existsSync(ostDir)) {
        fs.mkdirSync(ostDir, { recursive: true });
      }

      // 写入 sha256.json：对已部署的核心 DLL 计算真实 SHA256 摘要
      const sha256Data: Record<string, unknown> = {
        version: '1.4.8-full',
        generatedAt: new Date().toISOString(),
        engine: 'OpenSteamTool-x64',
        checksums: {} as Record<string, string>,
        meta: {
          autoValidate: true,
          skipCorrupted: false,
          manifestIntegrityCheck: true
        }
      };
      const checksums = sha256Data.checksums as Record<string, string>;
      const dllCandidates = ['OpenSteamTool.dll', 'dwmapi.dll', 'xinput1_4.dll'];
      let hashedCount = 0;
      for (const dll of dllCandidates) {
        const dllPath = path.join(steamPath, dll);
        if (fs.existsSync(dllPath)) {
          try {
            checksums[dll] = crypto.createHash('sha256').update(fs.readFileSync(dllPath)).digest('hex');
            hashedCount++;
          } catch {}
        }
      }
      if (hashedCount === 0) {
        throw new Error('未找到已部署的核心 DLL，请先执行「修复 OpenSteamTool 内核」后再补齐校验包');
      }

      fs.writeFileSync(path.join(ostDir, 'sha256.json'), JSON.stringify(sha256Data, null, 2), 'utf-8');
      steps.push(`✓ 已计算并写入 ${hashedCount} 个核心 DLL 的真实 SHA256 校验数据到 opensteamtool/`);

      // 步骤 4: 重新启动 Steam
      steps.push('4. 正在重新启动 Steam 客户端...');
      await new Promise((resolve) => setTimeout(resolve, 800));
      const restarted = await steamService.launchSteam();
      if (restarted) {
        steps.push('✓ Steam 客户端已成功重新启动');
      }

      return {
        success: true,
        message: 'OpenSteamTool 所需 SHA256 校验包已成功补齐并就绪，Steam 已重启！',
        steps,
        restartedSteam: restarted
      };
    } catch (err: any) {
      return {
        success: false,
        message: `补齐 Open 内核 SHA256 失败: ${err.message}`,
        steps: [...steps, `[错误] ${err.message}`]
      };
    }
  }

  /**
   * 4. Open 内核清单服务器自动切换
   * - 结束 Steam 进程
   * - 开启 Open 内核清单服务器自动切换功能（配置多节点轮询与高可用自动降级）
   * - 重新启动 Steam
   */
  public async enableAutoSwitchManifestServers(): Promise<ToolboxActionResult> {
    const steps: string[] = [];

    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return {
        success: false,
        message: '未找到 Steam 安装目录。',
        steps: ['[失败] 无法定位 Steam 目录']
      };
    }

    try {
      // 步骤 1: 结束 Steam 进程
      steps.push('1. 正在结束 Steam 客户端进程...');
      await steamService.killSteam();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      steps.push('✓ Steam 进程已安全退出');

      // 步骤 2: 开启 Open 内核清单服务器自动切换功能
      steps.push('2. 正在写入多节点高可用清单自动切换配置...');
      const tomlPath = path.join(steamPath, 'opensteamtool.toml');
      const tomlContent = `# OpenSteamTool Configuration generated by 春风渡
# 开启多节点清单高可用自动轮询与智能故障切换
[inject]
enabled = true

[manifest]
server = "steamrun"
auto_switch = true
fallback_servers = ["gmrc.wudrm.com", "manifest.steam.run", "opensteamtool.com"]
timeout_ms = 4000
retry_count = 3
auto_bypass_gfw = true

[network]
cdn_acceleration = true
prefetch_manifest = true
`;

      fs.writeFileSync(tomlPath, tomlContent, 'utf-8');
      steps.push('✓ 已配置 SteamRun、WUDRM 与社区多节点自动故障转移策略');

      // 步骤 3: 重新启动 Steam
      steps.push('3. 正在重新启动 Steam 客户端...');
      await new Promise((resolve) => setTimeout(resolve, 800));
      const restarted = await steamService.launchSteam();
      if (restarted) {
        steps.push('✓ Steam 客户端已成功重新启动并加载多节点清单网络');
      }

      return {
        success: true,
        message: 'Open 内核清单服务器自动切换已开启！多节点智能轮询已生效，解决下载游戏无网络问题。',
        steps,
        restartedSteam: restarted
      };
    } catch (err: any) {
      return {
        success: false,
        message: `开启清单服务器自动切换失败: ${err.message}`,
        steps: [...steps, `[错误] ${err.message}`]
      };
    }
  }

  /**
   * 获取工具箱各项状态详情
   */
  public async getStatus(): Promise<ToolboxStatusInfo> {
    const steamPath = await steamService.detectSteamPath();
    const isRunning = await steamService.isSteamRunning();

    let hasOpenSteamTool = false;
    let hasSha256Cache = false;
    let autoSwitchEnabled = false;
    let currentManifestServer = 'steamrun';

    if (steamPath) {
      hasOpenSteamTool = fs.existsSync(path.join(steamPath, 'OpenSteamTool.dll'));
      const ostDir = path.join(steamPath, 'opensteamtool');
      hasSha256Cache = fs.existsSync(ostDir) && fs.existsSync(path.join(ostDir, 'sha256.json'));

      const tomlPath = path.join(steamPath, 'opensteamtool.toml');
      if (fs.existsSync(tomlPath)) {
        try {
          const content = fs.readFileSync(tomlPath, 'utf-8');
          autoSwitchEnabled = content.includes('auto_switch = true');
          const match = content.match(/server\s*=\s*"([^"]+)"/);
          if (match && match[1]) {
            currentManifestServer = match[1];
          }
        } catch {}
      }
    }

    return {
      steamPath,
      isRunning,
      hasOpenSteamTool,
      hasSha256Cache,
      autoSwitchEnabled,
      currentManifestServer
    };
  }
}

export const toolboxService = new ToolboxService();
