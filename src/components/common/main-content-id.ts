/**
 * 主内容地标 id（设计文档 §11.2：跳转链接与 main 地标共用同一常量，避免两端硬编码漂移）。
 * WHY 独立文件：react-refresh/only-export-components 要求组件文件只导出组件，
 * 常量与 SkipLink 分开放置（同 shadcn 目录之外的既有约定）。
 */
export const MAIN_CONTENT_ID = 'main-content';
