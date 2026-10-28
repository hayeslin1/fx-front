/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 基地址（后端对接预留，见设计文档 §8.3） */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
