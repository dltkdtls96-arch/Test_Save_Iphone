/**
 * routeImage.jsx  (v3 - 지연 로드 대응)
 *
 * v2 → v3 변경: paths[folder][num] 이 sentinel(true) 일 수 있음
 *  → getPathImageURL()(dataEngine) 을 통해 비동기로 실제 objectURL 얻어옴
 *  → 로드 완료 시 자동 리렌더
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  displayCode,
  normalizeCode,
  getPathImageURL as _engineGetPathImageURL,
} from "../dataEngine";

// ─────────────────────────────────────────────
//  폴더 계산
// ─────────────────────────────────────────────

const NIGHT_START = {
  안심: 25,
  월배: 25,
  경산: 21,
  문양: 24,
};

function getDayType(dateStr, holidaySet = new Set()) {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  if (dow === 0 || holidaySet.has(dateStr)) return "hol";
  if (dow === 6) return "sat";
  return "nor";
}

function addOneDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function subOneDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function getPathFolder(depot, code, dateStr, holidaySet = new Set()) {
  const s = (code || "").trim().toLowerCase().replace(/\s/g, "");
  if (!s || s.startsWith("휴") || s.startsWith("대") || s === "----")
    return null;

  const isTilde = s.includes("~");
  const baseDate = isTilde ? subOneDay(dateStr) : dateStr;
  const todayType = getDayType(baseDate, holidaySet);

  const num = parseInt(s.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(num)) return todayType;

  const nightStart = NIGHT_START[depot] ?? 25;
  const isNight = num >= nightStart;

  if (!isNight) return todayType;

  const nextType = getDayType(addOneDay(baseDate), holidaySet);
  if (todayType === nextType) return todayType;
  return `${todayType}_${nextType}`;
}

/**
 * 기존 시그니처 유지(동기): paths 직접 조회
 * v3에서는 entry가 sentinel(true)일 수 있음 → 이 경우 null 반환
 *   (실제 URL은 별도로 getPathImageURL 사용)
 */
export function getPathImage(
  paths,
  depot,
  code,
  dateStr,
  holidaySet = new Set()
) {
  if (!paths || !code) return null;
  const s = (code || "").trim().toLowerCase().replace(/\s/g, "");
  if (!s || s.startsWith("휴") || s.startsWith("대") || s === "----")
    return null;

  const folder = getPathFolder(depot, code, dateStr, holidaySet);
  if (!folder) return null;

  const num = String(parseInt(s.replace(/[^0-9]/g, ""), 10));
  if (!num || num === "NaN") return null;

  const tryGet = (f) => {
    const v = paths[f]?.[num];
    if (typeof v === "string" && v.startsWith("data:")) return v; // v1 호환
    return null;
  };

  const direct = tryGet(folder);
  if (direct) return direct;
  if (folder === "hol_nor" && tryGet("hor_sat")) return tryGet("hor_sat");
  if (folder === "hor_sat" && tryGet("hol_nor")) return tryGet("hol_nor");
  const simple = folder.split("_")[0];
  if (simple !== folder && tryGet(simple)) return tryGet(simple);
  return null;
}

/** 폴더 존재 여부만 확인 (v3 sentinel도 true로 간주) */
function hasPathImage(paths, depot, code, dateStr, holidaySet = new Set()) {
  if (!paths || !code) return false;
  const s = (code || "").trim().toLowerCase().replace(/\s/g, "");
  if (!s || s.startsWith("휴") || s.startsWith("대") || s === "----")
    return false;

  const folder = getPathFolder(depot, code, dateStr, holidaySet);
  if (!folder) return false;
  const num = String(parseInt(s.replace(/[^0-9]/g, ""), 10));
  if (!num || num === "NaN") return false;

  const check = (f) => {
    const v = paths[f]?.[num];
    return (
      v === true || v instanceof Blob || (typeof v === "string" && v.length > 0)
    );
  };
  if (check(folder)) return true;
  if (folder === "hol_nor" && check("hor_sat")) return true;
  if (folder === "hor_sat" && check("hol_nor")) return true;
  const simple = folder.split("_")[0];
  if (simple !== folder && check(simple)) return true;
  return false;
}

// ─────────────────────────────────────────────
//  RouteImageView — v3 비동기 대응
// ─────────────────────────────────────────────

export function RouteImageView({
  paths, // common.paths
  common, // ← v3 신규: CommonDepotData 전체 (있으면 async 로드 가능)
  depot,
  code,
  dateStr,
  holidaySet,
  busImageSrc,
  showBusDefault = true,
  scale = 1, // 이미지 배율 (기지별, 1~2)
  onScaleChange, // (newScale) => void — 있으면 +/- 버튼 표시
}) {
  const [altView, setAltView] = useState(false);
  const [asyncUrl, setAsyncUrl] = useState(null);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const longPressTimer = useRef(null);
  const longPressActive = useRef(false);

  // 날짜/코드 바뀌면 행로표로 복귀 + 비동기 로드 재시작
  useEffect(() => {
    setAltView(false);
    setAsyncUrl(null);

    // 1) v1 레거시(dataURL) 시도
    const syncSrc = getPathImage(paths, depot, code, dateStr, holidaySet);
    if (syncSrc) {
      setAsyncUrl(syncSrc);
      return;
    }

    // 2) v3 비동기 로드 (common 객체 있어야 ZIP 핸들 접근 가능)
    if (!common) return;
    const res = _engineGetPathImageURL(common, code, dateStr, holidaySet);
    if (res.url) {
      setAsyncUrl(res.url);
      return;
    }
    if (res.promise) {
      setAsyncLoading(true);
      let cancelled = false;
      res.promise
        .then((url) => {
          if (cancelled) return;
          setAsyncUrl(url || null);
        })
        .catch(() => {
          if (cancelled) return;
          setAsyncUrl(null);
        })
        .finally(() => {
          if (cancelled) return;
          setAsyncLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [dateStr, code, depot, common, paths]);

  const routeImgSrc = asyncUrl;
  const hasRoute = hasPathImage(paths, depot, code, dateStr, holidaySet);
  const noRoute = !routeImgSrc && !asyncLoading && !hasRoute;
  const showBus = altView || noRoute;
  const displaySrc = showBus ? busImageSrc : routeImgSrc;

  const folder = getPathFolder(depot, code, dateStr, holidaySet);
  const numKey = parseInt((code || "").replace(/[^0-9]/g, ""), 10);
  const matchLabel = showBus
    ? (busImageSrc || "").replace(/^\//, "")
    : `${depot}/${folder}/${numKey}`;

  const handleTouchStart = useCallback(() => {
    if (noRoute) return;
    longPressActive.current = true;
    longPressTimer.current = setTimeout(() => {
      if (longPressActive.current) setAltView((v) => !v);
    }, 600);
  }, [noRoute]);

  const handleTouchEnd = useCallback(() => {
    longPressActive.current = false;
    clearTimeout(longPressTimer.current);
  }, []);

  // 로딩 상태 UI (이미지 디코딩 중)
  if (asyncLoading && !displaySrc) {
    return (
      <div className="mt-2 rounded-xl bg-gray-900/40 flex items-center justify-center aspect-[1/1.2] text-gray-400 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          행로표 불러오는 중…
        </div>
      </div>
    );
  }

  if (!displaySrc) {
    return (
      <div className="mt-2 rounded-xl bg-gray-900/40 flex items-center justify-center aspect-[1/1.2] text-gray-500 text-sm">
        행로표 이미지 없음
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl overflow-hidden bg-black/30">
      <div
        className="relative w-full aspect-[1/1.414]"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleTouchStart}
        onMouseUp={handleTouchEnd}
      >
        <img
          src={displaySrc}
          alt={showBus ? "버스시간표" : `행로표-${code}`}
          className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none transition-all duration-300"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "center center",
          }}
        />

        <div className="absolute top-2 right-2 flex items-center gap-1">
          {onScaleChange && !showBus && (
            <div className="flex items-center gap-0.5 rounded-lg bg-gray-900/80 text-white overflow-hidden">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = Math.max(
                    1,
                    Math.round((scale - 0.1) * 100) / 100
                  );
                  onScaleChange(next);
                }}
                disabled={scale <= 1}
                className="w-6 h-6 flex items-center justify-center text-sm font-bold disabled:opacity-40"
              >
                −
              </button>
              <span className="text-[10px] font-semibold min-w-[32px] text-center">
                {scale.toFixed(1)}x
              </span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = Math.min(
                    2,
                    Math.round((scale + 0.1) * 100) / 100
                  );
                  onScaleChange(next);
                }}
                disabled={scale >= 2}
                className="w-6 h-6 flex items-center justify-center text-sm font-bold disabled:opacity-40"
              >
                +
              </button>
            </div>
          )}
          <div className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-gray-900/80 text-white">
            {showBus ? "셔틀 시간표" : "행로표"}
          </div>
        </div>

        {!noRoute && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md text-[8px] bg-gray-900/70 text-white whitespace-nowrap">
            길게 눌러 {showBus ? "행로표" : "셔틀 시간"} 보기
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 mt-1 px-1">{matchLabel}</div>
    </div>
  );
}

export function tsvDiaToRouteCode(dia) {
  if (typeof dia === "number") return `${dia}d`;
  return String(dia || "").trim();
}
