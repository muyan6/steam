---
description: 每次代码修改完成后自动提交并推送到远端仓库
trigger: always_on
---

# 自动提交与远程推送规则

1. 每次完成代码修改并验证后，必须自动执行：
   - `git add -A`
   - `git commit -m "..."`
   - `git push origin main`
2. 确保远端仓库始终保持最新同步状态。
