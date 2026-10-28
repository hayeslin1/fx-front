// 演示级认证的密码哈希：SHA-256(salt:password)。
// WHY：原型不接后端，但也不应以明文存密码；明确注释为演示方案，非生产认证（设计文档 §4.3）
export async function sha256Hex(salt: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomSalt(): string {
  return crypto.randomUUID();
}
