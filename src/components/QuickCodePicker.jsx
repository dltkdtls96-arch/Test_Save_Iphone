/**
 * QuickCodePicker.jsx
 *
 * 전체탭에서 셀을 탭하면 올라오는 교번 즉시 변경 바텀시트
 *
 * Props:
 *   open          boolean
 *   onClose       () => void
 *   name          string          대상 이름
 *   depot         string          소속
 *   currentCode   string          현재 교번코드
 *   gyobunList    string[]        전체 교번 목록 (gyobun.txt 순서)
 *   date          string          "YYYY-MM-DD"
 *   onSelect      (code) => void  교번 선택 확정 콜백
 *   onReset       () => void      변경 해제 콜백
 *   isOverridden  boolean         현재 강제변경 중인지
 */

import React, { useState, useEffect, useRef } from "react";
import {
  displayCode,
  isNightCode,
  isOffCode,
  normalizeCode,
} from "../dataEngine";

// 교번 코드 색상
function codeColor(depot, code) {
  const s = normalizeCode(code);
  if (!s || s === "----" || s.startsWith("휴")) return "#9ca3af"; // gray
  if (s.includes("~")) return "#9ca3af"; // gray (비번)
  if (isNightCode(depot, code)) return "#7dd3fc"; // sky
  return "#fde047"; // yellow
}

// 교번 코드 그룹 분류
function groupCode(code) {
  const s = normalizeCode(code);
  if (s.startsWith("휴")) return "휴무";
  if (s.includes("~")) return "비번";
  if (/^대/.test(s)) return "대근";
  if (isOffCode(code)) return "기타";
  return "근무";
}

export default function QuickCodePicker({
  open,
  onClose,
  name,
  depot,
  currentCode,
  gyobunList = [],
  date,
  onSelect,
  onReset,
  isOverridden = false,
}) {
  const [selected, setSelected] = useState(currentCode || "");
  const [confirmed, setConfirmed] = useState(false);
  const sheetRef = useRef(null);

  // 열릴 때마다 현재 교번으로 초기화
  useEffect(() => {
    if (open) {
      setSelected(currentCode || "");
      setConfirmed(false);
    }
  }, [open, currentCode]);

  // 바텀시트 외부 탭 → 닫기
  function handleBackdropClick(e) {
    if (sheetRef.current && !sheetRef.current.contains(e.target)) {
      onClose();
    }
  }

  // 1차 탭: 선택만
  // 2차 탭: 확정
  function handleCodeTap(code) {
    if (selected === code) {
      // 이미 선택된 것 한 번 더 탭 → 확정
      onSelect(code);
      setConfirmed(true);
      setTimeout(onClose, 180);
    } else {
      setSelected(code);
    }
  }

  if (!open) return null;

  // 그룹별 분리
  const groups = { 근무: [], 비번: [], 대근: [], 휴무: [], 기타: [] };
  gyobunList.forEach((code) => {
    const g = groupCode(code);
    groups[g].push(code);
  });
  // 중복 제거 (근무만 — 숫자d 기준)
  const seen = new Set();
  groups["근무"] = groups["근무"].filter((code) => {
    const k = normalizeCode(code).replace(/d$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const groupOrder = ["근무", "비번", "대근", "휴무"];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onPointerDown={handleBackdropClick}
    >
      <div
        ref={sheetRef}
        className="w-full max-w-lg bg-gray-800 rounded-t-2xl shadow-2xl pb-safe"
        style={{
          paddingBottom: "max(20px, env(safe-area-inset-bottom))",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 핸들 */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-2">
          <div>
            <div className="font-semibold text-sm">{name}</div>
            <div className="text-xs text-gray-400">
              {depot} · {date}
              {isOverridden && (
                <span className="ml-2 text-yellow-400 font-medium">
                  * 변경됨
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOverridden && (
              <button
                className="px-3 py-1.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-xs text-red-400"
                onClick={() => {
                  onReset();
                  onClose();
                }}
              >
                변경 해제
              </button>
            )}
            <button
              className="px-3 py-1.5 rounded-xl bg-gray-700 text-xs text-gray-300"
              onClick={onClose}
            >
              닫기
            </button>
          </div>
        </div>

        {/* 현재 교번 표시 */}
        <div className="mx-4 mb-3 px-3 py-2 rounded-xl bg-gray-900/60 flex items-center gap-3">
          <span className="text-xs text-gray-400">현재</span>
          <span
            className="font-bold text-base"
            style={{ color: codeColor(depot, currentCode) }}
          >
            {displayCode(currentCode) || "-"}
          </span>
          {selected !== currentCode && (
            <>
              <span className="text-gray-600">→</span>
              <span
                className="font-bold text-base"
                style={{ color: codeColor(depot, selected) }}
              >
                {displayCode(selected)}
              </span>
              <span className="text-xs text-indigo-400 ml-auto">
                한 번 더 탭하면 적용
              </span>
            </>
          )}
        </div>

        {/* 교번 그리드 (그룹별) */}
        <div className="px-4 space-y-3 pb-4">
          {groupOrder.map((groupName) => {
            const codes = groups[groupName];
            if (!codes?.length) return null;
            return (
              <div key={groupName}>
                <div className="text-[11px] text-gray-500 mb-1.5 font-medium">
                  {groupName}
                </div>
                <div
                  className="grid gap-1.5"
                  style={{
                    gridTemplateColumns:
                      groupName === "근무"
                        ? "repeat(auto-fill, minmax(48px, 1fr))"
                        : "repeat(auto-fill, minmax(60px, 1fr))",
                  }}
                >
                  {codes.map((code, idx) => {
                    const isSelected = selected === code;
                    const isCurrent = currentCode === code;
                    return (
                      <button
                        key={`${code}-${idx}`}
                        onClick={() => handleCodeTap(code)}
                        className={[
                          "py-2 px-1 rounded-lg text-xs font-bold text-center transition-all",
                          isSelected
                            ? "ring-2 ring-white scale-105 bg-gray-600"
                            : isCurrent
                            ? "ring-1 ring-indigo-400 bg-gray-700"
                            : "bg-gray-700/80 hover:bg-gray-600",
                        ].join(" ")}
                        style={{ color: codeColor(depot, code) }}
                      >
                        {displayCode(code)}
                        {isCurrent && !isSelected && (
                          <div className="text-[8px] text-indigo-400 mt-0.5">
                            현재
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* 하단 확정 버튼 */}
        {selected && selected !== currentCode && (
          <div className="sticky bottom-0 px-4 pb-3 pt-2 bg-gray-800 border-t border-gray-700">
            <button
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm transition"
              onClick={() => {
                onSelect(selected);
                setConfirmed(true);
                setTimeout(onClose, 180);
              }}
            >
              {displayCode(selected)} 로 변경
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
