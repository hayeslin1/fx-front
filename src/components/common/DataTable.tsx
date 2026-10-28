import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// 通用列表：shadcn Table 原语的列定义封装，空态/对齐/行点击统一处理（设计文档 §4.1 common）

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /**
   * 表格可访问名称（设计文档 §11.2）：一页多表时用 aria-label 区分用途，便于读屏与测试定位。
   * 可选，不传则不渲染该属性（不影响既有渲染与样式）。
   */
  ariaLabel?: string;
  /**
   * 窄屏横向滚动时冻结首列（粘性定位）。
   * 宽表（如 WalletPage 7 列、OrdersPage 8 列）在窄视口横向滚动时，
   * 首列（币种/订单号）保持可见，用户始终知道当前在看哪一行。
   */
  stickyFirstColumn?: boolean;
}

const ALIGN_CLASS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  ariaLabel,
  stickyFirstColumn,
}: DataTableProps<T>) {
  // 首列粘性样式：横向滚动时冻结首列，内容滚动时始终可见（bg-card 保证覆盖下方内容）
  const STICKY_FIRST = 'sticky left-0 z-10 bg-card';

  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table aria-label={ariaLabel}>
        <TableHeader>
          <TableRow>
            {columns.map((col, index) => (
              <TableHead
                key={col.key}
                scope="col"
                className={cn(
                  ALIGN_CLASS[col.align ?? 'left'],
                  stickyFirstColumn && index === 0 && STICKY_FIRST,
                  col.className,
                )}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {columns.map((col, index) => (
                <TableCell
                  key={col.key}
                  className={cn(
                    ALIGN_CLASS[col.align ?? 'left'],
                    stickyFirstColumn && index === 0 && STICKY_FIRST,
                    col.className,
                  )}
                >
                  {col.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
