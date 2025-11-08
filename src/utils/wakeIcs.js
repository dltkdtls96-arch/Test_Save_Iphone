// /src/utils/wakeIcs.js
// 교번 캘린더 → "기상 알람"용 ICS 파일 생성/다운로드 유틸

const CRLF = "\r\n";
const TZID = "Asia/Seoul";

// iOS/안드/구글/애플 캘린더 호환 위해 VTIMEZONE 동봉(한국은 DST 없음)
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "X-LIC-LOCATION:Asia/Seoul",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0900",
  "TZOFFSETTO:+0900",
  "TZNAME:KST",
  "DTSTART:19700101T000000",
  "END:STANDARD",
  "END:VTIMEZONE",
].join(CRLF);

const pad = (n) => String(n).padStart(2, "0");
const fmtLocal = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const dtstampUTC = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

const uid = () => Math.random().toString(36).slice(2) + "@gyobeon.app";

/**
 * @param {Object} opts
 * @param {string} opts.myName              - 사용자 이름
 * @param {Date[]} opts.days                - 생성 대상 날짜들(보통 앞으로 N일)
 * @param {(name: string, date: Date) => Date|null} opts.getInTimeFor
 * @param {number} opts.prepHours           - 출근 몇 시간 전(소수 가능, 예 1.5)
 * @param {string} [opts.summaryPrefix]     - SUMMARY 앞머리 텍스트
 * @returns {Blob} iCalendar blob
 */
export function buildWakeICS({
  myName,
  days,
  getInTimeFor,
  prepHours,
  summaryPrefix = "기상 알람",
}) {
  const prepMin = Math.round((prepHours ?? 1) * 60);

  let ics =
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Gyobeon//Wake Alarms//KR",
      "CALSCALE:GREGORIAN",
      VTIMEZONE,
    ].join(CRLF) + CRLF;

  const now = Date.now();

  for (const date of days) {
    const tIn = getInTimeFor(myName, date);
    if (!tIn) continue; // 근무 없는 날 스킵

    const wake = new Date(tIn.getTime() - prepMin * 60000);
    if (wake.getTime() <= now) continue; // 이미 지난 시각 스킵

    const DTSTART = fmtLocal(wake);
    const DTSTAMP = dtstampUTC();
    const hhmm = `${pad(tIn.getHours())}:${pad(tIn.getMinutes())}`;

    ics +=
      [
        "BEGIN:VEVENT",
        `UID:${uid()}`,
        `DTSTAMP:${DTSTAMP}`,
        `SUMMARY:${summaryPrefix} (${myName})`,
        `DESCRIPTION:일어나세요! 출근 ${hhmm}`,
        `DTSTART;TZID=${TZID}:${DTSTART}`,
        `DTEND;TZID=${TZID}:${DTSTART}`, // 0분 이벤트
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:기상 알림",
        "TRIGGER:PT0S", // 이벤트 시작 즉시 표시
        "END:VALARM",
        "END:VEVENT",
      ].join(CRLF) + CRLF;
  }

  ics += "END:VCALENDAR" + CRLF;
  return new Blob([ics], { type: "text/calendar;charset=utf-8" });
}

export function downloadWakeICSFile(blob, filename = "wake.ics") {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;

  // iOS Safari는 a.download 무시하는 경우가 있어 open()도 함께 시도
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      window.open(url, "_blank");
    } catch {}
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 20);
}

/** 앞으로 n일 배열 */
export function nextDays(n = 60) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return Array.from(
    { length: n },
    (_, i) => new Date(base.getTime() + i * 86400000)
  );
}
