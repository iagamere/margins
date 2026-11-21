/// <reference types="vite/client" />

declare module 'pdfjs-dist/legacy/build/pdf.mjs';
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker' {
  const WorkerCtor: { new (): Worker };
  export default WorkerCtor;
}

interface ImportMetaEnv {
  readonly VITE_BUILD_NUMBER?: string;
  readonly VITE_GH_REPO?: string;
  /** Google Cloud API key (Drive API enabled): lets the app read a friend's shared library with progress */
  readonly VITE_GOOGLE_API_KEY?: string;
}
