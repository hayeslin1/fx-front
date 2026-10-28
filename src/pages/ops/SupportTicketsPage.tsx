import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { TicketStatus } from '@/domain/types';
import {
  filterOpsTickets,
  useOpsSupportContext,
  useOpsTicketRows,
  type OpsAssigneeFilter,
  type OpsTicketRow,
} from '@/features/ops-support/hooks';
import { TICKET_STATUS_LABELS } from '@/features/support/labels';
import { formatDateTime } from '@/lib/format';

// 运营工单列表（设计文档 §10.3 客服处理段、PRD §5.6）：
// 列＝工单号/主题/客户/状态/处理人/最近更新；筛选＝状态 + 处理人（含未指派）+ 关键词（即时过滤）。
// 行点击与工单号链接均进入详情；两端共享同一工单事实（§9.4）。

/** 下拉统一外观（项目未安装 Select，按既有令牌手写原生控件） */
const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/** 状态筛选选项（枚举文案唯一来源 features/support/labels.ts，与两端徽标一致） */
const STATUS_OPTIONS: TicketStatus[] = ['PENDING', 'IN_PROGRESS', 'CLOSED'];

const TIME_CELL_CLASS = 'text-xs whitespace-nowrap text-muted-foreground tabular-nums';

const TICKET_COLUMNS: DataTableColumn<OpsTicketRow>[] = [
  {
    key: 'id',
    header: '工单号',
    cell: (row) => (
      <Link
        to={`/ops/support/tickets/${row.id}`}
        className="font-medium tabular-nums text-primary hover:underline"
      >
        {row.id}
      </Link>
    ),
  },
  {
    key: 'subject',
    header: '主题',
    cell: (row) => <span className="font-medium">{row.subject}</span>,
  },
  {
    key: 'customer',
    header: '客户',
    cell: (row) => <span className="whitespace-nowrap">{row.customerName}</span>,
  },
  {
    key: 'status',
    header: '状态',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'assignee',
    header: '处理人',
    cell: (row) =>
      row.assigneeName === '—' ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="whitespace-nowrap">{row.assigneeName}</span>
      ),
  },
  {
    key: 'updatedAt',
    header: '最近更新',
    cell: (row) => <span className={TIME_CELL_CLASS}>{formatDateTime(row.updatedAt)}</span>,
  },
];

export function SupportTicketsPage() {
  const navigate = useNavigate();
  const { assignees } = useOpsSupportContext();
  const rows = useOpsTicketRows();
  const [status, setStatus] = useState<TicketStatus | 'ALL'>('ALL');
  const [assigneeId, setAssigneeId] = useState<OpsAssigneeFilter>('ALL');
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(
    () => filterOpsTickets(rows, { status, assigneeId, keyword }),
    [rows, status, assigneeId, keyword],
  );
  const hasFilter = status !== 'ALL' || assigneeId !== 'ALL' || keyword.trim() !== '';

  const resetFilters = () => {
    setStatus('ALL');
    setAssigneeId('ALL');
    setKeyword('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="客服处理"
        description="工单检索、指派与状态流转；与客户端共享同一工单数据（PRD §5.6）"
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">筛选</CardTitle>
              <CardDescription>
                状态、处理人与关键词（主题/客户名/工单号）。多项筛选为且关系。
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={resetFilters}>
              重置筛选
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="ticket-status">状态</Label>
              <select
                id="ticket-status"
                value={status}
                className={SELECT_CLASS}
                onChange={(event) => setStatus(event.target.value as TicketStatus | 'ALL')}
              >
                <option value="ALL">全部状态</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {TICKET_STATUS_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ticket-assignee">处理人</Label>
              <select
                id="ticket-assignee"
                value={assigneeId}
                className={SELECT_CLASS}
                onChange={(event) => setAssigneeId(event.target.value)}
              >
                <option value="ALL">全部处理人</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.name}
                  </option>
                ))}
                <option value="UNASSIGNED">未指派</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ticket-keyword">关键词</Label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="ticket-keyword"
                  type="search"
                  value={keyword}
                  autoComplete="off"
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="主题、客户名或工单号"
                  className="pl-8"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">共 {filtered.length} 个工单（最近更新在前）</p>
        <DataTable
          columns={TICKET_COLUMNS}
          rows={filtered}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/ops/support/tickets/${row.id}`)}
          empty={
            hasFilter ? (
              <EmptyState
                title="无匹配工单"
                description="未找到符合当前筛选条件的工单，请调整状态、处理人或关键词。"
              />
            ) : (
              <EmptyState
                title="暂无工单"
                description="客户提交工单后会出现在此列表，两端数据实时一致。"
              />
            )
          }
        />
      </div>
    </div>
  );
}
