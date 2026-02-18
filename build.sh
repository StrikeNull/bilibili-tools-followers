#!/bin/bash
# ============================================================
# Bilibili Tools 打包脚本 (macOS / Linux)
# 输出: dist/BilibiliTools (单文件可执行) + dist/BilibiliTools.app + dist/BilibiliTools.dmg
# 用法: bash build.sh
# ============================================================
set -e  # 任何命令失败立即退出

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="BilibiliTools"
DIST_DIR="$SCRIPT_DIR/dist"
APP_BUNDLE="$DIST_DIR/${APP_NAME}.app"

echo "========================================"
echo "  Bilibili Tools 打包脚本 (macOS)"
echo "========================================"

# ── 1. 检查 Python ──────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "[错误] 未找到 python3，请先安装 Python 3.8+"
    exit 1
fi
echo "[✓] Python: $(python3 --version)"

# ── 2. 安装依赖 ─────────────────────────────────────────────
echo ""
echo "[步骤 1/4] 安装依赖..."
pip3 install -r "$SCRIPT_DIR/requirements.txt" -q
echo "[✓] 依赖安装完成"

# ── 3. 清理旧构建 ────────────────────────────────────────────
echo ""
echo "[步骤 2/4] 清理旧构建..."
rm -rf "$SCRIPT_DIR/build" "$DIST_DIR"
echo "[✓] 清理完成"

# ── 4. PyInstaller 打包 ──────────────────────────────────────
echo ""
echo "[步骤 3/4] PyInstaller 打包中（可能需要几分钟）..."
cd "$SCRIPT_DIR"
python3 -m PyInstaller build.spec --noconfirm
echo "[✓] 可执行文件: $DIST_DIR/$APP_NAME"

# ── 5. 创建 .app Bundle ──────────────────────────────────────
echo ""
echo "[步骤 4/4] 创建 macOS .app Bundle..."

CONTENTS_DIR="${APP_BUNDLE}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

rm -rf "$APP_BUNDLE"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

# 复制可执行文件
cp "$DIST_DIR/$APP_NAME" "$MACOS_DIR/$APP_NAME"
chmod +x "$MACOS_DIR/$APP_NAME"

# 创建启动包装脚本（让 .app 双击后能正确设置工作目录）
cat > "$MACOS_DIR/launcher" <<'LAUNCHER'
#!/bin/bash
# 获取 .app 内部的 MacOS 目录
DIR="$(cd "$(dirname "$0")" && pwd)"
# 切换到用户主目录（或其他合适的工作目录）
cd "$HOME"
# 启动服务并自动打开浏览器
"$DIR/BilibiliTools" &
sleep 2
open "http://localhost:8000"
wait
LAUNCHER
chmod +x "$MACOS_DIR/launcher"

# 创建 Info.plist
cat > "${CONTENTS_DIR}/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Bilibili Tools</string>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.bilibili.tools</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
EOF

echo "[✓] .app Bundle: $APP_BUNDLE"

# ── 6. 创建 .dmg（可选）────────────────────────────────────
if command -v hdiutil &>/dev/null; then
    DMG_PATH="$DIST_DIR/${APP_NAME}.dmg"
    echo ""
    echo "[可选] 正在创建 .dmg 安装包..."
    rm -f "$DMG_PATH"
    hdiutil create \
        -volname "$APP_NAME" \
        -srcfolder "$APP_BUNDLE" \
        -ov -format UDZO \
        "$DMG_PATH"
    echo "[✓] DMG 安装包: $DMG_PATH"
fi

echo ""
echo "========================================"
echo "  打包完成！"
echo "========================================"
echo "  单文件:   $DIST_DIR/$APP_NAME"
echo "  .app:     $APP_BUNDLE"
if [ -f "$DIST_DIR/${APP_NAME}.dmg" ]; then
    echo "  .dmg:     $DIST_DIR/${APP_NAME}.dmg"
fi
echo ""
echo "  运行方式:"
echo "    双击 .app  或  $DIST_DIR/$APP_NAME"
echo "========================================"
