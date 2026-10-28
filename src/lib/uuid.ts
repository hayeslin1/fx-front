// 幂等键/临时 id 生成（后端对接期的 requestId 预留，设计文档 §8.2）
export function uuid(): string {
  return crypto.randomUUID();
}
