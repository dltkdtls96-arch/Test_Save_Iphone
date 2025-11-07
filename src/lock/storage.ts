// /src/lock/storage.ts

// storage.ts


export type LockState = {
  enabled: boolean;
  hash: string | null;
  salt: string | null;
  pinLength: number;
  mustChangeOnFirstUnlock?: boolean;
  version: 1;
};

export const LOCK_KEY = "lock.v1";
export const DEFAULT_PIN = "0000";   // ← 네가 원하는 값으로
export const DEFAULT_LEN = 4;          // 자릿수도 같이 조절 가능

const toB64 = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)));
export async function sha256B64(str: string) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return toB64(buf);
}
export function randomSaltB64(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return toB64(a.buffer);
}

export function readLock(): LockState | null {
  try {
    const s = localStorage.getItem(LOCK_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
export function writeLock(v: LockState) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(v));
}

/** 최초 진입/업데이트 시 한 번 돌림 → 기존 설치 사용자에게도 기본 PIN 심기 */
export async function migrateLock() {
  const cur = readLock();
  if (cur?.version === 1) return; // 이미 v1 완료
  const salt = randomSaltB64();
  const hash = await sha256B64(DEFAULT_PIN + ":" + salt);
  writeLock({
    enabled: true,
    hash, salt,
    pinLength: DEFAULT_LEN,
    mustChangeOnFirstUnlock: true,
    version: 1,
  });
}

export async function verifyPin(pin: string) {
  const cur = readLock();
  if (!cur?.hash || !cur?.salt) return false;
  const h = await sha256B64(pin + ":" + cur.salt);
  return h === cur.hash;
}

export async function setNewPin(pin: string) {
  const salt = randomSaltB64();
  const hash = await sha256B64(pin + ":" + salt);
  const cur = readLock()!;
  writeLock({
    ...cur,
    hash, salt,
    pinLength: pin.length,
    mustChangeOnFirstUnlock: false,
  });
}

export function setEnabled(enabled: boolean) {
  const cur = readLock();
  if (!cur) return;
  writeLock({ ...cur, enabled });
}
