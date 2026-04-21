// src/components/PersonEditModal.jsx
//
// 로스터 "수정 모드"로 셀을 탭했을 때 열리는 편집 모달.
// 한 번에 한 가지(이름 or 교번)만 변경한다.
//
// 적용 범위:
//   "today"     → 이 날짜만  (nameOverrides / overridesByDepot)
//   "permanent" → 이 사람 계속 (commonMap 직접 수정)
//
// "이 사람 계속" 동작:
//   - 이름: 신규 이름이면 단순 개명, 기존 인물이면 두 사람 자리 교환(swap)
//   - 교번: 해당 교번 자리의 사람과 swap
//
import React from "react";
import { X, RotateCcw } from "lucide-react";

export default function PersonEditModal({
  open,
  onClose,
  oldName,
  oldCode,
  baseName = "",
  baseCode = "",
  hasTodayName = false,
  hasTodayCode = false,
  nameList,
  codeList,
  codeOwnerMap,
  onApply,
  onResetToday,
}) {
  const [mode, setMode] = React.useState("name");
  const [nameQuery, setNameQuery] = React.useState("");
  const [selectedCode, setSelectedCode] = React.useState("");
  const [showNameList, setShowNameList] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMode(hasTodayCode && !hasTodayName ? "code" : "name");
      setNameQuery(oldName || "");
      setSelectedCode(oldCode || "");
      setShowNameList(false);
    }
  }, [open, oldName, oldCode, hasTodayCode, hasTodayName]);

  // 입력 정규화: 앞뒤 공백 제거 + 중간 다중 공백 축약
  const q = nameQuery.replace(/\s+/g, " ").trim();
  const lowerQ = q.toLowerCase();
  // 비교용 정규화 (공백 전부 제거)
  const normalize = (s) =>
    String(s || "")
      .replace(/\s+/g, "")
      .toLowerCase();
  const qKey = normalize(q);
  const oldKey = normalize(oldName);

  // 동명이인 카운트 맵 (정규화 기준)
  const nameCountMap = React.useMemo(() => {
    const m = new Map();
    (nameList || []).forEach((n) => {
      const k = normalize(n);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }, [nameList]);

  // 드롭다운용: 정규화 기준으로 중복 제거 (첫 등장만 유지)
  const uniqueFilteredNames = React.useMemo(() => {
    const source = q
      ? (nameList || []).filter((n) => n.toLowerCase().includes(lowerQ))
      : nameList || [];
    const seen = new Set();
    const result = [];
    for (const n of source) {
      const k = normalize(n);
      if (!seen.has(k)) {
        seen.add(k);
        result.push(n);
      }
    }
    return result;
  }, [nameList, q, lowerQ]);

  // 전체 리스트에서 정규화 기준으로 몇 명이 매칭되는지 체크
  const matchCountForQ = nameCountMap.get(qKey) || 0;
  const isNewName = q.length > 0 && matchCountForQ === 0;

  // 본인 제외 매칭 수 — swap 가능 여부 판단
  const othersMatchCount =
    matchCountForQ - (matchCountForQ > 0 && qKey === oldKey ? 1 : 0);
  // 본인 외에 정확히 1명 매칭되면 swap 가능
  const isExistingOther = qKey !== oldKey && othersMatchCount >= 1;
  const hasAmbiguousMatch = othersMatchCount > 1;

  // 실제 swap 대상 (nameList에서 첫 번째 매칭 — 본인 제외)
  const swapTargetName = React.useMemo(() => {
    if (!isExistingOther || hasAmbiguousMatch) return "";
    return (
      (nameList || []).find(
        (n) => normalize(n) === qKey && normalize(n) !== oldKey
      ) || ""
    );
  }, [isExistingOther, hasAmbiguousMatch, nameList, qKey, oldKey]);

  // ⚠️ early return 은 반드시 모든 hook 호출 이후에!
  if (!open) return null;

  // 입력값이 본인 이름과 "실질적으로 동일" 하면 변경 아님
  const nameChanged = q.length > 0 && qKey !== oldKey;
  const codeChanged = selectedCode && selectedCode !== oldCode;

  const currentChanged = mode === "name" ? nameChanged : codeChanged;

  const codeOwner =
    codeChanged && codeOwnerMap ? codeOwnerMap[selectedCode] || "" : "";
  const willCodeSwapWith = codeOwner && codeOwner !== oldName ? codeOwner : "";

  const handleApply = (scope) => {
    if (!currentChanged) return;
    if (mode === "name") {
      // 동명이인 매칭 → 불가
      if (hasAmbiguousMatch) {
        alert(
          `"${q}" 이름을 가진 사람이 여러 명 있어 자리 교환 대상을 특정할 수 없습니다.`
        );
        return;
      }
      // 기존 인물 이름 + "이 사람 계속" 이면 swap 확인
      if (scope === "permanent" && isExistingOther) {
        const ok = window.confirm(
          `"${oldName}" 과(와) "${swapTargetName}" 의 자리를 서로 바꾸시겠습니까?\n\n` +
            `두 사람이 자리를 교환합니다. 교번도 자동으로 바뀝니다.`
        );
        if (!ok) return;
        // 실제 저장된 이름 그대로 전달 (공백/대소문자 일치)
        onApply?.({ newName: swapTargetName, newCode: null }, scope);
        onClose?.();
        return;
      }
      onApply?.({ newName: q, newCode: null }, scope);
    } else {
      onApply?.({ newName: null, newCode: selectedCode }, scope);
    }
    onClose?.();
  };

  const getDiaColor = (code) => {
    if (!code) return "text-gray-400";
    const s = String(code).replace(/\s/g, "");
    if (/^\d+$/.test(s) || /^\d+d$/i.test(s)) {
      const n = Number(s.replace(/d$/i, ""));
      return n >= 25 ? "text-sky-300" : "text-yellow-300";
    }
    if (s.startsWith("휴") || s === "비" || s.includes("비번"))
      return "text-gray-400";
    if (s.startsWith("대")) return "text-purple-300";
    if (s === "주") return "text-yellow-300";
    if (s === "야") return "text-sky-300";
    return "text-gray-300";
  };

  const currentHasOverride = mode === "name" ? hasTodayName : hasTodayCode;
  const currentBaseValue = mode === "name" ? baseName : baseCode;

  // "이 사람 계속" 버튼 부제
  const permSubtitle =
    mode === "name"
      ? hasAmbiguousMatch
        ? "동명이인 불가"
        : isExistingOther
        ? "자리 교환"
        : "데이터 자체 변경"
      : willCodeSwapWith
      ? "자리 교환"
      : "데이터 자체 변경";

  return (
    <div
      className="fixed inset-0 z-[99990] bg-black/70 flex items-end sm:items-center justify-center p-2"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="w-[min(480px,100vw)] rounded-2xl bg-gray-900 text-gray-100 p-4 shadow-2xl max-h-[88vh] overflow-y-auto border border-gray-700"
        style={{ marginBottom: "max(72px, env(safe-area-inset-bottom))" }}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[15px] font-semibold">근무자 편집</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              <span className="text-gray-200">{oldName}</span>
              <span className="mx-1.5 text-gray-600">·</span>
              <span className={getDiaColor(oldCode)}>{oldCode || "—"}</span>
              {(hasTodayName || hasTodayCode) && (
                <span className="ml-2 text-[10px] text-amber-300">
                  ★ 오늘 변경됨
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-800 text-gray-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 모드 토글 */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-800 mb-4">
          <button
            onClick={() => setMode("name")}
            className={
              "py-2 rounded-lg text-[13px] font-semibold transition flex items-center justify-center gap-1 " +
              (mode === "name"
                ? "bg-gray-700 text-white shadow"
                : "text-gray-400 hover:text-gray-200")
            }
          >
            이름
            {hasTodayName && (
              <span className="text-[9px] text-amber-300">★</span>
            )}
          </button>
          <button
            onClick={() => setMode("code")}
            className={
              "py-2 rounded-lg text-[13px] font-semibold transition flex items-center justify-center gap-1 " +
              (mode === "code"
                ? "bg-gray-700 text-white shadow"
                : "text-gray-400 hover:text-gray-200")
            }
          >
            교번
            {hasTodayCode && (
              <span className="text-[9px] text-amber-300">★</span>
            )}
          </button>
        </div>

        {/* 오늘 override 안내 + 되돌리기 */}
        {currentHasOverride && (
          <div className="mb-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-700/40 flex items-center justify-between gap-2">
            <div className="text-[11px] text-amber-200 leading-snug">
              오늘만 변경된 상태
              <span className="text-amber-400/80 ml-1">
                (원래:{" "}
                <span
                  className={
                    mode === "code" ? getDiaColor(currentBaseValue) : ""
                  }
                >
                  {currentBaseValue || "—"}
                </span>
                )
              </span>
            </div>
            <button
              onClick={() => onResetToday?.(mode)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600/80 hover:bg-amber-500 text-white text-[11px] font-semibold whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              되돌리기
            </button>
          </div>
        )}

        {/* 이름 모드 */}
        {mode === "name" && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-gray-400">새 이름</span>
              <button
                onClick={() => setShowNameList((v) => !v)}
                className="text-[11px] text-gray-400 hover:text-gray-200"
              >
                {showNameList ? "접기" : "목록 보기"}
              </button>
            </div>
            <input
              className="w-full bg-gray-800 rounded-lg px-3 py-2.5 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-gray-500 border border-gray-700"
              placeholder="이름 입력..."
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              onFocus={() => setShowNameList(true)}
            />
            {showNameList && (
              <div className="mt-1.5 max-h-[140px] overflow-y-auto bg-gray-800/60 rounded-lg border border-gray-700/60">
                {uniqueFilteredNames.length === 0 && !isNewName && (
                  <div className="text-[11px] text-gray-500 py-2 text-center">
                    일치하는 이름 없음
                  </div>
                )}
                {uniqueFilteredNames.map((n) => {
                  const dupCount = nameCountMap.get(normalize(n)) || 1;
                  return (
                    <button
                      key={normalize(n)}
                      onClick={() => {
                        setNameQuery(n);
                        setShowNameList(false);
                      }}
                      className={
                        "w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 transition flex items-center justify-between " +
                        (n === nameQuery ? "bg-gray-700/60 text-gray-100" : "")
                      }
                    >
                      <span>{n}</span>
                      {dupCount > 1 && (
                        <span className="text-[9px] text-rose-400 ml-2">
                          동명이인 {dupCount}명
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {isNewName && (
              <div className="mt-2 text-[11px] text-gray-400">
                새 이름 <span className="text-gray-200">"{q}"</span>
              </div>
            )}
            {nameChanged && (
              <div className="mt-2 text-[12px] text-gray-300">
                <span className="text-gray-500">{oldName}</span>
                <span className="mx-2 text-gray-600">→</span>
                <span className="font-semibold text-gray-100">{q}</span>
              </div>
            )}
            {hasAmbiguousMatch && (
              <div className="mt-2 text-[11px] text-rose-400">
                ⚠️ 동명이인 {othersMatchCount}명 — 자리 교환 불가
              </div>
            )}
            {isExistingOther && !hasAmbiguousMatch && (
              <div className="mt-2 p-2 rounded-lg bg-gray-800/70 border border-gray-700 text-[11px] text-gray-300 leading-relaxed">
                <div className="text-gray-500 mb-0.5">
                  "이 사람 계속" 선택 시
                </div>
                <div>
                  <span className="text-gray-100">{oldName}</span>
                  <span className="mx-1 text-gray-500">↔</span>
                  <span className="text-gray-100">{swapTargetName}</span>
                  <span className="text-gray-500"> 자리 교환</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 교번 모드 */}
        {mode === "code" && (
          <div className="mb-4">
            <div className="text-[11px] text-gray-400 mb-2">새 교번</div>
            <div
              className="grid gap-1 max-h-[220px] overflow-y-auto pr-1"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(54px, 1fr))",
              }}
            >
              {(codeList || []).map((code) => {
                const isActive = selectedCode === code;
                return (
                  <button
                    key={code}
                    onClick={() => setSelectedCode(code)}
                    className={
                      "px-1.5 py-2 rounded-md text-[12px] font-bold transition border " +
                      (isActive
                        ? "bg-gray-700 text-white border-gray-500"
                        : "bg-gray-800 hover:bg-gray-700 border-transparent " +
                          getDiaColor(code))
                    }
                  >
                    {code}
                  </button>
                );
              })}
            </div>
            {codeChanged && (
              <div className="mt-3 text-[12px]">
                <span className={getDiaColor(oldCode)}>{oldCode || "—"}</span>
                <span className="mx-2 text-gray-600">→</span>
                <span className={`${getDiaColor(selectedCode)} font-semibold`}>
                  {selectedCode}
                </span>
              </div>
            )}
            {codeChanged && willCodeSwapWith && (
              <div className="mt-2 p-2 rounded-lg bg-gray-800/70 border border-gray-700 text-[11px] text-gray-300 leading-relaxed">
                <div className="text-gray-500 mb-0.5">
                  "이 사람 계속" 선택 시
                </div>
                <div>
                  <span className="text-gray-100">{oldName}</span>
                  <span className="mx-1 text-gray-500">↔</span>
                  <span className="text-gray-100">{willCodeSwapWith}</span>
                  <span className="text-gray-500"> 자리 교환</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 적용 버튼 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleApply("today")}
            disabled={!currentChanged}
            className="py-3 rounded-xl bg-gray-800 hover:bg-gray-700 disabled:bg-gray-800/40 disabled:text-gray-600 text-gray-100 border border-gray-700 flex flex-col items-center gap-0.5"
          >
            <span className="text-[13px] font-semibold">이 날짜만</span>
            <span className="text-[10px] text-gray-500">오늘만 변경</span>
          </button>
          <button
            onClick={() => handleApply("permanent")}
            disabled={!currentChanged}
            className="py-3 rounded-xl bg-gray-100 hover:bg-white disabled:bg-gray-800/40 disabled:text-gray-600 text-gray-900 flex flex-col items-center gap-0.5"
          >
            <span className="text-[13px] font-semibold">이 사람 계속</span>
            <span className="text-[10px] opacity-70">{permSubtitle}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
