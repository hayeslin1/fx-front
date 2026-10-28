import { create } from 'zustand';
import { now } from '@/lib/clock';
import { buildSeed } from '@/domain/seed';
import { authCommands, type RegisterInput } from '@/domain/services/auth.service';
import type { Customer, DataState, DomainCommand, DomainResult, OpsAccount } from '@/domain/types';
import {
  createBrowserAdapter,
  createMemoryAdapter,
  isLocalStorageAvailable,
  type StorageAdapter,
} from '@/lib/storage';
import { loadPersisted, savePersisted } from './persistence';
import { emptyData } from './slices/data.slice';
import { initialSession } from './slices/session.slice';
import { initialUi, type UiState } from './slices/ui.slice';
import type { SessionState } from '@/domain/types';

// 单一 store（设计文档 §7 / ADR-003）：
// - 写操作唯一入口 apply(cmd)：领域服务纯函数产出「完整新状态」→ 一次原子提交
// - 变更即落盘（订阅 data/session 引用变化），等价 persist partialize 语义（§5.3）

export interface AppState {
  session: SessionState;
  data: DataState;
  ui: UiState;
  apply: <T>(cmd: DomainCommand<T>) => Promise<DomainResult<T>>;
}

export const useAppStore = create<AppState>()((set, get) => ({
  session: initialSession,
  data: emptyData,
  ui: initialUi,
  apply: async <T>(cmd: DomainCommand<T>): Promise<DomainResult<T>> => {
    const result = await cmd.run(get().data, { now: now() });
    if (result.ok) set({ data: result.next });
    return result;
  },
}));

let adapter: StorageAdapter = createMemoryAdapter();

/**
 * 引导：读取持久化 → 安全恢复 / 重放 seed → 订阅落盘。
 * 必须在 React 渲染前 await 完成（main.tsx）。
 */
export async function bootstrapStore(): Promise<void> {
  adapter = createBrowserAdapter();
  const storagePersistent = isLocalStorageAvailable();
  const loaded = loadPersisted(adapter);

  if (loaded.ok) {
    useAppStore.setState({
      session: loaded.payload.session,
      data: loaded.payload.data,
      ui: { storageRecovered: false, storagePersistent },
    });
  } else {
    const seeded = await buildSeed(now());
    savePersisted(adapter, { session: initialSession, data: seeded });
    useAppStore.setState({
      session: initialSession,
      data: seeded,
      // 首次打开（empty）不提示；损坏/版本不兼容才提示已恢复（PRD §9-11）
      ui: { storageRecovered: loaded.reason !== 'empty', storagePersistent },
    });
  }

  useAppStore.subscribe((state, prev) => {
    if (state.data !== prev.data || state.session !== prev.session) {
      savePersisted(adapter, { session: state.session, data: state.data });
    }
  });
}

// ---------- 编排动作（apply + 会话管理；组件经 features 薄 hooks 调用，设计文档 §7.2） ----------

export async function registerCustomer(
  input: RegisterInput,
): Promise<DomainResult<{ customer: Customer }>> {
  const result = await useAppStore.getState().apply(authCommands.register(input));
  if (result.ok) {
    // PRD §3.1：注册后直接使用（自动登录）
    useAppStore.setState({
      session: {
        ...useAppStore.getState().session,
        client: { customerId: result.data.customer.id },
      },
    });
  }
  return result;
}

export async function loginClient(
  email: string,
  password: string,
): Promise<DomainResult<{ customer: Customer }>> {
  const result = await useAppStore.getState().apply(authCommands.loginClient(email, password));
  if (result.ok) {
    useAppStore.setState({
      session: {
        ...useAppStore.getState().session,
        client: { customerId: result.data.customer.id },
      },
    });
  }
  return result;
}

export async function loginOps(
  email: string,
  password: string,
): Promise<DomainResult<{ opsAccount: OpsAccount }>> {
  const result = await useAppStore.getState().apply(authCommands.loginOps(email, password));
  if (result.ok) {
    useAppStore.setState({
      session: {
        ...useAppStore.getState().session,
        ops: { opsAccountId: result.data.opsAccount.id },
      },
    });
  }
  return result;
}

export function logoutClient(): void {
  useAppStore.setState({ session: { ...useAppStore.getState().session, client: null } });
}

export function logoutOps(): void {
  useAppStore.setState({ session: { ...useAppStore.getState().session, ops: null } });
}

/** 关闭“已恢复预置数据”提示（仅 UI 态，不触发落盘） */
export function dismissStorageRecovered(): void {
  useAppStore.setState({ ui: { ...useAppStore.getState().ui, storageRecovered: false } });
}

/** 重置演示数据：工厂重置语义——清除已注册客户与全部运行期数据，恢复预置样例（设计文档 §5.3） */
export async function resetDemoData(): Promise<void> {
  const previousResetCount = useAppStore.getState().data.meta.resetCount;
  const seeded = await buildSeed(now());
  const data: DataState = {
    ...seeded,
    meta: { ...seeded.meta, resetCount: previousResetCount + 1 },
  };
  useAppStore.setState({
    session: initialSession,
    data,
    ui: { ...useAppStore.getState().ui, storageRecovered: false },
  });
}
