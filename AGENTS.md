# AGENTS.md — React前端

## 项目
React 前端项目
改代码前读 LESSONS.md 与 docs/code-standards.md。

## 命令（按仓库实际改，必须可复制）
- 安装依赖：`npm install`（Node 26，见 .nvmrc；package-lock.json 已提交锁定）
- 开发：`npm run dev`（Vite 默认 5173；SPA 深链 /app/login、/ops/overview 由 history fallback 支持）
- 质量门禁：`npm run lint && npm run typecheck && npm run test && npm run build`
- 单测：`npm run test`（vitest run，Node 环境；渲染冒烟单文件切 jsdom）；监听模式 `npm run test:watch`
- 格式化：`npm run format`（Prettier；`*.md` 已在 .prettierignore 排除）


## 工作方式
- 先用一句话复述目标；需求不清就问，不猜业务规则
- 做最小改动；不顺手重构无关模块
- 优先在**现有模块边界内**改，不跨层乱调
- 完成时在 commit/PR 写明：
  - 跑了哪些命令、在哪个 commit
  - 手测了什么（接口/场景）
  - **没试什么**（未起依赖服务、未走鉴权等）

## 约定
- 依赖精确锁定版本，禁用 `latest`/`*`/`^x.y`；升级仅通过显式改版本号 + `npm install`（shadcn 组件走 `shadcn add`）
- 金额/汇率运算一律经 `src/domain/money.ts`（decimal.js），禁止对 number 做金额运算；持久化金额为十进制字符串
- `src/components/ui/` 为 shadcn CLI 生成，勿手改（改走 CLI 或包装层）；业务公共组件放 `src/components/common/`
- 编码前先读 `docs/cross-border-fx-prototype-tech-design.md`（Spec is Truth：行为变更先回写文档，再改代码）


## 禁区
- Never：提交 真实密码、AK/SK、私钥；提交本地 无意义的 lock 噪声
- Do：密钥用环境变量或配置中心占位符，文档只写变量名
- Never：在未说明的情况下改数据库生产库、执行不可逆 migration
- Do：schema 变更走 Flyway/Liquibase（或项目既有方式），先加列再扩代码，注意回滚


## 测试最低要求
- 每次提交前：`npm run lint && npm run typecheck && npm run test && npm run build` 全绿（技术设计文档 §12.4）
- 领域纯函数改动：必须附单测，含边界与金样断言（参照 `src/domain/*.test.ts`）
- 路由/守卫/首页改动：`src/app/routes.test.tsx`（jsdom 渲染冒烟）必须通过
- seed 金样数值唯一来源：技术设计文档 §5.4；数值改动必须同 PR 回写该文档


## 路由
- 近期失败与返工规则 → LESSONS.md
- 已晋升硬规则 → docs/code-standards.md
- 架构取舍 → docs/decisions.md
- 某服务特殊约定 → 该模块下 AGENTS.md 或 docs/subsystems/<name>.md
