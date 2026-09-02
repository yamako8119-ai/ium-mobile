/* ================================================================
 * timetable-cell.js — 교사/학급 시간표 "한 칸" 판정기 (공용)
 * ----------------------------------------------------------------
 * "이 (날짜, display_order)에 이 교사(또는 이 학급)가 뭘 하는가"를 결정하는
 * 로직만 담는다. HTML 생성(배지·클릭 핸들러·하이라이트·색상)은 화면마다
 * 다르므로 각 파일에 그대로 남긴다 — 전부 합치면 화면별 특수 처리 때문에
 * 오히려 더 복잡해진다.
 *
 * 이 판정이 예전엔 10곳에 복제돼 있었고, 하나만 고치면 나머지에서 그대로
 * 재발했다(하루에 같은 버그를 4번 겪은 적 있음). 기준은 TimetableViewerPopup.html의
 * buildCell — 교사들이 실제로 보는 화면이고 빌더(timetable_builder.html)의
 * 변동이 여기로 제대로 전달되는지 확인하며 만들어져 유일하게 검증돼 있다.
 *
 * 🚨 이 파일을 고칠 때는 반드시 tests/timetable-cell.test.js를 돌릴 것.
 * ================================================================ */
(function (root) {
  'use strict';

  // ── 임장(감독) 인스턴스 판정 ──────────────────────────────────
  // subject_name 접두사와 status 둘 다 봐야 한다. 접두사만 보면 status로만
  // 표시된 임장을 일반 수업으로 오인한다.
  function isSupInst(i) {
    return i.subject_name.startsWith('supervision_') || i.status === 'supervision';
  }

  // ── 가려진 normal 판정용 서명 ─────────────────────────────────
  // 수업을 다른 날짜/교시로 옮기면 서버는 원본 normal 행을 그대로 둔 채
  // vacated 행을 따로 INSERT한다(routes/timetable.js의 변동 저장). 그래서
  // 원래 자리를 그리면 normal과 vacated가 같이 잡히고, 안 거르면 "이사 갔는데
  // 원래 자리에 수업이 그대로" 보인다.
  // 반면 결강(absent)은 원본 행을 UPDATE하므로 이 문제가 안 생긴다 —
  // 가려진 normal은 오직 "수업 이사"에서만 발생한다.
  // 🔑 키 구성은 빌더·예약 팝업·모바일(public/mobile.html의 cloakSig)과
  //    문자 그대로 같아야 한다. 한쪽만 바꾸면 화면끼리 다른 걸 보여준다.
  function cloakSig(i, userKey) {
    const u = i[userKey || 'user_id'];
    return `${i.target_date}_${parseInt(i.period_num)}_${u}_${i.grade}_${i.class_num}_${i.subject_name}`;
  }

  // ── 가려진 normal id 집합 ─────────────────────────────────────
  // 1차 origin_instance_id 정확 매칭 → 2차 서명 폴백(구형 데이터).
  // 서명 폴백은 origin_instance_id가 없는 vacated에만 적용한다 — 전부에
  // 적용하면 origin이 가리키는 것과 다른 행까지 숨길 수 있다.
  function buildHiddenIds(instances, opts) {
    const o = opts || {};
    const idKey = o.idKey || 'id';
    const userKey = o.userKey || 'user_id';
    const asString = !!o.asString;
    const key = v => (asString ? String(v) : v);

    const hidden = new Set();
    instances.forEach(i => {
      if (i.status === 'vacated' && i.origin_instance_id != null) hidden.add(key(i.origin_instance_id));
    });
    const vacSigs = new Set();
    instances.filter(i => i.status === 'vacated' && i.origin_instance_id == null)
      .forEach(i => vacSigs.add(cloakSig(i, userKey)));
    instances.filter(i => i.status === 'normal').forEach(i => {
      if (vacSigs.has(cloakSig(i, userKey))) hidden.add(key(i[idKey]));
    });
    return hidden;
  }

  // ── 한 교시가 학년별로 "실제로 안 겹치는" 시간대로 갈리는지 ────
  // 인원이 많은 학교는 점심시간을 확보하려고 4교시 시각을 학년별로 갈라 놓는다
  // (1학년은 1~4교시 연달아, 2·3학년은 3교시 뒤 점심을 먹고 4교시).
  // 그런 교시는 "같은 4교시"라도 실제로는 서로 다른 시간대이므로,
  //   · 공용교실 예약: 같은 교실을 학년별로 동시에 잡을 수 있다
  //   · 공강 교사 확인: 다른 시간대에 수업 중인 교사를 바쁨으로 잡으면 안 된다
  // 화면은 이 결과로 칸을 분할한다.
  //
  // 반환: 갈리지 않으면(균일하거나 'all'만) null, 갈리면 시작 시각 순 그룹 배열.
  // 🚨 시각이 조금이라도 겹치면 null을 준다 — 겹치는 걸 분할하면 "동시에 쓸 수 있다"고
  //    잘못 알려주게 되므로, 확실히 안 겹칠 때만 나눈다.
  function computeTimeGroups(dayScheds, actualPeriod) {
    const rows = dayScheds.filter(s => parseInt(s.period_num) === actualPeriod && s.target_grade !== 'all');
    if (rows.length === 0) return null;
    const byTime = new Map();
    rows.forEach(r => {
      const key = `${r.start_time}~${r.end_time}`;
      if (!byTime.has(key)) byTime.set(key, { start_time: r.start_time, end_time: r.end_time, grades: [] });
      byTime.get(key).grades.push(parseInt(r.target_grade));
    });
    const groups = Array.from(byTime.values());
    groups.forEach(g => g.grades.sort((a, b) => a - b));
    groups.sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (groups.length <= 1) return null;
    const anyOverlap = groups.some((g1, i) => groups.some((g2, j) =>
      i !== j && g1.start_time < g2.end_time && g1.end_time > g2.start_time));
    if (anyOverlap) return null;
    return groups;
  }

  /**
   * 한 칸에 무엇을 보여줄지 판정한다.
   *
   * @param {object}   o
   * @param {Array}    o.instances    인스턴스 배열(학기 전체 또는 주간)
   * @param {Array}    o.dayScheds    이 날짜의 Daily_Schedules 행들
   * @param {string}   o.view         'teacher' | 'class'
   * @param {string}   o.targetId     teacher: user_id / class: 'grade-classNum'
   * @param {string}   o.dateStr
   * @param {number}   o.rowOrder     화면 줄 번호(display_order)
   * @param {Set}      [o.hiddenIds]  가려진 normal id 집합
   * @param {number[]} [o.groupGrades] 학년별 교시 시각으로 시간대가 갈릴 때, 확인하려는
   *                                   그룹의 학년 배열. 공강 찾기 그리드 전용.
   * @returns {object} 판정 결과 (HTML은 만들지 않는다)
   */
  function resolveCell(o) {
    const instances   = o.instances;
    const dayScheds   = o.dayScheds;
    const view        = o.view;
    const targetId    = String(o.targetId);
    const dateStr     = o.dateStr;
    const rowOrder    = o.rowOrder;
    const hiddenIds   = o.hiddenIds || new Set();
    const groupGrades = o.groupGrades || null;

    const isTeacher = view === 'teacher';

    // 🏫 [학년별 교시 시각] grade가 없는(0/null) 인스턴스는 학년 무관 활동이라
    // 어느 그룹의 시간대에 속하는지 알 수 없다 — 안전하게 모든 그룹에 포함시킨다.
    const inGroup = i => !groupGrades || !parseInt(i.grade) || groupGrades.includes(parseInt(i.grade));

    // ── 어떤 학년의 일과 행을 봐야 하는가 ────────────────────────
    // 빌더(timetable_builder.html의 isEventLocked)와 같은 스코프 규칙:
    // 그 학년의 행이 있으면 그 행들만 보고, 없을 때만 'all' 행으로 폴백한다.
    // 🚨 남의 학년 행은 절대 보지 않는다 — 학년별 교시 시각을 쓰는 날 다른 학년의
    //    일과를 자기 것으로 착각하게 된다.
    const gradeRowsFor = g => {
      const own = dayScheds.filter(s => String(s.target_grade) === String(g));
      return own.length > 0 ? own : dayScheds.filter(s => s.target_grade === 'all');
    };

    // ── 1. display_order → 실제 period_num 변환 + 슬롯 찾기 ──────
    let actualPeriod = rowOrder;
    let slotSched = null;

    if (!isTeacher) {
      const g = parseInt(targetId.split('-')[0]);
      const gs = dayScheds.find(s =>
        (parseInt(s.target_grade) === g || s.target_grade === 'all') &&
        parseInt(s.display_order) === rowOrder && parseInt(s.period_num) > 0
      );
      if (gs) { actualPeriod = parseInt(gs.period_num); slotSched = gs; }
    } else {
      // 🚨 'all' 행만 찾으면, 학년별 교시 시각으로 그 날 전체가 학년별로 나뉘어
      // ('all' 행이 아예 없는) 있을 때 actualPeriod가 rowOrder 그대로 남는다 —
      // 그러면 인스턴스 매칭도, 변경 알림 반짝임도 전부 엉뚱한 교시를 가리킨다.
      // 같은 display_order 안의 학년별 행은 항상 같은 period_num을 공유하므로
      // (교시 재배정이 그룹 전체를 함께 옮기도록 동기화됨) 아무 학년 행이나 정확하다.
      const bs = dayScheds.find(s =>
        s.target_grade === 'all' && parseInt(s.display_order) === rowOrder && parseInt(s.period_num) > 0
      ) || dayScheds.find(s =>
        parseInt(s.display_order) === rowOrder && parseInt(s.period_num) > 0
      );
      if (bs) { actualPeriod = parseInt(bs.period_num); slotSched = bs; }

      // 🏫 groupGrades가 있으면 그 그룹에 속한 학년의 행을 우선으로 slotSched를 잡는다 —
      // 안 그러면 다른 그룹의 기타일정 여부를 참조해 isEventSlot 판정이 틀어질 수 있다
      // (예: 2학년만 기타일정, 1·3학년은 정상 수업인 교시).
      if (groupGrades) {
        const gSlot = dayScheds.find(s =>
          parseInt(s.display_order) === rowOrder && groupGrades.includes(parseInt(s.target_grade))
        );
        if (gSlot) slotSched = gSlot;
      }
    }
    // slotSched가 없으면 display_order만 맞는 것으로 폴백
    if (!slotSched) slotSched = dayScheds.find(s => parseInt(s.display_order) === rowOrder) || null;

    let isEventSlot = !!(slotSched && slotSched.event_title && slotSched.event_title.trim() !== '');
    // ⚠️ eventSched는 "행사 제목을 실제로 들고 있는 행"이다. slotSched와 다를 수 있다 —
    // 아래 (2)에서 담당 학년 행사로 승격되면 slotSched는 행사가 없는 행을 계속 가리킨다.
    // 호출부는 행사명을 만들 때 slotSched가 아니라 반드시 eventSched를 봐야 한다.
    let eventSched = isEventSlot ? slotSched : null;
    let eventShortName = isEventSlot ? (slotSched.event_short_name || slotSched.event_title.slice(0, 3)) : '';

    // ── 2. 이 교시의 모든 학년이 기타일정 + 임장X 인지 (교사 뷰 녹색 블록용) ──
    let isAllGradeEvent = false;
    let allGradeEventShortName = '';
    if (isTeacher) {
      const periodScheds = dayScheds.filter(s =>
        parseInt(s.display_order) === rowOrder && parseInt(s.period_num) !== 0
      );
      isAllGradeEvent = periodScheds.length > 0 && periodScheds.every(s =>
        s.event_title && s.event_title.trim() !== '' && parseInt(s.is_separate) !== 1
      );
      if (isAllGradeEvent) {
        const s = dayScheds.find(x =>
          parseInt(x.display_order) === rowOrder && x.event_title && x.event_title.trim() !== ''
        );
        allGradeEventShortName = s ? (s.event_short_name || s.event_title.slice(0, 3)) : '';
      }
    }

    // ── 3. 이 교시가 그 날짜의 일과 범위를 벗어나는지 ────────────
    let outOfRange = false;
    if (dayScheds.length > 0) {
      // 🚨 [버그 수정] 학급 뷰는 그 학년의 일과만 봐야 한다. 예전엔 그 날 전체 학년을
      // 통틀어 최대 display_order를 썼는데, 학년별 단축으로 1학년만 4교시까지인 날
      // 5·6교시 줄이 "범위 안"으로 남아, 단축 전에 있던 인스턴스가 그 학급 화면에
      // 유령처럼 보였다(빌더는 그 줄을 아예 그리지 않는다).
      // 교사 뷰는 여러 학년을 넘나들므로 범위는 전체를 쓰고, 단축된 학년의 인스턴스는
      // 아래 5-(1)에서 학년별로 걷어낸다.
      const rangeRows = isTeacher
        ? dayScheds
        : gradeRowsFor(parseInt(targetId.split('-')[0]));
      if (rangeRows.length > 0) {
        const dayMax = Math.max(...rangeRows.map(s => parseInt(s.display_order) || 0));
        if (rowOrder > dayMax) outOfRange = true;
      }
    }
    if (outOfRange) {
      return {
        outOfRange: true, actualPeriod, slotSched, eventSched,
        isEventSlot, eventShortName, isAllGradeEvent, allGradeEventShortName,
        raw: [], display: [], hasVacated: false, hasReinf: false,
        supItems: [], regItems: [], dedupedReg: [], ordered: [], isConflict: false,
      };
    }

    // ── 4. 인스턴스 수집 ────────────────────────────────────────
    let raw;
    if (isTeacher) {
      // 학년마다 display_order→period_num 매핑이 다를 수 있으므로 grade-specific 수집
      const gpm = {};
      dayScheds.forEach(s => {
        if (s.target_grade === 'all' || parseInt(s.period_num) <= 0) return;
        if (parseInt(s.display_order) !== rowOrder) return;
        gpm[String(s.target_grade)] = parseInt(s.period_num);
      });
      const hasGS = Object.keys(gpm).length > 0;
      raw = instances.filter(i => {
        if (String(i.user_id) !== targetId || i.target_date !== dateStr) return false;
        if (!inGroup(i)) return false;
        const g = String(i.grade);
        if (!hasGS) return parseInt(i.period_num) === actualPeriod;
        if (gpm[g] !== undefined) return parseInt(i.period_num) === gpm[g];
        // 이 학년의 일과 데이터는 있지만 이 행에 슬롯이 없음 → 단축/범위 초과 → 제외
        if (dayScheds.some(s => String(s.target_grade) === g)) return false;
        return parseInt(i.period_num) === actualPeriod;
      });
    } else {
      const parts = targetId.split('-');
      raw = instances.filter(i =>
        String(i.grade) === parts[0] && String(i.class_num) === parts[1] &&
        i.target_date === dateStr &&
        parseInt(i.period_num) === actualPeriod
      );
    }

    // ── 5. 학년별 일과가 분리된 경우 (교사 뷰) ──────────────────
    if (isTeacher) {
      // (1) 담당 학년이 단축돼 이 rowOrder가 범위를 벗어나면 인스턴스 제거
      const shortenedGrades = new Set();
      raw.filter(i => parseInt(i.grade) > 0).forEach(i => {
        const gradeStr = String(i.grade);
        const gScheds = dayScheds.filter(s => String(s.target_grade) === gradeStr);
        if (gScheds.length > 0) {
          const maxDo = Math.max(...gScheds.map(s => parseInt(s.display_order) || 0));
          const isMapped = gScheds.some(s =>
            parseInt(s.period_num) === parseInt(i.period_num) && parseInt(s.period_num) > 0
          );
          if (rowOrder > maxDo && !isMapped) shortenedGrades.add(gradeStr);
        }
      });
      if (shortenedGrades.size > 0) raw = raw.filter(i => !shortenedGrades.has(String(i.grade)));

      // (2) 교사의 실제 담당 학년이 행사 교시면 isEventSlot 승격
      if (!isEventSlot) {
        const teacherGrades = raw
          .filter(i => parseInt(i.grade) > 0 && i.status !== 'vacated' && i.status !== 'absent')
          .map(i => String(i.grade));
        if (teacherGrades.length > 0) {
          const gradeEvSched = dayScheds.find(s =>
            teacherGrades.includes(String(s.target_grade)) &&
            parseInt(s.display_order) === rowOrder &&
            s.event_title && s.event_title.trim() !== ''
          );
          if (gradeEvSched) {
            isEventSlot = true;
            eventSched = gradeEvSched;
            eventShortName = gradeEvSched.event_short_name || gradeEvSched.event_title.slice(0, 3);
          }
        }
      }
    }

    // ── 6. 임장/일반 수업 정리 ──────────────────────────────────
    // 일과시간 변경으로 같은 period_num을 가진 수업 슬롯과 행사 슬롯이 공존할 때 중복 방지.
    // Daily_Schedules의 event_title 누락 방어: 임장은 event_title이 안 붙은 교시에도
    // 배정될 수 있으므로(실제 사례: '창체'), 임장 인스턴스가 있으면 event slot처럼 취급한다.
    // 📌 [학년별로 나누지 않는 이유] 빌더는 인스턴스마다 그 수업의 학년으로 행사 여부를
    // 따지는데(isEventLocked) 여기는 슬롯 단위로 한 번에 감춘다. 둘이 갈리려면 한 교사가
    // 같은 교시에 서로 다른 학년 수업을 가져야 하는데, 그런 시간표는 만들지 않는다 —
    // 학년별 교시 시각으로 시각이 실제로 안 겹치더라도 마찬가지다. 수업 변동에서 "4교시"는
    // 학년과 무관하게 같은 4교시로 취급해야 변동·점심시간 조정이 중복 없이 흘러가기
    // 때문이다. 그래서 실데이터에서 두 판정은 항상 같은 답을 낸다.
    if (isEventSlot) {
      raw = raw.filter(isSupInst);
    } else {
      const hasSuperInRaw = raw.some(isSupInst);
      const hasSeparateEventSlot = dayScheds.some(s =>
        parseInt(s.period_num) === actualPeriod &&
        s.event_title && s.event_title.trim() !== '' &&
        parseInt(s.display_order) !== rowOrder
      );
      if (hasSeparateEventSlot) {
        // 경쟁하는 행사 슬롯이 따로 있음 → 임장은 그 자리에서 표시하고 여기선 제거
        raw = raw.filter(i => !isSupInst(i));
      } else if (hasSuperInRaw) {
        // 임장이 있고 경쟁 행사 슬롯 없음 → 임장만 표시 (일반 수업 제거)
        raw = raw.filter(isSupInst);
      }
    }

    // ── 7. 고정 수업(fixed_) 결강 처리 ──────────────────────────
    // 고정수업(선택수업 등)은 학급 수만큼 행이 있는데 결강은 그중 대표 한 행에만
    // 표시된다. 같은 subject_name의 vacated/absent가 있으면 나머지 normal도 숨긴다.
    const vacatedFixedSubs = new Set(
      raw.filter(i => (i.status === 'vacated' || i.status === 'absent') && i.subject_name.startsWith('fixed_'))
        .map(i => i.subject_name)
    );
    // 교사 뷰 전용: 이 교사가 changed_user_id인 reinforcement가 있으면(= 고정 수업 보강 지정됨)
    const reinforcedFixedSubs = isTeacher ? new Set(
      instances.filter(i =>
        i.status === 'reinforcement' &&
        i.target_date === dateStr &&
        parseInt(i.period_num) === actualPeriod &&
        String(i.changed_user_id) === targetId &&
        i.subject_name.startsWith('fixed_') &&
        inGroup(i)
      ).map(i => i.subject_name)
    ) : new Set();

    const isFixedAbsent = sub =>
      sub.startsWith('fixed_') && (vacatedFixedSubs.has(sub) || reinforcedFixedSubs.has(sub));

    const hasVacated =
      raw.some(i => i.status === 'vacated' || i.status === 'absent') ||
      raw.some(i => i.status === 'normal' && isFixedAbsent(i.subject_name));

    // ── 8. 표시할 인스턴스 ──────────────────────────────────────
    const display = raw.filter(i => {
      if (i.status === 'vacated' || i.status === 'absent') return false;
      if (i.status === 'normal' && hiddenIds.has(i.id)) return false;
      if (i.status === 'normal' && isFixedAbsent(i.subject_name)) return false;
      return true;
    });

    // ── 9. 결강 칸에 보강이 배정됐는지 ──────────────────────────
    const vacatedInst = raw.find(i => i.status === 'absent') || raw.find(i => i.status === 'vacated');
    const hasReinf = !!(reinforcedFixedSubs.size > 0 || (vacatedInst && instances.some(i =>
      i.status === 'reinforcement' &&
      i.target_date === dateStr &&
      parseInt(i.period_num) === actualPeriod &&
      (
        (String(i.grade) === String(vacatedInst.grade) && String(i.class_num) === String(vacatedInst.class_num)) ||
        (vacatedInst.subject_name.startsWith('fixed_') && String(i.changed_user_id) === String(vacatedInst.user_id))
      )
    )));

    // ── 10. 임장 우선 정렬 + 합동 고정수업 중복 제거 ────────────
    // 🩺 [정/부 감독] 한 학급에 임장 인스턴스가 2개 이상(정+부)이면 id가 가장 작은(=정)
    // 것을 대표로 쓴다 — routes/supervision.js의 배포 라우트가 정을 항상 부보다 낮은
    // id로 저장하도록 보장한다.
    const supItems = display.filter(isSupInst).sort((a, b) => a.id - b.id);
    const regItems = display.filter(i => !isSupInst(i));
    const ordered = supItems.concat(regItems);

    // fixed_ 합동 수업은 같은 subject_name이 여러 인스턴스로 존재하는 게 정상 → 1개로 취급
    const seenFixed = new Set();
    const dedupedReg = regItems.filter(i => {
      if (i.subject_name.startsWith('fixed_')) {
        if (seenFixed.has(i.subject_name)) return false;
        seenFixed.add(i.subject_name);
      }
      return true;
    });

    return {
      outOfRange: false,
      actualPeriod, slotSched, eventSched,
      isEventSlot, eventShortName,
      isAllGradeEvent, allGradeEventShortName,
      raw, display, hasVacated, hasReinf,
      supItems, regItems, dedupedReg, ordered,
      isConflict: dedupedReg.length > 1,
    };
  }

  const api = { resolveCell, isSupInst, cloakSig, buildHiddenIds, computeTimeGroups };
  Object.keys(api).forEach(k => { root[k] = api[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
