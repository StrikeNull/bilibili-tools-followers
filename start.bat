@echo off
chcp 65001 >nul
rem ============================================================
rem Bilibili Tools 启动脚本 (Windows)
rem 用法: 双击运行 start.bat 或在命令行执行
rem ============================================================

set PORT=8000
set URL=http://localhost:%PORT%

echo ========================================
echo   Bilibili Tools 启动中...
echo ========================================

rem 获取脚本所在目录（项目根目录）
set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%backend

rem 检查 Python 是否存在
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 python，请先安装 Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

rem 检查 uvicorn 是否安装
python -c "import uvicorn" >nul 2>&1
if errorlevel 1 (
    echo [提示] 正在安装依赖...
    pip install -r "%SCRIPT_DIR%requirements.txt"
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请手动执行: pip install -r requirements.txt
        pause
        exit /b 1
    )
)

rem 检查端口是否被占用并关闭旧进程
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [提示] 端口 %PORT% 已被占用，正在关闭旧进程 (PID: %%a)...
    taskkill /PID %%a /F >nul 2>&1
)

echo [信息] 启动后端服务: %URL%
echo [信息] 关闭此窗口即可停止服务
echo ----------------------------------------

rem 延迟 2 秒后自动打开浏览器
start "" cmd /c "timeout /t 2 >nul && start %URL%"

rem 进入 backend 目录并启动服务
cd /d "%BACKEND_DIR%"
python -m uvicorn main:app --host 0.0.0.0 --port %PORT%

pause
