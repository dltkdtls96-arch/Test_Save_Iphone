// src/components/WakeMidPanel.jsx
import React from "react";
import { getMidAlarmFromZip } from "../dataEngine";

/* ========= helpers ========= */
const _pad2 = (n) => String(n).padStart(2, "0");

const toValidDate = (v) => {
  if (v instanceof Date && !isNaN(v?.getTime?.())) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

const fmtYMD = (d) => {
  const x = toValidDate(d) ?? new Date();
  return `${x.getFullYear()}-${_pad2(x.getMonth() + 1)}-${_pad2(x.getDate())}`;
};

const parseHM = (hm) => {
  if (typeof hm !== "string") return null;
  const m = hm.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, m: mi };
};

// HH:MM 문자열만 남기기 (유효하지 않으면 빈 문자열)
const toHM = (s) => {
  const p = parseHM(String(s || ""));
  return p ? `${_pad2(p.h)}:${_pad2(p.m)}` : "";
};

const dateFromYMDHM = (baseDate, hm) => {
  const x = baseDate instanceof Date ? baseDate : new Date(baseDate);
  const pm = parseHM(hm);
  if (!pm) return null;
  return new Date(x.getFullYear(), x.getMonth(), x.getDate(), pm.h, pm.m, 0, 0);
};

const subMinutes = (date, mins) =>
  new Date(date.getTime() - Math.max(0, Number(mins) || 0) * 60000);

/* ISO(+타임존) — Shortcuts AM/PM 혼동 방지 */
const fmtISOWithTZ = (d) => {
  const x = toValidDate(d);
  if (!x) return null;
  const y = x.getFullYear();
  const M = _pad2(x.getMonth() + 1);
  const D = _pad2(x.getDate());
  const H = _pad2(x.getHours());
  const m = _pad2(x.getMinutes());
  const s = "00";
  const tzMin = -x.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzMin);
  const tzH = _pad2(Math.floor(abs / 60));
  const tzM = _pad2(abs % 60);
  return `${y}-${M}-${D}T${H}:${m}:${s}${sign}${tzH}:${tzM}`;
};

const fmtHMfromDate = (d) => {
  const x = toValidDate(d);
  if (!x) return "--:--";
  return `${_pad2(x.getHours())}:${_pad2(x.getMinutes())}`;
};

const isIOS = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  return (
    /iP(ad|hone|od)/.test(ua) ||
    (plat === "MacIntel" && navigator.maxTouchPoints > 1)
  );
};

const buildShortcutURL = (name, payload) => {
  const p = encodeURIComponent(JSON.stringify(payload));
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=${p}`;
};

/* ========= 콤보 → TSV 중간열 키 ========= */
const pickMidKey = (combo) => {
  const core = String(combo || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim(); // " (야간)" 제거
  switch (core) {
    case "평일":
    case "평":
    case "평-평":
      return "평-평중간";
    case "토요일":
    case "토요":
    case "토":
    case "토-토":
      return "토-토중간";
    case "휴일":
    case "휴":
    case "휴-휴":
      return "휴-휴중간";
    case "평-토":
      return "평-토중간";
    case "평-휴":
      return "평-휴중간";
    case "토-휴":
      return "토-휴중간";
    case "휴-평":
      return "휴-평중간";
    case "휴-토":
      return "휴-토중간";
    default:
      return null;
  }
};

/* ========= 소속별 DIA→중간시각 테이블 =========
 * MID_TABLES[소속][중간열키][diaNumber] = "HH:MM"
 */
const MID_TABLES = {
  안심: {
    "평-평중간": {
      1: "12:23",
      2: "13:09",
      3: "12:39",
      4: "12:13",
      5: "13:33",
      6: "13:01",
      7: "13:03",
      8: "15:27",
      9: "16:57",
      10: "14:21",
      11: "17:03",
      12: "16:13",
      13: "17:21",
      14: "15:41",
      15: "16:21",
      16: "16:45",
      17: "17:19",
      18: "17:48",
      19: "16:55",
      20: "15:43",
      21: "17:27",
      22: "19:30",
      23: "19:53",
      24: "18:40",
      25: "06:39",
      26: "05:22",
      27: "05:35",
      28: "05:45",
      29: "07:06",
      30: "07:17",
      31: "06:23",
      32: "07:21",
      33: "06:54",
      34: "05:30",
      35: "07:08",
      36: "05:51",
      37: "05:30",
    },
    "평-토중간": {
      25: "06:39",
      26: "05:22",
      27: "05:35",
      28: "05:45",
      29: "08:32",
      30: "07:17",
      31: "06:05",
      32: "07:34",
      33: "06:23",
      34: "05:30",
      35: "06:55",
      36: "05:51",
      37: "05:30",
    },
    "평-휴중간": {
      3: "13:26",
      4: "13:36",
      5: "14:20",
      6: "13:50",
      7: "14:00",
      8: "14:51",
      9: "14:36",
      10: "15:35",
      11: "15:51",
      12: "15:59",
      13: "15:22",
      14: "17:46",
      15: "16:39",
      16: "18:07",
      17: "17:45",
      18: "18:02",
      19: "18:45",
      20: "19:48",
      21: "18:18",
      22: "18:30",
      23: "19:34",
      24: "20:04",
      25: "07:57",
      26: "05:22",
      27: "05:35",
      28: "05:45",
      29: "08:15",
      30: "07:17",
      31: "06:05",
      32: "07:35",
      33: "06:23",
      34: "05:30",
      35: "06:41",
      36: "05:51",
      37: "05:30",
    },
    "토-토중간": {
      1: "—",
      2: "—",
      3: "13:26",
      4: "13:36",
      5: "14:20",
      6: "13:50",
      7: "14:00",
      8: "14:51",
      9: "14:36",
      10: "15:35",
      11: "15:51",
      12: "15:59",
      13: "15:22",
      14: "17:46",
      15: "16:39",
      16: "18:07",
      17: "17:45",
      18: "18:02",
      19: "18:45",
      20: "19:48",
      21: "18:18",
      22: "18:30",
      23: "19:34",
      24: "20:04",
    },
    "토-휴중간": {
      25: "07:57",
      26: "05:22",
      27: "05:35",
      28: "05:45",
      29: "08:15",
      30: "07:17",
      31: "06:05",
      32: "07:35",
      33: "06:23",
      34: "05:30",
      35: "06:41",
      36: "05:51",
      37: "05:30",
    },
    "휴-평중간": {
      25: "06:39",
      26: "05:22",
      27: "05:35",
      28: "05:45",
      29: "07:06",
      30: "07:17",
      31: "06:23",
      32: "07:21",
      33: "06:54",
      34: "05:30",
      35: "07:08",
      36: "05:51",
      37: "05:30",
    },
    "휴-토중간": {
      25: "06:39",
      26: "05:22",
      27: "05:35",
      28: "05:45",
      29: "08:32",
      30: "07:17",
      31: "06:05",
      32: "07:34",
      33: "06:23",
      34: "05:30",
      35: "06:55",
      36: "05:51",
      37: "05:30",
    },
    "휴-휴중간": {
      7: "14:57",
      8: "14:30",
      9: "13:34",
      10: "15:37",
      11: "14:54",
      12: "15:45",
      13: "16:09",
      14: "15:34",
      15: "15:42",
      16: "16:06",
      17: "16:17",
      18: "17:02",
      19: "18:35",
      20: "19:11",
      21: "19:29",
      22: "17:18",
      23: "19:47",
      24: "18:14",
      25: "07:57",
      26: "05:22",
      27: "05:35",
      28: "05:45",
      29: "08:15",
      30: "07:17",
      31: "06:05",
      32: "07:35",
      33: "06:23",
      34: "05:30",
      35: "06:41",
      36: "05:51",
      37: "05:30",
    },
  },
  월배: {
    "평-평중간": {},
    "평-토중간": {},
    "평-휴중간": {},
    "토-토중간": {},
    "토-휴중간": {},
    "휴-평중간": {},
    "휴-토중간": {},
    "휴-휴중간": {},
  },
  문양: {
    "평-평중간": {},
    "평-토중간": {},
    "평-휴중간": {},
    "토-토중간": {},
    "토-휴중간": {},
    "휴-평중간": {},
    "휴-토중간": {},
    "휴-휴중간": {},
  },
  경산: {
    "평-평중간": {},
    "평-토중간": {},
    "평-휴중간": {},
    "토-토중간": {},
    "토-휴중간": {},
    "휴-평중간": {},
    "휴-토중간": {},
    "휴-휴중간": {},
  },
};

/* 소속 표기 정규화 */
const normDepot = (s) => {
  const x = String(s || "").trim();
  if (x === "월베" || x === "월배역" || x === "월배지") return "월배";
  if (x === "안심역" || x === "안심지") return "안심";
  if (x === "문양역" || x === "문양지") return "문양";
  if (x === "경산역" || x === "경산지") return "경산";
  return x || "";
};

/* dia 숫자 추출 (예: "28", "28~" → 28 / "대2","휴1" → null) */
const parseDiaNumber = (v) => {
  const m = String(v ?? "")
    .trim()
    .match(/^(\d{1,2})\b/);
  return m ? Number(m[1]) : null;
};

/* 테이블에서 중간시각 조회 */
const lookupMidFromDepot = (selectedDepot, midKey, routeDia) => {
  const depot = MID_TABLES[normDepot(selectedDepot)];
  if (!depot || !midKey) return "";
  const byKey = depot[midKey];
  if (!byKey) return "";
  const n = parseDiaNumber(routeDia);
  if (!n) return "";
  return toHM(byKey[n]);
};

/* ========= 저장소 ========= */
const STORE_KEY = "midAlarm.v1";
const ACC_KEY = "midAccordion.v1";
const defaultCfg = {
  preCarReceiveMin: 5, // 차받기 n분 전
  preMidWorkMin: 40, // 출무 n분 전
  preMidOutMin: 70, // 출고 n분 전
  nightStartMin: 75, // 야간 시작(분전부터)
  nightEndMin: 10, // 야간 끝(분전까지)
  nightStepMin: 5, // 야간 간격
};

const loadCfg = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...defaultCfg, ...JSON.parse(raw) } : defaultCfg;
  } catch {
    return defaultCfg;
  }
};

const saveCfg = (cfg) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  } catch {}
};

const loadAcc = () => {
  try {
    const raw = localStorage.getItem(ACC_KEY);
    return raw
      ? { card1: true, card2: true, ...JSON.parse(raw) }
      : { card1: true, card2: true };
  } catch {
    return { card1: true, card2: true };
  }
};

const saveAcc = (acc) => {
  try {
    localStorage.setItem(ACC_KEY, JSON.stringify(acc));
  } catch {}
};

/* ========= 공통 UI 값 ========= */
// 0~10분 → 1분 단위, 10분 초과 → 5분 단위
const COMPACT_MINUTES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65,
  70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150,
  155, 160, 165, 170, 175, 180,
];
// 야간 시작/끝도 동일 정밀도
const NIGHT_MINUTES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70,
  75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150,
  155, 160, 165, 170, 175, 180,
];
const NIGHT_STEPS = [1, 2, 3, 5, 10, 15];

/* ========= 아코디언 ========= */
function AccordionSection({ id, title, open, onToggle, children }) {
  return (
    <div className="rounded-2xl bg-gray-800">
      <button
        id={`${id}-btn`}
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className="text-sm font-semibold">{title}</span>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-md ${
            open ? "bg-gray-700 text-gray-200" : "bg-gray-700/60 text-gray-300"
          }`}
        >
          {open ? "닫기" : "열기"}
        </span>
      </button>
      <div
        id={id}
        role="region"
        aria-labelledby={`${id}-btn`}
        className={open ? "border-t border-gray-700 p-3" : "hidden"}
      >
        {children}
      </div>
    </div>
  );
}

/* ========= 컴포넌트 ========= */
export default function WakeMidPanel({
  selectedDate,
  selectedDepot, // 소속
  routeCombo, // "평-평" / "토-토" / "휴-휴" / "평-토" ...
  routeDia, // 숫자 또는 "28","대2","휴1" 등
  row, // TSV 1행 객체(중간열 포함)
  shortcutName = "교번-알람-만들기",
  // ─── 새 props: ZIP 기반 중간알람 계산용 ───
  commonData = null, // commonMap[depot key] 객체
  holidaySet = null, // Set<string> "YYYY-MM-DD"
  routeCode = "", // 오늘의 교번 코드 (예: "25d", "4d", "25~")
}) {
  const [cfg, setCfg] = React.useState(loadCfg);
  const [acc, setAcc] = React.useState(loadAcc);

  const setOpen = (k, v) => {
    setAcc((prev) => {
      const next = { ...prev, [k]: v };
      saveAcc(next);
      return next;
    });
  };

  /* ===== 기준시각 계산 ===== */
  const midKey = pickMidKey(routeCombo);

  // 우선순위: 1) ZIP alarm (가장 정확) → 2) row 중간열 → 3) 소속별 하드코딩 테이블
  const [baseHM, baseHMSource] = React.useMemo(() => {
    if (!midKey) return ["", ""];

    // 1) ZIP alarm 기반 (제일 우선)
    if (commonData?.alarms && routeCode) {
      const iso = (() => {
        const d = toValidDate(selectedDate);
        if (!d) return null;
        return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(
          d.getDate()
        )}`;
      })();
      if (iso) {
        const hset = holidaySet instanceof Set ? holidaySet : new Set();
        try {
          const zipRes = getMidAlarmFromZip(commonData, routeCode, iso, hset);
          if (zipRes?.hm && toHM(zipRes.hm)) {
            return [toHM(zipRes.hm), `zip:${zipRes.source}`];
          }
        } catch (err) {
          console.warn("[mid alarm zip]", err);
        }
      }
    }

    // 2) TSV row 중간열 (구 방식)
    const fromRow = toHM(row?.[midKey]);
    if (fromRow) return [fromRow, "row"];

    // 3) 하드코딩 MID_TABLES 폴백
    const fromDepot = lookupMidFromDepot(selectedDepot, midKey, routeDia);
    return [fromDepot || "", fromDepot ? "table" : ""];
  }, [
    midKey,
    row,
    selectedDepot,
    routeDia,
    commonData,
    holidaySet,
    routeCode,
    selectedDate,
  ]);

  const baseDate = React.useMemo(() => {
    const d = dateFromYMDHM(selectedDate, baseHM);
    return d && !isNaN(d) ? d : null;
  }, [selectedDate, baseHM]);

  const disabled = !baseDate;

  const update = (k, v) => {
    const next = { ...cfg, [k]: Number(v) || 0 };
    setCfg(next);
    saveCfg(next);
  };

  /* ===== Shortcuts 호출 (ICS와 동일 포맷) =====
   * payload = {
   *   times: [{ iso, h, m, label }, ...],
   *   baseDateIso
   * }
   */
  const sendToShortcuts = (times, base) => {
    const baseIso = fmtISOWithTZ(base);
    const payload = { times, baseDateIso: baseIso };
    const url = buildShortcutURL(shortcutName, payload);

    if (isIOS()) {
      window.location.href = url;
    } else {
      // iOS가 아니면 JSON 복사
      navigator.clipboard?.writeText(JSON.stringify(payload));
      alert(
        "iOS 기기가 아니면 URL 오픈이 제한될 수 있어 JSON을 클립보드에 복사했어."
      );
    }
  };

  // 라벨 공통 포맷
  const labelPrefix = React.useMemo(() => {
    const depot = normDepot(selectedDepot || "");
    const combo = String(routeCombo || "");
    const diaStr = String(routeDia ?? "");
    return `[중간 ${depot || "-"} ${combo || "-"} ${diaStr || "-"}]`;
  }, [selectedDepot, routeCombo, routeDia]);

  /* ===== 단일 알람(차받기/출무/출고) ===== */
  const onCarReceive = () => {
    if (!baseDate) return;
    const when = subMinutes(baseDate, cfg.preCarReceiveMin);
    const times = [
      {
        iso: fmtISOWithTZ(when),
        h: when.getHours(),
        m: when.getMinutes(),
        label: `${labelPrefix} 차받기 (${fmtYMD(baseDate)})`,
      },
    ];
    sendToShortcuts(times, baseDate);
  };

  const onMidWork = () => {
    if (!baseDate) return;
    const when = subMinutes(baseDate, cfg.preMidWorkMin);
    const times = [
      {
        iso: fmtISOWithTZ(when),
        h: when.getHours(),
        m: when.getMinutes(),
        label: `${labelPrefix} 출무 (${fmtYMD(baseDate)})`,
      },
    ];
    sendToShortcuts(times, baseDate);
  };

  const onMidOut = () => {
    if (!baseDate) return;
    const when = subMinutes(baseDate, cfg.preMidOutMin);
    const times = [
      {
        iso: fmtISOWithTZ(when),
        h: when.getHours(),
        m: when.getMinutes(),
        label: `${labelPrefix} 출고 (${fmtYMD(baseDate)})`,
      },
    ];
    sendToShortcuts(times, baseDate);
  };

  /* ===== 야간 범위(N분전~M분전, step 간격) ===== */
  const onNightRange = () => {
    if (!baseDate) return;
    const start = Math.max(cfg.nightStartMin, cfg.nightEndMin);
    const end = Math.min(cfg.nightStartMin, cfg.nightEndMin);
    const step = Math.max(1, cfg.nightStepMin);

    const arr = [];
    for (let off = start; off >= end; off -= step) {
      const dt = subMinutes(baseDate, off);
      arr.push({
        iso: fmtISOWithTZ(dt),
        h: dt.getHours(),
        m: dt.getMinutes(),
        label: `${labelPrefix} 야간(${off}분 전) (${fmtYMD(baseDate)})`,
      });
    }
    if (!arr.length) return;
    sendToShortcuts(arr, baseDate);
  };

  // 야간 알람 생성 개수 (버튼 라벨용)
  const nightCount = React.useMemo(() => {
    const start = Math.max(cfg.nightStartMin, cfg.nightEndMin);
    const end = Math.min(cfg.nightStartMin, cfg.nightEndMin);
    const step = Math.max(1, cfg.nightStepMin);
    return Math.floor((start - end) / step) + 1;
  }, [cfg.nightStartMin, cfg.nightEndMin, cfg.nightStepMin]);

  return (
    <div className="mt-2 space-y-3 text-sm text-gray-100">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">⏰ 중간 출무 알람</h3>
        <span className="text-[11px] text-gray-300">
          소속: <b>{selectedDepot || "-"}</b> · 패턴: <b>{routeCombo || "-"}</b>{" "}
          · Dia: <b>{String(routeDia ?? "-")}</b>
        </span>
      </div>

      {/* 기준시각 안내 */}
      <div className="rounded-xl bg-gray-900/60 p-3">
        <div>
          기준시각: <b>{baseHM || "데이터 없음"}</b>
        </div>
        {!baseHM && (
          <div className="text-rose-300 text-xs mt-1">
            현재 패턴에 해당하는 “중간” 시간이 비어 있어요. TSV 중간열 또는 소속
            DIA 테이블을 확인하세요.
          </div>
        )}
      </div>

      <AccordionSection
        id="mid-acc-1"
        title="단일 오프셋 알람 (차받기/출무/출고)"
        open={acc.card1}
        onToggle={() => setOpen("card1", !acc.card1)}
      >
        <div className="grid grid-cols-3 gap-3 items-stretch">
          {/* 1) 중간 차받기 */}
          <div className="flex flex-col gap-2 h-full">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-300">차받기 (분전)</span>
              <div className="relative">
                <select
                  className="w-full bg-gray-900 rounded-lg px-2 py-2 pr-8 text-sm appearance-none"
                  value={cfg.preCarReceiveMin}
                  onChange={(e) =>
                    update("preCarReceiveMin", Number(e.target.value) || 0)
                  }
                >
                  {COMPACT_MINUTES.map((v) => (
                    <option key={v} value={v}>
                      {v}분
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-base font-semibold">
                  ▾
                </span>
              </div>
            </label>
            <button
              className="w-full px-3 py-2 rounded-lg bg-cyan-600 text-white text-xs hover:opacity-90 disabled:opacity-50 active:scale-[.98]"
              onClick={onCarReceive}
              disabled={disabled}
              title="중간 차받기 n분 전 알람"
            >
              차받기 알람
            </button>
          </div>

          {/* 2) 중간 출무 */}
          <div className="flex flex-col gap-2 h-full">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-300">출무 (분전)</span>
              <div className="relative">
                <select
                  className="w-full bg-gray-900 rounded-lg px-2 py-2 pr-8 text-sm appearance-none"
                  value={cfg.preMidWorkMin}
                  onChange={(e) =>
                    update("preMidWorkMin", Number(e.target.value) || 0)
                  }
                >
                  {COMPACT_MINUTES.map((v) => (
                    <option key={v} value={v}>
                      {v}분
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-base font-semibold">
                  ▾
                </span>
              </div>
            </label>
            <button
              className="w-full px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs hover:opacity-90 disabled:opacity-50 active:scale-[.98]"
              onClick={onMidWork}
              disabled={disabled}
              title="중간 출무 n분 전 알람"
            >
              출무 알람
            </button>
          </div>

          {/* 3) 중간 출고 */}
          <div className="flex flex-col gap-2 h-full">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-300">출고 (분전)</span>
              <div className="relative">
                <select
                  className="w-full bg-gray-900 rounded-lg px-2 py-2 pr-8 text-sm appearance-none"
                  value={cfg.preMidOutMin}
                  onChange={(e) =>
                    update("preMidOutMin", Number(e.target.value) || 0)
                  }
                >
                  {COMPACT_MINUTES.map((v) => (
                    <option key={v} value={v}>
                      {v}분
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-base font-semibold">
                  ▾
                </span>
              </div>
            </label>
            <button
              className="w-full px-3 py-2 rounded-lg bg-rose-600 text-white text-xs hover:opacity-90 disabled:opacity-50 active:scale-[.98]"
              onClick={onMidOut}
              disabled={disabled}
              title="중간 출고 n분 전 알람"
            >
              출고 알람
            </button>
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        id="mid-acc-2"
        title="🌙 야간 범위 알람 (여러 개 생성)"
        open={acc.card2}
        onToggle={() => setOpen("card2", !acc.card2)}
      >
        <div className="grid grid-cols-3 gap-3 items-stretch">
          {/* 시작 */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-300">시작 (분전부터)</span>
            <div className="relative">
              <select
                className="w-full bg-gray-900 rounded-lg px-2 py-2 pr-8 text-sm appearance-none"
                value={cfg.nightStartMin}
                onChange={(e) =>
                  update("nightStartMin", Number(e.target.value) || 0)
                }
              >
                {NIGHT_MINUTES.map((v) => (
                  <option key={v} value={v}>
                    {v}분
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-base font-semibold">
                ▾
              </span>
            </div>
          </label>

          {/* 끝 */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-300">끝 (분전까지)</span>
            <div className="relative">
              <select
                className="w-full bg-gray-900 rounded-lg px-2 py-2 pr-8 text-sm appearance-none"
                value={cfg.nightEndMin}
                onChange={(e) =>
                  update("nightEndMin", Number(e.target.value) || 0)
                }
              >
                {NIGHT_MINUTES.map((v) => (
                  <option key={v} value={v}>
                    {v}분
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-base font-semibold">
                ▾
              </span>
            </div>
          </label>

          {/* 간격 */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-300">간격 (분)</span>
            <div className="relative">
              <select
                className="w-full bg-gray-900 rounded-lg px-2 py-2 pr-8 text-sm appearance-none"
                value={cfg.nightStepMin}
                onChange={(e) =>
                  update("nightStepMin", Number(e.target.value) || 1)
                }
              >
                {NIGHT_STEPS.map((v) => (
                  <option key={v} value={v}>
                    {v}분
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-base font-semibold">
                ▾
              </span>
            </div>
          </label>

          <div className="col-span-3">
            <button
              className="mt-2 w-full px-3 py-2 rounded-lg bg-orange-600 text-white text-xs hover:opacity-90 disabled:opacity-50 active:scale-[.98]"
              onClick={onNightRange}
              disabled={disabled}
              title="중간 시각 기준으로 야간 범위 알람 여러 개 생성"
            >
              야간 범위 알람 만들기 ({nightCount}개)
            </button>
          </div>
        </div>
      </AccordionSection>

      {/* 예정 알람 시간 미리보기 */}
      {baseDate && (
        <div className="rounded-xl bg-gray-900/60 p-3 text-[11px] text-gray-200 space-y-1">
          <div>예정 알람 시간</div>

          <div>
            차받기 {fmtHMfromDate(subMinutes(baseDate, cfg.preCarReceiveMin))}
          </div>
          <div>
            출무 {fmtHMfromDate(subMinutes(baseDate, cfg.preMidWorkMin))}
          </div>
          <div>
            출고 {fmtHMfromDate(subMinutes(baseDate, cfg.preMidOutMin))}
          </div>

          <div>
            야간 범위 ({nightCount}개){" "}
            {(() => {
              const start = Math.max(cfg.nightStartMin, cfg.nightEndMin);
              const end = Math.min(cfg.nightStartMin, cfg.nightEndMin);
              const step = Math.max(1, cfg.nightStepMin);

              const arr = [];
              for (let m = start; m >= end; m -= step) {
                const t = subMinutes(baseDate, m);
                arr.push(fmtHMfromDate(t));
              }
              return arr.length ? arr.join(", ") : "-";
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
