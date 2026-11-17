"""Small post-`cap add android` tweaks. Every step is optional and never fails the build."""
import pathlib, re

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
def gradle(s):
    return re.sub(r'versionName\s+"[^"]*"', 'versionName "1.0.0"', s)

patch("app/build.gradle", gradle)
