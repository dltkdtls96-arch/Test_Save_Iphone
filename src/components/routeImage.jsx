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
//  RouteImageView — v4: 핀치줌 + pan + 돋보기
// ─────────────────────────────────────────────
//
//  제스처:
//   • 두 손가락 핀치     → 줌 (0.5 ~ 4x, 두 손가락 중점 기준)
//   • 한 손가락 드래그   → pan (scale > 1 일 때)
//   • 길게 누르기 (500ms)→ 손끝 위치에 돋보기 (누르고 있는 동안)
//   • 더블탭             → 1x ↔ 2x 토글 (탭 지점 중심)
//   • 마우스 휠          → 커서 위치 중심 확대/축소
//   • 상단 "행로표/셔틀" 버튼 → 토글 (기존 길게 누르기 토글 대체)

export function RouteImageView({
  paths, // common.paths
  common, // ← v3 신규: CommonDepotData 전체 (있으면 async 로드 가능)
  depot,
  code,
  dateStr,
  holidaySet,
  busImageSrc,
  showBusDefault = true,
  scale = 1, // 이미지 배율 (기지별 저장)
  onScaleChange, // (newScale) => void
}) {
  const [altView, setAltView] = useState(false);
  const [asyncUrl, setAsyncUrl] = useState(null);
  const [asyncLoading, setAsyncLoading] = useState(false);

  // ── 위치(pan) / 돋보기 상태
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [magnifier, setMagnifier] = useState({ active: false, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false); // 과도기 상태(애니메이션 off)

  // 컨테이너 DOM 참조 (제스처 좌표 변환용)
  const viewportRef = useRef(null);

  // 제스처 상태 (ref — 리렌더 없이 추적)
  const gestureRef = useRef({
    mode: null, // "pan" | "pinch" | null
    startX: 0,
    startY: 0,
    startPan: { x: 0, y: 0 },
    pinchStartDist: 0,
    pinchStartScale: 1,
    pinchCenter: { x: 0, y: 0 }, // 컨테이너 기준 픽셀
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    longPressTimer: null,
    longPressFired: false,
    moved: false,
  });

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 4;
  const MAGNIFIER_ZOOM = 2.5; // 돋보기 배율 (현재 scale 위에 추가로 곱해짐)
  const MAGNIFIER_SIZE = 140; // px
  const LONG_PRESS_MS = 500;
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_DIST = 30;

  // 날짜/코드 바뀌면 행로표로 복귀 + pan 초기화
  useEffect(() => {
    setAltView(false);
    setAsyncUrl(null);
    setPan({ x: 0, y: 0 });
    setMagnifier({ active: false, x: 0, y: 0 });

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

  // scale이 1로 돌아가면 pan도 리셋
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

  // ── pan 경계 제한 (이미지가 컨테이너 밖으로 너무 멀리 가지 않게)
  const clampPan = useCallback((px, py, s) => {
    const el = viewportRef.current;
    if (!el) return { x: px, y: py };
    const w = el.clientWidth;
    const h = el.clientHeight;
    // 확대 배율만큼 여유 공간 허용 (이미지는 object-contain이라 중앙 기준)
    const maxX = (w * (s - 1)) / 2 + 20;
    const maxY = (h * (s - 1)) / 2 + 20;
    return {
      x: Math.max(-maxX, Math.min(maxX, px)),
      y: Math.max(-maxY, Math.min(maxY, py)),
    };
  }, []);

  // scale 래퍼 — 커밋 시 범위 제한
  const commitScale = useCallback(
    (newScale) => {
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
      onScaleChange?.(Math.round(s * 100) / 100);
      return s;
    },
    [onScaleChange]
  );

  // ── 포인터 좌표를 컨테이너 로컬 좌표로
  const getLocalXY = useCallback((clientX, clientY) => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  // ── 두 포인터 중점/거리 계산
  const getPinchInfo = (touches) => {
    const t1 = touches[0];
    const t2 = touches[1];
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    const dist = Math.hypot(dx, dy);
    return {
      dist,
      cx: (t1.clientX + t2.clientX) / 2,
      cy: (t1.clientY + t2.clientY) / 2,
    };
  };

  // ── 커서/탭 중심 기준 확대 (transform-origin=center 기준 수식)
  //   scale * (p - pan) = 화면 위 이미지 좌표 (컨테이너 중심 기준)
  //   새 scale s2 로 바꾸되 같은 anchor 점이 화면에서 그대로 있으려면:
  //     pan' = p - (s1/s2) * (p - pan)
  const zoomAtPoint = useCallback(
    (anchorLocal, oldScale, newScale) => {
      const el = viewportRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      // anchor: 컨테이너 중심 기준 좌표
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
  // ─────────────────────────────────────────
  const onTouchStart = (e) => {
    if (noRoute) return;
    const g = gestureRef.current;
    g.moved = false;
    g.longPressFired = false;

    if (e.touches.length === 2) {
      // 핀치 시작
      clearTimeout(g.longPressTimer);
      g.mode = "pinch";
      const info = getPinchInfo(e.touches);
      g.pinchStartDist = info.dist;
      g.pinchStartScale = scale;
      g.pinchCenter = getLocalXY(info.cx, info.cy);
      setIsDragging(true);
      setMagnifier({ active: false, x: 0, y: 0 });
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      g.startX = t.clientX;
      g.startY = t.clientY;
      g.startPan = { ...pan };
      g.mode = scale > 1.001 ? "pan" : null;

      // 길게 누르기 → 돋보기
      const local = getLocalXY(t.clientX, t.clientY);
      g.longPressTimer = setTimeout(() => {
        if (g.moved) return;
        g.longPressFired = true;
        setMagnifier({ active: true, x: local.x, y: local.y });
      }, LONG_PRESS_MS);
    }
  };

  const onTouchMove = (e) => {
    if (noRoute) return;
    const g = gestureRef.current;

    if (e.touches.length === 2 && g.mode === "pinch") {
      e.preventDefault();
      const info = getPinchInfo(e.touches);
      if (g.pinchStartDist <= 0) return;
      const ratio = info.dist / g.pinchStartDist;
      const targetScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, g.pinchStartScale * ratio)
      );
      // 중점 고정 확대
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
      if (Math.hypot(dx, dy) > 6) {
        g.moved = true;
        clearTimeout(g.longPressTimer);
      }

      // 돋보기 활성화 중이면 위치만 업데이트 (pan 안 함)
      if (g.longPressFired) {
        e.preventDefault();
        const local = getLocalXY(t.clientX, t.clientY);
        setMagnifier({ active: true, x: local.x, y: local.y });
        return;
      }

      if (g.mode === "pan") {
        e.preventDefault();
        if (!isDragging) setIsDragging(true);
        const next = clampPan(g.startPan.x + dx, g.startPan.y + dy, scale);
        setPan(next);
      }
    }
  };

  const onTouchEnd = (e) => {
    const g = gestureRef.current;
    clearTimeout(g.longPressTimer);

    // 돋보기 해제
    if (g.longPressFired) {
      setMagnifier({ active: false, x: 0, y: 0 });
      g.longPressFired = false;
      g.mode = null;
      setIsDragging(false);
      return;
    }

    // 핀치 종료 — 한 손가락만 남았으면 pan 모드로 전환
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

    // 더블탭 검사 (움직임 없을 때만)
    if (g.mode !== "pan" && !g.moved && e.changedTouches?.length === 1) {
      const t = e.changedTouches[0];
      const now = Date.now();
      const dt = now - g.lastTapTime;
      const dd = Math.hypot(t.clientX - g.lastTapX, t.clientY - g.lastTapY);
      if (dt < DOUBLE_TAP_MS && dd < DOUBLE_TAP_DIST) {
        // 더블탭 → 1x ↔ 2x 토글 (탭 지점 중심)
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

  // ─────────────────────────────────────────
  //  마우스/휠 (데스크탑용)
  // ─────────────────────────────────────────
  const onWheel = (e) => {
    if (noRoute) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015); // 부드러운 연속 확대
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

  // 로딩 상태 UI
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

  // 돋보기 이미지 배율/오프셋 계산
  //   돋보기 내부에는 같은 이미지를 더 크게(current scale * MAGNIFIER_ZOOM) 그린 뒤,
  //   돋보기 원 중심이 손가락 지점과 같은 이미지 픽셀을 가리키도록 오프셋 설정.
  const magnifyScale = scale * MAGNIFIER_ZOOM;
  const el = viewportRef.current;
  const vw = el?.clientWidth || 0;
  const vh = el?.clientHeight || 0;
  // 손가락 지점에 해당하는 "원본 이미지 로컬 좌표" 기준
  // 큰 이미지의 translate 를 계산: 이미지 중심(vw/2, vh/2) 기준으로
  //   fingerLocal 가 돋보기 원 중심에 오도록
  const bigOffsetX =
    -(magnifier.x - vw / 2) * MAGNIFIER_ZOOM + pan.x * MAGNIFIER_ZOOM;
  const bigOffsetY =
    -(magnifier.y - vh / 2) * MAGNIFIER_ZOOM + pan.y * MAGNIFIER_ZOOM;

  return (
    <div
      className="mt-2 rounded-xl overflow-hidden bg-black/30"
      data-no-gesture
    >
      <div
        ref={viewportRef}
        className="relative w-full aspect-[1/1.414] overflow-hidden select-none"
        style={{
          touchAction: "none", // 모든 제스처 자체 처리
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

        {/* 돋보기 */}
        {magnifier.active && displaySrc && (
          <div
            className="absolute pointer-events-none rounded-full ring-2 ring-white/80 shadow-[0_6px_24px_rgba(0,0,0,0.5)] overflow-hidden"
            style={{
              width: MAGNIFIER_SIZE,
              height: MAGNIFIER_SIZE,
              left: magnifier.x - MAGNIFIER_SIZE / 2,
              top: magnifier.y - MAGNIFIER_SIZE / 2 - MAGNIFIER_SIZE * 0.7, // 손가락 위에 띄워 보이게
              background: "#000",
            }}
          >
            <img
              src={displaySrc}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: vw,
                height: vh,
                objectFit: "contain",
                transform: `translate(-50%, -50%) translate(${bigOffsetX}px, ${bigOffsetY}px) scale(${
                  MAGNIFIER_ZOOM * scale
                })`,
                transformOrigin: "center center",
                pointerEvents: "none",
              }}
            />
            {/* 돋보기 중심 조준선 */}
            <div
              className="absolute left-1/2 top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70"
              style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.4)" }}
            />
          </div>
        )}

        {/* 상단 우측 컨트롤 */}
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
          {/* 행로표↔셔틀 토글 (기존 길게 누르기 토글 대체) */}
          {hasRoute && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setAltView((v) => !v);
              }}
              className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-gray-900/80 hover:bg-gray-800 text-white"
            >
              {showBus ? "셔틀 시간표" : "행로표"}
            </button>
          )}
          {!hasRoute && (
            <div className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-gray-900/80 text-white">
              셔틀 시간표
            </div>
          )}
        </div>

        {!noRoute && scale <= 1.001 && !magnifier.active && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md text-[8px] bg-gray-900/70 text-white whitespace-nowrap">
            길게 눌러 돋보기 · 두 손가락/더블탭 확대
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
