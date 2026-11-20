"""Small post-`cap add android` tweaks. Every step is optional and never fails the build."""
import os, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent / "android"

def patch(path, fn):
    p = root / path
    if not p.exists():
        print(f"skip (missing): {path}")
        return
    old = p.read_text(encoding="utf-8")
    new = fn(old)
    if new != old:
        p.write_text(new, encoding="utf-8")
        print(f"patched: {path}")

# Resize the window when the on-screen keyboard opens (search / note fields).
def manifest(s):
    if "windowSoftInputMode" not in s:
        s = s.replace("<activity", '<activity\n            android:windowSoftInputMode="adjustResize"', 1)
    return s

patch("app/src/main/AndroidManifest.xml", manifest)

# Human friendly versionName.
BUILD = int(os.environ.get("BUILD_NUMBER", "1") or 1)

def gradle(s):
    # versionCode must grow with every build so Android accepts the APK as an update.
    s = re.sub(r'versionCode\s*=?\s*\d+', f'versionCode {BUILD}', s)
    return re.sub(r'versionName\s*=?\s*"[^"]*"', f'versionName "1.0.{BUILD}"', s)

patch("app/build.gradle", gradle)
