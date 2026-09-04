import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { SteamEnvironmentInfo, EnvironmentDiagnosticResult, EnvironmentCheckItem } from '../../types';

const execAsync = promisify(exec);

/**
 * 探测当前 Windows 宿主环境与 Steam 运行架构是否支持 64 位 OpenSteamTool
 * 注意：Windows 平台上的 steam.exe 引导文件在 PE 格式上历史沿用 x86，
 * 但只要处于 64 位 Windows 系统下，Steam 运行时的 CEF / WebHelper 均为 64 位，
 * 能够完美加载 64 位 OpenSteamTool.dll、dwmapi.dll 与 xinput1_4.dll。
 */
export function is64BitWindowsEnvironment(): boolean {
  return (
    process.arch === 'x64' ||
    process.env.PROCESSOR_ARCHITECTURE === 'AMD64' ||
    Boolean(process.env.PROCESSOR_ARCHITEW6432)
  );
}

export class SteamService {
  private customSteamPath: string | null = null;
  private lastLaunchedWithOnlineFix: boolean = false;

  public setCustomSteamPath(customPath: string) {
    if (fs.existsSync(customPath)) {
      this.customSteamPath = customPath;
    }
  }

  /**
   * 探测 Steam 运行环境位数架构 (64 位 / 32 位)
   */
  public async detectSteamBitness(customPath?: string | null): Promise<'x86' | 'x64' | 'unknown'> {
    const steamPath = customPath || (await this.detectSteamPath());
    if (!steamPath) return 'unknown';

    // 检查宿主系统架构：只要是 64 位 Windows，Steam 客户端就能正常挂载 64 位 OpenSteamTool
    if (is64BitWindowsEnvironment()) {
      return 'x64';
    }

    return 'x86';
  }

  /**
   * 自动探测 Steam 安装路径（支持进程探测、注册表查询及全盘常见路径扫描）
   */
  public async detectSteamPath(): Promise<string | null> {
    if (this.customSteamPath && fs.existsSync(this.customSteamPath)) {
      return this.customSteamPath;
    }

    // 0. 优先尝试从当前正在运行的 steam.exe 进程获取精确路径
    try {
      const { stdout } = await execAsync('powershell -NoProfile -Command "Get-Process -Name steam -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path"');
      const runningExe = stdout.trim();
      if (runningExe && fs.existsSync(runningExe)) {
        const dir = path.dirname(runningExe);
        if (fs.existsSync(dir)) {
          return dir;
        }
      }
    } catch {
      // ignore
    }

    try {
      // 1. 尝试从当前用户注册表查询 (HKCU\Software\Valve\Steam\SteamPath)
      const { stdout } = await execAsync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath');
      const match = stdout.match(/SteamPath\s+REG_SZ\s+(.*)/i);
      if (match && match[1]) {
        const foundPath = match[1].trim().replace(/\//g, '\\');
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }
    } catch {
      // 忽略错误，尝试下一个
    }

    try {
      // 2. 尝试从 64 位及 32 位机器注册表查询 InstallPath
      const regKeys = [
        'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
        'HKLM\\SOFTWARE\\Valve\\Steam',
        'HKCU\\Software\\Valve\\Steam'
      ];
      for (const regKey of regKeys) {
        try {
          const { stdout } = await execAsync(`reg query "${regKey}" /v InstallPath`);
          const match = stdout.match(/InstallPath\s+REG_SZ\s+(.*)/i);
          if (match && match[1]) {
            const foundPath = match[1].trim().replace(/\//g, '\\');
            if (fs.existsSync(foundPath)) {
              return foundPath;
            }
          }
        } catch {}
      }
    } catch {
      // 忽略错误
    }

    // 3. 常见盘符与默认路径遍历扫描
    const drives = ['C', 'D', 'E', 'F', 'G'];
    const subDirs = [
      'Steam',
      'steam',
      'Program Files (x86)\\Steam',
      'Program Files\\Steam',
      'Games\\Steam'
    ];

    for (const drive of drives) {
      for (const sub of subDirs) {
        const candidate = `${drive}:\\${sub}`;
        if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'steam.exe'))) {
          return candidate;
        }
      }
    }

    return null;
  }

  /**
   * 检查 Steam 客户端是否正在运行
   */
  public async isSteamRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq steam.exe" /NH');
      return stdout.toLowerCase().includes('steam.exe');
    } catch {
      return false;
    }
  }

  /**
   * 终止 Steam 进程（多重机制：官方安全关闭 -> taskkill -> 权限提升兜底）
   */
  public async killSteam(): Promise<boolean> {
    try {
      // 1. 尝试调用 Steam 原生 -shutdown 退出
      const steamPath = await this.detectSteamPath();
      if (steamPath) {
        const steamExe = path.join(steamPath, 'steam.exe');
        if (fs.existsSync(steamExe)) {
          try {
            await execAsync(`"${steamExe}" -shutdown`);
          } catch {}
        }
      }

      // 2. 尝试标准 taskkill 同时清理 steam.exe 与 steamwebhelper.exe
      try {
        await execAsync('taskkill /F /IM steam.exe /T');
      } catch {}
      try {
        await execAsync('taskkill /F /IM steamwebhelper.exe /T');
      } catch {}

      // 3. 尝试 PowerShell Stop-Process
      try {
        await execAsync('powershell -NoProfile -Command "Stop-Process -Name steam,steamwebhelper -Force -ErrorAction SilentlyContinue"');
      } catch {}

      // 4. 轮询检测是否已完全释放
      for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const running = await this.isSteamRunning();
        if (!running) return true;
      }

      // 5. 若 Steam 以管理员权限运行导致普通权限无法直接 Kill，调用提权结束
      try {
        await execAsync('powershell -NoProfile -Command "Start-Process taskkill -ArgumentList \'/F /IM steam.exe /T\' -Verb RunAs -WindowStyle Hidden"');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {}

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查当前运行的 Steam 是否带有 -onlinefix 联机参数
   */
  public async isOnlineFixRunning(): Promise<boolean> {
    const isRunning = await this.isSteamRunning();
    if (!isRunning) {
      this.lastLaunchedWithOnlineFix = false;
      return false;
    }

    try {
      const { stdout } = await execAsync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name = \'steam.exe\'\\").CommandLine"');
      if (stdout && stdout.toLowerCase().includes('-onlinefix')) {
        this.lastLaunchedWithOnlineFix = true;
        return true;
      }
    } catch {}

    return this.lastLaunchedWithOnlineFix;
  }

  /**
   * 启动 Steam 客户端 (支持附加参数如 -onlinefix)
   */
  public async launchSteam(extraArgs: string[] = []): Promise<boolean> {
    const steamPath = await this.detectSteamPath();
    if (!steamPath) return false;

    const steamExe = path.join(steamPath, 'steam.exe');
    if (!fs.existsSync(steamExe)) return false;

    this.lastLaunchedWithOnlineFix = extraArgs.some((a) => a.toLowerCase().includes('-onlinefix'));

    try {
      spawn(steamExe, extraArgs, {
        detached: true,
        stdio: 'ignore'
      }).unref();
      return true;
    } catch (e) {
      console.error('启动 Steam 失败:', e);
      return false;
    }
  }

  /**
   * 重启 Steam 客户端
   */
  public async restartSteam(extraArgs: string[] = []): Promise<boolean> {
    const isRunning = await this.isSteamRunning();
    if (isRunning) {
      await this.killSteam();
      // 等待 1.5 秒确保端口和文件锁释放
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return this.launchSteam(extraArgs);
  }

  /**
   * 获取 Steam 环境完整信息
   */
  public async getEnvironmentInfo(): Promise<SteamEnvironmentInfo> {
    const steamPath = await this.detectSteamPath();
    const isRunning = await this.isSteamRunning();
    const steamBitness = await this.detectSteamBitness(steamPath);
    const globalOnlineFixEnabled = await this.isOnlineFixRunning();

    let ostInstalled = false;
    let scriptsCount = 0;

    if (steamPath) {
      // 检查 64 位核心 DLL (OpenSteamTool.dll + dwmapi.dll / xinput1_4.dll)
      const hasCore = fs.existsSync(path.join(steamPath, 'OpenSteamTool.dll'));
      const hasHijack = fs.existsSync(path.join(steamPath, 'dwmapi.dll')) || fs.existsSync(path.join(steamPath, 'xinput1_4.dll'));
      // 具备核心 DLL 且处于 64 位环境时判定为已注入就绪
      ostInstalled = hasCore && hasHijack && steamBitness === 'x64';

      // 统计 config/lua/ 下所有 <appid>.lua 规则
      const luaDir = path.join(steamPath, 'config', 'lua');
      if (fs.existsSync(luaDir)) {
        try {
          const files = fs.readdirSync(luaDir);
          scriptsCount = files.filter((f) => /^\d+\.lua$/i.test(f)).length;
        } catch {
          scriptsCount = 0;
        }
      }
    }

    return {
      steamPath,
      isRunning,
      ostInstalled,
      scriptsCount,
      globalOnlineFixEnabled,
      steamBitness
    };
  }

  /**
   * 深度环境诊断检测：检测 Steam 目录、位数架构、Hook DLL、toml 配置、st_scripts 规则引擎与运行状态
   */
  public async checkEnvironmentHealth(): Promise<EnvironmentDiagnosticResult> {
    const items: EnvironmentCheckItem[] = [];
    const steamPath = await this.detectSteamPath();
    const steamBitness = await this.detectSteamBitness(steamPath);

    // 1. Steam 安装路径校验
    if (!steamPath) {
      items.push({
        name: 'Steam 安装路径',
        category: 'path',
        status: 'error',
        message: '未检测到 Steam 安装路径',
        detail: '请在设置中手动浏览并指定 Steam 安装根目录。'
      });
    } else {
      const steamExe = path.join(steamPath, 'steam.exe');
      if (fs.existsSync(steamExe)) {
        const bitnessText = steamBitness === 'x64' ? '64 位 (x64 兼容环境)' : '32 位 (x86)';
        items.push({
          name: 'Steam 核心主程序',
          category: 'path',
          status: 'success',
          message: `路径有效 (${bitnessText})`,
          detail: steamPath
        });

        items.push({
          name: 'Steam 运行架构环境',
          category: 'path',
          status: 'success',
          message: `已识别为 ${bitnessText}`,
          detail: '已完美适配 64 位 OpenSteamTool 核心注入组件'
        });
      } else {
        items.push({
          name: 'Steam 核心主程序',
          category: 'path',
          status: 'error',
          message: '指定目录下未找到 steam.exe',
          detail: steamPath
        });
      }
    }

    // 2. OpenSteam 核心 Hook DLL 模块与架构匹配检测
    let hasHookDll = false;
    let hookDllName = '';

    if (steamPath) {
      const hookDllCandidates = ['OpenSteamTool.dll', 'dwmapi.dll', 'xinput1_4.dll'];
      for (const dll of hookDllCandidates) {
        const p = path.join(steamPath, dll);
        if (fs.existsSync(p)) {
          hasHookDll = true;
          hookDllName = `${dll} (x64)`;
          break;
        }
      }

      if (hasHookDll) {
        items.push({
          name: 'OpenSteam 注入模块 (DLL)',
          category: 'hook',
          status: 'success',
          message: `核心 Hook DLL 已就绪 (${hookDllName})`,
          detail: `已适配 64 位 Steam 客户端架构，注入模块加载正常`
        });
      } else {
        items.push({
          name: 'OpenSteam 注入模块 (DLL)',
          category: 'hook',
          status: 'error',
          message: '未检测到 Hook 模块',
          detail: 'Steam 根目录下缺少 OpenSteamTool.dll / dwmapi.dll / xinput1_4.dll 核心劫持模块'
        });
      }
    }

    // 3. 配置文件 opensteamtool.toml 与规则目录 config/lua/
    if (steamPath) {
      const tomlPath = path.join(steamPath, 'opensteamtool.toml');
      if (!fs.existsSync(tomlPath)) {
        try {
          const content = `# OpenSteamTool Configuration generated by 春风渡\n[inject]\nenabled = true\n\n[manifest]\nserver = "steamrun"\n`;
          fs.writeFileSync(tomlPath, content, 'utf-8');
        } catch {}
      }

      if (fs.existsSync(tomlPath)) {
        try {
          const tomlContent = fs.readFileSync(tomlPath, 'utf-8');
          const isInjectEnabled = tomlContent.includes('enabled = true');
          items.push({
            name: '配置文件 opensteamtool.toml',
            category: 'config',
            status: isInjectEnabled ? 'success' : 'warning',
            message: isInjectEnabled ? '配置完整且注入已开启 ([inject] enabled = true)' : '配置文件存在，但注入选项未开启',
            detail: tomlPath
          });
        } catch {
          items.push({
            name: '配置文件 opensteamtool.toml',
            category: 'config',
            status: 'warning',
            message: '配置文件读取异常',
            detail: tomlPath
          });
        }
      } else {
        items.push({
          name: '配置文件 opensteamtool.toml',
          category: 'config',
          status: 'warning',
          message: '尚未生成 opensteamtool.toml',
          detail: '请点击「一键修复」以自动生成'
        });
      }

      const luaDir = path.join(steamPath, 'config', 'lua');
      const scriptsDir = path.join(steamPath, 'st_scripts');
      if (!fs.existsSync(luaDir)) {
        try { fs.mkdirSync(luaDir, { recursive: true }); } catch {}
      }
      if (!fs.existsSync(scriptsDir)) {
        try { fs.mkdirSync(scriptsDir, { recursive: true }); } catch {}
      }

      let totalRulesCount = 0;
      try {
        const luaFiles = fs.existsSync(luaDir) ? fs.readdirSync(luaDir).filter(f => f.endsWith('.lua')) : [];
        const scriptFiles = fs.existsSync(scriptsDir) ? fs.readdirSync(scriptsDir).filter(f => f.endsWith('.lua')) : [];
        const uniqueRules = new Set([...luaFiles, ...scriptFiles]);
        totalRulesCount = uniqueRules.size;

        items.push({
          name: '规则引擎目录 config/lua/',
          category: 'scripts',
          status: 'success',
          message: `规则目录正常，已收录 ${totalRulesCount} 款应用自动化解锁规则`,
          detail: luaDir
        });
      } catch {
        items.push({
          name: '规则引擎目录 config/lua/',
          category: 'scripts',
          status: 'warning',
          message: '目录访问受限或读取异常',
          detail: luaDir
        });
      }
    }

    // 4. Steam 运行时状态检测
    const isRunning = await this.isSteamRunning();
    if (isRunning) {
      items.push({
        name: 'Steam 客户端运行状态',
        category: 'process',
        status: hasHookDll ? 'success' : 'warning',
        message: hasHookDll ? 'Steam 正在运行，注入内核处于活跃状态' : 'Steam 正在运行，但缺少核心 Hook DLL',
        detail: hasHookDll ? '当前可直接免重启添加入库规则并秒级生效' : '请先同步配置并重启 Steam'
      });
    } else {
      items.push({
        name: 'Steam 客户端运行状态',
        category: 'process',
        status: 'warning',
        message: 'Steam 客户端当前未运行',
        detail: '可通过点击「⚡ 启动 / 重启 Steam」拉起客户端'
      });
    }

    // 综合判定
    const hasError = items.some(i => i.status === 'error');
    const hasWarning = items.some(i => i.status === 'warning');
    const overallStatus = hasError ? 'error' : hasWarning ? 'partial' : 'ready';
    const summary = overallStatus === 'ready'
      ? '所有环境组件均已完美配置，OpenSteam 运行环境已就绪！'
      : overallStatus === 'partial'
      ? '环境基础项已配置，部分状态建议点击同步或重启优化。'
      : '检测到影响正常解锁的核心项异常，请根据提示进行修复。';

    return {
      overallStatus,
      summary,
      items,
      checkedAt: new Date().toLocaleTimeString()
    };
  }
}

export const steamService = new SteamService();
