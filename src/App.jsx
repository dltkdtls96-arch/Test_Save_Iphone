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
} from "./dataEngine";
import SetupWizard from "./components/SetupWizard";
import QuickCodePicker from "./components/QuickCodePicker";
import PersonEditModal from "./components/PersonEditModal";
import { RouteImageView, tsvDiaToRouteCode } from "./components/routeImage";
import { useDayOverrides } from "./hooks/useDayOverrides";

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
const DATA_VERSION = 19; // v18 → v19: anchorDate 자동 갱신 로직 변경 (과거 역산 → 오늘 고정)

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

function computeInOut(row, date, holidaySet, nightDiaThreshold) {
  if (!row)
    return {
      in: "-",
      out: "-",
      note: "데이터 없음",
      combo: "-",
      isNight: false,
    };
  if (typeof row.dia === "string") {
    const label = row.dia;
    if (label.includes("비번"))
      return { in: "-", out: "-", note: "비번", combo: "-", isNight: false };
    if (label.replace(/\s/g, "").startsWith("휴"))
      return { in: "-", out: "-", note: "휴무", combo: "-", isNight: false };
    if (label === "교육" || label === "휴가")
      return { in: "-", out: "-", note: label, combo: "-", isNight: false };
    if (label === "주" || label === "야") {
      const tType = getDayType(date, holidaySet);
      const src =
        tType === "평"
          ? row.weekday
          : tType === "토"
          ? row.saturday
          : row.holiday;
      const isNightShift = label === "야";
      return {
        in: src.in || "-",
        out: src.out || "-",
        note: `${tType}${isNightShift ? " (야간)" : ""}`,
        combo: tType,
        isNight: isNightShift,
      };
    }
    if (label.startsWith("대")) {
      const tType = getDayType(date, holidaySet);
      const src =
        tType === "평"
          ? row.weekday
          : tType === "토"
          ? row.saturday
          : row.holiday;
      const n = Number(label.replace(/[^0-9]/g, ""));
      const isNightShift = Number.isFinite(n) && n >= nightDiaThreshold;
      return {
        in: src.in || "-",
        out: src.out || "-",
        note: `대근·${tType}${isNightShift ? " (야간)" : ""}`,
        combo: tType,
        isNight: isNightShift,
      };
    }
  }
  const tType = getDayType(date, holidaySet);
  const srcToday =
    tType === "평" ? row.weekday : tType === "토" ? row.saturday : row.holiday;
  let outTime = srcToday.out || "-",
    combo = `${tType}-${tType}`,
    night = false;
  if (typeof row.dia === "number" && row.dia >= nightDiaThreshold) {
    const tomorrow = new Date(date);
    tomorrow.setDate(date.getDate() + 1);
    const nextType = getDayType(tomorrow, holidaySet);
    const srcNext =
      nextType === "평"
        ? row.weekday
        : nextType === "토"
        ? row.saturday
        : row.holiday;
    outTime = srcNext.out || "-";
    combo = `${tType}-${nextType}`;
    night = true;
  }
  return {
    in: srcToday.in || "-",
    out: outTime,
    note: night ? `${combo} (야간)` : combo,
    combo,
    isNight: night,
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
    return saved === "dark" || saved === "light" ? saved : "light";
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

  // ── 새 추가: commonMap, SetupWizard, QuickCodePicker ──
  const [commonMap, setCommonMap] = useState(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [pickerState, setPickerState] = useState({
    open: false,
    name: "",
    currentCode: "",
    depot: "",
  });

  // ── 근무자 편집 모달 (이름 + 교번 동시) ──
  const [personEditModal, setPersonEditModal] = useState({
    open: false,
    oldName: "",
    oldCode: "",
  });
  const [rosterEditMode, setRosterEditMode] = useState(false);

  // 이름 override (오늘 하루만): { depot: { iso: { oldName: newName } } }
  const [nameOverridesByDepot, setNameOverridesByDepot] = useState({});

  const {
    setOverride: setDayOverride,
    resetOverride: resetDayOverride,
    hasOverride: hasDayOverride,
  } = useDayOverrides();

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

    // 값 정규화: 공백 제거 + 숫자 뒤 d/D 모두 허용
    const v = String(vRaw).replace(/\s+/g, "");

    const patched = { ...(row || {}) };
    const applyTemplate = (tpl) => {
      if (!tpl) return;
      patched.weekday = { ...tpl.weekday };
      patched.saturday = { ...tpl.saturday };
      patched.holiday = { ...tpl.holiday };
    };

    // 1) 휴/비번/교육/휴가
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

    // 3) 대기N  (먼저 검사 — 대N 정규식에 걸리지 않도록)
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

    // 5) 숫자 + d/D  ("1d", "12D", "5d" 모두 허용)
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

  // 영구 개명: commonMap.names[idx] = newName + 관련 override 이관
  async function applyPermanentRename(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
    const common = commonMap?.[key];
    if (!common?.names) return;
    const idx = common.names.findIndex(
      (n) => (n || "").replace(/\s/g, "") === (oldName || "").replace(/\s/g, "")
    );
    if (idx < 0) return;

    const newNames = [...common.names];
    newNames[idx] = newName;
    const nextMap = { ...commonMap, [key]: { ...common, names: newNames } };
    setCommonMap(nextMap);
    try {
      await saveCommonDataToDB(nextMap);
    } catch {}

    // TSV 동기화
    setTablesByDepot((prev) => {
      const tsv = prev?.[selectedDepot];
      if (!tsv) return prev;
      const lines = tsv.split(/\r?\n/);
      if (lines.length > idx + 1) {
        const cols = lines[idx + 1].split("\t");
        if (cols.length >= 2) {
          cols[1] = newName;
          lines[idx + 1] = cols.join("\t");
          return { ...prev, [selectedDepot]: lines.join("\n") };
        }
      }
      return prev;
    });

    // ── override 이관 (oldName → newName) ──
    // 1) 교번 override
    setOverridesByDepot((prev) => {
      const depotMap = prev?.[selectedDepot];
      if (!depotMap) return prev;
      const nextDepotMap = { ...depotMap };
      let changed = false;
      Object.keys(nextDepotMap).forEach((iso) => {
        const dayMap = nextDepotMap[iso];
        if (dayMap && Object.prototype.hasOwnProperty.call(dayMap, oldName)) {
          const nextDay = { ...dayMap };
          nextDay[newName] = nextDay[oldName];
          delete nextDay[oldName];
          nextDepotMap[iso] = nextDay;
          changed = true;
        }
      });
      return changed ? { ...prev, [selectedDepot]: nextDepotMap } : prev;
    });

    // 2) 이름 override (혹시 oldName 키로 남아있을 수 있음)
    setNameOverridesByDepot((prev) => {
      const depotMap = prev?.[selectedDepot];
      if (!depotMap) return prev;
      const nextDepotMap = { ...depotMap };
      let changed = false;
      Object.keys(nextDepotMap).forEach((iso) => {
        const dayMap = nextDepotMap[iso];
        if (dayMap && Object.prototype.hasOwnProperty.call(dayMap, oldName)) {
          const nextDay = { ...dayMap };
          // oldName에 달려있던 override는 이제 불필요 (이미 영구 개명됐으므로)
          delete nextDay[oldName];
          if (Object.keys(nextDay).length === 0) delete nextDepotMap[iso];
          else nextDepotMap[iso] = nextDay;
          changed = true;
        }
      });
      return changed ? { ...prev, [selectedDepot]: nextDepotMap } : prev;
    });

    // 내 이름/행로 대상 연동
    if (myName === oldName) setMyNameForDepot(selectedDepot, newName);
    if (routeTargetName === oldName) setRouteTargetName(newName);
  }

  // 오늘 하루만: nameOverridesByDepot 에 저장
  function applyTodayRename(oldName, newName, dateObj) {
    const iso = fmt(stripTime(new Date(dateObj)));
    setNameOverridesByDepot((prev) => {
      const depotMap = { ...(prev?.[selectedDepot] || {}) };
      const dayMap = { ...(depotMap[iso] || {}) };
      if (!newName || newName === oldName) {
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
  const peopleRows = useMemo(() => {
    const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
    const common = commonMap?.[key];
    if (common?.names?.length && common?.gyobun?.length) {
      // commonMap → peopleRows 변환
      return common.names.map((name, i) => {
        const code = common.gyobun[i] || "";
        const norKey = code.trim().toLowerCase();
        const nor = common.worktime?.nor?.[norKey] || "----";
        const sat = common.worktime?.sat?.[norKey] || "----";
        const hol = common.worktime?.hol?.[norKey] || "----";
        const splitWT = (wt) => {
          const s = String(wt || "").replace(/\s/g, "");
          if (!s || s === "----") return { in: "", out: "" };
          const parts = s.split("-");
          return { in: parts[0] || "", out: parts[1] || "" };
        };
        const dia = /^\d+d$/i.test(code)
          ? Number(code.replace(/d$/i, ""))
          : code;
        return {
          seq: String(i + 1),
          name,
          dia,
          phone: common.phones?.[i] || "", // commonMap에 저장된 전화번호 우선
          weekday: splitWT(nor),
          saturday: splitWT(sat),
          holiday: splitWT(hol),
        };
      });
    }
    // 폴백: 기존 TSV 파싱
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
  const [isMigrating, setIsMigrating] = useState(false);
  useEffect(() => {
    let migrated = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setMyNameForDepot("안심", nameList[0] || "");
        setHolidaysText(DEFAULT_HOLIDAYS_25_26);
      } else {
        const s = JSON.parse(raw);
        const savedDataVersion = s.dataVersion ?? 0;
        const isOldData = savedDataVersion !== DATA_VERSION;
        migrated = isOldData;
        if (s.nightDiaByDepot) setNightDiaByDepot(s.nightDiaByDepot);
        else if (typeof s.nightDiaThreshold === "number")
          setNightDiaByDepot({
            안심: s.nightDiaThreshold,
            월배: s.nightDiaThreshold,
            경산: s.nightDiaThreshold,
            문양: s.nightDiaThreshold,
          });
        if (s.tablesByDepot && !isOldData) setTablesByDepot(s.tablesByDepot);
        if (s.myNameMap) setMyNameMap(s.myNameMap);
        if (s.selectedDepot) setSelectedDepot(s.selectedDepot);
        if (s.overridesByDepot) setOverridesByDepot(s.overridesByDepot);
        if (s.nameOverridesByDepot)
          setNameOverridesByDepot(s.nameOverridesByDepot);
        if (!s.tablesByDepot && s.tableText)
          setTablesByDepot((prev) => ({ ...prev, 안심: s.tableText }));
        if (!s.myNameMap && s.myName) setMyNameForDepot("안심", s.myName);
        // ⚠️ isOldData 시 anchorDateByDepot 로딩 스킵
        if (!isOldData && s.anchorDateByDepot)
          setAnchorDateByDepot(s.anchorDateByDepot);
        else if (!isOldData && s.anchorDateStr)
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
    setIsMigrating(migrated);

    // commonMap IndexedDB 복원 + ZIP 핸들 복원 (병렬)
    // isOldData인 경우 이전 버전 names 회전이 잘못됐을 수 있어 commonMap도 무시
    Promise.all([
      migrated ? Promise.resolve(null) : loadCommonDataFromDB(),
      restoreZipHandleFromDB("latest").catch(() => false),
    ])
      .then(([saved]) => {
        if (saved) setCommonMap(saved);
        // 마이그레이션인 경우 자동 Wizard 강제 표시
        if (migrated) setShowSetupWizard(true);
      })
      .catch(() => {});

    (async () => {
      try {
        if ("storage" in navigator && "persist" in navigator.storage)
          await navigator.storage.persist();
      } catch {}
    })();

    setLoaded(true);
  }, []);

  // ── TSV → commonMap 자동 변환 (기존 사용자, commonMap 없을 때) ──
  useEffect(() => {
    if (!loaded || commonMap) return;
    try {
      const map = {};
      for (const depot of DEPOTS) {
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
    if (!commonMap) setShowSetupWizard(true);
  }, [loaded]); // 최초 1회만 체크

  // ── tablesByDepot / anchorDateByDepot 바뀔 때 commonMap 동기화 ──
  useEffect(() => {
    if (!loaded) return;
    setCommonMap((prev) => {
      const next = { ...(prev || {}) };
      for (const depot of DEPOTS) {
        const key = DEPOT_TO_ZIP_KEY[depot] || depot;
        if (prev?.[key]?.source === "zip") continue; // ZIP 데이터는 건드리지 않음
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
      }
      saveCommonDataToDB(next).catch(() => {});
      return next;
    });
  }, [tablesByDepot, anchorDateByDepot, loaded]);

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

    // ZIP 데이터: names 재배치
    setCommonMap((prevMap) => {
      if (!prevMap) return prevMap;
      const nextMap = { ...prevMap };
      let changed = false;

      for (const depot of DEPOTS) {
        const key = DEPOT_TO_ZIP_KEY[depot] || depot;
        const data = prevMap[key];
        if (!data?.names?.length || !data?.gyobun?.length) continue;

        const currentAnchor = anchorDateByDepot[depot];
        if (!currentAnchor) continue;
        if (currentAnchor === todayStr) continue;

        const anchorD = stripTime(new Date(currentAnchor));
        const dd = diffDays(today, anchorD); // today - anchorDate
        if (dd === 0) continue;

        const len = data.names.length;

        // 기존 공식으로 "오늘 각 사람이 있어야 할 gyobun 인덱스"를 계산:
        //   names[i] 의 오늘 교번 = gyobun[mod(i + dd, len)]
        // 새 배치에서는 dd=0 이므로 names_new[j] 의 오늘 교번 = gyobun[j]
        // 즉 names_new[j] = names[i]  where  mod(i + dd, len) = j
        //                 = names[mod(j - dd, len)]
        const newNames = new Array(len);
        const newPhones = new Array(len);
        const oldPhones = data.phones || [];
        for (let j = 0; j < len; j++) {
          const oldI = (((j - dd) % len) + len) % len;
          newNames[j] = data.names[oldI];
          newPhones[j] = oldPhones[oldI] || "";
        }

        nextMap[key] = { ...data, names: newNames, phones: newPhones };
        changed = true;
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
      anchorDate: wizAnchor, // Wizard가 계산한 과거 anchor
      commonMap: newMap,
    } = result;

    const todayISO = fmt(today);

    let finalMap = { ...(commonMap || {}) };
    if (mode === "zip") {
      Object.assign(finalMap, newMap);
    } else {
      if (newMap?._pathsOnly)
        for (const key of Object.keys(finalMap))
          finalMap[key] = loadPathsIntoCommon(finalMap[key], newMap._pathsOnly);
    }

    // ─── 여기가 핵심 수정 ───
    // Wizard는 "anchor = today - (codeIdx - nameIdx)" 식으로 과거 anchor를 계산해줌.
    // 우리는 대신 "anchor = today + names 배열 재배치"로 변환한다.
    //
    // 재배치 공식:
    //   names_new[j] = names_old[i]  where  mod(i + dd, len) = j
    //   = names_old[mod(j - dd, len)]
    //   dd = today - wizAnchor
    //
    if (mode === "zip") {
      const key = DEPOT_TO_ZIP_KEY[depot] || depot;
      const zipData = finalMap[key];
      if (
        zipData?.names?.length &&
        zipData?.gyobun?.length &&
        wizAnchor &&
        wizAnchor !== todayISO
      ) {
        const anchorD = stripTime(new Date(wizAnchor));
        const dd = diffDays(today, anchorD);
        const len = zipData.names.length;
        if (dd !== 0 && len > 0) {
          const newNames = new Array(len);
          const newPhones = new Array(len);
          const oldPhones = zipData.phones || [];
          for (let j = 0; j < len; j++) {
            const oldI = (((j - dd) % len) + len) % len;
            newNames[j] = zipData.names[oldI];
            newPhones[j] = oldPhones[oldI] || "";
          }
          finalMap[key] = {
            ...zipData,
            names: newNames,
            phones: newPhones,
            baseDate: todayISO,
          };
        } else {
          finalMap[key] = { ...zipData, baseDate: todayISO };
        }
      } else if (zipData) {
        finalMap[key] = { ...zipData, baseDate: todayISO };
      }
    }

    // ZIP 모드: tablesByDepot에도 재배치된 이름으로 TSV 생성
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
    // ⚠️ 과거 날짜(wizAnchor)가 아니라 오늘 날짜로 세팅
    setAnchorDateByDepot((prev) => ({ ...prev, [depot]: todayISO }));
    setShowSetupWizard(false);
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
      dataVersion: DATA_VERSION,
      myNameMap,
      selectedDepot,
      anchorDateByDepot,
      holidaysText,
      nightDiaByDepot,
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
        daeNum = null;
      if (typeof todayDia === "string") {
        const clean = todayDia.replace(/\s/g, "");
        if (clean.startsWith("휴")) type = "holiday";
        else if (clean.endsWith("~")) type = "biban";
        else if (clean.includes("비번") || clean === "비") type = "biban";
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
      return { name, row: rowToday, type, diaNum, daeNum, yDiaNum };
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
      ({ name, row, type }) => {
        let displayDia = row?.dia;
        if (
          typeof displayDia === "string" &&
          displayDia.trim().startsWith("대")
        ) {
          const yRow = rowAtDateForNameWithOverride(name, yester);
          const yDia = yRow?.dia;
          const yNum = toDiaNum(yDia);
          let prevNight = false;
          if (Number.isFinite(yNum) && yNum >= nightDiaThreshold)
            prevNight = true;
          if (typeof yDia === "string" && /^대\s*\d+$/.test(yDia))
            prevNight = true;
          if (prevNight) displayDia = `${displayDia.replace(/\s+/g, "")}~`;
        }
        if (type === "biban") {
          const yRow = rowAtDateForNameWithOverride(name, yester);
          const yDiaRaw = yRow?.dia;
          const yDia =
            typeof yDiaRaw === "string"
              ? yDiaRaw.trim().replace(/\s+/g, "")
              : yDiaRaw;
          let prevNight = false;
          const n = toDiaNum(yDia);
          if (Number.isFinite(n) && n >= nightDiaThreshold) prevNight = true;
          if (typeof yDia === "string" && /^대\d+$/.test(yDia))
            prevNight = true;
          displayDia = prevNight ? `${String(yDia)}~` : "비번";
        }
        return { name, row: { ...row, dia: displayDia } };
      }
    );
  }, [
    nameList,
    selectedDate,
    nightDiaThreshold,
    selectedDepot,
    overridesByDepot,
  ]);

  const nameGridRows = useMemo(() => {
    const rows = rosterAt(selectedDate);
    return [...rows].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), "ko")
    );
  }, [selectedDate, nameList, selectedDepot, overridesByDepot, anchorDateStr]);

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

  function resetAll() {
    if (!confirm("모든 저장 데이터를 초기화할까요?")) return;
    try {
      localStorage.clear();
    } catch {}
    setSelectedTab("home");
    setSelectedDate(today);
    setSelectedDepot("안심");
    setAnchorDateByDepot(defaultAnchorByDepot);
    setTablesByDepot({
      안심: "",
      월배: "",
      경산: "",
      문양: "",
      교대: buildGyodaeTable(),
      "교대(외)": buildGyodaeExtTable(),
    });
    setMyNameMap({
      안심: "",
      월배: "",
      경산: "",
      문양: "",
      교대: "",
      " 교대(외)": "",
    });
    setNightDiaByDepot({
      안심: 25,
      월배: 25,
      문양: 24,
      경산: 21,
      교대: 5,
      "교대(외)": 5,
    });
    setHolidaysText(DEFAULT_HOLIDAYS_25_26);
    setHighlightMap({});
    setRouteTargetName("");
    setCommonMap(null);
    if (typeof window !== "undefined") {
      if ("caches" in window)
        caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
      if ("serviceWorker" in navigator)
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => regs.forEach((reg) => reg.unregister()));
      window.location.reload();
    }
  }

  const isPortrait = usePortraitOnly();

  // ── ROUTE 공통 계산 ──
  const routeTarget = routeTargetName || myName;
  const routeRow = React.useMemo(
    () => rowAtDateForNameWithOverride(routeTarget, selectedDate),
    [routeTarget, selectedDate, selectedDepot]
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

  // 전체탭 셀 탭 → QuickCodePicker 열기
  const handleRosterCellTap = (name, rowDia, depotArg) => {
    setPickerState({
      open: true,
      name,
      currentCode: tsvDiaToRouteCode(rowDia),
      depot: depotArg || selectedDepot,
    });
  };

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
          overflowY: selectedTab === "settings" ? "auto" : "hidden",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          touchAction: "manipulation",
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
                            const t = computeInOut(
                              row,
                              d,
                              holidaySet,
                              nightDiaThreshold
                            );
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
                            let diaColorClass = "";
                            if (selectedDepot === "교대") {
                              const label = (
                                typeof row?.dia === "string" ? row.dia : ""
                              ).replace(/\s/g, "");
                              if (label === "주")
                                diaColorClass = "text-yellow-300";
                              else if (label === "야")
                                diaColorClass = "text-sky-300";
                            } else {
                              if (typeof row?.dia === "number")
                                diaColorClass =
                                  row.dia >= nightDiaThreshold
                                    ? "text-sky-300"
                                    : "text-yellow-300";
                              else if (
                                typeof row?.dia === "string" &&
                                row.dia.replace(/\s/g, "").startsWith("대")
                              ) {
                                const nextDate = new Date(d);
                                nextDate.setDate(d.getDate() + 1);
                                const nextRow = rowAtDateForNameWithOverride(
                                  activeName,
                                  nextDate
                                );
                                const nextDia = nextRow?.dia;
                                const nextDiaStr = String(nextDia || "");
                                const isNightTarget =
                                  nextDiaStr.includes("비번") ||
                                  nextDiaStr.includes("~");
                                diaColorClass = isNightTarget
                                  ? "text-sky-300"
                                  : "text-yellow-300";
                              }
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
                                    : "bg-gray-700/60 hover:bg-gray-700") +
                                  (isSelected ? " ring-2 ring-blue-400" : "")
                                }
                                aria-hidden={isHiddenRow ? "true" : undefined}
                                tabIndex={isHiddenRow ? -1 : 0}
                                style={{ padding: "0.5rem" }}
                                title={`${diaLabel} / ${t.combo}/${t.in}/${t.out}`}
                              >
                                <div>
                                  <div className="flex items-center justify-between">
                                    <div
                                      className={
                                        "font-semibold text-sm " + dayColor
                                      }
                                    >
                                      {d.getDate()}
                                    </div>
                                    {isToday && (
                                      <span className="absolute inset-0 rounded-lg ring-2 ring-red-400 pointer-events-none" />
                                    )}
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
                    onEditTap={(name, row) =>
                      setPersonEditModal({
                        open: true,
                        oldName: name,
                        oldCode: tsvDiaToRouteCode(row?.dia),
                      })
                    }
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
                    onEditTap={(name, row) =>
                      setPersonEditModal({
                        open: true,
                        oldName: name,
                        oldCode: tsvDiaToRouteCode(row?.dia),
                      })
                    }
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
                    onEditTap={(name, row) =>
                      setPersonEditModal({
                        open: true,
                        oldName: name,
                        oldCode: tsvDiaToRouteCode(row?.dia),
                      })
                    }
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
                onCodeTap={handleRosterCellTap}
                onEditTap={(name, row) =>
                  setPersonEditModal({
                    open: true,
                    oldName: name,
                    oldCode: tsvDiaToRouteCode(row?.dia),
                  })
                }
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
                onCodeTap={handleRosterCellTap}
                onEditTap={(name, row) =>
                  setPersonEditModal({
                    open: true,
                    oldName: name,
                    oldCode: tsvDiaToRouteCode(row?.dia),
                  })
                }
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
                onCodeTap={handleRosterCellTap}
                onEditTap={(name, row) =>
                  setPersonEditModal({
                    open: true,
                    oldName: name,
                    oldCode: tsvDiaToRouteCode(row?.dia),
                  })
                }
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
                </div>
                <div className="mt-1 flex items-center gap-2">
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
                    onCodeTap={handleRosterCellTap}
                    onEditTap={(name, row) =>
                      setPersonEditModal({
                        open: true,
                        oldName: name,
                        oldCode: tsvDiaToRouteCode(row?.dia),
                      })
                    }
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
                    onCodeTap={handleRosterCellTap}
                    onEditTap={(name, row) =>
                      setPersonEditModal({
                        open: true,
                        oldName: name,
                        oldCode: tsvDiaToRouteCode(row?.dia),
                      })
                    }
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
                    onCodeTap={handleRosterCellTap}
                    onEditTap={(name, row) =>
                      setPersonEditModal({
                        open: true,
                        oldName: name,
                        oldCode: tsvDiaToRouteCode(row?.dia),
                      })
                    }
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
              nightDiaThreshold,
              monthGridMonday,
              computeInOut,
              compareSelected,
              setCompareSelected,
              slideViewportH,
              tablesByDepot,
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
              <button
                onClick={resetAll}
                className="flex flex-col items-center text-gray-400 hover:text-red-400"
              >
                <Upload className="w-5 h-5 mb-0 rotate-180" />
                초기화
              </button>
            </div>
          </nav>
        </FixedTabbarPortal>
      </div>

      <DutyModal />

      {/* ✅ QuickCodePicker — 전체/행로탭 교번 즉시 변경 */}
      <QuickCodePicker
        open={pickerState.open}
        onClose={() => setPickerState((p) => ({ ...p, open: false }))}
        name={pickerState.name}
        depot={pickerState.depot || selectedDepot}
        currentCode={pickerState.currentCode}
        gyobunList={currentGyobunList}
        date={fmt(selectedDate)}
        isOverridden={hasDayOverride(
          pickerState.depot || selectedDepot,
          pickerState.name,
          fmt(selectedDate)
        )}
        onSelect={(code) => {
          setDayOverride(
            pickerState.depot || selectedDepot,
            pickerState.name,
            fmt(selectedDate),
            code
          );
          setOverride(
            pickerState.depot || selectedDepot,
            stripTime(new Date(selectedDate)),
            pickerState.name,
            code
          );
          setPickerState((p) => ({ ...p, open: false }));
        }}
        onReset={() => {
          resetDayOverride(
            pickerState.depot || selectedDepot,
            pickerState.name,
            fmt(selectedDate)
          );
          setOverride(
            pickerState.depot || selectedDepot,
            stripTime(new Date(selectedDate)),
            pickerState.name,
            null
          );
        }}
      />

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
        nameList={nameList}
        codeList={currentGyobunList}
        onClose={() =>
          setPersonEditModal({ open: false, oldName: "", oldCode: "" })
        }
        onApply={async ({ newName, newCode }, scope) => {
          const oldName = personEditModal.oldName;
          // 영구 개명은 override 이름이 oldName→newName으로 이관되므로,
          // 교번 override 대상은 최종 "영구 개명 후 이름"이어야 함
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
              // 오늘 하루만: 기존대로 override 저장
              setDayOverride(
                selectedDepot,
                targetName,
                fmt(selectedDate),
                newCode
              );
              setOverride(
                selectedDepot,
                stripTime(new Date(selectedDate)),
                targetName,
                newCode
              );
            } else {
              // ♾️ 영구 교번 변경: commonMap.gyobun[idx] 교체
              const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
              const common = commonMap?.[key];
              if (common?.names?.length && common?.gyobun?.length) {
                const idx = common.names.findIndex(
                  (n) =>
                    (n || "").replace(/\s/g, "") ===
                    (targetName || "").replace(/\s/g, "")
                );
                if (idx >= 0) {
                  const newGyobun = [...common.gyobun];
                  newGyobun[idx] = newCode;
                  const nextMap = {
                    ...commonMap,
                    [key]: { ...common, gyobun: newGyobun },
                  };
                  setCommonMap(nextMap);
                  try {
                    await saveCommonDataToDB(nextMap);
                  } catch {}

                  // TSV 동기화 (교번은 보통 3번째 컬럼 — 실제 위치는 데이터 스키마에 맞게)
                  setTablesByDepot((prev) => {
                    const tsv = prev?.[selectedDepot];
                    if (!tsv) return prev;
                    const lines = tsv.split(/\r?\n/);
                    if (lines.length > idx + 1) {
                      const cols = lines[idx + 1].split("\t");
                      if (cols.length >= 3) {
                        cols[2] = newCode;
                        lines[idx + 1] = cols.join("\t");
                        return { ...prev, [selectedDepot]: lines.join("\n") };
                      }
                    }
                    return prev;
                  });

                  // 오늘 날짜에 기존에 걸려있던 일시 override가 있으면 제거
                  // (영구로 바뀐 마당에 하루 override가 남아있으면 혼란)
                  setOverride(
                    selectedDepot,
                    stripTime(new Date(selectedDate)),
                    targetName,
                    null
                  );
                  setDayOverride(
                    selectedDepot,
                    targetName,
                    fmt(selectedDate),
                    null
                  );
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
}

// CompareWeeklyBoard — 기존과 동일 (생략 없이 유지)
function CompareWeeklyBoard({
  selectedDepot,
  selectedDate,
  setSelectedDate,
  nameList,
  myName,
  holidaySet,
  nightDiaThreshold,
  monthGridMonday,
  computeInOut,
  highlightMap,
  tablesByDepot,
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
      const text = tablesByDepot?.[depot] || "";
      const rows = parsePeopleTable(text);
      const nameMap = buildNameIndexMap(rows);
      map[depot] = {
        rows,
        nameMap,
        names: rows.map((r) => r.name).filter(Boolean),
      };
    }
    return map;
  }, [tablesByDepot]);
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
  const weeks = React.useMemo(() => {
    const days = monthGridMonday(selectedDate);
    const arr = [];
    for (let i = 0; i < days.length; i += 7) arr.push(days.slice(i, i + 7));
    return arr;
  }, [selectedDate, monthGridMonday]);
  const headerRef = React.useRef(null);
  const [headerH, setHeaderH] = React.useState(0);
  const forceTopRef = React.useRef(false);
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
  const weekIndexOfSelected = React.useMemo(() => {
    const sel = fmt(selectedDate);
    const idx = weeks.findIndex((w) => w.some((d) => fmt(d) === sel));
    return idx < 0 ? 0 : idx;
  }, [weeks, selectedDate]);
  const [weekPage, setWeekPage] = React.useState(weekIndexOfSelected);
  React.useEffect(() => {
    if (forceTopRef.current) {
      forceTopRef.current = false;
      return;
    }
    setWeekPage(weekIndexOfSelected);
  }, [weekIndexOfSelected]);
  const wrapRef = React.useRef(null);
  const [dragX, setDragX] = React.useState(0);
  const [dragY, setDragY] = React.useState(0);
  const [snapping, setSnapping] = React.useState(false);
  const gRef = React.useRef({ sx: 0, sy: 0, lock: null, lx: 0, ly: 0, t: 0 });
  const X_DIST = 40,
    Y_DIST = 40,
    VEL = 0.35,
    SNAP_MS = 300;
  const contentH = Math.max(160, slideViewportH - headerH - 8);
  const onTouchStart = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    gRef.current = {
      sx: t.clientX,
      sy: t.clientY,
      lock: null,
      lx: t.clientX,
      ly: t.clientY,
      t: performance.now(),
    };
    setSnapping(false);
    setDragX(0);
    setDragY(0);
  };
  const onTouchMove = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    const dx = t.clientX - gRef.current.sx,
      dy = t.clientY - gRef.current.sy;
    if (gRef.current.lock === null) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8)
        gRef.current.lock = "h";
      else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8)
        gRef.current.lock = "v";
    }
    if (gRef.current.lock === "h") {
      e.preventDefault();
      setDragX(dx);
    } else if (gRef.current.lock === "v") {
      e.preventDefault();
      setDragY(dy);
    }
    gRef.current.lx = t.clientX;
    gRef.current.ly = t.clientY;
    gRef.current.t = performance.now();
  };
  const onTouchEnd = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.changedTouches[0];
    const now = performance.now(),
      dt = Math.max(1, now - gRef.current.t);
    const vx = (t.clientX - gRef.current.lx) / dt,
      vy = (t.clientY - gRef.current.ly) / dt;
    if (gRef.current.lock === "h") {
      const goNext = dragX < -X_DIST || vx < -VEL,
        goPrev = dragX > X_DIST || vx > VEL;
      setSnapping(true);
      if (goNext) {
        setDragX(-(wrapRef.current?.offsetWidth || 320));
        setTimeout(() => {
          forceTopRef.current = true;
          setWeekPage(0);
          setDragY(0);
          setSelectedDate(addMonthsSafe(selectedDate, 1));
          setDragX(0);
          setSnapping(false);
        }, SNAP_MS);
      } else if (goPrev) {
        setDragX(wrapRef.current?.offsetWidth || 320);
        setTimeout(() => {
          forceTopRef.current = true;
          setWeekPage(0);
          setDragY(0);
          setSelectedDate(addMonthsSafe(selectedDate, -1));
          setDragX(0);
          setSnapping(false);
        }, SNAP_MS);
      } else {
        setDragX(0);
        setTimeout(() => setSnapping(false), SNAP_MS);
      }
    } else if (gRef.current.lock === "v") {
      const goNext = dragY < -Y_DIST || vy < -VEL,
        goPrev = dragY > Y_DIST || vy > VEL;
      setSnapping(true);
      if (goNext && weekPage < weeks.length - 1) {
        setDragY(-contentH);
        setTimeout(() => {
          setWeekPage((p) => p + 1);
          setDragY(0);
          setSnapping(false);
        }, SNAP_MS);
      } else if (goPrev && weekPage > 0) {
        setDragY(contentH);
        setTimeout(() => {
          setWeekPage((p) => p - 1);
          setDragY(0);
          setSnapping(false);
        }, SNAP_MS);
      } else {
        setDragY(0);
        setTimeout(() => setSnapping(false), SNAP_MS);
      }
    } else {
      setDragX(0);
      setDragY(0);
    }
  };
  function jumpToToday() {
    const today = stripTime(new Date());
    setSelectedDate(today);
    const md = monthGridMonday(today);
    const wks = [];
    for (let i = 0; i < md.length; i += 7) wks.push(md.slice(i, i + 7));
    const idx = wks.findIndex((w) => w.some((d) => fmt(d) === fmt(today)));
    setWeekPage(idx < 0 ? 0 : idx);
    setSnapping(true);
    setDragY(0);
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
  const NAME_COL_W = 80,
    monthIdx = selectedDate.getMonth(),
    displayedWeekDays = weeks[weekPage] || [];
  const todayISO = fmt(stripTime(new Date()));
  const isCurrentWeekHasToday = React.useMemo(
    () => displayedWeekDays.some((d) => fmt(d) === todayISO),
    [displayedWeekDays, todayISO]
  );
  const todayColIndex = React.useMemo(() => {
    if (!isCurrentWeekHasToday) return -1;
    return displayedWeekDays.findIndex((d) => fmt(d) === todayISO);
  }, [isCurrentWeekHasToday, displayedWeekDays, todayISO]);
  const monthLabel = `${selectedDate.getFullYear()}.${String(
    selectedDate.getMonth() + 1
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
  function isSCodeDay(v) {
    return typeof v === "string" && /^s\s*[1-6]$/i.test(v.trim());
  }
  function hourFromStr(v) {
    if (typeof v !== "string") return null;
    const m = v.match(/^(\d{1,2})\s*:/);
    return m ? Number(m[1]) : null;
  }
  const weekBodyRefs = React.useRef([]);
  const [bodyH, setBodyH] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = weekBodyRefs.current[weekPage];
    if (!el) return;
    const measure = () => setBodyH(el.offsetHeight || 0);
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
  }, [weekPage, people.length, weeks.length]);
  const start = displayedWeekDays[0],
    end = displayedWeekDays[displayedWeekDays.length - 1];
  return (
    <div
      ref={wrapRef}
      className="bg-gray-800 rounded-2xl p-3 shadow mt-4 select-none overflow-hidden"
      style={{ height: slideViewportH, touchAction: "manipulation" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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
          {(fmt(selectedDate) !== todayISO ||
            !displayedWeekDays.some((d) => fmt(d) === todayISO)) && (
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
        <>
          <div
            className="flex items-center justify-between gap-2 flex-wrap mb-2"
            data-no-gesture
            style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
          >
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-300">소속</label>
              <select
                className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                value={pickerDepot}
                onChange={(e) => {
                  setPickerDepot(e.target.value);
                }}
              >
                {DEPOTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                type="month"
                className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
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
            </div>
          </div>
          <div
            className="flex items-center justify-between gap-2 mb-2"
            data-no-gesture
            style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
          >
            <div className="flex flex-wrap gap-1">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGroupId(g.id)}
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-[11px] border transition-colors ${
                    g.id === activeGroupId
                      ? "bg-indigo-600 text-white border-indigo-400"
                      : "bg-gray-700 text-gray-200 border-gray-500"
                  }`}
                  type="button"
                >
                  <span className="truncate max-w-[90px]">{g.label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-[11px]">
              그룹:
              <button
                className="px-2 py-1 rounded-full bg-gray-700 text-xs text-white"
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
              >
                +추가
              </button>
              <button
                className="px-2 py-1 rounded-full bg-gray-600 text-white disabled:opacity-40"
                type="button"
                disabled={!activeGroup}
                onClick={() => {
                  if (!activeGroup) return;
                  setEditingGroupId(activeGroup.id);
                  setEditingLabel(activeGroup.label || "");
                }}
              >
                이름 변경
              </button>
              <button
                className="px-2 py-1 rounded-full bg-red-600 text-white disabled:opacity-40"
                type="button"
                disabled={!activeGroup || groups.length <= 1}
                onClick={handleDeleteGroup}
              >
                삭제
              </button>
            </div>
          </div>
          {editingGroupId && (
            <div
              className="mb-2 flex items-center gap-2"
              data-no-gesture
              style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
            >
              <input
                autoFocus
                className="flex-1 bg-gray-900 rounded-xl px-3 py-2 text-[12px] border border-indigo-400 text-white"
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
                className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-[12px]"
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
              >
                저장
              </button>
              <button
                className="px-2 py-2 rounded-xl bg-gray-700 text-gray-200 text-[12px]"
                type="button"
                onClick={() => {
                  setEditingGroupId(null);
                  setEditingLabel("");
                }}
              >
                취소
              </button>
            </div>
          )}
          <div
            className="mt-1 p-2 rounded-xl bg-gray-900 shadow-lg border border-gray-700"
            data-no-gesture
            style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <input
                className="flex-1 bg-gray-700 rounded-xl px-2 py-1 text-sm"
                placeholder="이름 검색…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              <span className="text-xs text-gray-400">({pickerDepot})</span>
            </div>
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
              }}
            >
              {selectableNames.map((n) => {
                const bg = highlightMap?.[n] || "#374151",
                  fg = getContrastText(bg);
                return (
                  <button
                    key={`${pickerDepot}::${n}`}
                    onClick={() => addPerson(n, pickerDepot)}
                    className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold truncate transition-opacity"
                    title={`${pickerDepot} • ${n} 추가`}
                    style={{
                      backgroundColor: bg,
                      color: fg,
                      border: "1px solid rgba(255,255,255,0.15)",
                      opacity: 0.95,
                    }}
                    type="button"
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <div className="relative mt-2" style={{ zIndex: 1 }}>
        {todayColIndex >= 0 && (
          <div
            className="absolute pointer-events-none border-2 border-red-400 rounded-md"
            style={{
              top: 0,
              left: `calc(${NAME_COL_W}px + ${todayColIndex} * ((100% - ${NAME_COL_W}px) / 7))`,
              width: `calc((100% - ${NAME_COL_W}px) / 7)`,
              height: headerH + bodyH,
              zIndex: 4,
            }}
          />
        )}
        <div ref={headerRef} style={{ position: "relative", zIndex: 2 }}>
          <div
            className="grid rounded-t-xl overflow-hidden"
            style={{
              gridTemplateColumns: `${NAME_COL_W}px repeat(7, minmax(0,1fr))`,
              pointerEvents: "none",
            }}
          >
            <div className="bg-white-1000 px-1 py-4 text-[17px] font-semibold border-r border-gray-700">
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
        <div
          className="relative"
          style={{
            height: contentH,
            transform: `translateY(${
              -weekPage * contentH + dragY
            }px) translateX(${dragX}px)`,
            transition: snapping ? "transform 300ms ease-out" : "none",
            willChange: "transform",
            zIndex: 1,
          }}
        >
          {weeks.map((weekDays, wi) => (
            <div
              key={"w" + wi}
              className="pb-4"
              style={{ minHeight: contentH }}
            >
              <div
                className="divide-y divide-gray-700 rounded-b-xl overflow-hidden"
                ref={(el) => (weekBodyRefs.current[wi] = el)}
              >
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
                    {weekDays.map((d) => {
                      const row = rowAtDateFor(name, depot, d);
                      const t = computeInOut(
                        row,
                        d,
                        holidaySet,
                        nightDiaThreshold
                      );
                      const dia =
                        row?.dia === undefined
                          ? "-"
                          : typeof row.dia === "number"
                          ? row.dia
                          : String(row.dia).replace(/\s+/g, "");
                      const diaLabel =
                        row?.dia == null
                          ? ""
                          : String(row.dia).replace(/\s+/g, "");
                      const finalLabel = isOverridden(name, depot, d)
                        ? diaLabel
                          ? `*${diaLabel}`
                          : "*"
                        : diaLabel || "-";
                      const outside = d.getMonth() !== monthIdx;
                      let bgColor = "bg-gray-800/60";
                      const norm = (v) =>
                        typeof v === "string" ? v.replace(/\s/g, "") : v;
                      const isOffDia = (v) =>
                        typeof v === "string" &&
                        (v.includes("비") || v.startsWith("휴"));
                      const isTime = (v) =>
                        typeof v === "string" &&
                        /^\d{1,2}\s*:\s*\d{2}$/.test(v);
                      const todayDia = norm(row?.dia);
                      const nextDay = addDaysSafe(d, 1);
                      const nextDia = norm(
                        rowAtDateFor(name, depot, nextDay)?.dia
                      );
                      if (isOffDia(todayDia)) {
                        bgColor = "bg-gray-800/60";
                      } else {
                        const MORNING_HOUR = 12,
                          outH = hourFromStr(t.out);
                        let isNight = false;
                        if (depot === "교대" || depot === "교대(외)") {
                          isNight =
                            todayDia === "야" &&
                            typeof nextDia === "string" &&
                            nextDia.startsWith("휴");
                        } else {
                          const nextIsBiban =
                            typeof nextDia === "string" &&
                            nextDia.includes("비");
                          const outIsMorning =
                            outH != null && outH <= MORNING_HOUR;
                          isNight = nextIsBiban || outIsMorning;
                        }
                        const hasWork =
                          (isTime(t.in) ||
                            isTime(t.out) ||
                            isSCodeDay?.(t.in) ||
                            isSCodeDay?.(t.out)) &&
                          !isNight;
                        if (isNight) bgColor = "bg-sky-500/30";
                        else if (hasWork) bgColor = "bg-yellow-500/30";
                        else bgColor = "bg-gray-800/60";
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
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 text-[10px] text-gray-400 text-center">
        ← 오른쪽: 다음달 / 왼쪽: 전달 · 위/아래: 주 변경
      </div>
    </div>
  );
}
