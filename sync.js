// カケイ 端末同期の「混ぜ方」。画面にも Google にも触らない純粋関数だけを置く。
// ブラウザでは window.KakeiSync、node（テスト）では module.exports に出す。
// 状態の形: { tx: Row[], del: { id: 時刻 }, add: { months: { 'YYYY-MM': 中身 }, at: { 'YYYY-MM': 時刻 } } }
// Row: { id, date, amount, genre, shop, ts?, src?, who?, calId? }（ts の無い行は ts=0 とみなす）

function _clone(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
function _has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function _ts(row) { return (row && typeof row.ts === 'number') ? row.ts : 0; }
function _num(v) { return typeof v === 'number' ? v : 0; }

// 状態の欠けた部分を補う（入力は書き換えず、コピーを返す）
function _norm(s) {
  s = s || {};
  var add = s.add || {};
  return {
    tx: _clone(s.tx || []),
    del: _clone(s.del || {}),
    add: { months: _clone(add.months || {}), at: _clone(add.at || {}) }
  };
}

// 2つの状態を混ぜる。remote が null なら local のコピーをそのまま返す（changed=false）。
function mergeState(local, remote) {
  var L = _norm(local);
  if (!remote) {
    return { tx: L.tx, del: L.del, add: L.add, changed: false };
  }
  var R = _norm(remote);
  var k;

  // 墓標: 和集合。同じ id は大きい時刻を残す（local の並びが先）
  var del = {};
  for (k in L.del) if (_has(L.del, k)) del[k] = L.del[k];
  for (k in R.del) if (_has(R.del, k)) {
    if (!_has(del, k) || _num(R.del[k]) > _num(del[k])) del[k] = R.del[k];
  }

  // 行: local の並びを保ち、同じ id は ts の大きい方（同じなら local）。remote だけの行は remote の順で後ろへ。
  var rById = {};
  var i;
  for (i = 0; i < R.tx.length; i++) rById[R.tx[i].id] = R.tx[i];
  var merged = [];
  var seen = {};
  for (i = 0; i < L.tx.length; i++) {
    var lr = L.tx[i];
    var rr = _has(rById, lr.id) ? rById[lr.id] : null;
    merged.push(rr && _ts(rr) > _ts(lr) ? rr : lr);
    seen[lr.id] = true;
  }
  for (i = 0; i < R.tx.length; i++) {
    if (!_has(seen, R.tx[i].id)) { merged.push(R.tx[i]); seen[R.tx[i].id] = true; }
  }
  // 墓標の時刻が行の ts 以上なら行は消える。行の ts の方が新しければ残る（墓標も残す）
  var tx = [];
  for (i = 0; i < merged.length; i++) {
    var row = merged[i];
    if (_has(del, row.id) && _num(del[row.id]) >= _ts(row)) continue;
    tx.push(row);
  }

  // ADD: 月ごとに at の大きい方が勝つ。勝った側に中身が無ければ、その月は消えた扱い
  var months = {};
  var at = {};
  var yms = [];
  var ymSeen = {};
  function collect(o) { for (var key in o) if (_has(o, key) && !_has(ymSeen, key)) { ymSeen[key] = true; yms.push(key); } }
  collect(L.add.months); collect(L.add.at); collect(R.add.months); collect(R.add.at);
  for (i = 0; i < yms.length; i++) {
    var ym = yms[i];
    var lHas = _has(L.add.months, ym), rHas = _has(R.add.months, ym);
    var lAt = _has(L.add.at, ym) ? L.add.at[ym] : undefined;
    var rAt = _has(R.add.at, ym) ? R.add.at[ym] : undefined;
    var win;
    if (lAt === undefined && rAt === undefined) {
      win = lHas ? 'L' : 'R'; // どちらにも at が無い: 中身のある側を残す。at はそのまま（付けない）
    } else if (_num(lAt) > _num(rAt)) {
      win = 'L';
    } else if (_num(rAt) > _num(lAt)) {
      win = 'R';
    } else {
      win = lHas ? 'L' : 'R'; // 同時刻: local を優先（local に無ければ remote）
    }
    if (win === 'L' ? lHas : rHas) months[ym] = win === 'L' ? L.add.months[ym] : R.add.months[ym];
    if (lAt !== undefined || rAt !== undefined) at[ym] = Math.max(_num(lAt), _num(rAt));
  }

  var out = { tx: tx, del: del, add: { months: months, at: at } };
  var before = JSON.stringify({ tx: L.tx, del: L.del, add: L.add });
  out.changed = JSON.stringify({ tx: tx, del: del, add: out.add }) !== before;
  return out;
}

// カレンダー由来の行（src:'cal'）を、渡された calRows で丸ごと入れ替える。それ以外の行は位置も中身も触らない。
function applyCalRows(tx, calRows) {
  var i;
  var oldCal = [];
  var rest = [];
  for (i = 0; i < (tx || []).length; i++) {
    if (tx[i] && tx[i].src === 'cal') oldCal.push(tx[i]);
    else rest.push(_clone(tx[i]));
  }
  var newCal = [];
  for (i = 0; i < (calRows || []).length; i++) {
    var r = calRows[i];
    newCal.push({
      id: 'cal:' + r.id, date: r.date, amount: r.amount, genre: r.genre, shop: r.shop,
      cash: r.cash, who: r.who, src: 'cal', calId: r.id
    });
  }
  return {
    tx: rest.concat(newCal),
    changed: JSON.stringify(newCal) !== JSON.stringify(oldCal)
  };
}

// 前回までに送った id（pushed）と比べて、今回送るものを決める。入力は書き換えない。
//   add: まだ送っていない行（cal 行は送らない）
//   del: 墓標があり、かつ以前送った id（向こうに居るので消してもらう）
//   pushed: 古い pushed に add の id を足し、del の id を引いたもの
function diffPushed(tx, del, pushed) {
  var i, k;
  var oldPushed = pushed || {};
  var add = [];
  var delIds = [];
  var next = {};
  for (k in oldPushed) if (_has(oldPushed, k)) next[k] = oldPushed[k];
  for (i = 0; i < (tx || []).length; i++) {
    var row = tx[i];
    if (!row || row.src === 'cal') continue;
    if (!_has(oldPushed, row.id)) { add.push(row); next[row.id] = true; }
  }
  for (k in (del || {})) {
    if (_has(del, k) && _has(oldPushed, k)) { delIds.push(k); delete next[k]; }
  }
  return { add: add, del: delIds, pushed: next };
}

// 手元から消えた行の墓標を作る（cal 行は対象外）
function tombstonesFor(oldTx, newTx, now) {
  var i;
  var present = {};
  for (i = 0; i < (newTx || []).length; i++) present[newTx[i].id] = true;
  var out = {};
  for (i = 0; i < (oldTx || []).length; i++) {
    var row = oldTx[i];
    if (row && row.src !== 'cal' && !_has(present, row.id)) out[row.id] = now;
  }
  return out;
}

// 手元が空なのに向こうに行がある時は、空で上書きしないよう送らない
function shouldPush(localTx, remoteTx) {
  var localEmpty = !localTx || localTx.length === 0;
  var remoteHas = !!remoteTx && remoteTx.length >= 1;
  return !(localEmpty && remoteHas);
}

var _api = {
  mergeState: mergeState,
  applyCalRows: applyCalRows,
  diffPushed: diffPushed,
  tombstonesFor: tombstonesFor,
  shouldPush: shouldPush
};
if (typeof module !== 'undefined' && module.exports) { module.exports = _api; }
else if (typeof window !== 'undefined') { window.KakeiSync = _api; }
