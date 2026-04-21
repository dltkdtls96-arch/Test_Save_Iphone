/**
 * useDayOverrides.js
 *
 * 날짜별 교번 강제변경(override) 관리 훅
 *
 * 기존 App.jsx 의 overridesByDepot 과 별개로,
 * dataEngine 기반의 새 override 포맷으로 동작한다.
 *
 * override key : "{depot}::{name}::{YYYY-MM-DD}"
 * override value: 교번코드 string | null (null = 해제)
 *
 * 저장소: localStorage  "dayOverrides_v1"
 */

import { useState, useCallback } from "react";

const LS_KEY = "dayOverrides_v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (_) {}
}

function makeKey(depot, name, dateStr) {
  return `${depot}::${name}::${dateStr}`;
}

export function useDayOverrides() {
  const [overrides, setOverrides] = useState(() => load());

  // 교번 변경
  const setOverride = useCallback((depot, name, dateStr, code) => {
    setOverrides((prev) => {
      const key = makeKey(depot, name, dateStr);
      const next = { ...prev };
      if (!code) {
        delete next[key];
      } else {
        next[key] = code;
      }
      save(next);
      return next;
    });
  }, []);

  // 해제
  const resetOverride = useCallback(
    (depot, name, dateStr) => {
      setOverride(depot, name, dateStr, null);
    },
    [setOverride]
  );

  // 조회
  const getOverride = useCallback(
    (depot, name, dateStr) => {
      return overrides[makeKey(depot, name, dateStr)] || null;
    },
    [overrides]
  );

  // 변경 여부
  const hasOverride = useCallback(
    (depot, name, dateStr) => {
      return !!overrides[makeKey(depot, name, dateStr)];
    },
    [overrides]
  );

  // 전체 초기화
  const clearAll = useCallback(() => {
    setOverrides({});
    localStorage.removeItem(LS_KEY);
  }, []);

  return {
    overrides,
    setOverride,
    resetOverride,
    getOverride,
    hasOverride,
    clearAll,
  };
}

/**
 * ─────────────────────────────────────────────────────────
 * App.jsx 에서 사용하는 방법 (주석으로 설명)
 * ─────────────────────────────────────────────────────────
 *
 * 1) import
 *    import QuickCodePicker from "./components/QuickCodePicker";
 *    import { useDayOverrides } from "./hooks/useDayOverrides";
 *
 * 2) App() 안에서
 *    const { setOverride, resetOverride, getOverride, hasOverride } = useDayOverrides();
 *    const [pickerState, setPickerState] = useState({ open: false, name: "", code: "", depot: "" });
 *
 * 3) RosterGrid 의 onPick 대신 onCodeTap 추가
 *    <RosterGrid
 *      ...
 *      onCodeTap={(name, currentCode, depot) => {
 *        setPickerState({ open: true, name, currentCode, depot });
 *      }}
 *    />
 *
 * 4) RosterGrid 내 버튼 onClick 수정
 *    기존: onClick={() => { setRouteTargetName(name); triggerRouteTransition(); }}
 *    변경: onClick={() => onCodeTap?.(name, row?.dia, selectedDepot)}
 *
 *    ※ 홈탭 캘린더 꾸욱 누르기(롱프레스)는 기존 DutyModal 그대로 유지
 *
 * 5) QuickCodePicker 마운트
 *    <QuickCodePicker
 *      open={pickerState.open}
 *      onClose={() => setPickerState(p => ({ ...p, open: false }))}
 *      name={pickerState.name}
 *      depot={pickerState.depot || selectedDepot}
 *      currentCode={pickerState.currentCode}
 *      gyobunList={currentCommonData?.gyobun || DUTY_OPTIONS}
 *      date={fmt(selectedDate)}
 *      isOverridden={hasOverride(pickerState.depot, pickerState.name, fmt(selectedDate))}
 *      onSelect={(code) => {
 *        setOverride(pickerState.depot, pickerState.name, fmt(selectedDate), code);
 *        setPickerState(p => ({ ...p, open: false }));
 *      }}
 *      onReset={() => {
 *        resetOverride(pickerState.depot, pickerState.name, fmt(selectedDate));
 *      }}
 *    />
 *
 * 6) RosterGrid 에서 override 반영
 *    rows 를 넘길 때 getOverride 로 dia 교체:
 *
 *    const rows = rosterAt(selectedDate).map(({ name, row }) => {
 *      const ov = getOverride(selectedDepot, name, fmt(selectedDate));
 *      return ov ? { name, row: { ...row, dia: ov } } : { name, row };
 *    });
 *
 * ─────────────────────────────────────────────────────────
 * 기존 DutyModal (홈탭 꾸욱 누르기) 은 그대로 유지
 * QuickCodePicker 는 전체탭/행로탭의 RosterGrid 에서만 사용
 * ─────────────────────────────────────────────────────────
 */
