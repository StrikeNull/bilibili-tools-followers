# -*- mode: python ; coding: utf-8 -*-
import sys
import os

block_cipher = None

# 项目根目录（build.spec 所在目录）
ROOT = os.path.dirname(os.path.abspath(SPEC))
BACKEND = os.path.join(ROOT, 'backend')

a = Analysis(
    [os.path.join(BACKEND, 'main.py')],
    pathex=[BACKEND],          # 让 PyInstaller 能找到 bilibili_api.py
    binaries=[],
    datas=[
        ('frontend', 'frontend'),   # 打包整个前端目录
    ],
    hiddenimports=[
        # uvicorn 内部动态导入的模块
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # fastapi / starlette
        'fastapi',
        'starlette',
        'starlette.staticfiles',
        'starlette.responses',
        'starlette.middleware',
        'starlette.middleware.cors',
        # pydantic
        'pydantic',
        'pydantic.deprecated.class_validators',
        # httpx
        'httpx',
        'httpcore',
        # qrcode
        'qrcode',
        'qrcode.image.base',
        'qrcode.image.pure',
        'qrcode.image.styledpil',
        # 其他
        'anyio',
        'anyio._backends._asyncio',
        'h11',
        'email.mime.text',
        'email.mime.multipart',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'numpy',
        'PIL',
        'PyQt5',
        'PyQt6',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='BilibiliTools',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,           # 保留控制台窗口，方便查看日志
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,              # 如需图标，改为 'icon.icns'（Mac）或 'icon.ico'（Win）
)
