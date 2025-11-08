// /project/workspace/src/components/WakeIcsPanel.jsx
import React from "react";

/* =========================
 * helpers
 * ========================= */
const _pad2 = (n) => String(n).padStart(2, "0");
const toValidDate = (v) => {
  if (v instanceof Date && !isNaN(v)) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
const stripTime = (d) => {
  const x = toValidDate(d) ?? new Date();
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
const fmtYMD = (d) => {
  const x = toValidDate(d) ?? new Date();
  return `${x.getFullYear()}-${_pad2(x.getMonth() + 1)}-${_pad2(x.getDate())}`;
};
const fmtHMfromDate = (d) => {
  const x = toValidDate(d);
  if (!x) return "--:--";
  return `${_pad2(x.getHours())}:${_pad2(x.getMinutes())}`;
};
const parseHM = (hm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || "");
  if (!m) return null;
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return { hh, mm };
};

/* platform helpers */
const isIOS = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  return /iP(ad|hone|od)/.test(ua) || (plat === "MacIntel" && navigator.maxTouchPoints > 1);
};

/* Shortcuts URL */
const buildShortcutURL = (name, payload) => {
  const p = encodeURIComponent(JSON.stringify(payload));
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=${p}`;
};

export default function WakeIcsPanel(props) {
  const who = props?.who ?? props?.name ?? "나";
  const baseDate = toValidDate(props?.selectedDate ?? props?.date) ?? new Date();

  // ----- 출근시간 계산 -----
  const inTime = React.useMemo(() => {
    const dRaw = props?.panel0InDate;
    const d = toValidDate(dRaw);
    if (d) return d;

    const hm = parseHM(props?.panel0InHM);
    if (hm) {
      const base = stripTime(baseDate);
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hm.hh, hm.mm, 0, 0);
    }
    return null;
  }, [props?.panel0InDate, props?.panel0InHM, baseDate]);

  // ▼▼▼ 배치 알람: 출근 N분 전부터 ~ M분 전까지, 간격 X분 (드롭박스) ▼▼▼
  const MAX_RANGE_MIN = 720; // 최대 12시간 전
  const minuteOptions = React.useMemo(() => {
    const arr = [];
    for (let m = 0; m <= MAX_RANGE_MIN; m += 1) arr.push(m);
    return arr;
  }, []);
  const stepOptions = React.useMemo(() => {
    const arr = [];
    for (let m = 1; m <= 120; m += 1) arr.push(m); // 간격 1~120분
    return arr;
  }, []);

  const [rangeFromMin, setRangeFromMin] = React.useState(120);
  const [rangeToMin, setRangeToMin] = React.useState(10);
  const [rangeStepMin, setRangeStepMin] = React.useState(10);

  // 리스트 생성: now 이후만 포함, 타임스탬프 포함
  const makeHMList = React.useCallback(() => {
    if (!inTime) return [];
    const startMs = inTime.getTime() - Math.max(0, Number(rangeFromMin) || 0) * 60 * 1000;
    const endMs = inTime.getTime() - Math.max(0, Number(rangeToMin) || 0) * 60 * 1000;
    const stepMs = Math.max(1, Math.floor(Number(rangeStepMin) || 1)) * 60 * 1000;

    if (endMs < startMs) return [];
    const now = Date.now();

    const out = [];
    for (let t = startMs; t <= endMs; t += stepMs) {
      if (t <= now) continue; // 과거 제외
      const dt = new Date(t);
      out.push({ h: dt.getHours(), m: dt.getMinutes(), ts: t, dt });
    }
    return out;
  }, [inTime, rangeFromMin, rangeToMin, rangeStepMin]);

  // 미리보기(첫/마지막/개수)
  const preview = React.useMemo(() => {
    const list = makeHMList();
    if (!list.length) return { count: 0, first: null, last: null };
    return { count: list.length, first: list[0].dt, last: list[list.length - 1].dt };
  }, [makeHMList]);

  // iOS 단축어(배치)
  const onIOSAlarmBatch = React.useCallback(() => {
    if (!inTime) return alert("출근 시간이 없습니다.");
    if (!isIOS()) return alert("iOS에서만 지원됩니다.");

    const list = makeHMList();
    if (!list.length) return alert("설정 범위에 유효한 시간이 없습니다.");

    const label = `[${who}] 기상 (${fmtYMD(inTime)})`;
    const times = list.map(({ h, m }) => ({ h, m, label }));
    const url = buildShortcutURL("교번-알람-만들기", { times });
    window.location.href = url;
  }, [inTime, who, makeHMList]);

  // 공통 옵션 렌더
  const renderOptions = (values, suffix = "") =>
    values.map((v) => (
      <option key={v} value={v}>
        {v}
        {suffix}
      </option>
    ));

  return (
    <div className="min-h-full flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
        <h3 className="text-lg font-semibold leading-tight">
  출근 알람
  <span className="block text-xs font-normal text-gray-400">
    (아이폰 단축어 추가 후 사용가능)
  </span>
</h3>
          <div className="text-xs text-gray-300">
            <b>{who}</b> · <b>{fmtYMD(baseDate)}</b>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-gray-900/60 p-3 text-sm">
        {!inTime ? (
          <div className="text-gray-300">
            패널0의 <b>출근 시각</b>을 전달받지 못했습니다.
            <br />
            <span className="text-xs text-gray-400">
              (props.panel0InDate: Date|string 또는 props.panel0InHM: "HH:MM" 중 하나를 내려주세요)
            </span>
          </div>
        ) : (
          <>
            {/* 요약(범위 기반) */}
            <div className="flex flex-col gap-1">
              <div>
                출근 시각: <b>{fmtHMfromDate(inTime)}</b>
                <span className="text-xs">({fmtYMD(inTime)})</span>
              </div>
              <div className="text-xs text-gray-300">
                범위: <b>{rangeFromMin}분 전</b> ~ <b>{rangeToMin}분 전</b> · 간격{" "}
                <b>{rangeStepMin}분</b>
              </div>
              <div className="text-xs text-gray-300">
  예정 알람: <b>{preview.count}</b>개
  {preview.count > 0 && (
    <>
      {" · "}첫 알람 <b>{fmtHMfromDate(preview.first)}</b>
      {" · "}마지막 <b>{fmtHMfromDate(preview.last)}</b>
    </>
  )}
</div>

            </div>

            {/* 배치 알람 범위: 드롭박스 */}
            <div className="mt-3 grid grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-300">출근 몇 분 전부터</span>
                <select
                  className="bg-gray-800 rounded-lg px-2 py-2"
                  value={rangeFromMin}
                  onChange={(e) => setRangeFromMin(Math.max(0, parseInt(e.target.value, 10) || 0))}
                >
                  {renderOptions(minuteOptions, "분")}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-300">출근 몇 분 전까지</span>
                <select
                  className="bg-gray-800 rounded-lg px-2 py-2"
                  value={rangeToMin}
                  onChange={(e) => setRangeToMin(Math.max(0, parseInt(e.target.value, 10) || 0))}
                >
                  {renderOptions(minuteOptions, "분")}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-300">간격(분)</span>
                <select
                  className="bg-gray-800 rounded-lg px-2 py-2"
                  value={rangeStepMin}
                  onChange={(e) => setRangeStepMin(Math.max(1, parseInt(e.target.value, 10) || 1))}
                >
                  {renderOptions(stepOptions, "분")}
                </select>
              </label>
            </div>

            {/* 하단 버튼: iOS 배치만 */}
            <div className="mt-3 flex flex-wrap gap-2">
              {isIOS() && (
                <button
                  className="px-3 py-2 rounded-xl bg-pink-600 text-white text-sm hover:bg-pink-500 active:scale-[.98] transition disabled:opacity-50"
                  onClick={onIOSAlarmBatch}
                  disabled={!makeHMList().length}
                  title="설정 범위로 여러 개 알람 생성"
                >
                  아이폰 알람 여러개 만들기 (범위)
                </button>
              )}
            </div>

            {/* 미리보기 리스트 */}
            <div className="text-xs text-gray-400 mt-2">
              예정:{" "}
              {makeHMList()
                .map(({ dt }) => `${fmtHMfromDate(dt)}`)
                .join(", ") || "없음"}
            </div>
          </>
        )}
      </div>

      <div className="text-xs text-gray-400">
        * iOS 단축어 이름: <b>교번-알람-만들기</b>
        <br />
        &nbsp;&nbsp;*반드시 ios 단축어 추가 후 해야 실행됩니다*
      </div>
    </div>
  );
}
