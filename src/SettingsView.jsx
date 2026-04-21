// src/SettingsView.jsx  (v2)
import React from "react";
import {
  Settings as SettingsIcon,
  Upload,
  Edit3,
  Download,
  Globe,
} from "lucide-react";
import PasswordSettings from "./lock/PasswordSettings";
import {
  loadZipToCommonMap,
  saveCommonDataToDB,
  saveZipBlobToDB,
  fetchKoreanHolidaysRange,
  DEPOT_TO_ZIP_KEY,
} from "./dataEngine";

export default function SettingsView(props) {
  const {
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
    selectedDate,
    setSelectedDate,
    DEPOTS,
    DEFAULT_HOLIDAYS_25_26,
    onUpload,
    buildGyodaeTable,
    theme,
    setTheme,
    onOpenSetupWizard,
    // ─── 새 props ───
    commonMap,
    setCommonMap,
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

  // ZIP 업로드 상태
  const [zipLoading, setZipLoading] = React.useState(false);
  const [zipProgress, setZipProgress] = React.useState({
    loaded: 0,
    total: 0,
    phase: "",
  });
  const [zipError, setZipError] = React.useState("");
  const [zipDoneMsg, setZipDoneMsg] = React.useState("");

  // 이름 편집 상태
  const [editModeOn, setEditModeOn] = React.useState(false);
  const [nameEditIdx, setNameEditIdx] = React.useState(-1);
  const [nameEditValue, setNameEditValue] = React.useState("");

  // 공휴일 자동 로딩
  const [holidayLoading, setHolidayLoading] = React.useState(false);
  const [holidayMsg, setHolidayMsg] = React.useState("");

  // TSV 등록 펼침
  const [tsvOpen, setTsvOpen] = React.useState(false);

  React.useEffect(() => {
    if (!selectedDepot) return;
    const defaultNightDiaByDepot = {
      안심: 25,
      월배: 25,
      문양: 24,
      경산: 21,
      교대: 21,
    };
    const defaultNightDia = defaultNightDiaByDepot[selectedDepot];
    if (defaultNightDia && nightDiaByDepot?.[selectedDepot] !== defaultNightDia)
      setNightDiaForDepot(selectedDepot, defaultNightDia);
  }, [selectedDepot]);

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

  // ─────────────────────────────────────────
  //  ZIP 직접 업로드 (Settings 안에서 바로)
  // ─────────────────────────────────────────
  async function handleZipUploadInSettings(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setZipLoading(true);
    setZipError("");
    setZipDoneMsg("");
    setZipProgress({ loaded: 0, total: 0, phase: "opening" });
    try {
      const map = await loadZipToCommonMap(file, (p) => setZipProgress(p));
      if (!Object.keys(map).length)
        throw new Error("ZIP에 유효한 데이터가 없습니다.");
      await saveZipBlobToDB(file, file.name);
      const merged = { ...(commonMap || {}), ...map };
      await saveCommonDataToDB(merged);
      setCommonMap?.(merged);
      setZipDoneMsg(
        `✅ ${file.name} 등록 완료 (소속 ${Object.keys(map).length}개)`
      );
    } catch (err) {
      setZipError(err.message || "ZIP 파일 오류");
    } finally {
      setZipLoading(false);
      setZipProgress({ loaded: 0, total: 0, phase: "" });
      e.target.value = "";
    }
  }

  // ─────────────────────────────────────────
  //  이름 편집
  // ─────────────────────────────────────────
  const beginEditName = (idx, currentName) => {
    setNameEditIdx(idx);
    setNameEditValue(currentName || "");
  };

  const commitEditName = async () => {
    if (nameEditIdx < 0) return;
    const newName = nameEditValue.trim();
    const oldName = nameList?.[nameEditIdx] || "";
    if (!newName || newName === oldName) {
      setNameEditIdx(-1);
      return;
    }

    // 1) commonMap[key].names 에 반영
    const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
    if (commonMap?.[key]?.names?.length) {
      const newNames = [...commonMap[key].names];
      newNames[nameEditIdx] = newName;
      const nextMap = {
        ...commonMap,
        [key]: { ...commonMap[key], names: newNames },
      };
      setCommonMap?.(nextMap);
      try {
        await saveCommonDataToDB(nextMap);
      } catch {}
    }

    // 2) TSV 텍스트에서도 해당 줄의 '이름' 칸만 치환
    try {
      const lines = (currentTableText || "").split(/\r?\n/);
      if (lines.length > nameEditIdx + 1) {
        const targetLine = lines[nameEditIdx + 1]; // 0번째는 헤더
        const cols = targetLine.split("\t");
        if (cols.length >= 2) {
          cols[1] = newName;
          lines[nameEditIdx + 1] = cols.join("\t");
          const nextTsv = lines.join("\n");
          setTablesByDepot?.((prev) => ({
            ...(prev || {}),
            [selectedDepot]: nextTsv,
          }));
        }
      }
    } catch (err) {
      console.warn("[TSV 이름 수정]", err);
    }

    // 3) 내 이름이 이 사람이면 같이 바꿔주기
    if (myName === oldName) setMyNameForDepot?.(selectedDepot, newName);

    setNameEditIdx(-1);
    setNameEditValue("");
  };

  const cancelEditName = () => {
    setNameEditIdx(-1);
    setNameEditValue("");
  };

  // ─────────────────────────────────────────
  //  한국 공휴일 자동 등록
  // ─────────────────────────────────────────
  const autoLoadKoreanHolidays = async () => {
    setHolidayLoading(true);
    setHolidayMsg("");
    try {
      const thisYear = new Date().getFullYear();
      const list = await fetchKoreanHolidaysRange(thisYear - 1, thisYear + 2);
      const existing = new Set(
        (holidaysText || "")
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
      list.forEach((d) => existing.add(d));
      const merged = [...existing].sort().join("\n");
      setHolidaysText(merged);
      setHolidayMsg(
        `✅ ${list.length}개 공휴일 병합 완료 (${thisYear - 1} ~ ${
          thisYear + 2
        })`
      );
    } catch (err) {
      setHolidayMsg(`⚠️ 가져오기 실패 — ${err.message || "오프라인?"}`);
    } finally {
      setHolidayLoading(false);
    }
  };

  const progressPct =
    zipProgress.total > 0
      ? Math.round((zipProgress.loaded / zipProgress.total) * 100)
      : 0;

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
        {/* ─── 빠른 ZIP 등록 (간소화) ─── */}
        <section className="p-4 rounded-2xl bg-gradient-to-br from-indigo-900/50 to-purple-900/30 border border-indigo-700/40">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-indigo-200">
              📦 ZIP 파일 등록
            </div>
            <button
              className="text-[11px] text-indigo-300 underline"
              onClick={() => onOpenSetupWizard?.()}
            >
              마법사 다시 열기
            </button>
          </div>

          <label className="block w-full">
            <div
              className={`w-full py-3 rounded-xl border-2 border-dashed text-center cursor-pointer transition text-sm
                ${
                  zipLoading
                    ? "border-gray-600 text-gray-500"
                    : "border-indigo-500 hover:border-indigo-400 text-indigo-200 bg-indigo-950/30"
                }`}
            >
              {zipLoading ? (
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs">
                      {zipProgress.phase === "opening" && "ZIP 열기..."}
                      {zipProgress.phase === "reading_texts" &&
                        `텍스트 읽는 중 ${zipProgress.loaded}/${zipProgress.total}`}
                      {zipProgress.phase === "parsing" && "파싱 중..."}
                      {zipProgress.phase === "done" && "완료!"}
                    </span>
                  </div>
                  {zipProgress.total > 0 && (
                    <div className="w-40 h-1 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-400 transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <span>📦 ZIP 파일 선택해서 바로 등록</span>
              )}
            </div>
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleZipUploadInSettings}
              disabled={zipLoading}
            />
          </label>

          {zipError && (
            <div className="mt-2 p-2 rounded-lg bg-red-900/50 text-red-300 text-[11px]">
              {zipError}
            </div>
          )}
          {zipDoneMsg && (
            <div className="mt-2 p-2 rounded-lg bg-green-900/40 text-green-300 text-[11px]">
              {zipDoneMsg}
            </div>
          )}
        </section>

        {/* 2-컬럼 레이아웃 */}
        <section className="grid md:grid-cols-2 gap-4 overflow-x-hidden">
          {/* 왼쪽 컬럼 */}
          <div>
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

            {/* ─── 이름 편집 (마스터 토글 방식) ─── */}
            <div className="mt-5 p-4 rounded-2xl bg-gray-900/60 border border-gray-700/40">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <label className="text-sm font-semibold text-gray-200 flex items-center gap-1">
                  <Edit3 className="w-3.5 h-3.5" />
                  이름 편집 ({selectedDepot})
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400">
                    {nameList?.length || 0}명
                  </span>
                  {/* 마스터 토글 */}
                  <button
                    onClick={() => {
                      setEditModeOn((v) => !v);
                      setNameEditIdx(-1);
                      setNameEditValue("");
                    }}
                    className={
                      "px-3 py-1 rounded-lg text-[11px] font-semibold transition " +
                      (editModeOn
                        ? "bg-amber-500 hover:bg-amber-400 text-gray-900"
                        : "bg-indigo-600 hover:bg-indigo-500 text-white")
                    }
                  >
                    {editModeOn ? "✓ 수정 완료" : "✏️ 수정 모드"}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                {editModeOn ? (
                  <span className="text-amber-300">
                    🔧 수정 모드 — 이름을 눌러 변경하세요. 변경한 이름은
                    <b> 다음날에도 그대로 유지</b>됩니다 (영구 개명).
                  </span>
                ) : (
                  <>인사이동이나 오타 수정시 "수정 모드"를 켜고 변경하세요.</>
                )}
              </p>

              <div className="max-h-[280px] overflow-y-auto pr-1 space-y-1">
                {(nameList || []).map((n, i) => {
                  const editing = editModeOn && nameEditIdx === i;
                  const canEdit = editModeOn;
                  return (
                    <div
                      key={`${n}-${i}`}
                      className={
                        "flex items-center gap-2 p-1.5 rounded-lg transition " +
                        (editing
                          ? "bg-amber-900/30 ring-1 ring-amber-500/50"
                          : editModeOn
                          ? "bg-gray-800/60 hover:bg-gray-700/60 cursor-pointer"
                          : "bg-gray-800/60")
                      }
                      onClick={() => {
                        if (canEdit && !editing) beginEditName(i, n);
                      }}
                    >
                      <span className="text-[11px] text-gray-500 w-6 text-right shrink-0">
                        {i + 1}
                      </span>
                      {editing ? (
                        <>
                          <input
                            autoFocus
                            className="flex-1 bg-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none focus:ring-1 focus:ring-amber-400"
                            value={nameEditValue}
                            onChange={(e) => setNameEditValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEditName();
                              if (e.key === "Escape") cancelEditName();
                            }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              commitEditName();
                            }}
                            className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-[11px] text-white"
                          >
                            저장
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEditName();
                            }}
                            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-[11px] text-gray-300"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-xs text-gray-200 truncate">
                            {n || <span className="text-gray-500">(빈칸)</span>}
                          </span>
                          {editModeOn && (
                            <span className="px-2 py-0.5 rounded bg-gray-700/60 text-[10px] text-amber-300">
                              탭하여 수정
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                {(nameList?.length || 0) === 0 && (
                  <div className="text-xs text-gray-500 py-4 text-center">
                    먼저 ZIP 또는 TSV를 등록하세요.
                  </div>
                )}
              </div>
            </div>

            {/* 기준일 */}
            <div className="mt-5 px-3 py-4 w-full box-border rounded-2xl bg-gray-900/60 shadow-inner border border-gray-700/40">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-200">
                  {selectedDepot ? `${selectedDepot} 기준일` : "기준일"}
                  <span className="ml-2 text-xs text-gray-400">
                    {anchorDateStr ? `현재: ${anchorDateStr}` : "(미설정)"}
                  </span>
                </label>
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
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <label className="font-semibold text-gray-200">
                  공휴일 관리
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={autoLoadKoreanHolidays}
                    disabled={holidayLoading}
                    className="px-2 py-1 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-[11px] text-white flex items-center gap-1"
                  >
                    {holidayLoading ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                        로딩중
                      </>
                    ) : (
                      <>
                        <Globe className="w-3 h-3" />
                        🇰🇷 자동 등록
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setHolidaysText("")}
                    className="px-2 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 text-[11px] text-gray-100"
                  >
                    초기화
                  </button>
                </div>
              </div>

              {holidayMsg && (
                <div className="mb-3 p-2 rounded-lg bg-gray-800/80 text-[11px] text-gray-200">
                  {holidayMsg}
                </div>
              )}

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
                  수동추가
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
                • <span className="text-green-300">🇰🇷 자동 등록</span> → 한국
                공휴일(설날·추석 포함)을 인터넷으로 가져와 병합
                <br />
                • 쉼표(,) 또는 줄바꿈으로 수동 입력 가능
                <br />• 일요일은 자동으로 '휴일' 처리됨
              </div>
            </div>
          </div>

          {/* 오른쪽 컬럼 */}
          <div className="space-y-3">
            {/* 테마 */}
            <div className="p-3 rounded-2xl bg-gray-900/60 text-sm">
              <div className="font-semibold mb-2">화면 테마</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={
                    "flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors " +
                    (theme === "light"
                      ? "bg-indigo-500/10 border-indigo-500 text-indigo-600"
                      : "bg-gray-800 border-gray-700 text-gray-300")
                  }
                >
                  라이트
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={
                    "flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors " +
                    (theme === "dark"
                      ? "bg-indigo-500/10 border-indigo-500 text-indigo-600"
                      : "bg-gray-800 border-gray-700 text-gray-300")
                  }
                >
                  다크
                </button>
              </div>
            </div>

            {/* 야간 규칙 */}
            <div className="p-3 rounded-2xl bg-gray-900/60 text-sm">
              <div className="font-semibold mb-1">
                야간 규칙 ({selectedDepot || "소속 미선택"})
              </div>
              <div className="flex items-center gap-2 flex-wrap">
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
                <span>( 안심/월배=25, 문양=24, 경산=21 )</span>
              </div>
              <button
                className="mt-2 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
                onClick={applyNightRuleToAll}
              >
                현재 값 모든 소속에 적용
              </button>
            </div>

            {/* 강조 색상 */}
            <div className="p-3 rounded-2xl bg-gray-900/60 text-sm">
              <div className="font-semibold mb-2">특정 사람 강조 색상</div>
              <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                {(nameList || []).map((n) => {
                  const current = highlightMap?.[n];
                  return (
                    <div
                      key={n}
                      className="p-2.5 rounded-xl bg-gray-800/60 border border-gray-700/40 transition-all hover:bg-gray-700/80"
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
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* TSV 고급편집 (기본 접힘) */}
        <section className="rounded-2xl bg-gray-900/60 border border-gray-700/40 overflow-hidden">
          <button
            type="button"
            onClick={() => setTsvOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm hover:bg-gray-800/50 transition"
          >
            <span className="font-semibold text-gray-200">
              📄 TSV 고급편집 {tsvOpen ? "▼" : "▶"}
            </span>
            <span className="text-[11px] text-gray-500">
              교대·교대(외) 편집용
            </span>
          </button>
          {tsvOpen && (
            <div className="p-4 border-t border-gray-700/50">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-gray-300">
                  다이아 표 (업로드/편집)
                </div>
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 cursor-pointer text-xs">
                  <Upload className="w-3.5 h-3.5" />
                  CSV/TSV
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
                    onClick={() =>
                      setTablesByDepot((prev) => ({
                        ...(prev || {}),
                        [selectedDepot]: buildGyodaeTable(),
                      }))
                    }
                  >
                    교대 21일 순환표로 채우기
                  </button>
                </div>
              )}

              <div className="text-xs text-gray-400 mb-1">
                헤더:
                순번,이름,dia,평일출근,평일퇴근,토요일출근,토요일퇴근,휴일출근,휴일퇴근
              </div>
              <textarea
                className="w-full bg-gray-900 rounded-xl p-3 font-mono text-[10px] whitespace-pre overflow-x-auto resize-none"
                rows={Math.max(
                  10,
                  (currentTableText || "").split("\n").length + 2
                )}
                value={currentTableText || ""}
                onChange={(e) =>
                  setTablesByDepot((prev) => ({
                    ...(prev || {}),
                    [selectedDepot]: e.target.value,
                  }))
                }
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
