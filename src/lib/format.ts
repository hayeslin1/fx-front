import dayjs from 'dayjs';

export function formatDateTime(ts: number): string {
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss');
}

export function formatDate(ts: number): string {
  return dayjs(ts).format('YYYY-MM-DD');
}

/** 编号计数器的日键：YYYYMMDD（本地时区，设计文档附录 D） */
export function formatDayKey(ts: number): string {
  return dayjs(ts).format('YYYYMMDD');
}
