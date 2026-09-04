# 项目 AI 助手行为准则 (Antigravity & Gemini Rules)

## 必选执行规范 (Always Enforced)

### 自动代码提交与远程推送 (Auto Git Commit & Push)
- 每次完成用户的任务修改、代码调试、页面优化或 Bug 修复后，**必须在最终回复前自动执行 Git 暂存、提交并推送到远端仓库**：
  ```bash
  git add -A
  git commit -m "feat/fix/refactor: 详细更新说明"
  git push origin main
  ```
- 提交完成后向用户汇报提交摘要与 Commit ID。

### 前后端同步修改与一体化协同规范 (Frontend & Backend Synchronization)
- **同步新增与对齐**：前端（Vue/Electron 客户端）新增功能时，后端（Express/Server API/Dashboard）必须**同步新增**配套的接口、字段和数据支持，拒绝单端孤立或脱节开发。
- **严禁无序随意改动**：保持接口命名、参数与 TypeScript 类型严密一致，确保前后端系统更加协调、适配且高内聚。
- **双端构建验证**：修改后必须同时通过前端 (`npx vite build`) 和后端 (`npm run build` in `server/`) 编译。
