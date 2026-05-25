@echo off
chcp 65001 >nul
echo ========================================
echo   MaiBot Deskpet 一键启动
echo ========================================
echo.

set "ROOT=%~dp0"
set "GSV_DIR=D:\GPT-SoVITS-v2pro-20250604"

echo [1/4] GPT-SoVITS API (端口 9880)...
start "GPT-SoVITS API" cmd /k "cd /d %GSV_DIR% && runtime\python.exe api_v2.py -p 9880"

echo [2/4] TTS 桥 (端口 9881)...
start "TTS Bridge" cmd /k "python -u %ROOT%gpt-sovits-bridge.py"

echo [3/4] STT 桥 (端口 18530)...
start "STT Bridge" cmd /k "python -u %ROOT%stt-bridge.py"

echo [4/4] 桌宠前端...
start "Deskpet" cmd /k "cd /d %ROOT%deskpet-app && npm run dev"

echo.
echo ========================================
echo   MaiBot 请手动启动
echo ========================================
echo.
pause
