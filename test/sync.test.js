// カケイ 端末同期の混ぜ方（sync.js）のテスト。  node test/sync.test.js
// 数値はすべて架空。
const assert = require('assert');
const S = require('../sync.js');

let n = 0;
let ng = 0;
function t(name, fn) {
  try { fn(); n++; console.log('ok', name); }
  catch (e) { ng++; console.log('NG', name); console.log(e && e.stack || e); }
}
const EMPTY_ADD = function () { return { months: {}, at: {} }; };
const clone = function (x) { return JSON.parse(JSON.stringify(x)); };

t('墓標が勝つ', () => {
  const r = S.mergeState({ tx: [{ id: 'a', ts: 10 }], del: {}, add: EMPTY_ADD() },
                         { tx: [], del: { a: 20 }, add: EMPTY_ADD() });
  assert.deepStrictEqual(r.tx, []);
  assert.deepStrictEqual(r.del, { a: 20 });
  assert.strictEqual(r.changed, true);
});

t('墓標と同時刻なら墓標が勝つ（>=）', () => {
  const r = S.mergeState({ tx: [{ id: 'a', ts: 20 }], del: {}, add: EMPTY_ADD() },
                         { tx: [], del: { a: 20 }, add: EMPTY_ADD() });
  assert.deepStrictEqual(r.tx, []);
});

t('墓標より新しい行は残る（墓標も残る）', () => {
  const r = S.mergeState({ tx: [{ id: 'a', ts: 30 }], del: {}, add: EMPTY_ADD() },
                         { tx: [], del: { a: 20 }, add: EMPTY_ADD() });
  assert.strictEqual(r.tx.length, 1);
  assert.strictEqual(r.tx[0].id, 'a');
  assert.deepStrictEqual(r.del, { a: 20 });
});

t('ts の無い古い行は墓標に負ける', () => {
  const r = S.mergeState({ tx: [{ id: 'a' }], del: {}, add: EMPTY_ADD() },
                         { tx: [], del: { a: 1 }, add: EMPTY_ADD() });
  assert.deepStrictEqual(r.tx, []);
});

t('墓標の混ぜは和集合で、大きい時刻を残す', () => {
  const r = S.mergeState({ tx: [], del: { a: 5, b: 9 }, add: EMPTY_ADD() },
                         { tx: [], del: { a: 8, c: 3 }, add: EMPTY_ADD() });
  assert.deepStrictEqual(r.del, { a: 8, b: 9, c: 3 });
});

t('同じ id の行は ts の大きい方が勝つ', () => {
  const r = S.mergeState({ tx: [{ id: 'a', amount: 1, ts: 5 }], del: {}, add: EMPTY_ADD() },
                         { tx: [{ id: 'a', amount: 2, ts: 9 }], del: {}, add: EMPTY_ADD() });
  assert.strictEqual(r.tx.length, 1);
  assert.strictEqual(r.tx[0].amount, 2);
  assert.strictEqual(r.changed, true);
});

t('同じ id で local が新しいなら local のまま', () => {
  const r = S.mergeState({ tx: [{ id: 'a', amount: 1, ts: 9 }], del: {}, add: EMPTY_ADD() },
                         { tx: [{ id: 'a', amount: 2, ts: 5 }], del: {}, add: EMPTY_ADD() });
  assert.strictEqual(r.tx[0].amount, 1);
  assert.strictEqual(r.changed, false);
});

t('行の順は local のまま、remote だけの行は remote の順で後ろに足す', () => {
  const r = S.mergeState({ tx: [{ id: 'b' }, { id: 'a' }], del: {}, add: EMPTY_ADD() },
                         { tx: [{ id: 'z' }, { id: 'a' }, { id: 'y' }], del: {}, add: EMPTY_ADD() });
  assert.deepStrictEqual(r.tx.map(x => x.id), ['b', 'a', 'z', 'y']);
  assert.strictEqual(r.changed, true);
});

t('ADD は月ごとに at の大きい方。無い側が新しければ消える', () => {
  const r = S.mergeState({ tx: [], del: {}, add: { months: { '2026-09': { total: 1 } }, at: { '2026-09': 5 } } },
                         { tx: [], del: {}, add: { months: {}, at: { '2026-09': 9 } } });
  assert.deepStrictEqual(r.add.months, {});
  assert.strictEqual(r.add.at['2026-09'], 9);
  assert.strictEqual(r.changed, true);
});

t('ADD は at の大きい方の中身が入る', () => {
  const r = S.mergeState({ tx: [], del: {}, add: { months: { '2026-09': { total: 1 } }, at: { '2026-09': 5 } } },
                         { tx: [], del: {}, add: { months: { '2026-09': { total: 2 } }, at: { '2026-09': 9 } } });
  assert.deepStrictEqual(r.add.months['2026-09'], { total: 2 });
  assert.strictEqual(r.add.at['2026-09'], 9);
});

t('ADD は月ごとに別々に決まる', () => {
  const r = S.mergeState({ tx: [], del: {}, add: { months: { '2026-08': { v: 'L8' }, '2026-09': { v: 'L9' } }, at: { '2026-08': 9, '2026-09': 1 } } },
                         { tx: [], del: {}, add: { months: { '2026-08': { v: 'R8' }, '2026-09': { v: 'R9' } }, at: { '2026-08': 1, '2026-09': 9 } } });
  assert.strictEqual(r.add.months['2026-08'].v, 'L8');
  assert.strictEqual(r.add.months['2026-09'].v, 'R9');
  assert.deepStrictEqual(r.add.at, { '2026-08': 9, '2026-09': 9 });
});

t('片方にしか無い月で at も無ければ残す（at はそのまま）', () => {
  const r = S.mergeState({ tx: [], del: {}, add: { months: { '2026-07': { v: 1 } }, at: {} } },
                         { tx: [], del: {}, add: EMPTY_ADD() });
  assert.deepStrictEqual(r.add.months, { '2026-07': { v: 1 } });
  assert.deepStrictEqual(r.add.at, {});
  assert.strictEqual(r.changed, false);
  const r2 = S.mergeState({ tx: [], del: {}, add: EMPTY_ADD() },
                          { tx: [], del: {}, add: { months: { '2026-07': { v: 1 } }, at: {} } });
  assert.deepStrictEqual(r2.add.months, { '2026-07': { v: 1 } });
  assert.deepStrictEqual(r2.add.at, {});
});

t('remote が null なら local のまま changed=false', () => {
  const local = { tx: [{ id: 'a', ts: 1 }], del: { b: 2 }, add: { months: { '2026-09': { x: 1 } }, at: { '2026-09': 3 } } };
  const before = clone(local);
  const r = S.mergeState(local, null);
  assert.deepStrictEqual(r.tx, before.tx);
  assert.deepStrictEqual(r.del, before.del);
  assert.deepStrictEqual(r.add, before.add);
  assert.strictEqual(r.changed, false);
  assert.notStrictEqual(r.tx, local.tx); // コピーであること
  r.tx.push({ id: 'zz' });
  assert.deepStrictEqual(local, before);
});

t('混ぜても入力は書き換えない', () => {
  const local = { tx: [{ id: 'a', ts: 10 }], del: {}, add: { months: { '2026-09': { total: 1 } }, at: { '2026-09': 5 } } };
  const remote = { tx: [{ id: 'q' }], del: { a: 20 }, add: { months: {}, at: { '2026-09': 9 } } };
  const l0 = clone(local), r0 = clone(remote);
  S.mergeState(local, remote);
  assert.deepStrictEqual(local, l0);
  assert.deepStrictEqual(remote, r0);
});

t('同じもの同士なら changed=false', () => {
  const s = { tx: [{ id: 'a', ts: 1 }], del: { b: 2 }, add: { months: { '2026-09': { x: 1 } }, at: { '2026-09': 3 } } };
  const r = S.mergeState(clone(s), clone(s));
  assert.strictEqual(r.changed, false);
});

t('months と at のキー順が逆でも、同じもの同士なら changed=false', () => {
  const s = { tx: [{ id: 'a', ts: 1, amount: 1, date: 'd' }], del: { q: 1, p: 2 },
    add: { months: { '2026-09': { x: 1, y: 2 }, '2026-08': { x: 3 } }, at: { '2026-08': 4, '2026-09': 5 } } };
  const remote = clone(s);
  remote.tx[0] = { date: 'd', amount: 1, ts: 1, id: 'a' }; // 行の項目の並びも違う
  remote.del = { p: 2, q: 1 };
  remote.add.months['2026-09'] = { y: 2, x: 1 };
  assert.strictEqual(S.mergeState(s, clone(s)).changed, false);
  assert.strictEqual(S.mergeState(s, remote).changed, false);
});

t('applyCalRows: 保存済みの cal 行に余計な項目があっても、中身が同じなら changed=false', () => {
  const cal = [{ id: '2', date: '2026-10-01', amount: 500, genre: 'g', shop: 's', cash: false, who: 'w' }];
  const stored = [{ id: 'x' }, { who: 'w', cash: false, shop: 's', genre: 'g', amount: 500, date: '2026-10-01',
    id: 'cal:2', src: 'cal', calId: '2', extra: 'zzz' }];
  const r = S.applyCalRows(stored, cal);
  assert.strictEqual(r.changed, false);
  assert.deepStrictEqual(r.tx.map(x => x.id), ['x', 'cal:2']);
  // 中身が違えば changed=true
  cal[0].amount = 501;
  assert.strictEqual(S.applyCalRows(stored, cal).changed, true);
});

t('cal: の行は塊に乗せず、applyCalRows で丸ごと入れ替わる', () => {
  const r = S.applyCalRows([{ id: 'x' }, { id: 'cal:1', src: 'cal' }],
    [{ id: '2', date: '2026-10-01', amount: 500, genre: '外食・カフェ', shop: '店', cash: false, who: 'まなみ' }]);
  assert.deepStrictEqual(r.tx.map(x => x.id), ['x', 'cal:2']);
  assert.strictEqual(r.tx[1].who, 'まなみ');
  assert.strictEqual(r.tx[1].src, 'cal');
  assert.strictEqual(r.tx[1].calId, '2');
  assert.strictEqual(r.tx[1].cash, false);
  assert.strictEqual(r.changed, true);
});

t('applyCalRows: cal 以外の位置は動かさず、cal は最後に calRows の順で並ぶ', () => {
  const r = S.applyCalRows([{ id: 'cal:1', src: 'cal' }, { id: 'x' }, { id: 'cal:2', src: 'cal' }, { id: 'y' }],
    [{ id: '9', date: 'd', amount: 1, genre: 'g', shop: 's', cash: true, who: 'w' },
     { id: '3', date: 'd', amount: 2, genre: 'g', shop: 's', cash: false, who: 'w' }]);
  assert.deepStrictEqual(r.tx.map(x => x.id), ['x', 'y', 'cal:9', 'cal:3']);
});

t('applyCalRows: 同じ内容なら changed=false', () => {
  const cal = [{ id: '2', date: '2026-10-01', amount: 500, genre: 'g', shop: 's', cash: false, who: 'w' }];
  const first = S.applyCalRows([{ id: 'x' }], cal);
  const second = S.applyCalRows(first.tx, cal);
  assert.strictEqual(second.changed, false);
  assert.deepStrictEqual(second.tx, first.tx);
});

t('applyCalRows: calRows が空なら cal 行が消えて changed=true', () => {
  const r = S.applyCalRows([{ id: 'x' }, { id: 'cal:1', src: 'cal' }], []);
  assert.deepStrictEqual(r.tx.map(x => x.id), ['x']);
  assert.strictEqual(r.changed, true);
});

t('applyCalRows: cal 行が元から無く calRows も空なら changed=false', () => {
  const r = S.applyCalRows([{ id: 'x' }], []);
  assert.strictEqual(r.changed, false);
});

t('applyCalRows は入力を書き換えない', () => {
  const tx = [{ id: 'x' }, { id: 'cal:1', src: 'cal' }];
  const before = clone(tx);
  S.applyCalRows(tx, [{ id: '2', date: 'd', amount: 1, genre: 'g', shop: 's', cash: false, who: 'w' }]);
  assert.deepStrictEqual(tx, before);
});

t('diffPushed は未送信だけ出し、cal: は出さない', () => {
  const r = S.diffPushed([{ id: 'a' }, { id: 'b' }, { id: 'cal:9', src: 'cal' }], { c: 1, z: 1 }, { a: true, c: true });
  assert.deepStrictEqual(r.add.map(x => x.id), ['b']);
  assert.deepStrictEqual(r.del, ['c']);
  assert.deepStrictEqual(r.pushed, { a: true, b: true });
});

t('diffPushed は入力を書き換えない', () => {
  const tx = [{ id: 'a' }, { id: 'b' }];
  const del = { c: 1 };
  const pushed = { a: true, c: true };
  S.diffPushed(tx, del, pushed);
  assert.deepStrictEqual(tx, [{ id: 'a' }, { id: 'b' }]);
  assert.deepStrictEqual(del, { c: 1 });
  assert.deepStrictEqual(pushed, { a: true, c: true });
});

t('diffPushed: pushed が空でも動く', () => {
  const r = S.diffPushed([{ id: 'a' }], {}, {});
  assert.deepStrictEqual(r.add.map(x => x.id), ['a']);
  assert.deepStrictEqual(r.del, []);
  assert.deepStrictEqual(r.pushed, { a: true });
});

t('tombstonesFor は消えた id だけ', () => {
  assert.deepStrictEqual(S.tombstonesFor([{ id: 'a' }, { id: 'b' }, { id: 'cal:1', src: 'cal' }], [{ id: 'a' }], 7), { b: 7 });
});

t('tombstonesFor: 何も消えていなければ空', () => {
  assert.deepStrictEqual(S.tombstonesFor([{ id: 'a' }], [{ id: 'a' }, { id: 'n' }], 7), {});
});

t('手元が空で向こうにあるなら送らない', () => {
  assert.strictEqual(S.shouldPush([], [{ id: 'a' }]), false);
  assert.strictEqual(S.shouldPush([], []), true);
});

t('shouldPush: 手元があれば送る／remote が null は空扱い', () => {
  assert.strictEqual(S.shouldPush([{ id: 'a' }], [{ id: 'b' }]), true);
  assert.strictEqual(S.shouldPush([], null), true);
  assert.strictEqual(S.shouldPush([], undefined), true);
});

if (ng) { console.log(ng + ' 件失敗（通ったのは ' + n + ' 件）'); process.exit(1); }
console.log(n + ' 件すべて通った');
