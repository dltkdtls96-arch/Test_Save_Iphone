// /src/lock/PasswordGate.tsx
import React from "react";
import { readLock, verifyPin, migrateLock } from "./storage";

export default function PasswordGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = React.useState(false);
  const [needAuth, setNeedAuth] = React.useState(false);
  const [digits, setDigits] = React.useState("");
  const pinLenRef = React.useRef(6);

  // 최초 로딩 + 기존 사용자 마이그레이션
  React.useEffect(() => {
    (async () => {
      await migrateLock();
      const st = readLock();
      pinLenRef.current = st?.pinLength ?? 6;
      setNeedAuth(!!st?.enabled);
      setReady(true);
    })();
  }, []);

  // 앱 복귀 시 자동 재잠금
  React.useEffect(() => {
    const onVis = () => {
      const st = readLock();
      if (document.visibilityState === "visible" && st?.enabled) {
        setNeedAuth(true);
        setDigits("");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // PIN 길이만큼 입력되면 검증
  React.useEffect(() => {
    if (!needAuth) return;
    if (digits.length === pinLenRef.current) {
      (async () => {
        const ok = await verifyPin(digits);
        if (ok) {
          setNeedAuth(false);
          setDigits("");
        } else {
          // 실패 시 입력 초기화 (원하면 진동/애니메이션 추가 가능)
          setDigits("");
        }
      })();
    }
  }, [digits, needAuth]);

  if (!ready) return null;
  if (!needAuth) return <>{children}</>;

  const pinLen = pinLenRef.current;

  return (
    <div
      className={`
        password-gate-root
        fixed inset-0 select-none
        flex flex-col items-center justify-center gap-6
        transition-colors

        bg-slate-950 text-gray-100
      `}
    >
      <div className="text-3xl font-bold">암호 입력</div>
      <div className="opacity-70 text-sm">비밀번호를 입력하세요.</div>

      {/* ●●●●●● 점 표시 */}
      <div className="flex gap-4 mt-2 mb-4">
        {Array.from({ length: pinLen }).map((_, i) => (
          <div
            key={i}
            className="
              pin-dot
              w-3.5 h-3.5 rounded-full
              transition-opacity
            "
            style={{ opacity: i < digits.length ? 1 : 0.25 }}
          />
        ))}
      </div>

      <Keypad
        onDigit={(d) => setDigits((s) => (s + d).slice(0, pinLen))}
        onBack={() => setDigits((s) => s.slice(0, -1))}
      />
    </div>
  );
}

function Keypad({
  onDigit,
  onBack,
}: {
  onDigit: (d: string) => void;
  onBack: () => void;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="grid grid-cols-3 gap-4">
      {keys.map((k, i) => (
        <button
          key={i}
          className={`
            pin-key
            w-16 h-16 rounded-full text-xl
            flex items-center justify-center
            transition
            active:scale-95
          `}
          onClick={() => {
            if (k === "⌫") onBack();
            else if (k !== "") onDigit(k);
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}
