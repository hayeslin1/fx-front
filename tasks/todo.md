# 跨境汇兑前端原型 PRD 任务

- [x] 汇总并确认产品范围、交易规则与视觉方向
- [x] 核对现有仓库规范与文档目录
- [x] 编写跨境汇兑前端原型 PRD
- [x] 核对 PRD 的收益规则、信息架构与验收标准
- [x] 交付 PRD

## Review

- 已完成：PRD 覆盖客户、运营、报价、敞口、平仓、收益、客服、持久化、视觉和验收规则。
- 已修正：收益建仓基准使用成交时原始中间价，避免将客户点差重复计入平仓实现收益。

## 技术设计文档（2026-10-28）

- [x] 澄清 7 项决策点（技术栈/数据层/精度/测试/模拟采集/首页估值/损益精度）
- [x] 核实并锁定全部依赖精确版本（npm registry，2026-10-28）
- [x] 编写并交付 docs/cross-border-fx-prototype-tech-design.md
- [x] 增补 API 契约层章节（§8，后端 Spring Boot/JSON 对接预留），同步修订交付物/测试矩阵/里程碑/风险

## Review

- 已完成：技术设计文档覆盖工程结构与版本锁定、事实/派生分离与账本重放、领域计算引擎（报价/FIFO/损益/结算）、持久化与 seed 金样断言、页面级实现映射、测试与验收矩阵、里程碑拆分。
- 需求变更（2026-10-28）：PRD 功能后续接后端，已按「一模块一文件 + index 聚合」补充 `src/api/*` 契约层（13 个文件、约 45 个 POST 端点，与领域服务 1:1 映射），本期仅预留不接入 UI；端点/包裹/错误码标注为与后端逐项对齐的提议。
- 衍生决策：TypeScript 锁 6.0.3（typescript-eslint peer 上限 <6.1.0）；React Router 取 v8（v8 起 react-router-dom 包已移除）；recharts 3 需 react-is overrides。
- 待办：评审通过后把 ADR-001..004 同步到 docs/decisions.md（本次未执行，等确认）。

## M1 工程骨架（2026-10-28 起，按技术设计文档 §13 M1）

- [x] 脚手架配置（package.json 锁精确版本 / tsconfig / vite / eslint / prettier / gitignore）
- [x] 依赖安装（Node 26，提交 package-lock.json）
- [x] Tailwind v4 + shadcn 初始化 + 双主题令牌（theme-client / theme-ops）
- [x] domain/lib 基础（types/constants/money/ids/clock/format/storage/hash）
- [x] seed 预置数据 + 重置入口（金样断言单测）
- [x] store + 持久化（安全解析/版本迁移/损坏恢复/内存降级）+ apply 调用模式
- [x] 路由/守卫/双端壳（全部 30 条路由可达，占位页标注归属里程碑）
- [x] 公共组件（Money/DataTable/StatusBadge/EmptyState/ConfirmDialog/PlaceholderPage）
- [x] 两端登录可用 + 客户端首页余额展示（端到端接线验证）
- [x] 质量门禁：lint + typecheck + test + build 全绿，dev server 冒烟

## Review（M1，2026-10-28）

- 已完成：脚手架与精确锁版（Node 26.0.0，package-lock.json 已生成）；Tailwind v4 + shadcn（radix-nova 风格 8 个组件，生成物 `cn` 导入统一回 `@/lib/utils`、移除 CLI 误加 `cn` 包、Radix 统一包锁 `radix-ui@1.8.1`）；双主题令牌（theme-client 暖色 14px / theme-ops 灰底 8px）；domain/lib 基础；seed 金样（9 订单 / 18 钱包 / 38 流水 / 3 工单 / 2 平仓批次）；store + 手写落盘订阅 + 损坏/高版本恢复 + 内存降级；30 条路由 + 404 + 双端布局/守卫；公共组件 8 个；双端登录 + 首页六币种余额与参考估值。
- 证据：
  - `npm run lint`：0 error 0 warning（shadcn 生成目录已豁免 react-refresh 规则）
  - `npm run typecheck`：clean（修复 TS6 废弃 `baseUrl` → TS5101）
  - `npm run test`：7 文件 55 用例全绿（money / ids / seed 金样 / persistence / auth.service / store 装配 / jsdom 渲染冒烟）
  - `npm run build`：vite 8.3.5 成功（2293 modules，gzip JS 182KB；chunk>500KB 为提示非错误）
  - dev server 冒烟：`/`、`/app/login`、`/ops/overview` 全部 200，根节点 `id="root"` 存在
  - jsdom 渲染断言：登录后首页含「你好，林小满 / 20,500.00 USD / 8,203.15 EUR」；未登录 `/app/home` 与客户会话访问 `/ops/overview` 均被守卫重定向；未知路径 404 不白屏；重置后回登录态
- Reverse Sync（文档已回写）：§5.3/§7.1 持久化改为手写变更订阅、§7.2 apply 异步签名、§3.1 zustand 描述与 radix-ui 行、§3.2 增 jsdom、§3.4 baseUrl 注记、§4.1 目录树（components/common、lib 增 hash/uuid/utils、pages/NotFoundPage）、§5.4 C-002 USD 余额笔误修正（17,176.87→20,776.87，三笔买 USD 的 USD 腿均为入账）、§12.1 jsdom 实现注记、演示账号邮箱统一 `@demo.fx`
- 过程记录：npm 安装两次遭遇 ECONNRESET（重试参数后成功）；shadcn init 交互预设改为 `-t vite -b radix -p nova` 非交互跑通
- 没试什么：未做浏览器真机视觉走查与截图（jsdom 无样式渲染）；未验手工篡改 localStorage 后刷新恢复（§12.3 J5 手工项）；未提交 git（用户未要求）；ADR-001..004 尚未同步 docs/decisions.md（待确认）
