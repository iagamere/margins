/// <reference types="vite/client" />

declare module 'pdfjs-dist/legacy/build/pdf.mjs';
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker' {
  const WorkerCtor: { new (): Worker };
  export default WorkerCtor;
}

interface ImportMetaEnv {
  readonly VITE_BUILD_NUMBER?: string;
  readonly VITE_GH_REPO?: string;
}
