/**
 * routeImage.js + RouteImageView.jsx
 *
 * 행로표 이미지 조회 로직 + 표시 컴포넌트
 *
 * ── 폴더 분기 규칙 ──────────────────────────────────────────────
 *
 * 주간 코드 (숫자 < nightStart, 대근, ~없음):
 *   오늘 요일타입 그대로 → "nor" | "sat" | "hol"
 *
 * 야간 코드 (숫자 >= nightStart):
 *   출근일(오늘) 타입 + 퇴근일(내일) 타입 조합
 *   nor→nor = "nor"  (평일 출근, 평일 퇴근)
 *   nor→sat = "nor_sat"
 *   nor→hol = "nor_hol"
 *   sat→hol = "sat_hol"
 *   sat→sat = "sat"  (드묾)
 *   hol→nor = "hol_nor"
 *   hol→sat = "hol_sat"
 *   hol→hol = "hol"  (드묾)
 *
 * ~ 코드 (비번 — 야간 다음날):
 *   전날 코드의 폴더를 그대로 사용
 *   (전날 25d 의 폴더가 nor_sat 이었으면 25~ 도 nor_sat)
 *
 * ── as 소속 특이사항 ────────────────────────────────────────────
 *   "hor_sat" 폴더 존재 (오타: hol_nor 의 일부 역할)
 *   조회 시 "hol_nor" 없으면 "hor_sat" 폴백
 *
 * ── 파일명 규칙 ─────────────────────────────────────────────────
 *   "25d" → "25",  "25~" → "25",  "대3" → 이미지 없음(대근은 별도 시간표)
 *
 */

// ─────────────────────────────────────────────
//  폴더 계산 (dataEngine._getDayType 와 연동)
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

/**
 * 교번코드 + 날짜 → path 폴더명 결정
 *
 * @param {string} depot      "안심" | "월배" | ...
 * @param {string} code       "25d" | "25~" | "휴1" | "대3"
 * @param {string} dateStr    "YYYY-MM-DD"
 * @param {Set}    holidaySet
 * @returns {string}  폴더명
 */
export function getPathFolder(depot, code, dateStr, holidaySet = new Set()) {
  const s = (code || "").trim().toLowerCase().replace(/\s/g, "");

  // 대근/휴무/비번 계열 → 이미지 없음 (null 처리는 getPathImage 에서)
  if (!s || s.startsWith("휴") || s.startsWith("대") || s === "----") {
    return null;
  }

  const isTilde = s.includes("~");

  // ~ 코드: 전날 기준으로 계산
  const baseDate = isTilde ? subOneDay(dateStr) : dateStr;
  const todayType = getDayType(baseDate, holidaySet);

  // 숫자 추출
  const num = parseInt(s.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(num)) return todayType;

  const nightStart = NIGHT_START[depot] ?? 25;
  const isNight = num >= nightStart;

  if (!isNight) {
    // 주간: 오늘 타입 그대로
    return todayType;
  }

  // 야간: 다음날 타입과 조합
  const nextType = getDayType(addOneDay(baseDate), holidaySet);

  if (todayType === nextType) return todayType;
  return `${todayType}_${nextType}`;
}

/**
 * CommonDepotData 의 paths 에서 이미지 dataURL 조회
 *
 * @param {Object} paths    common.paths  { nor: {25: dataURL}, ... }
 * @param {string} depot
 * @param {string} code
 * @param {string} dateStr
 * @param {Set}    holidaySet
 * @returns {string|null}  dataURL 또는 null
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

  // 대근/휴무 → 없음
  if (!s || s.startsWith("휴") || s.startsWith("대") || s === "----")
    return null;

  const folder = getPathFolder(depot, code, dateStr, holidaySet);
  if (!folder) return null;

  // 파일명: 숫자만
  const num = String(parseInt(s.replace(/[^0-9]/g, ""), 10));
  if (!num || num === "NaN") return null;

  // 1차: 정확한 폴더
  const hit = paths[folder]?.[num];
  if (hit) return hit;

  // 2차 폴백: as 전용 hor_sat(오타폴더) ↔ hol_nor 상호 폴백
  if (folder === "hol_nor" && paths["hor_sat"]?.[num]) {
    return paths["hor_sat"][num];
  }
  if (folder === "hor_sat" && paths["hol_nor"]?.[num]) {
    return paths["hol_nor"][num];
  }

  // 3차 폴백: 야간 조합폴더 없으면 단순 타입으로
  const simpleType = folder.split("_")[0]; // "nor_sat" → "nor"
  if (simpleType !== folder && paths[simpleType]?.[num]) {
    return paths[simpleType][num];
  }

  return null;
}

// ─────────────────────────────────────────────
//  React 컴포넌트
// ─────────────────────────────────────────────

import React, { useState, useRef, useCallback } from "react";
import { displayCode, normalizeCode } from "../dataEngine";

/**
 * RouteImageView
 *
 * 행로표 이미지 + 버스시간표 전환 표시 컴포넌트
 * (기존 행로탭 panel0 이미지 영역 대체)
 *
 * Props:
 *   paths        CommonDepotData.paths
 *   depot        string
 *   code         string   교번코드
 *   dateStr      string   "YYYY-MM-DD"
 *   holidaySet   Set
 *   busImageSrc  string   버스 시간표 기본 이미지 (소속별 /bus/xxx.png)
 *   showBusDefault  boolean  행로표 없을 때 버스 시간표 기본 표시 여부
 */
export function RouteImageView({
  paths,
  depot,
  code,
  dateStr,
  holidaySet,
  busImageSrc,
  showBusDefault = true,
}) {
  const [altView, setAltView] = useState(false); // false=행로표, true=버스시간표
  const longPressTimer = useRef(null);
  const longPressActive = useRef(false);

  // 날짜/코드 바뀌면 행로표로 복귀
  React.useEffect(() => {
    setAltView(false);
  }, [dateStr, code]);

  const routeImgSrc = getPathImage(paths, depot, code, dateStr, holidaySet);

  const noRoute = !routeImgSrc;
  const showBus = altView || noRoute;
  const displaySrc = showBus ? busImageSrc : routeImgSrc;

  // 폴더 정보 (디버그/라벨용)
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
          className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none transition-opacity duration-300"
        />

        {/* 라벨 */}
        <div className="absolute top-2 right-2 px-2 py-1 rounded-lg text-[10px] font-semibold bg-gray-900/80 text-white">
          {showBus ? "셔틀 시간표" : "행로표"}
        </div>

        {/* 전환 힌트 */}
        {!noRoute && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md text-[8px] bg-gray-900/70 text-white whitespace-nowrap">
            길게 눌러 {showBus ? "행로표" : "셔틀 시간"} 보기
          </div>
        )}
      </div>

      {/* 매칭 정보 */}
      <div className="text-xs text-gray-500 mt-1 px-1">{matchLabel}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  App.jsx 교체 가이드 (주석)
// ─────────────────────────────────────────────

/**
 * 기존 App.jsx 에서 교체할 부분:
 *
 * [1] routeKey(), getRouteImageSrc() 제거
 *     → getPathImage(), getPathFolder() 로 대체 (이 파일에서 import)
 *
 * [2] routeImageMap state 제거
 *     → paths 는 commonMap[depotKey].paths 에 항상 있음
 *       (ZIP 로드 시 IndexedDB 에 저장, 앱 시작 시 복원)
 *
 * [3] 행로탭 panel0 이미지 영역 교체:
 *     기존:
 *       <img src={routeShowSrc} ... />
 *     변경:
 *       <RouteImageView
 *         paths={commonMap[depotKey]?.paths}
 *         depot={selectedDepot}
 *         code={routeDiaLabel}   // "25d" 형태
 *         dateStr={fmt(selectedDate)}
 *         holidaySet={holidaySet}
 *         busImageSrc={defaultBusMap[selectedDepot]}
 *       />
 *
 * [4] TSV 모드에서도 동일하게 동작
 *     (loadPathsIntoCommon() 으로 paths 주입했으면 그냥 씀)
 *
 * [5] 교번코드 포맷 통일:
 *     기존 TSV dia 값이 숫자(27)면 → "27d" 로 변환해서 넘길 것
 *     tsvDiaToRouteCode(dia) 헬퍼:
 *
 *     export function tsvDiaToRouteCode(dia) {
 *       if (typeof dia === "number") return `${dia}d`;
 *       return String(dia || "").trim();
 *     }
 */

/**
 * tsvDiaToRouteCode 헬퍼 (App.jsx 에서 바로 쓸 수 있게 export)
 */
export function tsvDiaToRouteCode(dia) {
  if (typeof dia === "number") return `${dia}d`;
  return String(dia || "").trim();
}
