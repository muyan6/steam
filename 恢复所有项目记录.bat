@echo off
chcp 65001 >nul
title 恢复 Antigravity 历史记录
echo =======================================================
echo          正在恢复 Antigravity 所有项目历史记录
echo =======================================================
echo.
echo 步骤 1/3: 正在退出 Antigravity 及后台服务...
taskkill /F /IM Antigravity.exe >nul 2>&1
taskkill /F /IM language_server.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo 步骤 2/3: 正在将 107 个完整会话索引写入配置文件...
copy /Y "C:\Users\lenovo\.gemini\antigravity\agyhub_summaries_proto.pb.restored" "C:\Users\lenovo\.gemini\antigravity\agyhub_summaries_proto.pb" >nul

echo 步骤 3/3: 正在重新启动 Antigravity...
start "" "C:\Users\lenovo\AppData\Local\Programs\antigravity\Antigravity.exe"

echo.
echo =======================================================
echo  恢复成功！请查看侧边栏 Projects 各项目下的历史会话。
echo =======================================================
timeout /t 3 >nul
