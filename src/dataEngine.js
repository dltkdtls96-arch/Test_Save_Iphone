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
      console.warn(`[dataEngine] ZIP 복원은 성공했지만 ${depotKey} 핸들 없음`);
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

// ─────────────────────────────────────────────
//  getMidAlarmFromZip — 중간 알람 시각 계산
//
//  [검증된 규칙 — 안심 zip의 MID_TABLES 177/179 일치]
//
//  routeCode 별 로직:
//    • "Nd" (주간 dia, 보통 1~24):
//        → alarm/{오늘요일}/{오늘요일}_{N}d.txt
//        → 파일의 "마지막 CD 또는 ET" 시각
//        (쉬는 시간 끝나고 다시 차 타는 시간 = 승무교대 CD)
//        주간 dia는 내일 요일과 무관 — 오늘 안에 근무 끝남
//
//    • "Nd" (야간 dia, 보통 25~37):
//        → alarm/{내일요일}/{내일요일}_{N}~.txt
//        → 파일의 "첫 줄" 시각
//        (야간 출근 후 내일 새벽에 다시 타는 시간)
//
//    • "N~" (어제 야간 나온 사람의 오늘 복귀):
//        → alarm/{오늘요일}/{오늘요일}_{N}~.txt
//        → 파일의 "첫 줄" 시각
//        (오늘이 바로 그 "복귀일")
//
//    • 그 외 ("대N", "휴N", "비번" 등): null
//
//  야간 판정: normalizeCode 결과가 "N~" 형태이거나,
//            "Nd" 형태 + N >= NIGHT_START_BY_DEPOT[depot]
// ─────────────────────────────────────────────

export function getMidAlarmFromZip(
  common,
  code,
  dateStr,
  holidaySet = new Set()
) {
  if (!common?.alarms || !code) return null;

  const s = normalizeCode(code); // "1d", "25d", "25~", "대2", "휴3" ...
  const todayType = _getDayType(dateStr, holidaySet);

  // 1) "N~" — 어제 야간 (Nd)을 입력한 사람의 비번 날.
  //    이 사람의 야간 범위 알람은 "어제 야간 다이아의 중간 시각" 기준이어야 함.
  //    → 어제 날짜 + Nd 코드로 재귀 호출하여 마지막 CD/ET (= 자정 전후 운행 종료/중간)을 가져옴.
  if (s.endsWith("~")) {
    const num = parseInt(s.replace("~", ""), 10);
    if (Number.isFinite(num)) {
      const yesterday = _prevDateStr(dateStr);
      const yesterdayCode = `${num}d`;
      const yResult = getMidAlarmFromZip(
        common,
        yesterdayCode,
        yesterday,
        holidaySet
      );
      if (yResult?.hm) {
        return {
          hm: yResult.hm,
          source: `prevday(${yesterday})/${yesterdayCode}→${yResult.source}`,
        };
      }
    }
    // 폴백: 기존 로직 (오늘 새벽 복귀)
    const entries = common.alarms[todayType]?.[s] || [];
    if (!entries.length) return null;
    return { hm: entries[0].hm, source: `${todayType}/${s}.first` };
  }

  // 2) "Nd" — 숫자+d 패턴만 처리. "대N","휴N" 등은 null.
  const match = s.match(/^(\d{1,2})d$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const nightStart = NIGHT_START_BY_DEPOT[common.depot] ?? 25;
  const isNight = num >= nightStart;

  if (isNight) {
    // 야간: 내일 요일 + N~.txt 첫 줄
    const nextDate = _nextDateStr(dateStr);
    const nextType = _getDayType(nextDate, holidaySet);
    const tildeKey = `${num}~`;
    const entries = common.alarms[nextType]?.[tildeKey] || [];
    if (!entries.length) return null;
    return { hm: entries[0].hm, source: `${nextType}/${tildeKey}.first` };
  }

  // 주간: 오늘 요일 + Nd.txt 마지막 CD 또는 ET
  const entries = common.alarms[todayType]?.[s] || [];
  if (!entries.length) return null;

  // 마지막 CD 우선, 없으면 마지막 ET
  const cdEt = entries.filter((e) => e.tag === "CD" || e.tag === "ET");
  if (cdEt.length === 0) return null;

  // 첫 CD/ET는 "출근 승무"(LW와 같은 시각) — 제외하고 싶은데
  // 마지막을 고르면 자동으로 처리됨.
  const last = cdEt[cdEt.length - 1];
  return { hm: last.hm, source: `${todayType}/${s}.last_${last.tag}` };
}

function _nextDateStr(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}

function _prevDateStr(dateStr) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() - 1);
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

// ─────────────────────────────────────────────
//  ZIP blob 이중 보관소 (IndexedDB + Cache Storage)
//
//  iOS Safari PWA 환경에서 IndexedDB 가 7일 경과·앱 업데이트 등으로
//  통째로 비워지는 사례가 보고되어 있어, Cache Storage 에도 동일한
//  ZIP blob 을 복제 보관하여 한쪽이 날아가도 복구되도록 함.
//
//  - Cache Storage 는 PWA precache (Workbox) 와 분리된 커스텀 캐시명
//    `"zip-backup-v1"` 을 사용하므로 `cleanupOutdatedCaches` 에 의해
//    지워지지 않음.
//  - 가상의 URL (`/__zip-backup__/<slotKey>`) 을 키로 사용.
// ─────────────────────────────────────────────
const ZIP_CACHE_NAME = "zip-backup-v1";
const ZIP_CACHE_URL_PREFIX = "/__zip-backup__/";

async function _saveZipBlobToCache(blob, name, slotKey) {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(ZIP_CACHE_NAME);
    // blob 본체
    await cache.put(
      new Request(ZIP_CACHE_URL_PREFIX + slotKey),
      new Response(blob, {
        headers: {
          "Content-Type": "application/zip",
          "X-Zip-Name": encodeURIComponent(name || ""),
          "X-Saved-At": String(Date.now()),
        },
      })
    );
    return true;
  } catch (err) {
    console.warn("[saveZipBlobToCache] 실패", err);
    return false;
  }
}

async function _loadZipBlobFromCache(slotKey) {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(ZIP_CACHE_NAME);
    const res = await cache.match(ZIP_CACHE_URL_PREFIX + slotKey);
    if (!res) return null;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("X-Zip-Name") || "");
    const savedAt = Number(res.headers.get("X-Saved-At")) || Date.now();
    return { blob, name, savedAt };
  } catch (err) {
    console.warn("[loadZipBlobFromCache] 실패", err);
    return null;
  }
}

async function _deleteZipBlobFromCache(slotKey) {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(ZIP_CACHE_NAME);
    await cache.delete(ZIP_CACHE_URL_PREFIX + slotKey);
  } catch {}
}

export async function saveZipBlobToDB(blob, name, slotKey = "latest") {
  // 1) IndexedDB 저장 (주 저장소)
  let idbOk = false;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ZIPS, "readwrite");
      const store = tx.objectStore(STORE_ZIPS);
      store.put({ blob, name, savedAt: Date.now() }, slotKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idbOk = true;
  } catch (err) {
    console.warn("[saveZipBlobToDB] IndexedDB 저장 실패, Cache 에만 저장", err);
  }

  // 2) Cache Storage 백업 (iOS IDB 증발 대비)
  await _saveZipBlobToCache(blob, name, slotKey);

  // 3) 영구 저장 권한 요청 (가능한 브라우저에서)
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {}

  return idbOk;
}

export async function loadZipBlobFromDB(slotKey = "latest") {
  // 1) IndexedDB 우선
  try {
    const db = await openDB();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ZIPS, "readonly");
      const store = tx.objectStore(STORE_ZIPS);
      const req = store.get(slotKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (rec?.blob) return rec;
  } catch (err) {
    console.warn("[loadZipBlobFromDB] IndexedDB 읽기 실패, Cache 폴백", err);
  }

  // 2) Cache Storage 폴백 — 복원된 blob 을 IndexedDB 로 다시 올려둠
  const cached = await _loadZipBlobFromCache(slotKey);
  if (cached?.blob) {
    console.log(
      "[loadZipBlobFromDB] IndexedDB 비어있어 Cache Storage 에서 복원 성공"
    );
    // IDB 에도 재저장 시도 (다음번 로드 속도 향상 + 재증발 방지)
    try {
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_ZIPS, "readwrite");
        tx.objectStore(STORE_ZIPS).put(
          { blob: cached.blob, name: cached.name, savedAt: cached.savedAt },
          slotKey
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
    return cached;
  }

  return null;
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
//  🚑 commonMap 복구
//
//  IDB zipBlobs 에 ZIP 은 살아있는데 commonMap.paths(이미지 인덱스)
//  가 비어있거나 ZIP 기지가 통째로 누락된 경우 자동 복구.
//  (과거 레이스 버그로 망가진 commonMap 을 자동으로 수선)
//
//  반환: { repaired: boolean, commonMap: object|null }
//    - repaired=true 면 호출자가 반환된 commonMap 으로 state 교체 필요
//    - repaired=false 면 복구할 필요 없었거나 ZIP 이 없어서 복구 불가
// ─────────────────────────────────────────────
export async function repairCommonMapFromZipBlob(existingCommonMap) {
  try {
    const rec = await loadZipBlobFromDB("latest");
    if (!rec?.blob) {
      return { repaired: false, commonMap: existingCommonMap };
    }

    // ZIP 기지(as/wb/ks/my) 중 복구가 필요한 항목 식별.
    //
    // ⚠️ source 값은 체크하지 않음. 과거 레이스 버그로 ZIP 기지의 source 가
    // "tsv" 로 오염됐을 수 있기 때문 (안심 예시: TSV→Common 자동 변환이
    // 먼저 실행되면서 as.source="tsv" 가 되어버림). source 와 무관하게
    // "ZIP 기지 key 이고 이미지 인덱스가 0개면 복구" 로 판단.
    const needsRepair = [];
    for (const zipKey of Object.keys(ZIP_KEY_TO_DEPOT)) {
      const entry = existingCommonMap?.[zipKey];
      if (!entry) {
        needsRepair.push(zipKey);
        continue;
      }
      // 이미지 인덱스 수가 0 이면 복구 대상
      const totalImgs = Object.values(entry.paths || {}).reduce(
        (acc, folder) => acc + Object.keys(folder || {}).length,
        0
      );
      if (totalImgs === 0) needsRepair.push(zipKey);
    }

    if (needsRepair.length === 0) {
      return { repaired: false, commonMap: existingCommonMap };
    }

    console.log(`[repairCommonMap] 복구 시작 — 대상: ${needsRepair.join(",")}`);

    // ZIP 을 다시 파싱해서 fresh commonMap 을 얻는다
    const freshMap = await loadZipToCommonMap(rec.blob);
    if (!Object.keys(freshMap).length) {
      return { repaired: false, commonMap: existingCommonMap };
    }

    // 기존 commonMap 과 fresh 를 머지:
    //   - needsRepair 대상 기지: fresh 의 paths/alarms/worktime 로 덮어쓰되,
    //     사용자가 편집했을 수 있는 names/phones/gyobun/baseDate 등은
    //     기존 값이 있으면 그대로 유지.
    //   - 그 외 기지(교대/교대(외) 등): 기존 그대로.
    //
    // ⚠️ source 값은 체크하지 않음. 과거 레이스로 source="tsv" 가 되어도
    // names 배열은 보존됐을 가능성이 높으므로 값 존재 여부로만 판단.
    const merged = { ...(existingCommonMap || {}) };
    for (const zipKey of needsRepair) {
      const fresh = freshMap[zipKey];
      if (!fresh) continue;
      const existing = existingCommonMap?.[zipKey] || {};
      merged[zipKey] = {
        ...fresh,
        names: existing.names?.length ? existing.names : fresh.names,
        phones: existing.phones?.length ? existing.phones : fresh.phones,
        gyobun: existing.gyobun?.length ? existing.gyobun : fresh.gyobun,
        baseDate: existing.baseDate || fresh.baseDate,
        baseCode: existing.baseCode || fresh.baseCode,
        baseName: existing.baseName || fresh.baseName,
        // source 를 명시적으로 "zip" 으로 되돌림 (오염 방지)
        source: "zip",
      };
    }

    // IDB 에 저장 (다음 로드부터는 복구 불필요)
    try {
      await saveCommonDataToDB(merged);
    } catch (e) {
      console.warn("[repairCommonMap] IDB 저장 실패", e);
    }

    console.log(
      `[repairCommonMap] 복구 완료 — ${needsRepair.length}개 기지 paths 재구성`
    );
    return { repaired: true, commonMap: merged };
  } catch (err) {
    console.error("[repairCommonMap] 실패:", err);
    return { repaired: false, commonMap: existingCommonMap };
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

  // Cache Storage 의 ZIP 백업도 함께 제거
  try {
    if (typeof caches !== "undefined") {
      await caches.delete(ZIP_CACHE_NAME);
    }
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

// ─────────────────────────────────────────────
//  🔍 저장소 진단
//
//  행로표 이미지가 날아가는 원인을 정확히 파악하기 위한 함수.
//  IndexedDB, Cache Storage, 메모리 핸들의 현재 상태를 문자열로 반환.
// ─────────────────────────────────────────────
export async function diagnoseStorage() {
  const lines = [];
  const push = (l) => lines.push(l);

  push("=== 저장소 진단 ===");
  push("시각: " + new Date().toISOString());
  try {
    push(
      "PWA standalone: " +
        !!(
          window.matchMedia?.("(display-mode: standalone)")?.matches ||
          window.navigator?.standalone
        )
    );
  } catch {}

  // 1) navigator.storage
  try {
    if (navigator.storage?.persisted) {
      push("persisted: " + (await navigator.storage.persisted()));
    } else {
      push("persisted: API 없음");
    }
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const usageMB = Math.round(((est.usage || 0) / 1024 / 1024) * 10) / 10;
      const quotaMB = Math.round((est.quota || 0) / 1024 / 1024);
      push(`storage: ${usageMB}MB / ${quotaMB}MB`);
    }
  } catch (e) {
    push("storage API err: " + (e?.message || e));
  }

  // 2) IndexedDB - zipBlobs 스토어
  try {
    const db = await openDB();
    push("IDB stores: " + Array.from(db.objectStoreNames).join(","));

    await new Promise((resolve) => {
      const tx = db.transaction(STORE_ZIPS, "readonly");
      const store = tx.objectStore(STORE_ZIPS);
      const allKeys = store.getAllKeys();
      allKeys.onsuccess = () => {
        push("IDB zipBlobs keys: " + JSON.stringify(allKeys.result || []));
      };
      const req = store.get("latest");
      req.onsuccess = () => {
        const rec = req.result;
        if (rec?.blob) {
          const sizeKB = Math.round(rec.blob.size / 1024);
          const savedAt = rec.savedAt
            ? new Date(rec.savedAt).toISOString()
            : "?";
          push(
            `IDB latest: ✅ ${
              rec.name || "?"
            } / ${sizeKB}KB / savedAt=${savedAt}`
          );
        } else {
          push("IDB latest: ❌ 없음");
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        push("IDB read err: " + tx.error?.message);
        resolve();
      };
    });

    // commonMap 크기
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get("commonMap");
      req.onsuccess = () => {
        const rec = req.result;
        if (rec?.data) {
          const keys = Object.keys(rec.data);
          push(`IDB commonMap: ✅ ${keys.length}개 기지 [${keys.join(",")}]`);
          for (const k of keys) {
            const pathFolders = Object.keys(rec.data[k]?.paths || {});
            const totalImgs = pathFolders.reduce(
              (acc, f) => acc + Object.keys(rec.data[k].paths[f] || {}).length,
              0
            );
            push(`   └ ${k}: ${totalImgs}개 이미지 인덱스`);
          }
        } else {
          push("IDB commonMap: ❌ 없음");
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {
    push("IDB open err: " + (e?.message || e));
  }

  // 3) Cache Storage
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      push("Cache Storage names: " + JSON.stringify(names));
      if (names.includes(ZIP_CACHE_NAME)) {
        const cache = await caches.open(ZIP_CACHE_NAME);
        const reqs = await cache.keys();
        push(`Cache ${ZIP_CACHE_NAME} entries: ${reqs.length}`);
        for (const r of reqs) {
          const res = await cache.match(r);
          const blob = res ? await res.blob() : null;
          push(
            `   └ ${r.url}: ${
              blob ? Math.round(blob.size / 1024) + "KB" : "empty"
            }`
          );
        }
      } else {
        push(`Cache ${ZIP_CACHE_NAME}: ❌ 없음`);
      }
    } else {
      push("Cache Storage: API 없음");
    }
  } catch (e) {
    push("Cache Storage err: " + (e?.message || e));
  }

  // 4) 메모리 _zipHandles
  push(
    `메모리 _zipHandles: ${_zipHandles.size}개 [${Array.from(
      _zipHandles.keys()
    ).join(",")}]`
  );
  push(`메모리 _imageCache: ${_imageCache.size}개`);

  // 5) localStorage 주요 키
  try {
    const lsKeys = Object.keys(localStorage);
    push("localStorage keys: " + lsKeys.length + "개");
    const saved = localStorage.getItem("workCalendarSettingsV3");
    if (saved) {
      const parsed = JSON.parse(saved);
      const tbd = parsed.tablesByDepot || {};
      const tbdSummary = Object.entries(tbd)
        .map(([k, v]) => `${k}:${v ? v.length + "c" : "∅"}`)
        .join(" ");
      push("  tablesByDepot: " + tbdSummary);
    }
  } catch (e) {
    push("localStorage err: " + (e?.message || e));
  }

  // 6) 🔥 실제 이미지 로드 테스트 — 각 depot 에서 첫 이미지 하나씩 꺼내봄
  push("");
  push("=== 이미지 로드 테스트 ===");
  try {
    for (const [depotKey, zip] of _zipHandles) {
      try {
        // ZIP 파일 목록에서 이 depot의 첫 이미지 찾기
        const allPaths = Object.keys(zip.files);
        const depotImages = allPaths.filter((p) => {
          if (zip.files[p].dir) return false;
          if (!/\.(png|jpg|jpeg)$/i.test(p)) return false;
          // 경로에 이 depot 키가 포함돼야 함
          return (
            p.toLowerCase().includes(`/${depotKey}/path/`) ||
            p.toLowerCase().startsWith(`${depotKey}/path/`)
          );
        });
        push(`${depotKey}: ZIP 내 이미지 ${depotImages.length}개`);
        if (depotImages.length > 0) {
          push(`  └ 샘플 경로: ${depotImages[0]}`);
          // 실제 한 장 꺼내보기
          const sample = depotImages[0];
          const parts = sample.split("/");
          // 경로 구조 파악: 보통 [rootFolder/]depotKey/path/folder/num.png
          let folder = "",
            num = "";
          const pathIdx = parts.indexOf("path");
          if (pathIdx >= 0 && pathIdx + 2 < parts.length) {
            folder = parts[pathIdx + 1];
            num = parts[pathIdx + 2].replace(/\.(png|jpg|jpeg)$/i, "");
          }
          if (folder && num) {
            try {
              const url = await _lazyLoadImageFromZip(
                zip,
                depotKey,
                folder,
                num
              );
              if (url) {
                push(`  └ ✅ 로드 성공 (folder=${folder}, num=${num})`);
              } else {
                push(
                  `  └ ❌ 로드 실패 (folder=${folder}, num=${num}) — candidates 전부 매칭 안 됨`
                );
                push(
                  `     rootFolders=${Array.from(
                    new Set(
                      allPaths
                        .filter((p) => p.includes("/"))
                        .map((p) => p.split("/")[0])
                    )
                  ).join(",")}`
                );
              }
            } catch (e) {
              push(`  └ ❌ 예외: ${e?.message || e}`);
            }
          }
        }
      } catch (e) {
        push(`${depotKey}: 예외 ${e?.message || e}`);
      }
    }
  } catch (e) {
    push("이미지 테스트 err: " + (e?.message || e));
  }

  return lines.join("\n");
}
