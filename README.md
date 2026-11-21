# MARGINS — A quieter way to read

A local-first EPUB & PDF reader for Android (also runs in any modern browser as an installable PWA).
No account, no server: your books never leave the device.

**Stack:** React 18 · TypeScript · Vite · Capacitor 8 (Android) · epub.js · PDF.js · IndexedDB (`idb`) · Zustand · Lucide icons · bundled fonts (Inter, Literata, Source Serif 4, Noto Naskh Arabic, IBM Plex Sans Arabic — all SIL OFL).

## Get the APK (no tools needed on your PC)

1. Create an empty GitHub repository and upload / push the contents of this folder to the `main` branch.
2. Open the **Actions** tab → the **Build Android APK** workflow starts by itself (≈ 6–10 min the first time).
3. When it is green, open **Releases → "Margins (latest build)"** and download `Margins.apk` (also available as a workflow artifact).
4. On your phone: open the APK and allow "install from this source" when asked.

The APK is a *debug-signed* build — fine for personal use. Each push rebuilds it.

## Run in the browser (optional)

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

## Build the APK locally (optional)

Needs Node 22, JDK 21 and the Android SDK.

```bash
npm install && npm run build
npx cap add android
npx capacitor-assets generate --android --assetPath assets
npx cap sync android
python3 scripts/patch-android.py
cd android && ./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

## Features

- Library: grid/list, covers (placeholders when missing), search, sort, filters (All / Reading / Completed / Recently added), progress, details screen, duplicate detection, multi-file import (drag & drop on desktop).
- EPUB: original nested table of contents, paged or continuous scrolling, typography (font, size, line height, paragraph spacing, margins, width, alignment, theme), bookmarks, highlights in 4 colours, notes, in-book search, internal links, RTL/Arabic books, reading position restore.
- PDF: original rendering, lazy page virtualisation, scroll or one-page-at-a-time mode, pinch / button zoom, fit width / fit page, page jump, thumbnails, original outline, text search (embedded text only — **no OCR**), link annotations, bookmarks with notes.
- PDF **text reflow** (optional, toggle in the toolbar): extracts the text, rebuilds paragraphs/headings, removes page numbers, repairs Arabic presentation forms, re-lays it out with your font, size, spacing and theme, and lets you reveal the original page (images, tables, scans) inline at any point. It is a heuristic, not OCR.
- Interface in Arabic (full RTL), French and English; switch live in Settings.
- Light, Dark and Sepia themes built from design tokens; reading theme can differ from the app theme.
- Android back button closes panels first; desktop keyboard shortcuts: ←/→ page, ↑/↓/Space scroll or page, `T` contents, `N` notes, `A` appearance, `/` search, `B` bookmark, `F` full screen, `+`/`-` zoom (PDF), `H` hide toolbars.

## Known limitations (by design / honest notes)

- Books are stored in the app's private storage on the device. They are **not** synced or backed up; uninstalling the app or clearing its data deletes them.
- Highlights and inline notes are EPUB-only. PDFs support bookmarks (with optional notes).
- PDF search works only on PDFs with an embedded text layer. Scanned PDFs are not searchable (no OCR, by spec).
- Text reflow is approximate: complex layouts (multi-column, tables), images and footnotes are not reproduced, and some PDFs that store Arabic text in visual order may read incorrectly — switch back to the original layout for those.
- DRM-protected EPUBs are not supported.
- Reading percentage in EPUB is an estimate until the background location index finishes (a few seconds for large books; it is then cached).
- Highlights cannot be created on top of text that is already highlighted (epub.js overlay behaviour) — tap the existing highlight to edit it.

## Shared library ("stamp")

Account → *Share my library* creates a **stamp** (`MRG-…`). A friend pastes it under *Friends' libraries* and can browse your books and download them together.

- Drive's hidden app folder cannot be shared, so shared books are copied into a normal Drive folder created by the app (scope `drive.file`, non-sensitive) and made "anyone with the link can read". The stamp is the id of a `manifest.json` listing the books. *Stop sharing* deletes everything.
- Accounts signed in before this feature must sign in again (the screen asks).
- In the Google Cloud console, add the `drive.file` scope to the OAuth consent screen.
- Optional but recommended: create an **API key** (Drive API enabled, restricted to the Drive API) and add it as the GitHub secret `GOOGLE_API_KEY` (or `VITE_GOOGLE_API_KEY` locally). With it, downloads from a friend show real progress. Without it the Android app falls back to the native HTTP client (no progress bar, whole file buffered in memory).

The stamp is stable: the shared files are tagged in Drive, so after a reinstall the same stamp is found again. It only changes through *Change stamp*. Friends' libraries (list, shelves, covers) are cached on the device and open offline.
