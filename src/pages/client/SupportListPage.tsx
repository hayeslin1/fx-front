import { Link, useNavigate } from 'react-router';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { useSupportList, type SupportTicketView } from '@/features/support/hooks';
import { formatDateTime } from '@/lib/format';

// 列表列定义：主题/状态/处理人/更新时间（PRD §3.5、设计文档 §10.2）。
// 主题列同时是可键盘聚焦的链接，行点击作为鼠标快捷方式，兼顾可访问性。
const COLUMNS: DataTableColumn<SupportTicketView>[] = [
  {
    key: 'subject',
    header: '主题',
    cell: (ticket) => (
      <Link
        to={`/app/support/${ticket.id}`}
        className="font-medium text-foreground hover:text-primary hover:underline"
      >
        {ticket.subject}
      </Link>
    ),
  },
  {
    key: 'status',
    header: '状态',
    cell: (ticket) => <StatusBadge status={ticket.status} />,
  },
  {
    key: 'assignee',
    header: '处理人',
    cell: (ticket) => <span className="text-muted-foreground">{ticket.assigneeName}</span>,
  },
  {
    key: 'updatedAt',
    header: '更新时间',
    cell: (ticket) => (
      <span className="tabular-nums text-muted-foreground">{formatDateTime(ticket.updatedAt)}</span>
    ),
  },
];

// 客服工单列表（里程碑 M3，设计文档 §10.2）：仅展示当前客户工单，最近更新在前。
export function SupportListPage() {
  const navigate = useNavigate();
  const { tickets } = useSupportList();

  return (
    <div className="space-y-6">
      <PageHeader
        title="客服工单"
        description="查看工单进度与运营回复，遇到新问题可随时新建工单"
        actions={
          <Button asChild>
            <Link to="/app/support/new">新建工单</Link>
          </Button>
        }
      />

      <DataTable
        columns={COLUMNS}
        rows={tickets}
        rowKey={(ticket) => ticket.id}
        stickyFirstColumn
        onRowClick={(ticket) => navigate(`/app/support/${ticket.id}`)}
        empty={
          <EmptyState
            title="暂无工单"
            description="遇到问题？创建工单后运营会尽快回复。"
            action={
              <Button asChild>
                <Link to="/app/support/new">新建工单</Link>
              </Button>
            }
          />
        }
      />
    </div>
  );
}
