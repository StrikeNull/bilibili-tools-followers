#!/bin/bash
# ============================================================
# Bilibili Tools 启动脚本 (macOS / Linux)
# 用法: bash start.sh
# ============================================================

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
PORT=8000
URL="http://localhost:$PORT"

echo "========================================"
echo "  Bilibili Tools 启动中..."
echo "========================================"

# 检查 Python3 是否存在
if ! command -v python3 &>/dev/null; then
    echo "[错误] 未找到 python3，请先安装 Python 3.8+"
    exit 1
fi

# 检查 uvicorn 是否安装
if ! python3 -c "import uvicorn" &>/dev/null; then
    echo "[提示] 正在安装依赖..."
    pip3 install -r "$SCRIPT_DIR/requirements.txt"
fi

# 检查端口是否已被占用
if lsof -i :$PORT &>/dev/null; then
    echo "[提示] 端口 $PORT 已被占用，尝试关闭旧进程..."
    kill $(lsof -ti :$PORT) 2>/dev/null
    sleep 1
fi

echo "[信息] 启动后端服务: $URL"
echo "[信息] 按 Ctrl+C 停止服务"
echo "----------------------------------------"

# 延迟 1.5 秒后自动打开浏览器
(sleep 1.5 && open "$URL") &

# 进入 backend 目录并启动服务
cd "$BACKEND_DIR"
python3 -m uvicorn main:app --host 0.0.0.0 --port $PORT
