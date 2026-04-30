// src/SettingsView.jsx  (v3)
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
  diagnoseStorage,
} from "./dataEngine";

// 안심 기지 전화번호 매핑 (이름 → 전화번호)
// 출처: 안심_전번.xlsx
// 자동 매칭 버튼으로 한 번에 채울 수 있음
const ANSIM_PHONE_MAP = {
  이정식: "010-5027-1525",
  박종태: "010-5122-7225",
  임정재: "010-2443-3730",
  임민우: "010-2598-2958",
  류기철: "010-8865-3062",
  남태문: "010-4475-5118",
  전경구: "010-8573-6318",
  손홍석: "010-5611-2231",
  김관동: "010-5354-4501",
  김희준: "010-3803-2786",
  이원진: "010-3511-5184",
  김우년: "010-3824-2384",
  김병재: "010-2519-0526",
  김성규: "010-6255-3981",
  이근수: "010-3545-7880",
  박정식: "010-4533-6094",
  강유덕: "010-8892-8087",
  조덕헌: "010-8608-0538",
  구민혁: "010-2858-4343",
  정운규: "010-7482-1005",
  채준호: "010-2572-2496",
  임병길: "010-3549-6802",
  강원희: "010-4478-1268",
  송기중: "010-2577-6526",
  왕진섭: "010-7107-0143",
  김호열: "010-2539-8512",
  허준석: "010-2805-0211",
  이상훈: "010-4166-9608",
  정범철: "010-5112-2184",
  김재곤: "010-2878-5214",
  우진하: "010-3305-5302",
  이상헌: "010-3820-2081",
  박경섭: "010-7220-4439",
  이재문: "010-9944-5004",
  윤영준: "010-8363-7575",
  문경주: "010-9411-2105",
  김현우: "010-2817-1074",
  김병국: "010-3235-1768",
  박상현: "010-2533-9930",
  권정진: "010-3521-3178",
  신동훈: "010-4333-9188",
  이상원: "010-9985-4895",
  최병환: "010-3446-2081",
  이기환: "010-4813-1425",
  정호창: "010-4243-3923",
  김성열: "010-2504-3139",
  이성철: "010-3205-6437",
  임대기: "010-8703-0369",
  이재헌: "010-2338-9797",
  김치완: "010-8857-0055",
  강병웅: "010-2510-0292",
  오중구: "010-9390-0407",
  권기석: "010-4339-7959",
  김종훈: "010-2250-2670",
  권용록: "010-6825-3021",
  함일남: "010-2527-8827",
  김상수: "010-8346-5215",
  이희한: "010-8851-8887",
  한남권: "010-6597-5611",
  박종률: "010-6509-0157",
  조재훈: "010-4436-1192",
  김건희: "010-4578-5689",
  박재민: "010-7751-2711",
  홍성민: "010-9967-2569",
  유용우: "010-4932-2124",
  김경구: "010-8000-2461",
  강동우: "010-2329-5336",
  박문우: "010-9325-8016",
  우진우: "010-6365-4296",
  박형민: "010-8511-6297",
  이상욱: "010-8851-3021",
  김찬우: "010-6767-2073",
  최우용: "010-5669-3554",
  박도현: "010-2925-4780",
  최동현: "010-2551-7399",
  이성재: "010-3433-1298",
  황병두: "010-3036-8003",
  엄인철: "010-4170-3103",
  이동혁: "010-5737-6690",
  김선정: "010-3121-8762",
  김성탁: "010-3867-5423",
  이상신: "010-3347-3953",
  김종규: "010-5152-4322",
  진위동: "010-9278-3582",
  권혁기: "010-3555-7277",
  강근영: "010-4840-8496",
  이원준: "010-6397-1886",
  백상우: "010-2924-9202",
  강인구: "010-5950-5001",
  이동호: "010-2007-0858",
  이창민: "010-8844-6414",
};

export default function SettingsView(props) {
  const {
    selectedDepot,
    setSelectedDepot,
    myName,
    setMyNameForDepot,
    nameList,
    // anchorDateStr / setAnchorDateStr — 기준일 UI 제거됨, 자동으로 오늘 사용
    holidaysText,
    setHolidaysText,
    newHolidayDate,
    setNewHolidayDate,
    nightDiaByDepot,
    setNightDiaForDepot,
    routeScaleByDepot,
    setRouteScaleForDepot,
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
    onResetAll,
    commonMap,
    setCommonMap,
    peopleRows,
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

  const [zipLoading, setZipLoading] = React.useState(false);
  const [zipProgress, setZipProgress] = React.useState({
    loaded: 0,
    total: 0,
    phase: "",
  });
  const [zipError, setZipError] = React.useState("");
  const [zipDoneMsg, setZipDoneMsg] = React.useState("");

  const [editModeOn, setEditModeOn] = React.useState(false);
  const [editingIdx, setEditingIdx] = React.useState(-1);
  const [editField, setEditField] = React.useState(null);
  const [editValue, setEditValue] = React.useState("");

  // 인원 편집 정렬 모드: "seq" | "dia" | "name"
  const [personSortMode, setPersonSortMode] = React.useState("seq");

  // 정렬된 인원 목록 — 원본 인덱스(origIdx)를 함께 보관해서
  // 편집/저장은 여전히 peopleRows 의 원본 순번 기준으로 동작하도록 함.
  const sortedPeople = React.useMemo(() => {
    const list = (peopleRows || []).map((row, origIdx) => ({ row, origIdx }));
    if (personSortMode === "name") {
      return list.sort((a, b) =>
        String(a.row?.name || "").localeCompare(String(b.row?.name || ""), "ko")
      );
    }
    if (personSortMode === "dia") {
      // DIA 정렬 우선순위:
      //  1) 숫자 DIA (작은 숫자부터)
      //  2) 대N (숫자 오름차순)
      //  3) 주 / 야
      //  4) 비번/비/N~ (비번류)
      //  5) 휴 / 휴가 / 교육
      //  6) 기타
      const rankOf = (dia) => {
        if (dia == null || dia === "") return [9999, 0, ""];
        if (typeof dia === "number") return [0, dia, ""];
        const s = String(dia).replace(/\s+/g, "");
        if (/^\d+$/.test(s)) return [0, Number(s), ""];
        if (/^대\d+$/.test(s)) return [1, Number(s.replace(/\D/g, "")), s];
        if (s === "주") return [2, 0, s];
        if (s === "야") return [2, 1, s];
        if (s.includes("비") || s.endsWith("~")) return [3, 0, s];
        if (s.startsWith("휴") || s === "휴가" || s === "교육")
          return [4, 0, s];
        return [5, 0, s];
      };
      return list.sort((a, b) => {
        const [ra, va, sa] = rankOf(a.row?.dia);
        const [rb, vb, sb] = rankOf(b.row?.dia);
        if (ra !== rb) return ra - rb;
        if (va !== vb) return va - vb;
        if (sa !== sb) return String(sa).localeCompare(String(sb));
        return String(a.row?.name || "").localeCompare(
          String(b.row?.name || ""),
          "ko"
        );
      });
    }
    // "seq" — 원래 순번 그대로
    return list;
  }, [peopleRows, personSortMode]);

  const [holidayLoading, setHolidayLoading] = React.useState(false);
  const [holidayMsg, setHolidayMsg] = React.useState("");

  const [tsvOpen, setTsvOpen] = React.useState(false);

  const normalizeHolidays = (text) => {
    const set = new Set(
      (text || "")
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    return [...set].sort().join("\n");
  };

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

  const beginEdit = (idx, field, currentValue) => {
    setEditingIdx(idx);
    setEditField(field);
    setEditValue(currentValue || "");
  };

  const cancelEdit = () => {
    setEditingIdx(-1);
    setEditField(null);
    setEditValue("");
  };

  // ─────────────────────────────────────────
  //  안심 전화번호 자동 매칭
  //  ANSIM_PHONE_MAP에서 이름 일치하는 사람들 전화번호 일괄 채워넣기
  //  - 안심(as) 기지에서만 동작
  //  - 기존 전화번호가 있으면 덮어쓸지 옵션
  // ─────────────────────────────────────────
  const [autoFillMsg, setAutoFillMsg] = React.useState("");

  const autoFillAnsimPhones = async (overwrite = false) => {
    if (selectedDepot !== "안심") {
      setAutoFillMsg("⚠️ 안심 기지에서만 사용 가능합니다.");
      return;
    }
    const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
    const common = commonMap?.[key];
    if (!common?.names?.length) {
      setAutoFillMsg("⚠️ 안심 데이터가 없습니다.");
      return;
    }

    const names = common.names;
    const oldPhones = Array.isArray(common.phones)
      ? [...common.phones]
      : new Array(names.length).fill("");
    while (oldPhones.length < names.length) oldPhones.push("");

    const newPhones = [...oldPhones];
    let matched = 0;
    let skipped = 0;
    let unmatched = [];

    names.forEach((name, i) => {
      const phoneFromMap = ANSIM_PHONE_MAP[String(name || "").trim()];
      if (phoneFromMap) {
        if (newPhones[i] && !overwrite) {
          skipped++;
        } else {
          newPhones[i] = phoneFromMap;
          matched++;
        }
      } else if (name) {
        unmatched.push(name);
      }
    });

    const nextMap = {
      ...commonMap,
      [key]: { ...common, phones: newPhones },
    };
    setCommonMap?.(nextMap);
    try {
      await saveCommonDataToDB(nextMap);
    } catch {}

    let msg = `✅ ${matched}명 전화번호 자동 등록 완료`;
    if (skipped > 0) msg += ` · 기존 유지 ${skipped}명`;
    if (unmatched.length > 0) {
      msg += ` · 명단에 없는 사람 ${unmatched.length}명 (수동 입력 필요)`;
    }
    setAutoFillMsg(msg);
    // 5초 후 자동 사라짐
    setTimeout(() => setAutoFillMsg(""), 8000);
  };

  // ─────────────────────────────────────────
  //  이름/전화번호 편집 커밋
  //  이름 변경 시:
  //   - 새 이름이 기존에 없음 → 단순 개명
  //   - 새 이름이 기존에 있음 → 스왑할지 confirm 물어보기
  // ─────────────────────────────────────────
  const commitEdit = async () => {
    if (editingIdx < 0 || !editField) return;
    const newVal = editValue.trim();
    const oldRow = peopleRows?.[editingIdx];

    const norm = (s) =>
      String(s || "")
        .replace(/\s+/g, "")
        .toLowerCase();

    if (editField === "name") {
      const oldName = oldRow?.name || "";
      if (!newVal || newVal === oldName) {
        cancelEdit();
        return;
      }

      const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
      const common = commonMap?.[key];
      if (!common?.names?.length) {
        cancelEdit();
        return;
      }

      const newKey = norm(newVal);
      const oldKey = norm(oldName);

      // 같은 이름(공백/대소문자만 다름) → 표기만 정리
      if (newKey === oldKey) {
        const newNames = [...common.names];
        newNames[editingIdx] = newVal;
        const nextMap = { ...commonMap, [key]: { ...common, names: newNames } };
        setCommonMap?.(nextMap);
        try {
          await saveCommonDataToDB(nextMap);
        } catch {}
        // TSV 동기화
        try {
          const lines = (currentTableText || "").split(/\r?\n/);
          if (lines.length > editingIdx + 1) {
            const cols = lines[editingIdx + 1].split("\t");
            if (cols.length >= 2) {
              cols[1] = newVal;
              lines[editingIdx + 1] = cols.join("\t");
              setTablesByDepot?.((prev) => ({
                ...(prev || {}),
                [selectedDepot]: lines.join("\n"),
              }));
            }
          }
        } catch {}
        cancelEdit();
        return;
      }

      // 새 이름이 이미 다른 자리에 존재하는지 확인 (editingIdx 제외)
      const swapCandidates = common.names
        .map((n, i) => ({ n, i }))
        .filter((x) => norm(x.n) === newKey && x.i !== editingIdx);

      if (swapCandidates.length > 1) {
        alert(
          `"${newVal}" 이름을 가진 사람이 여러 명 있습니다.\n자리 교환 대상을 특정할 수 없습니다.`
        );
        cancelEdit();
        return;
      }

      if (swapCandidates.length === 1) {
        // 스왑 확인
        const swapIdx = swapCandidates[0].i;
        const swapName = common.names[swapIdx];
        const ok = window.confirm(
          `"${newVal}" 은(는) 이미 다른 자리에 있는 사람입니다.\n\n` +
            `"${oldName}" ↔ "${swapName}" 두 사람의 자리를 서로 바꾸시겠습니까?\n\n` +
            `교번도 함께 바뀝니다.`
        );
        if (!ok) {
          cancelEdit();
          return;
        }

        // 이름 swap
        const newNames = [...common.names];
        newNames[editingIdx] = swapName;
        newNames[swapIdx] = oldName;

        // 전화번호도 함께 swap
        const oldPhones = common.phones || [];
        const newPhones = [...oldPhones];
        if (oldPhones.length === common.names.length) {
          newPhones[editingIdx] = oldPhones[swapIdx] || "";
          newPhones[swapIdx] = oldPhones[editingIdx] || "";
        }

        const nextMap = {
          ...commonMap,
          [key]: { ...common, names: newNames, phones: newPhones },
        };
        setCommonMap?.(nextMap);
        try {
          await saveCommonDataToDB(nextMap);
        } catch {}

        // TSV 동기화
        try {
          const lines = (currentTableText || "").split(/\r?\n/);
          const aLine = editingIdx + 1;
          const bLine = swapIdx + 1;
          if (lines.length > Math.max(aLine, bLine)) {
            const aCols = lines[aLine].split("\t");
            const bCols = lines[bLine].split("\t");
            if (aCols.length >= 2 && bCols.length >= 2) {
              const tmp = aCols[1];
              aCols[1] = bCols[1];
              bCols[1] = tmp;
              lines[aLine] = aCols.join("\t");
              lines[bLine] = bCols.join("\t");
              setTablesByDepot?.((prev) => ({
                ...(prev || {}),
                [selectedDepot]: lines.join("\n"),
              }));
            }
          }
        } catch {}

        cancelEdit();
        return;
      }

      // 새 이름 (기존에 없음) — 단순 개명
      const newNames = [...common.names];
      newNames[editingIdx] = newVal;
      const nextMap = { ...commonMap, [key]: { ...common, names: newNames } };
      setCommonMap?.(nextMap);
      try {
        await saveCommonDataToDB(nextMap);
      } catch {}

      // TSV 동기화
      try {
        const lines = (currentTableText || "").split(/\r?\n/);
        if (lines.length > editingIdx + 1) {
          const cols = lines[editingIdx + 1].split("\t");
          if (cols.length >= 2) {
            cols[1] = newVal;
            lines[editingIdx + 1] = cols.join("\t");
            setTablesByDepot?.((prev) => ({
              ...(prev || {}),
              [selectedDepot]: lines.join("\n"),
            }));
          }
        }
      } catch {}

      if (myName === oldName) setMyNameForDepot?.(selectedDepot, newVal);
    }

    if (editField === "phone") {
      const oldPhone = oldRow?.phone || "";
      if (newVal === oldPhone) {
        cancelEdit();
        return;
      }

      const key = DEPOT_TO_ZIP_KEY[selectedDepot] || selectedDepot;
      if (commonMap?.[key]) {
        const len = commonMap[key].names?.length || 0;
        const newPhones = Array.isArray(commonMap[key].phones)
          ? [...commonMap[key].phones]
          : new Array(len).fill("");
        while (newPhones.length < len) newPhones.push("");
        newPhones[editingIdx] = newVal;
        const nextMap = {
          ...commonMap,
          [key]: { ...commonMap[key], phones: newPhones },
        };
        setCommonMap?.(nextMap);
        try {
          await saveCommonDataToDB(nextMap);
        } catch {}
      }
    }

    cancelEdit();
  };

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
      <div
        className="sticky top-0 z-10 px-4 pt-4 pb-3"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2
          className="text-[18px] font-bold flex items-center gap-2"
          style={{ color: "var(--text-primary)" }}
        >
          <SettingsIcon className="w-5 h-5" />
          설정
        </h2>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* ─── 데이터 등록 ─── */}
        <section
          className="p-5 rounded-2xl"
          style={{ background: "var(--surface-2)" }}
        >
          <div className="flex items-start gap-3 mb-4">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 text-xl"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent)",
              }}
            >
              📦
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-[15px] font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                교번 데이터 등록
              </div>
              <p
                className="text-[12px] mt-0.5 leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                ZIP 파일을 등록하면 근무표·행로표가 자동으로 반영됩니다.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="block w-full">
              <div
                className="w-full py-3 rounded-xl text-center cursor-pointer transition text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: zipLoading ? "var(--surface-3)" : "var(--accent)",
                  color: zipLoading ? "var(--text-tertiary)" : "#ffffff",
                  boxShadow: zipLoading
                    ? "none"
                    : "0 2px 8px rgba(49,130,246,0.22)",
                }}
              >
                {zipLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs">
                      {zipProgress.phase === "opening" && "ZIP 열기..."}
                      {zipProgress.phase === "reading_texts" &&
                        `텍스트 읽는 중 ${zipProgress.loaded}/${zipProgress.total}`}
                      {zipProgress.phase === "parsing" && "파싱 중..."}
                      {zipProgress.phase === "done" && "완료!"}
                    </span>
                  </>
                ) : (
                  <span>교번 ZIP 파일 등록</span>
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

            <button
              type="button"
              onClick={() => onOpenSetupWizard?.()}
              className="w-full py-2.5 rounded-xl text-[13px] font-medium transition"
              style={{
                background: "transparent",
                color: "var(--text-secondary)",
                boxShadow: "inset 0 0 0 1px var(--border-strong)",
              }}
            >
              설정 마법사로 처음부터 시작
            </button>
          </div>

          {zipProgress.total > 0 && zipLoading && (
            <div
              className="mt-3 h-1 bg-gray-700 rounded-full overflow-hidden"
              style={{ background: "var(--surface-3)" }}
            >
              <div
                className="h-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
          )}
          {zipError && (
            <div
              className="mt-3 p-2.5 rounded-lg text-[12px]"
              style={{ background: "var(--red-soft)", color: "var(--red)" }}
            >
              {zipError}
            </div>
          )}
          {zipDoneMsg && (
            <div
              className="mt-3 p-2.5 rounded-lg text-[12px]"
              style={{ background: "var(--green-soft)", color: "var(--green)" }}
            >
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

            {/* ─── 인원 편집 ─── */}
            <div className="mt-5 p-4 rounded-2xl bg-gray-900/60 border border-gray-700/40">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <label className="text-sm font-semibold text-gray-200 flex items-center gap-1">
                  <Edit3 className="w-3.5 h-3.5" />
                  인원 편집 ({selectedDepot})
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400">
                    {peopleRows?.length || 0}명
                  </span>
                  <button
                    onClick={() => {
                      setPersonSortMode((m) =>
                        m === "seq" ? "dia" : m === "dia" ? "name" : "seq"
                      );
                      cancelEdit();
                    }}
                    className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition"
                    title="정렬 방식 변경"
                  >
                    {personSortMode === "seq"
                      ? "순번 ↓"
                      : personSortMode === "dia"
                      ? "DIA ↓"
                      : "이름 ↓"}
                  </button>
                  <button
                    onClick={() => {
                      setEditModeOn((v) => !v);
                      cancelEdit();
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
                    🔧 수정 모드 — 이름/전화번호를 눌러 변경하세요. 입력 후{" "}
                    <b>Enter 또는 ✓</b> 로 저장. 이미 존재하는 이름이면{" "}
                    <b>자리 교환(스왑)</b>, 새 이름이면 <b>단순 개명</b>됩니다.
                  </span>
                ) : (
                  <>인사이동·오타 수정·전화번호 추가 시 "수정 모드"를 켜세요.</>
                )}
              </p>

              {/* 안심 전화번호 자동 매칭 (안심 기지에서만 표시) */}
              {selectedDepot === "안심" && (
                <div className="mb-3 p-2.5 rounded-lg bg-emerald-900/30 border border-emerald-500/30">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-[11px] text-emerald-200">
                      📞 안심 전화번호 일괄 등록
                      <span className="text-[10px] text-emerald-300/70 ml-1">
                        (내장 명단 91명)
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => autoFillAnsimPhones(false)}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                        title="비어있는 사람만 채우기"
                      >
                        빈 칸만 채우기
                      </button>
                      <button
                        type="button"
                        onClick={() => autoFillAnsimPhones(true)}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 text-white"
                        title="기존 번호도 모두 덮어쓰기"
                      >
                        전체 덮어쓰기
                      </button>
                    </div>
                  </div>
                  {autoFillMsg && (
                    <div className="mt-2 text-[11px] text-emerald-100 leading-relaxed">
                      {autoFillMsg}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-emerald-400/70 leading-relaxed">
                    명단에 없는 사람은 수정 모드에서 직접 입력하세요.
                  </div>
                </div>
              )}

              {(peopleRows?.length || 0) > 0 && (
                <div className="grid grid-cols-[28px_44px_1fr_120px] gap-2 px-1.5 pb-1 text-[10px] text-gray-500 border-b border-gray-700/50">
                  <span className="text-right">#</span>
                  <span>교번</span>
                  <span>이름</span>
                  <span>전화번호</span>
                </div>
              )}

              <div className="max-h-[360px] overflow-y-auto pr-1 space-y-0.5 mt-1">
                {sortedPeople.map(({ row, origIdx }) => {
                  const i = origIdx; // 편집/저장은 원본 인덱스 기준 유지
                  const editingName =
                    editModeOn && editingIdx === i && editField === "name";
                  const editingPhone =
                    editModeOn && editingIdx === i && editField === "phone";
                  const anyEditing = editingName || editingPhone;

                  const diaLabel =
                    row?.dia == null
                      ? "-"
                      : typeof row.dia === "number"
                      ? String(row.dia)
                      : String(row.dia);

                  let diaColor = "text-gray-300";
                  const diaStr = String(row?.dia || "").replace(/\s/g, "");
                  if (typeof row?.dia === "string") {
                    if (diaStr.startsWith("휴") || diaStr.includes("비"))
                      diaColor = "text-gray-400";
                    else if (diaStr.endsWith("~")) diaColor = "text-gray-400";
                    else if (diaStr.startsWith("대")) {
                      const outEmpty = !row?.weekday?.out;
                      diaColor = outEmpty ? "text-sky-300" : "text-purple-300";
                    } else if (diaStr === "야") diaColor = "text-sky-300";
                    else if (diaStr === "주") diaColor = "text-yellow-300";
                  } else if (typeof row?.dia === "number") {
                    const outEmpty = !row?.weekday?.out;
                    const inEmpty = !row?.weekday?.in;
                    if (inEmpty && !outEmpty) diaColor = "text-gray-400";
                    else if (outEmpty) diaColor = "text-sky-300";
                    else diaColor = "text-yellow-300";
                  }

                  return (
                    <div
                      key={`${row.name}-${i}`}
                      className={
                        "grid grid-cols-[28px_44px_1fr_120px] gap-2 items-center p-2 rounded-md transition text-xs " +
                        (anyEditing
                          ? "bg-amber-900/30 ring-1 ring-amber-500/50"
                          : editModeOn
                          ? "bg-gray-800/60 hover:bg-gray-700/60"
                          : "bg-gray-800/60")
                      }
                    >
                      <span className="text-[10px] text-gray-500 text-right">
                        {i + 1}
                      </span>
                      <span className={`text-sm font-bold ${diaColor}`}>
                        {diaLabel}
                      </span>

                      {editingName ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            className="flex-1 min-w-0 bg-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-100 outline-none focus:ring-1 focus:ring-amber-400"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (
                                e.key === "Enter" &&
                                !e.nativeEvent.isComposing
                              )
                                commitEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                          <button
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={commitEdit}
                            className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-semibold"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={cancelEdit}
                            className="px-1.5 py-0.5 rounded bg-gray-600 text-gray-100 text-[10px]"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <span
                          className={
                            "truncate text-gray-100 " +
                            (editModeOn
                              ? "cursor-pointer hover:text-amber-300"
                              : "")
                          }
                          onClick={() => {
                            if (editModeOn) beginEdit(i, "name", row.name);
                          }}
                        >
                          {row.name || (
                            <span className="text-gray-500">(빈칸)</span>
                          )}
                        </span>
                      )}

                      {editingPhone ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="tel"
                            className="flex-1 min-w-0 bg-gray-700 rounded px-1.5 py-0.5 text-[11px] text-gray-100 outline-none focus:ring-1 focus:ring-amber-400"
                            placeholder="010-..."
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                          <button
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={commitEdit}
                            className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-semibold"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={cancelEdit}
                            className="px-1.5 py-0.5 rounded bg-gray-600 text-gray-100 text-[10px]"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <span
                          className={
                            "truncate text-[11px] " +
                            (row.phone ? "text-emerald-300" : "text-gray-500") +
                            (editModeOn
                              ? " cursor-pointer hover:text-amber-300"
                              : "")
                          }
                          onClick={() => {
                            if (editModeOn)
                              beginEdit(i, "phone", row.phone || "");
                          }}
                        >
                          {row.phone || (editModeOn ? "＋추가" : "—")}
                        </span>
                      )}
                    </div>
                  );
                })}
                {(peopleRows?.length || 0) === 0 && (
                  <div className="text-xs text-gray-500 py-4 text-center">
                    먼저 ZIP 또는 TSV를 등록하세요.
                  </div>
                )}
              </div>
            </div>

            {/*
              기준일 UI 제거됨 — 자동으로 오늘(현재일) 기준으로 동작.
              App.jsx 가 매일 anchor 를 오늘로 갱신하므로 UI 에서 건드릴 필요 없음.
            */}

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
                  onClick={() => setTheme?.("light")}
                  className={
                    "flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors " +
                    (theme === "light"
                      ? "bg-indigo-500/10 border-indigo-500 text-indigo-600"
                      : "bg-gray-800 border-gray-700 text-gray-300")
                  }
                >
                  ☀️ 라이트
                </button>
                <button
                  type="button"
                  onClick={() => setTheme?.("dark")}
                  className={
                    "flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors " +
                    (theme === "dark"
                      ? "bg-indigo-500/10 border-indigo-500 text-indigo-300"
                      : "bg-gray-800 border-gray-700 text-gray-300")
                  }
                >
                  🌙 다크
                </button>
              </div>
            </div>

            {/* 행로표 이미지 배율 */}
            <div className="p-3 rounded-2xl bg-gray-900/60 text-sm">
              <div className="font-semibold mb-2">
                행로표 배율 ({selectedDepot || "소속 미선택"})
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.1}
                  value={routeScaleByDepot?.[selectedDepot] ?? 1}
                  onChange={(e) =>
                    setRouteScaleForDepot?.(
                      selectedDepot,
                      Math.min(2, Math.max(1, parseFloat(e.target.value) || 1))
                    )
                  }
                  className="flex-1 min-w-[120px]"
                />
                <span className="font-semibold tabular-nums w-12 text-right">
                  {(routeScaleByDepot?.[selectedDepot] ?? 1).toFixed(1)}x
                </span>
              </div>
              <div className="flex gap-1 mt-2 flex-wrap">
                {[1, 1.2, 1.5, 1.8, 2].map((v) => (
                  <button
                    key={v}
                    className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
                    onClick={() => setRouteScaleForDepot?.(selectedDepot, v)}
                  >
                    {v}x
                  </button>
                ))}
                <button
                  className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs ml-auto"
                  onClick={() => {
                    const val = routeScaleByDepot?.[selectedDepot] ?? 1;
                    for (const d of DEPOTS) setRouteScaleForDepot?.(d, val);
                  }}
                >
                  모든 소속에 적용
                </button>
              </div>
            </div>

            {/* 강조 색상 */}
            <div className="p-3 rounded-2xl bg-gray-900/60 text-sm">
              <div className="font-semibold mb-2">특정 사람 강조 색상</div>
              <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                {[...(nameList || [])]
                  .sort((a, b) => String(a).localeCompare(String(b), "ko"))
                  .map((n) => {
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

        {/* TSV 고급편집 (교대·교대(외) 전용) */}
        {(selectedDepot === "교대" || selectedDepot === "교대(외)") && (
          <TsvEditorSection
            selectedDepot={selectedDepot}
            currentTableText={currentTableText}
            setTablesByDepot={setTablesByDepot}
            buildGyodaeTable={buildGyodaeTable}
            onUpload={onUpload}
            tsvOpen={tsvOpen}
            setTsvOpen={setTsvOpen}
          />
        )}
        {!(selectedDepot === "교대" || selectedDepot === "교대(외)") && (
          <section className="rounded-2xl bg-gray-900/60 border border-gray-700/40 px-4 py-3 text-[12px] text-gray-400">
            <span className="font-semibold text-gray-300">📄 TSV 고급편집</span>
            <span className="ml-2 text-[11px]">
              교대 / 교대(외) 에서만 사용 가능합니다.
            </span>
            <div className="mt-1 text-[11px] text-gray-500 leading-relaxed">
              ZIP 기지(안심/월배/경산/문양)는 위의 "인원 편집" 섹션에서 이름과
              전화번호를 수정하세요. 교번 자리 바꾸기는 전체 교번 화면의 수정
              모드(✏️)에서 셀을 눌러 진행합니다.
            </div>
          </section>
        )}

        {/* ─── 저장소 진단 ─── */}
        <section className="rounded-2xl bg-slate-800/60 border border-slate-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-slate-200">
              🔍 저장소 진단
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
            행로표 이미지가 날아갔을 때 이 버튼을 눌러 결과를 그대로 공유해
            주세요. 복사 버튼을 누르면 클립보드에 담깁니다.
          </p>
          <button
            type="button"
            onClick={async () => {
              try {
                const report = await diagnoseStorage();
                // 결과 프롬프트/복사 — 화면에도 표시
                const el = document.getElementById("storage-diag-output");
                if (el) el.textContent = report;
                try {
                  await navigator.clipboard?.writeText?.(report);
                } catch {}
              } catch (e) {
                const el = document.getElementById("storage-diag-output");
                if (el) el.textContent = "진단 실패: " + (e?.message || e);
              }
            }}
            className="w-full px-3 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition"
          >
            🔍 진단 실행 + 결과 복사
          </button>
          <pre
            id="storage-diag-output"
            className="mt-3 whitespace-pre-wrap break-all text-[10px] text-slate-300 bg-black/40 rounded-lg p-2 max-h-80 overflow-auto"
          ></pre>
        </section>

        {/* ─── 위험한 작업 ─── */}
        <section className="rounded-2xl bg-red-950/30 border border-red-800/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-red-300">
              ⚠️ 위험한 작업
            </span>
          </div>
          <p className="text-[11px] text-red-300/80 mb-3 leading-relaxed">
            아래 버튼을 누르면 <b>모든 저장 데이터가 영구 삭제</b>됩니다:
            <br />
            ZIP 파일, 인원 정보, 공휴일, 일일 변경사항, 강조 색상, 그룹 설정 등
            모두. 초기화 후에는 설정 마법사가 다시 실행됩니다.
          </p>
          <button
            type="button"
            onClick={() => onResetAll?.()}
            className="w-full px-3 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition"
          >
            🗑️ 모든 데이터 초기화
          </button>
        </section>
      </div>
    </div>
  );
}

function TsvEditorSection({
  selectedDepot,
  currentTableText,
  setTablesByDepot,
  buildGyodaeTable,
  onUpload,
  tsvOpen,
  setTsvOpen,
}) {
  const [draft, setDraft] = React.useState(currentTableText || "");
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    setDraft(currentTableText || "");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDepot]);

  React.useEffect(() => {
    if (dirty) return;
    setDraft(currentTableText || "");
  }, [currentTableText, dirty]);

  const onDraftChange = (v) => {
    setDraft(v);
    if (v !== (currentTableText || "")) setDirty(true);
    else setDirty(false);
  };

  const apply = () => {
    setTablesByDepot((prev) => ({ ...(prev || {}), [selectedDepot]: draft }));
    setDirty(false);
  };

  const discard = () => {
    setDraft(currentTableText || "");
    setDirty(false);
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      setDraft(text);
      setDirty(true);
    } catch {}
    e.target.value = "";
  };

  return (
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
          {selectedDepot} 편집용 {dirty ? "· 미저장 변경 있음" : ""}
        </span>
      </button>
      {tsvOpen && (
        <div className="p-4 border-t border-gray-700/50">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-sm text-gray-300">다이아 표 (업로드/편집)</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 cursor-pointer text-xs">
                <Upload className="w-3.5 h-3.5" />
                CSV/TSV
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="hidden"
                  onChange={handleFile}
                />
              </label>
            </div>
          </div>

          {selectedDepot === "교대" && buildGyodaeTable && (
            <div className="mb-2">
              <button
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white"
                onClick={() => {
                  setDraft(buildGyodaeTable());
                  setDirty(true);
                }}
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
            className={
              "w-full bg-gray-900 rounded-xl p-3 font-mono text-[10px] whitespace-pre overflow-x-auto resize-none outline-none " +
              (dirty
                ? "ring-2 ring-amber-500/60"
                : "ring-1 ring-gray-700/60 focus:ring-2 focus:ring-cyan-500")
            }
            rows={Math.max(10, (draft || "").split("\n").length + 2)}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            spellCheck={false}
          />

          <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
            <div className="text-[11px] text-gray-400">
              {dirty ? (
                <span className="text-amber-300">
                  ⚠ 변경사항이 아직 반영되지 않았습니다 — 적용을 눌러주세요
                </span>
              ) : (
                <span>편집 후 "적용" 을 눌러야 캘린더/교번에 반영됩니다</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!dirty}
                onClick={discard}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-xs text-gray-100"
              >
                되돌리기
              </button>
              <button
                type="button"
                disabled={!dirty}
                onClick={apply}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs text-white font-semibold"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
