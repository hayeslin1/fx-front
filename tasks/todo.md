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

## M2 领域引擎与 API 契约（2026-10-28 起，按技术设计文档 §13 M2）

Wave 1（三路并行，子 agent 开发）：
- [x] API 契约层（src/api/ 16 文件、49 POST 端点、包裹/错误码/超时/幂等）→ commit 170b63e
- [x] 报价引擎 pricing.ts + 35 用例 → commit 2fad19e
- [x] FIFO 建仓/匹配 + 损益 pnl.ts + 37 用例 → commit 67ddecd

Wave 2（依赖 Wave 1）：
- [x] ledger.ts 账本重放（9 张收益单/5 币对敞口 §5.4 金样，12 用例）→ commit 6f42ac8
- [x] 领域服务组 E1：wallet + fx-config + support + customer（42 用例）+ seed TK 计数器根因修复
- [x] 领域服务组 E2：exchange + close-batch（29 用例；TTL/余额/quoteId 防重/可平金额/重锁价）

集成（Wave 2 完成后）：
- [x] 跨层集成测试：submit → 1 lot + 1 收益单；平仓 FAILED 零影响；SUCCESS FIFO 归属
- [x] API 契约补齐 ops-customer 三写端点（49 → 52）
- [x] 全量门禁：lint 0 问题 / typecheck clean / 279 用例全绿 / build 成功
- [x] Reverse Sync：§5.4 采集公式与新渠道、§6.2 priceCollectedAt、§6.3 quoteId、
      §6.5 重试方向校验与敞口入参、§6.7 Ledger 结构、§8.2 错误码口径、§8.4 端点、
      附录 B 服务签名、附录 D 收益单号、§5.4 EUR 收益金样 ×10 修正

## Review（M2，2026-10-28）

- 已完成：报价引擎（路由降级/10min 新鲜度/限额/50bps 双向）；FIFO 台账与损益（自然对冲 50/50、
  尾差归更早单、渠道平仓 100% 归属、三态结算）；账本重放（事件流、收益单、五币对敞口）；
  领域服务 4+2 组（认证/钱包/汇率/客服/客户 + 成交/平仓）；API 契约 52 端点。
- 证据：`npm run lint` 0 问题；`npm run typecheck` clean；`npx vitest run` 20 文件 279 用例全绿；
  `npm run build` 成功。金样：EX-1 +0.40 EUR（修正后）、EX-4/5 −197.687 JPY、EX-8/9 +0.20 HKD；
  敞口 +1700/+6000/+3023.13/−1200/−600；CB-2 FAILED 对账本零影响。
- 提交：170b63e（API）、2fad19e（报价）、67ddecd（FIFO/损益）、6f42ac8（账本）、
  E1、E2、集成三笔（见 git log）。
- 过程：子 agent 并行开发，文件所有权互斥；主控独立复跑每个 agent 的测试与 scoped tsc。
- 发现的真实缺陷并修根因：seed 工单业务序生成导致 TK 计数器停在更早日期 → 新工单重号；
  seed 结束回填计数器，并保留服务层防御兼容旧持久化数据。
- 没试什么：未接 store/selectors/UI（M3/M4）；未启真实后端；未做浏览器真机视觉走查；
  手工篡改 localStorage 恢复（J5）仍留验收；ADR-001..004 尚未同步 docs/decisions.md（待确认）。

## M3 客户端全流程（2026-10-28 起，按技术设计文档 §13 M3）

- [x] 共享底座：ledger memoized 选择器 / 客户列表读取 / D6 USD 估值 / 报价内存态 /
      Countdown / Rate / DemoNotice → commit 285d686
- [x] P1 注册 + 钱包 + 充值（features/wallet hooks，11 用例）→ commit 44b4498
- [x] P2 兑换 + 订单列表 + 订单详情（features/exchange/orders hooks，5 个 jsdom 流程用例）→ commit af7ca0e
- [x] P3 客服列表 + 新建 + 详情（features/support hooks，4 个 jsdom 流程用例）→ commit 7cfd19a
- [x] 跨页 J1 冒烟（m3-client-flow.test.tsx，5 用例）：注册页/钱包金样/充值后余额/
      成交后订单快照/工单时间线
- [x] 全量门禁：lint 0 问题 / typecheck clean / 24 文件 304 用例全绿 / build 成功

## Review（M3，2026-10-28）

- 已完成：客户端 11 页全部脱离占位（登录/首页 M1 已有 + 注册/钱包/充值/兑换/订单/订单详情/
  客服列表/新建/详情）；store 读写全部收敛到 features/*/hooks（页面零 useAppStore 引用）；
  兑换 10 向推导、报价快照展示与 30s 倒计时、过期禁用、quoteId 防重；客户侧不展示平台损益。
- 证据：`npm run lint` 0 问题；`npm run typecheck` clean；`npx vitest run` 24 文件 304 用例
  全绿；`npm run build` 成功。J1 跨页冒烟断言：钱包 20,500.00/8,203.15 → 充值后 20,600.00；
  成交订单详情含客户成交价/原始中间价/华星清算；工单详情含消息时间线。
- 已知取舍：项目无 shadcn Select/Textarea，页面用原生控件套既有令牌（未改 ui 目录）。
- 没试什么：未做浏览器真机视觉与键盘走查（J1/J2 手工项留验收）；倒计时到点的 DOM 计时器
  交互未单测（逻辑为 Countdown onExpire + 提交前 now 双判定）；未启真实后端。

## M4 运营交易与钱包（2026-10-28 起，按技术设计文档 §13 M4）

- [x] 共享底座：shadcn Chart（recharts 3.10.1 锁版）+ 总览序列/报价健康/收益单/敞口明细/
      账单筛选选择器（9 用例，LAST_7D 金样 19,876.87）→ commit 0d2827a
- [x] 修复：D6 估值折算口径倒挂（× → ÷）根因修复（文档回写 + 选择器 + HomePage 单一实现）
      → commit bf38246
- [x] A 总览页（图表/数据表切换、KPI、敞口快照、报价健康，5 用例）→ commit d20e7b7
- [x] B 客户管理列表+详情（搜索、六币种、USD 估值，6 用例）→ commit f470e9b
- [x] C 交易管理（客户订单/收益订单，行内展开详情，6 用例）→ commit a72cead
- [x] D 钱包管理（余额/账单/代客充值，8 用例）→ commit 07ea2b3
- [x] E 敞口与平仓（快照明细/新建/整批重试/分配明细，6 用例）→ commit cf6b6d2
- [x] 跨页 J3 冒烟（m4-ops-flow.test.tsx，4 用例）
- [x] 全量门禁：lint 0 问题 / typecheck clean / 31 文件 350 用例全绿 / build 成功

## Review（M4，2026-10-28）

- 已完成：运营端 10 页全部脱离占位（总览/客户列表+详情/客户订单/收益订单/余额查询/
  账单流水/代客充值/敞口/平仓）；store 读写全部收敛到 features/*/hooks（页面零 useAppStore
  引用）；平仓/整批重试经真实领域服务重校验并重新锁价，exposure 快照来自 selectPairExposure。
- 证据：`npm run lint` 0 问题；`npm run typecheck` clean；`npx vitest run` 31 文件 350 用例
  全绿（M3 基线 24 文件 304 + 底座 selectors 11 + 六纵切文件 35）；`npm run build` 成功
  （gzip JS 317.5KB）。J3 跨页冒烟：总览 19,876.87 / 9 笔 → 今日 0 笔且敞口 +1,700.00 与
  报价健康快照不动；平仓 300.00 USD/EUR 后敞口 1,700→1,400（FIFO 先耗 EX-1）、PO-EX-1
  未平 200→0、部分实现→已结算；CB-2 整批重试按价池重锁 151.00 转 SUCCESS，USD/JPY
  收益单未平合计按批次金额冲减且明细出现第二次尝试。
- 根因修复：D6 估值折算方向倒挂（选择器 × mid 与 HomePage ÷ mid 双实现矛盾）——PRD
  「1 USD = R 报价币」口径下外币折 USD 应为除法；已回写文档 §10.2/§7.3/§10.3、选择器改除、
  HomePage 收敛单一实现；÷ 金样 49,116.76 / 42,360.70 / 34,113.43（commit bf38246）。
- 已知取舍：收益单状态与方向文案在 features/*/labels 就地维护（公共 StatusBadge 内置
  映射与 §6.6 口径不符，未改公共组件）；overview 的 describeRange 与 selectors.resolveRange
  口径重复（后者未导出）；订单/收益单详情用行内展开卡片（无新增路由，展开态不落 URL）；
  无分页（原型无要求）。
- 没试什么：未做浏览器真机视觉/键盘走查（J3 截图留验收）；FALLBACK/NO_QUOTE/FLAT/尾差等
  无 seed 数据可触发的分支仅代码路径保证；双击/并发提交仅双守卫保证，未做 UI 级并发用例；
  未启真实后端；ADR-001..004 同步 docs/decisions.md 仍待确认。
