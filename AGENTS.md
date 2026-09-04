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

### 2. 前后端同步修改与一体化协同规范 (Frontend & Backend Synchronization)
- **功能对齐与闭环同步**：前端（Vue 客户端界面、主进程 IPC 服务）新增或拓展任何功能模块，后端（Node.js/Express 服务端、API 路由、控制器、数据库模型及 Web 控制台 Dashboard）必须**同步新增并完全适配对应的支持接口与数据调度逻辑**，严禁前端新增功能而后端缺失支持、或后端单方面孤立改动。
- **严禁乱修改与破坏性改动**：
  - 前后端接口数据结构（DTO）、请求响应字段命名（统一驼峰规范）、TypeScript 类型定义必须严格对齐。
  - 避免无序和随意修改现有业务逻辑，保证接口向前兼容性与整体系统协调性。
- **双端协同构建验证**：
  - 任何改动均需同时确保前端构建 (`npx vite build`) 与后端编译 (`npm run build` in `server/`) 顺利通过。

### 3. 项目架构与业务规则
- **Steam 解锁与清单闭环**：
  - 必须保证 `depotcache/` 清单下发、`st_scripts/*.lua` 规则以及 DepotKey 密钥注入三位一体。
  - 严禁使用全 0 占位符覆盖 28.8万条真实有效密钥。
  - 支持 OpenSteamTool 与 GreenLuma (AppList) 双轨兼容。
