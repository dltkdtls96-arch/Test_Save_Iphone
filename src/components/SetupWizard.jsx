/**
 * SetupWizard.jsx
 *
 * 앱 최초 진입 / 재설정 시 표시되는 초기설정 마법사
 *
 * 흐름:
 *   Step 1. 데이터 방식 선택  (TSV / ZIP)
 *   Step 2a. [ZIP]  ZIP 파일 등록
 *   Step 2b. [TSV]  행로표 ZIP 등록 (이미지용)  ← 선택사항
 *   Step 3. 소속 선택
 *   Step 4. 오늘 내 교번 선택
 *   Step 5. 완료
 *
 * Props:
 *   onComplete(result)  설정 완료 콜백
 *     result = {
 *       mode        : "tsv" | "zip",
 *       depot       : string,
 *       myName      : string,      // ZIP 모드만
 *       myCode      : string,      // 오늘 교번코드
 *       anchorDate  : string,      // "YYYY-MM-DD"
 *       commonMap   : object,      // { as: CommonDepotData, ... }
 *     }
 *
 *   existingTsvData   기존 TSV 기반 데이터 (TSV 모드 재설정 시 미리 채워짐)
 *   defaultDepot      초기 소속값
 */

import React, { useState, useRef } from "react";
import {
  loadZipToCommonMap,
  saveCommonDataToDB,
  saveZipBlobToDB,
  ZIP_KEY_TO_DEPOT,
  displayCode,
  isNightCode,
  isOffCode,
  getCodeForDate,
  rebaseDepotToToday,
} from "../dataEngine";

// 소속 → ZIP key
const DEPOT_TO_KEY = {
  안심: "as",
  월배: "wb",
  경산: "ks",
  문양: "my",
};
const ALL_DEPOTS = ["안심", "월배", "경산", "문양"];

// ⭐ 통합 교번 데이터 ZIP 다운로드 URL
// (4개 소속 통합본 — 안심/월배/경산/문양)
// TODO: 데이터가 업데이트되면 이 URL만 바꾸면 됨
const DATA_DOWNLOAD_URL =
  "https://github.com/dltkdtls96-arch/Test_Save_Iphone/releases/latest/download/GB_data_2호선AI다이아.zip";

// 오늘 날짜 (로컬)
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

// 교번 코드 색상 클래스
function codeColorClass(depot, code) {
  if (isOffCode(code)) return "text-gray-400";
  if (isNightCode(depot, code)) return "text-sky-300";
  return "text-yellow-300";
}

export default function SetupWizard({
  onComplete,
  existingTsvData,
  defaultDepot = "안심",
}) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState(null); // "tsv" | "zip"

  // ZIP 관련
  const [zipLoading, setZipLoading] = useState(false);
  const [zipError, setZipError] = useState("");
  const [commonMap, setCommonMap] = useState(null); // ZIP 파싱 결과
  const [zipFileName, setZipFileName] = useState("");

  // 행로표 전용 ZIP (TSV 모드)
  const [pathZipLoading, setPathZipLoading] = useState(false);
  const [pathZipDone, setPathZipDone] = useState(false);
  const [pathCommonMap, setPathCommonMap] = useState(null);
  const [pathZipFileName, setPathZipFileName] = useState("");

  // 소속 / 이름 / 교번
  const [depot, setDepot] = useState(defaultDepot);
  const [myName, setMyName] = useState("");
  const [myCode, setMyCode] = useState("");

  const zipInputRef = useRef(null);
  const pathZipInputRef = useRef(null);

  // ─────────────────────────────────────────
  //  Step 2a: ZIP 파일 등록
  // ─────────────────────────────────────────
  async function handleZipUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setZipLoading(true);
    setZipError("");
    try {
      const map = await loadZipToCommonMap(file);
      if (!Object.keys(map).length)
        throw new Error("ZIP 안에 유효한 데이터가 없습니다.");
      await saveZipBlobToDB(file, file.name);
      await saveCommonDataToDB(map);
      setCommonMap(map);
      setZipFileName(file.name);
      setStep(3);
    } catch (err) {
      setZipError(err.message || "ZIP 파일을 읽는 중 오류가 발생했습니다.");
    } finally {
      setZipLoading(false);
      e.target.value = "";
    }
  }

  // ─────────────────────────────────────────
  //  Step 2b: 행로표 ZIP 등록 (TSV 모드)
  // ─────────────────────────────────────────
  async function handlePathZipUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPathZipLoading(true);
    setZipError("");
    try {
      const map = await loadZipToCommonMap(file);
      await saveZipBlobToDB(file, file.name);
      // paths 만 추출해서 저장
      await saveCommonDataToDB({ ...existingTsvData, _pathsOnly: map });
      setPathCommonMap(map);
      setPathZipFileName(file.name);
      setPathZipDone(true);
    } catch (err) {
      setZipError(err.message || "ZIP 파일 오류");
    } finally {
      setPathZipLoading(false);
      e.target.value = "";
    }
  }

  // ─────────────────────────────────────────
  //  Step 3 → 4: 소속 선택 후 이름/교번 선택
  // ─────────────────────────────────────────
  const activeCommonMap =
    mode === "zip" ? commonMap : pathCommonMap || existingTsvData;
  const depotKey = DEPOT_TO_KEY[depot] || depot;
  const depotData = activeCommonMap?.[depotKey];

  // 해당 소속의 이름 목록
  const nameList = depotData?.names?.filter(Boolean) || [];

  // 오늘 날짜 기준 교번 목록 (전체 gyobun 그대로 — 사람이 "오늘 내 교번이 뭐야?" 선택)
  const gyobunList = depotData?.gyobun || [];

  // ZIP 모드: 이름 선택 시 오늘 교번 자동 계산 (기존 이름만)
  function handleNameSelect(name) {
    setMyName(name);
    if (mode === "zip" && depotData && nameList.includes(name)) {
      // 기존 이름이면 info.txt 기준으로 오늘 교번 미리 계산해서 기본값 제안
      const today = todayStr();
      const code = getCodeForDate(depotData, name, today);
      setMyCode(code || "");
    } else {
      // 새 이름이면 사용자가 직접 오늘 교번 선택해야 함
      setMyCode("");
    }
  }

  // ─────────────────────────────────────────
  //  완료
  // ─────────────────────────────────────────
  function handleComplete() {
    if (!myCode) return;
    const today = todayStr();

    const key = DEPOT_TO_KEY[depot] || depot;
    let effectiveCommonMap = commonMap;

    if (mode === "zip" && commonMap) {
      // 🔑 모든 기지를 각자 info.txt (baseDate/baseName/baseCode) 기준으로
      //    "오늘 배치" 로 재정렬한다. 내 기지만 돌리고 말면 다른 기지 화면에서
      //    이름↔교번이 어긋난다 (버그 재발 방지).
      const rebuilt = {};
      for (const [k, dv] of Object.entries(commonMap)) {
        if (!dv || typeof dv !== "object") {
          rebuilt[k] = dv;
          continue;
        }
        rebuilt[k] = rebaseDepotToToday(dv, today);
      }

      // 새 이름 주입: 선택한 기지의 myCode 자리에 myName (덮어쓰기)
      // — 다른 기지에는 적용하지 않는다.
      const myData = rebuilt[key];
      if (
        myName &&
        myData?.names?.length &&
        myData?.gyobun?.length &&
        !myData.names.includes(myName)
      ) {
        const codeIdx = myData.gyobun.findIndex(
          (c) => c.trim().toLowerCase() === myCode.trim().toLowerCase()
        );
        if (codeIdx >= 0) {
          const newNames = [...myData.names];
          const newPhones = [...(myData.phones || [])];
          while (newPhones.length < newNames.length) newPhones.push("");
          newNames[codeIdx] = myName;
          newPhones[codeIdx] = "";

          // baseName 도 baseCodeIdx 자리 이름으로 다시 계산
          // (myCode == baseCode 인 경우 baseName 이 myName 으로 바뀌어야 함)
          const norm = (s) => String(s || "").replace(/\s+/g, "");
          const baseCodeIdx = myData.baseCode
            ? myData.gyobun.findIndex(
                (c) =>
                  String(c || "")
                    .trim()
                    .toLowerCase() ===
                  String(myData.baseCode || "")
                    .trim()
                    .toLowerCase()
              )
            : -1;
          const newBaseName =
            baseCodeIdx >= 0 && baseCodeIdx < newNames.length
              ? newNames[baseCodeIdx]
              : myData.baseName;

          rebuilt[key] = {
            ...myData,
            names: newNames,
            phones: newPhones,
            baseName: newBaseName,
          };
          // norm 은 lint용 참조 흔적 — 실제로는 위에서 쓰지 않음
          void norm;
        }
      }

      effectiveCommonMap = rebuilt;

      // 로그: 선택한 기지 배치 확인
      const chk = rebuilt[key];
      if (chk?.gyobun && chk?.names) {
        console.log(
          "[Wizard] 샘플 (gyobun=namesToday):",
          chk.gyobun.slice(0, 12).map((c, i) => `${c}=${chk.names[i]}`)
        );
      }
    }

    const finalCommonMap =
      mode === "zip"
        ? effectiveCommonMap
        : { ...(existingTsvData || {}), _pathsOnly: pathCommonMap };

    onComplete({
      mode,
      depot,
      myName,
      myCode,
      anchorDate: today,
      commonMap: finalCommonMap,
    });
  }

  // ─────────────────────────────────────────
  //  렌더
  // ─────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex items-start justify-center pt-10 px-4">
      <div className="w-full max-w-md bg-gray-800 rounded-2xl shadow-xl p-5">
        {/* 진행 표시 */}
        <div className="flex items-center gap-1 mb-5">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                step >= n ? "bg-indigo-500" : "bg-gray-700"
              }`}
            />
          ))}
        </div>

        {/* ── Step 1: 방식 선택 ── */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-bold mb-1">교번 데이터 등록</h2>
            <p className="text-xs text-gray-400 mb-4">
              어떤 방식으로 교번 데이터를 사용할지 선택하세요.
            </p>

            {/* ⭐ 교번 데이터 다운로드 안내 — 최상단 항상 표시 */}
            <div className="mb-5 p-4 rounded-xl bg-emerald-600/20 border-2 border-emerald-400/60 shadow-lg shadow-emerald-900/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">💡</span>
                <span className="text-sm font-bold text-emerald-100">
                  교번 데이터 파일이 없으신가요?
                </span>
              </div>
              <p className="text-xs text-gray-300 mb-3 leading-relaxed">
                처음 사용하시거나 ZIP 파일이 없다면, 아래 버튼으로
                <br />
                통합 교번 데이터를 먼저 다운받으세요.
              </p>
              <a
                href={DATA_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold transition shadow-md"
              >
                <span>📥</span>
                <span>교번 데이터 다운받기</span>
                <span className="opacity-70">↗</span>
              </a>
              <p className="mt-2 text-[11px] text-gray-400 text-center">
                * 안심 / 월배 / 경산 / 문양 4개 소속 통합본
              </p>
            </div>

            {/* 구분선 */}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 h-px bg-gray-700" />
              <span className="text-[11px] text-gray-500">
                파일 준비됐다면 ↓
              </span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>

            <button
              className="w-full mb-3 p-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-left transition"
              onClick={() => {
                setMode("zip");
                setStep(2);
              }}
            >
              <div className="font-semibold text-base mb-1">
                📦 ZIP 파일 방식{" "}
                <span className="text-xs bg-indigo-400/30 px-1.5 py-0.5 rounded ml-1">
                  추천
                </span>
              </div>
              <div className="text-xs text-indigo-200">
                파일 한 번만 등록하면 끝.
                <br />
                교번·출퇴근시간·행로표 이미지 모두 자동 포함.
              </div>
            </button>

            <button
              className="w-full p-4 rounded-xl bg-gray-700 hover:bg-gray-600 text-left transition"
              onClick={() => {
                setMode("tsv");
                setStep(2);
              }}
            >
              <div className="font-semibold text-base mb-1">
                📄 TSV 방식 (기존)
              </div>
              <div className="text-xs text-gray-400">
                기존처럼 표 붙여넣기로 사용.
                <br />
                행로표 이미지는 ZIP으로 별도 등록 가능.
              </div>
            </button>
          </div>
        )}

        {/* ── Step 2a: ZIP 업로드 ── */}
        {step === 2 && mode === "zip" && (
          <div>
            <h2 className="text-lg font-bold mb-1">ZIP 파일 등록</h2>
            <p className="text-xs text-gray-400 mb-5">
              교번 데이터가 담긴 ZIP 파일을 선택하세요.
              <br />한 번만 등록하면 이후 자동으로 불러옵니다.
            </p>

            {zipError && (
              <div className="mb-3 p-3 rounded-xl bg-red-900/50 text-red-300 text-xs">
                {zipError}
              </div>
            )}

            {zipFileName && (
              <div className="mb-3 p-3 rounded-xl bg-green-900/40 text-green-300 text-xs">
                ✅ {zipFileName} 등록 완료
              </div>
            )}

            <label className="block w-full">
              <div
                className={`w-full p-4 rounded-xl border-2 border-dashed text-center cursor-pointer transition
                ${
                  zipLoading
                    ? "border-gray-600 text-gray-500"
                    : "border-indigo-500 hover:border-indigo-400 text-indigo-300"
                }`}
              >
                {zipLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    파일 읽는 중...
                  </div>
                ) : (
                  <>
                    <div className="text-2xl mb-1">📦</div>
                    <div className="font-medium">ZIP 파일 선택</div>
                    <div className="text-xs text-gray-500 mt-1">.zip 파일</div>
                  </>
                )}
              </div>
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleZipUpload}
                disabled={zipLoading}
              />
            </label>

            <button
              className="mt-4 w-full py-2 rounded-xl bg-gray-700 text-gray-400 text-sm"
              onClick={() => setStep(1)}
            >
              ← 뒤로
            </button>
          </div>
        )}

        {/* ── Step 2b: TSV 모드 행로표 ZIP ── */}
        {step === 2 && mode === "tsv" && (
          <div>
            <h2 className="text-lg font-bold mb-1">행로표 이미지 등록</h2>
            <p className="text-xs text-gray-400 mb-5">
              행로표 이미지가 담긴 ZIP 파일을 등록하세요.
              <br />
              <span className="text-gray-500">
                건너뛰면 행로표 이미지가 표시되지 않습니다.
              </span>
            </p>

            {zipError && (
              <div className="mb-3 p-3 rounded-xl bg-red-900/50 text-red-300 text-xs">
                {zipError}
              </div>
            )}

            {pathZipDone && (
              <div className="mb-3 p-3 rounded-xl bg-green-900/40 text-green-300 text-xs">
                ✅ {pathZipFileName} 등록 완료
              </div>
            )}

            <label className="block w-full mb-3">
              <div
                className={`w-full p-4 rounded-xl border-2 border-dashed text-center cursor-pointer transition
                ${
                  pathZipLoading
                    ? "border-gray-600 text-gray-500"
                    : "border-cyan-500 hover:border-cyan-400 text-cyan-300"
                }`}
              >
                {pathZipLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                    파일 읽는 중...
                  </div>
                ) : (
                  <>
                    <div className="text-2xl mb-1">🗺️</div>
                    <div className="font-medium">행로표 ZIP 선택</div>
                    <div className="text-xs text-gray-500 mt-1">.zip 파일</div>
                  </>
                )}
              </div>
              <input
                ref={pathZipInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handlePathZipUpload}
                disabled={pathZipLoading}
              />
            </label>

            <button
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm transition"
              onClick={() => setStep(3)}
            >
              {pathZipDone ? "다음 →" : "건너뛰고 다음 →"}
            </button>

            <button
              className="mt-3 w-full py-2 rounded-xl bg-gray-700 text-gray-400 text-sm"
              onClick={() => setStep(1)}
            >
              ← 뒤로
            </button>
          </div>
        )}

        {/* ── Step 3: 소속 선택 ── */}
        {step === 3 && (
          <div>
            <h2 className="text-lg font-bold mb-1">내 소속 선택</h2>
            <p className="text-xs text-gray-400 mb-5">
              소속 차고지를 선택하세요.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {ALL_DEPOTS.map((d) => {
                const key = DEPOT_TO_KEY[d];
                const available = !!(mode === "zip" ? commonMap?.[key] : true);
                return (
                  <button
                    key={d}
                    disabled={!available}
                    onClick={() => {
                      setDepot(d);
                      setMyName("");
                      setMyCode("");
                      setStep(4);
                    }}
                    className={`p-4 rounded-xl text-center font-semibold text-base transition
                      ${depot === d ? "ring-2 ring-indigo-400" : ""}
                      ${
                        available
                          ? "bg-gray-700 hover:bg-gray-600"
                          : "bg-gray-800 text-gray-600 cursor-not-allowed"
                      }`}
                  >
                    {d}
                    {!available && (
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        데이터 없음
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              className="mt-5 w-full py-2 rounded-xl bg-gray-700 text-gray-400 text-sm"
              onClick={() => setStep(mode === "zip" ? 2 : 2)}
            >
              ← 뒤로
            </button>
          </div>
        )}

        {/* ── Step 4: 오늘 교번 선택 ── */}
        {step === 4 && (
          <div>
            <h2 className="text-lg font-bold mb-0.5">오늘 내 교번</h2>
            <p className="text-xs text-gray-400 mb-4">
              {todayStr()} 오늘 날짜 기준으로 내 교번을 선택하세요.
            </p>

            {/* ZIP 모드: 이름 먼저 선택 → 교번 자동 제안 */}
            {mode === "zip" && nameList.length > 0 && (
              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1 block">
                  내 이름
                  <span className="ml-2 text-[10px] text-gray-500">
                    (목록에서 선택하거나 직접 입력)
                  </span>
                </label>
                <input
                  list="wizard-namelist"
                  className="w-full bg-gray-700 rounded-xl px-3 py-2 text-sm"
                  placeholder="이름 입력..."
                  value={myName}
                  onChange={(e) => handleNameSelect(e.target.value)}
                />
                <datalist id="wizard-namelist">
                  {nameList.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                {myName && !nameList.includes(myName) && (
                  <div className="mt-1.5 p-2 rounded-lg bg-emerald-900/30 border border-emerald-500/40 text-[11px] text-emerald-200">
                    💡 "<b>{myName}</b>"는 새 이름입니다. 목록에 있는 사람 중
                    누구의 자리를 대체할지 "오늘 교번"을 선택하면 자동
                    반영됩니다.
                  </div>
                )}
              </div>
            )}

            {/* 교번 그리드 선택 */}
            <label className="text-xs text-gray-400 mb-2 block">
              오늘 교번 선택
              {myCode && (
                <span className="ml-2 text-indigo-300 font-semibold">
                  현재: {displayCode(myCode)}
                </span>
              )}
            </label>

            <div
              className="grid gap-1.5 mb-4"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
              }}
            >
              {gyobunList.map((code, idx) => {
                const isSelected = myCode === code;
                const colorCls = codeColorClass(depot, code);
                return (
                  <button
                    key={`${code}-${idx}`}
                    onClick={() => setMyCode(code)}
                    className={`relative py-2 px-1 rounded-lg text-xs font-bold text-center transition-all duration-150
        ${
          isSelected
            ? "ring-2 ring-indigo-300 bg-indigo-600 scale-110 shadow-lg shadow-indigo-500/50 z-10 !text-white"
            : `bg-gray-700 hover:bg-gray-600 ${colorCls}`
        }`}
                  >
                    {displayCode(code)}
                    {isSelected && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white rounded-full flex items-center justify-center text-indigo-600 text-[9px] font-black shadow">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 직접 날짜로도 확인 가능 */}
            <div className="text-[11px] text-gray-500 mb-4">
              💡 헷갈리면 오늘 근무표에서 교번 번호를 확인하세요.
            </div>

            <button
              disabled={!myCode || (mode === "zip" && !myName)}
              onClick={handleComplete}
              className={`w-full py-3 rounded-xl font-semibold text-sm transition
                ${
                  myCode
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                    : "bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
            >
              완료 →
            </button>

            <button
              className="mt-3 w-full py-2 rounded-xl bg-gray-700 text-gray-400 text-sm"
              onClick={() => setStep(3)}
            >
              ← 뒤로
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
