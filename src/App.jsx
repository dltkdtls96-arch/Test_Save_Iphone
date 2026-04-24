// /project/workspace/src/App.jsx
import React, { useEffect, useMemo, useState, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { AlarmCheckIcon, Route as RouteIcon } from "lucide-react";
import WakeIcsPanel from "./components/WakeIcsPanel";
import WakeMidPanel from "./components/WakeMidPanel";
import "./App.css";
import {
  loadZipToCommonMap,
  loadCommonDataFromDB,
  saveCommonDataToDB,
  saveZipBlobToDB,
  tsvRowsToCommon,
  loadPathsIntoCommon,
  restoreZipHandleFromDB,
  DEPOT_TO_ZIP_KEY,
  rebaseDepotToToday,
  resetAllStorage,
  repairCommonMapFromZipBlob,
} from "./dataEngine";
import SetupWizard from "./components/SetupWizard";
import PersonEditModal from "./components/PersonEditModal";
import { RouteImageView, tsvDiaToRouteCode } from "./components/routeImage";

const SettingsView = React.lazy(() => import("./SettingsView"));

function usePortraitOnly() {
  const getPortrait = () =>
    typeof window !== "undefined"
      ? window.matchMedia?.("(orientation: portrait)")?.matches ??
        window.innerHeight >= window.innerWidth
      : true;
  const [isPortrait, setIsPortrait] = useState(getPortrait);
  useEffect(() => {
    const mm = window.matchMedia?.("(orientation: portrait)");
    const onChange = () => setIsPortrait(getPortrait());
    window.addEventListener("resize", onChange, { passive: true });
    window.addEventListener("orientationchange", onChange, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onChange, { passive: true });
    if (mm?.addEventListener) mm.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
      vv?.removeEventListener("resize", onChange);
      if (mm?.removeEventListener) mm.removeEventListener("change", onChange);
    };
  }, []);
  useEffect(() => {
    if (!isPortrait) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
  }, [isPortrait]);
  return isPortrait;
}

function LandscapeOverlay() {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black text-white"
      style={{ touchAction: "none" }}
    >
      <div className="px-6 py-5 text-center">
        <div className="text-2xl font-semibold mb-2">세로 모드만 지원해요</div>
        <div className="text-sm text-gray-300">기기를 세로로 돌려주세요.</div>
      </div>
    </div>
  );
}

import { createPortal } from "react-dom";
import {
  Calendar as CalendarIcon,
  Settings,
  List,
  User,
  Users,
  Upload,
} from "lucide-react";
import PasswordGate from "./lock/PasswordGate";

const STORAGE_KEY = "workCalendarSettingsV3";

const DEPOTS = ["안심", "월배", "경산", "문양", "교대", "교대(외)"];

const defaultAnchorByDepot = {
  문양: "2025-10-01",
  월배: "2025-11-01",
  안심: "2025-10-01",
  경산: "2025-10-01",
  교대: "2025-09-29",
  "교대(외)": "2025-05-01",
};

const defaultBusMap = {
  안심: "/bus/timetable.png",
  월배: "/bus/wolbus.png",
  경산: "/bus/line2.png",
  문양: "/bus/line2.png",
  교대: "/bus/line2.png",
  "교대(외)": "/bus/line2.png",
};

const toDiaNum = (dia) => {
  const n = Number(dia);
  return Number.isFinite(n) ? n : NaN;
};
const getYesterday = (date) => {
  const t = new Date(date);
  t.setDate(t.getDate() - 1);
  return t;
};

function prevNightTag(yDiaNum, yPrevLabel, threshold) {
  if (Number.isFinite(yDiaNum) && yDiaNum >= threshold) return `${yDiaNum}~`;
  if (typeof yPrevLabel === "string") {
    const clean = yPrevLabel.replace(/\s/g, "").trim();
    const num = Number(clean.replace(/[^0-9]/g, ""));
    const prefix = clean.replace(/[0-9]/g, "");
    if (prefix === "대" && Number.isFinite(num)) return `대${num}~`;
  }
  return "비번";
}

function buildGyodaeTable() {
  const header =
    "순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근";
  const DAY_IN = "09:00",
    DAY_OUT = "18:00",
    NIGHT_IN = "18:00",
    NIGHT_OUT = "09:00";
  const rows = [];
  for (let i = 1; i <= 21; i++) {
    const isDay = i <= 7;
    const isNight = !isDay && (i - 8) % 2 === 0;
    const dia = isDay ? "주" : isNight ? "야" : "휴";
    let name = "";
    if (i === 1) name = "갑반";
    if (i === 8) name = "을반";
    if (i === 15) name = "병반";
    let wdIn = "",
      wdOut = "",
      saIn = "",
      saOut = "",
      hoIn = "",
      hoOut = "";
    if (dia === "주") {
      wdIn = saIn = hoIn = DAY_IN;
      wdOut = saOut = hoOut = DAY_OUT;
    } else if (dia === "야") {
      wdIn = saIn = hoIn = NIGHT_IN;
      wdOut = saOut = hoOut = NIGHT_OUT;
    }
    rows.push([i, name, dia, wdIn, wdOut, saIn, saOut, hoIn, hoOut].join("\t"));
  }
  return [header, ...rows].join("\n");
}

function buildGyodaeExtTable() {
  const header =
    "순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근";
  const D_IN = "07:30",
    D_OUT = "19:00",
    N_IN = "18:30",
    N_OUT = "08:00";
  const rows = [
    [1, "A조", "주", D_IN, D_OUT, D_IN, D_OUT, D_IN, D_OUT],
    [2, "", "주", D_IN, D_OUT, D_IN, D_OUT, D_IN, D_OUT],
    [3, "B조", "야", N_IN, N_OUT, N_IN, N_OUT, N_IN, N_OUT],
    [4, "", "야", N_IN, N_OUT, N_IN, N_OUT, N_IN, N_OUT],
    [5, "C조", "비", "", "", "", "", "", ""],
    [6, "", "휴", "", "", "", "", "", ""],
  ];
  return [header, ...rows.map((r) => r.join("\t"))].join("\n");
}

// 기본 TSV 데이터 (기존과 동일하게 유지)
const defaultTableTSV = ``;

const SHUTTLE_HM = {};

function toHMorNull(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const hh = +m[1],
    mm = +m[2];
  if (hh < 0 || hh > 23) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function normalizeHM(v) {
  const s = String(v ?? "").trim();
  const hm = toHMorNull(s);
  if (hm) return hm;
  const mapped = SHUTTLE_HM[s.toLowerCase()];
  return mapped ? toHMorNull(mapped) : null;
}
function fmt(d) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
function fmtWithWeekday(date) {
  const tz = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tz);
  const iso = local.toISOString().slice(0, 10);
  const weekday = weekdaysKR[(local.getDay() + 6) % 7];
  return `${iso} (${weekday})`;
}
function stripTime(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function diffDays(a, b) {
  return Math.floor((stripTime(a) - stripTime(b)) / 86400000);
}
function mod(n, m) {
  return ((n % m) + m) % m;
}
function addMonthsSafe(date, months) {
  const d = new Date(date);
  const cm = d.getMonth() + months;
  d.setMonth(cm);
  if (d.getMonth() !== ((cm % 12) + 12) % 12) d.setDate(0);
  return d;
}
function addDaysSafe(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return stripTime(d);
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthGridSunday(date) {
  const y = date.getFullYear(),
    m = date.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(stripTime(d));
  }
  return cells;
}

const weekdaysKR = ["월", "화", "수", "목", "금", "토", "일"];
function startOfWeekMonday(d) {
  const day = (d.getDay() + 6) % 7;
  const x = new Date(d);
  x.setDate(d.getDate() - day);
  return x;
}
function monthGridMonday(selectedDate) {
  const start = startOfMonth(selectedDate);
  const firstMon = startOfWeekMonday(start);
  const days = [];
  let cur = new Date(firstMon);
  for (let i = 0; i < 42; i++) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const DEFAULT_HOLIDAYS_25_26 = `2025-01-01
2025-01-28
2025-01-29
2025-01-30
2025-03-01
2025-03-03
2025-05-05
2025-06-06
2025-08-15
2025-10-03
2025-10-05
2025-10-06
2025-10-07
2025-10-09
2025-12-25
2026-01-01
2026-02-16
2026-02-17
2026-02-18
2026-03-01
2026-03-02
2026-05-05
2026-05-24
2026-05-25
2026-06-06
2026-08-15
2026-08-17
2026-09-24
2026-09-25
2026-09-26
2026-09-27
2026-10-03
2026-10-05
2026-10-09
2026-12-25`.trim();

function getDayType(date, holidaySet) {
  const dow = date.getDay();
  if (holidaySet.has(fmt(date))) return "휴";
  if (dow === 0) return "휴";
  if (dow === 6) return "토";
  return "평";
}

function parsePeopleTable(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(delim).map((s) => s.trim());
  const idx = (k) =>
    header.findIndex((h) => h.replace(/\s/g, "") === k.replace(/\s/g, ""));
  const iSeq = idx("순번"),
    iName = idx("이름"),
    iDia = idx("dia");
  const iWdIn = idx("평일출근"),
    iWdOut = idx("평일퇴근");
  const iSaIn = idx("토요일출근"),
    iSaOut = idx("토요일퇴근");
  const iHoIn = idx("휴일출근"),
    iHoOut = idx("휴일퇴근");
  const iPhone =
    idx("전화번호") >= 0
      ? idx("전화번호")
      : idx("전화") >= 0
      ? idx("전화")
      : idx("휴대폰") >= 0
      ? idx("휴대폰")
      : idx("phone");
  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(delim);
    const diaRaw = (cols[iDia] || "").trim();
    const dia = /^\d+$/.test(diaRaw) ? Number(diaRaw) : diaRaw;
    rows.push({
      seq: (cols[iSeq] || "").trim(),
      name: (cols[iName] || "").trim(),
      dia,
      phone: iPhone >= 0 ? (cols[iPhone] || "").trim() : "",
      weekday: {
        in: (cols[iWdIn] || "").trim(),
        out: (cols[iWdOut] || "").trim(),
      },
      saturday: {
        in: (cols[iSaIn] || "").trim(),
        out: (cols[iSaOut] || "").trim(),
      },
      holiday: {
        in: (cols[iHoIn] || "").trim(),
        out: (cols[iHoOut] || "").trim(),
      },
    });
  }
  return rows;
}

function buildNameIndexMap(rows) {
  const m = new Map();
  rows.forEach((r, i) => {
    if (r.name) m.set(r.name, i);
  });
  return m;
}

// ─────────────────────────────────────────────
//  야간 판정 — worktime 기반 (threshold 폐기)
//
//  원칙:
//   • row.weekday/saturday/holiday 의 out 이 비어있으면 → 야간 출근
//   • row.*.in 이 비어있으면 → 야간에서 이어진 비번 자리 ("N~")
//   • 야간일 때 실제 퇴근 시간은 row.weekdayNext/saturdayNext/holidayNext
//     (= 다음 자리 교번의 worktime.out)
//
//  교대/교대(외) (TSV 기반) 는 dia 가 "주"/"야"/"비"/"휴" 라벨이라
//  아래 라벨 분기에서 먼저 처리됨 — worktime 자동 판정 대상 아님.
// ─────────────────────────────────────────────
function getDaySrc(row, date, holidaySet) {
  const tType = getDayType(date, holidaySet);
  const src =
    tType === "평" ? row.weekday : tType === "토" ? row.saturday : row.holiday;
  const next =
    tType === "평"
      ? row.weekdayNext
      : tType === "토"
      ? row.saturdayNext
      : row.holidayNext;
  return { tType, src: src || { in: "", out: "" }, next: next || null };
}

function computeInOut(row, date, holidaySet /* , nightDiaThreshold (무시) */) {
  if (!row)
    return {
      in: "-",
      out: "-",
      note: "데이터 없음",
      combo: "-",
      isNight: false,
    };

  // ── 라벨 기반 (교대/교대(외) TSV) ──
  if (typeof row.dia === "string") {
    const label = row.dia;
    const clean = label.replace(/\s/g, "");
    if (clean.includes("비번") || clean === "비")
      return { in: "-", out: "-", note: "비번", combo: "-", isNight: false };
    if (clean.startsWith("휴"))
      return { in: "-", out: "-", note: "휴무", combo: "-", isNight: false };
    if (label === "교육" || label === "휴가")
      return { in: "-", out: "-", note: label, combo: "-", isNight: false };
    if (label === "주" || label === "야") {
      const { tType, src } = getDaySrc(row, date, holidaySet);
      const isNight = label === "야";
      return {
        in: src.in || "-",
        out: src.out || "-",
        note: `${tType}${isNight ? " (야간)" : ""}`,
        combo: tType,
        isNight,
      };
    }
    // "N~" 형태 라벨 — 비번 자리
    if (/~$/.test(clean))
      return { in: "-", out: "-", note: "비번", combo: "-", isNight: false };
    // "대N" — 아래 worktime 로직으로 떨어뜨려서 자동 판정
  }

  // ── worktime 기반 자동 야간 판정 (ZIP 기지 전부 + 대N 포함) ──
  const { tType, src, next } = getDaySrc(row, date, holidaySet);

  // out 비었고 in 차있음 → 야간 출근
  const outEmpty = !src.out;
  const inEmpty = !src.in;

  if (outEmpty && !inEmpty) {
    // 야간. 퇴근 시간은 다음 자리 worktime.out 에서 가져오되, 다음날 dayType 기준.
    const tomorrow = new Date(date);
    tomorrow.setDate(date.getDate() + 1);
    const tomorrowType = getDayType(tomorrow, holidaySet);
    const nextSrc =
      tomorrowType === "평"
        ? row.weekdayNext
        : tomorrowType === "토"
        ? row.saturdayNext
        : row.holidayNext;
    const nightOut = nextSrc?.out || next?.out || "";
    const noteLabel =
      typeof row.dia === "string" && row.dia.startsWith("대")
        ? "대근·야간"
        : "야간";
    return {
      in: src.in,
      out: nightOut || "-",
      note: `${noteLabel} (${tType}-${tomorrowType})`,
      combo: `${tType}-${tomorrowType}`,
      isNight: true,
    };
  }

  // in 비었음 → 비번 자리 (야간 다음날). 출퇴근 표시 없음.
  if (inEmpty && !outEmpty) {
    return { in: "-", out: "-", note: "비번", combo: "-", isNight: false };
  }

  // 둘 다 비었거나 둘 다 차있으면 일반 주간.
  const noteLabel =
    typeof row.dia === "string" && row.dia.startsWith("대") ? "대근" : "";
  return {
    in: src.in || "-",
    out: src.out || "-",
    note: noteLabel ? `${noteLabel}·${tType}` : tType,
    combo: tType,
    isNight: false,
  };
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result || ""));
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function useDaySwipeHandlers() {
  const ref = React.useRef(null);
  const [dragX, setDragX] = React.useState(0);
  const [snapping, setSnapping] = React.useState(false);
  const stateRef = React.useRef({ x: 0, y: 0, lock: null });
  const lastRef = React.useRef({ x: 0, t: 0 });
  const TH = 40,
    VEL = 0.35,
    ACT = 14,
    DIR = 1.25,
    SNAP = 280;
  const onStart = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    stateRef.current = { x: t.clientX, y: t.clientY, lock: null };
    lastRef.current = { x: t.clientX, t: performance.now() };
    setSnapping(false);
    setDragX(0);
  };
  const onMove = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    const dx = t.clientX - stateRef.current.x,
      dy = t.clientY - stateRef.current.y;
    if (stateRef.current.lock === null) {
      if (Math.abs(dx) > Math.abs(dy) * DIR && Math.abs(dx) > ACT)
        stateRef.current.lock = "h";
      else if (Math.abs(dy) > Math.abs(dx) * DIR && Math.abs(dy) > ACT)
        stateRef.current.lock = "v";
    }
    if (stateRef.current.lock === "h") {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation?.();
      setDragX(dx);
      lastRef.current = { x: t.clientX, t: performance.now() };
    }
  };
  const onEnd = (onPrev, onNext) => (e) => {
    if (stateRef.current.lock !== "h") {
      setDragX(0);
      return;
    }
    const t = e.changedTouches[0];
    const now = performance.now(),
      dt = Math.max(1, now - lastRef.current.t);
    const vx = (t.clientX - lastRef.current.x) / dt;
    const dx = t.clientX - stateRef.current.x;
    const width = ref.current?.offsetWidth || window.innerWidth;
    const goNext = dx < 0 && (Math.abs(dx) > TH || Math.abs(vx) > VEL);
    const goPrev = dx > 0 && (Math.abs(dx) > TH || Math.abs(vx) > VEL);
    setSnapping(true);
    if (goNext) {
      setDragX(-width);
      setTimeout(() => {
        onNext?.();
        setSnapping(false);
        setDragX(0);
      }, SNAP);
    } else if (goPrev) {
      setDragX(width);
      setTimeout(() => {
        onPrev?.();
        setSnapping(false);
        setDragX(0);
      }, SNAP);
    } else {
      setDragX(0);
      setTimeout(() => setSnapping(false), SNAP);
    }
    stateRef.current = { x: 0, y: 0, lock: null };
  };
  const style = {
    transform: `translateX(${dragX}px)`,
    transition: snapping ? `transform ${SNAP}ms ease-out` : "none",
    willChange: "transform",
  };
  return { ref, onStart, onMove, onEnd, style };
}

/* ===========================================
 * App
 * ===========================================*/
export default function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved === "dark" || saved === "light" ? saved : "dark";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const [selectedTab, setSelectedTab] = useState("home");
  const [orderMode, setOrderMode] = useState("person");
  const today = stripTime(new Date());
  const [selectedDate, setSelectedDate] = useState(today);

  const goPrevDay = () => {
    flushSync(() => setSelectedDate((d) => addDaysSafe(d, -1)));
    setAltView(false);
  };
  const goNextDay = () => {
    flushSync(() => setSelectedDate((d) => addDaysSafe(d, 1)));
    setAltView(false);
  };

  const [tempName, setTempName] = useState("");
  const gridWrapRef = React.useRef(null);
  const [dragX, setDragX] = useState(0);
  const [isSnapping, setIsSnapping] = useState(false);
  const [selectedDepot, setSelectedDepot] = useState("안심");
  const [overridesByDepot, setOverridesByDepot] = useState({});
  const [dutyModal, setDutyModal] = useState({
    open: false,
    date: null,
    name: null,
  });

  // ── 새 추가: commonMap, SetupWizard ──
  const [commonMap, setCommonMap] = useState(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  // ── 근무자 편집 모달 (이름 + 교번 동시) ──
  const [personEditModal, setPersonEditModal] = useState({
    open: false,
    oldName: "",
    oldCode: "",
    // 되돌리기용 메타
    baseName: "", // override 적용 전 원본 이름
    baseCode: "", // override 적용 전 원본 교번
    hasTodayCode: false, // 오늘 교번 override 걸려있는지
    hasTodayName: false, // 오늘 이름 override 걸려있는지
  });
  const [rosterEditMode, setRosterEditMode] = useState(false);

  // 이름 override (오늘 하루만): { depot: { iso: { oldName: newName } } }
  const [nameOverridesByDepot, setNameOverridesByDepot] = useState({});

  function setOverride(depot, dateObj, name, value) {
    const iso = fmt(stripTime(new Date(dateObj)));
    setOverridesByDepot((prev) => {
      const depotMap = { ...(prev?.[depot] || {}) };
      const dayMap = { ...(depotMap[iso] || {}) };
      if (value == null) delete dayMap[name];
      else dayMap[name] = value;
      return { ...prev, [depot]: { ...depotMap, [iso]: dayMap } };
    });
  }

  function applyOverrideToRow(row, depot, dateObj, name) {
    const iso = fmt(stripTime(new Date(dateObj)));
    const vRaw = overridesByDepot?.[depot]?.[iso]?.[name];
    if (vRaw == null || vRaw === "") return row;

    // 값 정규화: 공백 제거
    const v = String(vRaw).replace(/\s+/g, "");

    const patched = { ...(row || {}) };
    const applyTemplate = (tpl) => {
      if (!tpl) return;
      patched.weekday = { ...tpl.weekday };
      patched.saturday = { ...tpl.saturday };
      patched.holiday = { ...tpl.holiday };
    };

    // 1) 휴/비번/비/교육/휴가
    if (
      v === "휴" ||
      v === "비번" ||
      v === "비" ||
      v === "교육" ||
      v === "휴가"
    ) {
      const key = v === "비" ? "비번" : v;
      patched.dia = key;
      applyTemplate(labelTemplates[key]);
      return patched;
    }

    // 2) 주/야
    if (v === "주" || v === "야") {
      patched.dia = v;
      applyTemplate(labelTemplates[v]);
      return patched;
    }

    // 3) 대기N (대N 정규식에 걸리기 전 먼저 검사)
    if (/^대기\d+$/.test(v)) {
      patched.dia = v;
      applyTemplate(labelTemplates[v]);
      return patched;
    }

    // 4) 대N
    if (/^대\d+$/.test(v)) {
      const n = Number(v.replace(/[^0-9]/g, ""));
      const key = `대${n}`;
      patched.dia = key;
      applyTemplate(labelTemplates[key] || diaTemplates[n]);
      return patched;
    }

    // 5) 숫자 + d/D  (소문자 "1d", 대문자 "1D" 모두 허용)
    if (/^\d+[dD]$/.test(v)) {
      const n = Number(v.replace(/[dD]$/, ""));
      if (Number.isFinite(n)) {
        patched.dia = n;
        applyTemplate(diaTemplates[n]);
      }
      return patched;
    }

    // 6) 순수 숫자 "1", "12"
    if (/^\d+$/.test(v)) {
      const n = Number(v);
      if (Number.isFinite(n)) {
        patched.dia = n;
        applyTemplate(diaTemplates[n]);
      }
      return patched;
    }

    // 7) 그 외 문자열 라벨이 labelTemplates에 있으면 사용
    if (labelTemplates[v]) {
      patched.dia = v;
      applyTemplate(labelTemplates[v]);
      return patched;
    }

    // 알 수 없는 값 — 최소한 dia 문자열만 갱신
    patched.dia = vRaw;
    return patched;
  }

  function rowAtDateForNameWithOverride(name, dateObj) {
    const base = rowAtDateForName(name, dateObj);
    return applyOverrideToRow(base, selectedDepot, dateObj, name);
  }

  function hasOverride(depot, dateObj, name) {
    const iso = fmt(stripTime(new Date(dateObj)));
    return !!overridesByDepot?.[depot]?.[iso]?.[name];
  }

  // ── 이름 편집 헬퍼 ──
  //
  // displayName: row에 적용된 이름 override 해석
  //   오늘 하루만 "홍길동 → 박영희" override가 있으면 displayName("홍길동", today) === "박영희"
  function displayName(name, dateObj) {
    const iso = fmt(stripTime(new Date(dateObj)));
    const v = nameOverridesByDepot?.[selectedDepot]?.[iso]?.[name];
    return v || name;
  }

  function hasNameOverride(depot, dateObj, name) {
    const iso = fmt(stripTime(new Date(dateObj)));
    return !!nameOverridesByDepot?.[depot]?.[iso]?.[name];
  }

  // 영구 개명/교환:
  //   newName 이 기존에 없는 이름이면  → 단순 개명 (names[idx] = newName)
  //   newName 이 기존 인물이면         → swap (두 사람 자리 교환)
  async function applyPermanentRename(oldNameIn, newNameIn) {
    // 입력 정규화: 앞뒤 공백 제거 + 중간 다중 공백 축약
    const clean = (s) =>
      String(s || "")
        .replace(/\s+/g, " ")
        .trim();
    const oldName = clean(oldNameIn);
    const newName = clean(newNameIn);
    if (!oldName || !newName) return;

    const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
    const common = commonMap?.[key];
    if (!common?.names) return;

    // 비교용 정규화 (공백 전부 제거 + 소문자)
    const norm = (s) =>
      String(s || "")
        .replace(/\s+/g, "")
        .toLowerCase();
    const oldKey = norm(oldName);
    const newKey = norm(newName);

    // 실질적으로 같은 이름이면 단순 trim 업데이트 후 리턴
    if (oldKey === newKey) {
      // 공백/대소문자만 다른 경우 → names 엔트리 표기 정리
      const idx = common.names.findIndex((n) => norm(n) === oldKey);
      if (idx >= 0 && common.names[idx] !== newName) {
        const newNames = [...common.names];
        newNames[idx] = newName;
        const nextMap = { ...commonMap, [key]: { ...common, names: newNames } };
        setCommonMap(nextMap);
        try {
          await saveCommonDataToDB(nextMap);
        } catch {}
      }
      return;
    }

    // oldName 위치 찾기
    const idxACandidates = common.names
      .map((n, i) => ({ n, i }))
      .filter((x) => norm(x.n) === oldKey);
    if (idxACandidates.length === 0) return;
    if (idxACandidates.length > 1) {
      // 동명이인인 oldName이 여러 명 — 가장 가까운 위치를 특정할 수 없으니 중단
      console.warn(
        `[applyPermanentRename] "${oldName}" 동명이인 ${idxACandidates.length}명 — 처리 중단`
      );
      alert(
        `"${oldName}" 이름을 가진 사람이 ${idxACandidates.length}명입니다.\n` +
          `중복을 먼저 정리한 후 다시 시도해주세요.`
      );
      return;
    }
    const idxA = idxACandidates[0].i;

    // newName 매칭 찾기 (본인 제외)
    const idxBCandidates = common.names
      .map((n, i) => ({ n, i }))
      .filter((x) => norm(x.n) === newKey && x.i !== idxA);

    if (idxBCandidates.length > 1) {
      alert(
        `"${newName}" 이름을 가진 사람이 여러 명입니다.\n자리 교환 대상을 특정할 수 없습니다.`
      );
      return;
    }
    const idxB = idxBCandidates.length === 1 ? idxBCandidates[0].i : -1;
    const isSwap = idxB >= 0;

    const newNames = [...common.names];
    const oldPhones = common.phones || [];
    const newPhones = [...oldPhones];

    if (isSwap) {
      newNames[idxA] = common.names[idxB];
      newNames[idxB] = common.names[idxA];
      if (oldPhones.length === common.names.length) {
        newPhones[idxA] = oldPhones[idxB] || "";
        newPhones[idxB] = oldPhones[idxA] || "";
      }
    } else {
      newNames[idxA] = newName;
    }

    const nextMap = {
      ...commonMap,
      [key]: { ...common, names: newNames, phones: newPhones },
    };
    setCommonMap(nextMap);
    try {
      await saveCommonDataToDB(nextMap);
    } catch {}

    // TSV 동기화
    setTablesByDepot((prev) => {
      const tsv = prev?.[selectedDepot];
      if (!tsv) return prev;
      const lines = tsv.split(/\r?\n/);
      if (isSwap) {
        const aLine = idxA + 1;
        const bLine = idxB + 1;
        if (lines.length > Math.max(aLine, bLine)) {
          const aCols = lines[aLine].split("\t");
          const bCols = lines[bLine].split("\t");
          if (aCols.length >= 2 && bCols.length >= 2) {
            const tmp = aCols[1];
            aCols[1] = bCols[1];
            bCols[1] = tmp;
            lines[aLine] = aCols.join("\t");
            lines[bLine] = bCols.join("\t");
            return { ...prev, [selectedDepot]: lines.join("\n") };
          }
        }
      } else {
        if (lines.length > idxA + 1) {
          const cols = lines[idxA + 1].split("\t");
          if (cols.length >= 2) {
            cols[1] = newName;
            lines[idxA + 1] = cols.join("\t");
            return { ...prev, [selectedDepot]: lines.join("\n") };
          }
        }
      }
      return prev;
    });

    // ── override 이관 ──
    // 실제 저장된 names[idxA]/names[idxB] 를 키로 사용
    const actualOldName = common.names[idxA];
    const actualNewName = isSwap ? common.names[idxB] : newName;

    // 교번 override
    setOverridesByDepot((prev) => {
      const depotMap = prev?.[selectedDepot];
      if (!depotMap) return prev;
      const nextDepotMap = { ...depotMap };
      let changed = false;
      Object.keys(nextDepotMap).forEach((iso) => {
        const dayMap = nextDepotMap[iso];
        if (!dayMap) return;
        const hasOld = Object.prototype.hasOwnProperty.call(
          dayMap,
          actualOldName
        );
        const hasNew = Object.prototype.hasOwnProperty.call(
          dayMap,
          actualNewName
        );
        if (!hasOld && !hasNew) return;
        const nextDay = { ...dayMap };
        if (isSwap) {
          const a = hasOld ? dayMap[actualOldName] : undefined;
          const b = hasNew ? dayMap[actualNewName] : undefined;
          if (hasOld) delete nextDay[actualOldName];
          if (hasNew) delete nextDay[actualNewName];
          if (a !== undefined) nextDay[actualNewName] = a;
          if (b !== undefined) nextDay[actualOldName] = b;
        } else {
          if (hasOld) {
            nextDay[actualNewName] = dayMap[actualOldName];
            delete nextDay[actualOldName];
          }
        }
        if (Object.keys(nextDay).length === 0) delete nextDepotMap[iso];
        else nextDepotMap[iso] = nextDay;
        changed = true;
      });
      return changed ? { ...prev, [selectedDepot]: nextDepotMap } : prev;
    });

    // 이름 override: 두 이름 모두 해제
    setNameOverridesByDepot((prev) => {
      const depotMap = prev?.[selectedDepot];
      if (!depotMap) return prev;
      const nextDepotMap = { ...depotMap };
      let changed = false;
      Object.keys(nextDepotMap).forEach((iso) => {
        const dayMap = nextDepotMap[iso];
        if (!dayMap) return;
        const hasOld = Object.prototype.hasOwnProperty.call(
          dayMap,
          actualOldName
        );
        const hasNew = Object.prototype.hasOwnProperty.call(
          dayMap,
          actualNewName
        );
        if (!hasOld && !hasNew) return;
        const nextDay = { ...dayMap };
        delete nextDay[actualOldName];
        delete nextDay[actualNewName];
        if (Object.keys(nextDay).length === 0) delete nextDepotMap[iso];
        else nextDepotMap[iso] = nextDay;
        changed = true;
      });
      return changed ? { ...prev, [selectedDepot]: nextDepotMap } : prev;
    });

    // 내 이름/행로 대상 연동
    if (!isSwap) {
      if (myName === actualOldName) setMyNameForDepot(selectedDepot, newName);
      if (routeTargetName === actualOldName) setRouteTargetName(newName);
    }
  }

  // 오늘 하루만: nameOverridesByDepot 에 저장
  function applyTodayRename(oldNameIn, newNameIn, dateObj) {
    const clean = (s) =>
      String(s || "")
        .replace(/\s+/g, " ")
        .trim();
    const oldName = clean(oldNameIn);
    const newName = clean(newNameIn);
    const norm = (s) =>
      String(s || "")
        .replace(/\s+/g, "")
        .toLowerCase();
    const iso = fmt(stripTime(new Date(dateObj)));
    setNameOverridesByDepot((prev) => {
      const depotMap = { ...(prev?.[selectedDepot] || {}) };
      const dayMap = { ...(depotMap[iso] || {}) };
      // 실질적으로 같은 이름이면 override 해제
      if (!newName || norm(newName) === norm(oldName)) {
        delete dayMap[oldName];
      } else {
        dayMap[oldName] = newName;
      }
      if (Object.keys(dayMap).length === 0) delete depotMap[iso];
      else depotMap[iso] = dayMap;
      return { ...prev, [selectedDepot]: depotMap };
    });
  }

  const defaultAnchorMap = useMemo(
    () =>
      Object.fromEntries(
        DEPOTS.map((d) => [d, d === "안심" ? "2025-10-01" : fmt(today)])
      ),
    []
  );
  const [anchorDateByDepot, setAnchorDateByDepot] = useState(defaultAnchorMap);
  const anchorDateStr = anchorDateByDepot[selectedDepot] ?? fmt(today);
  const anchorDate = useMemo(
    () => stripTime(new Date(anchorDateStr)),
    [anchorDateStr]
  );
  const setAnchorDateStrForDepot = (depot, value) =>
    setAnchorDateByDepot((prev) => ({ ...prev, [depot]: value }));

  const [tablesByDepot, setTablesByDepot] = useState({
    안심: "",
    월배: "",
    경산: "",
    문양: "",
    교대: buildGyodaeTable(),
    "교대(외)": buildGyodaeExtTable(),
  });

  // 변경 후 — commonMap 우선, 없으면 tablesByDepot 폴백
  const currentTableText = useMemo(
    () => tablesByDepot[selectedDepot] ?? "",
    [tablesByDepot, selectedDepot]
  );

  // commonMap에서 직접 rows 생성 (ZIP/TSV 모두 커버)
  //
  //  🌙 야간 판정 & 퇴근 시간 이어붙이기 (threshold 로직 폐기):
  //   각 교번의 worktime 이 "HH:MM -" 형태(퇴근 비어있음)이면 "야간 출근"이고,
  //   그 사람의 실제 퇴근 시간은 **다음 교번(= 다음 자리의 사람)의 worktime.out** 이다.
  //   보통 다음 자리 교번은 "N~" 형태로 in 이 비어있고 out 만 있음.
  //
  //   → row 에 weekdayNext/saturdayNext/holidayNext (다음 자리 worktime) 을 넣어두고
  //     computeInOut 에서 "오늘 out 비어있으면 야간 → next out 사용" 으로 판정.
  const peopleRows = useMemo(() => {
    const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
    const common = commonMap?.[key];
    if (common?.names?.length && common?.gyobun?.length) {
      const splitWT = (wt) => {
        const s = String(wt || "").replace(/\s/g, "");
        if (!s || s === "----") return { in: "", out: "" };
        const parts = s.split("-");
        return { in: parts[0] || "", out: parts[1] || "" };
      };
      const wtFor = (code) => {
        const k = String(code || "")
          .trim()
          .toLowerCase();
        return {
          weekday: splitWT(common.worktime?.nor?.[k] || "----"),
          saturday: splitWT(common.worktime?.sat?.[k] || "----"),
          holiday: splitWT(common.worktime?.hol?.[k] || "----"),
        };
      };
      const len = common.names.length;
      return common.names.map((name, i) => {
        const code = common.gyobun[i] || "";
        const wt = wtFor(code);
        // 다음 자리 (= 다음 사람) 의 worktime — 오늘 야간이라면 내 퇴근 시간은 여기에 있음
        const nextCode = common.gyobun[(i + 1) % len] || "";
        const wtNext = wtFor(nextCode);
        const dia = /^\d+d$/i.test(code)
          ? Number(code.replace(/d$/i, ""))
          : code;
        return {
          seq: String(i + 1),
          name,
          dia,
          phone: common.phones?.[i] || "",
          weekday: wt.weekday,
          saturday: wt.saturday,
          holiday: wt.holiday,
          // 야간 판정 전용 — 다음 자리 worktime
          weekdayNext: wtNext.weekday,
          saturdayNext: wtNext.saturday,
          holidayNext: wtNext.holiday,
        };
      });
    }
    // 폴백: 기존 TSV 파싱 (교대 계열은 label 기반이라 next 불필요)
    return parsePeopleTable(currentTableText);
  }, [commonMap, selectedDepot, currentTableText]);

  const nameIndexMap = useMemo(
    () => buildNameIndexMap(peopleRows),
    [peopleRows]
  );
  const nameList = useMemo(
    () => peopleRows.map((r) => r.name).filter(Boolean),
    [peopleRows]
  );

  const diaTemplates = React.useMemo(() => {
    const map = {};
    peopleRows.forEach((r) => {
      const n = Number(r?.dia);
      if (Number.isFinite(n) && !map[n])
        map[n] = {
          weekday: { ...r.weekday },
          saturday: { ...r.saturday },
          holiday: { ...r.holiday },
        };
    });
    return map;
  }, [peopleRows]);

  const labelTemplates = React.useMemo(() => {
    const map = {};
    peopleRows.forEach((r) => {
      const d = r?.dia;
      if (typeof d === "string") {
        const key = d.replace(/\s+/g, "");
        if (!map[key])
          map[key] = {
            weekday: { ...r.weekday },
            saturday: { ...r.saturday },
            holiday: { ...r.holiday },
          };
      }
    });
    return map;
  }, [peopleRows]);

  const DUTY_OPTIONS = React.useMemo(() => {
    const set = new Set(["비번", "휴", "교육", "휴가"]);
    peopleRows.forEach((r) => {
      const d = r?.dia;
      if (typeof d === "number") set.add(`${d}D`);
      else if (typeof d === "string") {
        const clean = d.replace(/\s+/g, "");
        if (/^대\d+$/i.test(clean)) set.add(clean);
        if (/^대기\d+$/i.test(clean)) set.add(clean);
        else if (clean === "비") set.add("비번");
        else if (["주", "야", "휴", "비번"].includes(clean)) set.add(clean);
      }
    });
    const orderKey = (v) => {
      if (/^\d+D$/.test(v)) return parseInt(v);
      if (/^대\d+$/.test(v)) return 100 + parseInt(v.replace(/\D/g, ""));
      if (/^대기\d+$/i.test(v)) return 200 + parseInt(v.replace(/\D/g, ""));
      const fixed = { 비번: 1000, 휴: 1001, 주: 1002, 야: 1003 };
      return fixed[v] ?? 9999;
    };
    return Array.from(set).sort((a, b) => orderKey(a) - orderKey(b));
  }, [peopleRows]);

  const [myNameMap, setMyNameMap] = useState({
    안심: "",
    월배: "",
    경산: "",
    문양: "",
    교대: "",
    "교대(외)": "",
  });
  const myName = myNameMap[selectedDepot] || "";
  const setMyNameForDepot = (depot, name) =>
    setMyNameMap((prev) => ({ ...prev, [depot]: name }));

  const [holidaysText, setHolidaysText] = useState("");
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const lastClickedRef = React.useRef(null);
  const longPressTimerRef = React.useRef(null);
  const longPressActiveRef = React.useRef(false);
  const longPressDidFireRef = React.useRef(false);
  const LONG_MS = 600;

  const holidaySet = useMemo(() => {
    const s = new Set();
    holidaysText
      .split(/[, \n\r]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .forEach((d) => s.add(d));
    return s;
  }, [holidaysText]);

  const tabbarRef = React.useRef(null);
  const appRef = React.useRef(null);
  const [slideViewportH, setSlideViewportH] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const tabbarH = tabbarRef.current?.offsetHeight || 0;
      setSlideViewportH(Math.max(360, window.innerHeight - tabbarH - 12));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const [routeTargetName, setRouteTargetName] = useState("");
  const [nightDiaByDepot, setNightDiaByDepot] = useState({
    안심: 25,
    월배: 5,
    경산: 5,
    문양: 5,
    교대: 5,
    "교대(외)": 5,
  });
  const nightDiaThreshold = nightDiaByDepot[selectedDepot] ?? 25;
  const setNightDiaForDepot = (depot, val) =>
    setNightDiaByDepot((prev) => ({ ...prev, [depot]: val }));

  // 기지별 행로표 이미지 배율 (0.5 ~ 2.0)
  const [routeScaleByDepot, setRouteScaleByDepot] = useState({
    안심: 1,
    월배: 1,
    경산: 1,
    문양: 1,
    교대: 1,
    "교대(외)": 1,
  });
  const routeScale = routeScaleByDepot[selectedDepot] ?? 1;
  const setRouteScaleForDepot = (depot, val) =>
    setRouteScaleByDepot((prev) => ({ ...prev, [depot]: val }));
  const [highlightMap, setHighlightMap] = useState({});
  const [compareSelected, setCompareSelected] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const SAVE_DEBOUNCE = 300;
  const [calHasSelection, setCalHasSelection] = useState(true);

  const scrollLockRef = React.useRef({ locked: false, scrollY: 0 });
  function lockBodyScroll() {
    if (scrollLockRef.current.locked) return;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overscrollBehavior = "none";
    scrollLockRef.current.locked = true;
  }
  function unlockBodyScroll() {
    if (!scrollLockRef.current.locked) return;
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.documentElement.style.overscrollBehavior = "";
    document.body.style.overscrollBehavior = "";
    scrollLockRef.current.locked = false;
  }

  const [homePage, setHomePage] = useState(0);
  const [routePage, setRoutePage] = useState(0);
  const [routeTransitioning, setRouteTransitioning] = useState(false);

  function triggerRouteTransition() {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      background: "black",
      opacity: "0",
      transform: "scale(1)",
      transition: "all 0.35s cubic-bezier(0.25,1,0.5,1)",
      zIndex: "9998",
      pointerEvents: "none",
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = "0.12";
      overlay.style.transform = "scale(0.96)";
    });
    setTimeout(() => {
      setSelectedTab("route");
      setRoutePage(0);
      setDragYRoute(0);
      const routePanel = document.getElementById("route-panel0");
      if (routePanel)
        routePanel.animate(
          [
            { opacity: 0, transform: "translateY(14px) scale(0.97)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: 200, easing: "cubic-bezier(0.25,1,0.5,1)" }
        );
    }, 150);
    setTimeout(() => {
      overlay.style.opacity = "0";
      overlay.style.transform = "scale(1)";
      setTimeout(() => overlay.remove(), 220);
    }, 400);
  }

  const isHomeCalLocked = selectedTab === "home" && homePage === 0;
  const isRouteLocked = selectedTab === "route";
  const isAnyLocked = isHomeCalLocked || isRouteLocked;

  // ── 초기 로드 ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setMyNameForDepot("안심", nameList[0] || "");
        setHolidaysText(DEFAULT_HOLIDAYS_25_26);
      } else {
        const s = JSON.parse(raw);
        if (s.nightDiaByDepot) setNightDiaByDepot(s.nightDiaByDepot);
        else if (typeof s.nightDiaThreshold === "number")
          setNightDiaByDepot({
            안심: s.nightDiaThreshold,
            월배: s.nightDiaThreshold,
            경산: s.nightDiaThreshold,
            문양: s.nightDiaThreshold,
          });
        if (s.routeScaleByDepot) setRouteScaleByDepot(s.routeScaleByDepot);
        if (s.tablesByDepot) setTablesByDepot(s.tablesByDepot);
        if (s.myNameMap) setMyNameMap(s.myNameMap);
        if (s.selectedDepot) setSelectedDepot(s.selectedDepot);
        if (s.overridesByDepot) setOverridesByDepot(s.overridesByDepot);
        if (s.nameOverridesByDepot)
          setNameOverridesByDepot(s.nameOverridesByDepot);
        if (!s.tablesByDepot && s.tableText)
          setTablesByDepot((prev) => ({ ...prev, 안심: s.tableText }));
        if (!s.myNameMap && s.myName) setMyNameForDepot("안심", s.myName);
        if (s.anchorDateByDepot) setAnchorDateByDepot(s.anchorDateByDepot);
        else if (s.anchorDateStr)
          setAnchorDateByDepot(
            Object.fromEntries(DEPOTS.map((d) => [d, s.anchorDateStr]))
          );
        if (s.holidaysText) setHolidaysText(s.holidaysText);
        if (!s.holidaysText || !String(s.holidaysText).trim())
          setHolidaysText(DEFAULT_HOLIDAYS_25_26);
        if (s.highlightMap) setHighlightMap(s.highlightMap);
        if (Array.isArray(s.compareSelected))
          setCompareSelected(s.compareSelected);
        if (s.selectedDate)
          setSelectedDate(stripTime(new Date(s.selectedDate)));
      }
    } catch (e) {
      console.warn("[LOAD] 설정 로드 실패", e);
    }

    // commonMap IndexedDB 복원 + ZIP 핸들 복원 (병렬)
    // ⚠️ 중요: loaded=true 는 commonMap 복원 완료 후에만 호출해야 함.
    // 그렇지 않으면 "tablesByDepot/anchorDateByDepot 동기화" useEffect 가
    // commonMap=null 인 상태에서 실행되어 ZIP 기지의 paths 를 {} 로 덮어쓰는
    // 레이스가 발생 (→ IDB commonMap 까지 망가져서 이미지 인덱스가 증발).
    Promise.all([
      loadCommonDataFromDB(),
      restoreZipHandleFromDB("latest").catch(() => false),
    ])
      .then(async ([saved]) => {
        let current = saved;
        // 🚑 망가진 commonMap 자동 복구:
        //   과거 레이스 버그로 ZIP 기지 paths 가 비어있는 사용자를 위해,
        //   IDB 에 ZIP blob 이 살아있으면 자동으로 이미지 인덱스를 재구성.
        try {
          const { repaired, commonMap: repairedMap } =
            await repairCommonMapFromZipBlob(saved);
          if (repaired) {
            console.log("[App] commonMap 자동 복구 성공");
            current = repairedMap;
          }
        } catch (e) {
          console.warn("[App] commonMap 복구 시도 실패", e);
        }
        if (current) setCommonMap(current);
      })
      .catch(() => {})
      .finally(() => {
        // commonMap 반영은 다음 렌더에 일어나지만, setLoaded 가 그 뒤에
        // 오면 "loaded=true 시점에 commonMap 이 아직 null" 인 창은 없음
        // (setState 배치 처리로 같은 렌더에 둘 다 적용됨).
        setLoaded(true);
      });

    (async () => {
      try {
        if ("storage" in navigator && "persist" in navigator.storage)
          await navigator.storage.persist();
      } catch {}
    })();
  }, []);

  // ── TSV → commonMap 자동 변환 (기존 사용자, commonMap 없을 때) ──
  //
  //  ⚠️ ZIP 기지(안심/월배/경산/문양) 는 이 effect 에서 만들지 않음.
  //  ZIP 기지에 tablesByDepot 가 남아있을 수 있지만, 그건 ZIP 등록 시
  //  자동 생성된 사본이라 별도 변환 대상이 아님. TSV 전용 기지만 변환.
  useEffect(() => {
    if (!loaded || commonMap) return;
    try {
      const TSV_ONLY_DEPOTS = new Set(["교대", "교대(외)"]);
      const map = {};
      for (const depot of DEPOTS) {
        if (!TSV_ONLY_DEPOTS.has(depot)) continue;
        const tsv = tablesByDepot[depot],
          anchor = anchorDateByDepot[depot];
        if (!tsv || !anchor) continue;
        const rows = parsePeopleTable(tsv);
        if (!rows.length) continue;
        const key = DEPOT_TO_ZIP_KEY[depot] || depot;
        map[key] = tsvRowsToCommon(depot, rows, anchor);
      }
      if (Object.keys(map).length) {
        setCommonMap(map);
        saveCommonDataToDB(map).catch(() => {});
      }
    } catch (e) {
      console.warn("[TSV→Common]", e);
    }
  }, [loaded]);
  // ── commonMap 없으면 SetupWizard 자동 표시 ──
  useEffect(() => {
    if (!loaded) return;

    const done = localStorage.getItem("setupDone");

    if (!commonMap && !done) {
      setShowSetupWizard(true);
    }
  }, [loaded]);

  // ── tablesByDepot / anchorDateByDepot 바뀔 때 commonMap 동기화 ──
  //
  //  이 useEffect 의 목적: **교대/교대(외) 같은 TSV 기지**에서 TSV 텍스트가
  //  변경됐을 때 commonMap 에도 반영하기 위함.
  //
  //  ⚠️ ZIP 기지(안심/월배/경산/문양) 는 여기서 절대 건드리면 안 됨.
  //  과거 버그: commonMap 복원이 아직 안 끝난 상태(prev=null)에서 이 effect 가
  //  실행되면 `prev?.[key]?.source === "zip"` 가드를 뚫고 안심 TSV 로
  //  재구성하면서 paths(이미지 인덱스) 를 {} 로 덮어써서 IDB 까지 망가뜨렸음.
  useEffect(() => {
    if (!loaded) return;
    // commonMap 이 아직 복원되지 않았으면 아무것도 하지 않음 — 레이스 방지
    if (commonMap === null) return;

    const TSV_ONLY_DEPOTS = new Set(["교대", "교대(외)"]); // ZIP 기지는 절대 제외
    setCommonMap((prev) => {
      const next = { ...(prev || {}) };
      let changed = false;
      for (const depot of DEPOTS) {
        if (!TSV_ONLY_DEPOTS.has(depot)) continue; // ZIP 기지는 건너뜀 (이중 방어)
        const key = DEPOT_TO_ZIP_KEY[depot] || depot;
        if (prev?.[key]?.source === "zip") continue; // 삼중 방어
        const tsv = tablesByDepot[depot],
          anchor = anchorDateByDepot[depot];
        if (!tsv || !anchor) continue;
        const rows = parsePeopleTable(tsv);
        if (!rows.length) continue;
        const existingPaths = prev?.[key]?.paths || {};
        const existingAlarms = prev?.[key]?.alarms || {
          nor: {},
          sat: {},
          hol: {},
        };
        const updated = tsvRowsToCommon(depot, rows, anchor);
        updated.paths = existingPaths;
        updated.alarms = existingAlarms;
        next[key] = updated;
        changed = true;
      }
      if (changed) saveCommonDataToDB(next).catch(() => {});
      return changed ? next : prev;
    });
  }, [tablesByDepot, anchorDateByDepot, loaded, commonMap === null]);

  // ── 매일 anchorDate 자동 갱신 (오늘로 고정) ──
  //
  //  원리: 각 사람의 "오늘 교번"을 기존 anchor로 한 번 계산해 저장해두고,
  //        그 정답 매핑을 유지하도록 names 배열을 재배치한다.
  //        그 다음 anchor = today 로 덮어쓴다.
  //
  //  새 공식 (anchor=today, dd=0): peopleRows_new[i].dia = gyobun[i]
  //  → 각 i 위치에 "오늘 gyobun[i]를 받는 사람"을 넣으면 된다.
  //
  //  회전이 아닌 **직접 재배치**이므로 기존 anchor 계산 방식(역산/SetupWizard 모두)
  //  과 일관되게 작동한다.
  useEffect(() => {
    if (!loaded) return;
    const todayStr = fmt(today);

    // 이미 모든 소속이 오늘로 되어있으면 skip
    const allToday = DEPOTS.every(
      (d) => (anchorDateByDepot[d] || "") === todayStr
    );
    if (allToday) return;

    // ZIP 데이터: 각 기지를 자기 info.txt (baseDate/baseName/baseCode) 기준으로
    // "오늘 배치" 로 재정렬. (앞서 anchor 기준으로 회전시키던 로직은 버그 —
    // ZIP 의 names 는 baseDate 기준으로 들어오기 때문에 anchor 기준 회전은 틀림)
    setCommonMap((prevMap) => {
      if (!prevMap) return prevMap;
      const nextMap = { ...prevMap };
      let changed = false;

      for (const depot of DEPOTS) {
        const key = DEPOT_TO_ZIP_KEY[depot] || depot;
        const data = prevMap[key];
        if (!data?.names?.length || !data?.gyobun?.length) continue;
        if (data.source !== "zip") continue; // ZIP 만 (TSV 는 아래 블록에서 처리)
        if (data.baseDate === todayStr) continue; // 이미 오늘 배치

        const rebuilt = rebaseDepotToToday(data, todayStr);
        if (rebuilt !== data) {
          nextMap[key] = rebuilt;
          changed = true;
        }
      }

      if (changed) {
        saveCommonDataToDB(nextMap).catch(() => {});
      }
      return changed ? nextMap : prevMap;
    });

    // TSV 행: 이름 칸만 재배치 (교대/교대(외))
    setTablesByDepot((prevTables) => {
      const nextTables = { ...prevTables };
      let changed = false;

      for (const depot of DEPOTS) {
        const key = DEPOT_TO_ZIP_KEY[depot] || depot;
        if (commonMap?.[key]?.source === "zip") continue; // ZIP은 위에서 처리

        const currentAnchor = anchorDateByDepot[depot];
        if (!currentAnchor) continue;
        if (currentAnchor === todayStr) continue;

        const tsv = prevTables[depot];
        if (!tsv) continue;
        const lines = tsv.split(/\r?\n/);
        if (lines.length < 2) continue;

        const header = lines[0];
        const dataLines = lines.slice(1).filter((l) => l.trim());
        if (!dataLines.length) continue;

        const anchorD = stripTime(new Date(currentAnchor));
        const dd = diffDays(today, anchorD);
        if (dd === 0) continue;

        const len = dataLines.length;
        const names = dataLines.map((row) => row.split("\t")[1] || "");

        // names_new[j] = names[mod(j - dd, len)]
        const newNames = new Array(len);
        for (let j = 0; j < len; j++) {
          const oldI = (((j - dd) % len) + len) % len;
          newNames[j] = names[oldI];
        }

        const newDataLines = dataLines.map((row, i) => {
          const cols = row.split("\t");
          cols[1] = newNames[i];
          return cols.join("\t");
        });

        nextTables[depot] = [header, ...newDataLines].join("\n");
        changed = true;
      }

      return changed ? nextTables : prevTables;
    });

    // 모든 anchor를 오늘로 덮어쓰기
    setAnchorDateByDepot((prev) => {
      const next = { ...prev };
      for (const depot of DEPOTS) {
        if (next[depot] !== todayStr) {
          next[depot] = todayStr;
        }
      }
      return next;
    });
  }, [loaded, commonMap, fmt(today)]);

  // ── SetupWizard 완료 ──
  //
  //  핵심: anchor=today 가 되도록 names 배열을 미리 재배치해서 넘김.
  //  → "매일 자동 갱신" useEffect가 중복 회전하지 않음 (이미 오늘이라서 skip)
  async function handleSetupComplete(result) {
    const {
      mode,
      depot,
      myName: wizName,
      myCode,
      anchorDate: wizAnchor, // Wizard가 today로 보냄 (이미 오늘 배치 완료)
      commonMap: newMap,
    } = result;

    const todayISO = fmt(today);

    let finalMap = { ...(commonMap || {}) };
    if (mode === "zip") {
      // Wizard가 이미 names 를 오늘 정답 배치로 만들어서 넘김
      // (baseDate 도 today 로 세팅됨)
      Object.assign(finalMap, newMap);
    } else {
      if (newMap?._pathsOnly)
        for (const key of Object.keys(finalMap))
          finalMap[key] = loadPathsIntoCommon(finalMap[key], newMap._pathsOnly);
    }

    // ZIP 모드: tablesByDepot에도 오늘 배치된 이름으로 TSV 생성
    if (mode === "zip") {
      const key = DEPOT_TO_ZIP_KEY[depot] || depot;
      const zipData = finalMap[key];
      if (zipData?.names?.length && zipData?.gyobun?.length) {
        const header =
          "순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근";
        const rows = zipData.names.map((name, i) => {
          const code = zipData.gyobun[i] || "";
          const dia = code.replace(/d$/i, "");
          const nor = zipData.worktime?.nor?.[code.toLowerCase()] || "----";
          const sat = zipData.worktime?.sat?.[code.toLowerCase()] || "----";
          const hol = zipData.worktime?.hol?.[code.toLowerCase()] || "----";
          const [norIn, norOut] = nor.split("-");
          const [satIn, satOut] = sat.split("-");
          const [holIn, holOut] = hol.split("-");
          return [
            i + 1,
            name,
            dia,
            norIn || "",
            norOut || "",
            satIn || "",
            satOut || "",
            holIn || "",
            holOut || "",
          ].join("\t");
        });
        const tsvText = [header, ...rows].join("\n");
        setTablesByDepot((prev) => ({ ...prev, [depot]: tsvText }));
      }
    }

    setCommonMap(finalMap);
    saveCommonDataToDB(finalMap).catch(() => {});
    setSelectedDepot(depot);
    if (wizName) setMyNameForDepot(depot, wizName);
    // anchor = today (Wizard가 이미 오늘 배치로 넘겼으므로)
    setAnchorDateByDepot((prev) => ({ ...prev, [depot]: todayISO }));
    setShowSetupWizard(false);
    localStorage.setItem("setupDone", "true");
  }

  // ── 탭 변경 ──
  useEffect(() => {
    if (appRef.current) appRef.current.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "instant" });
    if (selectedTab === "roster" || selectedTab === "settings") setTempName("");
  }, [selectedTab]);

  useEffect(() => {
    if (selectedTab === "home") {
      setHomePage(0);
      setDragYHome(0);
      setSnapYHome(false);
      if (fmt(selectedDate) !== fmt(today) || !calHasSelection) {
        setSelectedDate(today);
        setCalHasSelection(true);
        lastClickedRef.current = fmt(today);
      }
    }
  }, [selectedTab]);

  useEffect(() => {
    if (selectedTab === "compare" && fmt(selectedDate) !== fmt(today))
      setSelectedDate(today);
  }, [selectedTab]);
  useEffect(() => {
    if (selectedTab === "route") {
      setRoutePage(0);
      setDragYRoute(0);
      setSnapYRoute(false);
    }
  }, [selectedTab]);
  useEffect(() => {
    if (isAnyLocked) {
      lockBodyScroll();
      return () => unlockBodyScroll();
    } else unlockBodyScroll();
  }, [isAnyLocked]);

  // ── 자동 저장 ──
  useEffect(() => {
    if (!loaded) return;
    const data = {
      myNameMap,
      selectedDepot,
      anchorDateByDepot,
      holidaysText,
      nightDiaByDepot,
      routeScaleByDepot,
      highlightMap,
      tablesByDepot,
      selectedDate: fmt(selectedDate),
      compareSelected,
      overridesByDepot,
      nameOverridesByDepot,
    };
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn("[SAVE]", e);
      }
    }, SAVE_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [
    loaded,
    myNameMap,
    anchorDateByDepot,
    holidaysText,
    nightDiaByDepot,
    routeScaleByDepot,
    highlightMap,
    tablesByDepot,
    selectedDate,
    compareSelected,
    overridesByDepot,
    nameOverridesByDepot,
  ]);

  useEffect(() => {
    window.triggerRouteTransition = triggerRouteTransition;
    window.setRouteTargetName = setRouteTargetName;
    return () => delete window.triggerRouteTransition;
  }, []);

  function rowAtDateForName(name, date) {
    if (!nameIndexMap.has(name) || !peopleRows.length) return undefined;
    const baseIdx = nameIndexMap.get(name);
    const dd = diffDays(date, anchorDate);
    const idx = mod(baseIdx + dd, peopleRows.length);
    return peopleRows[idx];
  }

  function rosterAt(date) {
    return nameList.map((n) => {
      const r = rowAtDateForNameWithOverride(n, date);
      return { name: n, row: r, dia: r?.dia };
    });
  }

  const diaGridRows = useMemo(() => {
    if (!nameList?.length) return [];
    const yester = getYesterday(selectedDate);
    const entries = nameList.map((name) => {
      const rowToday = rowAtDateForNameWithOverride(name, selectedDate);
      const todayDia = rowToday?.dia;
      let type = "work",
        diaNum = toDiaNum(todayDia),
        daeNum = null,
        origHasTilde = false; // 원본 교번에 이미 ~가 있는지 (대N~, 25~ 등)
      if (typeof todayDia === "string") {
        const clean = todayDia.replace(/\s/g, "");
        if (clean.startsWith("휴")) type = "holiday";
        // 🔑 대N~ / N~ 은 원본 gyobun 상의 "비번 자리" — biban 으로 분류하되
        //    원본 표기를 그대로 유지하기 위해 플래그 기록.
        else if (clean.endsWith("~")) {
          type = "biban";
          origHasTilde = true;
        } else if (clean.includes("비번") || clean === "비") type = "biban";
        else if (/^대\d+$/i.test(clean)) {
          type = "dae";
          daeNum = Number(clean.replace(/[^0-9]/g, ""));
        }
      }
      let yDiaNum = null;
      if (type === "biban" || type === "dae") {
        const yRow = rowAtDateForNameWithOverride(name, yester);
        const n = toDiaNum(yRow?.dia);
        yDiaNum = Number.isFinite(n) ? n : null;
      }
      return {
        name,
        row: rowToday,
        type,
        diaNum,
        daeNum,
        origHasTilde,
        yDiaNum,
      };
    });
    const work = entries
      .filter((e) => e.type === "work" && Number.isFinite(e.diaNum))
      .sort((a, b) => a.diaNum - b.diaNum);
    const dae = entries
      .filter((e) => e.type === "dae" && Number.isFinite(e.daeNum))
      .sort(
        (a, b) =>
          a.daeNum - b.daeNum ||
          String(a.name).localeCompare(String(b.name), "ko")
      );
    const biban = entries
      .filter((e) => e.type === "biban")
      .sort((a, b) => {
        const ak = a.yDiaNum ?? 9999,
          bk = b.yDiaNum ?? 9999;
        if (ak !== bk) return ak - bk;
        return String(a.name).localeCompare(String(b.name), "ko");
      });
    const holiday = entries
      .filter((e) => e.type === "holiday")
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    return [...work, ...dae, ...biban, ...holiday].map(
      ({ name, row, type, origHasTilde }) => {
        let displayDia = row?.dia;

        // dae (대N 근무) — 원본 교번을 그대로 표시.
        // (과거 버그: 어제가 야간이면 "대N~" 로 덮어써서 비번처럼 보이게 만들었음.
        //  "~" 는 원본 gyobun 에 이미 대N~ 형태로 존재하는 "비번 자리" 전용이므로
        //  dae 자리에는 절대 덧붙이지 않는다.)

        if (type === "biban") {
          // 원본이 이미 대N~, N~ 같이 ~ 붙은 교번이면 그대로 표시
          if (origHasTilde && typeof displayDia === "string") {
            displayDia = displayDia.replace(/\s+/g, "");
          } else {
            // override 등으로 "비번" 문자열이 들어온 경우 — 어제 야간 여부로 표기 결정
            const yRow = rowAtDateForNameWithOverride(name, yester);
            const yDiaRaw = yRow?.dia;
            const yDia =
              typeof yDiaRaw === "string"
                ? yDiaRaw.trim().replace(/\s+/g, "")
                : yDiaRaw;
            // 🌙 worktime 기반 판정 (threshold 폐기)
            const prevNight = yRow
              ? computeInOut(yRow, yester, holidaySet).isNight
              : false;
            displayDia = prevNight ? `${String(yDia)}~` : "비번";
          }
        }
        return { name, row: { ...row, dia: displayDia } };
      }
    );
  }, [
    nameList,
    selectedDate,
    selectedDepot,
    overridesByDepot,
    commonMap,
    anchorDateStr,
    holidaySet,
  ]);

  const nameGridRows = useMemo(() => {
    const rows = rosterAt(selectedDate);
    return [...rows].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), "ko")
    );
  }, [
    selectedDate,
    nameList,
    selectedDepot,
    overridesByDepot,
    anchorDateStr,
    commonMap,
  ]);

  const days = monthGridMonday(selectedDate);
  const todayISO = fmt(today);

  const swipeRef = React.useRef({ x: 0, y: 0, lock: null });
  const lastMoveRef = React.useRef({ x: 0, t: 0 });
  const SWIPE_X_THRESHOLD = 40,
    VELOCITY_THRESHOLD = 0.35,
    ACTIVATION_THRESHOLD = 10,
    SNAP_MS = 320;

  const onCalTouchStart = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, lock: null };
    lastMoveRef.current = { x: t.clientX, t: performance.now() };
    setIsSnapping(false);
    setDragX(0);
  };
  const onCalTouchMove = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeRef.current.x,
      dy = t.clientY - swipeRef.current.y;
    if (swipeRef.current.lock === null) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > ACTIVATION_THRESHOLD)
        swipeRef.current.lock = "h";
      else if (
        Math.abs(dy) > Math.abs(dx) &&
        Math.abs(dy) > ACTIVATION_THRESHOLD
      )
        swipeRef.current.lock = "v";
    }
    if (swipeRef.current.lock === "h") {
      e.preventDefault();
      setDragX(dx);
      lastMoveRef.current = { x: t.clientX, t: performance.now() };
    }
  };
  const onCalTouchEnd = (e) => {
    if (swipeRef.current.lock !== "h") {
      setDragX(0);
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeRef.current.x;
    const now = performance.now(),
      dt = Math.max(1, now - lastMoveRef.current.t);
    const vx = (t.clientX - lastMoveRef.current.x) / dt;
    const width =
      gridWrapRef.current?.parentElement?.offsetWidth ||
      (gridWrapRef.current?.offsetWidth
        ? gridWrapRef.current.offsetWidth / 3
        : window.innerWidth);
    const goNext =
      dx < 0 &&
      (Math.abs(dx) > SWIPE_X_THRESHOLD || Math.abs(vx) > VELOCITY_THRESHOLD);
    const goPrev =
      dx > 0 &&
      (Math.abs(dx) > SWIPE_X_THRESHOLD || Math.abs(vx) > VELOCITY_THRESHOLD);
    setIsSnapping(true);
    if (goNext) {
      setDragX(-width);
      setTimeout(() => {
        setSelectedDate((prev) => addMonthsSafe(prev, 1));
        setCalHasSelection(false);
        setIsSnapping(false);
        setDragX(0);
      }, SNAP_MS);
    } else if (goPrev) {
      setDragX(width);
      setTimeout(() => {
        setSelectedDate((prev) => addMonthsSafe(prev, -1));
        setCalHasSelection(false);
        setIsSnapping(false);
        setDragX(0);
      }, SNAP_MS);
    } else {
      setDragX(0);
      setTimeout(() => setIsSnapping(false), SNAP_MS);
    }
    swipeRef.current = { x: 0, y: 0, lock: null };
  };

  const V_SNAP_MS = 300,
    V_DIST_RATIO = 0.1,
    V_VELOCITY_THRESHOLD = 0.1,
    V_ACTIVATE = 12,
    V_DIR = 1.2;
  function rubberband(distance, limit) {
    const constant = 0.55;
    if (Math.abs(distance) < limit) return distance;
    const excess = Math.abs(distance) - limit,
      sign = Math.sign(distance);
    return (
      sign *
      (limit +
        (1 - Math.exp(-excess / (limit / constant))) * (limit / constant))
    );
  }

  const [dragYHome, setDragYHome] = useState(0);
  const [dragYRoute, setDragYRoute] = useState(0);
  const [snapYHome, setSnapYHome] = useState(false);
  const [snapYRoute, setSnapYRoute] = useState(false);
  const [altView, setAltView] = React.useState(false);
  const longPressTimer = React.useRef(null);
  const longPressActive = React.useRef(false);

  const handleTouchStart = React.useCallback(() => {
    if (selectedDepot === "문양" || selectedDepot === "경산") return;
    longPressActive.current = true;
    longPressTimer.current = setTimeout(() => {
      if (longPressActive.current) setAltView((v) => !v);
    }, 600);
  }, [selectedDepot]);
  const handleTouchEnd = React.useCallback(() => {
    longPressActive.current = false;
    clearTimeout(longPressTimer.current);
  }, []);

  React.useEffect(() => {
    setAltView(false);
  }, []);
  React.useEffect(() => {
    if (selectedTab === "route") setAltView(false);
  }, [selectedTab]);
  React.useEffect(() => {
    setAltView(false);
  }, [selectedDate]);
  React.useEffect(() => {
    setAltView(false);
  }, [routeTargetName, selectedDate]);

  const homeWrapRef = React.useRef(null);
  const homePanelRefs = [React.useRef(null), React.useRef(null)];
  const routeWrapRef = React.useRef(null);
  const routePanelRefs = [
    React.useRef(null),
    React.useRef(null),
    React.useRef(null),
    React.useRef(null),
  ];
  const [homeHeight, setHomeHeight] = useState(0);
  const [routeHeight, setRouteHeight] = useState(0);

  useLayoutEffect(() => {
    const el = homePanelRefs[homePage].current;
    if (!el) return;
    const measure = () =>
      setHomeHeight(el.offsetHeight || el.clientHeight || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
    };
  }, [
    homePage,
    selectedDate,
    currentTableText,
    holidaysText,
    nightDiaThreshold,
    myName,
    tempName,
  ]);

  useLayoutEffect(() => {
    const el = routePanelRefs[routePage].current;
    if (!el) return;
    const measure = () =>
      setRouteHeight(el.offsetHeight || el.clientHeight || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
    };
  }, [
    routePage,
    selectedDate,
    holidaysText,
    nightDiaThreshold,
    myName,
    routeTargetName,
  ]);

  function makeVerticalHandlers(kind) {
    const swipeRef = React.useRef({ x: 0, y: 0, lock: null });
    const lastMoveRef = React.useRef({ y: 0, t: 0 });
    const [pendingDir, setPendingDir] = React.useState(null);
    const onStart = (e) => {
      if (e.target.closest("[data-no-gesture]")) return;
      const t = e.touches[0];
      swipeRef.current = { x: t.clientX, y: t.clientY, lock: null };
      lastMoveRef.current = { y: t.clientY, t: performance.now() };
      if (kind === "home") setSnapYHome(false);
      else setSnapYRoute(false);
    };
    const onMove = (e) => {
      if (e.target.closest("[data-no-gesture]")) return;
      const t = e.touches[0];
      const dx = t.clientX - swipeRef.current.x,
        dy = t.clientY - swipeRef.current.y;
      if (swipeRef.current.lock === null) {
        if (Math.abs(dy) > Math.abs(dx) * V_DIR && Math.abs(dy) > V_ACTIVATE) {
          swipeRef.current.lock = "v";
          lockBodyScroll();
        } else if (
          Math.abs(dx) > Math.abs(dy) * V_DIR &&
          Math.abs(dx) > V_ACTIVATE
        )
          swipeRef.current.lock = "h";
      }
      if (swipeRef.current.lock !== "v") return;
      if (e.cancelable) e.preventDefault();
      const wrap = kind === "home" ? homeWrapRef.current : routeWrapRef.current;
      const page = kind === "home" ? homePage : routePage,
        MAX = kind === "home" ? 1 : 3;
      const wrapH = wrap?.offsetHeight || window.innerHeight * 0.6;
      const rb = rubberband(dy, wrapH);
      let bounded = rb;
      if (page <= 0) bounded = Math.min(0, rb);
      else if (page >= MAX) bounded = Math.max(0, rb);
      bounded = clamp(bounded, -wrapH, wrapH);
      if (kind === "home") setDragYHome(bounded);
      else setDragYRoute(bounded);
      lastMoveRef.current = { y: t.clientY, t: performance.now() };
    };
    const onEnd = (e) => {
      if (swipeRef.current.lock !== "v") {
        if (kind === "home") setDragYHome(0);
        else setDragYRoute(0);
        unlockBodyScroll();
        return;
      }
      const t = e.changedTouches[0];
      const dy = t.clientY - swipeRef.current.y;
      const now = performance.now(),
        dt = Math.max(1, now - lastMoveRef.current.t);
      const vy = (t.clientY - lastMoveRef.current.y) / dt;
      const wrap = kind === "home" ? homeWrapRef.current : routeWrapRef.current;
      const page = kind === "home" ? homePage : routePage,
        MAX = kind === "home" ? 1 : 3;
      const setDrag = kind === "home" ? setDragYHome : setDragYRoute,
        setSnap = kind === "home" ? setSnapYHome : setSnapYRoute;
      const height = wrap?.offsetHeight || window.innerHeight * 0.6;
      const passedDist = Math.abs(dy) > height * V_DIST_RATIO,
        fast = Math.abs(vy) > V_VELOCITY_THRESHOLD;
      const goNext = dy < 0 && (passedDist || fast),
        goPrev = dy > 0 && (passedDist || fast);
      setSnap(true);
      if (goNext && page < MAX) {
        setPendingDir("next");
        setDrag(-height);
      } else if (goPrev && page > 0) {
        setPendingDir("prev");
        setDrag(height);
      } else {
        setDrag(0);
        setTimeout(() => setSnap(false), V_SNAP_MS);
      }
      swipeRef.current = { x: 0, y: 0, lock: null };
    };
    const onTransitionEnd = () => {
      if (!pendingDir) return;
      if (kind === "home") {
        if (pendingDir === "next") setHomePage((p) => Math.min(p + 1, 1));
        else setHomePage((p) => Math.max(p - 1, 0));
        setDragYHome(0);
        setSnapYHome(false);
      } else {
        if (pendingDir === "next") setRoutePage((p) => Math.min(p + 1, 3));
        else setRoutePage((p) => Math.max(p - 1, 0));
        setDragYRoute(0);
        setSnapYRoute(false);
      }
      setPendingDir(null);
    };
    const onCancel = () => {
      if (kind === "home") {
        setDragYHome(0);
        setSnapYHome(false);
      } else {
        setDragYRoute(0);
        setSnapYRoute(false);
      }
      setPendingDir(null);
      unlockBodyScroll();
    };
    return { onStart, onMove, onEnd, onTransitionEnd, onCancel };
  }

  const vHome = makeVerticalHandlers("home");
  const vRoute = makeVerticalHandlers("route");
  const swipeHomeP1 = useDaySwipeHandlers();
  const swipeRosterP0 = useDaySwipeHandlers();
  const swipeRouteP0 = useDaySwipeHandlers();
  const swipeRouteP1 = useDaySwipeHandlers();
  const swipeRouteP2 = useDaySwipeHandlers();
  const swipeRouteP3 = useDaySwipeHandlers();

  async function onUpload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await readTextFile(f);
    setTablesByDepot((prev) => ({ ...prev, [selectedDepot]: txt }));
    e.target.value = "";
  }

  async function resetAll() {
    if (
      !confirm(
        "모든 저장 데이터를 초기화할까요?\n(ZIP 파일, 설정, 일일 변경 등 모두 삭제)"
      )
    )
      return;

    // 1) localStorage 전체 비우기 (setupDone 포함)
    try {
      localStorage.clear();
    } catch {}

    // 2) IndexedDB 전체 삭제 (commonMap, zip blobs, zip handles 모두)
    try {
      await resetAllStorage();
    } catch (e) {
      console.warn("[resetAll] IDB 삭제 실패", e);
    }

    // 3) Cache Storage + Service Worker 정리
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {}

    // 4) 새로고침 — reload 이후 모든 state 가 기본값으로 다시 초기화되고
    //    SetupWizard 가 자동 표시됨 (commonMap 없음 + setupDone 없음).
    //    reload 전에 setState 는 의미 없으므로 호출하지 않음.
    try {
      window.location.reload();
    } catch {}
  }

  const isPortrait = usePortraitOnly();

  // ── ROUTE 공통 계산 ──
  const routeTarget = routeTargetName || myName;
  const routeRow = React.useMemo(
    () => rowAtDateForNameWithOverride(routeTarget, selectedDate),
    [
      routeTarget,
      selectedDate,
      selectedDepot,
      overridesByDepot, // 교번 override 적용/해제 반영
      commonMap, // 영구 변경(swap) 반영
      anchorDateStr, // anchor 이동 시 반영
    ]
  );
  const routeT = React.useMemo(
    () => computeInOut(routeRow, selectedDate, holidaySet, nightDiaThreshold),
    [routeRow, selectedDate, holidaySet, nightDiaThreshold]
  );
  const routeCombo = routeT?.combo || "";
  const routeDia = routeRow?.dia ?? null;
  const routeIn = routeT.in,
    routeOut = routeT.out;
  const routeDiaLabel = routeRow?.dia == null ? "-" : String(routeRow.dia);
  const routeNote = `${routeT.combo}${routeT.isNight ? " (야간)" : ""}`;
  const iso = fmt(selectedDate);
  const wk = weekdaysKR[(selectedDate.getDay() + 6) % 7];
  const startHM = normalizeHM(routeIn),
    endHM = normalizeHM(routeOut);

  // ── 새 방식: commonMap 기반 파생값 ──
  const depotKey = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
  const currentCommonData = commonMap?.[depotKey] || null;
  const currentGyobunList = currentCommonData?.gyobun || DUTY_OPTIONS;
  const currentPaths = currentCommonData?.paths || {};
  const routeCodeStr = tsvDiaToRouteCode(routeRow?.dia);

  // 각 교번을 "지금" 소유한 사람 맵 — PersonEditModal swap 미리보기용
  // (anchor=today, dd=0 이므로 names[i] 의 교번 = gyobun[i])
  const codeOwnerMap = React.useMemo(() => {
    const map = {};
    const names = currentCommonData?.names || [];
    const gyobun = currentCommonData?.gyobun || [];
    const len = Math.min(names.length, gyobun.length);
    for (let i = 0; i < len; i++) {
      const code = gyobun[i];
      if (code) map[code] = names[i] || "";
    }
    return map;
  }, [currentCommonData]);

  // 수정모드 셀 탭 → PersonEditModal 열기 (override 정보 함께 전달)
  function openPersonEditModal(name, row) {
    const iso = fmt(stripTime(new Date(selectedDate)));
    const hasTodayCode = !!overridesByDepot?.[selectedDepot]?.[iso]?.[name];
    const hasTodayName = !!nameOverridesByDepot?.[selectedDepot]?.[iso]?.[name];
    // row 는 override 적용된 상태 → base 를 따로 계산
    const baseRow = rowAtDateForName(name, selectedDate);
    const baseCode = tsvDiaToRouteCode(baseRow?.dia);
    // 현재 표시중인 교번(override 적용)
    const currentCode = tsvDiaToRouteCode(row?.dia);
    setPersonEditModal({
      open: true,
      oldName: name,
      oldCode: currentCode,
      baseName: name,
      baseCode,
      hasTodayCode,
      hasTodayName,
    });
  }

  const routeTargetPhone = React.useMemo(() => {
    const p =
      (peopleRows || []).find((r) => r.name === routeTarget)?.phone || "";
    return String(p).trim();
  }, [peopleRows, routeTarget]);

  function DutyModal() {
    if (!dutyModal.open) return null;
    const { date, name } = dutyModal;
    const iso2 = fmt(date);
    const [pendingOpt, setPendingOpt] = React.useState(null);
    return (
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end sm:items-center justify-center p-2">
        <div
          className="w-[min(680px,100vw)] rounded-2xl bg-gray-800 text-gray-100 p-3 shadow-lg mb-[72px] sm:mb-0"
          style={{ marginBottom: "max(72px, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">근무 변경</div>
            <button
              className="text-sm opacity-70"
              onClick={() =>
                setDutyModal({ open: false, date: null, name: null })
              }
            >
              닫기
            </button>
          </div>
          <div className="text-xs text-gray-300 mb-3">
            {name} · {iso2}
          </div>
          <div
            className="grid gap-2 grid-cols-6 sm:grid-cols-8"
            style={{ paddingBottom: "80px" }}
          >
            {DUTY_OPTIONS.map((opt) => {
              const active = pendingOpt === opt;
              return (
                <button
                  key={opt}
                  onPointerDown={() => setPendingOpt(opt)}
                  onClick={() => {
                    if (pendingOpt === opt) {
                      setOverride(selectedDepot, date, name, opt);
                      setDutyModal({ open: false, date: null, name: null });
                    } else setPendingOpt(opt);
                  }}
                  className={[
                    "h-9 rounded-lg bg-gray-700 hover:bg-gray-600",
                    "text-xs font-medium flex items-center justify-center",
                    active ? "ring-2 ring-indigo-400" : "",
                  ].join(" ")}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          <div className="mt-3 mb-6 flex items-center justify-between">
            <div className="text-[11px] text-gray-400">
              한 번 누르면 선택,{" "}
              <span className="text-gray-200">두 번 누르면 반영</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setOverride(selectedDepot, date, name, null);
                  setDutyModal({ open: false, date: null, name: null });
                }}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs"
              >
                설정 해제
              </button>
              <button
                onClick={() =>
                  setDutyModal({ open: false, date: null, name: null })
                }
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white"
              >
                완료
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {!isPortrait && <LandscapeOverlay />}
      <div
        aria-hidden={!isPortrait}
        inert={!isPortrait ? "" : undefined}
        ref={appRef}
        className="max-w-7xl mx-auto relative pb-0"
        style={{
          height: "100vh",
          overflowY:
            selectedTab === "settings" || selectedTab === "compare"
              ? "auto"
              : "hidden",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          touchAction: selectedTab === "compare" ? "pan-y" : "manipulation",
          // compare 탭에서 아래 탭바에 가려지지 않도록 하단 패딩
          paddingBottom: selectedTab === "compare" ? "80px" : undefined,
        }}
      >
        {/* 홈 탭 */}
        {selectedTab === "home" && (
          <div
            ref={homeWrapRef}
            className="mt-4 select-none overflow-hidden rounded-2xl overscroll-contain"
            style={{
              height: slideViewportH,
              touchAction: isHomeCalLocked ? "none" : "pan-y",
            }}
            onTouchStart={vHome.onStart}
            onTouchMove={vHome.onMove}
            onTouchEnd={vHome.onEnd}
            onTouchCancel={vHome.onCancel}
            onWheel={(e) => {
              if (isHomeCalLocked) e.preventDefault();
              if (snapYHome) return;
              const TH = 40;
              if (e.deltaY > TH && homePage === 0) {
                setSnapYHome(true);
                setDragYHome(-(homeWrapRef.current?.offsetHeight || 500));
                setTimeout(() => {
                  setHomePage(1);
                  setSnapYHome(false);
                  setDragYHome(0);
                }, 320);
              } else if (e.deltaY < -TH && homePage === 1) {
                setSnapYHome(true);
                setDragYHome(homeWrapRef.current?.offsetHeight || 500);
                setTimeout(() => {
                  setHomePage(0);
                  setSnapYHome(false);
                  setDragYHome(0);
                }, 320);
              }
            }}
          >
            <div
              className="relative"
              style={{
                transform: `translateY(${
                  (homePage === 0 ? 0 : -slideViewportH) + dragYHome
                }px)`,
                transition: snapYHome
                  ? `transform ${V_SNAP_MS}ms ease-out`
                  : "none",
                willChange: "transform",
              }}
              onTransitionEnd={vHome.onTransitionEnd}
            >
              {/* Panel 0: 캘린더 */}
              <div
                ref={homePanelRefs[0]}
                className="bg-gray-800 rounded-2xl p-3 shadow mb-7"
                style={{ minHeight: slideViewportH }}
              >
                <div className="flex items-center justify-between mb-0">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5" />
                    {selectedDate.getFullYear()}년 {selectedDate.getMonth() + 1}
                    월
                  </h2>
                  <div className="flex items-center gap-2">
                    <input
                      type="month"
                      className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                      value={`${selectedDate.getFullYear()}-${String(
                        selectedDate.getMonth() + 1
                      ).padStart(2, "0")}`}
                      onChange={(e) => {
                        const [y, m] = e.target.value.split("-").map(Number);
                        setSelectedDate(
                          stripTime(new Date(y, (m || 1) - 1, 1))
                        );
                        setCalHasSelection(false);
                      }}
                    />
                    {fmt(selectedDate) !== fmt(today) && (
                      <button
                        className="px-2 py-1 rounded-xl bg-indigo-500 text-white text-xs"
                        onClick={() => {
                          setSelectedDate(today);
                          setCalHasSelection(true);
                          lastClickedRef.current = fmt(today);
                        }}
                      >
                        오늘로
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-300">소속</span>
                    <select
                      className="bg-gray-700 rounded-xl p-1 text-xs"
                      value={selectedDepot}
                      onChange={(e) => setSelectedDepot(e.target.value)}
                    >
                      {DEPOTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-300">대상 이름</span>
                    <select
                      className="bg-gray-700 rounded-xl p-1 text-xs"
                      value={tempName || myName}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === myName) setTempName("");
                        else setTempName(val);
                      }}
                    >
                      {[myName, ...nameList.filter((n) => n !== myName)].map(
                        (n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        )
                      )}
                    </select>
                    {tempName && (
                      <button
                        onClick={() => setTempName("")}
                        className="px-2 py-1 rounded-xl bg-orange-700 text-[11px] text-gray-200"
                      >
                        내이름
                      </button>
                    )}
                  </div>
                  {tempName && (
                    <div className="text-[11px] text-yellow-400">
                      {tempName}님의 근무표 임시 보기 중
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-gray-300 mb-1">
                  {["일", "월", "화", "수", "목", "금", "토"].map((w, idx) => (
                    <div
                      key={w}
                      className={
                        "py-0.5 " +
                        (idx === 6
                          ? "text-blue-400"
                          : idx === 0
                          ? "text-red-400"
                          : "text-white")
                      }
                    >
                      {w}
                    </div>
                  ))}
                </div>

                <div
                  className="select-none overflow-hidden"
                  onTouchStart={onCalTouchStart}
                  onTouchMove={onCalTouchMove}
                  onTouchEnd={onCalTouchEnd}
                >
                  <div
                    ref={gridWrapRef}
                    className="flex"
                    style={{
                      width: "300%",
                      transform: `translateX(calc(-33.333% + ${dragX}px))`,
                      transition: isSnapping
                        ? "transform 320ms ease-out"
                        : "none",
                      willChange: "transform",
                    }}
                  >
                    {[-1, 0, 1].map((offset) => {
                      const monthDate = addMonthsSafe(selectedDate, offset);
                      const monthDays = monthGridSunday(monthDate);
                      const thisMonthIdx = monthDate.getMonth();
                      const lastCellIdx = (() => {
                        let last = 0;
                        for (let i = 0; i < monthDays.length; i++) {
                          if (monthDays[i].getMonth() === thisMonthIdx)
                            last = i;
                        }
                        return last;
                      })();
                      const actualRows = Math.floor(lastCellIdx / 7) + 1;
                      return (
                        <div
                          key={offset}
                          className="grid grid-cols-7 gap-1 px-1 py-1 box-border flex-shrink-0"
                          style={{
                            width: "calc(100% / 3)",
                            height: "100%",
                            gridTemplateRows: "repeat(6, minmax(0,1fr))",
                          }}
                        >
                          {monthDays.map((d, i) => {
                            const rowIndex = Math.floor(i / 7),
                              isHiddenRow = rowIndex >= actualRows;
                            const isoD = fmt(d),
                              isToday = isoD === fmt(today),
                              isSelected =
                                calHasSelection && isoD === fmt(selectedDate);
                            const isOutside = d.getMonth() !== thisMonthIdx;
                            const activeName = tempName || myName;
                            const row = rowAtDateForNameWithOverride(
                              activeName,
                              d
                            );
                            const t = computeInOut(row, d, holidaySet);
                            const diaLabel =
                              row?.dia == null
                                ? "-"
                                : (hasOverride(selectedDepot, d, activeName)
                                    ? "*"
                                    : "") +
                                  (typeof row.dia === "number"
                                    ? `${row.dia}D`
                                    : String(row.dia));
                            const dayType = getDayType(d, holidaySet);
                            const dayColor =
                              dayType === "토"
                                ? "text-blue-400"
                                : dayType === "휴"
                                ? "text-red-400"
                                : "text-gray-100";
                            // 🌙 색상: computeInOut 의 isNight 로 통일 (worktime 기반)
                            //   - 야간 → 하늘색
                            //   - 일반 근무 → 노란색
                            //   - 비번/휴무 → 색 없음
                            let diaColorClass = "";
                            const diaStr = String(row?.dia || "").replace(
                              /\s/g,
                              ""
                            );
                            const isOff =
                              !diaStr ||
                              diaStr.startsWith("휴") ||
                              diaStr.includes("비번") ||
                              diaStr === "비" ||
                              diaStr.endsWith("~");
                            if (!isOff && row?.dia != null) {
                              diaColorClass = t.isNight
                                ? "text-sky-300"
                                : "text-yellow-300";
                            }
                            return (
                              <button
                                key={i}
                                onTouchStart={(e) => {
                                  longPressDidFireRef.current = false;
                                  longPressActiveRef.current = true;
                                  clearTimeout(longPressTimerRef.current);
                                  longPressTimerRef.current = setTimeout(() => {
                                    if (!longPressActiveRef.current) return;
                                    longPressDidFireRef.current = true;
                                    const person = (
                                      tempName ||
                                      myName ||
                                      ""
                                    ).trim();
                                    setDutyModal({
                                      open: true,
                                      date: stripTime(d),
                                      name: person,
                                    });
                                  }, LONG_MS);
                                }}
                                onTouchMove={(e) => {
                                  longPressActiveRef.current = false;
                                  clearTimeout(longPressTimerRef.current);
                                }}
                                onTouchEnd={(e) => {
                                  clearTimeout(longPressTimerRef.current);
                                  longPressActiveRef.current = false;
                                }}
                                onClick={() => {
                                  if (longPressDidFireRef.current) {
                                    longPressDidFireRef.current = false;
                                    return;
                                  }
                                  const iso2 = fmt(d);
                                  if (lastClickedRef.current === iso2) {
                                    setRouteTargetName(
                                      tempName ? tempName : ""
                                    );
                                    setSelectedTab("route");
                                    setRoutePage(0);
                                    setDragYRoute(0);
                                  } else {
                                    setSelectedDate(stripTime(d));
                                    lastClickedRef.current = iso2;
                                    setCalHasSelection(true);
                                  }
                                }}
                                className={
                                  "w-full h-full rounded-lg text-left relative " +
                                  (isHiddenRow
                                    ? " invisible pointer-events-none "
                                    : "") +
                                  (isOutside
                                    ? "bg-gray-800/40 opacity-60"
                                    : "bg-gray-700/60 hover:bg-gray-700")
                                }
                                aria-hidden={isHiddenRow ? "true" : undefined}
                                tabIndex={isHiddenRow ? -1 : 0}
                                style={{ padding: "0.5rem" }}
                                title={`${diaLabel} / ${t.combo}/${t.in}/${t.out}`}
                              >
                                {/* 오늘 빨강 테두리 (항상 유지) */}
                                {isToday && (
                                  <span className="absolute inset-0 rounded-lg ring-2 ring-red-400 pointer-events-none" />
                                )}
                                {/* 선택 파랑 테두리 — 오늘이 아닐 때만 */}
                                {isSelected && !isToday && (
                                  <span className="absolute inset-0 rounded-lg ring-2 ring-blue-400 pointer-events-none" />
                                )}
                                <div>
                                  <div className="flex items-center justify-between">
                                    <div
                                      className={
                                        "font-semibold text-sm " + dayColor
                                      }
                                    >
                                      {d.getDate()}
                                    </div>
                                  </div>
                                  <div
                                    className={
                                      "mt-1 text-[10px] leading-4 " +
                                      (isOutside
                                        ? "text-gray-300"
                                        : "text-gray-100")
                                    }
                                  >
                                    <div
                                      className={`whitespace-nowrap text-[clamp(14px,2.8vw,15px)] leading-tight ${diaColorClass} mb-[4px]`}
                                    >
                                      {diaLabel}
                                    </div>
                                    <div className="flex flex-col gap-[3px] leading-[1.08]">
                                      <div className="whitespace-nowrap text-[clamp(12px,2.6vw,12px)]">
                                        {t.in}
                                      </div>
                                      <div className="whitespace-nowrap text-[clamp(11px,2.6vw,12px)]">
                                        {t.out}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Panel 1: 선택일 전체 교번 */}
              <div
                ref={homePanelRefs[1]}
                className="bg-gray-800 rounded-2xl p-3 shadow"
                style={{ minHeight: slideViewportH }}
              >
                <div
                  className="flex items-center justify-between mb-2"
                  data-no-gesture
                >
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <List className="w-5 h-5" />
                    전체 교번
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="date"
                      className="bg-gray-700 rounded-xl px-2 py-1 text-sm"
                      value={fmt(selectedDate)}
                      onChange={(e) =>
                        setSelectedDate(stripTime(new Date(e.target.value)))
                      }
                    />
                    <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                      {weekdaysKR[(selectedDate.getDay() + 6) % 7]}
                    </span>
                    {fmt(selectedDate) !== fmt(today) && (
                      <button
                        className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs"
                        onClick={() => setSelectedDate(stripTime(new Date()))}
                      >
                        오늘로
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex justify-end mb-2 gap-1.5" data-no-gesture>
                  <button
                    className={
                      "rounded-full px-3 py-1 text-sm font-semibold transition " +
                      (rosterEditMode
                        ? "bg-amber-500 hover:bg-amber-400 text-gray-900"
                        : "bg-gray-700 hover:bg-gray-600 text-gray-100")
                    }
                    onClick={() => setRosterEditMode((v) => !v)}
                  >
                    {rosterEditMode ? "✓ 완료" : "✏️ 수정"}
                  </button>
                  <button
                    className="rounded-full px-3 py-1 text-sm bg-cyan-600 text-white"
                    onClick={() =>
                      setOrderMode((m) =>
                        m === "person" ? "dia" : m === "dia" ? "name" : "person"
                      )
                    }
                  >
                    {orderMode === "person"
                      ? "DIA 순서로 보기"
                      : orderMode === "dia"
                      ? "이름순으로 보기"
                      : "순번으로 보기"}
                  </button>
                </div>
                {rosterEditMode && (
                  <div className="mb-2 p-2 rounded-lg bg-amber-900/30 border border-amber-500/40 text-[11px] text-amber-200">
                    🔧 이름 수정 모드 — 셀을 탭하면 이름 변경 창이 열립니다.
                  </div>
                )}
                {/* 홈 panel1 RosterGrid — onPick 유지 (행로표 이동) */}
                {orderMode === "person" && (
                  <RosterGrid
                    rows={rosterAt(selectedDate)}
                    holidaySet={holidaySet}
                    date={selectedDate}
                    nightDiaThreshold={nightDiaThreshold}
                    highlightMap={highlightMap}
                    onPick={(name) => {
                      setRouteTargetName(name);
                      if (window.triggerRouteTransition)
                        window.triggerRouteTransition();
                      else setSelectedTab("route");
                    }}
                    onEditTap={openPersonEditModal}
                    editMode={rosterEditMode}
                    displayName={displayName}
                    hasNameOverride={hasNameOverride}
                    selectedDepot={selectedDepot}
                    daySwipe={{
                      ref: swipeHomeP1.ref,
                      onStart: swipeHomeP1.onStart,
                      onMove: swipeHomeP1.onMove,
                      onEnd: swipeHomeP1.onEnd(goPrevDay, goNextDay),
                      style: swipeHomeP1.style,
                    }}
                    isOverridden={(name, d) =>
                      hasOverride(selectedDepot, d, name)
                    }
                  />
                )}
                {orderMode === "dia" && (
                  <RosterGrid
                    rows={diaGridRows}
                    holidaySet={holidaySet}
                    date={selectedDate}
                    nightDiaThreshold={nightDiaThreshold}
                    highlightMap={highlightMap}
                    onPick={(name) => {
                      setRouteTargetName(name);
                      if (window.triggerRouteTransition)
                        window.triggerRouteTransition();
                      else setSelectedTab("route");
                    }}
                    onEditTap={openPersonEditModal}
                    editMode={rosterEditMode}
                    displayName={displayName}
                    hasNameOverride={hasNameOverride}
                    selectedDepot={selectedDepot}
                    daySwipe={{
                      ref: swipeHomeP1.ref,
                      onStart: swipeHomeP1.onStart,
                      onMove: swipeHomeP1.onMove,
                      onEnd: swipeHomeP1.onEnd(goPrevDay, goNextDay),
                      style: swipeHomeP1.style,
                    }}
                    isOverridden={(name, d) =>
                      hasOverride(selectedDepot, d, name)
                    }
                  />
                )}
                {orderMode === "name" && (
                  <RosterGrid
                    rows={nameGridRows}
                    holidaySet={holidaySet}
                    date={selectedDate}
                    nightDiaThreshold={nightDiaThreshold}
                    highlightMap={highlightMap}
                    onPick={(name) => {
                      setRouteTargetName(name);
                      triggerRouteTransition();
                    }}
                    onEditTap={openPersonEditModal}
                    editMode={rosterEditMode}
                    displayName={displayName}
                    hasNameOverride={hasNameOverride}
                    selectedDepot={selectedDepot}
                    daySwipe={{
                      ref: swipeRosterP0.ref,
                      onStart: swipeRosterP0.onStart,
                      onMove: swipeRosterP0.onMove,
                      onEnd: swipeRosterP0.onEnd(goPrevDay, goNextDay),
                      style: swipeRosterP0.style,
                    }}
                    isOverridden={(name, d) =>
                      hasOverride(selectedDepot, d, name)
                    }
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* 전체 탭 — onCodeTap 으로 교번 변경 */}
        {selectedTab === "roster" && (
          <div
            className="bg-gray-800 rounded-2xl p-3 shadow mt-4"
            style={{ minHeight: slideViewportH }}
          >
            <div
              className="flex items-center justify-between mb-2"
              data-no-gesture
            >
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <List className="w-5 h-5" />
                전체 교번
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  className="bg-gray-700 rounded-xl px-2 py-1 text-sm"
                  value={fmt(selectedDate)}
                  onChange={(e) =>
                    setSelectedDate(stripTime(new Date(e.target.value)))
                  }
                />
                <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                  {weekdaysKR[(selectedDate.getDay() + 6) % 7]}
                </span>
                {fmt(selectedDate) !== fmt(today) && (
                  <button
                    className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs"
                    onClick={() => setSelectedDate(stripTime(new Date()))}
                  >
                    오늘로
                  </button>
                )}
              </div>
            </div>
            <div
              className="flex items-center justify-between mb-2 gap-2 flex-wrap"
              data-no-gesture
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-300">소속</span>
                <select
                  className="bg-gray-700 rounded-xl px-2 py-1 text-sm"
                  value={selectedDepot}
                  onChange={(e) => setSelectedDepot(e.target.value)}
                >
                  {DEPOTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  className={
                    "rounded-full px-3 py-1 text-sm font-semibold transition " +
                    (rosterEditMode
                      ? "bg-amber-500 hover:bg-amber-400 text-gray-900"
                      : "bg-gray-700 hover:bg-gray-600 text-gray-100")
                  }
                  onClick={() => setRosterEditMode((v) => !v)}
                  title="이름 편집"
                >
                  {rosterEditMode ? "✓ 완료" : "✏️ 수정"}
                </button>
                <button
                  className="rounded-full px-3 py-1 text-sm bg-cyan-600 text-white"
                  onClick={() =>
                    setOrderMode((m) =>
                      m === "person" ? "dia" : m === "dia" ? "name" : "person"
                    )
                  }
                >
                  {orderMode === "person"
                    ? "DIA 순서로 보기"
                    : orderMode === "dia"
                    ? "이름순으로 보기"
                    : "순번으로 보기"}
                </button>
              </div>
            </div>
            {rosterEditMode && (
              <div className="mb-2 p-2 rounded-lg bg-amber-900/30 border border-amber-500/40 text-[11px] text-amber-200">
                🔧 이름 수정 모드 — 셀을 탭하여 이름을 변경하세요.{" "}
                <span className="text-amber-300">"오늘 하루만"</span> 또는{" "}
                <span className="text-amber-300">"영구 개명"</span> 선택 가능.
              </div>
            )}
            {orderMode === "person" && (
              <RosterGrid
                rows={rosterAt(selectedDate)}
                holidaySet={holidaySet}
                date={selectedDate}
                nightDiaThreshold={nightDiaThreshold}
                highlightMap={highlightMap}
                onPick={(name) => {
                  setRouteTargetName(name);
                  if (window.triggerRouteTransition)
                    window.triggerRouteTransition();
                  else setSelectedTab("route");
                }}
                onEditTap={openPersonEditModal}
                editMode={rosterEditMode}
                displayName={displayName}
                hasNameOverride={hasNameOverride}
                selectedDepot={selectedDepot}
                daySwipe={{
                  ref: swipeRosterP0.ref,
                  onStart: swipeRosterP0.onStart,
                  onMove: swipeRosterP0.onMove,
                  onEnd: swipeRosterP0.onEnd(goPrevDay, goNextDay),
                  style: swipeRosterP0.style,
                }}
                isOverridden={(name, d) => hasOverride(selectedDepot, d, name)}
              />
            )}
            {orderMode === "dia" && (
              <RosterGrid
                rows={diaGridRows}
                holidaySet={holidaySet}
                date={selectedDate}
                nightDiaThreshold={nightDiaThreshold}
                highlightMap={highlightMap}
                onPick={(name) => {
                  setRouteTargetName(name);
                  if (window.triggerRouteTransition)
                    window.triggerRouteTransition();
                  else setSelectedTab("route");
                }}
                onEditTap={openPersonEditModal}
                editMode={rosterEditMode}
                displayName={displayName}
                hasNameOverride={hasNameOverride}
                selectedDepot={selectedDepot}
                daySwipe={{
                  ref: swipeRosterP0.ref,
                  onStart: swipeRosterP0.onStart,
                  onMove: swipeRosterP0.onMove,
                  onEnd: swipeRosterP0.onEnd(goPrevDay, goNextDay),
                  style: swipeRosterP0.style,
                }}
                isOverridden={(name, d) => hasOverride(selectedDepot, d, name)}
              />
            )}
            {orderMode === "name" && (
              <RosterGrid
                rows={nameGridRows}
                holidaySet={holidaySet}
                date={selectedDate}
                nightDiaThreshold={nightDiaThreshold}
                highlightMap={highlightMap}
                onPick={(name) => {
                  setRouteTargetName(name);
                  if (window.triggerRouteTransition)
                    window.triggerRouteTransition();
                  else setSelectedTab("route");
                }}
                onEditTap={openPersonEditModal}
                editMode={rosterEditMode}
                displayName={displayName}
                hasNameOverride={hasNameOverride}
                selectedDepot={selectedDepot}
                daySwipe={{
                  ref: swipeRosterP0.ref,
                  onStart: swipeRosterP0.onStart,
                  onMove: swipeRosterP0.onMove,
                  onEnd: swipeRosterP0.onEnd(goPrevDay, goNextDay),
                  style: swipeRosterP0.style,
                }}
                isOverridden={(name, d) => hasOverride(selectedDepot, d, name)}
              />
            )}
          </div>
        )}

        {/* 행로 탭 */}
        {selectedTab === "route" && (
          <div
            ref={routeWrapRef}
            className="mt-4 select-none overflow-hidden rounded-2xl overscroll-contain"
            style={{
              height: slideViewportH,
              touchAction: isRouteLocked ? "none" : "pan-y",
            }}
            onTouchStart={vRoute.onStart}
            onTouchMove={vRoute.onMove}
            onTouchEnd={vRoute.onEnd}
            onTouchCancel={vRoute.onCancel}
            onWheel={(e) => {
              if (isRouteLocked) e.preventDefault();
              if (snapYRoute) return;
              const TH = 40;
              if (e.deltaY > TH && routePage < 3) {
                setSnapYRoute(true);
                setDragYRoute(-(routeWrapRef.current?.offsetHeight || 500));
                setTimeout(() => {
                  setRoutePage((p) => Math.min(p + 1, 3));
                  setSnapYRoute(false);
                  setDragYRoute(0);
                }, V_SNAP_MS);
              } else if (e.deltaY < -TH && routePage > 0) {
                setSnapYRoute(true);
                setDragYRoute(routeWrapRef.current?.offsetHeight || 500);
                setTimeout(() => {
                  setRoutePage((p) => Math.max(p - 1, 0));
                  setSnapYRoute(false);
                  setDragYRoute(0);
                }, V_SNAP_MS);
              }
            }}
          >
            <div
              className="relative"
              style={{
                transform: `translateY(${
                  -routePage * slideViewportH + dragYRoute
                }px)`,
                transition: snapYRoute
                  ? `transform ${V_SNAP_MS}ms ease-out`
                  : "none",
                willChange: "transform",
              }}
              onTransitionEnd={vRoute.onTransitionEnd}
            >
              {/* Panel 0: 행로 카드 */}
              <div
                id="route-panel0"
                ref={routePanelRefs[0]}
                className="bg-gray-800 rounded-2xl p-3 shadow mb-10"
                style={{ minHeight: slideViewportH }}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <User className="w-5 h-5" />
                    행로표 ({routeTarget})
                  </h2>
                  <div className="flex gap-2 items-center">
                    <select
                      className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                      value={selectedDepot}
                      onChange={(e) => setSelectedDepot(e.target.value)}
                    >
                      {DEPOTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                      value={fmt(selectedDate)}
                      onChange={(e) =>
                        setSelectedDate(stripTime(new Date(e.target.value)))
                      }
                    />
                    <span className="text-[11px] text-gray-300">{wk}</span>
                    {fmt(selectedDate) !== fmt(today) && (
                      <button
                        className="px-2 py-1 rounded-xl bg-indigo-500 text-white text-xs"
                        onClick={() => setSelectedDate(stripTime(new Date()))}
                      >
                        오늘로
                      </button>
                    )}
                    {routeTargetName && (
                      <button
                        className="px-2 py-1 rounded-xl bg-orange-700 text-xs"
                        onClick={() => setRouteTargetName("")}
                      >
                        내이름
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-sm text-gray-300">대상 이름</span>
                  <select
                    className="bg-gray-700 rounded-xl p-1 text-sm"
                    value={routeTarget}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === myName) setRouteTargetName("");
                      else setRouteTargetName(v);
                    }}
                  >
                    {[myName, ...nameList.filter((n) => n !== myName)].map(
                      (n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      )
                    )}
                  </select>
                  <div className="ml-auto mr-1 flex items-center gap-2">
                    <span className="text-xs text-gray-400">전화번호</span>
                    {routeTargetPhone ? (
                      <a
                        href={`tel:${String(routeTargetPhone).replace(
                          /[^0-9+]/g,
                          ""
                        )}`}
                        className="text-xs px-2 py-1 rounded-xl bg-emerald-600 text-white"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {routeTargetPhone}
                      </a>
                    ) : (
                      <span className="text-xs text-gray-500">번호없음</span>
                    )}
                  </div>
                </div>
                <div
                  className="p-3 rounded-xl bg-gray-900/60 text-sm mt-3"
                  ref={swipeRouteP0.ref}
                  onTouchStart={swipeRouteP0.onStart}
                  onTouchMove={swipeRouteP0.onMove}
                  onTouchEnd={swipeRouteP0.onEnd(goPrevDay, goNextDay)}
                  style={swipeRouteP0.style}
                >
                  {/* ✅ 새 방식: RouteImageView (v3 - common 전체 전달) */}
                  <RouteImageView
                    paths={currentPaths}
                    common={currentCommonData}
                    depot={selectedDepot}
                    code={routeCodeStr}
                    dateStr={fmt(selectedDate)}
                    holidaySet={holidaySet}
                    busImageSrc={defaultBusMap[selectedDepot]}
                    scale={routeScale}
                    onScaleChange={(v) =>
                      setRouteScaleForDepot(selectedDepot, v)
                    }
                  />
                </div>
              </div>

              {/* Panel 1: 전체 교번 — onCodeTap */}
              <div
                ref={routePanelRefs[1]}
                className="bg-gray-800 rounded-2xl p-3 shadow mb-16"
                style={{ minHeight: slideViewportH }}
              >
                <div
                  className="flex items-center justify-between mb-2"
                  data-no-gesture
                >
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <List className="w-5 h-5" />
                    전체 교번
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="date"
                      className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                      value={fmt(selectedDate)}
                      onChange={(e) =>
                        setSelectedDate(stripTime(new Date(e.target.value)))
                      }
                    />
                    <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                      {wk}
                    </span>
                    {fmt(selectedDate) !== fmt(today) && (
                      <button
                        className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs"
                        onClick={() => setSelectedDate(stripTime(new Date()))}
                      >
                        오늘로
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className="flex items-center justify-between mb-2 gap-2 flex-wrap"
                  data-no-gesture
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-300">소속</span>
                    <select
                      className="bg-gray-700 rounded-xl px-2 py-1 text-sm"
                      value={selectedDepot}
                      onChange={(e) => setSelectedDepot(e.target.value)}
                    >
                      {DEPOTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      className={
                        "rounded-full px-3 py-1 text-sm font-semibold transition " +
                        (rosterEditMode
                          ? "bg-amber-500 hover:bg-amber-400 text-gray-900"
                          : "bg-gray-700 hover:bg-gray-600 text-gray-100")
                      }
                      onClick={() => setRosterEditMode((v) => !v)}
                    >
                      {rosterEditMode ? "✓ 완료" : "✏️ 수정"}
                    </button>
                    <button
                      className="rounded-full px-3 py-1 text-sm bg-cyan-600 text-white"
                      onClick={() =>
                        setOrderMode((m) =>
                          m === "person"
                            ? "dia"
                            : m === "dia"
                            ? "name"
                            : "person"
                        )
                      }
                    >
                      {orderMode === "person"
                        ? "DIA 순서로 보기"
                        : orderMode === "dia"
                        ? "이름순으로 보기"
                        : "순번으로 보기"}
                    </button>
                  </div>
                </div>
                {rosterEditMode && (
                  <div className="mb-2 p-2 rounded-lg bg-amber-900/30 border border-amber-500/40 text-[11px] text-amber-200">
                    🔧 이름 수정 모드 — 셀을 탭하면 이름 변경 창이 열립니다.
                  </div>
                )}
                {orderMode === "person" && (
                  <RosterGrid
                    rows={rosterAt(selectedDate)}
                    holidaySet={holidaySet}
                    date={selectedDate}
                    nightDiaThreshold={nightDiaThreshold}
                    highlightMap={highlightMap}
                    onPick={(name) => {
                      setRouteTargetName(name);
                      if (window.triggerRouteTransition)
                        window.triggerRouteTransition();
                      else setSelectedTab("route");
                    }}
                    onEditTap={openPersonEditModal}
                    editMode={rosterEditMode}
                    displayName={displayName}
                    hasNameOverride={hasNameOverride}
                    selectedDepot={selectedDepot}
                    daySwipe={{
                      ref: swipeRouteP1.ref,
                      onStart: swipeRouteP1.onStart,
                      onMove: swipeRouteP1.onMove,
                      onEnd: swipeRouteP1.onEnd(goPrevDay, goNextDay),
                      style: swipeRouteP1.style,
                    }}
                    isOverridden={(name, d) =>
                      hasOverride(selectedDepot, d, name)
                    }
                  />
                )}
                {orderMode === "dia" && (
                  <RosterGrid
                    rows={diaGridRows}
                    holidaySet={holidaySet}
                    date={selectedDate}
                    nightDiaThreshold={nightDiaThreshold}
                    highlightMap={highlightMap}
                    onPick={(name) => {
                      setRouteTargetName(name);
                      if (window.triggerRouteTransition)
                        window.triggerRouteTransition();
                      else setSelectedTab("route");
                    }}
                    onEditTap={openPersonEditModal}
                    editMode={rosterEditMode}
                    displayName={displayName}
                    hasNameOverride={hasNameOverride}
                    selectedDepot={selectedDepot}
                    daySwipe={{
                      ref: swipeRouteP1.ref,
                      onStart: swipeRouteP1.onStart,
                      onMove: swipeRouteP1.onMove,
                      onEnd: swipeRouteP1.onEnd(goPrevDay, goNextDay),
                      style: swipeRouteP1.style,
                    }}
                    isOverridden={(name, d) =>
                      hasOverride(selectedDepot, d, name)
                    }
                  />
                )}
                {orderMode === "name" && (
                  <RosterGrid
                    rows={nameGridRows}
                    holidaySet={holidaySet}
                    date={selectedDate}
                    nightDiaThreshold={nightDiaThreshold}
                    highlightMap={highlightMap}
                    onPick={(name) => {
                      setRouteTargetName(name);
                      if (window.triggerRouteTransition)
                        window.triggerRouteTransition();
                      else setSelectedTab("route");
                    }}
                    onEditTap={openPersonEditModal}
                    editMode={rosterEditMode}
                    displayName={displayName}
                    hasNameOverride={hasNameOverride}
                    selectedDepot={selectedDepot}
                    daySwipe={{
                      ref: swipeRosterP0.ref,
                      onStart: swipeRosterP0.onStart,
                      onMove: swipeRosterP0.onMove,
                      onEnd: swipeRosterP0.onEnd(goPrevDay, goNextDay),
                      style: swipeRosterP0.style,
                    }}
                    isOverridden={(name, d) =>
                      hasOverride(selectedDepot, d, name)
                    }
                  />
                )}
              </div>

              {/* Panel 2: 알람 */}
              <div
                ref={routePanelRefs[2]}
                className="bg-gray-800 rounded-2xl p-3 shadow mb-16"
                style={{ minHeight: slideViewportH }}
              >
                <div
                  className="flex items-center justify-between mb-2"
                  data-no-gesture
                >
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <AlarmCheckIcon className="w-5 h-5" />
                    출근/중간(1/2)
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="date"
                      className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                      value={fmt(selectedDate)}
                      onChange={(e) =>
                        setSelectedDate(stripTime(new Date(e.target.value)))
                      }
                    />
                    <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                      {wk}
                    </span>
                    {fmt(selectedDate) !== fmt(today) && (
                      <button
                        className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs"
                        onClick={() => setSelectedDate(stripTime(new Date()))}
                      >
                        오늘로
                      </button>
                    )}
                  </div>
                </div>
                <div
                  ref={swipeRouteP2.ref}
                  onTouchStart={swipeRouteP2.onStart}
                  onTouchMove={swipeRouteP2.onMove}
                  onTouchEnd={swipeRouteP2.onEnd(goPrevDay, goNextDay)}
                  style={swipeRouteP2.style}
                  className="rounded-xl bg-gray-900/60 p-3"
                >
                  <WakeIcsPanel
                    dateObj={selectedDate}
                    who={routeTarget}
                    startHM={startHM ?? toHMorNull(routeIn)}
                    endHM={endHM ?? toHMorNull(routeOut)}
                    rawLabel={routeIn}
                  />
                </div>
              </div>

              {/* Panel 3: 중간 알람 */}
              <div
                ref={routePanelRefs[3]}
                className="bg-gray-800 rounded-2xl p-3 shadow mb-16"
                style={{ minHeight: slideViewportH }}
              >
                <div
                  className="flex items-center justify-between mb-2"
                  data-no-gesture
                >
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <AlarmCheckIcon className="w-5 h-5" />
                    출근/중간(2/2)
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="date"
                      className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                      value={fmt(selectedDate)}
                      onChange={(e) =>
                        setSelectedDate(stripTime(new Date(e.target.value)))
                      }
                    />
                    <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                      {wk}
                    </span>
                    {fmt(selectedDate) !== fmt(today) && (
                      <button
                        className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs"
                        onClick={() => setSelectedDate(stripTime(new Date()))}
                      >
                        오늘로
                      </button>
                    )}
                  </div>
                </div>
                <div
                  ref={swipeRouteP3.ref}
                  onTouchStart={swipeRouteP3.onStart}
                  onTouchMove={swipeRouteP3.onMove}
                  onTouchEnd={swipeRouteP3.onEnd(goPrevDay, goNextDay)}
                  style={swipeRouteP3.style}
                  className="rounded-xl bg-gray-900/60 p-3"
                >
                  <WakeMidPanel
                    selectedDate={selectedDate}
                    selectedDepot={selectedDepot}
                    routeCombo={routeT?.combo || ""}
                    routeDia={routeRow?.dia ?? null}
                    row={routeRow}
                    shortcutName="교번-알람-만들기"
                    commonData={currentCommonData}
                    holidaySet={holidaySet}
                    routeCode={routeCodeStr}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 그룹(비교) 탭 */}
        {selectedTab === "compare" && (
          <CompareWeeklyBoard
            {...{
              selectedDepot,
              selectedDate,
              setSelectedDate,
              nameList,
              myName,
              holidaySet,
              monthGridMonday,
              computeInOut,
              compareSelected,
              setCompareSelected,
              slideViewportH,
              tablesByDepot,
              commonMap,
              anchorDateByDepot,
              highlightMap,
              overridesByDepot,
              labelTemplates,
              diaTemplates,
            }}
          />
        )}

        {/* 설정 탭 */}
        {selectedTab === "settings" && (
          <React.Suspense fallback={<div className="p-4">로딩…</div>}>
            <SettingsView
              {...{
                selectedDepot,
                setSelectedDepot,
                myName,
                setMyNameForDepot,
                nameList,
                anchorDateStr: anchorDateByDepot[selectedDepot] ?? fmt(today),
                setAnchorDateStr: (v) =>
                  setAnchorDateStrForDepot(selectedDepot, v),
                holidaysText,
                setHolidaysText,
                newHolidayDate,
                setNewHolidayDate,
                nightDiaByDepot,
                setNightDiaForDepot,
                routeScaleByDepot,
                setRouteScaleForDepot,
                highlightMap,
                setHighlightMap,
                currentTableText,
                setTablesByDepot,
                selectedDate,
                setSelectedDate,
                DEPOTS,
                DEFAULT_HOLIDAYS_25_26,
                onUpload,
                buildGyodaeTable,
                theme,
                setTheme,
                onOpenSetupWizard: () => setShowSetupWizard(true),
                onResetAll: resetAll,
                commonMap,
                setCommonMap,
                peopleRows,
              }}
            />
          </React.Suspense>
        )}

        {/* 하단 탭바 */}
        <FixedTabbarPortal>
          <nav
            ref={tabbarRef}
            className="bg-gray-900/90 backdrop-blur-md border-t border-gray-700 fixed left-0 right-0 bottom-0 pt-3 pb-[0]"
          >
            <div className="flex justify-around items-center text-gray-300 text-xs">
              <button
                onClick={() => {
                  const alreadyHome = selectedTab === "home";
                  setHomePage(0);
                  setDragYHome(0);
                  setSnapYHome(false);
                  if (alreadyHome) {
                    const t = new Date();
                    t.setHours(0, 0, 0, 0);
                    setSelectedDate(t);
                    return;
                  }
                  setSelectedTab("home");
                }}
                className={`flex flex-col items-center ${
                  selectedTab === "home" ? "text-blue-400" : "text-gray-300"
                }`}
              >
                <CalendarIcon className="w-5 h-5 mb-0" />홈
              </button>
              <button
                onClick={() => setSelectedTab("roster")}
                className={`flex flex-col items-center ${
                  selectedTab === "roster" ? "text-blue-400" : "text-gray-300"
                }`}
              >
                <List className="w-5 h-5 mb-0" />
                전체
              </button>
              <button
                onClick={() => {
                  setRoutePage(0);
                  setDragYRoute(0);
                  setSnapYRoute(false);
                  setSelectedTab("route");
                }}
                className={`flex flex-col items-center ${
                  selectedTab === "route" ? "text-blue-400" : "text-gray-300"
                }`}
              >
                <RouteIcon className="w-5 h-5 mb-0" strokeWidth={1.75} />
                행로
              </button>
              <button
                onClick={() => setSelectedTab("compare")}
                className={`flex flex-col items-center ${
                  selectedTab === "compare" ? "text-blue-400" : "text-gray-300"
                }`}
              >
                <Users className="w-5 h-5 mb-0" />
                그룹
              </button>
              <button
                onClick={() => setSelectedTab("settings")}
                className={`flex flex-col items-center ${
                  selectedTab === "settings" ? "text-blue-400" : "text-gray-300"
                }`}
              >
                <Settings className="w-5 h-5 mb-0" />
                설정
              </button>
            </div>
          </nav>
        </FixedTabbarPortal>
      </div>

      <DutyModal />

      {/* ✅ SetupWizard — ZIP/TSV 초기설정 */}
      {showSetupWizard && (
        <div className="fixed inset-0 z-[99999] bg-gray-900 overflow-y-auto">
          <SetupWizard
            onComplete={handleSetupComplete}
            existingTsvData={commonMap}
            defaultDepot={selectedDepot}
          />
        </div>
      )}

      {/* ✅ 근무자 편집 모달 (이름 + 교번) */}
      <PersonEditModal
        open={personEditModal.open}
        oldName={personEditModal.oldName}
        oldCode={personEditModal.oldCode}
        baseName={personEditModal.baseName}
        baseCode={personEditModal.baseCode}
        hasTodayCode={personEditModal.hasTodayCode}
        hasTodayName={personEditModal.hasTodayName}
        nameList={nameList}
        codeList={currentGyobunList}
        codeOwnerMap={codeOwnerMap}
        onClose={() =>
          setPersonEditModal({
            open: false,
            oldName: "",
            oldCode: "",
            baseName: "",
            baseCode: "",
            hasTodayCode: false,
            hasTodayName: false,
          })
        }
        onResetToday={(kind) => {
          // kind: "name" | "code"
          const name = personEditModal.oldName;
          const iso = fmt(stripTime(new Date(selectedDate)));
          if (kind === "code") {
            setOverride(
              selectedDepot,
              stripTime(new Date(selectedDate)),
              name,
              null
            );
          } else if (kind === "name") {
            setNameOverridesByDepot((prev) => {
              const depotMap = { ...(prev?.[selectedDepot] || {}) };
              const dayMap = { ...(depotMap[iso] || {}) };
              delete dayMap[name];
              if (Object.keys(dayMap).length === 0) delete depotMap[iso];
              else depotMap[iso] = dayMap;
              return { ...prev, [selectedDepot]: depotMap };
            });
          }
          setPersonEditModal({
            open: false,
            oldName: "",
            oldCode: "",
            baseName: "",
            baseCode: "",
            hasTodayCode: false,
            hasTodayName: false,
          });
        }}
        onApply={async ({ newName, newCode }, scope) => {
          const oldName = personEditModal.oldName;
          // 영구 개명 시 oldName→newName 이관이 일어나므로,
          // 교번 override 대상 이름은 "영구 개명 후 이름"으로 잡는다.
          const targetName =
            newName && scope === "permanent" ? newName : oldName;

          // 1) 이름 변경
          if (newName) {
            if (scope === "today") {
              applyTodayRename(oldName, newName, selectedDate);
            } else {
              await applyPermanentRename(oldName, newName);
            }
          }

          // 2) 교번 변경
          if (newCode) {
            if (scope === "today") {
              // 오늘 하루만 — overridesByDepot에 저장
              setOverride(
                selectedDepot,
                stripTime(new Date(selectedDate)),
                targetName,
                newCode
              );
            } else {
              // 영구 교번 변경 — names 배열 swap 방식
              //
              // 원리:
              //   gyobun[] 배열은 위치 고정 (각 index = 특정 교번).
              //   anchor=today, dd=0 이므로 오늘 names[i] 의 교번 = gyobun[i].
              //   따라서 "김철수를 7번 교번으로" = names 배열에서
              //   김철수가 있던 idx와 gyobun[j]=="7d" 인 j 의 이름을 swap.
              const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
              const common = commonMap?.[key];
              if (common?.names?.length && common?.gyobun?.length) {
                const norm = (s) => String(s || "").replace(/\s/g, "");
                const srcIdx = common.names.findIndex(
                  (n) => norm(n) === norm(targetName)
                );
                // newCode 가 위치한 index 찾기 (대소문자 무시)
                const normCode = (c) =>
                  String(c || "")
                    .toLowerCase()
                    .replace(/\s/g, "");
                const targetCodeIdx = common.gyobun.findIndex(
                  (c) => normCode(c) === normCode(newCode)
                );

                if (srcIdx < 0 || targetCodeIdx < 0) {
                  // 못 찾으면 그냥 리턴
                } else if (srcIdx === targetCodeIdx) {
                  // 이미 그 자리 — 할 일 없음
                } else {
                  const swapName = common.names[targetCodeIdx];
                  // 빈자리(이름 없음)면 확인 없이 진행
                  const needConfirm = !!(swapName && swapName.trim());
                  const ok = needConfirm
                    ? window.confirm(
                        `"${targetName}"을(를) 교번 ${newCode} 자리로 옮기면\n` +
                          `현재 그 자리에 있는 "${swapName}"은(는) ` +
                          `교번 ${common.gyobun[srcIdx]} 자리로 이동합니다.\n\n` +
                          `두 사람의 자리를 서로 바꾸시겠습니까?`
                      )
                    : true;
                  if (!ok) return;

                  // names swap
                  const newNames = [...common.names];
                  newNames[srcIdx] = swapName;
                  newNames[targetCodeIdx] = targetName;

                  // phones 도 함께 swap
                  const oldPhones = common.phones || [];
                  const newPhones = [...oldPhones];
                  if (oldPhones.length === common.names.length) {
                    newPhones[srcIdx] = oldPhones[targetCodeIdx] || "";
                    newPhones[targetCodeIdx] = oldPhones[srcIdx] || "";
                  }

                  const nextMap = {
                    ...commonMap,
                    [key]: { ...common, names: newNames, phones: newPhones },
                  };
                  setCommonMap(nextMap);
                  try {
                    await saveCommonDataToDB(nextMap);
                  } catch {}

                  // TSV 동기화 — 이름 컬럼(cols[1])만 swap (gyobun=dia 컬럼은 그대로)
                  setTablesByDepot((prev) => {
                    const tsv = prev?.[selectedDepot];
                    if (!tsv) return prev;
                    const lines = tsv.split(/\r?\n/);
                    const aLine = srcIdx + 1;
                    const bLine = targetCodeIdx + 1;
                    if (lines.length > Math.max(aLine, bLine)) {
                      const aCols = lines[aLine].split("\t");
                      const bCols = lines[bLine].split("\t");
                      if (aCols.length >= 2 && bCols.length >= 2) {
                        const tmp = aCols[1];
                        aCols[1] = bCols[1];
                        bCols[1] = tmp;
                        lines[aLine] = aCols.join("\t");
                        lines[bLine] = bCols.join("\t");
                        return {
                          ...prev,
                          [selectedDepot]: lines.join("\n"),
                        };
                      }
                    }
                    return prev;
                  });

                  // 해당 날짜에 걸려있던 일시 override는 swap된 두 이름 모두 해제
                  setOverride(
                    selectedDepot,
                    stripTime(new Date(selectedDate)),
                    targetName,
                    null
                  );
                  if (swapName) {
                    setOverride(
                      selectedDepot,
                      stripTime(new Date(selectedDate)),
                      swapName,
                      null
                    );
                  }
                }
              }
            }
          }
        }}
      />
    </div>
  );
}

/* ─── 공통 컴포넌트 ─── */

function RosterGrid({
  rows,
  holidaySet,
  date,
  nightDiaThreshold,
  highlightMap,
  onPick,
  onCodeTap,
  onEditTap, // 수정 모드에서 셀 탭시 (name, row) 전달
  editMode = false, // 이름 수정 모드 on/off
  displayName, // (name, date) => 표시 이름 (override 반영)
  hasNameOverride, // (depot, date, name) => boolean
  daySwipe,
  selectedDepot,
  isOverridden,
}) {
  const [selectedName, setSelectedName] = React.useState(null);
  return (
    <div
      className="grid gap-1"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))",
        ...(daySwipe?.style || {}),
      }}
      ref={daySwipe?.ref}
      onTouchStart={daySwipe?.onStart}
      onTouchMove={daySwipe?.onMove}
      onTouchEnd={daySwipe?.onEnd}
    >
      {rows.map(({ name, row }) => {
        const t = computeInOut(row, date, holidaySet, nightDiaThreshold);
        const diaLabel =
          row?.dia == null
            ? "-"
            : (isOverridden?.(name, date) ? "*" : "") +
              (typeof row.dia === "number" ? String(row.dia) : String(row.dia));
        const color = highlightMap?.[name];
        const isHighlighted = !!color;
        const style = isHighlighted
          ? {
              backgroundColor: color,
              color: "#ffffff",
              WebkitTextFillColor: "#ffffff",
              "--tw-text-opacity": "1",
            }
          : {};
        const isSelected = selectedName === name;

        // 표시할 이름 (override 적용)
        const shownName = displayName ? displayName(name, date) : name;
        const hasNameOv = !!hasNameOverride?.(selectedDepot, date, name);

        return (
          <button
            key={name}
            onClick={(e) => {
              // 편집 모드면 PersonEditModal 열기 우선
              if (editMode && onEditTap) {
                onEditTap(name, row);
                return;
              }
              if (onCodeTap) {
                // 전체탭/행로탭: 교번 변경 피커 열기
                onCodeTap(name, row?.dia, selectedDepot);
              } else if (onPick) {
                // 홈탭: 기존 행로표 이동 (onPick 직접 호출)
                setSelectedName(name);
                const btn = e.currentTarget;
                btn.animate(
                  [
                    {
                      transform: "scale(1)",
                      filter: "brightness(1)",
                      opacity: 1,
                    },
                    {
                      transform: "scale(1.15)",
                      filter: "brightness(1.4)",
                      boxShadow: "0 0 18px rgba(255,255,255,0.9)",
                      opacity: 1,
                    },
                    {
                      transform: "scale(1)",
                      filter: "brightness(1)",
                      opacity: 1,
                    },
                  ],
                  { duration: 300, easing: "cubic-bezier(0.22,1,0.36,1)" }
                );
                setTimeout(() => {
                  onPick(name);
                }, 130);
              }
            }}
            className={
              "aspect-square w-full rounded-lg p-1.5 text-left transition-all duration-200 relative " +
              (isSelected
                ? "ring-4 ring-white/80 shadow-[0_0_10px_rgba(255,255,255,0.4)] "
                : editMode
                ? "bg-amber-900/40 hover:bg-amber-800/60 ring-1 ring-amber-500/60 "
                : "bg-gray-700/80 hover:bg-gray-600 hover:shadow-[0_0_6px_rgba(255,255,255,0.3)]") +
              (isHighlighted ? " roster-person-colored" : "")
            }
            style={style}
            title={`${shownName} • ${diaLabel} • ${t.combo}${
              t.isNight ? " (야)" : ""
            }`}
          >
            {editMode && (
              <span className="absolute top-0.5 left-0.5 text-[9px]">✏️</span>
            )}
            <div className="text-[11px] font-semibold whitespace-nowrap w-full text-center">
              {hasNameOv ? "*" : ""}
              {shownName}
            </div>
            <div className="text-[12px] font-extrabold text-gray-200 whitespace-nowrap">
              {diaLabel}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FixedTabbarPortal({ children }) {
  const mountRef = React.useRef(null);
  if (!mountRef.current && typeof document !== "undefined")
    mountRef.current = document.createElement("div");
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.right = "0";
    el.style.bottom = "0";
    el.style.zIndex = "9999";
    el.style.width = "100%";
    el.style.pointerEvents = "none";
    el.style.transform = "translateY(0)";
    el.style.willChange = "transform";
    document.body.appendChild(el);
    const vv = window.visualViewport;
    const isEditableFocused = () => {
      const ae = document.activeElement;
      if (!ae) return false;
      const tag = (ae.tagName || "").toLowerCase();
      return (
        tag === "input" || tag === "textarea" || ae.isContentEditable === true
      );
    };
    const sync = () => {
      if (!vv) return;
      const layoutH = window.innerHeight,
        visibleH = vv.height + vv.offsetTop,
        deficit = Math.max(0, layoutH - visibleH);
      const looksLikeKeyboard = isEditableFocused() && deficit >= 260;
      el.style.transform = looksLikeKeyboard
        ? `translateY(${-deficit}px)`
        : "translateY(0)";
      el.style.bottom = "0px";
    };
    sync();
    const onResize = () => sync(),
      onFocusIn = () => sync(),
      onFocusOut = () => setTimeout(sync, 0);
    vv?.addEventListener("resize", onResize, { passive: true });
    vv?.addEventListener("scroll", onResize, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      try {
        el.remove();
      } catch {}
    };
  }, []);
  return mountRef.current
    ? createPortal(
        <div style={{ pointerEvents: "auto" }}>{children}</div>,
        mountRef.current
      )
    : null;
} // CompareWeeklyBoard — commonMap 기반 row + 단일 야간 판정 (worktime)
// v2: 세로 스와이프 제거, 좌/우 스와이프로 "주 단위" 이동 (월 경계 자동 넘김)
//     인원이 많으면 내부 영역 자체가 스크롤 가능
function CompareWeeklyBoard({
  selectedDepot,
  selectedDate,
  setSelectedDate,
  nameList,
  myName,
  holidaySet,
  monthGridMonday,
  computeInOut,
  highlightMap,
  tablesByDepot,
  commonMap,
  anchorDateByDepot,
  compareSelected,
  setCompareSelected,
  slideViewportH,
  overridesByDepot,
  labelTemplates,
  diaTemplates,
}) {
  const isOverridden = React.useCallback(
    (name, depot, date) => {
      const iso = fmt(stripTime(new Date(date)));
      return overridesByDepot?.[depot]?.[iso]?.[name] != null;
    },
    [overridesByDepot]
  );
  const parsedByDepot = React.useMemo(() => {
    const map = {};
    for (const depot of DEPOTS) {
      const key = DEPOT_TO_ZIP_KEY[depot] || depot;
      const common = commonMap?.[key];
      if (common?.names?.length && common?.gyobun?.length) {
        const splitWT = (wt) => {
          const s = String(wt || "").replace(/\s/g, "");
          if (!s || s === "----") return { in: "", out: "" };
          const parts = s.split("-");
          return { in: parts[0] || "", out: parts[1] || "" };
        };
        const wtFor = (code) => {
          const k = String(code || "")
            .trim()
            .toLowerCase();
          return {
            weekday: splitWT(common.worktime?.nor?.[k] || "----"),
            saturday: splitWT(common.worktime?.sat?.[k] || "----"),
            holiday: splitWT(common.worktime?.hol?.[k] || "----"),
          };
        };
        const len = common.names.length;
        const rows = common.names.map((name, i) => {
          const code = common.gyobun[i] || "";
          const wt = wtFor(code);
          const nextCode = common.gyobun[(i + 1) % len] || "";
          const wtNext = wtFor(nextCode);
          const dia = /^\d+d$/i.test(code)
            ? Number(code.replace(/d$/i, ""))
            : code;
          return {
            seq: String(i + 1),
            name,
            dia,
            phone: common.phones?.[i] || "",
            weekday: wt.weekday,
            saturday: wt.saturday,
            holiday: wt.holiday,
            weekdayNext: wtNext.weekday,
            saturdayNext: wtNext.saturday,
            holidayNext: wtNext.holiday,
          };
        });
        const nameMap = buildNameIndexMap(rows);
        map[depot] = {
          rows,
          nameMap,
          names: rows.map((r) => r.name).filter(Boolean),
        };
        continue;
      }
      const text = tablesByDepot?.[depot] || "";
      const rows = parsePeopleTable(text);
      const len = rows.length;
      for (let i = 0; i < len; i++) {
        const nx = rows[(i + 1) % len];
        rows[i].weekdayNext = nx?.weekday || { in: "", out: "" };
        rows[i].saturdayNext = nx?.saturday || { in: "", out: "" };
        rows[i].holidayNext = nx?.holiday || { in: "", out: "" };
      }
      const nameMap = buildNameIndexMap(rows);
      map[depot] = {
        rows,
        nameMap,
        names: rows.map((r) => r.name).filter(Boolean),
      };
    }
    return map;
  }, [tablesByDepot, commonMap]);
  const rowAtDateFor = React.useCallback(
    (name, depot, date) => {
      const pack = parsedByDepot[depot];
      if (!pack) return undefined;
      const { rows, nameMap } = pack;
      if (!nameMap.has(name) || !rows.length) return undefined;
      const baseIdx = nameMap.get(name);
      const anchorStr = anchorDateByDepot?.[depot];
      const anchor = anchorStr
        ? stripTime(new Date(anchorStr))
        : stripTime(new Date());
      const dd = Math.floor((stripTime(date) - anchor) / 86400000);
      const idx = (((baseIdx + dd) % rows.length) + rows.length) % rows.length;
      const baseRow = rows[idx];
      const iso = fmt(stripTime(new Date(date)));
      const v = overridesByDepot?.[depot]?.[iso]?.[name];
      if (!v) return baseRow;
      const patched = { ...(baseRow || {}) };
      const applyTemplate = (tpl) => {
        if (!tpl) return;
        patched.weekday = { ...tpl.weekday };
        patched.saturday = { ...tpl.saturday };
        patched.holiday = { ...tpl.holiday };
      };
      if (v === "비번" || v === "휴") {
        patched.dia = v;
        applyTemplate(labelTemplates[v]);
        return patched;
      }
      if (v === "교육" || v === "휴가") {
        patched.dia = v;
        if (labelTemplates[v]) {
          applyTemplate(labelTemplates[v]);
        } else {
          patched.weekday = { in: "", out: "" };
          patched.saturday = { in: "", out: "" };
          patched.holiday = { in: "", out: "" };
        }
        return patched;
      }
      if (/^대\d+$/.test(v)) {
        const n = Number(v.replace(/[^0-9]/g, ""));
        patched.dia = `대${n}`;
        const k = `대${n}`.replace(/\s+/g, "");
        applyTemplate(labelTemplates[k] || diaTemplates[n]);
        return patched;
      }
      if (v === "주" || v === "야") {
        patched.dia = v;
        applyTemplate(labelTemplates[v]);
        return patched;
      }
      if (/^\d+D$/.test(v)) {
        const n = Number(v.replace("D", ""));
        if (Number.isFinite(n)) {
          patched.dia = n;
          applyTemplate(diaTemplates[n]);
        }
        return patched;
      }
      if (/^\d+$/.test(String(v))) {
        const n = Number(v);
        patched.dia = n;
        applyTemplate(diaTemplates[n]);
        return patched;
      }
      patched.dia = v;
      return patched;
    },
    [
      parsedByDepot,
      anchorDateByDepot,
      overridesByDepot,
      labelTemplates,
      diaTemplates,
    ]
  );
  const normalized = React.useMemo(() => {
    if (!Array.isArray(compareSelected) || !compareSelected.length)
      return myName ? [{ name: myName, depot: selectedDepot }] : [];
    return compareSelected.map((x) =>
      typeof x === "string" ? { name: x, depot: selectedDepot } : x
    );
  }, [compareSelected, myName, selectedDepot]);
  const [groups, setGroups] = React.useState(() => {
    try {
      const saved = localStorage.getItem("compareGroups_v1");
      if (saved) return JSON.parse(saved);
    } catch {}
    const basePeople =
      normalized.length > 0
        ? normalized
        : myName
        ? [{ name: myName, depot: selectedDepot }]
        : [];
    return [{ id: "g1", label: "그룹 1", people: basePeople }];
  });
  React.useEffect(() => {
    try {
      localStorage.setItem("compareGroups_v1", JSON.stringify(groups));
    } catch {}
  }, [groups]);
  const [activeGroupId, setActiveGroupId] = React.useState("g1");
  const [editingGroupId, setEditingGroupId] = React.useState(null);
  const [editingLabel, setEditingLabel] = React.useState("");
  const activeGroup =
    groups.find((g) => g.id === activeGroupId) || groups[0] || null;
  const people = activeGroup ? activeGroup.people : [];
  const handleDeleteGroup = () => {
    if (!activeGroup) return;
    if (groups.length <= 1) {
      alert("마지막 그룹은 삭제할 수 없어요.");
      return;
    }
    if (!window.confirm(`"${activeGroup.label}" 그룹을 삭제할까요?`)) return;
    const nextGroups = groups.filter((g) => g.id !== activeGroup.id);
    setGroups(nextGroups);
    const nextActive = nextGroups[0] || null;
    setActiveGroupId(nextActive?.id || "");
    setCompareSelected(nextActive?.people || []);
    setEditingGroupId(null);
    setEditingLabel("");
  };
  const addPerson = (name, depot) => {
    setGroups((prev) => {
      if (!prev.length) return prev;
      const idxRaw = prev.findIndex((g) => g.id === activeGroupId);
      const idx = idxRaw === -1 ? 0 : idxRaw;
      const target = prev[idx] || prev[0];
      const base = target.people || [];
      if (base.some((p) => p.name === name && p.depot === depot)) return prev;
      const nextPeople = [...base, { name, depot }];
      const nextGroups = [...prev];
      nextGroups[idx] = { ...target, people: nextPeople };
      setCompareSelected(nextPeople);
      return nextGroups;
    });
  };
  const removePerson = (name, depot) => {
    setGroups((prev) => {
      if (!prev.length) return prev;
      const idxRaw = prev.findIndex((g) => g.id === activeGroupId);
      const idx = idxRaw === -1 ? 0 : idxRaw;
      const target = prev[idx] || prev[0];
      const base = target.people || [];
      let nextPeople = base.filter(
        (p) => !(p.name === name && p.depot === depot)
      );
      if (!nextPeople.length && myName)
        nextPeople = [{ name: myName, depot: selectedDepot }];
      const nextGroups = [...prev];
      nextGroups[idx] = { ...target, people: nextPeople };
      setCompareSelected(nextPeople);
      return nextGroups;
    });
  };

  // ─────────────────────────────────────────
  //  주(week) 계산 — 선택 날짜가 속한 주를 month-independent 로 추출
  //  좌/우 스와이프 시 selectedDate 를 ±7 일 이동. 이 때 달이 자동으로 바뀜.
  //  (monthGridMonday 는 헤더의 월 라벨 결정용으로만 사용, 데이터 그리드는
  //   selectedDate 기준 "해당 주"만 렌더)
  // ─────────────────────────────────────────
  const currentWeekDays = React.useMemo(() => {
    const d = stripTime(selectedDate);
    const dow = (d.getDay() + 6) % 7; // 월=0, 일=6
    const monday = new Date(d);
    monday.setDate(d.getDate() - dow);
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const x = new Date(monday);
      x.setDate(monday.getDate() + i);
      arr.push(stripTime(x));
    }
    return arr;
  }, [selectedDate]);

  const headerRef = React.useRef(null);
  const [headerH, setHeaderH] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
    };
  }, []);

  // ─────────────────────────────────────────
  //  좌/우 스와이프만 처리 — 헤더 영역에만 붙음
  //  스크롤 영역은 완전 독립적으로 자연 스크롤
  // ─────────────────────────────────────────
  const wrapRef = React.useRef(null);
  const [dragX, setDragX] = React.useState(0);
  const [snapping, setSnapping] = React.useState(false);
  const gRef = React.useRef({ sx: 0, sy: 0, lock: null, lx: 0, t: 0 });
  const X_DIST = 40,
    VEL = 0.35,
    SNAP_MS = 300;

  const onTouchStart = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    gRef.current = {
      sx: t.clientX,
      sy: t.clientY,
      lock: null,
      lx: t.clientX,
      t: performance.now(),
    };
    setSnapping(false);
    setDragX(0);
  };
  const onTouchMove = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    const dx = t.clientX - gRef.current.sx,
      dy = t.clientY - gRef.current.sy;
    if (gRef.current.lock === null) {
      // 가로 우세면 'h', 세로 우세면 'v' 로 lock.
      // 본문 영역은 touchAction:pan-y 라 세로는 브라우저가 처리 → lock="v" 면 리턴.
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))
        gRef.current.lock = "h";
      else if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx))
        gRef.current.lock = "v";
    }
    if (gRef.current.lock === "h") {
      if (e.cancelable) e.preventDefault();
      setDragX(dx);
      gRef.current.lx = t.clientX;
      gRef.current.t = performance.now();
    }
  };
  const onTouchEnd = (e) => {
    if (gRef.current.lock !== "h") {
      gRef.current.lock = null;
      setDragX(0);
      return;
    }
    const t = e.changedTouches[0];
    const now = performance.now(),
      dt = Math.max(1, now - gRef.current.t);
    const vx = (t.clientX - gRef.current.lx) / dt;
    const goNext = dragX < -X_DIST || vx < -VEL;
    const goPrev = dragX > X_DIST || vx > VEL;
    const width = wrapRef.current?.offsetWidth || 320;
    setSnapping(true);
    if (goNext) {
      setDragX(-width);
      setTimeout(() => {
        // 다음 주로 이동 (+7일) — 달 경계 자동 처리
        setSelectedDate((prev) => {
          const d = new Date(prev);
          d.setDate(d.getDate() + 7);
          return stripTime(d);
        });
        setDragX(0);
        setSnapping(false);
      }, SNAP_MS);
    } else if (goPrev) {
      setDragX(width);
      setTimeout(() => {
        setSelectedDate((prev) => {
          const d = new Date(prev);
          d.setDate(d.getDate() - 7);
          return stripTime(d);
        });
        setDragX(0);
        setSnapping(false);
      }, SNAP_MS);
    } else {
      setDragX(0);
      setTimeout(() => setSnapping(false), SNAP_MS);
    }
    gRef.current.lock = null;
  };

  function jumpToToday() {
    const today = stripTime(new Date());
    setSelectedDate(today);
    setSnapping(true);
    setDragX(0);
    setTimeout(() => setSnapping(false), 300);
  }
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [filterText, setFilterText] = React.useState("");
  const [pickerDepot, setPickerDepot] = React.useState(selectedDepot);
  const selectableNames = React.useMemo(() => {
    const src = parsedByDepot[pickerDepot]?.names ?? [];
    const pickedKey = new Set(people.map((p) => `${p.depot}::${p.name}`));
    return src.filter(
      (n) =>
        !pickedKey.has(`${pickerDepot}::${n}`) &&
        (filterText.trim()
          ? n.toLowerCase().includes(filterText.trim().toLowerCase())
          : true)
    );
  }, [parsedByDepot, pickerDepot, people, filterText]);
  const NAME_COL_W = 80;
  const displayedWeekDays = currentWeekDays;
  const monthIdx = selectedDate.getMonth();
  const todayISO = fmt(stripTime(new Date()));
  const isCurrentWeekHasToday = React.useMemo(
    () => displayedWeekDays.some((d) => fmt(d) === todayISO),
    [displayedWeekDays, todayISO]
  );
  const todayColIndex = React.useMemo(() => {
    if (!isCurrentWeekHasToday) return -1;
    return displayedWeekDays.findIndex((d) => fmt(d) === todayISO);
  }, [isCurrentWeekHasToday, displayedWeekDays, todayISO]);

  // 이번 주가 두 달에 걸쳐있을 수 있으므로 "월 라벨"은 주의 중간 날짜 기준
  const weekMidDate = displayedWeekDays[3] || selectedDate;
  const monthLabel = `${weekMidDate.getFullYear()}.${String(
    weekMidDate.getMonth() + 1
  ).padStart(2, "0")}`;

  function getContrastText(bg) {
    if (!bg) return "#fff";
    const c = bg.replace("#", "");
    const r = parseInt(c.slice(0, 2), 16),
      g = parseInt(c.slice(2, 4), 16),
      b = parseInt(c.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? "#000" : "#fff";
  }

  // 스크롤 영역 높이 = 뷰포트 - 헤더(요일 바) - 상단 툴바 - picker(열려있을 때) - 하단 안내
  // 넉넉히 빼서 안전하게
  const scrollAreaH = Math.max(
    200,
    slideViewportH - headerH - (pickerOpen ? 340 : 80) - 40
  );

  return (
    <div
      ref={wrapRef}
      className="bg-gray-800 rounded-2xl p-3 shadow mt-4 select-none"
      style={{
        // height 제거 → 내용만큼 자라서 appRef 전체 스크롤로 흐르게
        touchAction: "pan-y",
      }}
    >
      <div
        className="mb-2 flex items-center justify-between gap-2 text-[11px] text-gray-300"
        data-no-gesture
        style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
      >
        <div className="flex items-center gap-2">
          <input
            type="month"
            className="bg-gray-900/70 border border-gray-800 rounded-lg px-2 py-1 text-xs text-gray-100"
            value={`${selectedDate.getFullYear()}-${String(
              selectedDate.getMonth() + 1
            ).padStart(2, "0")}`}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [y, m] = v.split("-").map(Number);
              const next = new Date(selectedDate);
              next.setFullYear(y);
              next.setMonth(m - 1, 1);
              setSelectedDate(stripTime(next));
            }}
          />
          <select
            className="bg-gray-900/70 border border-gray-800 rounded-lg px-2 py-1 text-xs text-gray-100 max-w-[140px]"
            value={activeGroupId}
            onChange={(e) => {
              const id = e.target.value;
              setActiveGroupId(id);
              const g = groups.find((gg) => gg.id === id);
              setCompareSelected(g?.people || []);
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="px-2 py-1 rounded-xl bg-gray-100 text-gray-900 text-xs"
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
          >
            {pickerOpen ? "상단 접기" : "인원·그룹 관리"}
          </button>
          {!isCurrentWeekHasToday && (
            <button
              className="px-2 py-1 rounded-xl bg-indigo-600 text-xs text-white"
              type="button"
              onClick={jumpToToday}
            >
              오늘로
            </button>
          )}
        </div>
      </div>
      {pickerOpen && (
        <div
          className="mb-2 rounded-2xl overflow-hidden"
          data-no-gesture
          style={{
            position: "relative",
            zIndex: 3,
            touchAction: "auto",
            background: "var(--surface-2)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="p-3">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              그룹
            </div>

            <div className="flex flex-wrap gap-1.5 mb-2">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGroupId(g.id)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-medium transition-all"
                  type="button"
                  style={
                    g.id === activeGroupId
                      ? {
                          background: "var(--accent)",
                          color: "#fff",
                          boxShadow: "0 2px 6px rgba(49,130,246,0.28)",
                        }
                      : {
                          background: "var(--surface)",
                          color: "var(--text-secondary)",
                          boxShadow: "inset 0 0 0 1px var(--border)",
                        }
                  }
                >
                  <span className="truncate max-w-[110px] inline-block align-middle">
                    {g.label}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setGroups((prev) => {
                    const used = new Set(
                      prev.map((g) => g.label).filter(Boolean)
                    );
                    let n = 1;
                    while (used.has(`그룹 ${n}`)) n++;
                    const label = `그룹 ${n}`,
                      id = `g${Date.now()}_${n}`;
                    const newGroup = { id, label, people: [] };
                    const next = [...prev, newGroup];
                    setActiveGroupId(id);
                    setCompareSelected([]);
                    return next;
                  });
                }}
                className="px-3 py-1.5 rounded-full text-[12px] font-medium"
                style={{
                  background: "transparent",
                  color: "var(--accent)",
                  boxShadow: "inset 0 0 0 1px var(--accent)",
                }}
              >
                + 새 그룹
              </button>
            </div>

            {activeGroup && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingGroupId(activeGroup.id);
                    setEditingLabel(activeGroup.label || "");
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-secondary)",
                  }}
                >
                  이름 변경
                </button>
                <button
                  type="button"
                  disabled={groups.length <= 1}
                  onClick={handleDeleteGroup}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium disabled:opacity-40"
                  style={{
                    background: "var(--red-soft)",
                    color: "var(--red)",
                  }}
                >
                  그룹 삭제
                </button>
              </div>
            )}

            {editingGroupId && (
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  autoFocus
                  className="flex-1 px-3 py-2 text-[13px] rounded-lg"
                  placeholder="그룹 이름 입력…"
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const trimmed = editingLabel.trim();
                      setGroups((prev) =>
                        prev.map((g) =>
                          g.id === editingGroupId
                            ? { ...g, label: trimmed || g.label }
                            : g
                        )
                      );
                      setEditingGroupId(null);
                      setEditingLabel("");
                    } else if (e.key === "Escape") {
                      setEditingGroupId(null);
                      setEditingLabel("");
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = editingLabel.trim();
                    setGroups((prev) =>
                      prev.map((g) =>
                        g.id === editingGroupId
                          ? { ...g, label: trimmed || g.label }
                          : g
                      )
                    );
                    setEditingGroupId(null);
                    setEditingLabel("");
                  }}
                  className="px-3 py-2 rounded-lg text-[12px] font-semibold"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingGroupId(null);
                    setEditingLabel("");
                  }}
                  className="px-2.5 py-2 rounded-lg text-[12px]"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-secondary)",
                  }}
                >
                  취소
                </button>
              </div>
            )}
          </div>

          <div className="p-3" style={{ borderTop: "1px solid var(--border)" }}>
            <div
              className="text-[10px] font-semibold uppercase tracking-wider mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              인원 추가 {activeGroup ? `→ ${activeGroup.label}` : ""}
            </div>

            <div className="flex items-center gap-2 mb-2">
              <select
                className="px-2 py-1.5 text-[12px] rounded-lg"
                value={pickerDepot}
                onChange={(e) => setPickerDepot(e.target.value)}
                style={{ minWidth: "90px" }}
              >
                {DEPOTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                className="flex-1 px-3 py-1.5 text-[12px] rounded-lg"
                placeholder="이름 검색…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </div>

            {selectableNames.length > 0 ? (
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
                }}
              >
                {selectableNames.map((n) => {
                  const bg = highlightMap?.[n] || null;
                  const fg = bg ? getContrastText(bg) : null;
                  return (
                    <button
                      key={`${pickerDepot}::${n}`}
                      onClick={() => addPerson(n, pickerDepot)}
                      className="px-2 py-1 rounded-lg text-[11px] font-semibold truncate transition-all active:scale-95"
                      title={`${pickerDepot} • ${n} 추가`}
                      style={
                        bg
                          ? {
                              backgroundColor: bg,
                              color: fg,
                            }
                          : {
                              background: "var(--surface)",
                              color: "var(--text-primary)",
                              boxShadow: "inset 0 0 0 1px var(--border)",
                            }
                      }
                      type="button"
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                className="text-center py-4 text-[12px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {filterText.trim()
                  ? "검색 결과가 없습니다"
                  : "추가할 인원이 없습니다"}
              </div>
            )}
          </div>
        </div>
      )}

      {/*
        본문 구조:
        - 헤더 + 인원 리스트를 하나의 transform 그룹으로 묶어 함께 translateX
        - 헤더와 리스트 모두 가로 스와이프 감지
        - 리스트는 pan-y 도 허용 (세로 스크롤은 appRef 로)
      */}
      <div
        ref={headerRef}
        className="relative"
        style={{
          // 세로 스크롤 시 상단 고정 (appRef 기준)
          position: "sticky",
          top: 0,
          zIndex: 5,
          // 헤더는 가로 스와이프 시에도 움직이지 않음 (transform 없음)
          // → 아래 리스트만 좌우로 밀려 보이게
          touchAction: "pan-x",
          // 부모 카드와 동일한 배경 (테마 변수 사용)
          background: "var(--surface-2)",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="grid rounded-t-xl overflow-hidden"
          style={{
            gridTemplateColumns: `${NAME_COL_W}px repeat(7, minmax(0,1fr))`,
          }}
        >
          <div className="px-1 py-4 text-[17px] font-semibold border-r border-gray-700">
            <span>{monthLabel}</span>
          </div>
          {displayedWeekDays.map((d) => {
            const dow = d.getDay(),
              isoD = fmt(d),
              outside = d.getMonth() !== monthIdx;
            const color =
              dow === 0
                ? "text-red-400"
                : dow === 6
                ? "text-blue-400"
                : "text-gray-100";
            return (
              <div
                key={isoD}
                className={
                  "px-2 py-2 text-center text-sm font-semibold border-l border-gray-700 " +
                  (outside ? "text-gray-500" : color)
                }
                title={fmtWithWeekday(d)}
              >
                <div>{d.getDate()}</div>
                <div className="text-[11px] opacity-80">
                  {["일", "월", "화", "수", "목", "금", "토"][dow]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 인원 리스트 — 헤더와 같은 translateX 로 함께 움직임, 가로 스와이프도 여기서 감지 */}
      <div
        data-scroll-area
        className="rounded-b-xl"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: snapping ? "transform 300ms ease-out" : "none",
          willChange: "transform",
          // pan-y: 세로 스크롤은 appRef 에 넘김. 가로는 앱이 감지해서 preventDefault.
          touchAction: "pan-y",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* 인원 리스트를 감싸는 relative — 빨간 박스는 이 안에서만 차지 */}
        <div className="relative">
          {/* 오늘 열 표시 — 인원 리스트 실제 높이만큼만 */}
          {todayColIndex >= 0 && people.length > 0 && (
            <div
              className="absolute pointer-events-none border-2 border-red-400 rounded-md"
              style={{
                top: 0,
                bottom: 0,
                left: `calc(${NAME_COL_W}px + ${todayColIndex} * ((100% - ${NAME_COL_W}px) / 7))`,
                width: `calc((100% - ${NAME_COL_W}px) / 7)`,
                zIndex: 4,
              }}
            />
          )}
          <div className="divide-y divide-gray-700">
            {people.map(({ name, depot }) => (
              <div
                key={`${depot}::${name}`}
                className="grid bg-gray-800/60 hover:bg-gray-800"
                style={{
                  gridTemplateColumns: `${NAME_COL_W}px repeat(7, minmax(0,1fr))`,
                }}
              >
                <div className="px-2 py-1 border-r border-gray-700 flex items-center justify-between min-w-0">
                  <div
                    className="text-white font-semibold truncate text-[12px] min-w-0"
                    title={`${depot} • ${name}`}
                  >
                    {name}
                  </div>
                  <button
                    className="w-4 h-4 rounded-full bg-gray-700 hover:bg-gray-600 text-[10px] flex items-center justify-center flex-shrink-0 ml-0.5"
                    onClick={() => removePerson(name, depot)}
                    type="button"
                  >
                    −
                  </button>
                </div>
                {displayedWeekDays.map((d) => {
                  const row = rowAtDateFor(name, depot, d);
                  const t = computeInOut(row, d, holidaySet);
                  const dia =
                    row?.dia === undefined
                      ? "-"
                      : typeof row.dia === "number"
                      ? row.dia
                      : String(row.dia).replace(/\s+/g, "");
                  const diaLabel =
                    row?.dia == null ? "" : String(row.dia).replace(/\s+/g, "");
                  const finalLabel = isOverridden(name, depot, d)
                    ? diaLabel
                      ? `*${diaLabel}`
                      : "*"
                    : diaLabel || "-";
                  const outside = d.getMonth() !== monthIdx;

                  let bgColor = "bg-gray-800/60";
                  const todayDiaStr = String(row?.dia || "").replace(/\s/g, "");
                  const isOff =
                    !todayDiaStr ||
                    todayDiaStr.startsWith("휴") ||
                    todayDiaStr.includes("비번") ||
                    todayDiaStr === "비" ||
                    todayDiaStr.endsWith("~");
                  if (!isOff) {
                    const isTime = (v) =>
                      typeof v === "string" && /^\d{1,2}\s*:\s*\d{2}$/.test(v);
                    const hasWork = isTime(t.in) || isTime(t.out);
                    if (t.isNight) bgColor = "bg-sky-500/30";
                    else if (hasWork) bgColor = "bg-yellow-500/30";
                  }
                  return (
                    <div
                      key={`${depot}::${name}_${fmt(d)}`}
                      className={`px-1 py-1 text-[11px] leading-tight border-l border-gray-700 ${bgColor} ${
                        outside ? "opacity-50" : ""
                      }`}
                      title={`${depot} • ${name} • ${fmtWithWeekday(
                        d
                      )} • DIA ${dia} / ${t.in}~${t.out}`}
                    >
                      <div className="font-semibold">{finalLabel}</div>
                      <div className="mt-0.5">{t.in || "-"}</div>
                      <div>{t.out || "-"}</div>
                    </div>
                  );
                })}
              </div>
            ))}
            {people.length === 0 && (
              <div className="text-center py-8 text-xs text-gray-500">
                "인원·그룹 관리" 로 사람을 추가하세요.
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-1 text-[10px] text-gray-400 text-center">
        주 이동은 상단 날짜 바를 ← / → 로 스와이프 · 인원 목록은 위아래 스크롤
      </div>
    </div>
  );
}
