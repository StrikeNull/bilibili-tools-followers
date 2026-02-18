# 打包说明

本项目支持使用 PyInstaller 打包为独立的可执行文件（Windows .exe 或 macOS Unix Executable）。

## 前置准备

1. 确保已安装 Python 环境。
2. 安装项目依赖：
   ```bash
   pip install -r requirements.txt
   ```
3. 安装 PyInstaller：
   ```bash
   pip install pyinstaller
   ```

## 执行打包

在项目根目录（`bilibilitools` 文件夹）下运行以下命令：

```bash
pyinstaller build.spec
```

打包完成后，可执行文件将生成在 `dist/` 目录下。

- Windows: `dist/BilibiliTools.exe`
- macOS/Linux: `dist/BilibiliTools`

## 注意事项

- **静态文件**: 前端文件 (`frontend/`) 会被自动打包进 exe 中。修改前端后需重新打包。
- **控制台窗口**: 默认开启控制台窗口以便查看日志。如需隐藏，请在 `build.spec` 中将 `console=True` 改为 `console=False`。
- **杀毒软件**: 打包出的 exe 可能会被杀毒软件误报，这是 PyInstaller 的常见问题。
- **运行**: 双击运行即可。程序会自动启动 HTTP 服务（默认端口 8000）。

## 常见问题

- 如果运行时出现 `ModuleNotFoundError`，通常是因为 uvicorn 的隐式导入未被检测到。请检查 `build.spec` 中的 `hiddenimports`。
