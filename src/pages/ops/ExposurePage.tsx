import { Fragment, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Money } from '@/components/common/Money';
import { PageHeader } from '@/components/common/PageHeader';
import { Rate } from '@/components/common/Rate';
import type { PairId, PlatformSide } from '@/domain/types';
import { useExposureRows, type ExposureRow } from '@/features/close-batches/hooks';

// 交易管理-敞口（设计文档 §10.3 / PRD §5.3）：
// 五币对行展示方向/净值 USD/对应外币估值/可平金额，展开查看来源订单明细（FIFO 剩余敞口）；
// 方向与净值来自 selectLedger().pairExposure，明细来自 selectPairLots，
// 全部经 features/close-batches/hooks 读取（§7.2），页面不直接触达 store。

const SIDE_CLASS: Record<PlatformSide | 'FLAT', string> = {
  LONG: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SHORT: 'border-rose-200 bg-rose-50 text-rose-700',
  FLAT: 'border-zinc-200 bg-zinc-50 text-zinc-600',
};

export function ExposurePage() {
  const rows = useExposureRows();
  const [expandedPairId, setExpandedPairId] = useState<PairId | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="敞口监控"
        description="五币对 USD 名义净敞口（正为多头、负为空头）；外币估值为净值按最新原始中间价的参考折算，非可成交价"
      />

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">币对</TableHead>
              <TableHead scope="col">方向</TableHead>
              <TableHead scope="col" className="text-right">
                净敞口
              </TableHead>
              <TableHead scope="col" className="text-right">
                对应外币估值
              </TableHead>
              <TableHead scope="col" className="text-right">
                可平金额
              </TableHead>
              <TableHead scope="col">来源订单</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <Fragment key={row.pairId}>
                <TableRow>
                  <TableCell className="font-medium">{row.pairId}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={SIDE_CLASS[row.side]}>
                      {row.sideLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.netUsd} currency="USD" signed={!row.isFlat} />
                  </TableCell>
                  <TableCell className="text-right">
                    {row.foreignValue === undefined ? (
                      <span className="text-muted-foreground">暂无参考价</span>
                    ) : (
                      <Money
                        value={row.foreignValue}
                        currency={row.quoteCcy}
                        signed={!row.isFlat}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.closeableUsd} currency="USD" />
                  </TableCell>
                  <TableCell>
                    {row.isFlat ? (
                      <span className="text-muted-foreground">无敞口</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-expanded={expandedPairId === row.pairId}
                        onClick={() =>
                          setExpandedPairId(expandedPairId === row.pairId ? null : row.pairId)
                        }
                      >
                        {expandedPairId === row.pairId
                          ? '收起明细'
                          : `展开来源明细（${row.lots.length}）`}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {expandedPairId === row.pairId ? (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/40">
                      <LotDetails row={row} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** 来源订单明细（PRD §5.3：订单号/方向/剩余 USD/建仓 mid，账本派生值） */
function LotDetails({ row }: { row: ExposureRow }) {
  if (row.lots.length === 0) {
    return <p className="text-xs text-muted-foreground">该币对当前没有剩余敞口订单。</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        来源订单明细（FIFO 顺序；剩余 USD 与建仓 mid 为账本重放派生值）
      </p>
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">订单号</TableHead>
              <TableHead scope="col">方向</TableHead>
              <TableHead scope="col" className="text-right">
                剩余 USD
              </TableHead>
              <TableHead scope="col" className="text-right">
                建仓 mid
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {row.lots.map((lot) => (
              <TableRow key={lot.orderId}>
                <TableCell className="font-mono text-xs">{lot.orderId}</TableCell>
                <TableCell>{lot.sideLabel}</TableCell>
                <TableCell className="text-right">
                  <Money value={lot.usdRemaining} currency="USD" />
                </TableCell>
                <TableCell className="text-right">
                  <Rate value={lot.openMid} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
