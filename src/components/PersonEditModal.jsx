// src/components/PersonEditModal.jsx
//
// 로스터에서 "수정 모드"로 셀을 탭했을 때 열리는 통합 편집 모달.
// 이름과 교번(근무)을 한 번에 변경할 수 있다.
//
// 적용 범위:
//   "today"     - 오늘 하루만 (nameOverrides / dutyOverrides)
//   "permanent" - 영구 (commonMap.names 직접 수정, dutyOverride로 저장)
//
import React from "react";
import { X } from "lucide-react";

export default function PersonEditModal({
  open,
  onClose,
  oldName,
  oldCode, // 현재 교번 (표시용)
  nameList, // 소속 내 전체 이름 목록
  codeList, // 소속 내 전체 교번 목록
  onApply, // ({ newName, newCode }, scope: "today" | "permanent") => void
}) {
  const [nameQuery, setNameQuery] = React.useState("");
  const [selectedCode, setSelectedCode] = React.useState("");
  const [showNameList, setShowNameList] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setNameQuery(oldName || "");
      setSelectedCode(oldCode || "");
      setShowNameList(false);
    }
  }, [open, oldName, oldCode]);

  if (!open) return null;

  const q = nameQuery.trim();
  const lowerQ = q.toLowerCase();
  const filteredNames = q
    ? (nameList || []).filter((n) => n.toLowerCase().includes(lowerQ))
    : nameList || [];
  const isNewName = q.length > 0 && !(nameList || []).some((n) => n === q);

  const nameChanged = q && q !== oldName;
  const codeChanged = selectedCode && selectedCode !== oldCode;
  const hasChange = nameChanged || codeChanged;

  const handleApply = (scope) => {
    if (!hasChange) {
      onClose?.();
      return;
    }
    onApply?.(
      {
        newName: nameChanged ? q : null,
        newCode: codeChanged ? selectedCode : null,
      },
      scope
    );
    onClose?.();
  };

  // 교번 색상 (로스터와 동일한 규칙)
  const getDiaColor = (code) => {
    if (!code) return "text-gray-300";
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

  return (
    <div
      className="fixed inset-0 z-[99990] bg-black/60 flex items-end sm:items-center justify-center p-2"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="w-[min(520px,100vw)] rounded-2xl bg-gray-800 text-gray-100 p-4 shadow-xl"
        style={{ marginBottom: "max(72px, env(safe-area-inset-bottom))" }}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">근무자 편집</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              <span className="text-gray-200">{oldName}</span>
              <span className="mx-1.5 text-gray-600">·</span>
              <span className={getDiaColor(oldCode)}>{oldCode || "—"}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 이름 */}
        <div className="mb-3">
          <div className="text-[11px] text-gray-400 mb-1.5 flex items-center justify-between">
            <span>이름</span>
            <button
              onClick={() => setShowNameList((v) => !v)}
              className="text-[10px] text-indigo-300 hover:text-indigo-200"
            >
              {showNameList ? "목록 접기" : "목록에서 찾기"}
            </button>
          </div>
          <input
            className="w-full bg-gray-900 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="이름 입력 또는 목록에서 선택..."
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            onFocus={() => setShowNameList(true)}
          />
          {showNameList && (
            <div className="mt-1.5 max-h-[140px] overflow-y-auto bg-gray-900/60 rounded-lg border border-gray-700/50">
              {filteredNames.length === 0 && !isNewName && (
                <div className="text-[11px] text-gray-500 py-2 text-center">
                  일치하는 이름 없음
                </div>
              )}
              {filteredNames.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setNameQuery(n);
                    setShowNameList(false);
                  }}
                  className={
                    "w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 transition " +
                    (n === nameQuery ? "bg-gray-700/60 text-indigo-200" : "")
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {isNewName && (
            <div className="mt-1.5 text-[11px] text-emerald-300">
              + 새 이름 "<b>{q}</b>"
            </div>
          )}
        </div>

        {/* 교번 */}
        <div className="mb-4">
          <div className="text-[11px] text-gray-400 mb-1.5">교번</div>
          <div
            className="grid gap-1 max-h-[180px] overflow-y-auto pr-1"
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
                    "px-1.5 py-1.5 rounded-md text-[12px] font-bold transition " +
                    (isActive
                      ? "bg-indigo-600 text-white ring-1 ring-indigo-400"
                      : "bg-gray-700 hover:bg-gray-600 " + getDiaColor(code))
                  }
                >
                  {code}
                </button>
              );
            })}
          </div>
        </div>

        {/* 변경 요약 */}
        {hasChange && (
          <div className="mb-3 p-2 rounded-lg bg-gray-900/60 border border-indigo-500/30 text-[11px]">
            <div className="text-gray-400 mb-0.5">변경 사항</div>
            {nameChanged && (
              <div className="text-gray-200">
                이름: <span className="text-gray-400">{oldName}</span>
                <span className="mx-1">→</span>
                <span className="text-amber-300 font-semibold">{q}</span>
                {isNewName && (
                  <span className="ml-1 text-[10px] text-emerald-400">
                    (신규)
                  </span>
                )}
              </div>
            )}
            {codeChanged && (
              <div className="text-gray-200">
                교번:{" "}
                <span className={getDiaColor(oldCode)}>{oldCode || "—"}</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className={`${getDiaColor(selectedCode)} font-semibold`}>
                  {selectedCode}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleApply("today")}
            disabled={!hasChange}
            className="px-3 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-semibold text-white"
          >
            📅 오늘 하루만
          </button>
          <button
            onClick={() => handleApply("permanent")}
            disabled={!hasChange}
            className="px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-xs font-semibold text-white"
          >
            ♾️ 영구 변경
          </button>
        </div>
        <button
          onClick={onClose}
          className="w-full mt-2 px-3 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-xs text-gray-300"
        >
          취소
        </button>
      </div>
    </div>
  );
}
