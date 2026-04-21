/**
 * dataEngine.js
 * TSV 방식 / ZIP 방식 양쪽을 공통 포맷으로 정규화하고
 * 교번 계산, 출퇴근 시간 조회, 행로표 이미지 조회를 담당한다.
 *
 * ─── 공통 포맷(CommonDepotData) ────────────────────────────────
 * {
 *   depot   : string,          // "안심" | "월배" | "경산" | "문양" | ...
 *   key     : string,          // "as" | "wb" | "ks" | "my" | (TSV는 depot 그대로)
 *   source  : "tsv" | "zip",
 *
 *   gyobun  : string[],        // 교번 순환 목록  ["4d","14d","32~","휴1", ...]
 *   names   : string[],        // 이름 목록 (gyobun 과 1:1 대응)
 *
 *   baseDate: string,          // "YYYY-MM-DD"  회전 기준일
 *   baseCode: string,          // 기준일의 기준인물 교번코드
 *   baseName: string,          // 기준인물 이름
 *
 *   worktime: {
 *     nor: { [code]: "HH:MM-HH:MM" },
 *     sat: { ... },
 *     hol: { ... }
 *   },
 *
 *   // 행로표 이미지 (ZIP 로드 후 채워짐, TSV는 loadPathsFromZip()으로 별도 채움)
 *   paths: {
 *     nor     : { [diaNum]: dataURL },
 *     sat     : { ... },
 *     hol     : { ... },
 *     nor_sat : { ... },   // 평일 출근 → 토요일 퇴근 (야간)
 *     sat_hol : { ... },   // 토요일 출근 → 휴일 퇴근
 *     hol_nor : { ... },   // 휴일 출근 → 평일 퇴근
 *     nor_hol : { ... },   // 평일 출근 → 휴일 퇴근
 *     hol_sat : { ... },   // 휴일 출근 → 토요일 퇴근
 *     hor_sat : { ... },   // 폴더명 오타 버전도 대응
 *   }
 * }
 */
import JSZip from "jszip";
// ─────────────────────────────────────────────
//  상수 / 매핑
// ─────────────────────────────────────────────

export const ZIP_KEY_TO_DEPOT = {
  as: "안심",
  wb: "월배",
  ks: "경산",
  my: "문양",
};

export const DEPOT_TO_ZIP_KEY = {
  안심: "as",
  월배: "wb",
  경산: "ks",
  문양: "my",
};

// ZIP 안에서 유효한 path 폴더명 목록
const VALID_PATH_FOLDERS = [
  "nor",
  "sat",
  "hol",
  "nor_sat",
  "sat_hol",
  "hol_nor",
  "nor_hol",
  "hol_sat",
  "hor_sat", // hor_sat 은 as ZIP 오타 버전 대응
];

// 야간 기준 다이아 (소속별)
const NIGHT_START_BY_DEPOT = {
  안심: 25,
  월배: 25,
  경산: 21,
  문양: 24,
};

// ─────────────────────────────────────────────
//  날짜 유틸
// ─────────────────────────────────────────────

function parseLocalDate(dateStr) {
  const [y, m, d] = String(dateStr || "")
    .split("-")
    .map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function diffDays(fromStr, toStr) {
  const a = parseLocalDate(fromStr);
  const b = parseLocalDate(toStr);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

function positiveMod(n, m) {
  return ((n % m) + m) % m;
}

// ─────────────────────────────────────────────
//  공통 유틸
// ─────────────────────────────────────────────

function parseLines(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** "06:43 - 15:23" → "06:43-15:23",  "19:39 -" → "19:39-",  "- 10:06" → "-10:06" */
function normalizeWorktimeLine(raw) {
  return String(raw || "")
    .replace(/\s+/g, "") // 공백 제거
    .replace(/^-+$/, "----"); // "----" 통일
}

/** 교번코드 정규화: 소문자 + 공백제거 */
export function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

// ─────────────────────────────────────────────
//  ZIP 파싱
// ─────────────────────────────────────────────

/**
 * JSZip으로 읽은 파일맵(path → 내용)을 받아
 * 소속별 CommonDepotData 맵을 반환한다.
 *
 * @param {Object} parsedFiles  { "as/basedata/gyobun.txt": "...", "as/path/nor/25.png": dataURL, ... }
 * @returns {Object}  { as: CommonDepotData, wb: ..., ks: ..., my: ... }
 */
export function parseZipFiles(parsedFiles) {
  const result = {};

  // 루트 폴더명 제거: "GB_data_.../as/basedata/..." → "as/basedata/..."
  const normalized = {};
  for (const [rawPath, content] of Object.entries(parsedFiles)) {
    const clean = rawPath.replace(/^[^/]+\//, ""); // 첫 폴더명(루트) 제거
    normalized[clean] = content;
  }

  for (const key of Object.keys(ZIP_KEY_TO_DEPOT)) {
    const prefix = `${key}/`;
    const files = {};
    for (const [p, c] of Object.entries(normalized)) {
      if (p.startsWith(prefix)) files[p.slice(prefix.length)] = c;
    }
    if (!Object.keys(files).length) continue;
    result[key] = _buildCommonFromZipFiles(key, files);
  }

  return result;
}

function _buildCommonFromZipFiles(key, files) {
  const depot = ZIP_KEY_TO_DEPOT[key] || key;

  // ── basedata ──
  const gyobun = parseLines(files["basedata/gyobun.txt"] || "");
  const names = parseLines(files["basedata/name.txt"] || "");
  const infoLines = parseLines(files["basedata/info.txt"] || "");

  // info.txt: 연 / 월 / 일 / baseCode / baseName / totalCount
  const baseDate =
    infoLines.length >= 3
      ? `${infoLines[0]}-${String(infoLines[1]).padStart(2, "0")}-${String(
          infoLines[2]
        ).padStart(2, "0")}`
      : formatDate(new Date());
  const baseCode = infoLines[3] || gyobun[0] || "";
  const baseName = infoLines[4] || names[0] || "";

  // worktime
  const worktime = {
    nor: _parseWorktimeMap(files["basedata/nor_worktime.txt"] || "", gyobun),
    sat: _parseWorktimeMap(files["basedata/sat_worktime.txt"] || "", gyobun),
    hol: _parseWorktimeMap(files["basedata/hol_worktime.txt"] || "", gyobun),
  };

  // ── path 이미지 ──
  const paths = {};
  for (const folder of VALID_PATH_FOLDERS) {
    paths[folder] = {};
    const folderPrefix = `path/${folder}/`;
    for (const [p, content] of Object.entries(files)) {
      if (!p.startsWith(folderPrefix)) continue;
      const filename = p.slice(folderPrefix.length);
      // "25.png" → key "25"
      const numKey = filename.replace(/\.(png|jpg|jpeg)$/i, "");
      paths[folder][numKey] = content;
    }
  }

  return {
    depot,
    key,
    source: "zip",
    gyobun,
    names,
    baseDate,
    baseCode,
    baseName,
    worktime,
    paths,
  };
}

/** worktime.txt 한 줄씩 → { [gyobunCode]: "HH:MM-HH:MM" } */
function _parseWorktimeMap(text, gyobun) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n");
  const map = {};
  gyobun.forEach((code, idx) => {
    map[normalizeCode(code)] = normalizeWorktimeLine(lines[idx] || "----");
  });
  return map;
}

// ─────────────────────────────────────────────
//  TSV → 공통 포맷
// ─────────────────────────────────────────────

/**
 * 기존 parsePeopleTable() 결과(rows) + anchorDate 를 받아
 * CommonDepotData 로 변환한다.
 *
 * @param {string} depot       "안심" | "월배" | ...
 * @param {Array}  rows        parsePeopleTable() 반환값
 * @param {string} anchorDate  "YYYY-MM-DD"
 * @returns CommonDepotData
 */
export function tsvRowsToCommon(depot, rows, anchorDate) {
  const gyobun = rows.map((r) => _tsvDiaToCode(r.dia));
  const names = rows.map((r) => r.name);

  const worktime = {
    nor: {},
    sat: {},
    hol: {},
  };

  rows.forEach((r) => {
    const code = normalizeCode(_tsvDiaToCode(r.dia));
    if (!worktime.nor[code]) {
      worktime.nor[code] = _tsvTimeToWorktime(r.weekday);
      worktime.sat[code] = _tsvTimeToWorktime(r.saturday);
      worktime.hol[code] = _tsvTimeToWorktime(r.holiday);
    }
  });

  return {
    depot,
    key: DEPOT_TO_ZIP_KEY[depot] || depot,
    source: "tsv",
    gyobun,
    names,
    baseDate: anchorDate,
    baseCode: gyobun[0] || "",
    baseName: names[0] || "",
    worktime,
    paths: {}, // ZIP 로드 후 loadPathsIntoCommon() 으로 채움
  };
}

/** TSV dia 값 → 교번 코드  예) 27 → "27d",  "비번" → "비번",  "대3" → "대3" */
function _tsvDiaToCode(dia) {
  if (typeof dia === "number") return `${dia}d`;
  const s = String(dia || "").trim();
  if (!s) return "----";
  return s; // "휴1", "대3", "32~", "비번" 등 그대로
}

/** { in: "06:43", out: "15:23" } → "06:43-15:23" */
function _tsvTimeToWorktime(timeObj) {
  const i = String(timeObj?.in || "").trim();
  const o = String(timeObj?.out || "").trim();
  if (!i && !o) return "----";
  if (!i) return `-${o}`;
  if (!o) return `${i}-`;
  return `${i}-${o}`;
}

// ─────────────────────────────────────────────
//  ZIP 에서 path 이미지만 기존 CommonDepotData 에 주입
//  (TSV 방식 사용자가 ZIP 으로 행로표만 등록할 때)
// ─────────────────────────────────────────────

/**
 * @param {CommonDepotData} common   기존 TSV 기반 common
 * @param {Object} zipParsedFiles    parseZipFiles() 결과  { as: CommonDepotData, ... }
 * @returns CommonDepotData   paths 가 채워진 새 객체
 */
export function loadPathsIntoCommon(common, zipParsedFiles) {
  const key = common.key || DEPOT_TO_ZIP_KEY[common.depot] || "";
  const zipData = zipParsedFiles?.[key];
  if (!zipData?.paths) return common;
  return { ...common, paths: zipData.paths };
}

// ─────────────────────────────────────────────
//  핵심 계산 함수들
// ─────────────────────────────────────────────

/**
 * 특정 날짜에 특정 사람의 교번코드를 반환한다.
 *
 * @param {CommonDepotData} common
 * @param {string} name
 * @param {string} dateStr  "YYYY-MM-DD"
 * @param {Object} overrides  { [depot+name]: code }  당일 강제 변경
 * @returns string  교번코드 ("25d" | "32~" | "휴1" | ...)
 */
export function getCodeForDate(common, name, dateStr, overrides = {}) {
  // 강제 변경 우선
  const overrideKey = `${common.depot}::${name}::${dateStr}`;
  if (overrides[overrideKey]) return overrides[overrideKey];

  const nameIdx = common.names.findIndex(
    (n) => n.replace(/\s/g, "") === name.replace(/\s/g, "")
  );
  if (nameIdx < 0 || !common.gyobun.length) return "";

  const offset = diffDays(common.baseDate, dateStr);
  const codeIdx = positiveMod(nameIdx + offset, common.gyobun.length);
  return common.gyobun[codeIdx] || "";
}

/**
 * 출퇴근 시간 반환
 * @returns { start: "HH:MM", end: "HH:MM", raw: "HH:MM-HH:MM" }
 */
export function getWorktime(common, code, dateStr, holidaySet = new Set()) {
  const dayType = _getDayType(dateStr, holidaySet);
  const raw = common.worktime?.[dayType]?.[normalizeCode(code)] || "----";
  return _splitWorktime(raw);
}

/** 행로표 이미지 dataURL 반환 */
export function getPathImage(common, code, dateStr, holidaySet = new Set()) {
  if (!code || !common.paths) return null;
  const folder = _getPathFolder(common, code, dateStr, holidaySet);
  const num = String(code).replace(/[^0-9]/g, "");
  if (!num) return null;
  return common.paths[folder]?.[num] || null;
}

// ─────────────────────────────────────────────
//  날짜 타입 / 행로표 폴더 계산
// ─────────────────────────────────────────────

/** "nor" | "sat" | "hol" */
export function _getDayType(dateStr, holidaySet = new Set()) {
  const d = parseLocalDate(dateStr);
  const dow = d.getDay();
  if (dow === 0 || holidaySet.has(dateStr)) return "hol";
  if (dow === 6) return "sat";
  return "nor";
}

/**
 * 행로표 이미지 폴더명 결정
 * 야간(~포함 또는 숫자 >= nightStart) 이면 출근일 기준 다음날 퇴근 타입 조합
 */
function _getPathFolder(common, code, dateStr, holidaySet) {
  const s = normalizeCode(code);
  const isTilde = s.includes("~");

  // "~" 코드는 전날 기준으로 계산
  const targetDate = isTilde
    ? formatDate(new Date(parseLocalDate(dateStr).getTime() - 86400000))
    : dateStr;

  const todayType = _getDayType(targetDate, holidaySet);

  // 야간 여부: ~ 이거나 숫자가 nightStart 이상
  const nightStart = NIGHT_START_BY_DEPOT[common.depot] ?? 25;
  const num = parseInt(s.replace(/[^0-9]/g, ""), 10);
  const isNight = isTilde || (Number.isFinite(num) && num >= nightStart);

  if (!isNight) return todayType;

  // 야간: 다음날 타입도 구해서 "nor_sat" 같은 조합 반환
  const nextDate = formatDate(
    new Date(parseLocalDate(targetDate).getTime() + 86400000)
  );
  const nextType = _getDayType(nextDate, holidaySet);

  if (todayType === nextType) return todayType;
  return `${todayType}_${nextType}`;
}

function _splitWorktime(raw) {
  const s = String(raw || "").replace(/\s/g, "");
  if (!s || s === "----") return { start: "-", end: "-", raw: "----" };
  const [start, end] = s.split("-");
  return {
    start: start || "-",
    end: end || "-",
    raw: s,
  };
}

// ─────────────────────────────────────────────
//  교번코드 표시용 유틸
// ─────────────────────────────────────────────

/** "25d" → "25D",  "32~" → "32~",  "휴1" → "휴1",  "대3" → "대3" */
export function displayCode(code) {
  const s = String(code || "").trim();
  // "Nd" 형태: 숫자+d → 숫자만 (캘린더에선 숫자만 표시)
  const m = s.match(/^(\d+)d$/i);
  return m ? m[1] : s;
}

/** 야간 여부 */
export function isNightCode(depot, code) {
  const s = normalizeCode(code);
  if (s.includes("~")) return false; // ~ 는 비번(야간 다음날)
  const nightStart = NIGHT_START_BY_DEPOT[depot] ?? 25;
  const num = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(num) && num >= nightStart;
}

/** 비번/다음날 여부 */
export function isOffCode(code) {
  const s = normalizeCode(code);
  return s.includes("~") || s.startsWith("휴") || s.includes("비번");
}

/** 휴무(근무없음) 여부 */
export function isRestCode(code) {
  const s = normalizeCode(code);
  return s.startsWith("휴") || s === "----" || !s;
}

// ─────────────────────────────────────────────
//  IndexedDB 저장/불러오기
// ─────────────────────────────────────────────

const IDB_NAME = "gyobeon-engine-db";
const IDB_VERSION = 1;
const STORE_NAME = "engineData";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 파싱된 공통 포맷 맵 저장 (이미지 dataURL 포함 → 용량 클 수 있음) */
export async function saveCommonDataToDB(commonMap) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ data: commonMap, savedAt: Date.now() }, "commonMap");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 저장된 공통 포맷 맵 불러오기 */
export async function loadCommonDataFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get("commonMap");
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => reject(req.error);
  });
}

/** ZIP Blob 저장 */
export async function saveZipBlobToDB(blob, name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ blob, name, savedAt: Date.now() }, "latestZip");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 저장된 ZIP Blob 불러오기 */
export async function loadZipBlobFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get("latestZip");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ─────────────────────────────────────────────
//  ZIP 파일 → 파싱 → CommonMap 통합 헬퍼
// ─────────────────────────────────────────────

/**
 * ZIP File/Blob 을 받아서 파싱 후 CommonMap 반환
 * JSZip 이 window.JSZip 으로 로드돼 있어야 함
 */
export async function loadZipToCommonMap(fileOrBlob) {
  //const JSZip = window.JSZip;
  //if (!JSZip) throw new Error("JSZip 라이브러리가 로드되지 않았습니다.");

  const zip = await JSZip.loadAsync(fileOrBlob);
  const parsedFiles = {};
  const tasks = [];

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const lower = relativePath.toLowerCase();
    if (lower.endsWith(".txt")) {
      tasks.push(
        entry.async("string").then((text) => {
          parsedFiles[relativePath] = text;
        })
      );
    } else if (/\.(png|jpg|jpeg)$/i.test(lower)) {
      tasks.push(
        entry.async("base64").then((b64) => {
          const mime = lower.endsWith(".png") ? "image/png" : "image/jpeg";
          parsedFiles[relativePath] = `data:${mime};base64,${b64}`;
        })
      );
    }
  });

  await Promise.all(tasks);
  return parseZipFiles(parsedFiles);
}
