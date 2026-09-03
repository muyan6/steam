# Agent Guidelines & Workflow Rules

## 核心工作流规范 (Mandatory Workflow)

### 1. 自动代码提交与远程推送要求 (Auto Git Commit & Push)
- **要求**：在每次完成代码修改、Bug 修复、新增功能或重构后，**必须自动执行 Git 提交并推送到远程仓库**。
- **操作流程**：
  1. 运行测试或构建命令确保代码无错误 (`npm run build` / `npx vite build`)。
  2. 执行 `git add -A` 暂存所有工作区修改。
  3. 编写符合 Conventional Commits 规范的清晰提交信息执行 `git commit -m "..."`。
  4. 执行 `git push origin <当前分支>` 将最新提交实时推送到远程 Git 仓库。
  5. 在回复中向用户汇报提交哈希与推送状态。

### 2. 项目架构与业务规则
- **Steam 解锁与清单闭环**：
  - 必须保证 `depotcache/` 清单下发、`st_scripts/*.lua` 规则以及 DepotKey 密钥注入三位一体。
  - 严禁使用全 0 占位符覆盖 28.8万条真实有效密钥。
  - 支持 OpenSteamTool 与 GreenLuma (AppList) 双轨兼容。
