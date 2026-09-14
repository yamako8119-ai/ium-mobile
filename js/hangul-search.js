/* ================================================================
 * hangul-search.js — 이름 검색 공용 판정기 (초성 검색)
 * ----------------------------------------------------------------
 * "홍길동"을 찾을 때 ㅎㄱㄷ 만 쳐도 걸리게 한다.
 *
 * 화면마다 검색칸이 따로 있고(메신저 조직도, 쪽지 수신자, 시간표 교사 목록,
 * 공용교실 예약, 모바일 …) 지금까지는 전부 name.includes(검색어) 였다.
 * 판정을 여기 하나로 모아두면 규칙을 한 번만 고쳐도 모든 창이 같이 바뀐다.
 *
 * 규칙
 *  1) 검색어에 초성 자모(ㄱ~ㅎ)가 하나도 없으면 예전과 100% 같다 — 단순 부분일치.
 *     (기존 동작을 건드리지 않는 게 이 파일의 첫 번째 계약이다.)
 *  2) 초성 자모가 섞이면 글자 단위로 비교한다. 초성 자모는 "그 초성으로 시작하는
 *     한글 음절"과 맞고, 그 밖의 글자는 예전처럼 그대로 같아야 한다.
 *     → "ㅎㄱㄷ", "홍ㄱㄷ", "ㅎ길동" 모두 홍길동에 걸린다.
 *  3) 된소리(ㄲㄸㅃㅆㅉ)는 Shift를 눌러야 나오므로 ㄱ으로도 ㄲ을 찾을 수 있게 열어둔다.
 *     반대로 ㄲ은 ㄲ만 찾는다(일부러 쳤다는 뜻이므로).
 *  4) 한글 IME는 조합 중에도 낱자를 그대로 흘려보낸다("바"를 치는 도중 ㅂ).
 *     그 낱자가 곧 초성 검색어가 되므로 타이핑 도중에도 결과가 자연스럽게 좁혀진다.
 *
 * 대소문자는 안에서 맞추므로 호출부에서 toLowerCase()를 이미 했든 안 했든 상관없다.
 *
 * 🚨 이 파일을 고칠 때는 반드시 tests/hangul-search.test.js를 돌릴 것.
 * ================================================================ */
(function (root) {
  'use strict';

  // 한글 음절 U+AC00~U+D7A3 = (초성 19) × (중성 21) × (종성 28)
  const SYL_BASE = 0xAC00;
  const SYL_LAST = 0xD7A3;
  const CHO_UNIT = 21 * 28;   // 초성 하나가 차지하는 코드 폭(588)

  // 초성 19개를 "호환 자모"(키보드로 치면 나오는 그 글자)로 적어둔 표.
  const CHO_LIST = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
    'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
  ];

  // 규칙 3) 예사소리로 된소리까지 찾게 해주는 표.
  const LOOSE_CHO = { 'ㄱ': 'ㄲ', 'ㄷ': 'ㄸ', 'ㅂ': 'ㅃ', 'ㅅ': 'ㅆ', 'ㅈ': 'ㅉ' };

  const CHO_SET = Object.create(null);
  CHO_LIST.forEach(function (c) { CHO_SET[c] = true; });

  function isChoJamo(ch) { return CHO_SET[ch] === true; }

  // 음절 한 글자의 초성. 한글 음절이 아니면 빈 문자열.
  function choOf(ch) {
    const code = ch.charCodeAt(0);
    if (code < SYL_BASE || code > SYL_LAST) return '';
    return CHO_LIST[Math.floor((code - SYL_BASE) / CHO_UNIT)];
  }

  // 문자열의 초성만 뽑는다. 한글이 아닌 글자(영문·숫자·공백)는 그대로 둔다.
  function chosungOf(text) {
    const s = String(text == null ? '' : text);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = choOf(s[i]);
      out += c || s[i];
    }
    return out;
  }

  // 검색어에 초성 자모가 하나라도 있는가 — 있을 때만 글자 단위 비교로 넘어간다.
  function hasChoJamo(q) {
    for (let i = 0; i < q.length; i++) if (isChoJamo(q[i])) return true;
    return false;
  }

  // text의 offset 위치에서 query가 시작되는가(초성 자모 허용).
  function matchAt(text, query, offset) {
    for (let i = 0; i < query.length; i++) {
      const q = query[i];
      const t = text[offset + i];
      if (t === undefined) return false;
      if (q === t) continue;                       // 완전히 같은 글자면 통과
      if (!isChoJamo(q)) return false;             // 초성 자모가 아니면 여기서 끝
      const c = choOf(t);
      if (!c) return false;                        // 한글 음절이 아니면 초성이 없다
      if (c === q) continue;
      if (LOOSE_CHO[q] === c) continue;            // ㄱ으로 ㄲ 찾기
      return false;
    }
    return true;
  }

  /**
   * 검색어가 대상 문자열에 걸리는가.
   * 빈 검색어는 항상 true — 호출부의 `!q || ...` 패턴을 그대로 대체할 수 있게.
   */
  function match(text, query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return true;

    const t = String(text == null ? '' : text).toLowerCase();
    if (!t) return false;

    if (t.indexOf(q) !== -1) return true;   // 예전과 같은 단순 부분일치
    if (!hasChoJamo(q)) return false;       // 초성이 없으면 더 볼 것도 없다

    const last = t.length - q.length;
    for (let i = 0; i <= last; i++) if (matchAt(t, q, i)) return true;
    return false;
  }

  /** 이름·과목처럼 여러 칸 중 하나만 걸려도 되는 경우. */
  function matchAny(texts, query) {
    const q = String(query == null ? '' : query).trim();
    if (!q) return true;
    const list = Array.isArray(texts) ? texts : [texts];
    for (let i = 0; i < list.length; i++) {
      if (list[i] == null || list[i] === '') continue;
      if (match(list[i], q)) return true;
    }
    return false;
  }

  const api = {
    match: match,
    matchAny: matchAny,
    chosungOf: chosungOf,
    isChoJamo: isChoJamo,
  };
  root.HangulSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
