import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
 let out = "";
 for (let i = 0; i < bytes.length; i += 3) {
const a = bytes[i];
const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
out += i + 2 < bytes.length ? B64[c & 63] : '=';
 }
 return out;
}

export function nokiaBase64Url(value: string | Uint8Array): string {
 const bytes = typeof value === "string" ? utf8ToBytes(value) : value;
 return base64(bytes).split("+").join("-").split("/").join("_").split("=").join(".");
}

export function nokiaEscapeBase64(value: string): string {
 return value.split("+").join("-").split("/").join("_").split("=").join(".");
}

export function nokiaSha256(value1: string, value2: string): string {
 return base64(sha256(utf8ToBytes(value1 + ":" + value2)));
}

export function nokiaSha256Url(value1: string, value2: string): string {
 return nokiaEscapeBase64(nokiaSha256(value1, value2));
}

export function nokiaPasswordHash(password: string, iterations: number): string {
 if (!Number.isSafeInteger(iterations) || iterations < 0 || iterations > 100000) throw new Error("Invalid Nokia iterations");
 if (iterations === 0) return password;
 let hash = bytesToHex(sha256(utf8ToBytes(password)));
 for (let i = 1; i < iterations; i++) hash = bytesToHex(sha256(hexToBytes(hash)));
 return hash.toLowerCase();
}

export function createNokiaLoginProof(username: string, password: string, nonce: string, randomKey: string, iterations: number) {
 const passwordHash = nokiaPasswordHash(password, iterations);
 const intermediate = nokiaSha256(username, passwordHash);
 return {
 userhash: nokiaSha256Url(username, nonce),
 RandomKeyhash: nokiaSha256Url(randomKey, nonce),
 response: nokiaSha256Url(intermediate, nonce),
 nonce: nokiaEscapeBase64(nonce),
 enckey: nokiaBytesToBase64Url(Crypto.getRandomBytes(16)),
 enciv: nokiaBytesToBase64Url(Crypto.getRandomBytes(16)),
 };
}

export function nokiaBytesToBase64Url(value: Uint8Array): string {
 return nokiaEscapeBase64(base64(value));
}