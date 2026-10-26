// أنواع مختصرة لمكتبات Node اللي تستخدمها الاختبارات — بدل إضافة @types/node للمشروع كله
declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
}
declare module 'node:assert/strict' {
  const assert: {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(value: string, re: RegExp, message?: string): void;
    rejects(p: Promise<unknown>, expected?: RegExp | ((e: any) => boolean), message?: string): Promise<void>;
  };
  export default assert;
}
declare module 'node:crypto' {
  type Bytes = Uint8Array;
  interface Cipher { update(d: string | Bytes): Bytes; final(): Bytes }
  export function randomBytes(n: number): Bytes;
  export function createCipheriv(alg: string, key: Bytes, iv: Bytes): Cipher;
  export function generateKeyPairSync(t: 'rsa', o: unknown): { publicKey: string; privateKey: string };
  export function privateDecrypt(o: { key: string; padding: number }, data: Bytes): Bytes;
  export const constants: { RSA_PKCS1_PADDING: number };
}
declare module 'node:fs' {
  export function readFileSync(path: string, enc: 'utf8'): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const process: { cwd(): string };
