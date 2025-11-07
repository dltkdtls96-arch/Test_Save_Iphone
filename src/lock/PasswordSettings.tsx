// /src/lock/PasswordSettings.tsx
import React from "react";
import { verifyPin, setNewPin, setEnabled, readLock } from "./storage";

export default function PasswordSettings() {
  const st = readLock();
  const [cur, setCur] = React.useState("");
  const [n1, setN1] = React.useState("");
  const [n2, setN2] = React.useState("");
  const [msg, setMsg] = React.useState("");

  const change = async () => {
    if (!(await verifyPin(cur))) return setMsg("현재 PIN이 맞지 않습니다.");
    if (n1.length < 4 || n1.length > 8) return setMsg("4~8자리로 설정하세요.");
    if (n1 !== n2) return setMsg("새 PIN이 일치하지 않습니다.");
    await setNewPin(n1);
    setMsg("변경 완료!");
    setCur(""); setN1(""); setN2("");
  };

  const toggle = async (to: boolean) => {
    if (to === false && !(await verifyPin(cur)))
      return setMsg("현재 PIN이 맞지 않습니다.");
    setEnabled(to);
    setMsg(to ? "비밀번호를 켰습니다." : "비밀번호를 껐습니다.");
  };

  return (
    <div className="space-y-3">
      <div className="font-semibold">비밀번호 설정</div>
      <div className="text-sm opacity-70">현재 상태: {st?.enabled ? "켜짐" : "꺼짐"}</div>

      <input className="border rounded px-2 py-1 w-full" placeholder="현재 PIN"
             value={cur} onChange={e=>setCur(e.target.value)} />
      <input className="border rounded px-2 py-1 w-full" placeholder="새 PIN(4~8자리)"
             value={n1} onChange={e=>setN1(e.target.value)} />
      <input className="border rounded px-2 py-1 w-full" placeholder="새 PIN 확인"
             value={n2} onChange={e=>setN2(e.target.value)} />

      <div className="flex gap-2">
        <button className="border rounded px-3 py-1" onClick={change}>변경</button>
        {st?.enabled
          ? <button className="border rounded px-3 py-1" onClick={()=>toggle(false)}>끄기</button>
          : <button className="border rounded px-3 py-1" onClick={()=>toggle(true)}>켜기</button>}
      </div>
      <div className="text-xs text-red-400">{msg}</div>
    </div>
  );
}
