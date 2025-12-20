// /project/workspace/src/App.jsx

//import React, { useEffect, useMemo, useState } from "react";
// App.jsx 최상단 import들 아래

import React, { useEffect, useMemo, useState, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
// icons
import { AlarmCheckIcon, Route as RouteIcon } from "lucide-react";
import WakeIcsPanel from "./components/WakeIcsPanel";
import WakeMidPanel from "./components/WakeMidPanel";
import "./App.css";

const SettingsView = React.lazy(() => import("./SettingsView"));

function usePortraitOnly() {
  const getPortrait = () =>
    typeof window !== "undefined"
      ? window.matchMedia?.("(orientation: portrait)")?.matches ??
        window.innerHeight >= window.innerWidth
      : true;

  const [isPortrait, setIsPortrait] = useState(getPortrait);

  useEffect(() => {
    const mm = window.matchMedia?.("(orientation: portrait)");
    const onChange = () => setIsPortrait(getPortrait());

    // iOS PWA 대응: resize, orientationchange, visualViewport
    window.addEventListener("resize", onChange, { passive: true });
    window.addEventListener("orientationchange", onChange, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onChange, { passive: true });

    // matchMedia 리스너
    if (mm?.addEventListener) mm.addEventListener("change", onChange);

    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
      vv?.removeEventListener("resize", onChange);
      if (mm?.removeEventListener) mm.removeEventListener("change", onChange);
    };
  }, []);

  // 가로일 땐 스크롤/인터랙션 잠금
  useEffect(() => {
    if (!isPortrait) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
  }, [isPortrait]);

  return isPortrait;
}

function LandscapeOverlay() {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black text-white"
      style={{ touchAction: "none" }}
    >
      <div className="px-6 py-5 text-center">
        <div className="text-2xl font-semibold mb-2">세로 모드만 지원해요</div>
        <div className="text-sm text-gray-300">기기를 세로로 돌려주세요.</div>
      </div>
    </div>
  );
}

import { createPortal } from "react-dom";

// ✅ 행로표 이미지 자동 스캔 (Vite 전용)
import {
  Calendar as CalendarIcon,
  Settings,
  List,
  User,
  Users,
  Upload,
} from "lucide-react";

/** ======================================================
 *  표 포맷 (CSV/TSV)
 *  순번, 이름, dia, 평일출근, 평일퇴근, 토요일출근, 토요일퇴근, 휴일출근, 휴일퇴근
 *
 *  규칙:
 *  - 일요일은 자동 '휴'
 *  - 야간: dia 숫자 >= nightDiaThreshold → 출근은 당일 타입 in, 퇴근은 "다음날" 타입 out
 *  - 공휴일(설정) 입력 시 해당 날짜는 '휴'
 *  - 회전: "기준일"을 기준으로 날짜가 하루 지나면 표의 다음 순번 행을 사용
 * ====================================================== */

// /project/workspace/src/App.jsx

const STORAGE_KEY = "workCalendarSettingsV3"; // 기존이 V3였다면 버전 한번 올려
const DATA_VERSION = 2; // 🔹 사람테이블/행로표 구조 바꾸면 2,3.. 이렇게 숫자 올리기

// 소속 정규화 (월배/월베/wol 다 월배로)
const normalizeDepot = (v = "") => {
  const s = String(v).trim().toLowerCase();
  if (["월배", "월베", "wol", "wolbae", "wol-bae"].includes(s)) return "월배";
  if (["안심", "ansim"].includes(s)) return "안심";
  return v || "안심";
};

// 소속별 버스 시간표 이미지 매핑 (public 폴더 기준 경로)
const BUS_IMAGE_BY_DEPOT = {
  안심: "/bus/timetable.png",
  월배: "/bus/wolbus.png",
};

function getBusImageSrc(depot) {
  return BUS_IMAGE_BY_DEPOT[depot] || "/bus/timetable.png";
}

function prevNightTag(yDiaNum, yPrevLabel, threshold) {
  // 1) 전날이 숫자형이고 기준 이상 → "25~"
  if (Number.isFinite(yDiaNum) && yDiaNum >= threshold) return `${yDiaNum}~`;

  // 2) 전날이 '대n' 형태이고 n이 기준 이상 → "대5~"
  if (typeof yPrevLabel === "string") {
    // 🔹 공백/기호 제거하고 숫자만 추출
    const clean = yPrevLabel.replace(/\s/g, "").trim(); // "대5 ", "대 5" → "대5"
    const num = Number(clean.replace(/[^0-9]/g, "")); // "대5" → 5
    const prefix = clean.replace(/[0-9]/g, ""); // "대5" → "대"
    // (변경) 임계값과 무관하게 '대n'이면 ~
    if (prefix === "대" && Number.isFinite(num)) {
      return `대${num}~`;
    }
  }

  // 그 외는 "비번"
  return "비번";
}

// 소속(차고/센터)
const DEPOTS = ["안심", "월배", "경산", "문양", "교대"];

// 숫자 DIA만 정수로, 아니면 NaN
const toDiaNum = (dia) => {
  const n = Number(dia);
  return Number.isFinite(n) ? n : NaN;
};

const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];
const getYesterday = (date) => {
  const t = new Date(date);
  t.setDate(t.getDate() - 1);
  return t;
};

// 소속별 샘플 테이블 (헤더 동일, 1~10, 이름 a~j)
function sampleTableFor(depot) {
  const header =
    "순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근";

  const rows = [
    "1\ta\t1\t06:00\t14:00\t06:00\t14:00\t06:00\t14:00",
    "2\tb\t3\t07:00\t15:00\t07:00\t15:00\t07:00\t15:00",
    "3\tc\t6\t19:00\t10:00\t19:00\t10:00\t19:00\t10:00",
    "4\td\t비번\t\t\t\t\t\t",
    "5\te\t휴\t\t\t\t\t\t",
    "6\tf\t2\t08:00\t16:00\t08:00\t16:00\t08:00\t16:00",
    "7\tg\t4\t09:00\t17:00\t09:00\t17:00\t09:00\t17:00",
    "8\th\t5\t18:00\t09:00\t18:00\t09:00\t18:00\t09:00",
    "9\ti\t비\t\t\t\t\t\t",
    "10\tj\t휴\t\t\t\t\t\t",
  ];

  return [header, ...rows].join("\n");
}
// 교대(갑/을/병) 21일(7+14) 순환 표
// 1~7일: 주(주간) / 8~21일: 야,휴 번갈아
function buildGyodaeTable() {
  const header =
    "순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근";

  const DAY_IN = "09:00",
    DAY_OUT = "18:00";
  const NIGHT_IN = "18:00",
    NIGHT_OUT = "09:00";

  const rows = [];
  for (let i = 1; i <= 21; i++) {
    // 1~7: 주 / 8~: 야(짝수), 휴(홀수)
    const isDay = i <= 7;
    const isNight = !isDay && (i - 8) % 2 === 0; // 8,10,12,14,16,18,20
    const dia = isDay ? "주" : isNight ? "야" : "휴";

    let name = "";
    if (i === 1) name = "갑반";
    if (i === 8) name = "을반";
    if (i === 15) name = "병반"; // ✅ 병반은 15행

    // 시간: 주/야만 채움, 휴는 공란
    let wdIn = "",
      wdOut = "",
      saIn = "",
      saOut = "",
      hoIn = "",
      hoOut = "";
    if (dia === "주") {
      wdIn = saIn = hoIn = DAY_IN;
      wdOut = saOut = hoOut = DAY_OUT;
    } else if (dia === "야") {
      wdIn = saIn = hoIn = NIGHT_IN;
      wdOut = saOut = hoOut = NIGHT_OUT;
    }

    rows.push([i, name, dia, wdIn, wdOut, saIn, saOut, hoIn, hoOut].join("\t"));
  }

  return [header, ...rows].join("\n");
}

const defaultTableTSV = `순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근
1\t신동훈\t4\t6:43\t15:23\t6:55\t16:37\ts4\ts4
2\t홍성민\t14\t9:13\t18:50\t9:29\t19:26\t8:50\t18:44
3\t이성철\t32\t19:39\t10:06\t20:13\t10:37\t20:40\t10:38
4\t강원희\t비번\t\t\t\t\t\t
5\t김치완\t휴1\t\t\t\t\t\t
6\t최병환\t9\t7:23\t18:45\t7:29\t17:41\t7:20\t16:12
7\t이기환\t24\t13:05\t21:41\t13:56\t21:43\t12:42\t21:16
8\t박재민\t대6\t18:00\t9:00\t18:00\t9:00\t18:00\t9:00
9\t박도현\t비번\t\t\t\t\t\t
10\t오중구\t휴2\t\t\t\t\t\t
11\t유용우\t2\t06:35\t15:47\ts2\ts2\ts2\ts2
12\t김찬우\t12\t08:53\t19:33\t09:00\t18:37\t08:05\t17:24
13\t채준호\t26\t17:15\t08:05\t17:15\t08:04\t17:49\t08:05
14\t이상원\t비번\t\t\t\t\t\t
15\t박상현\t휴3\t\t\t\t\t\t
16\t김성탁\t휴4\t\t\t\t\t\t
17\t함일남\t대1\t09:00\t18:00\t09:00\t18:00\t09:00\t18:00
18\t이원준\t16\t09:37\t19:53\t10:33\t20:47\t09:35\t19:19
19\t류기철\t35\t20:03\t10:23\t19:49\t09:34\t19:55\t09:17
20\t김관동\t비번\t\t\t\t\t\t
21\t우진우\t휴5\t\t\t\t\t\t
22\t강동우\t1\t06:31\t14:03\ts1\ts1\ts1\ts1
23\t김호열\t17\t10:25\t20:29\t10:49\t20:55\t09:44\t18:37
24\t엄인철\t30\t19:23\t10:23\t19:17\t10:23\t19:46\t10:20
25\t최동현\t비번\t\t\t\t\t\t
26\t송기중\t휴6\t\t\t\t\t\t
27\t박경섭\t5\t06:50\t16:43\t06:58\t15:57\ts5\ts5
28\t권기석\t15\t09:21\t19:45\t09:45\t19:50\t09:08\t18:20
29\t강유덕\t29\t19:15\t08:53\t19:41\t10:17\t18:43\t09:53
30\t김상수\t비번\t\t\t\t\t\t
31\t권용록\t휴7\t\t\t\t\t\t
32\t구민혁\t휴8\t\t\t\t\t\t
33\t황병두\t대2\t09:00\t18:00\t09:00\t18:00\t09:00\t18:00
34\t이상훈\t20\t11:21\t20:10\t11:37\t21:27\t11:05\t20:49
35\t김성열\t36\t20:11\t08:32\t20:05\t08:36\t20:13\t08:32
36\t허준석\t비번\t\t\t\t\t\t
37\t이상욱\t휴9\t\t\t\t\t\t
38\t김경구\t3\t06:41\t14:19\t06:50\t15:06\ts3\ts3
39\t임대기\t13\t09:06\t19:10\t09:07\t17:01\t08:23\t17:48
40\t조덕헌\t27\t17:20\t08:48\t18:53\t08:52\t18:07\t08:50
41\t권혁기\t비번\t\t\t\t\t\t
42\t김희준\t휴10\t\t\t\t\t\t
43\t박형민\t11\t07:58\t19:22\t08:53\t19:00\t07:47\t17:32
44\t임병길\t18\t10:41\t21:01\t10:57\t20:21\t10:20\t19:37
45\t박종률\t31\t19:31\t08:58\t19:25\t08:44\t19:19\t08:41
46\t강병웅\t비번\t\t\t\t\t\t
47\t이성재\t휴11\t\t\t\t\t\t
48\t이재헌\t휴12\t\t\t\t\t\t
49\t박문우\t대3\t09:00\t18:00\t09:00\t18:00\t09:00\t18:00
50\t문경주\t21\t11:29\t21:17\t11:40\t20:04\t11:22\t21:07
51\t윤영준\t37\t21:07\t07:47\t21:01\t07:47\t20:58\t07:47
52\t김종규\t비번\t\t\t\t\t\t
53\t한남권\t휴13\t\t\t\t\t\t
54\t이근수\t6\t06:56\t16:11\t07:06\t15:26\ts6\ts6
55\t김종훈\t23\t12:49\t21:33\t13:42\t21:11\t12:10\t21:25
56\t조재훈\t25\t16:35\t08:26\t16:34\t08:28\t16:50\t09:35
57\t강근영\t비번\t\t\t\t\t\t
58\t이희한\t휴14\t\t\t\t\t\t
59\t이재문\t7\t07:02\t16:51\t07:14\t17:09\t06:53\t16:36
60\t강인구\t대4\t09:00\t18:00\t09:00\t18:00\t09:00\t18:00
61\t최우용\t19\t10:57\t20:45\t11:24\t20:23\t10:34\t20:13
62\t진위동\t34\t19:55\t08:13\t20:29\t08:12\t20:22\t08:14
63\t김병재\t비번\t\t\t\t\t\t
64\t이동혁\t휴15\t\t\t\t\t\t
65\t김우년\t10\t07:28\t17:31\t08:04\t18:45\t07:29\t17:24
66\t이원진\t22\t12:17\t21:09\t12:24\t21:35\t11:54\t19:55
67\t이동호\t33\t19:47\t09:28\t19:57\t08:59\t19:37\t08:59
68\t우진하\t비번\t\t\t\t\t\t
69\t왕진섭\t휴16\t\t\t\t\t\t
70\t정범철\t휴17\t\t\t\t\t\t
71\t정호창\t8\t07:18\t17:07\t07:22\t16:29\t07:11\t17:40
72\t김성규\t28\t18:59\t08:20\t17:56\t08:20\t18:25\t08:23
73\t권정진\t비번\t\t\t\t\t\t
74\t이상신\t휴18\t\t\t\t\t\t
75\t백상우\t휴19\t\t\t\t\t\t`;

// 예: 안심 소속용
const wolTableTSV = `순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근
1\t송주영\t대4\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
2\t이석재\t21\t12:19\t20:39\t11:35\t19:57\t11:49\t20:26
3\t구교영\t26\t17:28\t8:43\t18:03\t8:47\t17:26\t8:27
4\t박진욱\t26~\t\t\t\t\t\t
5\t김성곤\t휴1\t\t\t\t\t\t
6\t박재민\t휴2\t\t\t\t\t\t
7\t강민우\t8\t7:24\t18:58\t8:49\t18:55\t7:51\t17:19
8\t신준호\t14\t9:39\t18:33\t10:13\t19:54\t10:06\t17:59
9\t신진용\t31\t19:25\t10:06\t18:27\t10:54\t18:20\t10:46
10\t윤건호\t31~\t\t\t\t\t\t
11\t이기남\t휴3\t\t\t\t\t\t
12\t방승찬\t6\t7:00\t17:18\t7:25\t17:12\tS6\t
13\t오우섭\t17\t10:43\t20:24\t10:45\t20:18\t10:33\t18:56
14\t이수민\t36\t20:21\t9:52\t20:16\t8:55\t20:17\t9:03
15\t조용준\t36~\t\t\t\t\t\t
16\t김경성\t휴4\t\t\t\t\t\t
17\t박일권\t대2\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
18\t이찬열\t22\t12:27\t20:55\t11:41\t20:04\t11:57\t19:41
19\t김성영\t27\t17:43\t8:54\t17:39\t9:02\t17:44\t8:54
20\t김재은\t27~\t\t\t\t\t\t
21\t최영기\t휴5\t\t\t\t\t\t
22\t김은민\t휴6\t\t\t\t\t\t
23\t정재규\t9\t7:34\t17:33\t9:03\t18:24\t8:09\t16:55
24\t권민철\t18\t10:59\t20:23\t10:53\t19:33\t11:09\t19:14
25\t박기범\t34\t19:49\t10:24\t20:08\t10:19\t19:59\t10:51
26\t윤태철\t34~\t\t\t\t\t\t
27\t전중호\t휴7\t\t\t\t\t\t
28\t임병철\t3\t6:45\t16:45\t7:01\t15:36\tS3\t
29\t이재권\t19\t11:15\t20:08\t11:09\t20:18\t11:17\t19:50
30\t김영화\t37\t20:37\t7:59\t20:32\t7:59\t20:35\t8:00
31\t이준규\t37~\t\t\t\t\t\t
32\t주상열\t휴8\t\t\t\t\t\t
33\t김일호\t대3\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
34\t유재혁\t23\t12:35\t21:03\t12:05\t20:34\t12:13\t19:59
35\t김우석\t28\t17:58\t9:04\t17:51\t8:39\t18:02\t8:45
36\t이기용\t28~\t\t\t\t\t\t
37\t이건호\t휴9\t\t\t\t\t\t
38\t정경길\t휴10\t\t\t\t\t\t
39\t정종현\t7\t7:13\t18:48\t7:39\t17:44\t7:33\t16:39
40\t나운연\t11\t8:54\t19:36\t9:17\t18:08\t9:03\t18:15
41\t윤종호\t33\t19:41\t8:07\t19:36\t9:09\t18:56\t9:39
42\t손정호\t33~\t\t\t\t\t\t
43\t김병대\t휴11\t\t\t\t\t\t
44\t김성원\t2\t6:37\t17:09\tS2\t\tS2\t
45\t이승걸\t15\t9:55\t19:13\t10:21\t19:21\t10:19\t19:05
46\t최재원\t30\t19:17\t8:15\t19:12\t8:15\t19:23\t8:18
47\t임호현\t30~\t\t\t\t\t\t
48\t윤종철\t휴12\t\t\t\t\t\t
49\t최백식\t4\t6:45\t16:53\t7:09\t16:56\tS4\t
50\t오정원\t13\t9:24\t19:28\t9:57\t19:09\t9:39\t18:51
51\t김준영\t대5\t18:00\t9:00\t18:00\t9:00\t18:00\t9:00
52\t김경대\t대5~\t\t\t\t\t\t
53\t김상민\t휴13\t\t\t\t\t\t
54\t최민석\t휴14\t\t\t\t\t\t
55\t임태우\t10\t8:39\t18:43\t9:10\t18:00\t8:31\t17:27
56\t김지훈\t16\t10:27\t19:52\t10:37\t19:15\t10:24\t18:39
57\t유재현\t29\t19:09\t7:33\t16:56\t8:07\t16:45\t9:21
58\t박수현\t29~\t\t\t\t\t\t
59\t박진석\t휴15\t\t\t\t\t\t
60\t이수호\t5\t6:59\t17:01\t7:17\t16:04\tS5\t
61\t김광식\t12\t9:05\t19:21\t9:33\t18:48\t9:21\t17:43
62\t김영대\t25\t16:29\t8:29\t17:25\t8:31\t17:09\t8:36
63\t배성주\t25~\t\t\t\t\t\t
64\t문희철\t휴16\t\t\t\t\t\t
65\t이준규\t대1\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
66\t정인식\t24\t12:51\t21:19\t12:12\t20:42\t12:29\t20:17
67\t오호중\t35\t20:05\t10:09\t20:00\t10:33\t20:26\t11:09
68\t배정\t35~\t\t\t\t\t\t
69\t정강덕\t휴17\t\t\t\t\t\t
70\t권용환\t휴18\t\t\t\t\t\t
71\t김준우\t1\t6:31\t17:25\tS1\t\tS1\t
72\t김영훈\t20\t11:31\t20:00\t11:11\t21:14\t11:41\t19:32
73\t김출달\t32\t19:33\t10:31\t19:44\t10:40\t19:41\t10:33
74\t장은우\t32~\t\t\t\t\t\t
75\t이남석\t휴19\t\t\t\t\t\t`;

const moonTableTSV = `순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근
1\t홍혁수\t2\t6:33\t15:08\t8:37\t16:15\t8:47\t16:31
2\t홍승헌\t12\t8:24\t18:48\t9:57\t18:46\t9:41\t17:35
3\t박소진\t28\t17:58\t8:40\t18:04\t9:11\t17:59\t8:38
4\t은종현\t28~\t\t\t\t\t\t
5\t이기영\t휴1\t\t\t\t\t\t
6\t이광국\t대2\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
7\t김민환\t21\t12:02\t19:52\t11:56\t19:56\t11:41\t19:38
8\t백천웅\t25\t15:43\t8:03\t16:04\t8:07\t16:47\t8:11
9\t이준영\t25~\t\t\t\t\t\t
10\t황인환\t휴2\t\t\t\t\t\t
11\t은종만\t휴3\t\t\t\t\t\t
12\t이준민\t9\t7:28\t16:58\tS1\t\tS3\t
13\t오재욱\t18\t10:34\t19:28\t11:32\t19:10\t10:40\t18:35
14\t김재도\t33\t18:46\t9:54\t18:50\t10:55\t21:00\t10:53
15\t백승훈\t33~\t\t\t\t\t\t
16\t탁혜령\t휴4\t\t\t\t\t\t
17\t김량희\t대1\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
18\t홍진희\t17\t10:18\t19:26\t9:57\t18:46\t9:41\t17:35
19\t허덕영\t30\t18:22\t9:12\t18:26\t10:23\t18:26\t10:17
20\t권기덕\t30~\t\t\t\t\t\t
21\t유섭\t휴5\t\t\t\t\t\t
22\t조유정\t6\t6:53\t16:04\t9:09\t17:58\t9:23\t17:19
23\t김성우\t14\t9:46\t18:58\t10:53\t19:28\t9:57\t17:51
24\t박재용\t24\t14:42\t7:53\t15:25\t7:59\t16:21\t8:02
25\t박수영\t24~\t\t\t\t\t\t
26\t류다연\t휴6\t\t\t\t\t\t
27\t문남철\t5\t6:53\t18:13\t9:01\t17:03\t9:09\t17:03
28\t이승용\t20\t11:54\t19:58\t11:55\t20:12\t11:33\t19:29
29\t최성필\t대5\t18:00\t9:00\t18:00\t9:00\t18:00\t9:00
30\t김기홍\t대5~\t\t\t\t\t\t
31\t윤기륜\t휴7\t\t\t\t\t\t
32\t이재환\t휴8\t\t\t\t\t\t
33\t구자광\t8\t7:10\t16:53\t9:33\t17:52\tS2\t
34\t손대성\t16\t10:00\t19:44\t11:24\t19:48\t10:29\t18:51
35\t김범구\t29\t18:14\t8:58\t18:18\t10:07\t18:17\t8:47
36\t박정호\t29~\t\t\t\t\t\t
37\t강민경\t휴9\t\t\t\t\t\t
38\t추성윤\t3\t6:33\t15:24\t8:40\t17:34\t8:56\t16:47
39\t박진백\t대4\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
40\t안민범\t23\t12:42\t20:16\t12:31\t20:20\t11:57\t19:56
41\t김동규\t휴10\t\t\t\t\t\t
42\t허웅대\t휴11\t\t\t\t\t\t
43\t김형준\t7\t7:04\t16:47\t9:25\t18:10\tS1\t
44\t백운섭\t15\t10:02\t19:28\t11:17\t19:34\t10:21\t18:17
45\t서창교\t32\t18:38\t9:29\t18:42\t10:39\t18:44\t10:35
46\t권삼용\t32~\t\t\t\t\t\t
47\t서병화\t휴12\t\t\t\t\t\t
48\t조재훈\t10\t7:42\t17:13\tS2\t\tS4\t
49\t방지현\t19\t11:06\t19:43\t11:49\t20:04\t11:01\t19:11
50\t장진영\t34\t19:02\t10:01\t18:58\t11:03\t21:10\t11:02
51\t김일규\t34~\t\t\t\t\t\t
52\t최순철\t휴13\t\t\t\t\t\t
53\t이민영\t휴14\t\t\t\t\t\t
54\t황재필\t1\t6:23\t15:16\t7:41\t15:35\t7:39\t15:33
55\t김성은\t11\t7:56\t17:28\t9:41\t18:34\t9:32\t17:27
56\t김창록\t31\t18:30\t9:26\t18:34\t10:31\t20:41\t10:26
57\t조현성\t31~\t\t\t\t\t\t
58\t김창진\t휴15\t\t\t\t\t\t
59\t김승현\t대3\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
60\t정진현\t22\t18:18\t20:00\t12:13\t20:28\t11:49\t19:47
61\t김함규\t27\t17:26\t8:34\t17:28\t8:47\t17:05\t8:29
62\t(공란)\t27~\t\t\t\t\t\t
63\t이동수\t휴16\t\t\t\t\t\t
64\t윤창민\t4\t6:43\t16:12\t8:53\t16:29\t9:05\t16:55
65\t김선도\t13\t8:31\t18:56\t10:21\t18:58\t9:49\t17:43
66\t송성선\t26\t16:43\t8:23\t17:04\t8:23\t16:56\t8:20
67\t오광대\t26~\t\t\t\t\t\t
68\t이상식\t휴17\t\t\t\t\t\t
69\t손동구\t휴18\t\t\t\t\t\t`;

const kyeongTableTSV = `순번\t이름\tdia\t평일출근\t평일퇴근\t토요일출근\t토요일퇴근\t휴일출근\t휴일퇴근
1\t홍혁수\t2\t6:33\t15:08\t8:37\t16:15\t8:47\t16:31
2\t홍승헌\t12\t8:24\t18:48\t9:57\t18:46\t9:41\t17:35
3\t박소진\t28\t17:58\t8:40\t18:04\t9:11\t17:59\t8:38
4\t은종현\t28~\t\t\t\t\t\t
5\t이기영\t휴1\t\t\t\t\t\t
6\t이광국\t대2\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
7\t김민환\t21\t12:02\t19:52\t11:56\t19:56\t11:41\t19:38
8\t백천웅\t25\t15:43\t8:03\t16:04\t8:07\t16:47\t8:11
9\t이준영\t25~\t\t\t\t\t\t
10\t황인환\t휴2\t\t\t\t\t\t
11\t은종만\t휴3\t\t\t\t\t\t
12\t이준민\t9\t7:28\t16:58\tS1\t\tS3\t
13\t오재욱\t18\t10:34\t19:28\t11:32\t19:10\t10:40\t18:35
14\t김재도\t33\t18:46\t9:54\t18:50\t10:55\t21:00\t10:53
15\t백승훈\t33~\t\t\t\t\t\t
16\t탁혜령\t휴4\t\t\t\t\t\t
17\t김량희\t대1\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
18\t홍진희\t17\t10:18\t19:26\t9:57\t18:46\t9:41\t17:35
19\t허덕영\t30\t18:22\t9:12\t18:26\t10:23\t18:26\t10:17
20\t권기덕\t30~\t\t\t\t\t\t
21\t유섭\t휴5\t\t\t\t\t\t
22\t조유정\t6\t6:53\t16:04\t9:09\t17:58\t9:23\t17:19
23\t김성우\t14\t9:46\t18:58\t10:53\t19:28\t9:57\t17:51
24\t최순철\t24\t14:42\t7:53\t15:25\t7:59\t16:21\t8:02
25\t박수영\t24~\t\t\t\t\t\t
26\t류다연\t휴6\t\t\t\t\t\t
27\t문남철\t5\t6:53\t18:13\t9:01\t17:03\t9:09\t17:03
28\t이승용\t20\t11:54\t19:58\t11:55\t20:12\t11:33\t19:29
29\t최성필\t대5\t18:00\t9:00\t18:00\t9:00\t18:00\t9:00
30\t김기홍\t대5~\t\t\t\t\t\t
31\t윤기륜\t휴7\t\t\t\t\t\t
32\t이재환\t휴8\t\t\t\t\t\t
33\t구자광\t8\t7:10\t16:53\t9:33\t17:52\tS2\t
34\t손대성\t16\t10:00\t19:44\t11:24\t19:48\t10:29\t18:51
35\t김범구\t29\t18:14\t8:58\t18:18\t10:07\t18:17\t8:47
36\t박정호\t29~\t\t\t\t\t\t
37\t강민경\t휴9\t\t\t\t\t\t
38\t추성윤\t3\t6:33\t15:24\t8:40\t17:34\t8:56\t16:47
39\t박진백\t대4\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
40\t안민범\t23\t12:42\t20:16\t12:31\t20:20\t11:57\t19:56
41\t김동규\t휴10\t\t\t\t\t\t
42\t허웅대\t휴11\t\t\t\t\t\t
43\t김형준\t7\t7:04\t16:47\t9:25\t18:10\tS1\t
44\t백운섭\t15\t10:02\t19:28\t11:17\t19:34\t10:21\t18:17
45\t서창교\t32\t18:38\t9:29\t18:42\t10:39\t18:44\t10:35
46\t권삼용\t32~\t\t\t\t\t\t
47\t서병화\t휴12\t\t\t\t\t\t
48\t조재훈\t10\t7:42\t17:13\tS2\t\tS4\t
49\t방지현\t19\t11:06\t19:43\t11:49\t20:04\t11:01\t19:11
50\t장진영\t34\t19:02\t10:01\t18:58\t11:03\t21:10\t11:02
51\t김일규\t34~\t\t\t\t\t\t
52\t박재용\t휴13\t\t\t\t\t\t
53\t이민영\t휴14\t\t\t\t\t\t
54\t황재필\t1\t6:23\t15:16\t7:41\t15:35\t7:39\t15:33
55\t김성은\t11\t7:56\t17:28\t9:41\t18:34\t9:32\t17:27
56\t김창록\t31\t18:30\t9:26\t18:34\t10:31\t20:41\t10:26
57\t조현성\t31~\t\t\t\t\t\t
58\t김창진\t휴15\t\t\t\t\t\t
59\t김승현\t대3\t9:00\t18:00\t9:00\t18:00\t9:00\t18:00
60\t정진현\t22\t18:18\t20:00\t12:13\t20:28\t11:49\t19:47
61\t김함규\t27\t17:26\t8:34\t17:28\t8:47\t17:05\t8:29
62\t송병옥\t27~\t\t\t\t\t\t
63\t이동수\t휴16\t\t\t\t\t\t
64\t윤창민\t4\t6:43\t16:12\t8:53\t16:29\t9:05\t16:55
65\t김선도\t13\t8:31\t18:56\t10:21\t18:58\t9:49\t17:43
66\t송성선\t26\t16:43\t8:23\t17:04\t8:23\t16:56\t8:20
67\t오광대\t26~\t\t\t\t\t\t
68\t이상식\t휴17\t\t\t\t\t\t
69\t손동구\t휴18\t\t\t\t\t\t`;

// App.jsx 최상단 상수/유틸 근처
const ansimGlobs = import.meta.glob("./ansim/*.png", {
  eager: true,
  as: "url",
});

// 월배 전용(콤보/숫자 폴더 구조)
const wolGlobs = import.meta.glob("./wol/*/*.{png,jpg,jpeg,webp}", {
  eager: true,
  as: "url",
});

// 문양 전용(월배와 동일 구조)
const moonGlobs = import.meta.glob("./moon/*/*.{png,jpg,jpeg,webp}", {
  eager: true,
  as: "url",
});

// 기존 getRouteImageSrc(key) → getRouteImageSrc(key, depot)로 교체
// 경산 전용 글롭 (이미 추가했다면 생략)
const kyeongGlobs = import.meta.glob("./kyeong/*/*.{png,jpg,jpeg,webp}", {
  eager: true,
  as: "url",
});

const defaultAnchorByDepot = {
  문양: "2025-10-01",
  월배: "2025-11-01",
  안심: "2025-10-01",
  경산: "2025-10-01",
  교대: "2025-09-29",
};

function getRouteImageSrc(key, depot) {
  const m = /^(\d+)dia(.+)$/.exec(key);
  const dia = m ? m[1] : null;
  const combo = m ? m[2] : null;

  const exts = [".png", ".jpg", ".jpeg", ".webp"];
  const findIn = (globs, pathNoExt) => {
    for (const ext of exts) {
      const p = `${pathNoExt}${ext}`;
      if (globs[p]) return globs[p];
    }
    return "";
  };

  // 월배
  if (depot === "월배" && dia && combo) {
    const variants = [
      combo,
      combo.normalize("NFC"),
      combo.normalize("NFD"),
      combo.replaceAll("-", "–"),
      combo.replaceAll("-", "_"),
      combo.replaceAll(" ", ""),
      combo.replaceAll("-", ""),
    ];
    for (const v of variants) {
      const h = findIn(wolGlobs, `./wol/${v}/${dia}`);
      if (h) return h;
    }
    return ""; // ❗ 안심으로 폴백하지 않음
  }

  // 문양
  if (depot === "문양" && dia && combo) {
    const variants = [
      combo,
      combo.normalize("NFC"),
      combo.normalize("NFD"),
      combo.replaceAll("-", "–"),
      combo.replaceAll("-", "_"),
      combo.replaceAll(" ", ""),
      combo.replaceAll("-", ""),
    ];
    for (const v of variants) {
      const h = findIn(moonGlobs, `./moon/${v}/${dia}`);
      if (h) return h;
    }
    return ""; // ❗ 폴백 금지
  }

  // 경산
  if (depot === "경산" && dia && combo) {
    const variants = [
      combo,
      combo.normalize("NFC"),
      combo.normalize("NFD"),
      combo.replaceAll("-", "–"),
      combo.replaceAll("-", "_"),
      combo.replaceAll(" ", ""),
      combo.replaceAll("-", ""),
    ];
    for (const v of variants) {
      const h = findIn(kyeongGlobs, `./kyeong/${v}/${dia}`);
      if (h) return h;
    }
    return ""; // ❗ 폴백 금지
  }

  // 안심만 ansim 폴백 허용
  if (depot === "안심") {
    const base = `./ansim/${key}`;
    const ansFromKey =
      findIn(ansimGlobs, base) ||
      (() => {
        const keys = Object.keys(ansimGlobs);
        const variants = [
          key,
          key.normalize("NFC"),
          key.normalize("NFD"),
          key.replaceAll("-", "-"),
          key.replaceAll("-", "–"),
          key.replaceAll("-", "_"),
          key.replaceAll(" ", ""),
        ];
        for (const v of variants) {
          const h = findIn(ansimGlobs, `./ansim/${v}`);
          if (h) return h;
        }
        const hit = keys.find((k) => k.includes(key));
        return hit ? ansimGlobs[hit] : "";
      })();
    return ansFromKey || "";
  }

  // 그 외(예방)
  return "";
}

/* ---------- 유틸 ---------- */
// ▲ helpers 아래 아무데나 1번만 추가
const SHUTTLE_HM = {
  // 필요하면 네 환경에 맞게 채워 넣어
  // s1: "06:31",
  // s2: "06:35",
  // s3: "06:41",
  // s4: "06:55",
  // s5: "07:02",
};

function toHMorNull(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const hh = +m[1],
    mm = +m[2];
  if (hh < 0 || hh > 23) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeHM(v) {
  const s = String(v ?? "").trim();
  // 1) 이미 HH:MM 이면 그걸 사용
  const hm = toHMorNull(s);
  if (hm) return hm;
  // 2) s1/s2/s3 같은 키를 매핑(있을 때만)
  const mapped = SHUTTLE_HM[s.toLowerCase()];
  return mapped ? toHMorNull(mapped) : null;
}

function fmt(d) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}
// 기존 fmt 아래쪽에 추가
function fmtWithWeekday(date) {
  const tz = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tz);
  const iso = local.toISOString().slice(0, 10);
  const weekday = weekdaysKR[(local.getDay() + 6) % 7]; // ← 일(0)→월(0)로 보정
  return `${iso} (${weekday})`;
}

function stripTime(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function diffDays(a, b) {
  return Math.floor((stripTime(a) - stripTime(b)) / 86400000);
}
function mod(n, m) {
  return ((n % m) + m) % m;
}
function addMonthsSafe(date, months) {
  const d = new Date(date);
  const cm = d.getMonth() + months;
  d.setMonth(cm);
  if (d.getMonth() !== ((cm % 12) + 12) % 12) d.setDate(0);
  return d;
}

function addDaysSafe(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return stripTime(d);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

// ----- helpers (기존 유틸 근처에 추가) -----
function monthGridSunday(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  // JS getDay(): 0=일, 1=월, ... 6=토
  const offset = first.getDay(); // 일요일 시작이면 그대로 0 ~ 6
  start.setDate(first.getDate() - offset);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(stripTime(d));
  }
  return cells;
}

const weekdaysKR = ["월", "화", "수", "목", "금", "토", "일"];
function startOfWeekMonday(d) {
  const day = (d.getDay() + 6) % 7; // 월=0
  const x = new Date(d);
  x.setDate(d.getDate() - day);
  return x;
}
function monthGridMonday(selectedDate) {
  const start = startOfMonth(selectedDate);
  const firstMon = startOfWeekMonday(start);
  const days = [];
  let cur = new Date(firstMon);
  // 항상 6주(=42칸) 보장
  for (let i = 0; i < 42; i++) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
// 기본 공휴일(2025·2026) — 줄바꿈 구분
const DEFAULT_HOLIDAYS_25_26 = `
2025-01-01
2025-01-28
2025-01-29
2025-01-30
2025-03-01
2025-03-03
2025-05-05
2025-06-06
2025-08-15
2025-10-03
2025-10-05
2025-10-06
2025-10-07
2025-10-09
2025-12-25
2026-01-01
2026-02-16
2026-02-17
2026-02-18
2026-03-01
2026-03-02
2026-05-05
2026-05-24
2026-05-25
2026-06-06
2026-08-15
2026-08-17
2026-09-24
2026-09-25
2026-09-26
2026-09-27
2026-10-03
2026-10-05
2026-10-09
2026-12-25
`.trim();

/* 요일타입: 평/토/휴 (일요일=휴) + 공휴일 */
function getDayType(date, holidaySet) {
  const dow = date.getDay();
  if (holidaySet.has(fmt(date))) return "휴";
  if (dow === 0) return "휴";
  if (dow === 6) return "토";
  return "평";
}

/* 표 파싱(CSV/TSV) */
function parsePeopleTable(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";

  const header = lines[0].split(delim).map((s) => s.trim());
  const idx = (k) =>
    header.findIndex((h) => h.replace(/\s/g, "") === k.replace(/\s/g, ""));

  const iSeq = idx("순번");
  const iName = idx("이름");
  const iDia = idx("dia");
  const iWdIn = idx("평일출근");
  const iWdOut = idx("평일퇴근");
  const iSaIn = idx("토요일출근");
  const iSaOut = idx("토요일퇴근");
  const iHoIn = idx("휴일출근");
  const iHoOut = idx("휴일퇴근");

  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(delim);
    const diaRaw = (cols[iDia] || "").trim();
    const dia = /^\d+$/.test(diaRaw) ? Number(diaRaw) : diaRaw;
    rows.push({
      seq: (cols[iSeq] || "").trim(),
      name: (cols[iName] || "").trim(),
      dia,
      weekday: {
        in: (cols[iWdIn] || "").trim(),
        out: (cols[iWdOut] || "").trim(),
      },
      saturday: {
        in: (cols[iSaIn] || "").trim(),
        out: (cols[iSaOut] || "").trim(),
      },
      holiday: {
        in: (cols[iHoIn] || "").trim(),
        out: (cols[iHoOut] || "").trim(),
      },
    });
  }
  return rows;
}

/* 이름 -> 원본 행 인덱스 */
function buildNameIndexMap(rows) {
  const m = new Map();
  rows.forEach((r, i) => {
    if (r.name) m.set(r.name, i);
  });
  return m;
}

/* (row, date, holidays, nightDiaThreshold) → {in, out, note, combo, isNight} */
function computeInOut(row, date, holidaySet, nightDiaThreshold) {
  if (!row)
    return {
      in: "-",
      out: "-",
      note: "데이터 없음",
      combo: "-",
      isNight: false,
    };

  if (typeof row.dia === "string") {
    const label = row.dia;
    if (label.includes("비번"))
      return { in: "-", out: "-", note: "비번", combo: "-", isNight: false };
    if (label.replace(/\s/g, "").startsWith("휴"))
      return { in: "-", out: "-", note: "휴무", combo: "-", isNight: false };
    if (label === "교육" || label === "휴가")
      return { in: "-", out: "-", note: label, combo: "-", isNight: false };
    if (label === "주" || label === "야") {
      const tType = getDayType(date, holidaySet);
      const src =
        tType === "평"
          ? row.weekday
          : tType === "토"
          ? row.saturday
          : row.holiday;
      const isNightShift = label === "야";
      return {
        in: src.in || "-",
        out: src.out || "-",
        note: `${tType}${isNightShift ? " (야간)" : ""}`,
        combo: tType,
        isNight: isNightShift,
      };
    }
    if (label.startsWith("대")) {
      const tType = getDayType(date, holidaySet);
      const src =
        tType === "평"
          ? row.weekday
          : tType === "토"
          ? row.saturday
          : row.holiday;

      // '대n' 중 숫자만 추출
      const n = Number(label.replace(/[^0-9]/g, ""));
      const isNightShift = Number.isFinite(n) && n >= nightDiaThreshold;

      return {
        in: src.in || "-",
        out: src.out || "-",
        note: `대근·${tType}${isNightShift ? " (야간)" : ""}`,
        combo: tType,
        isNight: isNightShift, // ← 야간으로 인식
      };
    }
  }

  const tType = getDayType(date, holidaySet);
  const srcToday =
    tType === "평" ? row.weekday : tType === "토" ? row.saturday : row.holiday;

  let outTime = srcToday.out || "-";
  let combo = `${tType}-${tType}`;
  let night = false;

  if (typeof row.dia === "number" && row.dia >= nightDiaThreshold) {
    const tomorrow = new Date(date);
    tomorrow.setDate(date.getDate() + 1);
    const nextType = getDayType(tomorrow, holidaySet);
    const srcNext =
      nextType === "평"
        ? row.weekday
        : nextType === "토"
        ? row.saturday
        : row.holiday;
    outTime = srcNext.out || "-";
    combo = `${tType}-${nextType}`;
    night = true;
  }

  return {
    in: srcToday.in || "-",
    out: outTime,
    note: night ? `${combo} (야간)` : combo,
    combo,
    isNight: night,
  };
}

/* 파일 업로드 (텍스트) */
function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result || ""));
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

/* 이미지 → dataURL (localStorage 저장 가능) */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* 행로표 이미지 키 생성: "{dia}dia{combo}" 예) "27dia평-휴" */
function routeKey(dia, combo) {
  if (typeof dia !== "number") return "";
  return `${dia}dia${combo}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// ⬇⬇ 여기 붙여넣기 (App() 선언보다 위)
function useDaySwipeHandlers() {
  const ref = React.useRef(null);
  const [dragX, setDragX] = React.useState(0);
  const [snapping, setSnapping] = React.useState(false);

  const stateRef = React.useRef({ x: 0, y: 0, lock: null });
  const lastRef = React.useRef({ x: 0, t: 0 });

  const TH = 40; // 스냅 거리 임계
  const VEL = 0.35; // 스냅 속도 임계(px/ms)
  const ACT = 14; // 방향 잠금 시작(살짝 올림)
  const DIR = 1.25; // 방향 우세 비율(가로가 세로보다 1.25배 이상 커야 가로로 잠금)
  const SNAP = 280; // 애니 시간(ms)

  const onStart = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    stateRef.current = { x: t.clientX, y: t.clientY, lock: null };
    lastRef.current = { x: t.clientX, t: performance.now() };
    setSnapping(false);
    setDragX(0);
    //e.stopPropagation?.();
    // ❌ 여기서 stopPropagation 하지 말 것!
  };

  const onMove = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    const dx = t.clientX - stateRef.current.x;
    const dy = t.clientY - stateRef.current.y;

    if (stateRef.current.lock === null) {
      if (Math.abs(dx) > Math.abs(dy) * DIR && Math.abs(dx) > ACT) {
        stateRef.current.lock = "h";
      } else if (Math.abs(dy) > Math.abs(dx) * DIR && Math.abs(dy) > ACT) {
        stateRef.current.lock = "v";
      }
    }
    if (stateRef.current.lock === "h") {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation?.();
      setDragX(dx);
      lastRef.current = { x: t.clientX, t: performance.now() };
    }
  };

  const onEnd = (onPrev, onNext) => (e) => {
    if (stateRef.current.lock !== "h") {
      // 가로로 잠금 안 됐으면 아무 것도 안 함(세로에 맡김)
      setDragX(0);
      return;
    }
    const t = e.changedTouches[0];
    const now = performance.now();
    const dt = Math.max(1, now - lastRef.current.t);
    const vx = (t.clientX - lastRef.current.x) / dt;
    const dx = t.clientX - stateRef.current.x;

    const width = ref.current?.offsetWidth || window.innerWidth;
    const goNext = dx < 0 && (Math.abs(dx) > TH || Math.abs(vx) > VEL);
    const goPrev = dx > 0 && (Math.abs(dx) > TH || Math.abs(vx) > VEL);

    setSnapping(true);
    if (goNext) {
      setDragX(-width);
      setTimeout(() => {
        onNext?.();
        setSnapping(false);
        setDragX(0);
      }, SNAP);
    } else if (goPrev) {
      setDragX(width);
      setTimeout(() => {
        onPrev?.();
        setSnapping(false);
        setDragX(0);
      }, SNAP);
    } else {
      setDragX(0);
      setTimeout(() => setSnapping(false), SNAP);
    }
    stateRef.current = { x: 0, y: 0, lock: null };
  };

  const style = {
    transform: `translateX(${dragX}px)`,
    transition: snapping ? `transform ${SNAP}ms ease-out` : "none",
    willChange: "transform",
  };

  return { ref, onStart, onMove, onEnd, style };
}
// ⬆⬆ 여기까지

import PasswordGate from "./lock/PasswordGate"; // ⬅ 추가

/* ===========================================
 * App
 * ===========================================*/

export default function App() {
  // ✅ 기본은 라이트 모드, 저장된 값이 있으면 그걸 우선 사용
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved === "dark" || saved === "light" ? saved : "light";
  });

  // ✅ theme가 바뀔 때마다 <html data-theme="..."> 업데이트
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme; // <html data-theme="light"> 또는 "dark"
    localStorage.setItem("theme", theme);
  }, [theme]);

  const [selectedTab, setSelectedTab] = useState("home");
  // 전체교번 정렬 모드: 'person'(기존 사람 순번) | 'dia'(DIA 순서)
  const [orderMode, setOrderMode] = useState("person");

  // 오늘/선택일
  const today = stripTime(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  // ⬇︎ 추가: 좌우 스와이프 시 하루 전/후 이동
  // ⬇︎ 좌우 스와이프 시 하루 전/후 이동
  const goPrevDay = () => {
    flushSync(() => {
      setSelectedDate((d) => addDaysSafe(d, -1));
    });
    setAltView(false); // ✅ 날짜 변경 직후 동기적으로 복귀
  };

  const goNextDay = () => {
    flushSync(() => {
      setSelectedDate((d) => addDaysSafe(d, 1));
    });
    setAltView(false); // ✅ 날짜 변경 직후 동기적으로 복귀
  };

  const [tempName, setTempName] = useState(""); // 홈 탭용 임시 이름
  // 👉 슬라이드 애니메이션을 위한 상태/참조
  const gridWrapRef = React.useRef(null);
  const [dragX, setDragX] = useState(0); // 손가락 따라 이동하는 x(px)
  const [isSnapping, setIsSnapping] = useState(false); // 스냅 중이면 true

  // 소속 선택
  const [selectedDepot, setSelectedDepot] = useState("안심");
  // ✅ 근무 변경 저장소 (소속/날짜/이름 단위로 override 저장)
  const [overridesByDepot, setOverridesByDepot] = useState({});

  // ✅ 근무 편집 모달 상태
  const [dutyModal, setDutyModal] = useState({
    open: false,
    date: null,
    name: null,
  });

  // ✅ override 저장/적용 헬퍼
  function setOverride(depot, dateObj, name, value /* string|null */) {
    const iso = fmt(stripTime(new Date(dateObj)));
    setOverridesByDepot((prev) => {
      const depotMap = { ...(prev?.[depot] || {}) };
      const dayMap = { ...(depotMap[iso] || {}) };
      if (value == null) delete dayMap[name];
      else dayMap[name] = value;
      return { ...prev, [depot]: { ...depotMap, [iso]: dayMap } };
    });
  }
  function applyOverrideToRow(row, depot, dateObj, name) {
    const iso = fmt(stripTime(new Date(dateObj)));
    const v = overridesByDepot?.[depot]?.[iso]?.[name];
    if (!v) return row;

    const patched = { ...(row || {}) };

    const applyTemplate = (tpl) => {
      if (!tpl) return;
      patched.weekday = { ...tpl.weekday };
      patched.saturday = { ...tpl.saturday };
      patched.holiday = { ...tpl.holiday };
    };

    // 1) 휴/비번/교육/휴가  ← 교육·휴가도 여기서 라벨로 고정
    if (v === "휴" || v === "비번" || v === "교육" || v === "휴가") {
      patched.dia = v;
      // 표 안에 같은 라벨 행이 있다면 시간 템플릿 동기화 (없어도 OK)
      applyTemplate(labelTemplates[v?.replace(/\s+/g, "")]);
      return patched;
    }

    // 2) '대n'
    if (/^대\d+$/.test(v)) {
      const n = Number(v.replace(/[^0-9]/g, ""));
      // ✅ 라벨 그대로 저장 → 표시가 ‘대n’로 유지
      patched.dia = `대${n}`;
      // ✅ 시간도 ‘대n’용 템플릿 우선 사용, 없을 때만 숫자 DIA로 폴백
      const k = `대${n}`.replace(/\s+/g, "");
      applyTemplate(labelTemplates[k] || diaTemplates[n]);
      return patched;
    }

    // 3) '주' / '야'
    if (v === "주" || v === "야") {
      patched.dia = v;
      applyTemplate(labelTemplates[v]);
      return patched;
    }

    // 4) 'nD'
    if (/^\d+D$/.test(v)) {
      const n = Number(v.replace("D", ""));
      if (Number.isFinite(n)) {
        patched.dia = n;
        applyTemplate(diaTemplates[n]);
      }
      return patched;
    }

    return patched;
  }

  function rowAtDateForNameWithOverride(name, dateObj) {
    const base = rowAtDateForName(name, dateObj);
    return applyOverrideToRow(base, selectedDepot, dateObj, name);
  }

  // ✅ override 여부 체크
  function hasOverride(depot, dateObj, name) {
    const iso = fmt(stripTime(new Date(dateObj)));
    return !!overridesByDepot?.[depot]?.[iso]?.[name];
  }

  // ✅ 근무 라벨 뽑기: mode = "calendar" | "roster"
  function diaLabelOf(row, mode = "calendar") {
    if (!row || row.dia === undefined) return "-";
    if (typeof row.dia === "number") {
      return mode === "calendar" ? `${row.dia}D` : `${row.dia}`; // 캘린더는 27D, 전체교번은 7
    }
    // 문자열(휴/비번/대n/주/야 등)은 그대로
    return String(row.dia);
  }

  // 소속별 회전 "기준일" 맵 (안심은 기본 2025-10-01, 나머지는 오늘)
  const defaultAnchorMap = useMemo(
    () =>
      Object.fromEntries(
        DEPOTS.map((d) => [d, d === "안심" ? "2025-10-01" : fmt(today)])
      ),
    [] // mount 시 1회
  );
  const [anchorDateByDepot, setAnchorDateByDepot] = useState(defaultAnchorMap);

  // 현재 선택 소속의 기준일 문자열
  const anchorDateStr = anchorDateByDepot[selectedDepot] ?? fmt(today);
  // Date 객체
  const anchorDate = useMemo(
    () => stripTime(new Date(anchorDateStr)),
    [anchorDateStr]
  );

  // 소속별 기준일 setter
  const setAnchorDateStrForDepot = (depot, value) =>
    setAnchorDateByDepot((prev) => ({ ...prev, [depot]: value }));

  // ✅ 여기에 추가
  const [tablesByDepot, setTablesByDepot] = useState({
    안심: defaultTableTSV,
    월배: wolTableTSV,
    경산: kyeongTableTSV,
    문양: moonTableTSV,
    교대: buildGyodaeTable(), // ⬅️ new
  });

  // 데이터/이름 목록
  //const [tableText, setTableText] = useState(defaultTableTSV);

  // 현재 소속의 테이블 텍스트
  const currentTableText = useMemo(
    () => tablesByDepot[selectedDepot] ?? defaultTableTSV,
    [tablesByDepot, selectedDepot]
  );

  //const peopleRows = useMemo(() => parsePeopleTable(tableText), [tableText]);
  const peopleRows = useMemo(
    () => parsePeopleTable(currentTableText),
    [currentTableText]
  );

  // ✅ 여기에 추가
  const nameIndexMap = useMemo(
    () => buildNameIndexMap(peopleRows),
    [peopleRows]
  );

  const nameList = useMemo(
    () => peopleRows.map((r) => r.name).filter(Boolean),
    [peopleRows]
  );

  // 숫자 DIA별 시간 템플릿
  const diaTemplates = React.useMemo(() => {
    const map = {};
    peopleRows.forEach((r) => {
      const n = Number(r?.dia);
      if (Number.isFinite(n) && !map[n]) {
        map[n] = {
          weekday: { ...r.weekday },
          saturday: { ...r.saturday },
          holiday: { ...r.holiday },
        };
      }
    });
    return map;
  }, [peopleRows]);

  // 문자열 레이블(대n/주/야/휴/비번)별 시간 템플릿
  const labelTemplates = React.useMemo(() => {
    const map = {};
    peopleRows.forEach((r) => {
      const d = r?.dia;
      if (typeof d === "string") {
        const key = d.replace(/\s+/g, ""); // '대 1' → '대1'
        if (!map[key]) {
          map[key] = {
            weekday: { ...r.weekday },
            saturday: { ...r.saturday },
            holiday: { ...r.holiday },
          };
        }
      }
    });
    return map;
  }, [peopleRows]);
  // 내 이름/공휴일
  //const [myName, setMyName] = useState("");
  // 표에서 등장한 근무값들로 자동 생성되는 선택지
  const DUTY_OPTIONS = React.useMemo(() => {
    const set = new Set(["비번", "휴", "교육", "휴가"]); // 기본 고정 옵션 4종
    peopleRows.forEach((r) => {
      const d = r?.dia;
      if (typeof d === "number") set.add(`${d}D`);
      else if (typeof d === "string") {
        const clean = d.replace(/\s+/g, "");
        if (/^대\d+$/i.test(clean)) set.add(clean); // 대1~대n
        if (/^대기\d+$/i.test(clean)) set.add(clean); // 대기1~대기n  ← 추가
        else if (clean === "비") set.add("비번"); // '비' 표기 보정
        else if (["주", "야", "휴", "비번"].includes(clean)) set.add(clean);
      }
    });

    // 보기 좋은 정렬: 1D… → 대1… → 휴/비번 → 주/야
    const orderKey = (v) => {
      if (/^\d+D$/.test(v)) return parseInt(v); // 1D~37D
      if (/^대\d+$/.test(v)) return 100 + parseInt(v.replace(/\D/g, ""));
      if (/^대기\d+$/i.test(v)) return 200 + parseInt(v.replace(/\D/g, "")); // ‘대기n’은 ‘대n’ 다음
      const fixed = { 비번: 1000, 휴: 1001, 주: 1002, 야: 1003 };
      return fixed[v] ?? 9999;
    };
    return Array.from(set).sort((a, b) => orderKey(a) - orderKey(b));
  }, [peopleRows]);

  // 소속별 내 이름
  const [myNameMap, setMyNameMap] = useState({
    안심: "",
    월배: "",
    경산: "",
    문양: "",
    교대: "", // ⬅️ new (원하면 "갑반"으로 기본값 넣어도 됩니다)
  });
  const myName = myNameMap[selectedDepot] || "";
  const setMyNameForDepot = (depot, name) =>
    setMyNameMap((prev) => ({ ...prev, [depot]: name }));
  const [holidaysText, setHolidaysText] = useState("");
  const [newHolidayDate, setNewHolidayDate] = useState(""); // ✅ 추가 (공휴일 추가용)
  const lastClickedRef = React.useRef(null);
  // ⬇️ lastClickedRef 바로 아래에 추가
  const longPressTimerRef = React.useRef(null);
  const longPressActiveRef = React.useRef(false);
  const longPressDidFireRef = React.useRef(false); // 롱프레스 후 onClick 무시용
  const LONG_MS = 600; // 롱프레스 임계

  const holidaySet = useMemo(() => {
    const s = new Set();
    holidaysText
      .split(/[, \n\r]+/)
      .map((v) => v.trim())
      .filter(Boolean)
      .forEach((d) => s.add(d));
    return s;
  }, [holidaysText]);

  // ✅ 탭바 높이 반영: 세로 슬라이드 뷰포트 고정 높이 계산
  const tabbarRef = React.useRef(null);
  const appRef = React.useRef(null); // ← 추가
  const [slideViewportH, setSlideViewportH] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const tabbarH = tabbarRef.current?.offsetHeight || 0;
      // 탭바를 뺀 화면 높이(약간의 여유 여백 포함). 최소값으로 안전장치
      const vh = window.innerHeight - tabbarH - 12;
      setSlideViewportH(Math.max(360, vh));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // 행로표 보기 대상 (클릭 임시 선택) — 내 이름은 유지
  const [routeTargetName, setRouteTargetName] = useState("");

  // 행로표 이미지 매핑: { "27dia평-휴": dataUrl, ... }
  const [routeImageMap, setRouteImageMap] = useState({});

  // 야간 기준값(설정에서 변경)
  //const [nightDiaThreshold, setNightDiaThreshold] = useState(25);
  const [nightDiaByDepot, setNightDiaByDepot] = useState({
    안심: 25,
    월배: 5,
    경산: 5,
    문양: 5,
    교대: 5, // ⬅️ new (교대는 '야/휴'가 문자열이라 임계치 영향은 사실상 없음)
  });
  // 선택된 소속의 야간 기준값 (기존 nightDiaThreshold 대체)
  const nightDiaThreshold = nightDiaByDepot[selectedDepot] ?? 25;
  const setNightDiaForDepot = (depot, val) =>
    setNightDiaByDepot((prev) => ({ ...prev, [depot]: val }));

  // 여러 사람 강조 색상: { [name]: "#RRGGBB" }
  const [highlightMap, setHighlightMap] = useState({});
  // ✅ 비교 탭: 선택된 사람들
  const [compareSelected, setCompareSelected] = useState([]);
  // ===== 상단 state 부근에 추가 =====
  const [loaded, setLoaded] = useState(false); // 로컬스토리지에서 다 읽어왔는지 플래그
  const SAVE_DEBOUNCE = 300; // 저장 디바운스(ms)

  const [calHasSelection, setCalHasSelection] = useState(true);

  // 🔒 수직 스와이프 중 문서 스크롤 잠금/해제 (iOS 대응 포함)
  const scrollLockRef = React.useRef({ locked: false, scrollY: 0 });

  function lockBodyScroll() {
    if (scrollLockRef.current.locked) return;
    scrollLockRef.current.scrollY = window.scrollY || window.pageYOffset || 0;
    // iOS 사파리 대응: position: fixed + top 보정
    //document.body.style.position = "fixed";
    //document.body.style.top = `-${scrollLockRef.current.scrollY}px`;
    //document.body.style.left = "0";
    //document.body.style.right = "0";
    //document.body.style.width = "100%";
    //document.body.style.overflow = "hidden";
    // 바운스/오버스크롤 방지
    //document.documentElement.style.overscrollBehavior = "none";
    //document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overscrollBehavior = "none";
    scrollLockRef.current.locked = true;
  }

  function unlockBodyScroll() {
    if (!scrollLockRef.current.locked) return;
    const y = scrollLockRef.current.scrollY || 0;
    //document.body.style.position = "";
    //document.body.style.top = "";
    //document.body.style.left = "";
    //document.body.style.right = "";
    //document.body.style.width = "";
    //document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.documentElement.style.overscrollBehavior = "";
    document.body.style.overscrollBehavior = "";
    scrollLockRef.current.locked = false;
    // 복귀
    //window.scrollTo(0, y);
  }

  /* -----------------------
   * 1) 초기 로드: localStorage → 상태


   * ----------------------- */

  // 홈, 행로 각각의 수직 페이저 상태  ✅ isHomeCalLocked보다 먼저!
  const [homePage, setHomePage] = useState(0); // 0=캘린더, 1=전체교번
  const [routePage, setRoutePage] = useState(0); // 0=행로카드, 1=전체교번
  // 🔥 iOS 전환 효과용 상태
  const [routeTransitioning, setRouteTransitioning] = useState(false);

  // 🔥 행로표 탭으로 부드럽게 전환하는 함수
  function triggerRouteTransition() {
    // 🔹 오버레이 요소 생성 (기존 화면 페이드아웃용)
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      background: "black",
      opacity: "0",
      transform: "scale(1)",
      transition: "all 0.35s cubic-bezier(0.25, 1, 0.5, 1)", // iOS 감속 커브
      zIndex: "9998",
      pointerEvents: "none",
    });
    document.body.appendChild(overlay);

    // 🔹 현재 화면이 살짝 뒤로 밀리면서 어두워짐
    requestAnimationFrame(() => {
      overlay.style.opacity = "0.12";
      overlay.style.transform = "scale(0.96)";
    });

    // 🔹 약간의 지연 후 route 화면 전환
    setTimeout(() => {
      setSelectedTab("route");
      setRoutePage(0);
      setDragYRoute(0);

      // 🔹 새 화면이 확대되며 등장 (depth-in)
      const routePanel = document.getElementById("route-panel0");
      if (routePanel) {
        routePanel.animate(
          [
            { opacity: 0, transform: "translateY(14px) scale(0.97)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          {
            duration: 200,
            easing: "cubic-bezier(0.25, 1, 0.5, 1)",
          }
        );
      }
    }, 150);

    // 🔹 페이드아웃 종료 후 오버레이 제거
    setTimeout(() => {
      overlay.style.opacity = "0";
      overlay.style.transform = "scale(1)";
      setTimeout(() => overlay.remove(), 220);
    }, 400);
  }

  // ✅ useEffect보다 "위"에서 선언해야 함 (homePage를 이미 선언한 뒤)
  const isHomeCalLocked = selectedTab === "home" && homePage === 0;
  const isRouteLocked = selectedTab === "route"; // 행로는 두 페이지 모두 잠금
  const isRosterLocked = false; // ✅ 전체 탭은 잠금 해제
  const isAnyLocked = isHomeCalLocked || isRouteLocked; // ✅ roster 제외

  // ===== 초기 로드 useEffect 수정 =====
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        //setMyName((prev) => prev || nameList[0] || "");
        // 초기 진입: 안심 표의 첫 이름을 내 이름 후보로
        setMyNameForDepot("안심", nameList[0] || "");
        setHolidaysText(DEFAULT_HOLIDAYS_25_26); // ← 기본 공휴일 미리 채워 넣기
        setLoaded(true);
        return;
      }
      const s = JSON.parse(raw);
      // 🔹 저장된 데이터 버전 확인 (없으면 0으로 간주)
      const savedDataVersion = s.dataVersion ?? 0;
      const isOldData = savedDataVersion !== DATA_VERSION;

      // ✅ 새로 추가 (야간 규칙 소속별 버전 로드)
      if (s.nightDiaByDepot) {
        setNightDiaByDepot(s.nightDiaByDepot);
      } else if (typeof s.nightDiaThreshold === "number") {
        // ⬅️ 과거 단일값을 쓰던 버전 호환: 모든 소속에 동일 적용
        setNightDiaByDepot({
          안심: s.nightDiaThreshold,
          월배: s.nightDiaThreshold,
          경산: s.nightDiaThreshold,
          문양: s.nightDiaThreshold,
        });
      }
      //if (s.tableText) setTableText(s.tableText);
      //if (s.myName) setMyName(s.myName);
      // V3
      // 🔹 데이터 버전이 동일할 때만 사용자 테이블 복원
      if (s.tablesByDepot && !isOldData) setTablesByDepot(s.tablesByDepot);
      if (s.myNameMap) setMyNameMap(s.myNameMap);
      if (s.selectedDepot) setSelectedDepot(s.selectedDepot);
      if (s.overridesByDepot) setOverridesByDepot(s.overridesByDepot); // ✅ 복원 추가

      // 하위 호환(V2) → 안심에 이관
      if (!s.tablesByDepot && s.tableText) {
        setTablesByDepot((prev) => ({ ...prev, 안심: s.tableText }));
      }
      if (!s.myNameMap && s.myName) {
        setMyNameForDepot("안심", s.myName);
      }

      if (s.anchorDateByDepot) {
        setAnchorDateByDepot(s.anchorDateByDepot);
      } else if (s.anchorDateStr) {
        // 구버전 호환: 모든 소속에 동일 기준일 적용
        const same = Object.fromEntries(
          DEPOTS.map((d) => [d, s.anchorDateStr])
        );
        setAnchorDateByDepot(same);
      }

      //if (s.holidaysText) setHolidaysText(s.holidaysText);
      if (s.holidaysText) setHolidaysText(s.holidaysText);
      // 저장된 값이 비거나 공백뿐이면 기본값으로 보정
      if (!s.holidaysText || !String(s.holidaysText).trim()) {
        setHolidaysText(DEFAULT_HOLIDAYS_25_26);
      }
      //if (typeof s.nightDiaThreshold === "number")
      // setNightDiaThreshold(s.nightDiaThreshold);
      if (s.highlightMap) setHighlightMap(s.highlightMap);
      if (Array.isArray(s.compareSelected))
        setCompareSelected(s.compareSelected);
      if (s.selectedDate) setSelectedDate(stripTime(new Date(s.selectedDate)));
      // ❌ 행로표 이미지 URL 캐시는 버전 바뀌면 깨질 수 있어서 복원하지 않음
      //if (s.routeImageMap) setRouteImageMap(s.routeImageMap);
    } catch (e) {
      console.warn("[LOAD] 설정 로드 실패", e);
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 홈, 행로 각각의 수직 페이저 상태

  // 탭 변경 시 스크롤 맨 위로 이동
  // 탭 변경 시 스크롤 초기화 + 홈에서 나가면 임시 이름 복귀
  useEffect(() => {
    if (appRef.current) appRef.current.scrollTop = 0; // ← 핵심
    window.scrollTo({ top: 0, behavior: "instant" });

    // ✅ '전체(roster)'나 '설정(settings)'으로 나갔다가 돌아올 때만 임시 대상 초기화
    if (selectedTab === "roster" || selectedTab === "settings") {
      setTempName("");
    }
  }, [selectedTab]);

  useEffect(() => {
    console.log("🔑 ansimGlobs keys:", Object.keys(ansimGlobs));
  }, []);

  // 홈 탭 들어올 때는 항상 panel0로 고정
  useEffect(() => {
    if (selectedTab === "home") {
      setHomePage(0);
      setDragYHome(0);
      setSnapYHome(false);
      // 홈으로 돌아오면 '오늘'로 복귀 (다른 달로 슬라이드해둔 상태 정리)
      if (fmt(selectedDate) !== fmt(today) || !calHasSelection) {
        setSelectedDate(today);
        setCalHasSelection(true); // 하이라이트 켜기
        lastClickedRef.current = fmt(today); // 더블탭 기준도 오늘로 동기화
      }
    }
  }, [selectedTab]);
  // ✅ 비교 탭 들어올 때도 오늘로 고정
  useEffect(() => {
    if (selectedTab === "compare") {
      if (fmt(selectedDate) !== fmt(today)) setSelectedDate(today);
    }
  }, [selectedTab]);

  // ✅ 행로 탭으로 들어올 때는 항상 panel0로 강제 리셋
  useEffect(() => {
    if (selectedTab === "route") {
      setRoutePage(0);
      setDragYRoute(0);
      setSnapYRoute(false);
    }
  }, [selectedTab]);

  // 홈 캘린더(페이지 0) 노출 동안 문서 스크롤 잠금
  useEffect(() => {
    if (isAnyLocked) {
      lockBodyScroll();
      return () => unlockBodyScroll();
    } else {
      unlockBodyScroll();
    }
  }, [isAnyLocked]);

  /* 이름 리스트가 갱신되었는데 내 이름이 없으면 첫 항목으로 자동 보정 */
  // ===== 이름 자동 보정 useEffect 보완 (loaded 이후에만 작동) =====
  // ✅ /src/ansim 안의 이미지 자동 등록
  useEffect(() => {
    const targetName = routeTargetName || myName;
    if (!targetName) return;

    (async () => {
      const row = rowAtDateForNameWithOverride(targetName, selectedDate);

      const t = computeInOut(row, selectedDate, holidaySet, nightDiaThreshold);
      const key =
        typeof row?.dia === "number" ? routeKey(row.dia, t.combo) : "";
      if (!key) return;

      // 이미 캐시에 있으면 스킵
      const cacheKey = `${selectedDepot}:${key}`;
      if (routeImageMap[cacheKey]) return;
      const src = getRouteImageSrc(key, selectedDepot);
      if (src) setRouteImageMap((prev) => ({ ...prev, [cacheKey]: src }));
    })();
  }, [
    routeTargetName,
    myName,
    selectedDate,
    holidaySet,
    nightDiaThreshold,
    selectedDepot,
  ]);

  //useEffect(() => {
  //  console.log("✅ ansimImages keys:", Object.keys(ansimImages));
  // }, []);

  useEffect(() => {
    console.log("🧩 routeImageMap keys:", Object.keys(routeImageMap));
  }, [routeImageMap]);

  console.log("🧩 routeImageMap keys:", Object.keys(routeImageMap));
  useEffect(() => {
    // 지원 브라우저에서 저장소를 "가능하면 지우지 않도록" 요청
    (async () => {
      try {
        if ("storage" in navigator && "persist" in navigator.storage) {
          await navigator.storage.persist();
        }
      } catch {}
    })();
  }, []);

  /* -----------------------
   * 2) 상태 변경 시: 상태 → localStorage (자동 저장)
   * ----------------------- */
  // ===== 저장 useEffect: 디바운스 & 용량 초과해도 앱 죽지 않게 =====
  // ===== 저장 useEffect: 디바운스 & 용량 초과해도 앱 죽지 않게 =====
  useEffect(() => {
    if (!loaded) return; // 초기 로드 끝나기 전에는 저장 안 함

    const data = {
      dataVersion: DATA_VERSION, // 🔹 사람테이블/행로표 데이터 버전 같이 저장

      //myName,
      myNameMap,
      selectedDepot,
      anchorDateByDepot, // ✅ 소속별 기준일 저장
      holidaysText,
      //nightDiaThreshold,
      nightDiaByDepot,
      highlightMap,
      //tableText,
      tablesByDepot, // ← 같은 DATA_VERSION일 때만 복원
      selectedDate: fmt(selectedDate),
      // ❌ 행로표 이미지 URL 캐시는 저장하지 않음
      compareSelected,
      overridesByDepot,
    };
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn("[SAVE] 저장 실패(아마 용량 초과)", e);
        // routeImageMap을 더는 저장하지 않으므로, 여기서는 경고만 남김
      }
    }, SAVE_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [
    loaded,
    //myName,
    myNameMap,
    anchorDateByDepot,
    holidaysText,
    nightDiaByDepot,
    //nightDiaThreshold,
    highlightMap,
    //tableText,
    tablesByDepot,
    selectedDate,
    //routeImageMap,
    compareSelected,
    overridesByDepot,
  ]);

  // ✅ RosterGrid에서 접근 가능하게 전역 등록
  useEffect(() => {
    window.triggerRouteTransition = triggerRouteTransition;
    window.setRouteTargetName = setRouteTargetName; // ✅ 추가!
    return () => delete window.triggerRouteTransition;
  }, []);

  // --- 회전 로직: "기준일"을 0으로 보고 날짜차이만큼 전진 ---
  function rowAtDateForName(name, date) {
    if (!nameIndexMap.has(name) || peopleRows.length === 0) return undefined;
    const baseIdx = nameIndexMap.get(name);
    const dd = diffDays(date, anchorDate);
    const idx = mod(baseIdx + dd, peopleRows.length);
    return peopleRows[idx];
  }

  // 선택일 전체 로스터
  function rosterAt(date) {
    return nameList.map((n) => {
      const r = rowAtDateForNameWithOverride(n, date);
      return { name: n, row: r, dia: r?.dia };
    });
  }

  // === DIA 순서 보기용 데이터 (전체교번 정렬/그룹) ===
  const diaViewData = useMemo(() => {
    if (!nameList?.length) return null;

    const yester = getYesterday(selectedDate);

    const entriesToday = nameList.map((name) => {
      const row = rowAtDateForNameWithOverride(name, selectedDate);

      const todayDia = row?.dia;

      let type = "work"; // work | dae | biban | holiday
      let diaNum = toDiaNum(todayDia);
      let daeNum = null;

      if (typeof todayDia === "string") {
        const clean = todayDia.replace(/\s/g, "");
        if (clean.startsWith("휴")) {
          type = "holiday";
        } else if (clean.includes("비번") || clean === "비") {
          type = "biban";
        } else if (/^대\d+$/i.test(clean)) {
          type = "dae";
          daeNum = Number(clean.replace(/[^0-9]/g, ""));
        }
      }

      // 비번/대근은 전날 DIA도 같이 들고간다(정렬/태깅용)
      let yDiaNum = null;
      let yPrevLabel = null;
      if (type === "biban" || type === "dae") {
        const yRow = rowAtDateForNameWithOverride(name, yester);

        yPrevLabel = yRow?.dia ?? null;
        const n = toDiaNum(yPrevLabel);
        yDiaNum = Number.isFinite(n) ? n : null;
      }

      return { name, todayDia, type, diaNum, daeNum, yDiaNum, yPrevLabel };
    });

    // 1) 숫자 DIA(근무) → 2) 대근(대1~) → 3) 비번 → 4) 휴무
    const work = entriesToday
      .filter((e) => e.type === "work" && Number.isFinite(e.diaNum))
      .sort((a, b) => a.diaNum - b.diaNum);

    const dae = entriesToday
      .filter((e) => e.type === "dae" && Number.isFinite(e.daeNum))
      .sort(
        (a, b) =>
          a.daeNum - b.daeNum ||
          String(a.name).localeCompare(String(b.name), "ko")
      );

    const biban = entriesToday
      .filter((e) => e.type === "biban")
      .sort((a, b) => {
        const ak = a.yDiaNum ?? 9999;
        const bk = b.yDiaNum ?? 9999;
        if (ak !== bk) return ak - bk;
        return String(a.name).localeCompare(String(b.name), "ko");
      });

    const holiday = entriesToday
      .filter((e) => e.type === "holiday")
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));

    return { work, dae, biban, holiday };
  }, [
    nameList,
    selectedDate,
    nightDiaThreshold,
    selectedDepot,
    overridesByDepot,
  ]);
  // === DIA 순서 그리드용 1차원 배열 ===
  const diaGridRows = useMemo(() => {
    if (!nameList?.length) return [];

    const yester = getYesterday(selectedDate);

    const entries = nameList.map((name) => {
      const rowToday = rowAtDateForNameWithOverride(name, selectedDate);
      const todayDia = rowToday?.dia;

      let type = "work"; // work | dae | biban | holiday
      let diaNum = toDiaNum(todayDia);
      let daeNum = null;

      if (typeof todayDia === "string") {
        const clean = todayDia.replace(/\s/g, "");
        if (clean.startsWith("휴")) {
          type = "holiday";
        } else if (clean.includes("비번") || clean === "비") {
          type = "biban";
        } else if (/^대\d+$/i.test(clean)) {
          type = "dae";
          daeNum = Number(clean.replace(/[^0-9]/g, ""));
        }
      }

      // 비번/대근은 전날 DIA를 함께 확인(정렬·꼬리표용)
      let yDiaNum = null;
      if (type === "biban" || type === "dae") {
        const yRow = rowAtDateForNameWithOverride(name, yester);

        const n = toDiaNum(yRow?.dia);
        yDiaNum = Number.isFinite(n) ? n : null;
      }

      return { name, row: rowToday, type, diaNum, daeNum, yDiaNum };
    });

    const work = entries
      .filter((e) => e.type === "work" && Number.isFinite(e.diaNum))
      .sort((a, b) => a.diaNum - b.diaNum);

    const dae = entries
      .filter((e) => e.type === "dae" && Number.isFinite(e.daeNum))
      .sort(
        (a, b) =>
          a.daeNum - b.daeNum ||
          String(a.name).localeCompare(String(b.name), "ko")
      );

    const biban = entries
      .filter((e) => e.type === "biban")
      .sort((a, b) => {
        const ak = a.yDiaNum ?? 9999;
        const bk = b.yDiaNum ?? 9999;
        if (ak !== bk) return ak - bk;
        return String(a.name).localeCompare(String(b.name), "ko");
      });

    const holiday = entries
      .filter((e) => e.type === "holiday")
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));

    // 화면에 뿌릴 순서: 숫자 DIA → 대근 → 비번 → 휴무
    return [...work, ...dae, ...biban, ...holiday].map(
      ({ name, row, type }) => {
        let displayDia = row?.dia;

        // '대n'인 경우 전날 야간 여부에 따라 꼬리(~)
        if (
          typeof displayDia === "string" &&
          displayDia.trim().startsWith("대")
        ) {
          const yRow = rowAtDateForNameWithOverride(name, yester);

          const yDia = yRow?.dia;
          const yNum = toDiaNum(yDia);
          let prevNight = false;

          if (Number.isFinite(yNum) && yNum >= nightDiaThreshold)
            prevNight = true;
          if (typeof yDia === "string" && /^대\s*\d+$/.test(yDia))
            prevNight = true;

          if (prevNight) displayDia = `${displayDia.replace(/\s+/g, "")}~`;
        }

        // 비번: 전날 야간이면 '25~' 혹은 '대5~'처럼 표기
        if (type === "biban") {
          const yRow = rowAtDateForNameWithOverride(name, yester);

          const yDiaRaw = yRow?.dia;
          const yDia =
            typeof yDiaRaw === "string"
              ? yDiaRaw.trim().replace(/\s+/g, "")
              : yDiaRaw;
          let prevNight = false;

          const n = toDiaNum(yDia);
          if (Number.isFinite(n) && n >= nightDiaThreshold) prevNight = true;
          if (typeof yDia === "string" && /^대\d+$/.test(yDia))
            prevNight = true;

          displayDia = prevNight ? `${String(yDia)}~` : "비번";
        }

        return { name, row: { ...row, dia: displayDia } };
      }
    );
  }, [
    nameList,
    selectedDate,
    nightDiaThreshold,
    selectedDepot,
    overridesByDepot,
  ]);

  // 캘린더 그리드
  // 캘린더 그리드
  const days = monthGridMonday(selectedDate);
  const monthOfSelected = selectedDate.getMonth();
  const todayISO = fmt(today);

  // 👉 부드러운 슬라이드 전용 스와이프 핸들러 추가
  // 👉 부드러운 슬라이드용 스와이프 (속도+거리 기준 스냅)
  const swipeRef = React.useRef({ x: 0, y: 0, lock: null });
  const lastMoveRef = React.useRef({ x: 0, t: 0 });
  const SWIPE_X_THRESHOLD = 40; // 거리 임계
  const VELOCITY_THRESHOLD = 0.35; // 속도 임계(px/ms)
  const ACTIVATION_THRESHOLD = 10; // 방향 잠금 시작
  const SNAP_MS = 320;

  const onCalTouchStart = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, lock: null };
    lastMoveRef.current = { x: t.clientX, t: performance.now() };
    setIsSnapping(false);
    setDragX(0);
  };

  const onCalTouchMove = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeRef.current.x;
    const dy = t.clientY - swipeRef.current.y;

    if (swipeRef.current.lock === null) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > ACTIVATION_THRESHOLD) {
        swipeRef.current.lock = "h";
      } else if (
        Math.abs(dy) > Math.abs(dx) &&
        Math.abs(dy) > ACTIVATION_THRESHOLD
      ) {
        swipeRef.current.lock = "v";
      }
    }
    if (swipeRef.current.lock === "h") {
      e.preventDefault();
      setDragX(dx);
      lastMoveRef.current = { x: t.clientX, t: performance.now() };
    }
  };

  const onCalTouchEnd = (e) => {
    if (swipeRef.current.lock !== "h") {
      setDragX(0);
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeRef.current.x;

    // 속도 계산
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveRef.current.t);
    const vx = (t.clientX - lastMoveRef.current.x) / dt; // px/ms

    // 한 패널(=부모 너비)을 기준으로 스냅
    const width =
      gridWrapRef.current?.parentElement?.offsetWidth ||
      (gridWrapRef.current?.offsetWidth
        ? gridWrapRef.current.offsetWidth / 3
        : window.innerWidth);

    const goNext =
      dx < 0 &&
      (Math.abs(dx) > SWIPE_X_THRESHOLD || Math.abs(vx) > VELOCITY_THRESHOLD);
    const goPrev =
      dx > 0 &&
      (Math.abs(dx) > SWIPE_X_THRESHOLD || Math.abs(vx) > VELOCITY_THRESHOLD);

    setIsSnapping(true);
    if (goNext) {
      setDragX(-width);
      setTimeout(() => {
        setSelectedDate((prev) => addMonthsSafe(prev, 1));
        setCalHasSelection(false); // ✅ 월 넘길 때 선택표시 끔
        setIsSnapping(false);
        setDragX(0);
      }, SNAP_MS);
    } else if (goPrev) {
      setDragX(width);
      setTimeout(() => {
        setSelectedDate((prev) => addMonthsSafe(prev, -1));
        setCalHasSelection(false); // ✅ 월 넘길 때 선택표시 끔
        setIsSnapping(false);
        setDragX(0);
      }, SNAP_MS);
    } else {
      setDragX(0);
      setTimeout(() => setIsSnapping(false), SNAP_MS);
    }

    swipeRef.current = { x: 0, y: 0, lock: null };
  };
  // ===== 수직 스와이프 공통 상수 =====
  //const V_SW_THRESHOLD = 10; // 이동거리 임계(px)
  //const V_VELOCITY_THRESHOLD = 0.1; // 속도 임계(px/ms)
  //const V_SNAP_MS = 320;
  const V_SNAP_MS = 300;
  const V_DIST_RATIO = 0.1;
  const V_VELOCITY_THRESHOLD = 0.1;
  const V_ACTIVATE = 12; // 시작 임계 조금 올림
  const V_DIR = 1.2; // 세로 우세 비율

  // iOS 스타일 러버밴드 (limit 바깥으로 당기면 저항)
  function rubberband(distance, limit) {
    const constant = 0.55; // 0.5~0.7 사이가 자연스러움
    if (Math.abs(distance) < limit) return distance;
    const excess = Math.abs(distance) - limit;
    const sign = Math.sign(distance);
    return (
      sign *
      (limit +
        (1 - Math.exp(-excess / (limit / constant))) * (limit / constant))
    );
  }

  // 드래그 상태
  const [dragYHome, setDragYHome] = useState(0);
  const [dragYRoute, setDragYRoute] = useState(0);
  const [snapYHome, setSnapYHome] = useState(false);
  const [snapYRoute, setSnapYRoute] = useState(false);
  // ================== ⬇️ 여기 바로 아래에 추가해 ==================

  // 모바일 더블탭(320ms) 감지
  const [altView, setAltView] = React.useState(false); // false=행로표, true=버스 시간표
  const longPressTimer = React.useRef(null);
  const longPressActive = React.useRef(false);

  const handleTouchStart = React.useCallback(() => {
    // 문양: 롱프레스 토글 금지
    if (selectedDepot === "문양" || selectedDepot === "경산") return;
    longPressActive.current = true;
    longPressTimer.current = setTimeout(() => {
      if (longPressActive.current) setAltView((v) => !v);
    }, 600);
  }, [selectedDepot]);

  const handleTouchEnd = React.useCallback(() => {
    longPressActive.current = false;
    clearTimeout(longPressTimer.current);
  }, []);

  // 1️⃣ 앱 처음 켤 때 무조건 행로표부터
  React.useEffect(() => {
    setAltView(false);
  }, []);

  // 2️⃣ 다른 탭 갔다가 '행로표' 탭으로 돌아올 때도 초기화
  React.useEffect(() => {
    if (selectedTab === "route") {
      setAltView(false);
    }
  }, [selectedTab]);

  // 날짜가 바뀔 때마다 행로표로 초기화
  React.useEffect(() => {
    setAltView(false);
  }, [selectedDate]);

  // 대상/날짜 바뀌면 기본(행로표)로 복귀
  React.useEffect(() => {
    setAltView(false);
  }, [routeTargetName, selectedDate]);

  // 각 페이저 래퍼 & 패널 참조 (높이 측정용)
  const homeWrapRef = React.useRef(null);
  const homePanelRefs = [React.useRef(null), React.useRef(null)];
  const routeWrapRef = React.useRef(null);
  const routePanelRefs = [
    React.useRef(null),
    React.useRef(null),
    React.useRef(null),
    React.useRef(null),
  ];

  // 활성 패널 높이로 래퍼 높이 맞추기
  const [homeHeight, setHomeHeight] = useState(0);
  const [routeHeight, setRouteHeight] = useState(0);

  useLayoutEffect(() => {
    const el = homePanelRefs[homePage].current;
    if (!el) return;
    const measure = () =>
      setHomeHeight(el.offsetHeight || el.clientHeight || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
    };
  }, [
    homePage,
    selectedDate,
    currentTableText,
    holidaysText,
    nightDiaThreshold,
    myName,
    tempName,
  ]);

  useLayoutEffect(() => {
    const el = routePanelRefs[routePage].current;
    if (!el) return;
    const measure = () =>
      setRouteHeight(el.offsetHeight || el.clientHeight || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
    };
  }, [
    routePage,
    selectedDate,
    routeImageMap,
    holidaysText,
    nightDiaThreshold,
    myName,
    routeTargetName,
  ]);

  // 수직 스와이프 핸들러 팩토리
  function makeVerticalHandlers(kind /* 'home' | 'route' */) {
    const swipeRef = React.useRef({ x: 0, y: 0, lock: null });
    const lastMoveRef = React.useRef({ y: 0, t: 0 });
    const [pendingDir, setPendingDir] = React.useState(null); // 'next' | 'prev' | null

    const onStart = (e) => {
      if (e.target.closest("[data-no-gesture]")) return;
      const t = e.touches[0];
      swipeRef.current = { x: t.clientX, y: t.clientY, lock: null };
      lastMoveRef.current = { y: t.clientY, t: performance.now() };
      if (kind === "home") {
        setSnapYHome(false);
      } else {
        setSnapYRoute(false);
      }
    };
    const onMove = (e) => {
      if (e.target.closest("[data-no-gesture]")) return;
      const t = e.touches[0];
      const dx = t.clientX - swipeRef.current.x;
      const dy = t.clientY - swipeRef.current.y;

      if (swipeRef.current.lock === null) {
        if (Math.abs(dy) > Math.abs(dx) * V_DIR && Math.abs(dy) > V_ACTIVATE) {
          swipeRef.current.lock = "v";
          lockBodyScroll();
        } else if (
          Math.abs(dx) > Math.abs(dy) * V_DIR &&
          Math.abs(dx) > V_ACTIVATE
        ) {
          swipeRef.current.lock = "h";
        }
      }
      if (swipeRef.current.lock !== "v") return;

      if (e.cancelable) e.preventDefault(); // 경고 방지

      const wrap = kind === "home" ? homeWrapRef.current : routeWrapRef.current;
      const page = kind === "home" ? homePage : routePage;
      const MAX = kind === "home" ? 1 : 3;

      // 실제 패널 높이(=한 장 높이) 측정
      const wrapH = wrap?.offsetHeight || window.innerHeight * 0.6;

      // iOS 러버밴드 감각은 유지하되, 최종적으로는 클램프
      const rb = rubberband(dy, wrapH);

      // 페이지별 허용 방향만 반영: page0 => 위로만(음수), page1 => 아래로만(양수)
      let bounded = rb;
      if (page <= 0) bounded = Math.min(0, rb); // 첫 페이지: 위로만
      else if (page >= MAX) bounded = Math.max(0, rb); // 마지막: 아래로만

      // 절대값이 패널 높이를 넘지 않도록 하드 클램프
      bounded = clamp(bounded, -wrapH, wrapH);

      if (kind === "home") setDragYHome(bounded);
      else setDragYRoute(bounded);

      lastMoveRef.current = { y: t.clientY, t: performance.now() };
    };

    const onEnd = (e) => {
      if (swipeRef.current.lock !== "v") {
        if (kind === "home") setDragYHome(0);
        else setDragYRoute(0);
        unlockBodyScroll();
        return;
      }

      const t = e.changedTouches[0];
      const dy = t.clientY - swipeRef.current.y;

      const now = performance.now();
      const dt = Math.max(1, now - lastMoveRef.current.t);
      const vy = (t.clientY - lastMoveRef.current.y) / dt; // px/ms

      const wrap = kind === "home" ? homeWrapRef.current : routeWrapRef.current;
      const page = kind === "home" ? homePage : routePage;
      const MAX = kind === "home" ? 1 : 3; // home: 0..1, route: 0..3
      const setPage = kind === "home" ? setHomePage : setRoutePage;
      const setDrag = kind === "home" ? setDragYHome : setDragYRoute;
      const setSnap = kind === "home" ? setSnapYHome : setSnapYRoute;

      const height = wrap?.offsetHeight || window.innerHeight * 0.6;

      //const goNext =
      //  dy < 0 &&
      //  (Math.abs(dy) > V_SW_THRESHOLD || Math.abs(vy) > V_VELOCITY_THRESHOLD);
      // const goPrev =
      //   dy > 0 &&
      //    (Math.abs(dy) > V_SW_THRESHOLD || Math.abs(vy) > V_VELOCITY_THRESHOLD);

      const passedDist = Math.abs(dy) > height * V_DIST_RATIO;
      const fast = Math.abs(vy) > V_VELOCITY_THRESHOLD;
      const goNext = dy < 0 && (passedDist || fast);
      const goPrev = dy > 0 && (passedDist || fast);

      setSnap(true);
      /* if (goNext && page === 0) {
        // 아래로 넘기기(0→1)
        setDrag(-height);
        setTimeout(() => {
          setPage(1);
          setSnap(false);
          setDrag(0);
        }, V_SNAP_MS);
      } else if (goPrev && page === 1) {
        // 위로 넘기기(1→0)
        setDrag(height);
        setTimeout(() => {
          setPage(0);
          setSnap(false);
          setDrag(0);
        }, V_SNAP_MS);
      } else {
        setDrag(0);
        setTimeout(() => setSnap(false), V_SNAP_MS);
      }
      */
      if (goNext && page < MAX) {
        setPendingDir("next"); // 전환 예약
        setDrag(-height); // 현재 페이지 기준으로 -height까지 애니메
        // page는 아직 그대로 0 → overshoot 방지
      } else if (goPrev && page > 0) {
        setPendingDir("prev");
        setDrag(height);
      } else {
        setDrag(0); // 원위치 복귀
        setTimeout(() => setSnap(false), V_SNAP_MS);
      }

      swipeRef.current = { x: 0, y: 0, lock: null };
    };

    // 내부 슬라이더 div에 연결할 transitionend 핸들러
    const onTransitionEnd = () => {
      if (!pendingDir) return;
      if (kind === "home") {
        if (pendingDir === "next") setHomePage((p) => Math.min(p + 1, 1));
        else if (pendingDir === "prev") setHomePage((p) => Math.max(p - 1, 0));
        setDragYHome(0);
        setSnapYHome(false);
      } else {
        if (pendingDir === "next") setRoutePage((p) => Math.min(p + 1, 3));
        else if (pendingDir === "prev") setRoutePage((p) => Math.max(p - 1, 0));
        setDragYRoute(0);
        setSnapYRoute(false);
      }
      setPendingDir(null);
    };

    const onCancel = () => {
      if (kind === "home") {
        setDragYHome(0);
        setSnapYHome(false);
      } else {
        setDragYRoute(0);
        setSnapYRoute(false);
      }
      setPendingDir(null);
      unlockBodyScroll();
    };

    return { onStart, onMove, onEnd, onTransitionEnd, onCancel };
  }

  const vHome = makeVerticalHandlers("home");
  const vRoute = makeVerticalHandlers("route");

  const swipeHomeP1 = useDaySwipeHandlers(); // 홈탭 panel1 (선택일 전체교번)
  const swipeRosterP0 = useDaySwipeHandlers(); // 전체탭 panel0
  const swipeRouteP0 = useDaySwipeHandlers(); // 행로탭 panel0
  const swipeRouteP1 = useDaySwipeHandlers(); // 행로탭 panel1
  const swipeRouteP2 = useDaySwipeHandlers(); // 행로탭 panel2 (알람/일정)
  const swipeRouteP3 = useDaySwipeHandlers();

  // 업로드 (표)
  async function onUpload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const txt = await readTextFile(f);
    //setTableText(txt);
    setTablesByDepot((prev) => ({ ...prev, [selectedDepot]: txt }));
    e.target.value = "";
  }

  function resetAll() {
    if (!confirm("모든 저장 데이터를 초기화할까요?")) return;

    // 1) localStorage 전체 삭제 (이 출처에서 쓰는 WakeIcsPanel 설정 등도 같이 초기화)
    try {
      localStorage.clear();
    } catch {}

    // 2) 화면 상태 기본값으로 되돌리기
    setSelectedTab("home");
    setSelectedDate(today); // today는 위에서 stripTime(new Date())로 만든 값
    setSelectedDepot("안심");

    // ✅ 기준일: 상신이 원하는 기본 anchor로 고정 복구
    setAnchorDateByDepot(defaultAnchorByDepot);

    // ✅ 소속별 테이블 리셋 (코드에 박힌 기본 테이블로 복구)
    setTablesByDepot({
      안심: defaultTableTSV,
      월배: wolTableTSV,
      경산: kyeongTableTSV,
      문양: moonTableTSV,
      교대: buildGyodaeTable(),
    });

    // ✅ 소속별 내 이름 리셋
    setMyNameMap({
      안심: "",
      월배: "",
      경산: "",
      문양: "",
      교대: "",
    });

    // ✅ 소속별 야간 DIA 기준 리셋
    //    안심:25, 월배:25, 문양:24, 경산:21, 교대:5(기존 유지)
    setNightDiaByDepot({
      안심: 25,
      월배: 25,
      문양: 24,
      경산: 21,
      교대: 5,
    });

    // ✅ 기타 상태들 리셋
    // 공휴일은 기본 세트로 돌려놓는게 좋아서 DEFAULT_HOLIDAYS_25_26 사용
    setHolidaysText(DEFAULT_HOLIDAYS_25_26);
    setHighlightMap({});
    setRouteImageMap({});
    setRouteTargetName("");

    // 3) 브라우저 캐시 & 서비스워커까지 정리 → 다음 진입 시 최신 코드/이미지 재설치
    if (typeof window !== "undefined") {
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => caches.delete(key));
        });
      }

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((reg) => reg.unregister());
        });
      }

      // 마지막으로 페이지 새로고침해서 완전 초기 상태로 재진입
      window.location.reload();
    }
  }

  const isPortrait = usePortraitOnly(); // ✅ 추가
  function DutyModal() {
    if (!dutyModal.open) return null;
    const { date, name } = dutyModal;
    const iso = fmt(date);

    const [pendingOpt, setPendingOpt] = React.useState(null);

    return (
      <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end sm:items-center justify-center p-2">
        <div
          className="
            w-[min(680px,100vw)]
            rounded-2xl bg-gray-800 text-gray-100 p-3 shadow-lg
            mb-[72px] sm:mb-0
          "
          style={{ marginBottom: "max(72px, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">근무 변경</div>
            <button
              className="text-sm opacity-70"
              onClick={() =>
                setDutyModal({ open: false, date: null, name: null })
              }
            >
              닫기
            </button>
          </div>

          <div className="text-xs text-gray-300 mb-3">
            {name} · {iso}
          </div>

          <div
            className="grid gap-2 grid-cols-6 sm:grid-cols-8"
            style={{ paddingBottom: "80px" }}
          >
            {DUTY_OPTIONS.map((opt) => {
              const active = pendingOpt === opt;
              return (
                <button
                  key={opt}
                  onPointerDown={() => setPendingOpt(opt)} // ← 즉시 테두리 표시
                  onClick={() => {
                    if (pendingOpt === opt) {
                      // 두 번째 클릭 → 확정
                      setOverride(selectedDepot, date, name, opt);
                      setDutyModal({ open: false, date: null, name: null });
                    } else {
                      // 첫 클릭 → 테두리만
                      setPendingOpt(opt);
                    }
                  }}
                  className={[
                    "h-9 rounded-lg bg-gray-700 hover:bg-gray-600",
                    "text-xs font-medium flex items-center justify-center",
                    active ? "ring-2 ring-indigo-400" : "",
                  ].join(" ")}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          <div className="mt-3 mb-6 flex items-center justify-between">
            <div className="text-[11px] text-gray-400">
              한 번 누르면 선택,{" "}
              <span className="text-gray-200">두 번 누르면 반영</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setOverride(selectedDepot, date, name, null); // 해제
                  setDutyModal({ open: false, date: null, name: null });
                }}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs"
              >
                설정 해제
              </button>
              <button
                onClick={() =>
                  setDutyModal({ open: false, date: null, name: null })
                }
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white"
              >
                완료
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* =========================
   * [ROUTE 공통 계산] — return 직전
   * ========================= */
  const routeTarget = routeTargetName || myName;

  const routeRow = React.useMemo(
    () => rowAtDateForNameWithOverride(routeTarget, selectedDate),
    [routeTarget, selectedDate, selectedDepot]
  );

  const routeT = React.useMemo(
    () => computeInOut(routeRow, selectedDate, holidaySet, nightDiaThreshold),
    [routeRow, selectedDate, holidaySet, nightDiaThreshold]
  );

  // WakeMidPanel에 줄 핵심 값
  const routeCombo = routeT?.combo || ""; // "평-평" / "토-휴" …
  const routeDia = routeRow?.dia ?? null; // 숫자 또는 문자열("대2","휴1" 포함)

  const routeIn = routeT.in;
  const routeOut = routeT.out;
  const routeDiaLabel = routeRow?.dia == null ? "-" : String(routeRow.dia);
  const routeNote = `${routeT.combo}${routeT.isNight ? " (야간)" : ""}`;
  const iso = fmt(selectedDate);
  const wk = weekdaysKR[(selectedDate.getDay() + 6) % 7];

  // (패널0 이미지용 파생값)
  // (패널0 이미지용 파생값)
  const routeKeyStr =
    typeof routeRow?.dia === "number" && routeT?.combo
      ? routeKey(routeRow.dia, routeT.combo)
      : "";

  const routeImgCacheKey = routeKeyStr ? `${selectedDepot}:${routeKeyStr}` : "";
  const routeImgSrc = routeImgCacheKey ? routeImageMap[routeImgCacheKey] : "";

  // ✅ 근무 없음 판정 (비/휴/대기/공란 모두)
  const diaStr = String(routeRow?.dia || "").trim();
  const noWork =
    !routeT?.in ||
    routeT.in === "-" ||
    !routeRow?.dia ||
    /비|휴|대기/i.test(diaStr);

  // ✅ 소속별 기본 버스 이미지 (무조건 이 맵만 사용)
  const defaultBusMap = {
    안심: "/bus/timetable.png",
    월배: "/bus/wolbus.png",
    경산: "/bus/line2.png",
    문양: "/bus/line2.png",
    교대: "/bus/line2.png",
  };

  // ✅ altView 지원: 안심·월배만
  const canAltView = selectedDepot === "안심" || selectedDepot === "월배";

  // ✅ 표시 조건: altView(지원소속) || 이미지 없음 || 근무 없음
  //    → "없는 다이아"도 이미지 없음으로 걸려 기본이미지 표시됨
  const routeShowBus = (canAltView && altView) || !routeImgSrc || noWork;

  // ✅ 최종 이미지 소스
  const routeShowSrc = routeShowBus
    ? defaultBusMap[selectedDepot]
    : routeImgSrc;

  // ✅ 라벨 문자열
  const busPathLabel = defaultBusMap[selectedDepot].replace(/^\//, "");

  // 이후
  const startHM = normalizeHM(routeIn);
  const endHM = normalizeHM(routeOut);

  // 디버그용(원하면)
  console.log("[WakeIcsPanel 전달]", { routeIn, routeOut, startHM, endHM });

  return (
    <div className="app-shell">
      <PasswordGate>
        {!isPortrait && <LandscapeOverlay />}
        <div
          aria-hidden={!isPortrait}
          inert={!isPortrait ? "" : undefined}
          ref={appRef}
          className="max-w-7xl mx-auto relative pb-0"
          style={{
            height: "100vh",
            overflowY: selectedTab === "settings" ? "auto" : "hidden", // ✅ 세로 스크롤 허용
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch", // ✅ iOS 스크롤 자연스럽게
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            //touchAction: selectedTab === "settings" ? "pan-y" : "none",
            touchAction: "manipulation",
          }}
        >
          {/* 홈(캘린더 + 선택일 전체 다이아) */}
          {selectedTab === "home" && (
            <div
              ref={homeWrapRef}
              className="mt-4 select-none overflow-hidden rounded-2xl overscroll-contain"
              style={{
                height: slideViewportH,
                touchAction: isHomeCalLocked ? "none" : "pan-y",
              }}
              onTouchStart={vHome.onStart}
              onTouchMove={vHome.onMove}
              onTouchEnd={vHome.onEnd}
              onTouchCancel={vHome.onCancel}
              onWheel={(e) => {
                if (isHomeCalLocked) e.preventDefault();
                if (snapYHome) return;
                const TH = 40;
                if (e.deltaY > TH && homePage === 0) {
                  setSnapYHome(true);
                  setDragYHome(-(homeWrapRef.current?.offsetHeight || 500));
                  setTimeout(() => {
                    setHomePage(1);
                    setSnapYHome(false);
                    setDragYHome(0);
                  }, 320);
                } else if (e.deltaY < -TH && homePage === 1) {
                  setSnapYHome(true);
                  setDragYHome(homeWrapRef.current?.offsetHeight || 500);
                  setTimeout(() => {
                    setHomePage(0);
                    setSnapYHome(false);
                    setDragYHome(0);
                  }, 320);
                }
              }}
            >
              <div
                className="relative"
                style={{
                  transform: `translateY(${
                    (homePage === 0 ? 0 : -slideViewportH) + dragYHome
                  }px)`,
                  transition: snapYHome
                    ? `transform ${V_SNAP_MS}ms ease-out`
                    : "none",
                  willChange: "transform",
                }}
                onTransitionEnd={vHome.onTransitionEnd}
              >
                {/* Panel 0: 캘린더 */}
                <div
                  ref={homePanelRefs[0]}
                  className="bg-gray-800 rounded-2xl p-3 shadow mb-7"
                  style={{ minHeight: slideViewportH }}
                >
                  {/* === 캘린더 카드 헤더 === */}
                  <div className="flex items-center justify-between mb-0">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <CalendarIcon className="w-5 h-5" />
                      {selectedDate.getFullYear()}년{" "}
                      {selectedDate.getMonth() + 1}월
                    </h2>

                    <div className="flex items-center gap-2">
                      {/* 연/월 선택 */}
                      <input
                        type="month"
                        className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                        value={`${selectedDate.getFullYear()}-${String(
                          selectedDate.getMonth() + 1
                        ).padStart(2, "0")}`}
                        onChange={(e) => {
                          const [y, m] = e.target.value.split("-").map(Number);
                          const d = stripTime(new Date(y, (m || 1) - 1, 1));
                          setSelectedDate(d);
                          setCalHasSelection(false); // 월 넘기면 당일 하이라이트 해제
                        }}
                        title="연/월 선택"
                      />

                      {/* 오늘로 */}
                      {fmt(selectedDate) !== fmt(today) && (
                        <button
                          className="px-2 py-1 rounded-xl bg-indigo-500 text-white text-xs"
                          onClick={() => {
                            setSelectedDate(today);
                            setCalHasSelection(true);
                            lastClickedRef.current = fmt(today);
                          }}
                        >
                          오늘로
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 대상/소속 셀렉트 */}
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-300">소속</span>
                      <select
                        className="bg-gray-700 rounded-xl p-1 text-xs"
                        value={selectedDepot}
                        onChange={(e) => setSelectedDepot(e.target.value)}
                      >
                        {DEPOTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>

                      <span className="text-xs text-gray-300">대상 이름</span>
                      <select
                        className="bg-gray-700 rounded-xl p-1 text-xs"
                        value={tempName || myName}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === myName) setTempName("");
                          else setTempName(val);
                        }}
                      >
                        {[myName, ...nameList.filter((n) => n !== myName)].map(
                          (n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          )
                        )}
                      </select>

                      {tempName && (
                        <button
                          onClick={() => setTempName("")}
                          className="px-2 py-1 rounded-xl bg-orange-700 hover:bg-gray-600 text-[11px] text-gray-200"
                        >
                          내이름
                        </button>
                      )}
                    </div>

                    {tempName && (
                      <div className="text-[11px] text-yellow-400">
                        {tempName}님의 근무표 임시 보기 중
                      </div>
                    )}
                  </div>

                  {/* 요일 헤더 (일요일 시작) */}
                  <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-gray-300 mb-1">
                    {["일", "월", "화", "수", "목", "금", "토"].map(
                      (w, idx) => (
                        <div
                          key={w}
                          className={
                            "py-0.5 " +
                            (idx === 6
                              ? "text-blue-400" // 토요일 파랑
                              : idx === 0
                              ? "text-red-400" // 일요일 빨강
                              : "text-white")
                          }
                        >
                          {w}
                        </div>
                      )
                    )}
                  </div>

                  {/* 3달 가로 스와이프 달력 */}
                  <div
                    className="select-none overflow-hidden"
                    onTouchStart={onCalTouchStart}
                    onTouchMove={onCalTouchMove}
                    onTouchEnd={onCalTouchEnd}
                  >
                    <div
                      ref={gridWrapRef}
                      className="flex"
                      style={{
                        width: "300%",
                        transform: `translateX(calc(-33.333% + ${dragX}px))`,
                        transition: isSnapping
                          ? "transform 320ms ease-out"
                          : "none",
                        willChange: "transform",
                      }}
                    >
                      {[-1, 0, 1].map((offset) => {
                        const monthDate = addMonthsSafe(selectedDate, offset);
                        //const monthDays = monthGridMonday(monthDate);
                        const monthDays = monthGridSunday(monthDate);
                        const thisMonthIdx = monthDate.getMonth();

                        const lastCellIdxOfThisMonth = (() => {
                          let last = 0;
                          for (let i = 0; i < monthDays.length; i++) {
                            if (monthDays[i].getMonth() === thisMonthIdx)
                              last = i;
                          }
                          return last;
                        })();
                        const lastRowIndex = Math.floor(
                          lastCellIdxOfThisMonth / 7
                        );
                        const actualRows = lastRowIndex + 1; // 4~6
                        //const compressLastRow = actualRows === 6;
                        const compressLastRow = false; // 6주여도 전부 동일 높이로

                        return (
                          <div
                            key={offset}
                            className="grid grid-cols-7 gap-1 px-1 py-1 box-border flex-shrink-0"
                            style={{
                              width: "calc(100% / 3)",
                              height: "100%",
                              gridTemplateRows: compressLastRow
                                ? `repeat(5, minmax(0,1fr)) minmax(0, 0.66fr)`
                                : "repeat(6, minmax(0,1fr))",
                            }}
                          >
                            {monthDays.map((d, i) => {
                              const rowIndex = Math.floor(i / 7);
                              const isHiddenRow = rowIndex >= actualRows;

                              const iso = fmt(d);
                              const isToday = iso === fmt(today);
                              const isSelected =
                                calHasSelection && iso === fmt(selectedDate);

                              const isOutside = d.getMonth() !== thisMonthIdx;

                              const activeName = tempName || myName;
                              const row = rowAtDateForNameWithOverride(
                                activeName,
                                d
                              );

                              const t = computeInOut(
                                row,
                                d,
                                holidaySet,
                                nightDiaThreshold
                              );
                              const diaLabel =
                                row?.dia == null
                                  ? "-"
                                  : (hasOverride(selectedDepot, d, activeName)
                                      ? "*"
                                      : "") +
                                    (typeof row.dia === "number"
                                      ? `${row.dia}D`
                                      : String(row.dia));

                              const dayType = getDayType(d, holidaySet);
                              const dayColor =
                                dayType === "토"
                                  ? "text-blue-400"
                                  : dayType === "휴"
                                  ? "text-red-400"
                                  : "text-gray-100";

                              const isLastRowCompressed =
                                compressLastRow && rowIndex === 5;

                              let diaColorClass = "";
                              if (selectedDepot === "교대") {
                                const label = (
                                  typeof row?.dia === "string" ? row.dia : ""
                                ).replace(/\s/g, "");
                                if (label === "주")
                                  diaColorClass = "text-yellow-300";
                                else if (label === "야")
                                  diaColorClass = "text-sky-300";
                                // "휴" 또는 그 외는 색 없음(기본)
                              } else {
                                if (typeof row?.dia === "number") {
                                  diaColorClass =
                                    row.dia >= nightDiaThreshold
                                      ? "text-sky-300"
                                      : "text-yellow-300";
                                } else if (
                                  typeof row?.dia === "string" &&
                                  row.dia.replace(/\s/g, "").startsWith("대")
                                ) {
                                  const nextDate = new Date(d);
                                  nextDate.setDate(d.getDate() + 1);
                                  const nextRow = rowAtDateForNameWithOverride(
                                    activeName,
                                    nextDate
                                  );
                                  const nextDia = nextRow?.dia;
                                  const nextIsBibeon =
                                    typeof nextDia === "string" &&
                                    nextDia.replace(/\s/g, "").includes("비번");
                                  diaColorClass = nextIsBibeon
                                    ? "text-sky-300"
                                    : "text-yellow-300";
                                }
                              }

                              return (
                                <button
                                  key={i}
                                  // ⬇️ 롱프레스: 꾸욱 누르면 근무변경 모달
                                  onTouchStart={(e) => {
                                    longPressDidFireRef.current = false;
                                    longPressActiveRef.current = true;
                                    clearTimeout(longPressTimerRef.current);
                                    longPressTimerRef.current = setTimeout(
                                      () => {
                                        if (!longPressActiveRef.current) return;
                                        longPressDidFireRef.current = true; // 이 터치의 onClick 무시
                                        const person = (
                                          tempName ||
                                          myName ||
                                          ""
                                        ).trim();
                                        setDutyModal({
                                          open: true,
                                          date: stripTime(d),
                                          name: person,
                                        });
                                      },
                                      LONG_MS
                                    );
                                  }}
                                  onTouchMove={(e) => {
                                    // 이동하면 롱프레스 취소 (필요시 이동량 체크 추가 가능)
                                    longPressActiveRef.current = false;
                                    clearTimeout(longPressTimerRef.current);
                                  }}
                                  onTouchEnd={(e) => {
                                    clearTimeout(longPressTimerRef.current);
                                    longPressActiveRef.current = false;
                                    // 롱프레스가 발동했으면 onClick에서 가드로 무시
                                  }}
                                  onClick={() => {
                                    // ⬅️ 롱프레스 직후 발생하는 클릭 이벤트 무시
                                    if (longPressDidFireRef.current) {
                                      longPressDidFireRef.current = false;
                                      return;
                                    }

                                    const iso2 = fmt(d);
                                    if (lastClickedRef.current === iso2) {
                                      // 두 번 탭 → 행로표 이동
                                      setRouteTargetName(
                                        tempName ? tempName : ""
                                      );
                                      setSelectedTab("route");
                                      setRoutePage(0);
                                      setDragYRoute(0);
                                    } else {
                                      // 한 번 탭 → 날짜 선택(파란 테두리)
                                      setSelectedDate(stripTime(d));
                                      lastClickedRef.current = iso2;
                                      setCalHasSelection(true);
                                    }
                                  }}
                                  className={
                                    "w-full h-full rounded-lg text-left relative " +
                                    (isHiddenRow
                                      ? " invisible pointer-events-none "
                                      : "") +
                                    (isOutside
                                      ? "bg-gray-800/40 opacity-60"
                                      : "bg-gray-700/60 hover:bg-gray-700") +
                                    (isSelected ? " ring-2 ring-blue-400" : "")
                                  }
                                  aria-hidden={isHiddenRow ? "true" : undefined}
                                  tabIndex={isHiddenRow ? -1 : 0}
                                  style={{
                                    padding: isLastRowCompressed
                                      ? `${0.5 * 0.66}rem`
                                      : "0.5rem",
                                  }}
                                  title={`${diaLabel} / ${t.combo}/${t.in}/${
                                    t.out
                                  }${t.isNight ? " (야간)" : ""}`}
                                >
                                  <div
                                    style={
                                      isLastRowCompressed
                                        ? {
                                            transform: `scale(0.66)`,
                                            transformOrigin: "top center",
                                            display: "flex",
                                            flexDirection: "column",
                                            height: "100%",
                                            justifyContent: "flex-start",
                                          }
                                        : undefined
                                    }
                                  >
                                    <div className="flex items-center justify-between">
                                      <div
                                        className={
                                          "font-semibold text-sm " + dayColor
                                        }
                                      >
                                        {d.getDate()}
                                      </div>
                                      {isToday && (
                                        <span className="absolute inset-0 rounded-lg ring-2 ring-red-400 pointer-events-none" />
                                      )}
                                    </div>

                                    <div
                                      className={
                                        "mt-1 text-[10px] leading-4 " +
                                        (isOutside
                                          ? "text-gray-300"
                                          : "text-gray-100")
                                      }
                                    >
                                      {/* DIA 숫자 */}
                                      <div
                                        className={`whitespace-nowrap text-[clamp(14px,2.8vw,15px)] leading-tight ${diaColorClass} mb-[4px]`}
                                      >
                                        {diaLabel}
                                      </div>

                                      {/* 출퇴근 시간 */}
                                      <div className="flex flex-col gap-[3px] leading-[1.08]">
                                        <div className="whitespace-nowrap text-[clamp(12px,2.6vw,12px)]">
                                          {t.in}
                                        </div>
                                        <div className="whitespace-nowrap text-[clamp(11px,2.6vw,12px)]">
                                          {t.out}
                                        </div>
                                      </div>

                                      {/*
      <div className="truncate text-[clamp(8px,1vw,11px)] max-w-[50px]">
        {t.isNight && selectedDepot !== "교대" ? (
          `${t.combo}`
        ) : (
          <span className="invisible">공백</span>
        )}
      </div>
      */}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Panel 1: 선택일 전체 교번 */}
                <div
                  ref={homePanelRefs[1]}
                  className="bg-gray-800 rounded-2xl p-3 shadow"
                  style={{ minHeight: slideViewportH }}
                >
                  {/* 1줄: 제목 + 날짜/요일/오늘로 */}
                  <div
                    className="flex items-center justify-between mb-2"
                    data-no-gesture
                  >
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <List className="w-5 h-5" /> 전체 교번
                    </h3>

                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="date"
                        className="bg-gray-700 rounded-xl px-2 py-1 text-sm"
                        value={fmt(selectedDate)}
                        onChange={(e) =>
                          setSelectedDate(stripTime(new Date(e.target.value)))
                        }
                        title="날짜 선택"
                      />
                      <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                        {weekdaysKR[(selectedDate.getDay() + 6) % 7]}
                      </span>
                      {fmt(selectedDate) !== fmt(today) && (
                        <button
                          className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs hover:bg-indigo-500 active:scale-[.98] transition"
                          onClick={() => setSelectedDate(stripTime(new Date()))}
                          title="오늘로"
                        >
                          오늘로
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 2줄: 보기 전환 */}
                  <div className="flex justify-end mb-2" data-no-gesture>
                    <button
                      className="rounded-full px-3 py-1 text-sm bg-cyan-600 text-white"
                      onClick={() =>
                        setOrderMode((m) => (m === "person" ? "dia" : "person"))
                      }
                      aria-pressed={orderMode === "dia"}
                      title={
                        orderMode === "dia"
                          ? "순번으로 보기"
                          : "DIA 순서로 보기"
                      }
                    >
                      {orderMode === "dia"
                        ? "순번으로 보기"
                        : "DIA 순서로 보기"}
                    </button>
                  </div>

                  {orderMode === "person" && (
                    <RosterGrid
                      rows={rosterAt(selectedDate)}
                      holidaySet={holidaySet}
                      date={selectedDate}
                      nightDiaThreshold={nightDiaThreshold}
                      highlightMap={highlightMap}
                      onPick={(name) => {
                        setRouteTargetName(name);
                        if (window.triggerRouteTransition)
                          window.triggerRouteTransition();
                        else setSelectedTab("route");
                      }}
                      selectedDepot={selectedDepot}
                      daySwipe={{
                        ref: swipeHomeP1.ref,
                        onStart: swipeHomeP1.onStart,
                        onMove: swipeHomeP1.onMove,
                        onEnd: swipeHomeP1.onEnd(goPrevDay, goNextDay),
                        style: swipeHomeP1.style,
                      }}
                      isOverridden={(name, d) =>
                        hasOverride(selectedDepot, d, name)
                      }
                    />
                  )}

                  {orderMode === "dia" && (
                    <RosterGrid
                      rows={diaGridRows}
                      holidaySet={holidaySet}
                      date={selectedDate}
                      nightDiaThreshold={nightDiaThreshold}
                      highlightMap={highlightMap}
                      onPick={(name) => {
                        setRouteTargetName(name);
                        if (window.triggerRouteTransition)
                          window.triggerRouteTransition();
                        else setSelectedTab("route");
                      }}
                      selectedDepot={selectedDepot}
                      daySwipe={{
                        ref: swipeHomeP1.ref,
                        onStart: swipeHomeP1.onStart,
                        onMove: swipeHomeP1.onMove,
                        onEnd: swipeHomeP1.onEnd(goPrevDay, goNextDay),
                        style: swipeHomeP1.style,
                      }}
                      isOverridden={(name, d) =>
                        hasOverride(selectedDepot, d, name)
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 전체 다이아 (독립 탭) — 초소형 정사각 그리드 */}
          {/* 전체 다이아 (독립 탭) — 초소형 정사각 그리드 */}
          {selectedTab === "roster" && (
            <div
              className="bg-gray-800 rounded-2xl p-3 shadow mt-4"
              style={{ minHeight: slideViewportH }}
            >
              {/* 1줄: 제목 + 날짜/요일/오늘로 */}
              <div
                className="flex items-center justify-between mb-2"
                data-no-gesture
              >
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <List className="w-5 h-5" /> 전체 교번
                </h2>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* 날짜 선택 */}
                  <input
                    type="date"
                    className="bg-gray-700 rounded-xl px-2 py-1 text-sm"
                    value={fmt(selectedDate)}
                    onChange={(e) =>
                      setSelectedDate(stripTime(new Date(e.target.value)))
                    }
                    title="날짜 선택"
                  />
                  {/* 요일 배지 */}
                  <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                    {weekdaysKR[(selectedDate.getDay() + 6) % 7]}
                  </span>
                  {/* 오늘로 (오늘이 아닐 때만) */}
                  {fmt(selectedDate) !== fmt(today) && (
                    <button
                      className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs hover:bg-indigo-500 active:scale-[.98] transition"
                      onClick={() => setSelectedDate(stripTime(new Date()))}
                      title="오늘로"
                    >
                      오늘로
                    </button>
                  )}
                </div>
              </div>

              {/* 2줄: 소속 + 보기 전환 */}
              <div
                className="flex items-center justify-between mb-2 gap-2 flex-wrap"
                data-no-gesture
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-300">소속</span>
                  <select
                    className="bg-gray-700 rounded-xl px-2 py-1 text-sm"
                    value={selectedDepot}
                    onChange={(e) => setSelectedDepot(e.target.value)}
                    title="소속 선택"
                  >
                    {DEPOTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="rounded-full px-3 py-1 text-sm bg-cyan-600 text-white"
                  onClick={() =>
                    setOrderMode((m) => (m === "person" ? "dia" : "person"))
                  }
                  aria-pressed={orderMode === "dia"}
                  title={
                    orderMode === "dia" ? "순번으로 보기" : "DIA 순서로 보기"
                  }
                >
                  {orderMode === "dia" ? "순번으로 보기" : "DIA 순서로 보기"}
                </button>
              </div>

              {orderMode === "person" && (
                <RosterGrid
                  rows={rosterAt(selectedDate)}
                  holidaySet={holidaySet}
                  date={selectedDate}
                  nightDiaThreshold={nightDiaThreshold}
                  highlightMap={highlightMap}
                  onPick={(name) => {
                    setRouteTargetName(name);
                    triggerRouteTransition();
                  }}
                  selectedDepot={selectedDepot}
                  daySwipe={{
                    ref: swipeRosterP0.ref,
                    onStart: swipeRosterP0.onStart,
                    onMove: swipeRosterP0.onMove,
                    onEnd: swipeRosterP0.onEnd(goPrevDay, goNextDay),
                    style: swipeRosterP0.style,
                  }}
                  isOverridden={(name, d) =>
                    hasOverride(selectedDepot, d, name)
                  }
                />
              )}

              {orderMode === "dia" && (
                <RosterGrid
                  rows={diaGridRows}
                  holidaySet={holidaySet}
                  date={selectedDate}
                  nightDiaThreshold={nightDiaThreshold}
                  highlightMap={highlightMap}
                  onPick={(name) => {
                    setRouteTargetName(name);
                    if (window.triggerRouteTransition)
                      window.triggerRouteTransition();
                    else setSelectedTab("route");
                  }}
                  selectedDepot={selectedDepot}
                  daySwipe={{
                    ref: swipeRosterP0.ref,
                    onStart: swipeRosterP0.onStart,
                    onMove: swipeRosterP0.onMove,
                    onEnd: swipeRosterP0.onEnd(goPrevDay, goNextDay),
                    style: swipeRosterP0.style,
                  }}
                  isOverridden={(name, d) =>
                    hasOverride(selectedDepot, d, name)
                  }
                />
              )}
            </div>
          )}

          {/* 행로표 */}
          {selectedTab === "route" && (
            <div
              ref={routeWrapRef}
              className="mt-4 select-none overflow-hidden rounded-2xl overscroll-contain"
              style={{
                height: slideViewportH,
                touchAction: isRouteLocked ? "none" : "pan-y",
              }}
              onTouchStart={vRoute.onStart}
              onTouchMove={vRoute.onMove}
              onTouchEnd={vRoute.onEnd}
              onTouchCancel={vRoute.onCancel}
              onWheel={(e) => {
                if (isRouteLocked) e.preventDefault();
                if (snapYRoute) return;
                const TH = 40;
                if (e.deltaY > TH && routePage < 3) {
                  setSnapYRoute(true);
                  setDragYRoute(-(routeWrapRef.current?.offsetHeight || 500));
                  setTimeout(() => {
                    setRoutePage((p) => Math.min(p + 1, 3));
                    setSnapYRoute(false);
                    setDragYRoute(0);
                  }, V_SNAP_MS);
                } else if (e.deltaY < -TH && routePage > 0) {
                  setSnapYRoute(true);
                  setDragYRoute(routeWrapRef.current?.offsetHeight || 500);
                  setTimeout(() => {
                    setRoutePage((p) => Math.max(p - 1, 0));
                    setSnapYRoute(false);
                    setDragYRoute(0);
                  }, V_SNAP_MS);
                }
              }}
            >
              <div
                className="relative"
                style={{
                  transform: `translateY(${
                    -routePage * slideViewportH + dragYRoute
                  }px)`,
                  transition: snapYRoute
                    ? `transform ${V_SNAP_MS}ms ease-out`
                    : "none",
                  willChange: "transform",
                }}
                onTransitionEnd={vRoute.onTransitionEnd}
              >
                {/* Panel 0: 행로 카드(요약+이미지) */}
                <div
                  id="route-panel0"
                  ref={routePanelRefs[0]}
                  className="bg-gray-800 rounded-2xl p-3 shadow shadow mb-10"
                  style={{ minHeight: slideViewportH }}
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <User className="w-5 h-5" /> 행로표 ({routeTarget})
                    </h2>
                    <div className="flex gap-2 items-center">
                      <select
                        className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                        value={selectedDepot}
                        onChange={(e) => setSelectedDepot(e.target.value)}
                      >
                        {DEPOTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>

                      <input
                        type="date"
                        className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                        value={fmt(selectedDate)}
                        onChange={(e) =>
                          setSelectedDate(stripTime(new Date(e.target.value)))
                        }
                        title="날짜 선택"
                      />

                      <span className="text-[11px] text-gray-300">{wk}</span>

                      {fmt(selectedDate) !== fmt(today) && (
                        <button
                          className="px-2 py-1 rounded-xl bg-indigo-500 text-white text-xs"
                          onClick={() => setSelectedDate(stripTime(new Date()))}
                          title="오늘로"
                        >
                          오늘로
                        </button>
                      )}

                      {routeTargetName && (
                        <button
                          className="px-2 py-1 rounded-xl bg-orange-700 hover:bg-gray-600 text-xs"
                          onClick={() => setRouteTargetName("")}
                          title="내 이름으로 보기"
                        >
                          내이름
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 대상 이름 변경(임시) */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm text-gray-300">대상 이름</span>
                    <select
                      className="bg-gray-700 rounded-xl p-1 text-sm"
                      value={routeTarget}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === myName) setRouteTargetName("");
                        else setRouteTargetName(v);
                      }}
                    >
                      {[myName, ...nameList.filter((n) => n !== myName)].map(
                        (n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div
                    className="p-3 rounded-xl bg-gray-900/60 text-sm mt-3"
                    ref={swipeRouteP0.ref}
                    onTouchStart={swipeRouteP0.onStart}
                    onTouchMove={swipeRouteP0.onMove}
                    onTouchEnd={swipeRouteP0.onEnd(goPrevDay, goNextDay)}
                    style={swipeRouteP0.style}
                  >
                    <div>
                      이름: <b>{routeTarget}</b> / Dia: <b>{routeDiaLabel}</b>
                    </div>
                    <div>
                      선택일: {fmtWithWeekday(selectedDate)} / 상태:{" "}
                      <b>{routeNote}</b>
                    </div>
                    <div className="mt-1">
                      출근: <b>{startHM ?? routeIn}</b> · 퇴근:{" "}
                      <b>{endHM ?? routeOut}</b>
                    </div>

                    {/* 행로표/셔틀 이미지 */}
                    {routeShowSrc && (
                      <div className="mt-2 rounded-xl overflow-hidden bg-black/30">
                        <div
                          className="relative w-full aspect-[1/1.414]"
                          onTouchStart={handleTouchStart}
                          onTouchEnd={handleTouchEnd}
                          onMouseDown={handleTouchStart}
                          onMouseUp={handleTouchEnd}
                        >
                          <img
                            src={routeShowSrc}
                            alt={routeShowBus ? "bus-timetable" : routeKeyStr}
                            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none transition-transform duration-500 ease-in-out"
                            style={{
                              transform:
                                routeShowBus ||
                                ["월배", "문양", "경산"].includes(selectedDepot)
                                  ? "none"
                                  : "scale(1.5) translateY(7.7%)",
                              transformOrigin: "center center",
                            }}
                          />

                          <div className="absolute top-2 right-2 px-2 py-1 rounded-lg text-[10px] font-semibold bg-gray-900/80 text-white">
                            {routeShowBus ? "셔틀 시간표" : "행로표"}
                          </div>

                          {selectedDepot !== "문양" &&
                            selectedDepot !== "경산" && (
                              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md text-[8px] bg-gray-900/70 text-white">
                                길게 눌러{" "}
                                {routeShowBus ? "행로표" : "셔틀 시간"} 보기
                              </div>
                            )}
                        </div>

                        <div className="text-xs text-gray-400 mt-1">
                          매칭: {selectedDepot} /{" "}
                          {routeShowBus ? busPathLabel : routeKeyStr}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Panel 1: 해당일 전체 교번 */}
                <div
                  ref={routePanelRefs[1]}
                  className="bg-gray-800 rounded-2xl p-3 shadow mb-16"
                  style={{ minHeight: slideViewportH }}
                >
                  {/* 1줄: 제목 + 날짜/요일/오늘로 */}
                  <div
                    className="flex items-center justify-between mb-2"
                    data-no-gesture
                  >
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <List className="w-5 h-5" /> 전체 교번
                    </h3>

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* 날짜 선택 */}
                      <input
                        type="date"
                        className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                        value={fmt(selectedDate)}
                        onChange={(e) =>
                          setSelectedDate(stripTime(new Date(e.target.value)))
                        }
                        title="날짜 선택"
                      />
                      {/* 요일 배지 */}
                      <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                        {wk}
                      </span>
                      {/* 오늘로 */}
                      {fmt(selectedDate) !== fmt(today) && (
                        <button
                          className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs hover:bg-indigo-500 active:scale-[.98] transition"
                          onClick={() => setSelectedDate(stripTime(new Date()))}
                          title="오늘로"
                        >
                          오늘로
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 2줄: 소속 + 보기 전환 */}
                  <div
                    className="flex items-center justify-between mb-2 gap-2 flex-wrap"
                    data-no-gesture
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-300">소속</span>
                      <select
                        className="bg-gray-700 rounded-xl px-2 py-1 text-sm"
                        value={selectedDepot}
                        onChange={(e) => setSelectedDepot(e.target.value)}
                        title="소속 선택"
                      >
                        {DEPOTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      className="rounded-full px-3 py-1 text-sm bg-cyan-600 text-white"
                      onClick={() =>
                        setOrderMode((m) => (m === "person" ? "dia" : "person"))
                      }
                      aria-pressed={orderMode === "dia"}
                      title={
                        orderMode === "dia"
                          ? "순번으로 보기"
                          : "DIA 순서로 보기"
                      }
                    >
                      {orderMode === "dia"
                        ? "순번으로 보기"
                        : "DIA 순서로 보기"}
                    </button>
                  </div>

                  {orderMode === "person" && (
                    <RosterGrid
                      rows={rosterAt(selectedDate)}
                      holidaySet={holidaySet}
                      date={selectedDate}
                      nightDiaThreshold={nightDiaThreshold}
                      highlightMap={highlightMap}
                      onPick={(name) => {
                        setRouteTargetName(name);
                        triggerRouteTransition();
                      }}
                      selectedDepot={selectedDepot}
                      daySwipe={{
                        ref: swipeRouteP1.ref,
                        onStart: swipeRouteP1.onStart,
                        onMove: swipeRouteP1.onMove,
                        onEnd: swipeRouteP1.onEnd(goPrevDay, goNextDay),
                        style: swipeRouteP1.style,
                      }}
                      isOverridden={(name, d) =>
                        hasOverride(selectedDepot, d, name)
                      }
                    />
                  )}

                  {orderMode === "dia" && (
                    <RosterGrid
                      rows={diaGridRows}
                      holidaySet={holidaySet}
                      date={selectedDate}
                      nightDiaThreshold={nightDiaThreshold}
                      highlightMap={highlightMap}
                      onPick={(name) => {
                        setRouteTargetName(name);
                        triggerRouteTransition();
                      }}
                      selectedDepot={selectedDepot}
                      daySwipe={{
                        ref: swipeRouteP1.ref,
                        onStart: swipeRouteP1.onStart,
                        onMove: swipeRouteP1.onMove,
                        onEnd: swipeRouteP1.onEnd(goPrevDay, goNextDay),
                        style: swipeRouteP1.style,
                      }}
                      isOverridden={(name, d) =>
                        hasOverride(selectedDepot, d, name)
                      }
                    />
                  )}
                </div>
                {/* Panel 2: 알람/일정(WakeIcsPanel) */}
                <div
                  ref={routePanelRefs[2]}
                  className="bg-gray-800 rounded-2xl p-3 shadow mb-16"
                  style={{ minHeight: slideViewportH }}
                >
                  {/* 헤더 */}
                  <div
                    className="flex items-center justify-between mb-2"
                    data-no-gesture
                  >
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <AlarmCheckIcon className="w-5 h-5" />
                      출근/중간(1/2)
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="date"
                        className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                        value={fmt(selectedDate)}
                        onChange={(e) =>
                          setSelectedDate(stripTime(new Date(e.target.value)))
                        }
                        title="날짜 선택"
                      />
                      <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                        {wk}
                      </span>
                      {fmt(selectedDate) !== fmt(today) && (
                        <button
                          className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs hover:bg-indigo-500 active:scale-[.98] transition"
                          onClick={() => setSelectedDate(stripTime(new Date()))}
                          title="오늘로"
                        >
                          오늘로
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 하루 좌우스와이프 래퍼 */}
                  <div
                    ref={swipeRouteP2.ref}
                    onTouchStart={swipeRouteP2.onStart}
                    onTouchMove={swipeRouteP2.onMove}
                    onTouchEnd={swipeRouteP2.onEnd(goPrevDay, goNextDay)}
                    style={swipeRouteP2.style}
                    className="rounded-xl bg-gray-900/60 p-3"
                  >
                    <WakeIcsPanel
                      dateObj={selectedDate}
                      who={routeTarget}
                      // 패널0에서 보여주는 출근값을 ‘시간’으로 정규화해서 전달
                      startHM={startHM ?? toHMorNull(routeIn)}
                      // 필요하면 퇴근도 같이
                      endHM={endHM ?? toHMorNull(routeOut)}
                      // 디버그/표시용 원문(시간이 없을 때 안내에 사용)
                      rawLabel={routeIn}
                    />
                  </div>
                </div>
                {/* Panel 3: 중간 알람(WakeMidPanel) */}
                <div
                  ref={routePanelRefs[3]}
                  className="bg-gray-800 rounded-2xl p-3 shadow mb-16"
                  style={{ minHeight: slideViewportH }}
                >
                  {/* 헤더 */}
                  <div
                    className="flex items-center justify-between mb-2"
                    data-no-gesture
                  >
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <AlarmCheckIcon className="w-5 h-5" />
                      출근/중간(2/2)
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="date"
                        className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                        value={fmt(selectedDate)}
                        onChange={(e) =>
                          setSelectedDate(stripTime(new Date(e.target.value)))
                        }
                        title="날짜 선택"
                      />
                      <span className="px-2 py-0.5 rounded-full bg-gray-700 text-gray-200 text-[11px]">
                        {wk}
                      </span>
                      {fmt(selectedDate) !== fmt(today) && (
                        <button
                          className="px-2 py-1 rounded-xl bg-indigo-600 text-white text-xs hover:bg-indigo-500 active:scale-[.98] transition"
                          onClick={() => setSelectedDate(stripTime(new Date()))}
                          title="오늘로"
                        >
                          오늘로
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 하루 좌우스와이프 래퍼 (있으면 적용) */}
                  <div
                    ref={swipeRouteP3.ref}
                    onTouchStart={swipeRouteP3.onStart}
                    onTouchMove={swipeRouteP3.onMove}
                    onTouchEnd={swipeRouteP3.onEnd(goPrevDay, goNextDay)}
                    style={swipeRouteP3.style}
                    className="rounded-xl bg-gray-900/60 p-3"
                  >
                    <WakeMidPanel
                      selectedDate={selectedDate}
                      selectedDepot={selectedDepot}
                      routeCombo={routeT?.combo || ""} // 예: "평-평"
                      routeDia={routeRow?.dia ?? null} // 숫자 또는 "대2"/"휴1"
                      row={routeRow} // TSV 1행(중간열 포함 가능)
                      shortcutName="교번-알람-만들기"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 비교(다중 사용자 동시 보기) */}
          {selectedTab === "compare" && (
            <CompareWeeklyBoard
              {...{
                selectedDepot,
                //setSelectedDepot,
                selectedDate,
                setSelectedDate,
                nameList,
                myName,
                holidaySet,
                nightDiaThreshold,
                monthGridMonday,
                //rowAtDateForName,
                computeInOut,
                compareSelected, // 이미 선택해둔 사람들 사용
                setCompareSelected, // ⬅ 추가
                slideViewportH,
                // 테이블/앵커/강조색 모두 전달
                tablesByDepot,
                anchorDateByDepot, // ✅ 이걸 넘깁니다
                highlightMap,
                overridesByDepot, // ✅ 추가
                labelTemplates, // ✅ 추가 (대근/휴/비번 시간 템플릿)
                diaTemplates, // ✅ 추가 (숫자 DIA 시간 템플릿)
                // ✨ 추가
              }}
            />
          )}

          {/* 설정 */}
          {selectedTab === "settings" && (
            <React.Suspense fallback={<div className="p-4">로딩…</div>}>
              <SettingsView
                {...{
                  selectedDepot,
                  setSelectedDepot,
                  myName,
                  setMyNameForDepot,
                  nameList,
                  // ✅ 선택된 소속의 기준일만 보여주고/수정
                  anchorDateStr: anchorDateByDepot[selectedDepot] ?? fmt(today),
                  setAnchorDateStr: (v) =>
                    setAnchorDateStrForDepot(selectedDepot, v),

                  holidaysText,
                  setHolidaysText,
                  newHolidayDate,
                  setNewHolidayDate,
                  nightDiaByDepot,
                  setNightDiaForDepot,
                  highlightMap,
                  setHighlightMap,
                  currentTableText,
                  setTablesByDepot, // 주의: { ...prev, [selectedDepot]: ... } 형태로 내부에서 사용
                  selectedDate,
                  setSelectedDate,
                  DEPOTS,
                  DEFAULT_HOLIDAYS_25_26,
                  onUpload, // 파일 업로드 핸들러도 그대로 넘김
                  buildGyodaeTable, // ← 추가
                  theme,
                  setTheme,
                }}
              />
            </React.Suspense>
          )}

          {/* 하단 고정 탭바 */}
          <FixedTabbarPortal>
            <nav
              ref={tabbarRef}
              className="bg-gray-900/90 backdrop-blur-md border-t border-gray-700 fixed left-0 right-0 bottom-0 pt-3 pb-[0]"
            >
              <div className="flex justify-around items-center text-gray-300 text-xs">
                {/* 홈 */}
                <button
                  onClick={() => {
                    const alreadyHome = selectedTab === "home";

                    // 공통: 홈 패널 초기화
                    setHomePage(0);
                    setDragYHome(0);
                    setSnapYHome(false);

                    if (alreadyHome) {
                      // 👉 오늘로 이동
                      const today = new Date();
                      today.setHours(0, 0, 0, 0); // stripTime
                      setSelectedDate(today);
                      return;
                    }

                    // 아직 홈이 아니면 홈 탭으로만 전환
                    setSelectedTab("home");
                  }}
                  className={`flex flex-col items-center ${
                    selectedTab === "home" ? "text-blue-400" : "text-gray-300"
                  }`}
                >
                  <CalendarIcon className="w-5 h-5 mb-0" />홈
                </button>

                {/* 전체 */}
                <button
                  onClick={() => setSelectedTab("roster")}
                  className={`flex flex-col items-center ${
                    selectedTab === "roster" ? "text-blue-400" : "text-gray-300"
                  }`}
                >
                  <List className="w-5 h-5 mb-0" />
                  전체
                </button>

                {/* 행로 */}
                <button
                  onClick={() => {
                    setRoutePage(0);
                    setDragYRoute(0);
                    setSnapYRoute(false);
                    setSelectedTab("route");
                  }}
                  className={`flex flex-col items-center ${
                    selectedTab === "route" ? "text-blue-400" : "text-gray-300"
                  }`}
                >
                  <RouteIcon className="w-5 h-5 mb-0" strokeWidth={1.75} />
                  행로
                </button>

                {/* 비교 */}

                <button
                  onClick={() => setSelectedTab("compare")}
                  className={`flex flex-col items-center ${
                    selectedTab === "compare"
                      ? "text-blue-400"
                      : "text-gray-300"
                  }`}
                >
                  <Users className="w-5 h-5 mb-0" />
                  그룹
                </button>
                {/* 설정 */}
                <button
                  onClick={() => setSelectedTab("settings")}
                  className={`flex flex-col items-center ${
                    selectedTab === "settings"
                      ? "text-blue-400"
                      : "text-gray-300"
                  }`}
                >
                  <Settings className="w-5 h-5 mb-0" />
                  설정
                </button>

                {/* 초기화 */}
                <button
                  onClick={resetAll}
                  className="flex flex-col items-center text-gray-400 hover:text-red-400"
                  title="저장된 설정/내용 초기화"
                >
                  <Upload className="w-5 h-5 mb-0 rotate-180" />
                  초기화
                </button>
              </div>
            </nav>
          </FixedTabbarPortal>
        </div>
        <DutyModal />
      </PasswordGate>
    </div>
  );
}
/* ---- 공통 컴포넌트 ---- */
function Header({ onReset }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="text-xl font-bold">교번 캘린더</div>
      <div className="flex items-center gap-2">
        <button
          onClick={onReset}
          className="ml-2 px-2 py-1 rounded-xl bg-gray-700 hover:bg-gray-600 text-xs"
          title="저장된 설정/내용 초기화"
        >
          초기화
        </button>
      </div>
    </div>
  );
}

function Tabs({ selectedTab, onChange }) {
  const tabs = [
    { k: "home", label: "홈(캘린더)" },
    { k: "roster", label: "전체교번" },
    { k: "route", label: "행로표" },
    { k: "settings", label: "설정" },
  ];
  return (
    <div className="flex gap-2">
      {tabs.map((t) => (
        <button
          key={t.k}
          onClick={() => onChange(t.k)}
          className={
            "px-3 py-1.5 rounded-2xl text-sm " +
            (selectedTab === t.k
              ? "bg-white text-gray-900"
              : "bg-gray-800 text-gray-200")
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* 초소형 정사각 그리드 카드 */
function RosterGrid({
  rows,
  holidaySet,
  date,
  nightDiaThreshold,
  highlightMap,
  onPick,
  daySwipe, // ⬅︎ 추가
  selectedDepot,
  isOverridden,
}) {
  const [selectedName, setSelectedName] = React.useState(null);

  return (
    <div
      className="grid gap-1"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))",
        ...(daySwipe?.style || {}), // ⬅︎ 추가
      }}
      ref={daySwipe?.ref} // ⬅︎ 추가
      onTouchStart={daySwipe?.onStart} // ⬅︎ 추가
      onTouchMove={daySwipe?.onMove} // ⬅︎ 추가
      onTouchEnd={daySwipe?.onEnd} // ⬅︎ 추가
    >
      {rows.map(({ name, row }) => {
        const t = computeInOut(row, date, holidaySet, nightDiaThreshold);
        const diaLabel =
          row?.dia == null
            ? "-"
            : (isOverridden?.(name, date) ? "*" : "") +
              (typeof row.dia === "number" ? String(row.dia) : String(row.dia));
        // 🔹 map 안에서 name 쓸 때, 버튼 바로 위에 추가
        const color = highlightMap?.[name];
        const isHighlighted = !!color;
        const style = isHighlighted
          ? {
              backgroundColor: color,
              color: "#ffffff",
              WebkitTextFillColor: "#ffffff",
              "--tw-text-opacity": "1",
            }
          : {};
        const isSelected = selectedName === name;

        return (
          <button
            key={name}
            onClick={(e) => {
              setSelectedName(name);
              //onPick?.(name);

              if (window.setRouteTargetName) {
                window.setRouteTargetName(name);
              }

              const btn = e.currentTarget;

              // 🍎 iOS 클릭 애니메이션 (완전 강화판)
              btn.animate(
                [
                  {
                    transform: "scale(1)",
                    filter: "brightness(1)",
                    opacity: 1,
                  },
                  {
                    transform: "scale(1.15)", // 눌렀을 때 살짝 커지며 반짝임
                    filter: "brightness(1.4)",
                    boxShadow: "0 0 18px rgba(255,255,255,0.9)",
                    opacity: 1,
                  },
                  {
                    transform: "scale(1)",
                    filter: "brightness(1)",
                    opacity: 1,
                  },
                ],
                {
                  duration: 300,
                  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                }
              );

              // 🚀 애니메이션이 완전히 끝난 뒤 전환 (눈에 확실히 보임)
              setTimeout(() => {
                if (window.triggerRouteTransition) {
                  window.triggerRouteTransition();
                }
              }, 130);
            }}
            className={
              "aspect-square w-full rounded-lg p-1.5 text-left transition-all duration-200 " +
              (isSelected
                ? "ring-4 ring-white/80 shadow-[0_0_10px_rgba(255,255,255,0.4)] "
                : "bg-gray-700/80 hover:bg-gray-600 hover:shadow-[0_0_6px_rgba(255,255,255,0.3)]") +
              (isHighlighted ? " roster-person-colored" : "")
            }
            style={style}
            title={`${name} • ${diaLabel} • ${t.combo}${
              t.isNight ? " (야)" : ""
            }`}
          >
            <div className="text-[11px] font-semibold whitespace-nowrap w-full text-center">
              {name}
            </div>

            <div className="text-[12px] font-extrabold text-gray-200 whitespace-nowrap">
              {diaLabel}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CompareWeeklyBoard({
  // 전역/외부 값 (변경 없음)
  selectedDepot, // 기본 소속(초기값용)
  selectedDate,
  setSelectedDate,
  nameList, // 현재 소속 이름 목록 (기존 그대로 넘어옴)
  myName,
  holidaySet,
  nightDiaThreshold,
  monthGridMonday,
  computeInOut,
  highlightMap,

  // 추가로 넘어오는 값들
  tablesByDepot, // {안심: tsv, ...} 모든 소속의 표 텍스트
  anchorDateByDepot,

  // 선택 인원 상태
  compareSelected,
  setCompareSelected,

  slideViewportH,
  overridesByDepot,
  labelTemplates,
  diaTemplates,
}) {
  /* ----------------------------
   * 0) 유틸: 소속별 파싱/인덱싱
   * ---------------------------- */

  // 근무변경 여부 체크
  const isOverridden = React.useCallback(
    (name, depot, date) => {
      const iso = fmt(stripTime(new Date(date)));
      return overridesByDepot?.[depot]?.[iso]?.[name] != null;
    },
    [overridesByDepot]
  );

  const parsedByDepot = React.useMemo(() => {
    const map = {};
    for (const depot of DEPOTS) {
      const text = tablesByDepot?.[depot] || "";
      const rows = parsePeopleTable(text);
      const nameMap = buildNameIndexMap(rows);
      map[depot] = {
        rows,
        nameMap,
        names: rows.map((r) => r.name).filter(Boolean),
      };
    }
    return map;
  }, [tablesByDepot]);

  // override + 회전 규칙 적용: (name, depot, date) → row(patched)
  const rowAtDateFor = React.useCallback(
    (name, depot, date) => {
      const pack = parsedByDepot[depot];
      if (!pack) return undefined;
      const { rows, nameMap } = pack;
      if (!nameMap.has(name) || rows.length === 0) return undefined;

      // 1) 회전으로 오늘 row 구하기
      const baseIdx = nameMap.get(name);
      const anchorStr = anchorDateByDepot?.[depot];
      const anchor = anchorStr
        ? stripTime(new Date(anchorStr))
        : stripTime(new Date());
      const dd = Math.floor((stripTime(date) - anchor) / 86400000);
      const idx = (((baseIdx + dd) % rows.length) + rows.length) % rows.length;
      const baseRow = rows[idx];

      // 2) override 값 조회
      const iso = fmt(stripTime(new Date(date)));
      const v = overridesByDepot?.[depot]?.[iso]?.[name];
      if (!v) return baseRow;

      const patched = { ...(baseRow || {}) };
      const applyTemplate = (tpl) => {
        if (!tpl) return;
        patched.weekday = { ...tpl.weekday };
        patched.saturday = { ...tpl.saturday };
        patched.holiday = { ...tpl.holiday };
      };

      // 1) 휴/비번
      if (v === "비번" || v === "휴") {
        patched.dia = v;
        applyTemplate(labelTemplates[v]);
        return patched;
      }

      // 2) 교육/휴가: 휴무 계열로 처리 (템플릿 없으면 무시간)
      if (v === "교육" || v === "휴가") {
        patched.dia = v;
        if (labelTemplates[v]) {
          applyTemplate(labelTemplates[v]);
        } else {
          patched.weekday = { in: "", out: "" };
          patched.saturday = { in: "", out: "" };
          patched.holiday = { in: "", out: "" };
        }
        return patched;
      }

      // 3) 대n (대근)
      if (/^대\d+$/.test(v)) {
        const n = Number(v.replace(/[^0-9]/g, ""));
        patched.dia = `대${n}`;
        const k = `대${n}`.replace(/\s+/g, "");
        applyTemplate(labelTemplates[k] || diaTemplates[n]);
        return patched;
      }

      // 4) '주' / '야'
      if (v === "주" || v === "야") {
        patched.dia = v;
        applyTemplate(labelTemplates[v]);
        return patched;
      }

      // 5) 'nD' 형식 (예: 21D)
      if (/^\d+D$/.test(v)) {
        const n = Number(v.replace("D", ""));
        if (Number.isFinite(n)) {
          patched.dia = n;
          applyTemplate(diaTemplates[n]);
        }
        return patched;
      }

      // 6) 숫자 DIA (그냥 "21" 같은 경우)
      if (/^\d+$/.test(String(v))) {
        const n = Number(v);
        patched.dia = n;
        applyTemplate(diaTemplates[n]);
        return patched;
      }

      // 7) 그 외 라벨은 표시만 교체 (시간은 원래대로)
      patched.dia = v;
      return patched;
    },
    [
      parsedByDepot,
      anchorDateByDepot,
      overridesByDepot,
      labelTemplates,
      diaTemplates,
    ]
  );

  /* -------------------------------------
   * 1) 선택 인원 정규화 + 그룹 구조
   * ------------------------------------- */

  const normalized = React.useMemo(() => {
    if (!Array.isArray(compareSelected) || compareSelected.length === 0) {
      return myName ? [{ name: myName, depot: selectedDepot }] : [];
    }
    return compareSelected.map((x) =>
      typeof x === "string" ? { name: x, depot: selectedDepot } : x
    );
  }, [compareSelected, myName, selectedDepot]);

  // 여러 그룹 상태: [{id, label, people}]
  const [groups, setGroups] = React.useState(() => {
    try {
      const saved = localStorage.getItem("compareGroups_v1");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("그룹 불러오기 실패", e);
    }

    // 저장된 것이 없으면 기본 1개 생성
    const basePeople =
      normalized.length > 0
        ? normalized
        : myName
        ? [{ name: myName, depot: selectedDepot }]
        : [];

    return [
      {
        id: "g1",
        label: "그룹 1",
        people: basePeople,
      },
    ];
  });

  React.useEffect(() => {
    try {
      localStorage.setItem("compareGroups_v1", JSON.stringify(groups));
    } catch (e) {
      console.error("그룹 저장 실패", e);
    }
  }, [groups]);

  const handleDeleteGroup = () => {
    if (!activeGroup) return;

    if (groups.length <= 1) {
      alert("마지막 그룹은 삭제할 수 없어요. 최소 1개는 남아 있어야 합니다.");
      return;
    }

    if (
      !window.confirm(
        `"${activeGroup.label}" 그룹을 삭제할까요? (사람 목록 포함)`
      )
    ) {
      return;
    }

    const nextGroups = groups.filter((g) => g.id !== activeGroup.id);
    setGroups(nextGroups);

    const nextActive = nextGroups[0] || null;
    setActiveGroupId(nextActive?.id || "");
    setCompareSelected(nextActive?.people || []);
    setEditingGroupId(null);
    setEditingLabel("");
  };

  const [activeGroupId, setActiveGroupId] = React.useState("g1");

  // 그룹 이름 편집 상태
  const [editingGroupId, setEditingGroupId] = React.useState(null);
  const [editingLabel, setEditingLabel] = React.useState("");

  const activeGroup =
    groups.find((g) => g.id === activeGroupId) || groups[0] || null;

  // 현재 페이지에서 실제로 표시할 사람들: active 그룹 기준
  const people = activeGroup ? activeGroup.people : [];

  // “모두 해제” → 현재 그룹을 내 이름만 남기기
  const resetToMine = React.useCallback(() => {
    if (!myName) return;
    const nextPeople = [{ name: myName, depot: selectedDepot }];
    setGroups((prev) => {
      if (!prev.length) return prev;
      const idxRaw = prev.findIndex((g) => g.id === activeGroupId);
      const idx = idxRaw === -1 ? 0 : idxRaw;
      const target = prev[idx] || prev[0];
      const nextGroups = [...prev];
      nextGroups[idx] = { ...target, people: nextPeople };
      return nextGroups;
    });
    setCompareSelected(nextPeople); // 외부 상태 동기화
  }, [myName, selectedDepot, activeGroupId, setCompareSelected]);

  // 개별 추가/삭제 (현재 선택된 그룹 기준)
  const addPerson = (name, depot) => {
    setGroups((prev) => {
      if (!prev.length) return prev;
      const idxRaw = prev.findIndex((g) => g.id === activeGroupId);
      const idx = idxRaw === -1 ? 0 : idxRaw;
      const target = prev[idx] || prev[0];
      const base = target.people || [];
      if (base.some((p) => p.name === name && p.depot === depot)) return prev;
      const nextPeople = [...base, { name, depot }];
      const nextGroups = [...prev];
      nextGroups[idx] = { ...target, people: nextPeople };
      setCompareSelected(nextPeople);
      return nextGroups;
    });
  };

  const removePerson = (name, depot) => {
    setGroups((prev) => {
      if (!prev.length) return prev;
      const idxRaw = prev.findIndex((g) => g.id === activeGroupId);
      const idx = idxRaw === -1 ? 0 : idxRaw;
      const target = prev[idx] || prev[0];
      const base = target.people || [];
      let nextPeople = base.filter(
        (p) => !(p.name === name && p.depot === depot)
      );
      if (nextPeople.length === 0 && myName) {
        nextPeople = [{ name: myName, depot: selectedDepot }];
      }
      const nextGroups = [...prev];
      nextGroups[idx] = { ...target, people: nextPeople };
      setCompareSelected(nextPeople);
      return nextGroups;
    });
  };

  /* --------------------------------
   * 2) 월→주(6주)로 쪼개기 + 헤더
   * -------------------------------- */

  const weeks = React.useMemo(() => {
    const days = monthGridMonday(selectedDate);
    const arr = [];
    for (let i = 0; i < days.length; i += 7) arr.push(days.slice(i, i + 7));
    return arr;
  }, [selectedDate, monthGridMonday]);

  // 헤더 높이 + “맨위로” 플래그
  const headerRef = React.useRef(null);
  const [headerH, setHeaderH] = React.useState(0);
  const forceTopRef = React.useRef(false);

  React.useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
    };
  }, []);

  // 선택 주 페이지 동기화
  const weekIndexOfSelected = React.useMemo(() => {
    const sel = fmt(selectedDate);
    const idx = weeks.findIndex((w) => w.some((d) => fmt(d) === sel));
    return idx < 0 ? 0 : idx;
  }, [weeks, selectedDate]);

  const [weekPage, setWeekPage] = React.useState(weekIndexOfSelected);
  React.useEffect(() => {
    if (forceTopRef.current) {
      forceTopRef.current = false;
      return;
    }
    setWeekPage(weekIndexOfSelected);
  }, [weekIndexOfSelected]);

  // 제스처(월 좌우 / 주 상하)
  const wrapRef = React.useRef(null);
  const [dragX, setDragX] = React.useState(0);
  const [dragY, setDragY] = React.useState(0);
  const [snapping, setSnapping] = React.useState(false);
  const gRef = React.useRef({ sx: 0, sy: 0, lock: null, lx: 0, ly: 0, t: 0 });
  const X_DIST = 40,
    Y_DIST = 40,
    VEL = 0.35,
    SNAP_MS = 300;

  // 수직 페이저(행 영역) 높이 = 화면 - 헤더
  const contentH = Math.max(160, slideViewportH - headerH - 8);

  const onTouchStart = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    gRef.current = {
      sx: t.clientX,
      sy: t.clientY,
      lock: null,
      lx: t.clientX,
      ly: t.clientY,
      t: performance.now(),
    };
    setSnapping(false);
    setDragX(0);
    setDragY(0);
  };
  const onTouchMove = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.touches[0];
    const dx = t.clientX - gRef.current.sx;
    const dy = t.clientY - gRef.current.sy;
    if (gRef.current.lock === null) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8)
        gRef.current.lock = "h";
      else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8)
        gRef.current.lock = "v";
    }
    if (gRef.current.lock === "h") {
      e.preventDefault();
      setDragX(dx);
    } else if (gRef.current.lock === "v") {
      e.preventDefault();
      setDragY(dy);
    }
    gRef.current.lx = t.clientX;
    gRef.current.ly = t.clientY;
    gRef.current.t = performance.now();
  };
  const onTouchEnd = (e) => {
    if (e.target.closest("[data-no-gesture]")) return;
    const t = e.changedTouches[0];
    const now = performance.now();
    const dt = Math.max(1, now - gRef.current.t);
    const vx = (t.clientX - gRef.current.lx) / dt;
    const vy = (t.clientY - gRef.current.ly) / dt;

    if (gRef.current.lock === "h") {
      const goNext = dragX < -X_DIST || vx < -VEL;
      const goPrev = dragX > X_DIST || vx > VEL;
      setSnapping(true);
      if (goNext) {
        setDragX(-(wrapRef.current?.offsetWidth || 320));
        setTimeout(() => {
          forceTopRef.current = true;
          setWeekPage(0);
          setDragY(0);
          setSelectedDate(addMonthsSafe(selectedDate, 1));
          setDragX(0);
          setSnapping(false);
        }, SNAP_MS);
      } else if (goPrev) {
        setDragX(wrapRef.current?.offsetWidth || 320);
        setTimeout(() => {
          forceTopRef.current = true;
          setWeekPage(0);
          setDragY(0);
          setSelectedDate(addMonthsSafe(selectedDate, -1));
          setDragX(0);
          setSnapping(false);
        }, SNAP_MS);
      } else {
        setDragX(0);
        setTimeout(() => setSnapping(false), SNAP_MS);
      }
    } else if (gRef.current.lock === "v") {
      const goNext = dragY < -Y_DIST || vy < -VEL;
      const goPrev = dragY > Y_DIST || vy > VEL;
      setSnapping(true);
      if (goNext && weekPage < weeks.length - 1) {
        setDragY(-contentH);
        setTimeout(() => {
          setWeekPage((p) => p + 1);
          setDragY(0);
          setSnapping(false);
        }, SNAP_MS);
      } else if (goPrev && weekPage > 0) {
        setDragY(contentH);
        setTimeout(() => {
          setWeekPage((p) => p - 1);
          setDragY(0);
          setSnapping(false);
        }, SNAP_MS);
      } else {
        setDragY(0);
        setTimeout(() => setSnapping(false), SNAP_MS);
      }
    } else {
      setDragX(0);
      setDragY(0);
    }
  };

  function jumpToToday() {
    const today = stripTime(new Date());
    setSelectedDate(today);

    // 오늘이 속한 주 index 계산(오늘 월 기준으로)
    const md = monthGridMonday(today);
    const weeksArr = [];
    for (let i = 0; i < md.length; i += 7) weeksArr.push(md.slice(i, i + 7));
    const idx = weeksArr.findIndex((w) => w.some((d) => fmt(d) === fmt(today)));

    setWeekPage(idx < 0 ? 0 : idx);
    setSnapping(true);
    setDragY(0);
    setTimeout(() => setSnapping(false), 300);
  }

  /* --------------------------------
   * 3) 사람 선택(다른 소속에서 불러오기)
   * -------------------------------- */

  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [filterText, setFilterText] = React.useState("");
  const [pickerDepot, setPickerDepot] = React.useState(selectedDepot);

  const selectableNames = React.useMemo(() => {
    const src = parsedByDepot[pickerDepot]?.names ?? [];
    const pickedKey = new Set(people.map((p) => `${p.depot}::${p.name}`));
    const list = src.filter(
      (n) =>
        !pickedKey.has(`${pickerDepot}::${n}`) &&
        (filterText.trim()
          ? n.toLowerCase().includes(filterText.trim().toLowerCase())
          : true)
    );
    return list;
  }, [parsedByDepot, pickerDepot, people, filterText]);

  // 표시 폭
  const NAME_COL_W = 80;
  const monthIdx = selectedDate.getMonth();
  const displayedWeekDays = weeks[weekPage] || [];

  // 오늘 ISO (로컬 기준)
  const todayISO = fmt(stripTime(new Date()));
  const isCurrentWeekHasToday = React.useMemo(
    () => displayedWeekDays.some((d) => fmt(d) === todayISO),
    [displayedWeekDays, todayISO]
  );

  const isTodayCell = React.useCallback(
    (d) => isCurrentWeekHasToday && fmt(d) === todayISO,
    [isCurrentWeekHasToday, todayISO]
  );

  // 오늘 컬럼 인덱스(헤더+바디 오버레이용)
  const todayColIndex = React.useMemo(() => {
    if (!isCurrentWeekHasToday) return -1;
    return displayedWeekDays.findIndex((d) => fmt(d) === todayISO);
  }, [isCurrentWeekHasToday, displayedWeekDays, todayISO]);

  // 헤더 월 라벨
  const monthLabel = `${selectedDate.getFullYear()}.${String(
    selectedDate.getMonth() + 1
  ).padStart(2, "0")}`;

  // 유틸 함수들
  function getContrastText(bg) {
    if (!bg) return "#fff";
    const c = bg.replace("#", "");
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 150 ? "#000" : "#fff";
  }
  function isSCodeDay(v) {
    return typeof v === "string" && /^s\s*[1-6]$/i.test(v.trim());
  }
  function hourFromStr(v) {
    if (typeof v !== "string") return null;
    const m = v.match(/^(\d{1,2})\s*:/);
    return m ? Number(m[1]) : null;
  }

  const goToday = React.useCallback(() => {
    const now = stripTime(new Date());
    const days = monthGridMonday(now);
    const wks = [];
    for (let i = 0; i < days.length; i += 7) wks.push(days.slice(i, i + 7));
    const idx = wks.findIndex((w) => w.some((d) => fmt(d) === fmt(now)));
    setSelectedDate(now);
    setWeekPage(idx < 0 ? 0 : idx);
    setDragX(0);
    setDragY(0);
    setSnapping(false);
    forceTopRef.current = false;
  }, [monthGridMonday, setSelectedDate]);

  /* ===== 현재 주(page) 실제 컨텐츠 높이 측정 ===== */
  const weekBodyRefs = React.useRef([]);
  const [bodyH, setBodyH] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = weekBodyRefs.current[weekPage];
    if (!el) return;
    const measure = () => setBodyH(el.offsetHeight || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      try {
        ro.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
    };
  }, [weekPage, people.length, weeks.length]);

  /* ==========================
   * 렌더
   * ========================== */

  // 화면 상단 요약용 정보들
  const start = displayedWeekDays[0];
  const end = displayedWeekDays[displayedWeekDays.length - 1];

  const rangeLabel = start && end ? `${fmt(start)} ~ ${fmt(end)}` : "";

  const personCount = people.length;

  return (
    <div
      ref={wrapRef}
      className="bg-gray-800 rounded-2xl p-3 shadow mt-4 select-none overflow-hidden"
      style={{ height: slideViewportH, touchAction: "manipulation" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* 1) 상단 바: 달 선택 / 그룹 선택 / 상단 접기 / 오늘 */}
      <div
        className="mb-2 flex items-center justify-between gap-2 text-[11px] text-gray-300"
        data-no-gesture
        style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
      >
        {/* (1) 달 선택 + 그룹 선택 */}
        <div className="flex items-center gap-2">
          {/* 달 선택 (기존 selectedDate 사용) */}
          <input
            type="month"
            className="bg-gray-900/70 border border-gray-800 rounded-lg px-2 py-1 text-xs text-gray-100"
            value={`${selectedDate.getFullYear()}-${String(
              selectedDate.getMonth() + 1
            ).padStart(2, "0")}`}
            onChange={(e) => {
              const v = e.target.value; // "YYYY-MM"
              if (!v) return;
              const [y, m] = v.split("-").map(Number);
              const next = new Date(selectedDate);
              next.setFullYear(y);
              next.setMonth(m - 1, 1);
              setSelectedDate(stripTime(next));
            }}
            title="월 선택"
          />

          {/* 그룹 선택 드롭다운 */}
          <select
            className="bg-gray-900/70 border border-gray-800 rounded-lg px-2 py-1 text-xs text-gray-100 max-w-[140px]"
            value={activeGroupId}
            onChange={(e) => {
              const id = e.target.value;
              setActiveGroupId(id);
              const g = groups.find((gg) => gg.id === id);
              setCompareSelected(g?.people || []);
            }}
            title="비교할 그룹 선택"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        {/* (2) 상단 접기 / 오늘 버튼 */}
        <div className="flex items-center gap-1">
          {/* 인원·그룹 관리 접기/펴기 토글 버튼 */}
          <button
            className="px-2 py-1 rounded-xl bg-gray-100 text-gray-900 text-xs"
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
          >
            {pickerOpen ? "상단 접기" : "인원·그룹 관리"}
          </button>

          {/* 오늘로 이동 버튼 (필요할 때만 표시) */}
          {(fmt(selectedDate) !== todayISO ||
            !displayedWeekDays.some((d) => fmt(d) === todayISO)) && (
            <button
              className="px-2 py-1 rounded-xl bg-indigo-600 text-xs text-white shadow-sm"
              type="button"
              onClick={jumpToToday}
              title="오늘로"
            >
              오늘로
            </button>
          )}
        </div>
      </div>

      {/* 2) 상세 제어 패널 (토글: pickerOpen) */}
      {pickerOpen && (
        <>
          {/* 2-1) 소속 + 월 선택 + 내 이름만 */}
          <div
            className="flex items-center justify-between gap-2 flex-wrap mb-2"
            data-no-gesture
            style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
          >
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-300">소속</label>
              <select
                className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                value={pickerDepot}
                onChange={(e) => setPickerDepot(e.target.value)}
                title="사람 추가용 소속 선택"
              >
                {DEPOTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <input
                type="month"
                className="bg-gray-700 rounded-xl px-2 py-1 text-xs"
                value={`${selectedDate.getFullYear()}-${String(
                  selectedDate.getMonth() + 1
                ).padStart(2, "0")}`}
                onChange={(e) => {
                  const v = e.target.value; // "YYYY-MM"
                  if (!v) return;
                  const [y, m] = v.split("-").map(Number);
                  const next = new Date(selectedDate);
                  next.setFullYear(y);
                  next.setMonth(m - 1, 1);
                  setSelectedDate(stripTime(next));
                }}
                title="월 선택"
              />
            </div>
          </div>

          {/* 2-2) 그룹 탭 + 그룹 관리 */}
          <div
            className="flex items-center justify-between gap-2 mb-2"
            data-no-gesture
            style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
          >
            {/* 그룹 탭들 */}
            <div className="flex flex-wrap gap-1">
              {groups.map((g) => {
                const isActive = g.id === activeGroupId;

                return (
                  <button
                    key={g.id}
                    onClick={() => setActiveGroupId(g.id)}
                    className={`flex items-center gap-1 px-3 py-1 rounded-full text-[11px] border transition-colors ${
                      isActive
                        ? "bg-indigo-600 text-white border-indigo-400"
                        : "bg-gray-700 text-gray-200 border-gray-500"
                    }`}
                    title={g.label}
                    type="button"
                  >
                    <span className="truncate max-w-[90px]">{g.label}</span>
                  </button>
                );
              })}
            </div>

            {/* 그룹 관리 버튼 묶음 */}
            <div className="flex items-center gap-1 text-[11px]">
              그룹:
              <button
                className="px-2 py-1 rounded-full bg-gray-700 text-xs text-white"
                type="button"
                onClick={() => {
                  setGroups((prev) => {
                    // 🔹 이미 쓰인 "그룹 N"들 모으기
                    const used = new Set(
                      prev.map((g) => g.label).filter(Boolean)
                    );

                    // 🔹 안 쓰인 번호 찾기 (그룹 1, 그룹 2, …)
                    let n = 1;
                    while (used.has(`그룹 ${n}`)) n += 1;

                    const label = `그룹 ${n}`;
                    const id = `g${Date.now()}_${n}`; // id는 대충 유니크하게

                    const newGroup = { id, label, people: [] };
                    const next = [...prev, newGroup];

                    setActiveGroupId(id);
                    setCompareSelected([]); // 새 그룹 선택 시 외부 상태 비우기

                    return next;
                  });
                }}
              >
                +추가
              </button>
              <button
                className="px-2 py-1 rounded-full bg-gray-600 text-white disabled:opacity-40"
                type="button"
                disabled={!activeGroup}
                onClick={() => {
                  if (!activeGroup) return;
                  setEditingGroupId(activeGroup.id);
                  setEditingLabel(activeGroup.label || "");
                }}
              >
                이름 변경
              </button>
              <button
                className="px-2 py-1 rounded-full bg-red-600 text-white disabled:opacity-40"
                type="button"
                disabled={!activeGroup || groups.length <= 1}
                onClick={handleDeleteGroup}
              >
                삭제
              </button>
            </div>
          </div>

          {/* 2-3) 그룹 이름 편집 영역 */}
          {editingGroupId && (
            <div
              className="mb-2 flex items-center gap-2"
              data-no-gesture
              style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
            >
              <input
                autoFocus
                className="flex-1 bg-gray-900 rounded-xl px-3 py-2 text-[12px] border border-indigo-400 text-white"
                placeholder="그룹 이름 입력…"
                value={editingLabel}
                onChange={(e) => setEditingLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = editingLabel.trim();
                    setGroups((prev) =>
                      prev.map((g) =>
                        g.id === editingGroupId
                          ? { ...g, label: trimmed || g.label }
                          : g
                      )
                    );
                    setEditingGroupId(null);
                    setEditingLabel("");
                  } else if (e.key === "Escape") {
                    setEditingGroupId(null);
                    setEditingLabel("");
                  }
                }}
              />
              <button
                className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-[12px]"
                type="button"
                onClick={() => {
                  const trimmed = editingLabel.trim();
                  setGroups((prev) =>
                    prev.map((g) =>
                      g.id === editingGroupId
                        ? { ...g, label: trimmed || g.label }
                        : g
                    )
                  );
                  setEditingGroupId(null);
                  setEditingLabel("");
                }}
              >
                저장
              </button>
              <button
                className="px-2 py-2 rounded-xl bg-gray-700 text-gray-200 text-[12px]"
                type="button"
                onClick={() => {
                  setEditingGroupId(null);
                  setEditingLabel("");
                }}
              >
                취소
              </button>
            </div>
          )}

          {/* 2-4) 이름 추가 패널 */}
          <div
            className="mt-1 p-2 rounded-xl bg-gray-900 shadow-lg border border-gray-700"
            data-no-gesture
            style={{ position: "relative", zIndex: 3, touchAction: "auto" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <input
                className="flex-1 bg-gray-700 rounded-xl px-2 py-1 text-sm"
                placeholder="이름 검색…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              <span className="text-xs text-gray-400">({pickerDepot})</span>
            </div>
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))",
              }}
            >
              {selectableNames.map((n) => {
                const bg = highlightMap?.[n] || "#374151";
                const fg = getContrastText(bg);
                return (
                  <button
                    key={`${pickerDepot}::${n}`}
                    onClick={() => addPerson(n, pickerDepot)}
                    className="px-1.5 py-0.5 rounded-md text-[11px] font-semibold truncate transition-opacity"
                    title={`${pickerDepot} • ${n} 추가`}
                    style={{
                      backgroundColor: bg,
                      color: fg,
                      border: "1px solid rgba(255,255,255,0.15)",
                      opacity: 0.95,
                    }}
                    type="button"
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 4) ===== 헤더 + 바디 래퍼 ===== */}
      <div className="relative mt-2" style={{ zIndex: 1 }}>
        {/* 오늘 컬럼 전체(헤더+바디) 테두리 오버레이 */}
        {todayColIndex >= 0 && (
          <div
            className="absolute pointer-events-none border-2 border-red-400 rounded-md"
            style={{
              top: 0,
              left: `calc(${NAME_COL_W}px + ${todayColIndex} * ((100% - ${NAME_COL_W}px) / 7))`,
              width: `calc((100% - ${NAME_COL_W}px) / 7)`,
              height: headerH + bodyH,
              zIndex: 4,
            }}
          />
        )}

        {/* 고정 헤더 */}
        <div ref={headerRef} style={{ position: "relative", zIndex: 2 }}>
          <div
            className="grid rounded-t-xl overflow-hidden"
            style={{
              gridTemplateColumns: `${NAME_COL_W}px repeat(7, minmax(0,1fr))`,
              pointerEvents: "none",
            }}
          >
            <div className="bg-white-1000 px-1 py-4 text-[17px] font-semibold border-r border-gray-700">
              <span className="opacity">{monthLabel}</span>
            </div>
            {displayedWeekDays.map((d) => {
              const dow = d.getDay();
              const iso = fmt(d);
              const outside = d.getMonth() !== monthIdx;
              const color =
                dow === 0
                  ? "text-red-400"
                  : dow === 6
                  ? "text-blue-400"
                  : "text-gray-100";
              return (
                <div
                  key={iso}
                  className={
                    "px-2 py-2 text-center text-sm font-semibold border-l border-gray-700 " +
                    (outside ? "text-gray-500" : color)
                  }
                  title={fmtWithWeekday(d)}
                >
                  <div>{d.getDate()}</div>
                  <div className="text-[11px] opacity-80">
                    {["일", "월", "화", "수", "목", "금", "토"][dow]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 수직 페이저(행 영역만 이동) */}
        <div
          className="relative"
          style={{
            height: contentH,
            transform: `translateY(${
              -weekPage * contentH + dragY
            }px) translateX(${dragX}px)`,
            transition: snapping ? "transform 300ms ease-out" : "none",
            willChange: "transform",
            zIndex: 1,
          }}
        >
          {weeks.map((weekDays, wi) => (
            <div
              key={"w" + wi}
              className="pb-4"
              style={{ minHeight: contentH }}
            >
              <div
                className="divide-y divide-gray-700 rounded-b-xl overflow-hidden"
                ref={(el) => (weekBodyRefs.current[wi] = el)}
              >
                {people.map(({ name, depot }) => (
                  <div
                    key={`${depot}::${name}`}
                    className="grid bg-gray-800/60 hover:bg-gray-800"
                    style={{
                      gridTemplateColumns: `${NAME_COL_W}px repeat(7, minmax(0,1fr))`,
                    }}
                  >
                    {/* 이름(해제) */}
                    <div className="px-2 py-1 border-r border-gray-700 flex items-center justify-between min-w-0">
                      <div
                        className="text-white font-semibold truncate text-[12px] min-w-0"
                        title={`${depot} • ${name}`}
                      >
                        {name}
                      </div>
                      <button
                        className="w-4 h-4 rounded-full bg-gray-700 hover:bg-gray-600 text-[10px] flex items-center justify-center flex-shrink-0 ml-0.5"
                        onClick={() => removePerson(name, depot)}
                        title={`${name} 해제`}
                        type="button"
                      >
                        −
                      </button>
                    </div>

                    {/* 7일 셀 */}
                    {weekDays.map((d) => {
                      const row = rowAtDateFor(name, depot, d);
                      const t = computeInOut(
                        row,
                        d,
                        holidaySet,
                        nightDiaThreshold
                      );

                      // 원래 DIA 라벨
                      const dia =
                        row?.dia === undefined
                          ? "-"
                          : typeof row.dia === "number"
                          ? row.dia
                          : String(row.dia).replace(/\s+/g, "");

                      // 화면 표시용 라벨
                      const diaLabel =
                        row?.dia == null
                          ? ""
                          : String(row.dia).replace(/\s+/g, "");
                      const finalLabel = isOverridden(name, depot, d)
                        ? diaLabel
                          ? `*${diaLabel}`
                          : "*"
                        : diaLabel || "-";

                      const outside = d.getMonth() !== monthIdx;

                      // 근무 상태 색상 판별
                      let bgColor = "bg-gray-800/60";
                      const norm = (v) =>
                        typeof v === "string" ? v.replace(/\s/g, "") : v;
                      const isOffDia = (v) =>
                        typeof v === "string" &&
                        (v.includes("비") || v.startsWith("휴"));
                      const isTime = (v) =>
                        typeof v === "string" &&
                        /^\d{1,2}\s*:\s*\d{2}$/.test(v);

                      const todayDia = norm(row?.dia);
                      const nextDay = addDaysSafe(d, 1);
                      const nextDia = norm(
                        rowAtDateFor(name, depot, nextDay)?.dia
                      );

                      if (isOffDia(todayDia)) {
                        bgColor = "bg-gray-800/60";
                      } else {
                        const MORNING_HOUR = 12;
                        const outH = hourFromStr(t.out);
                        let isNight = false;

                        if (depot === "교대") {
                          isNight =
                            todayDia === "야" &&
                            typeof nextDia === "string" &&
                            nextDia.startsWith("휴");
                        } else {
                          const nextIsBiban =
                            typeof nextDia === "string" &&
                            nextDia.includes("비");
                          const outIsMorning =
                            outH != null && outH <= MORNING_HOUR;
                          isNight = nextIsBiban || outIsMorning;
                        }

                        const hasWork =
                          (isTime(t.in) ||
                            isTime(t.out) ||
                            isSCodeDay?.(t.in) ||
                            isSCodeDay?.(t.out)) &&
                          !isNight;

                        if (isNight) bgColor = "bg-sky-500/30";
                        else if (hasWork) bgColor = "bg-yellow-500/30";
                        else bgColor = "bg-gray-800/60";
                      }

                      return (
                        <div
                          key={`${depot}::${name}_${fmt(d)}`}
                          className={`px-1 py-1 text-[11px] leading-tight border-l border-gray-700 ${bgColor} ${
                            outside ? "opacity-50" : ""
                          }`}
                          title={`${depot} • ${name} • ${fmtWithWeekday(
                            d
                          )} • DIA ${dia} / ${t.in}~${t.out}`}
                        >
                          <div className="font-semibold">{finalLabel}</div>
                          <div className="mt-0.5">{t.in || "-"}</div>
                          <div>{t.out || "-"}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-1 text-[10px] text-gray-400 text-center">
        ← 오른쪽: 다음달 / 왼쪽: 전달 · 위/아래: 주 변경
      </div>
    </div>
  );
}

function DiaOrderSections({ diaViewData, nightDiaThreshold }) {
  return (
    <div className="space-y-4">
      {/* 1) DIA 1 ~ 끝 */}
      <section>
        <h3 className="text-sm font-semibold opacity-80 mb-2">DIA 1 ~ 끝</h3>
        <ul className="grid grid-cols-1 gap-2">
          {diaViewData.work.map((e) => (
            <li
              key={`work-${e.name}`}
              className="flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-2"
            >
              <span className="font-medium">{e.name}</span>
              <span className="text-cyan-400 font-semibold">
                {e.diaNum} DIA
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 2) 비번: 전날 야간이면 '25~' 또는 '대5~'로 표기 */}
      <section>
        <h3 className="text-sm font-semibold opacity-80 mb-2">비번</h3>
        <ul className="grid grid-cols-1 gap-2">
          {diaViewData.biban.map((e) => {
            const tag = prevNightTag(
              e.yDiaNum,
              e.yPrevLabel,
              nightDiaThreshold
            );
            const isPrevNight = tag !== "비번";

            return (
              <li
                key={`biban-${e.name}`}
                className="flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-2"
              >
                <span className="font-medium">{e.name}</span>
                <span
                  className={`font-semibold ${
                    isPrevNight ? "text-sky-400" : "text-amber-400"
                  }`}
                >
                  {tag}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 3) 휴무 */}
      <section>
        <h3 className="text-sm font-semibold opacity-80 mb-2">휴무</h3>
        <ul className="grid grid-cols-1 gap-2">
          {diaViewData.holiday.map((e) => (
            <li
              key={`holiday-${e.name}`}
              className="flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-2"
            >
              <span className="font-medium">{e.name}</span>
              <span className="text-rose-400 font-semibold">휴</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FixedTabbarPortal({ children }) {
  const mountRef = React.useRef(null);

  // SSR 안전: document 있는 환경에서만 미리 엘리먼트 생성
  if (!mountRef.current && typeof document !== "undefined") {
    mountRef.current = document.createElement("div");
  }

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    // 포털 컨테이너 스타일
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.right = "0";
    el.style.bottom = "0";
    el.style.zIndex = "9999";
    el.style.width = "100%";
    el.style.pointerEvents = "none"; // 부모는 히트테스트 안 함(아래에서 자식에 auto 부여)
    el.style.transform = "translateY(0)";
    el.style.willChange = "transform";
    document.body.appendChild(el);

    const vv = window.visualViewport;

    const isEditableFocused = () => {
      const ae = document.activeElement;
      if (!ae) return false;
      const tag = (ae.tagName || "").toLowerCase();
      return (
        tag === "input" || tag === "textarea" || ae.isContentEditable === true
      );
    };

    const sync = () => {
      if (!vv) return;
      const layoutH = window.innerHeight; // 레이아웃 높이
      const visibleH = vv.height + vv.offsetTop; // 실가시 영역
      const deficit = Math.max(0, layoutH - visibleH);

      // 키보드가 확실히 올라온 상황에서만 보정
      const BIG_DEFICIT = 260;
      const looksLikeKeyboard = isEditableFocused() && deficit >= BIG_DEFICIT;

      el.style.transform = looksLikeKeyboard
        ? `translateY(${-deficit}px)`
        : "translateY(0)";
      el.style.bottom = "0px";
    };

    // 초기 동기화
    sync();

    // 리스너 등록
    const onResize = () => sync();
    const onScroll = () => sync();
    const onFocusIn = () => sync();
    const onFocusOut = () => setTimeout(sync, 0);

    vv?.addEventListener("resize", onResize, { passive: true });
    vv?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);

    return () => {
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      try {
        el.remove();
      } catch {}
    };
  }, []);

  // 부모는 pointer-events:none이므로, 자식 래퍼에 auto를 줘서 네비가 클릭 가능하게 함
  return mountRef.current
    ? createPortal(
        <div style={{ pointerEvents: "auto" }}>{children}</div>,
        mountRef.current
      )
    : null;
}
