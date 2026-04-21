// src/components/PersonEditModal.jsx
//
// 로스터 "수정 모드"로 셀을 탭했을 때 열리는 편집 모달.
// 한 번에 한 가지(이름 or 교번)만 변경한다.
//
// 적용 범위:
//   "today"     → 이 날짜만  (nameOverrides / overridesByDepot)
//   "permanent" → 이 사람 계속 (commonMap 직접 수정)
//
// 교번 "이 사람 계속" 은 App.jsx 에서 names 배열 swap 으로 처리됨
// (확인 다이얼로그는 App.jsx 쪽에서 띄움).
//
// codeOwnerMap: { [code]: name }  — 교번별 현재 소유자 (미리보기용, 선택)
//
import React from "react";
import { X } from "lucide-react";

export default function PersonEditModal({
  open,
  onClose,
  oldName,
  oldCode,
  nameList,
  codeList,
  codeOwnerMap, // 선택: 각 교번을 현재 가진 사람 이름
  onApply,
}) {
  const [mode, setMode] = React.useState("name");
  const [nameQuery, setNameQuery] = React.useState("");
  const [selectedCode, setSelectedCode] = React.useState("");
  const [showNameList, setShowNameList] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMode("name");
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
  const isDuplicateOfOther =
    q.length > 0 && q !== oldName && (nameList || []).some((n) => n === q);

  const nameChanged = q && q !== oldName;
  const codeChanged = selectedCode && selectedCode !== oldCode;

  const currentChanged = mode === "name" ? nameChanged : codeChanged;
  const disablePermanent = mode === "name" && isDuplicateOfOther;

  // 교번 변경 시 그 자리에 현재 있는 사람 (swap 대상)
  const codeOwner =
    codeChanged && codeOwnerMap ? codeOwnerMap[selectedCode] || "" : "";
  const willSwapWith = codeOwner && codeOwner !== oldName ? codeOwner : "";

  const handleApply = (scope) => {
    if (!currentChanged) return;
    if (mode === "name") {
      if (scope === "permanent" && isDuplicateOfOther) {
        alert(
          `"${q}" 은(는) 이미 같은 소속에 있는 이름입니다.\n이름 중복 시 데이터가 꼬일 수 있어요.`
        );
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
              "py-2 rounded-lg text-[13px] font-semibold transition " +
              (mode === "name"
                ? "bg-gray-700 text-white shadow"
                : "text-gray-400 hover:text-gray-200")
            }
          >
            이름
          </button>
          <button
            onClick={() => setMode("code")}
            className={
              "py-2 rounded-lg text-[13px] font-semibold transition " +
              (mode === "code"
                ? "bg-gray-700 text-white shadow"
                : "text-gray-400 hover:text-gray-200")
            }
          >
            교번
          </button>
        </div>

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
                      (n === nameQuery ? "bg-gray-700/60 text-gray-100" : "")
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            {isNewName && (
              <div className="mt-2 text-[11px] text-gray-400">
                새 이름 <span className="text-gray-200">"{q}"</span>
              </div>
            )}
            {isDuplicateOfOther && (
              <div className="mt-2 text-[11px] text-rose-400">
                같은 소속에 이미 있는 이름입니다
              </div>
            )}
            {nameChanged && !isDuplicateOfOther && (
              <div className="mt-2 text-[12px] text-gray-300">
                <span className="text-gray-500">{oldName}</span>
                <span className="mx-2 text-gray-600">→</span>
                <span className="font-semibold text-gray-100">{q}</span>
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
            {/* swap 대상 미리보기 (이 사람 계속 눌렀을 때) */}
            {codeChanged && willSwapWith && (
              <div className="mt-2 p-2 rounded-lg bg-gray-800/70 border border-gray-700 text-[11px] text-gray-300 leading-relaxed">
                <div className="text-gray-500 mb-0.5">
                  "이 사람 계속" 선택 시
                </div>
                <div>
                  <span className="text-gray-100">{oldName}</span>
                  <span className="mx-1 text-gray-500">↔</span>
                  <span className="text-gray-100">{willSwapWith}</span>
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
            disabled={!currentChanged || disablePermanent}
            className="py-3 rounded-xl bg-gray-100 hover:bg-white disabled:bg-gray-800/40 disabled:text-gray-600 text-gray-900 flex flex-col items-center gap-0.5"
          >
            <span className="text-[13px] font-semibold">이 사람 계속</span>
            <span className="text-[10px] opacity-70">
              {mode === "code" && willSwapWith
                ? "자리 교환"
                : "데이터 자체 변경"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
