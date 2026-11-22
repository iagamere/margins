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
LINK_FILTERS = r"""
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" />
                <data android:host="drive.google.com" />
                <data android:host="drive.usercontent.google.com" />
                <data android:pathPrefix="/file/d/" />
                <data android:pathPrefix="/open" />
                <data android:pathPrefix="/uc" />
                <data android:pathPrefix="/download" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/epub+zip" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:host="*" />
                <data android:mimeType="*/*" />
                <data android:pathPattern=".*\\.epub" />
                <data android:pathPattern=".*\\.pdf" />
                <data android:pathPattern=".*\\.EPUB" />
                <data android:pathPattern=".*\\.PDF" />
            </intent-filter>
"""

# margins://u/<stamp> opens a profile
PROFILE_FILTER = r"""
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="margins" android:host="u" />
            </intent-filter>
"""

def manifest(s):
    if "windowSoftInputMode" not in s:
        s = s.replace("<activity", '<activity\n            android:windowSoftInputMode="adjustResize"', 1)
    # Margins offers itself for Google Drive book links ("Open with") and for shared links (Telegram: Share).
    if "drive.usercontent.google.com" not in s:
        s = s.replace("</activity>", LINK_FILTERS + "        </activity>", 1)
    if 'android:scheme="margins"' not in s:
        s = s.replace("</activity>", PROFILE_FILTER + "        </activity>", 1)
    return s

patch("app/src/main/AndroidManifest.xml", manifest)

# Human friendly versionName.
BUILD = int(os.environ.get("BUILD_NUMBER", "1") or 1)

def gradle(s):
    # versionCode must grow with every build so Android accepts the APK as an update.
    s = re.sub(r'versionCode\s*=?\s*\d+', f'versionCode {BUILD}', s)
    return re.sub(r'versionName\s*=?\s*"[^"]*"', f'versionName "1.0.{BUILD}"', s)

patch("app/build.gradle", gradle)


# Google sign-in with the Drive scope: the plugin needs MainActivity to forward onActivityResult to it.
MAIN_ACTIVITY = r"""package app.margins.reader;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    /**
     * Intents that carry a book: a link shared to Margins (Telegram: Share) becomes a normal link-open, and a file opened with
     * Margins ("Open with" on a PDF / EPUB, or Share of a file) is copied into the app's cache under its real name, so the web
     * side can read it without any permission problem. Either way the App plugin then reports one URL to the web side.
     */
    private void bookIntent(Intent intent) {
        try {
            if (intent == null) return;
            String action = intent.getAction();
            if (Intent.ACTION_SEND.equals(action)) {
                Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) {
                    intent.setAction(Intent.ACTION_VIEW);
                    intent.setData(stream);
                } else {
                    String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                    if (text == null) return;
                    int start = text.indexOf("https://");
                    if (start < 0) start = text.indexOf("http://");
                    if (start < 0) return;
                    int end = start;
                    while (end < text.length() && !Character.isWhitespace(text.charAt(end))) end++;
                    intent.setAction(Intent.ACTION_VIEW);
                    intent.setData(Uri.parse(text.substring(start, end)));
                    return;
                }
            }
            if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;
            Uri data = intent.getData();
            if (data == null || !"content".equals(data.getScheme())) return;
            String name = null;
            try (Cursor c = getContentResolver().query(data, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            }
            if (name == null || name.isEmpty()) name = "book";
            name = name.replace('/', '_');
            File dir = new File(getCacheDir(), "incoming");
            dir.mkdirs();
            long weekAgo = System.currentTimeMillis() - 24L * 3600 * 1000;
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) if (f.lastModified() < weekAgo) f.delete();
            File out = new File(dir, System.currentTimeMillis() + "_" + name);
            try (InputStream in = getContentResolver().openInputStream(data); OutputStream os = new FileOutputStream(out)) {
                if (in == null) return;
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            intent.setData(Uri.fromFile(out));
        } catch (Exception e) {
            Log.i("Margins", "could not read the opened book: " + e);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        bookIntent(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        bookIntent(intent);
        super.onNewIntent(intent);
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle handle = getBridge().getPlugin("SocialLogin");
            if (handle == null) {
                Log.i("Margins", "SocialLogin plugin handle is null");
                return;
            }
            Plugin plugin = handle.getInstance();
            if (!(plugin instanceof SocialLoginPlugin)) {
                Log.i("Margins", "SocialLogin plugin instance has the wrong type");
                return;
            }
            ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
"""

def main_activity():
    java = root / "app/src/main/java/app/margins/reader"
    if not (root / "app").exists():
        print("skip (missing): MainActivity")
        return
    java.mkdir(parents=True, exist_ok=True)
    (java / "MainActivity.java").write_text(MAIN_ACTIVITY, encoding="utf-8")
    print("patched: MainActivity.java")

main_activity()


# Sign every build with the key stored in the repository (keystore/debug.keystore).
# Without this, Gradle makes a brand-new random debug key on each CI run, so the signing fingerprint changes
# every build and Google sign-in (which checks that fingerprint) stops working after each update.
def signing(s):
    if "margins-fixed-key" in s:
        return s
    ks = (root.parent / "keystore" / "debug.keystore").as_posix()
    block = (
        "\n    // margins-fixed-key\n"
        "    signingConfigs {\n"
        "        debug {\n"
        f"            storeFile file('{ks}')\n"
        "            storePassword 'android'\n"
        "            keyAlias 'androiddebugkey'\n"
        "            keyPassword 'android'\n"
        "        }\n"
        "    }\n"
    )
    return re.sub(r"(\nandroid\s*\{)", lambda m: m.group(1) + block, s, count=1)

patch("app/build.gradle", signing)
