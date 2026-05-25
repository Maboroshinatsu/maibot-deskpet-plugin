@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo =============================================
echo   MaiBot Deskpet v0.3 — 一键启动
echo =============================================
echo.

set "ROOT=%~dp0"

:: ── 检查 Node.js ──
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    echo         https://nodejs.org/
    pause
    exit /b 1
)

:: ── 检查 Python ──
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3
    pause
    exit /b 1
)

:: ── 检查前端依赖 ──
if not exist "%ROOT%deskpet-app\node_modules" (
    echo [安装] 前端依赖...
    cd /d "%ROOT%deskpet-app"
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [错误] npm install 失败
        pause
        exit /b 1
    )
)

:: ═══════════════════════════════════════════════
::  配置区 —— 按你的实际路径修改
:: ═══════════════════════════════════════════════

:: GPT-SoVITS 整合包路径（可选：不设则跳过 TTS 语音合成）
:: 下载地址: https://github.com/RVC-Boss/GPT-SoVITS
set "GSV_DIR="

:: PowerShell 脚本自动探测 GPT-SoVITS（常见路径）
if "%GSV_DIR%"=="" (
    for %%d in (
        "D:\GPT-SoVITS-v2pro-20250604"
        "C:\GPT-SoVITS-v2pro-20250604"
        "%USERPROFILE%\GPT-SoVITS-v2pro-20250604"
    ) do (
        if exist %%d (
            set "GSV_DIR=%%~d"
        )
    )
)

:: ═══════════════════════════════════════════════

echo.
echo [1/4] STT 语音识别桥 (端口 18530)...
start "STT Bridge" cmd /k "cd /d "%ROOT%" && python -u stt-bridge.py"

echo [2/4] GPT-SoVITS TTS (端口 9880)...
if not "%GSV_DIR%"=="" (
    if exist "%GSV_DIR%\runtime\python.exe" (
        start "GPT-SoVITS API" cmd /k "cd /d "%GSV_DIR%" && runtime\python.exe api_v2.py -p 9880"
        timeout /t 2 >nul
    ) else (
        echo   [跳过] GPT-SoVITS 目录存在但未找到 runtime\python.exe，请检查 GSV_DIR
    )
) else (
    echo   [跳过] 未配置 GPT-SoVITS 路径，TTS 语音合成不可用
    echo         编辑 start.bat 中的 GSV_DIR 变量指向 GPT-SoVITS 整合包目录
)

echo [3/4] TTS 桥 (端口 9881)...
if not "%GSV_DIR%"=="" (
    start "TTS Bridge" cmd /k "cd /d "%ROOT%" && python -u gpt-sovits-bridge.py"
) else (
    start "TTS Bridge (无 GPT-SoVITS)" cmd /k "echo TTS 桥未启动：GPT-SoVITS 未配置 && pause"
)

echo [4/4] 桌宠前端...
start "Deskpet" cmd /k "cd /d "%ROOT%deskpet-app" && npm run dev"

echo.
echo =============================================
echo   全部启动完成
echo =============================================
echo.
echo   可用端口:
echo     STT 桥      http://127.0.0.1:18530/stt
if not "%GSV_DIR%"=="" echo     TTS 桥      http://127.0.0.1:9881/tts
if not "%GSV_DIR%"=="" echo     GPT-SoVITS   http://127.0.0.1:9880
echo     Vite 开发服务器  http://localhost:5173
echo.
echo   请手动启动 MaiBot
echo.
pause
