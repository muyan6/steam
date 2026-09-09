---
description: 每次代码修改完成后自动提交并推送到远端仓库
trigger: always_on
---

# 自动提交与远程双端推送规则 (GitHub & Gitee)

1. 每次完成代码修改并验证后，必须自动执行：
   - `git add -A`
   - `git commit -m "..."`
   - `git push origin main`（origin 已配置同时推送到 GitHub 与 Gitee）
2. 确保 GitHub 与 Gitee 双端远端仓库始终保持实时对齐与最新同步状态。
