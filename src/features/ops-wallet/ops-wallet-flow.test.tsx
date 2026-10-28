// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/app/routes';
import { D, fmtMoney } from '@/domain/money';
import { setClock } from '@/lib/clock';
import { SEED_CUSTOMERS, SEED_OPS_ACCOUNTS } from '@/mocks/seed-script';
import { bootstrapStore, loginOps, useAppStore } from '@/store';

// 运营钱包管理纵切（M4 D）渲染用例（jsdom，装配范式同 app/routes.test.tsx）：
// 覆盖余额页出数与客户搜索、账单页类型/日期筛选、代客充值校验拒绝与二次确认入账。
// WHY 走真实 createRoot + MemoryRouter + 真实 store：断言 store 事实与 DOM 双口径，
// 避免只测组件内部状态；客户一律用业务键（邮箱）定位，不硬编码预置编号。

// jsdom 不实现 SubtleCrypto；bootstrap/登录的演示哈希需要 Web Crypto，回填 Node 实现
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime();
const OPS_SPEC = SEED_OPS_ACCOUNTS.find((account) => account.isDemoAccount) ?? SEED_OPS_ACCOUNTS[0];

let container: HTMLDivElement;
let root: Root;

function html(): string {
  return container.innerHTML;
}

function text(): string {
  return container.textContent ?? '';
}

async function mount(path: string): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

/** DOM 内表格数据行数（DataTable 空态不渲染 tbody，计数即为 0） */
function tableRowCount(): number {
  return container.querySelectorAll('tbody tr').length;
}

function byId<T extends Element>(id: string): T {
  const element = container.querySelector<T>(`#${id}`);
  if (element === null) throw new Error(`未找到元素 #${id}`);
  return element;
}

async function setInputValue(id: string, value: string): Promise<void> {
  const input = byId<HTMLInputElement>(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function setSelectValue(id: string, value: string): Promise<void> {
  const select = byId<HTMLSelectElement>(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 等一拍宏任务，确保提交/导航的异步链路全部完成后再断言 */
async function click(element: Element | null): Promise<void> {
  if (element === null) throw new Error('目标元素不存在');
  await act(async () => {
    (element as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 按文案找按钮（可指定根节点：ConfirmDialog 经 portal 渲染在 document.body） */
function findButton(scope: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(label),
  );
  if (button === undefined) throw new Error(`未找到按钮「${label}」`);
  return button;
}

/** 业务键定位：客户 id 由邮箱解析，禁止硬编码 C-00x 位次假设 */
function customerIdByEmail(email: string): string {
  const customer = useAppStore.getState().data.customers.find((item) => item.email === email);
  if (customer === undefined) throw new Error(`预置客户不存在：${email}`);
  return customer.id;
}

function walletBalance(customerId: string, currency: 'USD' | 'CNH'): string {
  const wallet = useAppStore
    .getState()
    .data.wallets.find((item) => item.customerId === customerId && item.currency === currency);
  if (wallet === undefined) throw new Error(`钱包不存在：${customerId}/${currency}`);
  return wallet.balance;
}

beforeEach(async () => {
  setClock(() => NOW);
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await bootstrapStore();

  if (OPS_SPEC === undefined) throw new Error('缺少预置运营账号');
  const login = await loginOps(OPS_SPEC.email, OPS_SPEC.password);
  if (!login.ok) throw new Error('运营登录失败');
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setClock(null);
});

describe('运营余额查询', () => {
  it('展示全部预置客户的六币种余额与金样数值（C-001 USD 20,500.00 / EUR 8,203.15）', async () => {
    await mount('/ops/wallets/balances');

    expect(text()).toContain('余额查询');
    expect(text()).toContain('参考估值');
    expect(text()).toContain('演示资金');
    expect(tableRowCount()).toBe(SEED_CUSTOMERS.length);

    for (const spec of SEED_CUSTOMERS) {
      expect(html()).toContain(spec.name);
    }
    // 金样：设计文档 §5.4 期初 + 脚本增量（C-001）
    expect(html()).toContain('20,500.00 USD');
    expect(html()).toContain('8,203.15 EUR');
    expect(html()).toContain('7,686.45 GBP');
    // 币种列头固定六种
    for (const code of ['USD', 'GBP', 'EUR', 'JPY', 'CNH', 'HKD']) {
      expect(html()).toContain(`>${code}</th>`);
    }
  });

  it('按邮箱关键词搜索只保留匹配客户', async () => {
    await mount('/ops/wallets/balances');
    const target = SEED_CUSTOMERS[1];
    const other = SEED_CUSTOMERS[0];
    if (target === undefined || other === undefined) throw new Error('预置客户不足');

    await setInputValue('customer-keyword', target.email.toUpperCase());

    expect(tableRowCount()).toBe(1);
    expect(text()).toContain(target.name);
    expect(text()).not.toContain(other.name);
    expect(text()).toContain('共 1 位客户');
  });
});

describe('运营账单流水', () => {
  it('类型筛选 TOPUP_SELF 后仅 1 行（预置唯一一笔自助充值）', async () => {
    await mount('/ops/wallets/bills');
    const all = tableRowCount();
    expect(all).toBeGreaterThan(0);

    await setSelectValue('bill-type', 'TOPUP_SELF');

    expect(tableRowCount()).toBe(1);
    expect(text()).toContain('自助充值');
    expect(text()).toContain('5,000.00 CNH');
    expect(text()).toContain('苏晚');
    expect(text()).toContain('共 1 条流水');
  });

  it('类型筛选 TOPUP_OPS 时操作人列显示运营账号姓名', async () => {
    await mount('/ops/wallets/bills');

    await setSelectValue('bill-type', 'TOPUP_OPS');

    expect(tableRowCount()).toBe(1);
    const body = container.querySelector('tbody')?.textContent ?? '';
    expect(body).toContain('运营充值');
    expect(body).toContain('2,000.00 USD');
    expect(body).toContain(OPS_SPEC?.name ?? '');
  });

  it('日期区间非法（起晚于止）即拒绝，提示错误且不改变行数', async () => {
    await mount('/ops/wallets/bills');
    const before = tableRowCount();

    await setInputValue('bill-date-from', '2026-10-27');
    await setInputValue('bill-date-to', '2026-10-01');

    expect(text()).toContain('开始日期不能晚于结束日期');
    expect(tableRowCount()).toBe(before);

    // 修正为合法区间（含当天）后应用筛选：独立按 [当日 00:00:00.000, 23:59:59.999] 闭合口径核对
    await setInputValue('bill-date-to', '2026-10-27');
    expect(text()).not.toContain('开始日期不能晚于结束日期');
    const dayStart = new Date(2026, 9, 27, 0, 0, 0, 0).getTime();
    const dayEnd = new Date(2026, 9, 27, 23, 59, 59, 999).getTime();
    const inDay = useAppStore
      .getState()
      .data.bills.filter((bill) => bill.createdAt >= dayStart && bill.createdAt <= dayEnd);
    expect(inDay.length).toBeGreaterThan(0);
    // 当日下午/晚间仍有流水：证明“止”是全天闭合而非当日 00:00 截断
    expect(Math.max(...inDay.map((bill) => bill.createdAt))).toBeGreaterThan(
      new Date(2026, 9, 27, 12, 0, 0).getTime(),
    );
    const narrowed = tableRowCount();
    expect(narrowed).toBe(inDay.length);
    expect(narrowed).toBeLessThan(before);
  });
});

describe('运营代客充值', () => {
  it('备注留空提交被拒：出现校验错误且 store 流水零变更', async () => {
    await mount('/ops/wallets/assisted-top-up');
    const target = SEED_CUSTOMERS[1];
    if (target === undefined) throw new Error('预置客户不足');
    const targetId = customerIdByEmail(target.email);
    const beforeBills = useAppStore.getState().data.bills.length;

    await setSelectValue('customerId', targetId);
    await setInputValue('amount', '1234.56');
    await click(findButton(container, '提交代客充值'));

    expect(text()).toContain('代客充值备注必填');
    expect(useAppStore.getState().data.bills.length).toBe(beforeBills);
    // 未通过校验即不进入二次确认
    expect(document.body.textContent).not.toContain('确认代客充值');
  });

  it('JPY 小数金额被拒（币种精度校验，JPY 须为整数）', async () => {
    await mount('/ops/wallets/assisted-top-up');
    const target = SEED_CUSTOMERS[0];
    if (target === undefined) throw new Error('预置客户不足');
    const beforeBills = useAppStore.getState().data.bills.length;

    await setSelectValue('customerId', customerIdByEmail(target.email));
    await setSelectValue('currency', 'JPY');
    await setInputValue('amount', '100.5');
    await setInputValue('remark', '自动化测试：非法精度');
    await click(findButton(container, '提交代客充值'));

    expect(text()).toContain('该币种不支持小数');
    expect(useAppStore.getState().data.bills.length).toBe(beforeBills);
    expect(document.body.textContent).not.toContain('确认代客充值');
  });

  it('填齐后二次确认提交成功：bills +1、客户余额增加并展示回执', async () => {
    await mount('/ops/wallets/assisted-top-up');
    const target = SEED_CUSTOMERS[1];
    if (target === undefined) throw new Error('预置客户不足');
    const targetId = customerIdByEmail(target.email);
    const beforeBills = useAppStore.getState().data.bills.length;
    const beforeBalance = walletBalance(targetId, 'USD');
    const amount = '1234.56';
    const remark = '自动化测试：代客充值';

    // 关键词搜索后仍可选中目标客户（下拉+搜索）
    await setInputValue('customer-keyword', target.name);
    await setSelectValue('customerId', targetId);
    // 选中后展示客户当前余额（演示资金标识）
    expect(text()).toContain(fmtMoney(beforeBalance, 'USD'));
    await setInputValue('amount', amount);
    await setInputValue('remark', remark);

    await click(findButton(container, '提交代客充值'));
    // 二次确认弹窗（portal 渲染在 document.body）
    expect(document.body.textContent).toContain('确认代客充值');
    expect(document.body.textContent).toContain(target.name);
    await click(findButton(document.body, '确认入账'));

    const state = useAppStore.getState();
    expect(state.data.bills.length).toBe(beforeBills + 1);
    const created = state.data.bills[state.data.bills.length - 1];
    expect(created?.type).toBe('TOPUP_OPS');
    expect(created?.customerId).toBe(targetId);
    expect(created?.currency).toBe('USD');
    expect(created?.amount).toBe(amount);
    expect(created?.remark).toBe(remark);
    expect(created?.operatorId).toBe(
      state.data.opsAccounts.find((account) => account.email === OPS_SPEC?.email)?.id,
    );

    const expectedBalance = D(beforeBalance).plus(amount).toFixed(2);
    expect(created?.balanceBefore).toBe(beforeBalance);
    expect(created?.balanceAfter).toBe(expectedBalance);
    expect(walletBalance(targetId, 'USD')).toBe(expectedBalance);

    // 回执：金额与新余额
    expect(text()).toContain('代客充值成功');
    expect(text()).toContain(fmtMoney(amount, 'USD'));
    expect(text()).toContain(fmtMoney(expectedBalance, 'USD'));
  });
});
