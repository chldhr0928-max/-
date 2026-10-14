const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script id="task-core">([\s\S]*?)<\/script>/)[1];
const C = vm.runInNewContext(source + '\nTaskCore;');
const t1 = '2026-10-14T03:00:00.000Z';
const t2 = '2026-10-14T03:01:00.000Z';
const plain = value => JSON.parse(JSON.stringify(value));
const add = (state = C.empty(), id = 'a', date = '2026-10-14') => C.add(state, {date, title:'이자 납입 확인', memo:'통장 내역 확인'}, id, t1);

test('날짜 검증 및 월말·연말·윤년 이월 계산', () => {
  for (const date of ['2026-02-29','2026-02-30','2026-13-01','1899-12-31','2026-1-01','2026-10-00',null]) assert.equal(C.validDate(date), false);
  assert.equal(C.validDate('2028-02-29'), true);
  assert.equal(C.shiftDate('2026-01-31', 1), '2026-02-01');
  assert.equal(C.shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(C.shiftDate('2028-02-28', 1), '2028-02-29');
  assert.equal(C.shiftDate('2028-02-29', 1), '2028-03-01');
  assert.throws(() => C.shiftDate('9999-12-31',1));
  assert.throws(() => C.shiftDate('1900-01-01',-1));
});
test('날짜별 등록, 완료 체크, 완료 취소와 데이터 불변성', () => {
  const initial = C.empty(), first = add(initial), second = add(first,'b','2026-10-15');
  assert.equal(initial.tasks.length, 0);
  assert.equal(C.rowsForDate(second,'2026-10-14').length, 1);
  assert.equal(C.rowsForDate(second,'2026-10-15').length, 1);
  const done = C.toggle(second,'a',t2);
  assert.equal(done.tasks[0].status, 'done');
  assert.equal(done.tasks[0].completedAt, t2);
  assert.equal(second.tasks[0].status, 'pending');
  const pending = C.toggle(done,'a',t2);
  assert.equal(pending.tasks[0].status, 'pending');
  assert.equal(pending.tasks[0].completedAt, null);
});
test('이월은 중복 없이 원래 날짜에 기록을 남기며 반복 이월 연결을 유지한다', () => {
  const first = add(), moved = C.carry(first,'a','2026-10-15',t2);
  assert.equal(moved.tasks.length, 1);
  assert.equal(moved.tasks[0].date, '2026-10-15');
  assert.equal(C.rowsForDate(moved,'2026-10-14')[0].rowStatus, 'carried');
  assert.equal(C.rowsForDate(moved,'2026-10-15')[0].rowStatus, 'pending');
  const again = C.carry(moved,'a','2026-10-19',t2);
  assert.equal(again.tasks.length, 1);
  assert.equal(again.tasks[0].history.length, 2);
  assert.equal(C.rowsForDate(again,'2026-10-14')[0].to, '2026-10-15');
  assert.equal(C.rowsForDate(again,'2026-10-14')[0].currentDate, '2026-10-19');
  assert.equal(C.rowsForDate(again,'2026-10-15')[0].rowStatus, 'carried');
  assert.equal(first.tasks[0].history.length, 0);
});
test('완료 업무·동일 날짜·과거 날짜·없는 업무의 이월을 거부한다', () => {
  const state = add();
  for (const date of ['2026-10-14','2026-10-13','2026-02-30']) assert.throws(() => C.carry(state,'a',date,t2));
  assert.throws(() => C.carry(C.toggle(state,'a',t2),'a','2026-10-15',t2));
  assert.throws(() => C.carry(state,'unknown','2026-10-15',t2));
});
test('업무 수정이 이전 날짜의 이월 당시 제목과 메모를 바꾸지 않는다', () => {
  const moved = C.carry(add(),'a','2026-10-15',t2);
  const edited = C.edit(moved,'a',{title:'변경된 업무',memo:'새 메모'},t2);
  assert.equal(edited.tasks[0].title,'변경된 업무');
  assert.equal(C.rowsForDate(edited,'2026-10-14')[0].title,'이자 납입 확인');
  assert.equal(C.rowsForDate(edited,'2026-10-14')[0].memo,'통장 내역 확인');
});
test('백업과 복원은 전체 날짜·완료 상태·이월 기록을 보존한다', () => {
  let state = add();
  state = add(state,'b','2026-10-15');
  state = C.toggle(state,'b',t2);
  state = C.carry(state,'a','2026-10-16',t2);
  const raw = C.exportBackup(state,t2);
  assert.deepEqual(plain(C.importBackup(raw)), plain(state));
  assert.deepEqual(plain(C.importBackup('\uFEFF' + raw)), plain(state));
  assert.equal(JSON.parse(raw).exportedAt,t2);
});
test('백업 삭제 후 복원은 삭제된 업무와 이월 기록도 되살린다', () => {
  const state = C.carry(add(),'a','2026-10-15',t2);
  const backup = C.exportBackup(state,t2), deleted = C.remove(state,'a');
  assert.equal(deleted.tasks.length,0);
  assert.equal(C.rowsForDate(deleted,'2026-10-14').length,0);
  assert.deepEqual(plain(C.importBackup(backup)),plain(state));
});
test('손상·타 프로그램·중복 ID·잘못된 날짜·끊긴 이월 백업을 거부한다', () => {
  const base = plain(add());
  const variants = [];
  for (const mutate of [
    data => data.app = 'other-app',
    data => data.version = 2,
    data => data.tasks.push({...data.tasks[0]}),
    data => data.tasks[0].date = '2026-02-30',
    data => data.tasks[0].status = 'unknown',
    data => data.tasks[0].title = '  ',
    data => data.tasks[0].completedAt = t1,
    data => data.tasks[0].createdAt = '2026-02-30T00:00:00.000Z',
    data => data.tasks[0].history = [{from:'2026-10-13',to:'2026-10-15',at:t1,title:'기록',memo:''}],
    data => data.tasks[0].memo = 'x'.repeat(2001)
  ]) { const copy = plain(base); mutate(copy); variants.push(JSON.stringify(copy)); }
  for (const raw of ['{broken','null','[]',...variants]) assert.throws(() => C.importBackup(raw));
  assert.equal(base.tasks[0].date,'2026-10-14');
});
test('공백 제목·길이 초과·중복 ID의 등록을 거부한다', () => {
  const state = add();
  assert.throws(() => C.add(state,{date:'2026-10-14',title:' ',memo:''},'b',t1));
  assert.throws(() => C.add(state,{date:'2026-10-14',title:'x'.repeat(201),memo:''},'b',t1));
  assert.throws(() => add(state,'a'));
  const trimmed = C.add(C.empty(),{date:'2026-10-14',title:'  업무  ',memo:' 메모 '},'a',t1);
  assert.equal(trimmed.tasks[0].title,'업무');
  assert.equal(trimmed.tasks[0].memo,'메모');
});
test('입력된 HTML은 일반 문자열로 보존하며 스키마 외 속성은 제거한다', () => {
  const state = plain(add());
  state.tasks[0].title = '<img src=x onerror=alert(1)>';
  state.tasks[0].unexpected = 'ignored';
  const result = C.importBackup(JSON.stringify(state));
  assert.equal(result.tasks[0].title,state.tasks[0].title);
  assert.equal(Object.hasOwn(result.tasks[0],'unexpected'),false);
});
