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

/* 여러 키 중 첫 유효값 선택 */
const pick = (...vals) =>
  vals.find((v) => v !== undefined && v !== null && v !== "");

/* 느슨한 시각 파서(0830, 8 30, 8시30분, 08-30 등) */
const parseHMLoose = (raw) => {
  if (!raw && raw !== 0) return null;
  const s = String(raw).trim();
  // 0830, 800 등
  if (/^\d{3,4}$/.test(s)) {
    const mm = s.slice(-2);
    const hh = s.slice(0, s.length - 2);
    return {
      hh: Math.min(23, Math.max(0, parseInt(hh, 10) || 0)),
      mm: Math.min(59, Math.max(0, parseInt(mm, 10) || 0)),
    };
  }
  // 8 30, 8:30, 8시30분 등
  const m =
    s.match(/^(\d{1,2})\D{0,2}(\d{1,2})$/) ||
    s.match(/^(\d{1,2})\s*[:시]\s*(\d{1,2})/);
  if (m) {
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10) || 0));
    return { hh, mm };
  }
  return null;
};

/* ISO(+타임존) 포맷: 단축어 AM/PM 오해 방지 */
const fmtISOWithTZ = (d) => {
  const x = toValidDate(d);
  if (!x) return null;
  const pad = (n) => String(n).padStart(2, "0");

  const y = x.getFullYear();
  const M = pad(x.getMonth() + 1);
  const D = pad(x.getDate());
  const H = pad(x.getHours());
  const m = pad(x.getMinutes());
  const s = "00";

  const tzMin = -x.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzMin);
  const tzH = pad(Math.floor(abs / 60));
  const tzM = pad(abs % 60);

  return `${y}-${M}-${D}T${H}:${m}:${s}${sign}${tzH}:${tzM}`;
};

/* platform helpers */
const isIOS = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  return (
    /iP(ad|hone|od)/.test(ua) ||
    (plat === "MacIntel" && navigator.maxTouchPoints > 1)
  );
};

/* Shortcuts URL */
const buildShortcutURL = (name, payload) => {
  const p = encodeURIComponent(JSON.stringify(payload));
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=${p}`;
};

/* =========================
 * persisted settings (localStorage)
 * ========================= */
const LS_KEY = "wakeIcsPanel.v1";
const isBrowser = typeof window !== "undefined";
const BOARD_PRE_OPTIONS = [3, 5, 7, 9, 10, 13, 15, 17, 20, 30]; // 첫차 타기 알람 후보

const clamp = (n, lo, hi, def) =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : def;

const readSaved = () => {
  if (!isBrowser) return null;
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return null;
    const o = JSON.parse(s);
    return {
      from: clamp(o?.from, 0, 720, 120),
      to: clamp(o?.to, 0, 720, 10),
      step: clamp(o?.step, 1, 120, 10),
      boardPreMin: clamp(o?.boardPreMin, 1, 180, 5),
    };
  } catch {
    return null;
  }
};

const writeSaved = (from, to, step, boardPreMin) => {
  if (!isBrowser) return;
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ from, to, step, boardPreMin })
    );
  } catch {}
};

export default function WakeIcsPanel(props) {
  const who = props?.who ?? props?.name ?? "나";
  const baseDate =
    toValidDate(props?.selectedDate ?? props?.date) ?? new Date();

  /* ===== 출근시간 계산 ===== */
  const inTime = React.useMemo(() => {
    // 1) Date 비슷한 값들 먼저
    const dateLike = pick(
      props?.panel0InDate,
      props?.inDate,
      props?.inTimeDate,
      props?.inTs,
      props?.panel0InTs,
      props?.panel0InISOString
    );
    const d1 = toValidDate(dateLike);
    if (d1) return d1;

    // 2) "HH:MM", "0830" 등의 문자열
    const hmRaw = pick(
      props?.panel0InHM,
      props?.inHM,
      props?.startHM,
      props?.in,
      props?.panel0In
    );
    const hm = parseHMLoose(hmRaw) || parseHM(hmRaw);
    if (hm) {
      const base = stripTime(baseDate);
      return new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        hm.hh,
        hm.mm,
        0,
        0
      );
    }
    return null;
  }, [
    props?.panel0InDate,
    props?.inDate,
    props?.inTimeDate,
    props?.inTs,
    props?.panel0InTs,
    props?.panel0InISOString,
    props?.panel0InHM,
    props?.inHM,
    props?.startHM,
    props?.in,
    props?.panel0In,
    baseDate,
  ]);

  /* ===== 범위 알람(출근 N분 전 ~ M분 전, 간격 X분) ===== */
  const MAX_RANGE_MIN = 720;

  const minuteOptions = React.useMemo(() => {
    const arr = [];
    for (let m = 0; m <= MAX_RANGE_MIN; m += 1) arr.push(m);
    return arr;
  }, []);

  const stepOptions = React.useMemo(() => {
    const arr = [];
    for (let m = 1; m <= 120; m += 1) arr.push(m);
    return arr;
  }, []);

  // 초기값 로딩
  const saved = readSaved();
  const [rangeFromMin, setRangeFromMin] = React.useState(saved?.from ?? 120);
  const [rangeToMin, setRangeToMin] = React.useState(saved?.to ?? 10);
  const [rangeStepMin, setRangeStepMin] = React.useState(saved?.step ?? 10);
  const [boardPreMin, setBoardPreMin] = React.useState(saved?.boardPreMin ?? 5);

  // 변경시 저장
  React.useEffect(() => {
    writeSaved(rangeFromMin, rangeToMin, rangeStepMin, boardPreMin);
  }, [rangeFromMin, rangeToMin, rangeStepMin, boardPreMin]);

  // 리스트 생성
  const makeHMList = React.useCallback(() => {
    if (!inTime) return [];

    const from = Math.max(0, Number(rangeFromMin) || 0);
    const to = Math.max(0, Number(rangeToMin) || 0);
    const far = Math.max(from, to);
    const near = Math.min(from, to);

    const startMs = inTime.getTime() - far * 60 * 1000;
    const endMs = inTime.getTime() - near * 60 * 1000;
    const stepMs =
      Math.max(1, Math.floor(Number(rangeStepMin) || 1)) * 60 * 1000;

    const out = [];
    for (let t = startMs; t <= endMs; t += stepMs) {
      const dt = new Date(t);
      out.push({ h: dt.getHours(), m: dt.getMinutes(), ts: t, dt });
    }
    return out;
  }, [inTime, rangeFromMin, rangeToMin, rangeStepMin]);

  const list = React.useMemo(() => makeHMList(), [makeHMList]);

  const preview = React.useMemo(() => {
    if (!list.length) return { count: 0, first: null, last: null };
    return {
      count: list.length,
      first: list[0].dt,
      last: list[list.length - 1].dt,
    };
  }, [list]);

  /* ===== 첫차 타기(+60분) & X분 전 단일 알람 ===== */
  const boardTime = React.useMemo(
    () => (inTime ? new Date(inTime.getTime() + 60 * 60 * 1000) : null),
    [inTime]
  );

  const boardAlarmTime = React.useMemo(() => {
    if (!boardTime) return null;
    const offset = Number.isFinite(boardPreMin) ? boardPreMin : 5;
    return new Date(boardTime.getTime() - offset * 60 * 1000);
  }, [boardTime, boardPreMin]);

  const onIOSBoardOnce = React.useCallback(() => {
    if (!inTime) return alert("기준 시간이 없습니다.");
    if (!isIOS()) return alert("iOS에서만 지원됩니다.");
    if (!boardTime || !boardAlarmTime)
      return alert("유효한 알람 시간이 없습니다.");

    const offset = Number.isFinite(boardPreMin) ? boardPreMin : 5;
    const label = `[${who}] 차타기 ${offset}분 전 (${fmtYMD(boardTime)})`;

    const times = [
      {
        iso: fmtISOWithTZ(boardAlarmTime),
        h: boardAlarmTime.getHours(),
        m: boardAlarmTime.getMinutes(),
        label,
      },
    ];

    const url = buildShortcutURL("교번-알람-만들기", {
      times,
      baseDateIso: fmtISOWithTZ(boardTime),
    });
    window.location.href = url;
  }, [inTime, who, boardTime, boardAlarmTime, boardPreMin]);

  /* ===== iOS 배치 알람 ===== */
  const onIOSAlarmBatch = React.useCallback(() => {
    if (!inTime) return alert("출근 시간이 없습니다.");
    if (!isIOS()) return alert("iOS에서만 지원됩니다.");
    if (!list.length) return alert("설정 범위에 유효한 시간이 없습니다.");

    const label = `[${who}] 기상 (${fmtYMD(inTime)})`;
    const times = list.map(({ dt, h, m }) => ({
      iso: fmtISOWithTZ(dt),
      h,
      m,
      label,
    }));

    const url = buildShortcutURL("교번-알람-만들기", {
      times,
      baseDateIso: fmtISOWithTZ(inTime),
    });
    window.location.href = url;
  }, [inTime, who, list]);

  /* ===== 공통 옵션 렌더 ===== */
  const renderOptions = (values, suffix = "") =>
    values.map((v) => (
      <option key={v} value={v}>
        {v}
        {suffix}
      </option>
    ));

  /* ===== 렌더 ===== */
  return (
    <div className="min-h-full flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h3 className="text-lg font-semibold leading-tight">
            출근 알람 ({who})
            <span className="block text-xs font-normal text-gray-400">
              (아이폰 단축어 추가 후 사용 가능)
            </span>
          </h3>
        </div>

        {/* 단축어 다운 */}
        <a
          href="https://www.icloud.com/shortcuts/f9a1d7ce2f8545768ee494b47bc40a15"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-500 active:scale-[.98] transition"
        >
          단축어 다운받기
        </a>
      </div>

      {/* ===== 출근 알람(배치) 카드 ===== */}
      <div className="rounded-xl bg-gray-900/60 p-3 text-sm">
        {!inTime ? (
          <div className="text-gray-300">
            패널0의 <b>출근 시각</b>을 전달받지 못했습니다.
            <br />
            <span className="text-xs text-gray-400">
              (panel0InDate / panel0InHM 등을 내려주세요)
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <div>
                출근 시각: <b>{fmtHMfromDate(inTime)}</b>
              </div>

              <div className="text-xs text-gray-300">
                범위: <b>{rangeFromMin}분 전</b> ~ <b>{rangeToMin}분 전</b> ·
                간격 <b>{rangeStepMin}분</b>
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

            <div className="mt-3 grid grid-cols-3 gap-3">
              {/* from */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-300">출근 몇 분 전부터</span>
                <div className="relative">
                  <select
                    className="bg-gray-800 text-white rounded-lg px-2 py-2 w-full appearance-none pr-8"
                    value={rangeFromMin}
                    onChange={(e) =>
                      setRangeFromMin(
                        Math.max(0, parseInt(e.target.value, 10) || 0)
                      )
                    }
                  >
                    {renderOptions(minuteOptions, "분")}
                  </select>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white">
                    ▼
                  </span>
                </div>
              </label>

              {/* to */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-300">출근 몇 분 전까지</span>
                <div className="relative">
                  <select
                    className="bg-gray-800 text-white rounded-lg px-2 py-2 w-full appearance-none pr-8"
                    value={rangeToMin}
                    onChange={(e) =>
                      setRangeToMin(
                        Math.max(0, parseInt(e.target.value, 10) || 0)
                      )
                    }
                  >
                    {renderOptions(minuteOptions, "분")}
                  </select>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white">
                    ▼
                  </span>
                </div>
              </label>

              {/* step */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-300">간격(분)</span>
                <div className="relative">
                  <select
                    className="bg-gray-800 text-white rounded-lg px-2 py-2 w-full appearance-none pr-8"
                    value={rangeStepMin}
                    onChange={(e) =>
                      setRangeStepMin(
                        Math.max(1, parseInt(e.target.value, 10) || 1)
                      )
                    }
                  >
                    {renderOptions(stepOptions, "분")}
                  </select>
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white">
                    ▼
                  </span>
                </div>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {isIOS() && (
                <button
                  className="px-3 py-2 rounded-xl bg-pink-600 text-white text-sm hover:bg-pink-500 active:scale-[.98] transition disabled:opacity-50"
                  onClick={onIOSAlarmBatch}
                  disabled={!list.length}
                >
                  아이폰 알람 여러 개 만들기 (범위)
                </button>
              )}
            </div>

            <div className="text-xs text-gray-400 mt-2">
              예정:{" "}
              {list.map(({ dt }) => fmtHMfromDate(dt)).join(", ") || "없음"}
            </div>
          </>
        )}
      </div>

      {/* ===== 첫차 타기(출근+60) X분 전 단일 알람 카드 ===== */}
      <div className="rounded-xl bg-gray-900/60 p-3 text-sm">
        <h4 className="text-base font-semibold mb-2">첫차 타기 알람</h4>
        <span className="block text-xs font-normal text-gray-400">
          후반사업 시작 시간 데이터가 없습니다. 도와주실 분 구합니다
        </span>

        {!inTime ? (
          <div className="text-gray-300">
            기준 시간이 없어 생성할 수 없어요.
            <span className="block text-xs text-gray-400">
              (패널0에서 출근 시각을 먼저 내려주세요)
            </span>
          </div>
        ) : (
          <>
            <div className="text-xs text-gray-300 mb-2">
              차타는 시각:{" "}
              <b>{boardTime ? fmtHMfromDate(boardTime) : "--:--"}</b>
              {" · "}알람:{" "}
              <b>{boardAlarmTime ? fmtHMfromDate(boardAlarmTime) : "--:--"}</b>
            </div>

            <div className="mb-3">
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <span>알람 시각</span>
                <div className="relative">
                  <select
                    className="bg-gray-800 rounded-lg px-2 py-1 pr-7 text-xs appearance-none"
                    value={boardPreMin}
                    onChange={(e) =>
                      setBoardPreMin(Number(e.target.value) || 5)
                    }
                  >
                    {BOARD_PRE_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}분 전
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-lg font-bold">
                    ▾
                  </span>
                </div>
              </label>
            </div>

            <div className="mt-1 flex flex-wrap gap-2">
              {isIOS() ? (
                <button
                  className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm hover:bg-indigo-500 active:scale-[.98] transition"
                  onClick={onIOSBoardOnce}
                >
                  차 타기 {boardPreMin}분 전 알람 만들기 (단일)
                </button>
              ) : (
                <div className="text-xs text-gray-400">
                  * iOS 단축어에서만 지원됩니다.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="text-xs text-gray-400">
        * iOS 단축어 이름: <b>교번-알람-만들기</b>
        <br />
        &nbsp;&nbsp;*반드시 iOS 단축어 추가 후 실행됩니다*
      </div>
    </div>
  );
}
