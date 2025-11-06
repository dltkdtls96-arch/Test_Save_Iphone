// src/SettingsView.jsx
import React from "react";
import { Settings as SettingsIcon, Upload } from "lucide-react";

export default function SettingsView(props) {
  const {
    // App.jsx에서 전달되는 값들
    selectedDepot,
    setSelectedDepot,

    myName,
    setMyNameForDepot,

    nameList,

    anchorDateStr,
    setAnchorDateStr,

    holidaysText,
    setHolidaysText,
    newHolidayDate,
    setNewHolidayDate,

    nightDiaByDepot,
    setNightDiaForDepot,

    highlightMap,
    setHighlightMap,

    currentTableText,
    setTablesByDepot,

    // 향후 확장용으로 유지
    selectedDate,
    setSelectedDate,

    DEPOTS,
    DEFAULT_HOLIDAYS_25_26,

    onUpload,
    buildGyodaeTable, // ← 추가
  } = props;

  const palette = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#94a3b8",
  ];

  // 공휴일 입력 텍스트 정규화(중복 제거 + 정렬)
  const normalizeHolidays = (text) => {
    const set = new Set(
      (text || "")
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    return [...set].sort().join("\n");
  };

  const applyNightRuleToAll = () => {
    const val = nightDiaByDepot?.[selectedDepot] ?? 25;
    for (const d of DEPOTS) setNightDiaForDepot(d, val);
  };

  return (
    <div
      className="bg-gray-800 shadow mt-4 overflow-y-auto"
      style={{
        maxHeight: "calc(100vh - 120px)",
        paddingBottom: "80px",
        WebkitOverflowScrolling: "touch",
      }}
      aria-label="설정"
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-gray-800 px-4 pt-3 pb-2 border-b border-gray-700/50">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <SettingsIcon className="w-5 h-5" />
          설정
        </h2>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* 2-컬럼 레이아웃 */}
        <section className="grid md:grid-cols-2 gap-4 overflow-x-hidden">
          {/* 왼쪽 컬럼 */}
          <div>
            {/* 소속 */}
            <label className="block text-sm text-gray-300 mb-1">소속</label>
            <select
              className="w-full bg-gray-700 rounded-xl p-2 text-sm"
              value={selectedDepot}
              onChange={(e) => setSelectedDepot(e.target.value)}
            >
              {DEPOTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {/* 내 이름(소속별) */}
            <label className="block text-sm text-gray-300 mb-1 mt-4">
              내 이름
            </label>
            <select
              className="w-full bg-gray-700 rounded-xl p-2 text-sm"
              value={myName}
              onChange={(e) => setMyNameForDepot(selectedDepot, e.target.value)}
            >
              {["", ...(nameList || [])].map((n) => (
                <option key={n || "_empty"} value={n}>
                  {n || "(미선택)"}
                </option>
              ))}
            </select>

            {/* 기준일 */}
            <div className="mt-5 px-3 py-4 w-full box-border rounded-2xl bg-gray-900/60 shadow-inner border border-gray-700/40">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-200">
                  {selectedDepot ? `${selectedDepot} 기준일` : "기준일"}
                  <span className="ml-2 text-xs text-gray-400">
                    {anchorDateStr ? `현재: ${anchorDateStr}` : "(미설정)"}
                  </span>
                </label>

                {/* ✅ 안심 선택 시 안내 문구 */}
                {selectedDepot === "안심" && (
                  <span className="text-xs text-amber-300">
                    안심은 10월 1일로 하세요
                  </span>
                )}

                {/* ✅ 교대 선택 시 안내 문구 */}
                {selectedDepot === "교대" && (
                  <span className="text-xs text-amber-300">
                    교대는 9월 29일로 하세요
                  </span>
                )}
              </div>

              <div className="relative rounded-xl overflow-hidden bg-gray-700 focus-within:ring-2 focus-within:ring-cyan-500">
                <input
                  type="date"
                  className="block w-full max-w-full min-w-0 bg-transparent px-3 py-2 text-sm text-gray-100 outline-none"
                  value={anchorDateStr}
                  onChange={(e) => setAnchorDateStr(e.target.value)}
                />
              </div>

              <p className="text-xs text-gray-400 mt-3 leading-relaxed">
                기준일을 바꾸면 회전 기준이 변경됩니다.
                <br />
                <span className="text-gray-300">
                  기준일 +1일 → 다음 순번, 기준일 -1일 → 이전 순번
                </span>
              </p>
            </div>

            {/* 공휴일 관리 */}
            <div className="mt-5 p-4 rounded-2xl bg-gray-900/60 shadow-inner border border-gray-700/40 text-sm">
              <div className="flex items-center justify-between mb-3">
                <label className="font-semibold text-gray-200">
                  공휴일 관리
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setHolidaysText("")}
                    className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-gray-100"
                    title="입력한 공휴일을 전부 지웁니다 (일요일 자동 휴일은 유지됨)"
                  >
                    휴일 완전 초기화
                  </button>
                  <button
                    onClick={() => setHolidaysText(DEFAULT_HOLIDAYS_25_26)}
                    className="px-2 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs text-white"
                    title="2025·2026 기본 공휴일 리스트로 복구"
                  >
                    기본 살리기
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <input
                  type="date"
                  className="flex-1 bg-gray-700 rounded-xl px-3 py-1.5 text-sm text-gray-100 focus:ring-2 focus:ring-cyan-500 outline-none"
                  value={newHolidayDate || ""}
                  onChange={(e) => setNewHolidayDate(e.target.value)}
                />
                <button
                  onClick={() => {
                    if (!newHolidayDate) return;
                    const merged = normalizeHolidays(
                      [holidaysText, newHolidayDate].filter(Boolean).join("\n")
                    );
                    setHolidaysText(merged);
                    setNewHolidayDate("");
                  }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs text-white"
                >
                  추가
                </button>
              </div>

              <textarea
                className="w-full bg-gray-800 rounded-xl p-2 h-28 text-sm text-gray-100 font-mono leading-5 whitespace-pre resize-none"
                placeholder={"2025-01-01\n2025-02-10\n2025-03-01"}
                value={holidaysText}
                onChange={(e) => setHolidaysText(e.target.value)}
                onBlur={(e) =>
                  setHolidaysText(normalizeHolidays(e.target.value))
                }
              />

              <div className="text-xs text-gray-400 mt-2 leading-relaxed">
                • 날짜를 직접 입력하거나, 선택 후 ‘추가’를 누르면 자동으로
                목록에 들어갑니다.
                <br />• 쉼표(,) 또는 줄바꿈으로 여러 날짜를 구분할 수 있습니다.
                <br />• 일요일은 자동으로 ‘휴일’로 처리됩니다.
              </div>
            </div>
          </div>

          {/* 오른쪽 컬럼 */}
          <div className="space-y-3">
            {/* 야간 규칙 (소속별) */}
            <div className="p-3 rounded-2xl bg-gray-900/60 text-sm">
              <div className="font-semibold mb-1">
                야간 규칙 ({selectedDepot || "소속 미선택"})
              </div>
              <div className="flex items-center gap-2">
                <span>야간 기준 dia ≥</span>
                <input
                  type="number"
                  min={1}
                  className="w-20 bg-gray-700 rounded-xl px-2 py-1 text-sm"
                  value={nightDiaByDepot?.[selectedDepot] ?? 25}
                  onChange={(e) =>
                    setNightDiaForDepot(
                      selectedDepot,
                      Math.max(1, Number(e.target.value) || 1)
                    )
                  }
                />
                <span>( 안심=25, 나머지=5 )</span>
              </div>

              <button
                className="mt-2 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
                onClick={applyNightRuleToAll}
                title="현재 소속의 값을 모든 소속에 복사"
              >
                현재 값 모든 소속에 적용
              </button>

              <div className="text-xs text-gray-300 mt-1">
                * (중요!) 반드시 설정 상단의 소속을 선택하고 오세요
              </div>
            </div>

            {/* 특정 사람 강조 색상 */}
            <div className="p-3 rounded-2xl bg-gray-900/60 text-sm">
              <div className="font-semibold mb-2">특정 사람 강조 색상</div>

              <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                {(nameList || []).map((n) => {
                  const current = highlightMap?.[n];
                  return (
                    <div
                      key={n}
                      className="p-2.5 rounded-xl bg-gray-800/60 border border-gray-700/40 transition-all hover:bg-gray-700/80 hover:shadow-md hover:shadow-black/30"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-200 truncate w-20">
                            {n}
                          </span>
                          {current && (
                            <>
                              <span
                                className="inline-block w-3 h-3 rounded-full ring-1 ring-gray-500"
                                style={{ backgroundColor: current }}
                                title={current}
                              />
                              <span className="text-[11px] text-gray-400">
                                {current}
                              </span>
                            </>
                          )}
                        </div>
                        <button
                          onClick={() =>
                            setHighlightMap((prev) => {
                              const next = { ...(prev || {}) };
                              delete next[n];
                              return next;
                            })
                          }
                          className="px-2 h-6 rounded text-[11px] bg-gray-700 hover:bg-gray-600 transition-colors"
                          title="해제"
                        >
                          해제
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {palette.map((c) => (
                          <button
                            key={c}
                            onClick={() =>
                              setHighlightMap((prev) => ({
                                ...(prev || {}),
                                [n]: c,
                              }))
                            }
                            className={
                              "w-6 h-6 rounded-md ring-1 ring-gray-600 transition-transform hover:ring-white " +
                              (current === c
                                ? "outline outline-2 outline-white scale-110"
                                : "")
                            }
                            style={{ backgroundColor: c }}
                            title={c}
                            aria-label={`${n} 강조 색상 ${c}로 설정`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="text-xs text-gray-400 mt-2">
                * 색상을 탭하면 적용됩니다. ‘해제’로 원복.
              </div>
            </div>
          </div>
        </section>

        {/* 표 업로드/편집 */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-base font-semibold">
              다이아 표 (업로드/편집)
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 cursor-pointer">
              <Upload className="w-4 h-4" />
              파일 업로드 (CSV/TSV)
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={onUpload}
              />
            </label>
          </div>
          {selectedDepot === "교대" && buildGyodaeTable && (
            <div className="mb-2">
              <button
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white"
                onClick={() => {
                  setTablesByDepot((prev) => ({
                    ...(prev || {}),
                    [selectedDepot]: buildGyodaeTable(),
                  }));
                  // 필요하면 기준일도 고정:
                  // setAnchorDateStr("2025-10-01");
                }}
              >
                교대 21일 순환표로 채우기
              </button>
            </div>
          )}

          <div className="text-xs text-gray-400 mb-1">
            헤더 예시:
            순번,이름,dia,평일출근,평일퇴근,토요일출근,토요일퇴근,휴일출근,휴일퇴근
          </div>
          <textarea
            className="w-full bg-gray-900 rounded-xl p-3 font-mono text-[10px] whitespace-pre overflow-x-auto resize-none"
            rows={Math.max(10, (currentTableText || "").split("\n").length + 2)}
            value={currentTableText || ""}
            onChange={(e) =>
              setTablesByDepot((prev) => ({
                ...(prev || {}),
                [selectedDepot]: e.target.value,
              }))
            }
          />
        </section>
      </div>
    </div>
  );
}
