// /src/lock/PasswordGate.tsx
import React from "react";
import { readLock, verifyPin, migrateLock } from "./storage";

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [needAuth, setNeedAuth] = React.useState(false);
  const [digits, setDigits] = React.useState("");
  const pinLenRef = React.useRef(6);

  React.useEffect(() => {
    (async () => {
      await migrateLock();                                 // ⬅ 기존 설치 사용자도 적용
      const st = readLock();
      pinLenRef.current = st?.pinLength ?? 6;
      setNeedAuth(!!st?.enabled);
      setReady(true);
    })();
  }, []);

  // 앱 복귀 시 재잠금 (원하면 시간 조건 추가)
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

  React.useEffect(() => {
    if (!needAuth) return;
    if (digits.length === pinLenRef.current) {
      (async () => {
        const ok = await verifyPin(digits);
        if (ok) {
          setNeedAuth(false);
          setDigits("");
        } else {
          // 실패 처리(진동/흔들림 등)
          setDigits("");
        }
      })();
    }
  }, [digits, needAuth]);

  if (!ready) return null;
  if (!needAuth) return <>{children}</>;

  const pinLen = pinLenRef.current;
  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center gap-6 select-none">
      <div className="text-3xl font-bold">암호 입력</div>
      <div className="opacity-70">보안 관련 요청이 있어 설정함 (비밀번호:철도의날 /설정에서 끄기 변경 가능 추후 비밀번호 비공개).</div>

      {/* ●●●●●● 점 표시 */}
      <div className="flex gap-4">
        {Array.from({ length: pinLen }).map((_, i) => (
          <div key={i} className="w-3.5 h-3.5 rounded-full bg-white"
               style={{ opacity: i < digits.length ? 1 : 0.25 }}/>
        ))}
      </div>

      <Keypad
        onDigit={(d) => setDigits(s => (s + d).slice(0, pinLen))}
        onBack={() => setDigits(s => s.slice(0, -1))}
      />
    </div>
  );
}

function Keypad({ onDigit, onBack }:{
  onDigit:(d:string)=>void; onBack:()=>void;
}) {
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return (
    <div className="grid grid-cols-3 gap-4">
      {keys.map((k,i)=>(
        <button
          key={i}
          className="w-16 h-16 rounded-full border border-white/40 text-xl"
          onClick={()=>{ if(k==="⌫") onBack(); else if(k!=="") onDigit(k); }}>
          {k}
        </button>
      ))}
    </div>
  );
}
