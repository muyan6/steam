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
