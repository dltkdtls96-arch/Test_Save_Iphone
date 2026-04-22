/**
 * dataEngine.js  (v4 - ZIP 핸들 자동 복구)
 *
 *  [v3 → v4 변경점]
 *   ✅ getPathImageURL() 에서 ZIP 핸들이 없으면 IDB에서 즉시 복원 시도
 *   ✅ restoreZipHandleFromDB 실패 시 명확한 로깅
 *   ✅ 이미지 로드 실패 시 자동 재시도 (핸들 복구 후 한 번 더)
 *
 *  결과: 앱 업데이트 / 탭 재시작 후 행로표가 안 뜨던 버그 해결
 */

import JSZip from "jszip";

// ─────────────────────────────────────────────
//  상수
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

const VALID_PATH_FOLDERS = [
  "nor",
  "sat",
  "hol",
  "nor_sat",
  "sat_hol",
  "hol_nor",
  "nor_hol",
  "hol_sat",
  "hor_sat",
];

const ALARM_FOLDERS = ["nor", "sat", "hol"];

const NIGHT_START_BY_DEPOT = {
  안심: 25,
  월배: 25,
  경산: 21,
  문양: 24,
};

// ─────────────────────────────────────────────
//  ZIP 핸들 레지스트리 (메모리 전용)
// ─────────────────────────────────────────────

const _zipHandles = new Map(); // depotKey → JSZip instance

const _imageCache = new Map(); // "as::nor::25" → { url, blob }
const IMAGE_CACHE_MAX = 150;

function _setImageCache(key, url, blob) {
  if (_imageCache.has(key)) _imageCache.delete(key);
  _imageCache.set(key, { url, blob });
  while (_imageCache.size > IMAGE_CACHE_MAX) {
    const first = _imageCache.keys().next().value;
    const entry = _imageCache.get(first);
    if (entry?.url) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch {}
    }
    _imageCache.delete(first);
  }
}

export function registerZipHandle(depotKey, jszip) {
  _zipHandles.set(depotKey, jszip);
}

export function hasZipHandle(depotKey) {
  return _zipHandles.has(depotKey);
}

// ─────────────────────────────────────────────
//  ⭐ v4: ZIP 핸들 자동 복구 (싱글톤 Promise)
// ─────────────────────────────────────────────
//
//  첫 번째 이미지 요청 시 ZIP 핸들이 없으면 IDB에서 복원.
//  동시에 여러 이미지가 요청되어도 한 번만 복원하도록 Promise 캐싱.
//
let _restorePromise = null;

function _ensureZipHandles() {
  if (_zipHandles.size > 0) return Promise.resolve(true);
  if (_restorePromise) return _restorePromise;

  _restorePromise = restoreZipHandleFromDB("latest")
    .then((ok) => {
      if (!ok) {
        console.warn(
          "[dataEngine] ZIP 핸들 복원 실패 — zipBlobs 에 저장된 ZIP 없음"
        );
      }
      return ok;
    })
    .catch((err) => {
      console.warn("[dataEngine] ZIP 핸들 복원 중 오류:", err);
      return false;
    })
    .finally(() => {
      // 성공 여부와 무관하게 promise 초기화 (다음번 재시도 가능)
      _restorePromise = null;
    });

  return _restorePromise;
}

// ─────────────────────────────────────────────
//  날짜 / 공통 유틸
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

function parseLines(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeWorktimeLine(raw) {
  return String(raw || "")
    .replace(/\s+/g, "")
    .replace(/^-+$/, "----");
}

export function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

// ─────────────────────────────────────────────
//  ZIP 로딩 - 핵심 (텍스트만 파싱, 이미지는 인덱스만)
// ─────────────────────────────────────────────

export async function loadZipToCommonMap(fileOrBlob, onProgress) {
  const report = (phase, loaded, total) => {
    try {
      onProgress?.({ phase, loaded, total });
    } catch {}
  };

  report("opening", 0, 1);
  const zip = await JSZip.loadAsync(fileOrBlob);

  const txtEntries = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (relativePath.toLowerCase().endsWith(".txt")) {
      txtEntries.push({ relativePath, entry });
    }
  });

  const total = txtEntries.length;
  report("reading_texts", 0, total);

  const parsedTexts = {};
  let done = 0;
  const CHUNK = 32;
  for (let i = 0; i < txtEntries.length; i += CHUNK) {
    const batch = txtEntries.slice(i, i + CHUNK);
    await Promise.all(
      batch.map(async ({ relativePath, entry }) => {
        try {
          parsedTexts[relativePath] = await entry.async("string");
        } catch (err) {
          console.warn("[ZIP txt fail]", relativePath, err);
        }
        done += 1;
        if (done % 16 === 0 || done === total) {
          report("reading_texts", done, total);
        }
      })
    );
  }

  const imageIndex = {};
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const lower = relativePath.toLowerCase();
    if (!/\.(png|jpg|jpeg)$/i.test(lower)) return;

    const clean = relativePath.replace(/^[^/]+\//, "");
    const m = clean.match(
      /^([a-z]+)\/path\/([a-z_]+)\/([^/]+)\.(png|jpg|jpeg)$/i
    );
    if (!m) return;
    const [, depotKey, folder, num] = m;
    if (!ZIP_KEY_TO_DEPOT[depotKey]) return;
    if (!VALID_PATH_FOLDERS.includes(folder)) return;

    if (!imageIndex[depotKey]) imageIndex[depotKey] = {};
    if (!imageIndex[depotKey][folder]) imageIndex[depotKey][folder] = new Set();
    imageIndex[depotKey][folder].add(num);
  });

  report("parsing", total, total);

  const result = _parseTextsToCommonMap(parsedTexts, imageIndex);

  for (const key of Object.keys(result)) {
    _zipHandles.set(key, zip);
  }

  report("done", total, total);
  return result;
}

function _parseTextsToCommonMap(parsedTexts, imageIndex) {
  const normalized = {};
  for (const [raw, content] of Object.entries(parsedTexts)) {
    const clean = raw.replace(/^[^/]+\//, "");
    normalized[clean] = content;
  }

  const result = {};
  for (const key of Object.keys(ZIP_KEY_TO_DEPOT)) {
    const prefix = `${key}/`;
    const files = {};
    for (const [p, c] of Object.entries(normalized)) {
      if (p.startsWith(prefix)) files[p.slice(prefix.length)] = c;
    }
    if (!Object.keys(files).length) continue;
    result[key] = _buildCommonFromZipFiles(key, files, imageIndex[key] || {});
  }
  return result;
}

function _buildCommonFromZipFiles(key, files, imgIndex) {
  const depot = ZIP_KEY_TO_DEPOT[key] || key;

  const gyobun = parseLines(files["basedata/gyobun.txt"] || "");
  const names = parseLines(files["basedata/name.txt"] || "");
  const infoLines = parseLines(files["basedata/info.txt"] || "");

  const baseDate =
    infoLines.length >= 3
      ? `${infoLines[0]}-${String(infoLines[1]).padStart(2, "0")}-${String(
          infoLines[2]
        ).padStart(2, "0")}`
      : formatDate(new Date());
  const baseCode = infoLines[3] || gyobun[0] || "";
  const baseName = infoLines[4] || names[0] || "";

  const worktime = {
    nor: _parseWorktimeMap(files["basedata/nor_worktime.txt"] || "", gyobun),
    sat: _parseWorktimeMap(files["basedata/sat_worktime.txt"] || "", gyobun),
    hol: _parseWorktimeMap(files["basedata/hol_worktime.txt"] || "", gyobun),
  };

  const paths = {};
  for (const folder of VALID_PATH_FOLDERS) {
    paths[folder] = {};
    const set = imgIndex[folder];
    if (set) {
      for (const num of set) {
        paths[folder][num] = true;
      }
    }
  }

  const alarms = { nor: {}, sat: {}, hol: {} };
  for (const folder of ALARM_FOLDERS) {
    const folderPrefix = `alarm/${folder}/`;
    for (const [p, content] of Object.entries(files)) {
      if (!p.startsWith(folderPrefix)) continue;
      if (typeof content !== "string") continue;
      const filename = p.slice(folderPrefix.length);
      const m = filename.match(/^(?:nor|sat|hol)_(.+?)\.txt$/i);
      if (!m) continue;
      alarms[folder][m[1].toLowerCase()] = _parseAlarmEntries(content);
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
    alarms,
    _hasZipHandle: true,
  };
}

function _parseAlarmEntries(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 3) return null;
      const [train, timeRaw, tag] = parts;
      if (!/^\d{6}$/.test(timeRaw)) return null;
      const hh = timeRaw.slice(0, 2);
      const mm = timeRaw.slice(2, 4);
      const ss = timeRaw.slice(4, 6);
      return { train, time: `${hh}:${mm}:${ss}`, hm: `${hh}:${mm}`, tag };
    })
    .filter(Boolean);
}

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

export function tsvRowsToCommon(depot, rows, anchorDate) {
  const gyobun = rows.map((r) => _tsvDiaToCode(r.dia));
  const names = rows.map((r) => r.name);

  const worktime = { nor: {}, sat: {}, hol: {} };
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
    paths: {},
    alarms: { nor: {}, sat: {}, hol: {} },
  };
}

function _tsvDiaToCode(dia) {
  if (typeof dia === "number") return `${dia}d`;
  const s = String(dia || "").trim();
  if (!s) return "----";
  return s;
}

function _tsvTimeToWorktime(timeObj) {
  const i = String(timeObj?.in || "").trim();
  const o = String(timeObj?.out || "").trim();
  if (!i && !o) return "----";
  if (!i) return `-${o}`;
  if (!o) return `${i}-`;
  return `${i}-${o}`;
}

export function loadPathsIntoCommon(common, zipParsedFiles) {
  const key = common.key || DEPOT_TO_ZIP_KEY[common.depot] || "";
  const zipData = zipParsedFiles?.[key];
  if (!zipData) return common;
  return {
    ...common,
    paths: zipData.paths || {},
    alarms: zipData.alarms || common.alarms || { nor: {}, sat: {}, hol: {} },
    _hasZipHandle: zipData._hasZipHandle || false,
  };
}

// ─────────────────────────────────────────────
//  핵심 계산
// ─────────────────────────────────────────────

export function rebaseDepotToToday(data, todayStr) {
  if (!data?.names?.length || !data?.gyobun?.length || !data?.baseDate) {
    return data;
  }
  if (data.baseDate === todayStr) return data;

  const norm = (s) => String(s || "").replace(/\s+/g, "");
  const len = data.names.length;

  const baseNameIdx = data.baseName
    ? data.names.findIndex((n) => norm(n) === norm(data.baseName))
    : -1;
  const baseCodeIdx = data.baseCode
    ? data.gyobun.findIndex(
        (c) =>
          String(c || "")
            .trim()
            .toLowerCase() ===
          String(data.baseCode || "")
            .trim()
            .toLowerCase()
      )
    : -1;

  const offset = diffDays(data.baseDate, todayStr);

  const shift =
    baseNameIdx >= 0 && baseCodeIdx >= 0
      ? baseNameIdx - baseCodeIdx - offset
      : -offset;

  const namesToday = new Array(len);
  const phonesToday = new Array(len);
  const oldPhones = data.phones || [];
  for (let i = 0; i < len; i++) {
    const origIdx = positiveMod(i + shift, len);
    namesToday[i] = data.names[origIdx];
    phonesToday[i] = oldPhones[origIdx] || "";
  }

  const newBaseName =
    baseCodeIdx >= 0 && baseCodeIdx < len
      ? namesToday[baseCodeIdx]
      : namesToday[0];
  const newBaseCode =
    baseCodeIdx >= 0 && baseCodeIdx < len
      ? data.gyobun[baseCodeIdx]
      : data.gyobun[0];

  return {
    ...data,
    names: namesToday,
    phones: phonesToday,
    baseDate: todayStr,
    baseName: newBaseName,
    baseCode: newBaseCode,
  };
}

export function getCodeForDate(common, name, dateStr, overrides = {}) {
  const overrideKey = `${common.depot}::${name}::${dateStr}`;
  if (overrides[overrideKey]) return overrides[overrideKey];

  const norm = (s) => String(s || "").replace(/\s+/g, "");
  const nameIdx = common.names.findIndex((n) => norm(n) === norm(name));
  if (nameIdx < 0 || !common.gyobun.length) return "";

  const len = common.gyobun.length;
  const offset = diffDays(common.baseDate, dateStr);

  const baseNameIdx = common.baseName
    ? common.names.findIndex((n) => norm(n) === norm(common.baseName))
    : -1;
  const baseCodeIdx = common.baseCode
    ? common.gyobun.findIndex(
        (c) =>
          String(c || "")
            .trim()
            .toLowerCase() ===
          String(common.baseCode || "")
            .trim()
            .toLowerCase()
      )
    : -1;

  let codeIdx;
  if (baseNameIdx >= 0 && baseCodeIdx >= 0) {
    codeIdx = positiveMod(nameIdx - baseNameIdx + baseCodeIdx + offset, len);
  } else {
    codeIdx = positiveMod(nameIdx + offset, len);
  }
  return common.gyobun[codeIdx] || "";
}

export function getWorktime(common, code, dateStr, holidaySet = new Set()) {
  const dayType = _getDayType(dateStr, holidaySet);
  const raw = common.worktime?.[dayType]?.[normalizeCode(code)] || "----";
  return _splitWorktime(raw);
}

// ─────────────────────────────────────────────
//  이미지 URL 획득 (v4 - 자동 복구)
// ─────────────────────────────────────────────

/**
 * @returns { url, loading, promise }
 *   - 캐시 HIT: { url: "blob:...", loading: false, promise: null }
 *   - 캐시 MISS + 핸들 있음: { url: null, loading: true, promise: Promise<url|null> }
 *   - 핸들 없음: { url: null, loading: true, promise: Promise<url|null> }
 *       (v4: 핸들이 없어도 즉시 실패하지 않고 IDB 복원 시도)
 */
export function getPathImageURL(common, code, dateStr, holidaySet = new Set()) {
  const empty = { url: null, loading: false, promise: null };
  if (!code || !common?.paths) return empty;

  const sNorm = normalizeCode(code);
  if (
    !sNorm ||
    sNorm === "----" ||
    sNorm.startsWith("휴") ||
    sNorm.startsWith("대") ||
    sNorm.includes("비번") ||
    sNorm === "비"
  ) {
    return empty;
  }

  const folder = _getPathFolder(common, code, dateStr, holidaySet);
  if (!folder) return empty;
  const num = String(code).replace(/[^0-9]/g, "");
  if (!num) return empty;

  const entry = common.paths[folder]?.[num];
  if (!entry) return empty;

  // v1 레거시: dataURL
  if (typeof entry === "string" && entry.startsWith("data:")) {
    return { url: entry, loading: false, promise: null };
  }

  // v2 레거시: Blob
  if (entry instanceof Blob) {
    const cacheKey = `${common.key}::${folder}::${num}`;
    const cached = _imageCache.get(cacheKey);
    if (cached) return { url: cached.url, loading: false, promise: null };
    const url = URL.createObjectURL(entry);
    _setImageCache(cacheKey, url, entry);
    return { url, loading: false, promise: null };
  }

  // v3/v4: sentinel → ZIP 핸들에서 지연 로드
  const cacheKey = `${common.key}::${folder}::${num}`;
  const cached = _imageCache.get(cacheKey);
  if (cached) return { url: cached.url, loading: false, promise: null };

  // ⭐ v4: 핸들이 없으면 IDB 에서 복원 시도하는 promise 반환
  const promise = _loadImageWithAutoRestore(common.key, folder, num);
  return { url: null, loading: true, promise };
}

/**
 * v4: 핸들이 있으면 바로 로드, 없으면 IDB 에서 복원 후 로드
 */
async function _loadImageWithAutoRestore(depotKey, folder, num) {
  const cacheKey = `${depotKey}::${folder}::${num}`;
  const cached = _imageCache.get(cacheKey);
  if (cached) return cached.url;

  // 1) 핸들 있으면 바로 시도
  let zip = _zipHandles.get(depotKey);

  // 2) 없으면 IDB 에서 복원 시도
  if (!zip) {
    const restored = await _ensureZipHandles();
    if (!restored) {
      console.warn(
        `[dataEngine] 이미지 로드 실패 — ZIP 복원 불가 (${depotKey}/${folder}/${num})`
      );
      return null;
    }
    zip = _zipHandles.get(depotKey);
    if (!zip) {
      console.warn(
        `[dataEngine] ZIP 복원은 성공했지만 ${depotKey} 핸들 없음`
      );
      return null;
    }
  }

  // 3) ZIP 에서 이미지 꺼내기
  return _lazyLoadImageFromZip(zip, depotKey, folder, num);
}

async function _lazyLoadImageFromZip(zip, depotKey, folder, num) {
  const cacheKey = `${depotKey}::${folder}::${num}`;
  const cached = _imageCache.get(cacheKey);
  if (cached) return cached.url;

  const rootFolders = Object.keys(zip.files)
    .filter((p) => p.includes("/"))
    .map((p) => p.split("/")[0]);
  const rootName = rootFolders[0] || "";

  const candidates = [
    `${rootName}/${depotKey}/path/${folder}/${num}.png`,
    `${depotKey}/path/${folder}/${num}.png`,
    `${rootName}/${depotKey}/path/${folder}/${num}.jpg`,
    `${depotKey}/path/${folder}/${num}.jpg`,
  ];

  for (const path of candidates) {
    const entry = zip.file(path);
    if (entry) {
      try {
        const blob = await entry.async("blob");
        const url = URL.createObjectURL(blob);
        _setImageCache(cacheKey, url, blob);
        return url;
      } catch (err) {
        console.warn("[lazy image load fail]", path, err);
      }
    }
  }
  return null;
}

export function getPathImage(common, code, dateStr, holidaySet = new Set()) {
  const res = getPathImageURL(common, code, dateStr, holidaySet);
  return res.url;
}

// ─────────────────────────────────────────────
//  중간알람
// ─────────────────────────────────────────────

export function getMidAlarmFromZip(
  common,
  code,
  dateStr,
  holidaySet = new Set()
) {
  if (!common?.alarms || !code) return null;
  const dayType = _getDayType(dateStr, holidaySet);
  const s = normalizeCode(code);
  const isTilde = s.includes("~");

  if (isTilde) {
    const entries = common.alarms[dayType]?.[s] || [];
    if (entries.length) return { hm: entries[0].hm, source: "tildeFirst" };
    return null;
  }

  const entries = common.alarms[dayType]?.[s] || [];
  if (!entries.length) {
    const num = parseInt(s, 10);
    const nightStart = NIGHT_START_BY_DEPOT[common.depot] ?? 25;
    if (Number.isFinite(num) && num >= nightStart) {
      const tildeKey = `${num}~`;
      const next = _nextDateStr(dateStr);
      const nextType = _getDayType(next, holidaySet);
      const nextEntries = common.alarms[nextType]?.[tildeKey] || [];
      if (nextEntries.length)
        return { hm: nextEntries[0].hm, source: "nextDayFirst" };
    }
    return null;
  }

  const cds = entries.filter((e) => e.tag === "CD");
  if (cds.length >= 2) return { hm: cds[1].hm, source: "2ndCD" };
  if (cds.length === 1) return { hm: cds[0].hm, source: "1stCD" };
  return { hm: entries[0].hm, source: "firstEvent" };
}

function _nextDateStr(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

// ─────────────────────────────────────────────
//  날짜 타입 / 폴더
// ─────────────────────────────────────────────

export function _getDayType(dateStr, holidaySet = new Set()) {
  const d = parseLocalDate(dateStr);
  const dow = d.getDay();
  if (dow === 0 || holidaySet.has(dateStr)) return "hol";
  if (dow === 6) return "sat";
  return "nor";
}

function _getPathFolder(common, code, dateStr, holidaySet) {
  const s = normalizeCode(code);
  const isTilde = s.includes("~");

  const targetDate = isTilde
    ? formatDate(new Date(parseLocalDate(dateStr).getTime() - 86400000))
    : dateStr;

  const todayType = _getDayType(targetDate, holidaySet);

  const nightStart = NIGHT_START_BY_DEPOT[common.depot] ?? 25;
  const num = parseInt(s.replace(/[^0-9]/g, ""), 10);
  const isNight = isTilde || (Number.isFinite(num) && num >= nightStart);

  if (!isNight) return todayType;

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
  return { start: start || "-", end: end || "-", raw: s };
}

// ─────────────────────────────────────────────
//  교번코드 표시
// ─────────────────────────────────────────────

export function displayCode(code) {
  const s = String(code || "").trim();
  const m = s.match(/^(\d+)d$/i);
  return m ? m[1] : s;
}

export function isNightCode(depot, code) {
  const s = normalizeCode(code);
  if (s.includes("~")) return false;
  const nightStart = NIGHT_START_BY_DEPOT[depot] ?? 25;
  const num = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(num) && num >= nightStart;
}

export function isOffCode(code) {
  const s = normalizeCode(code);
  return s.includes("~") || s.startsWith("휴") || s.includes("비번");
}

export function isRestCode(code) {
  const s = normalizeCode(code);
  return s.startsWith("휴") || s === "----" || !s;
}

// ─────────────────────────────────────────────
//  IndexedDB
// ─────────────────────────────────────────────

const IDB_NAME = "gyobeon-engine-db";
const IDB_VERSION = 2;
const STORE_NAME = "engineData";
const STORE_ZIPS = "zipBlobs";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(STORE_ZIPS)) {
        db.createObjectStore(STORE_ZIPS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCommonDataToDB(commonMap) {
  const db = await openDB();

  const lite = {};
  for (const [key, val] of Object.entries(commonMap || {})) {
    if (!val) continue;
    const pathsLite = {};
    for (const [folder, inner] of Object.entries(val.paths || {})) {
      pathsLite[folder] = {};
      for (const [num, v] of Object.entries(inner || {})) {
        if (typeof v === "string" && v.startsWith("data:")) {
          pathsLite[folder][num] = true;
        } else if (v instanceof Blob) {
          pathsLite[folder][num] = true;
        } else {
          pathsLite[folder][num] = v;
        }
      }
    }
    lite[key] = { ...val, paths: pathsLite };
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ data: lite, savedAt: Date.now() }, "commonMap");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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

export async function saveZipBlobToDB(blob, name, slotKey = "latest") {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ZIPS, "readwrite");
    const store = tx.objectStore(STORE_ZIPS);
    store.put({ blob, name, savedAt: Date.now() }, slotKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadZipBlobFromDB(slotKey = "latest") {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ZIPS, "readonly");
    const store = tx.objectStore(STORE_ZIPS);
    const req = store.get(slotKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function restoreZipHandleFromDB(slotKey = "latest") {
  try {
    const rec = await loadZipBlobFromDB(slotKey);
    if (!rec?.blob) {
      console.log("[restoreZipHandleFromDB] IDB에 저장된 ZIP blob 없음");
      return false;
    }
    const zip = await JSZip.loadAsync(rec.blob);

    const rootFolders = Array.from(
      new Set(
        Object.keys(zip.files)
          .filter((p) => p.includes("/"))
          .map((p) => p.split("/")[0])
      )
    );

    let registered = 0;
    for (const key of Object.keys(ZIP_KEY_TO_DEPOT)) {
      const candidates = [
        `${key}/basedata/gyobun.txt`,
        ...rootFolders.map((r) => `${r}/${key}/basedata/gyobun.txt`),
      ];
      for (const p of candidates) {
        if (zip.file(p)) {
          _zipHandles.set(key, zip);
          registered++;
          break;
        }
      }
    }
    console.log(
      `[restoreZipHandleFromDB] ZIP 핸들 ${registered}개 기지 복원 완료`
    );
    return _zipHandles.size > 0;
  } catch (err) {
    console.error("[restoreZipHandleFromDB] 복원 실패:", err);
    return false;
  }
}

// ─────────────────────────────────────────────
//  한국 공휴일 자동
// ─────────────────────────────────────────────

export async function fetchKoreanHolidays(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return [];
  try {
    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${y}/KR`,
      { cache: "force-cache" }
    );
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data)
        ? data.map((h) => h.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        : [];
      if (list.length) return Array.from(new Set(list)).sort();
    }
  } catch (e) {
    console.warn("[holidays] nager.at 실패", e);
  }
  return _offlineKoreanHolidays(y);
}

export async function fetchKoreanHolidaysRange(fromYear, toYear) {
  const a = Math.min(fromYear, toYear);
  const b = Math.max(fromYear, toYear);
  const all = [];
  for (let y = a; y <= b; y++) {
    const list = await fetchKoreanHolidays(y);
    all.push(...list);
  }
  return Array.from(new Set(all)).sort();
}

function _offlineKoreanHolidays(y) {
  return [
    `${y}-01-01`,
    `${y}-03-01`,
    `${y}-05-05`,
    `${y}-06-06`,
    `${y}-08-15`,
    `${y}-10-03`,
    `${y}-10-09`,
    `${y}-12-25`,
  ];
}

// ─────────────────────────────────────────────
//  전체 초기화
// ─────────────────────────────────────────────

export async function resetAllStorage() {
  try {
    _zipHandles.clear();
  } catch {}
  try {
    for (const [, entry] of _imageCache) {
      if (entry?.url) {
        try {
          URL.revokeObjectURL(entry.url);
        } catch {}
      }
    }
    _imageCache.clear();
  } catch {}

  await new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(IDB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
      setTimeout(resolve, 3000);
    } catch {
      resolve();
    }
  });
}