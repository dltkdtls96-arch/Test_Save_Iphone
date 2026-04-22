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
//  RouteImageView — v5: 한손가락 스와이프(부모) + 두손가락 핀치/pan + 꾹눌러 셔틀 토글
// ─────────────────────────────────────────────
//
//  제스처 설계:
//   • 한 손가락 좌/우 스와이프 → 부모(swipeRouteP0) 가 처리해서 날짜 변경.
//     (RouteImageView 는 scale === 1 이고 움직임이 감지되면 부모로 이벤트를 흘림)
//   • 한 손가락 꾹 누르기 (600ms, 움직임 없을 때) → 셔틀 시간표 ↔ 행로표 토글.
//   • 두 손가락 핀치 → 이미지 확대/축소 (0.5 ~ 4x). preventDefault 로 부모 차단.
//   • scale > 1 에서 한 손가락 드래그 → pan (확대됐을 때만 활성).
//   • 더블탭 → 1x ↔ 2x 토글.
//   • 마우스 휠 → 커서 위치 중심 확대/축소 (데스크탑).

export function RouteImageView({
  paths, // common.paths
  common, // CommonDepotData
  depot,
  code,
  dateStr,
  holidaySet,
  busImageSrc,
  showBusDefault = true,
  scale = 1,
  onScaleChange,
}) {
  const [altView, setAltView] = useState(false);
  const [asyncUrl, setAsyncUrl] = useState(null);
  const [asyncLoading, setAsyncLoading] = useState(false);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const viewportRef = useRef(null);

  const gestureRef = useRef({
    mode: null, // "pan" | "pinch" | null
    startX: 0,
    startY: 0,
    startPan: { x: 0, y: 0 },
    pinchStartDist: 0,
    pinchStartScale: 1,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    longPressTimer: null,
    longPressFired: false,
    moved: false,
  });

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 4;
  const LONG_PRESS_MS = 600;
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_DIST = 30;
  const MOVE_THRESHOLD = 8; // px — 이 이상 움직이면 탭/꾹누름 취소

  // 날짜/코드 바뀌면 행로표로 복귀 + pan 초기화
  useEffect(() => {
    setAltView(false);
    setAsyncUrl(null);
    setPan({ x: 0, y: 0 });

    const syncSrc = getPathImage(paths, depot, code, dateStr, holidaySet);
    if (syncSrc) {
      setAsyncUrl(syncSrc);
      return;
    }
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

  // scale 이 1 로 돌아오면 pan 도 리셋
  useEffect(() => {
    if (scale <= 1.001) setPan({ x: 0, y: 0 });
  }, [scale]);

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

  // pan 경계 제한
  const clampPan = useCallback((px, py, s) => {
    const el = viewportRef.current;
    if (!el) return { x: px, y: py };
    const w = el.clientWidth;
    const h = el.clientHeight;
    const maxX = (w * (s - 1)) / 2 + 20;
    const maxY = (h * (s - 1)) / 2 + 20;
    return {
      x: Math.max(-maxX, Math.min(maxX, px)),
      y: Math.max(-maxY, Math.min(maxY, py)),
    };
  }, []);

  const getLocalXY = useCallback((clientX, clientY) => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  const getPinchInfo = (touches) => {
    const t1 = touches[0];
    const t2 = touches[1];
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return {
      dist: Math.hypot(dx, dy),
      cx: (t1.clientX + t2.clientX) / 2,
      cy: (t1.clientY + t2.clientY) / 2,
    };
  };

  // anchor 중심 확대
  const zoomAtPoint = useCallback(
    (anchorLocal, oldScale, newScale) => {
      const el = viewportRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const ax = anchorLocal.x - w / 2;
      const ay = anchorLocal.y - h / 2;
      const ratio = oldScale / newScale;
      const newPanX = ax - ratio * (ax - pan.x);
      const newPanY = ay - ratio * (ay - pan.y);
      setPan(clampPan(newPanX, newPanY, newScale));
    },
    [pan, clampPan]
  );

  // ─────────────────────────────────────────
  //  터치 핸들러
  //  ※ 한 손가락 + scale===1 → 부모로 이벤트 흘리기 (e.preventDefault X)
  //     그래야 swipeRouteP0 이 스와이프로 날짜 변경 가능.
  // ─────────────────────────────────────────
  const onTouchStart = (e) => {
    if (noRoute) return;
    const g = gestureRef.current;
    g.moved = false;
    g.longPressFired = false;

    if (e.touches.length === 2) {
      // 핀치 시작 — 부모 이벤트 차단
      clearTimeout(g.longPressTimer);
      g.mode = "pinch";
      const info = getPinchInfo(e.touches);
      g.pinchStartDist = info.dist;
      g.pinchStartScale = scale;
      setIsDragging(true);
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      g.startX = t.clientX;
      g.startY = t.clientY;
      g.startPan = { ...pan };
      // scale > 1 이면 즉시 pan 모드 (부모 스와이프 금지)
      // scale === 1 이면 null — 부모가 스와이프 처리할 수 있게 이벤트 흘려보냄
      g.mode = scale > 1.001 ? "pan" : null;

      // 꾹 누르기 → 셔틀 토글 (움직임 없을 때만, hasRoute 있을 때만 의미)
      if (hasRoute) {
        g.longPressTimer = setTimeout(() => {
          if (g.moved) return;
          g.longPressFired = true;
          setAltView((v) => !v);
        }, LONG_PRESS_MS);
      }
    }
  };

  const onTouchMove = (e) => {
    if (noRoute) return;
    const g = gestureRef.current;

    // 핀치 중이면 두 손가락만 처리
    if (e.touches.length === 2 && g.mode === "pinch") {
      e.preventDefault();
      e.stopPropagation();
      const info = getPinchInfo(e.touches);
      if (g.pinchStartDist <= 0) return;
      const ratio = info.dist / g.pinchStartDist;
      const targetScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, g.pinchStartScale * ratio)
      );
      const local = getLocalXY(info.cx, info.cy);
      const el = viewportRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const ax = local.x - w / 2;
      const ay = local.y - h / 2;
      const r = scale / targetScale;
      const newPanX = ax - r * (ax - pan.x);
      const newPanY = ay - r * (ay - pan.y);
      setPan(clampPan(newPanX, newPanY, targetScale));
      onScaleChange?.(Math.round(targetScale * 100) / 100);
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;
      const moved = Math.hypot(dx, dy) > MOVE_THRESHOLD;
      if (moved) {
        g.moved = true;
        clearTimeout(g.longPressTimer);
      }

      if (g.mode === "pan") {
        // 확대 상태 — pan 처리, 부모 이벤트 차단
        e.preventDefault();
        e.stopPropagation();
        if (!isDragging) setIsDragging(true);
        const next = clampPan(g.startPan.x + dx, g.startPan.y + dy, scale);
        setPan(next);
        return;
      }
      // scale === 1 & 한 손가락 → 이벤트 자연 전파 (부모가 스와이프 처리)
    }
  };

  const onTouchEnd = (e) => {
    const g = gestureRef.current;
    clearTimeout(g.longPressTimer);

    // 핀치 종료
    if (g.mode === "pinch") {
      if (e.touches && e.touches.length === 1) {
        const t = e.touches[0];
        g.mode = scale > 1.001 ? "pan" : null;
        g.startX = t.clientX;
        g.startY = t.clientY;
        g.startPan = { ...pan };
        return;
      }
      g.mode = null;
      setIsDragging(false);
      return;
    }

    // 꾹 눌렀다면 이미 토글됐음 — 추가 처리 X
    if (g.longPressFired) {
      g.longPressFired = false;
      g.mode = null;
      setIsDragging(false);
      return;
    }

    // 더블탭 (움직임 없을 때만, 한 손가락 탭 완료)
    if (g.mode !== "pan" && !g.moved && e.changedTouches?.length === 1) {
      const t = e.changedTouches[0];
      const now = Date.now();
      const dt = now - g.lastTapTime;
      const dd = Math.hypot(t.clientX - g.lastTapX, t.clientY - g.lastTapY);
      if (dt < DOUBLE_TAP_MS && dd < DOUBLE_TAP_DIST) {
        const local = getLocalXY(t.clientX, t.clientY);
        if (scale > 1.1) {
          onScaleChange?.(1);
          setPan({ x: 0, y: 0 });
        } else {
          const newScale = 2;
          zoomAtPoint(local, scale, newScale);
          onScaleChange?.(newScale);
        }
        g.lastTapTime = 0;
        setIsDragging(false);
        g.mode = null;
        return;
      }
      g.lastTapTime = now;
      g.lastTapX = t.clientX;
      g.lastTapY = t.clientY;
    }

    g.mode = null;
    setIsDragging(false);
  };

  // 마우스 휠 (데스크탑)
  const onWheel = (e) => {
    if (noRoute) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
    if (Math.abs(newScale - scale) < 0.002) return;
    const local = getLocalXY(e.clientX, e.clientY);
    zoomAtPoint(local, scale, newScale);
    onScaleChange?.(Math.round(newScale * 100) / 100);
  };

  // 마우스 드래그 pan (데스크탑)
  const mouseRef = useRef({ dragging: false, sx: 0, sy: 0, startPan: null });
  const onMouseDown = (e) => {
    if (noRoute) return;
    if (scale <= 1.001) return;
    mouseRef.current = {
      dragging: true,
      sx: e.clientX,
      sy: e.clientY,
      startPan: { ...pan },
    };
    setIsDragging(true);
  };
  const onMouseMove = (e) => {
    if (!mouseRef.current.dragging) return;
    const dx = e.clientX - mouseRef.current.sx;
    const dy = e.clientY - mouseRef.current.sy;
    const next = clampPan(
      mouseRef.current.startPan.x + dx,
      mouseRef.current.startPan.y + dy,
      scale
    );
    setPan(next);
  };
  const onMouseUp = () => {
    mouseRef.current.dragging = false;
    setIsDragging(false);
  };

  // 로딩
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
        ref={viewportRef}
        className="relative w-full aspect-[1/1.414] overflow-hidden select-none"
        style={{
          // 확대 상태에서만 브라우저 기본 제스처 차단.
          // scale=1 에선 기본 허용해서 부모의 좌우 스와이프가 동작 가능하게 함.
          touchAction: scale > 1.001 ? "none" : "pan-x pan-y",
          cursor:
            scale > 1.001 ? (isDragging ? "grabbing" : "grab") : "default",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <img
          src={displaySrc}
          alt={showBus ? "버스시간표" : `행로표-${code}`}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          draggable={false}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
            transformOrigin: "center center",
            transition: isDragging
              ? "none"
              : "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        />

        {/* 상단 우측 컨트롤 — 배율 버튼 + 현재 뷰 라벨 (탭 불가, 표시만) */}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {onScaleChange && !showBus && (
            <div className="flex items-center gap-0.5 rounded-lg bg-gray-900/80 text-white overflow-hidden">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = Math.max(
                    MIN_SCALE,
                    Math.round((scale - 0.25) * 100) / 100
                  );
                  onScaleChange(next);
                }}
                disabled={scale <= MIN_SCALE + 0.001}
                className="w-6 h-6 flex items-center justify-center text-sm font-bold disabled:opacity-40"
              >
                −
              </button>
              <span className="text-[10px] font-semibold min-w-[36px] text-center">
                {scale.toFixed(1)}x
              </span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = Math.min(
                    MAX_SCALE,
                    Math.round((scale + 0.25) * 100) / 100
                  );
                  onScaleChange(next);
                }}
                disabled={scale >= MAX_SCALE - 0.001}
                className="w-6 h-6 flex items-center justify-center text-sm font-bold disabled:opacity-40"
              >
                +
              </button>
              {scale > 1.001 && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onScaleChange(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  className="px-1.5 h-6 flex items-center justify-center text-[10px] font-semibold bg-gray-800 hover:bg-gray-700"
                  title="원래대로"
                >
                  ⟲
                </button>
              )}
            </div>
          )}
          <div className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-gray-900/80 text-white">
            {showBus ? "셔틀 시간표" : "행로표"}
          </div>
        </div>

        {!noRoute && scale <= 1.001 && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md text-[8px] bg-gray-900/70 text-white whitespace-nowrap">
            길게 눌러 {showBus ? "행로표" : "셔틀 시간"} · 두 손가락 확대
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