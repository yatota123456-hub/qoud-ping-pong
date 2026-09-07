/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SERVER_URL: string
    // أضف أي متغيرات أخرى هنا لاحقاً
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }