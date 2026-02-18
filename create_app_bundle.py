import os
import shutil
import stat

def create_app_bundle():
    dist_dir = os.path.abspath("dist")
    executable = os.path.join(dist_dir, "BilibiliTools")
    app_name = "BilibiliTools.app"
    app_path = os.path.join(dist_dir, app_name)
    
    if not os.path.exists(executable):
        print(f"Error: Executable not found at {executable}")
        return

    # Clean up old app
    if os.path.exists(app_path):
        shutil.rmtree(app_path)
        print(f"Removed old {app_path}")

    # Create directories
    contents = os.path.join(app_path, "Contents")
    macos = os.path.join(contents, "MacOS")
    resources = os.path.join(contents, "Resources")
    os.makedirs(macos, exist_ok=True)
    os.makedirs(resources, exist_ok=True)

    # Copy executable
    dest_executable = os.path.join(macos, "BilibiliTools")
    shutil.copy2(executable, dest_executable)
    # Ensure executable permissions
    st = os.stat(dest_executable)
    os.chmod(dest_executable, st.st_mode | stat.S_IEXEC)

    # Create Info.plist
    info_plist = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Bilibili Tools</string>
    <key>CFBundleExecutable</key>
    <string>BilibiliTools</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon.icns</string>
    <key>CFBundleIdentifier</key>
    <string>com.bilibili.tools</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>BilibiliTools</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>"""
    
    with open(os.path.join(contents, "Info.plist"), "w") as f:
        f.write(info_plist)

    print(f"Successfully created App Bundle at: {app_path}")

if __name__ == "__main__":
    create_app_bundle()
