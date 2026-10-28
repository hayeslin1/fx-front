# fx-front · 跨境汇兑演示平台（前端原型）

面向个人客户的跨境汇兑高保真交互原型，含**客户端**与**运营端**双端：客户端完成注册/充值/兑换/订单/客服全流程；运营端完成客户/交易/钱包/汇率配置/工单处理。

全部数据为浏览器本地演示数据（localStorage），**无后端依赖**，开箱即跑。

## 快速开始

```bash
nvm use            # Node 26（见 .nvmrc；package.json engines: >=26 <27）
npm install        # 依赖精确锁定，package-lock.json 已提交
npm run dev        # http://localhost:5173
```

SPA 深链（如 `/app/login`、`/ops/overview`）由 Vite history fallback 支持。

## 演示账号

| 端 | 入口 | 账号 | 密码 |
| --- | --- | --- | --- |
| 客户端 | `/app/login` | `linxiaoman@demo.fx`（林小满） | `Demo1234` |
| 运营端 | `/ops/login` | `ops@demo.fx`（演示管理员） | `OpsDemo123` |

另有预置客户 `chenyu@demo.fx`、`suwan@demo.fx`（密码同上）。演示数据可用运营端顶栏「重置演示数据」恢复预置样例。

## 命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | Vite 开发服务器（默认 5173） |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | Vitest 单测与渲染冒烟（39 文件 398 用例） |
| `npm run test:watch` | 测试监听模式 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run format` | Prettier 格式化 |

质量门禁：`npm run lint && npm run typecheck && npm run test && npm run build` 全绿。

## 技术栈（精确锁定版本，禁用 `latest`/`*`/`^x.y`）

| 类别 | 选型 |
| --- | --- |
| 框架 | React 19.3.1 + TypeScript 6.0.3 |
| 构建 | Vite 8.3.5（@vitejs/plugin-react 6.1.2） |
| 路由 | react-router 8.5.1 |
| 样式 | Tailwind CSS 4.3.3 + shadcn（radix-ui 1.8.1；`src/components/ui/` 由 CLI 生成，勿手改） |
| 状态 | zustand 5.0.16 |
| 金额/汇率 | decimal.js 10.6.0（全链路 Decimal，禁止对 number 做金额运算） |
| 图表 | recharts 3.10.1 |
| 测试 | Vitest 5.0.5 + jsdom 30.1.3 |

## 架构要点

- **事实/派生分离**：`store.data` 只存事实（订单、钱包、流水、配置），敞口、损益、账本、收益单等一律由 `src/domain/ledger.ts` 重放派生（按引用 memoize）。
- **唯一写入口**：所有变更经 `store.apply(cmd)`；领域服务为纯函数 `run(state, ctx) → { ok: true, next, data } | { ok: false, code, message }`，失败零变更。
- **页面不直接触达 store**：store 读写收敛在 `src/features/*/hooks.ts`。
- **金额口径**：币对统一按「1 USD = R 单位报价币」表示；持久化金额为十进制字符串；舍入只在出口按币种精度（JPY 0 位、其余 2 位）。
- **预置数据可复现**：`src/mocks/seed-script.ts` 描述事实脚本，`src/domain/seed.ts` 以锚点时间回推生成；金样数值见技术设计文档 §5.4。

## 目录结构

```
src/
  api/          后端对接契约层（本期预留，UI 不接入）
  app/          路由、守卫、providers
  components/   common（业务公共组件）+ ui（shadcn 生成物）
  domain/       领域层：types/money/ids/clock + services（纯函数）+ pricing/ledger/pnl
  features/     按业务纵切的薄 hooks 与流程测试
  layouts/      双端壳（theme-client / theme-ops）
  lib/          clock / format / storage / hash / utils
  mocks/        seed 脚本
  pages/        页面（client / ops）
  store/        zustand store + 选择器 + 持久化
```

## 页面

- **客户端**（`/app/*`）：首页估值、钱包、充值、兑换（取价 / 30 秒锁价 / 成交）、订单列表与详情、客服工单（列表 / 新建 / 详情）
- **运营端**（`/ops/*`）：业务总览、客户管理、交易管理（客户订单 / 敞口监控 / 渠道平仓 / 收益订单）、钱包管理（余额 / 账单 / 代客充值）、汇率运营（渠道 / 币对 / 采集池 / 路由 / 加点 / 报价计算器）、客服处理（工单列表 / 详情）

## 文档

| 文件 | 内容 |
| --- | --- |
| `docs/cross-border-fx-prototype-prd.md` | 产品需求（PRD） |
| `docs/cross-border-fx-prototype-tech-design.md` | 技术设计（**Spec is Truth**：行为变更先回写本文档再改代码） |
| `docs/code-standards.md` / `docs/decisions.md` | 硬规则 / 架构决策 |
| `AGENTS.md` / `LESSONS.md` | 协作约定 / 失败复盘 |

## 已知限制与非目标

- **多标签页不同步**（后写覆盖，last-write-wins）：运营端与客户端请在同一标签页内切换；若开两个标签页，运营端操作后刷新另一标签页即可（技术设计文档 §5.3 / §14）。
- 数据仅存浏览器 localStorage，无后端、无真实网络请求（`src/api/` 为对接预留契约层）。
- 非目标：SSR/SSG、PWA、i18n、暗色模式、E2E 框架、CI 流水线。
