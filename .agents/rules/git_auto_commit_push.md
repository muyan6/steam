---
description: 每次代码修改完成后自动提交并推送到远端仓库
trigger: always_on
---

# 自动提交、远程双端推送与 Release 自动上传规则 (GitHub & Gitee)

1. 涉及新版本编译发布时：
   - 必须自动执行 `npm run release:upload`，将安装包（如 `ChunFengDu_X.Y.Z_x64-setup.exe`）同步发布上传至 GitHub 与 Gitee Releases，确保公网下载直链 100% 可用。
2. 每次完成代码修改并验证后，必须自动执行：
   - `git add -A`
   - `git commit -m "..."`
   - `git push origin main`（origin 已配置同时推送到 GitHub 与 Gitee）
   - 如有 tag 更新：`git push origin -f <tag>`
3. 确保 GitHub 与 Gitee 双端远端仓库及 Release 资产始终保持实时对齐与最新同步状态。
