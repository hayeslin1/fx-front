// 运营总览 API（§8.4 overview.ts）。
import type { OverviewSummaryReq, OverviewSummaryResp } from './dto';
import { request } from './http';

/**
 * 总览聚合：筛选仅影响 kpi/series；exposureSnapshot 与 quoteHealth
 * 始终为当前快照，不受 range 影响（§10.3）。
 */
export function summary(input: OverviewSummaryReq): Promise<OverviewSummaryResp> {
  return request<OverviewSummaryReq, OverviewSummaryResp>(
    '/api/ops/overview/summary',
    input,
  );
}
