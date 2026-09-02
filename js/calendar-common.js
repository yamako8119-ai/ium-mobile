/* ================================================================
 * calendar-common.js — 캘린더 "시간 그리드" 공용 판정기
 * ----------------------------------------------------------------
 * 같은 캘린더를 세 화면이 각자 그린다.
 *   · WeeklyPopup.html      — 주간 5일
 *   · messenger.html        — 오늘 일정 패널(하루)
 *   · public/mobile.html    — 모바일 "내 일정"(하루)
 *
 * 화면마다 폭·조작·데이터 출처가 달라서 HTML 생성까지 합치면 오히려 복잡해진다.
 * 그래서 여기엔 "무엇을 어디에 그릴지 정하는 계산"만 담는다 —
 * 시간 범위, 휴업일 판정, 겹치는 일정의 컬럼 배치, HTML 이스케이프.
 *
 * 이 판정들이 예전엔 세 벌로 복제돼 있었고, 한쪽만 고쳐서 화면마다 다른 그림이
 * 나오는 일이 반복됐다(초록 기타일정 중복, 정/부 감독 유실, 이스케이프 누락 등).
 * timetable-cell.js가 시간표 셀에서 같은 문제를 겪고 통합된 것과 같은 이유다.
 *
 * 🚨 이 파일을 고칠 때는 반드시 tests/calendar-common.test.js를 돌릴 것.
 * ================================================================ */
(function (root) {
  'use strict';

  // ── HTML 이스케이프 ───────────────────────────────────────────
  // 사람이 직접 입력하는 칸(일정 제목·장소·메모·체크리스트·학사일정)을 innerHTML
  // 템플릿에 넣기 전에 통과시킨다. 제목에 강조하려고 "<중요>"라고 적으면 태그로
  // 해석돼 글자가 통째로 사라졌다. '&'도 같은 이유로 막는다.
  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── 휴업일 판정 ───────────────────────────────────────────────
  // 학사일정 색이 빨강 계열이면 그날은 휴업일로 보고 시간표 유래 블록(수업·임장·
  // 공용교실 예약)을 숨긴다. 관리자 색상 팔레트가 주는 값이 세 가지뿐이라 목록으로 둔다.
  const HOLIDAY_COLORS = ['#e74c3c', '#ef4444', 'red'];
  function isHolidayColor(color) {
    return HOLIDAY_COLORS.indexOf(String(color || '').trim().toLowerCase()) !== -1;
  }

  // ── 시각 문자열 → 분 ──────────────────────────────────────────
  // "08:30" → 510. 값이 없거나 이상하면 fallback(분)을 돌려준다.
  function toMins(value, fallbackMins) {
    const parts = String(value || '').split(':');
    const h = Number(parts[0]), m = Number(parts[1]);
    if (!isFinite(h) || !isFinite(m)) return fallbackMins;
    return h * 60 + m;
  }

  // ── 학교 출퇴근 시간 → 캘린더 기본 시간 범위 ──────────────────
  //  · 시작 = 출근 −30분을 30분 경계로 내림
  //      08:30 → 08:00,  08:40 → 08:00,  09:00 → 08:30,  07:30 → 07:00
  //      정시나 반시에서 시작해야 시간 축이 읽힌다. 08:10 같은 시작은 애매하다.
  //  · 끝   = 퇴근을 시 단위로 올리되 18:00을 하한
  //      하한이 없으면 기본값(16:30)에서 화면이 지금보다 짧아진다.
  //  · 클램프 = 시작 05:00~12:00, 끝 ≤ 24:00, 최소 1시간 폭
  //      설정이 잘못 들어와도 레이아웃이 무너지지 않게 한다.
  function rangeFromWorkHours(workStart, workEnd) {
    const workIn  = toMins(workStart, 8 * 60 + 30);
    const workOut = toMins(workEnd,  16 * 60 + 30);
    let start = Math.floor((workIn - 30) / 30) * 30;
    let end   = Math.max(Math.ceil(workOut / 60) * 60, 18 * 60);
    start = Math.min(Math.max(start, 5 * 60), 12 * 60);
    end   = Math.min(Math.max(end, start + 60), 24 * 60);
    return { start: start, end: end };
  }

  // ── 실제 일정에 맞춘 범위 확장 ────────────────────────────────
  // 범위 밖 일정이 조용히 사라지는 걸 막는다(예전엔 필터로 지우거나 바닥에 겹쳐 그렸다).
  // 하단은 시 단위 올림, 상단은 30분 경계 내림 — 축 눈금과 어긋나지 않게.
  // spans는 [시작분, 종료분] 배열. 범위 안에만 있으면 기본값이 그대로 유지된다.
  function expandRange(base, spans) {
    let start = base.start, end = base.end;
    (spans || []).forEach(function (sp) {
      const a = sp[0], b = sp[1];
      if (isFinite(a) && a < start) start = Math.floor(a / 30) * 30;
      if (isFinite(b) && b > end)   end   = Math.ceil(b / 60) * 60;
    });
    start = Math.max(start, 0);
    end   = Math.min(Math.max(end, start + 60), 24 * 60);
    return { start: start, end: end };
  }

  // ── 겹치는 일정의 컬럼 배치 ───────────────────────────────────
  // 같은 시간대에 일정이 여러 개면 가로로 나눠 놓는다.
  //  1) 시작 시각순으로 정렬(같으면 긴 것 먼저 — 긴 일정이 왼쪽에 오는 게 읽기 좋다)
  //  2) 각 일정을 "비어 있는 가장 왼쪽 컬럼"에 넣는다
  //  3) 실제로 겹치는 것들끼리 묶어(연결요소), 그 묶음 안의 컬럼 수로 폭을 나눈다
  //     — 전체 최대 컬럼 수로 나누면, 하루에 한 번 3중 겹침이 있다는 이유로
  //       나머지 일정까지 전부 1/3 폭이 돼버린다.
  // 각 항목에 _col(0-based 컬럼)과 _cols(그 묶음의 컬럼 수)를 심고 정렬된 배열을 돌려준다.
  function layoutTracks(items) {
    const list = (items || []).slice().sort(function (a, b) {
      return a.startMins - b.startMins || b.endMins - a.endMins;
    });

    // 컬럼 그리디 배정: colEnds[c] = 그 컬럼에 마지막으로 놓인 일정의 종료 시각
    const colEnds = [];
    list.forEach(function (ev) {
      let c = colEnds.findIndex(function (end) { return end <= ev.startMins; });
      if (c === -1) { c = colEnds.length; colEnds.push(0); }
      ev._col = c;
      colEnds[c] = ev.endMins;
    });

    // Union-Find로 실제 겹치는 것들만 한 묶음으로
    const parent = list.map(function (_, i) { return i; });
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].startMins < list[j].endMins && list[j].startMins < list[i].endMins) {
          parent[find(i)] = find(j);
        }
      }
    }
    const groupMax = {};
    list.forEach(function (ev, i) {
      const g = find(i);
      groupMax[g] = Math.max(groupMax[g] || 0, ev._col);
    });
    list.forEach(function (ev, i) { ev._cols = (groupMax[find(i)] || 0) + 1; });

    return list;
  }

  const api = {
    escapeHtml: escapeHtml,
    isHolidayColor: isHolidayColor,
    HOLIDAY_COLORS: HOLIDAY_COLORS,
    toMins: toMins,
    rangeFromWorkHours: rangeFromWorkHours,
    expandRange: expandRange,
    layoutTracks: layoutTracks,
  };
  root.CalendarCommon = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
