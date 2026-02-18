@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

rem ============================================================
rem Bilibili Tools 打包脚本 (Windows)
rem 输出: dist\BilibiliTools.exe
rem 用法: 双击运行 build.bat 或在命令行执行
rem ============================================================

set APP_NAME=BilibiliTools
set SCRIPT_DIR=%~dp0

echo ========================================
echo   Bilibili Tools 打包脚本 (Windows)
echo ========================================

rem ── 1. 检查 Python ──────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 python，请先安装 Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version') do echo [OK] %%v

rem ── 2. 安装依赖 ─────────────────────────────────────────────
echo.
echo [步骤 1/3] 安装依赖...
pip install -r "%SCRIPT_DIR%requirements.txt" -q
if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络或手动执行: pip install -r requirements.txt
    pause
    exit /b 1
)
echo [OK] 依赖安装完成

rem ── 3. 清理旧构建 ────────────────────────────────────────────
echo.
echo [步骤 2/3] 清理旧构建...
if exist "%SCRIPT_DIR%build" rmdir /s /q "%SCRIPT_DIR%build"
if exist "%SCRIPT_DIR%dist"  rmdir /s /q "%SCRIPT_DIR%dist"
echo [OK] 清理完成

rem ── 4. PyInstaller 打包 ──────────────────────────────────────
echo.
echo [步骤 3/3] PyInstaller 打包中（可能需要几分钟）...
cd /d "%SCRIPT_DIR%"
python -m PyInstaller build.spec --noconfirm
if errorlevel 1 (
    echo [错误] 打包失败！请查看上方错误信息。
    pause
    exit /b 1
)

echo.
echo ========================================
echo   打包完成！
echo ========================================
echo   可执行文件: %SCRIPT_DIR%dist\%APP_NAME%.exe
echo.
echo   运行方式:
echo     双击 dist\%APP_NAME%.exe
echo     （程序启动后会自动打开浏览器）
echo ========================================
pause
