/*
 * Tents & Trees - puzzle engine
 * Seeded generator, unique-solution solver, logical deduction (used for hints
 * and for keeping the easy levels solvable without guessing).
 * Works in the browser (window.TT) and in Node (module.exports).
 *
 * Cell values used for marks / knowledge arrays:
 *   0 = unknown/empty, 1 = grass, 2 = tent, 3 = tree
 */
(function (root) {
  'use strict';

  var EMPTY = 0, GRASS = 1, TENT = 2, TREE = 3;

  var LEVELS = {
    tiny:   { id: 'tiny',   name: 'Tiny',   n: 5,  tents: 5,  logic: 1 },
    easy:   { id: 'easy',   name: 'Easy',   n: 6,  tents: 7,  logic: 1 },
    medium: { id: 'medium', name: 'Medium', n: 8,  tents: 12, logic: 2 },
    hard:   { id: 'hard',   name: 'Hard',   n: 10, tents: 19, logic: 0 }
  };
  var LEVEL_ORDER = ['tiny', 'easy', 'medium', 'hard'];

  /* ---------- seeded random ---------- */
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) { return mulberry32(xmur3(String(seed))()); }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- puzzle construction ---------- */
  function neighbours(n) {
    var orth = [], around = [];
    for (var i = 0; i < n * n; i++) {
      var r = (i / n) | 0, c = i % n, o = [], a = [];
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          var rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
          a.push(rr * n + cc);
          if (!dr || !dc) o.push(rr * n + cc);
        }
      }
      orth.push(o); around.push(a);
    }
    return { orth: orth, around: around };
  }
  var nbCache = {};
  function nb(n) { return nbCache[n] || (nbCache[n] = neighbours(n)); }

  function build(n, trees, tents) {
    var N = n * n, rows = new Array(n).fill(0), cols = new Array(n).fill(0), i;
    for (i = 0; i < N; i++) if (tents[i]) { rows[(i / n) | 0]++; cols[i % n]++; }
    var treeList = [];
    for (i = 0; i < N; i++) if (trees[i]) treeList.push(i);
    var h = nb(n);
    return {
      n: n, N: N, trees: trees, treeList: treeList, rows: rows, cols: cols,
      orth: h.orth, around: h.around, solution: tents
    };
  }

  function randomPuzzle(n, tentCount, rng) {
    var N = n * n, h = nb(n), i;
    var tents = new Uint8Array(N), trees = new Uint8Array(N);
    var order = shuffle(Array.apply(null, { length: N }).map(function (_, k) { return k; }), rng);
    var placed = 0, list = [];
    for (i = 0; i < order.length && placed < tentCount; i++) {
      var c = order[i], ok = true;
      for (var k = 0; k < h.around[c].length; k++) if (tents[h.around[c][k]]) { ok = false; break; }
      if (!ok) continue;
      tents[c] = 1; placed++; list.push(c);
    }
    if (placed < tentCount) return null;
    shuffle(list, rng);
    for (i = 0; i < list.length; i++) {
      var opts = h.orth[list[i]].filter(function (j) { return !tents[j] && !trees[j]; });
      if (!opts.length) return null;
      trees[opts[Math.floor(rng() * opts.length)]] = 1;
    }
    return build(n, trees, tents);
  }

  /* ---------- bipartite matching ---------- */
  // lefts: array of ids; adj(id) -> array of right ids; size: number of right ids
  function matchAll(lefts, adj, size) {
    var matchR = new Int32Array(size).fill(-1);
    function aug(l, seen) {
      var a = adj(l);
      for (var k = 0; k < a.length; k++) {
        var r = a[k];
        if (seen[r]) continue;
        seen[r] = 1;
        if (matchR[r] < 0 || aug(matchR[r], seen)) { matchR[r] = l; return true; }
      }
      return false;
    }
    for (var i = 0; i < lefts.length; i++) {
      if (!aug(lefts[i], new Uint8Array(size))) return false;
    }
    return true;
  }
  // every tree needs its own tent cell among avail cells next to it
  function treesMatchable(p, avail) {
    return matchAll(p.treeList, function (t) {
      return p.orth[t].filter(function (j) { return avail[j]; });
    }, p.N);
  }
  // every tent needs its own tree next to it
  function tentsMatchable(p, tentCells) {
    return matchAll(tentCells, function (t) {
      return p.orth[t].filter(function (j) { return p.trees[j]; });
    }, p.N);
  }

  /* ---------- solver: counts distinct tent placements (up to limit) ---------- */
  function solve(p, limit) {
    limit = limit || 2;
    var n = p.n, N = p.N, trees = p.trees, orth = p.orth, around = p.around;
    var cand = new Uint8Array(N), i;
    for (i = 0; i < N; i++) {
      if (trees[i]) continue;
      for (var k = 0; k < orth[i].length; k++) if (trees[orth[i][k]]) { cand[i] = 1; break; }
    }
    var rowNeed = p.rows.slice(), colNeed = p.cols.slice();
    var rowAvail = new Array(n).fill(0), colAvail = new Array(n).fill(0);
    for (i = 0; i < N; i++) if (cand[i]) { rowAvail[(i / n) | 0]++; colAvail[i % n]++; }
    var tent = new Uint8Array(N);
    var count = 0, first = null;

    function rowTreesOK(r) {
      if (r < 0) return true;
      for (var c = 0; c < n; c++) {
        var t = r * n + c;
        if (!trees[t]) continue;
        var o = orth[t], ok = false;
        for (var k = 0; k < o.length; k++) if (tent[o[k]]) { ok = true; break; }
        if (!ok) return false;
      }
      return true;
    }
    function leaf() {
      for (var c = 0; c < n; c++) if (colNeed[c] !== 0) return;
      var cells = [];
      for (var j = 0; j < N; j++) if (tent[j]) cells.push(j);
      if (cells.length !== p.treeList.length) return;
      if (!tentsMatchable(p, cells)) return;
      if (!treesMatchable(p, tent)) return;
      count++;
      if (!first) first = tent.slice();
    }
    function dfs(pos) {
      if (count >= limit) return;
      if (pos % n === 0 && pos > 0) {
        var r0 = pos / n;
        if (rowNeed[r0 - 1] !== 0) return;
        if (r0 >= 2 && !rowTreesOK(r0 - 2)) return;
      }
      if (pos === N) {
        if (!rowTreesOK(n - 1)) return;
        leaf();
        return;
      }
      var r = (pos / n) | 0, c = pos % n;
      var isCand = cand[pos];
      if (isCand) { rowAvail[r]--; colAvail[c]--; }
      if (isCand && rowNeed[r] > 0 && colNeed[c] > 0) {
        var touch = false, a = around[pos];
        for (var k = 0; k < a.length; k++) if (a[k] < pos && tent[a[k]]) { touch = true; break; }
        if (!touch) {
          tent[pos] = 1; rowNeed[r]--; colNeed[c]--;
          dfs(pos + 1);
          tent[pos] = 0; rowNeed[r]++; colNeed[c]++;
        }
      }
      if (count < limit && rowNeed[r] <= rowAvail[r] && colNeed[c] <= colAvail[c]) dfs(pos + 1);
      if (isCand) { rowAvail[r]++; colAvail[c]++; }
    }
    dfs(0);
    return { count: count, solution: first };
  }

  /* ---------- logical deduction ---------- */
  function initialKnowledge(p) {
    var K = new Uint8Array(p.N);
    for (var i = 0; i < p.N; i++) if (p.trees[i]) K[i] = TREE;
    return K;
  }

  function contradiction(p, K) {
    var n = p.n, N = p.N, i, r, c;
    var tentCells = [], avail = new Uint8Array(N);
    for (i = 0; i < N; i++) {
      if (K[i] === TENT) {
        tentCells.push(i);
        for (var k = 0; k < p.around[i].length; k++) if (K[p.around[i][k]] === TENT) return true;
        var hasTree = false;
        for (var q = 0; q < p.orth[i].length; q++) if (p.trees[p.orth[i][q]]) { hasTree = true; break; }
        if (!hasTree) return true;
      }
      if (K[i] === EMPTY || K[i] === TENT) avail[i] = 1;
    }
    for (r = 0; r < n; r++) {
      var t = 0, u = 0;
      for (c = 0; c < n; c++) { var v = K[r * n + c]; if (v === TENT) t++; else if (v === EMPTY) u++; }
      if (t > p.rows[r] || t + u < p.rows[r]) return true;
    }
    for (c = 0; c < n; c++) {
      var t2 = 0, u2 = 0;
      for (r = 0; r < n; r++) { var v2 = K[r * n + c]; if (v2 === TENT) t2++; else if (v2 === EMPTY) u2++; }
      if (t2 > p.cols[c] || t2 + u2 < p.cols[c]) return true;
    }
    if (tentCells.length > p.treeList.length) return true;
    if (!treesMatchable(p, avail)) return true;
    if (!tentsMatchable(p, tentCells)) return true;
    return false;
  }

  function lineCells(p, type, idx) {
    var out = [];
    for (var k = 0; k < p.n; k++) out.push(type === 'row' ? idx * p.n + k : k * p.n + idx);
    return out;
  }

  // Returns one deduction {i, v, rule, why, focus:[cells], line:{type,idx}|null} or null.
  // level 1 = simple rules, level 2 = adds one-step "what if" lookahead.
  function deduce(p, K, level) {
    var n = p.n, N = p.N, i, r, c, k;

    // 1. squares touching a tent can't be tents
    for (i = 0; i < N; i++) {
      if (K[i] !== EMPTY) continue;
      for (k = 0; k < p.around[i].length; k++) {
        if (K[p.around[i][k]] === TENT) {
          return { i: i, v: GRASS, rule: 'touch', focus: [p.around[i][k]], line: null,
            why: "Tents can't touch each other, not even corner to corner. This square touches a tent, so it must be grass." };
        }
      }
    }
    // 2. rows and columns that are complete, or need every free square
    for (var pass = 0; pass < 2; pass++) {
      var type = pass === 0 ? 'row' : 'col';
      for (var idx = 0; idx < n; idx++) {
        var cells = lineCells(p, type, idx), t = 0, free = [];
        for (k = 0; k < cells.length; k++) {
          if (K[cells[k]] === TENT) t++;
          else if (K[cells[k]] === EMPTY) free.push(cells[k]);
        }
        var need = (type === 'row' ? p.rows[idx] : p.cols[idx]) - t;
        var label = (type === 'row' ? 'Row ' : 'Column ') + (idx + 1);
        var total = type === 'row' ? p.rows[idx] : p.cols[idx];
        if (free.length && need === 0) {
          return { i: free[0], cells: free, v: GRASS, rule: 'full', focus: [], line: { type: type, idx: idx },
            why: total === 0
              ? label + ' has the number 0, so it has no tents at all. Every square in it is grass.'
              : label + ' already has all ' + total + ' of its tents, so every free square left in it is grass.' };
        }
        if (free.length && need === free.length) {
          return { i: free[0], cells: free, v: TENT, rule: 'must', focus: [], line: { type: type, idx: idx },
            why: label + ' needs ' + need + ' more tent' + (need > 1 ? 's' : '') +
              ' and has exactly ' + free.length + ' free square' + (free.length > 1 ? 's' : '') +
              ', so ' + (need > 1 ? 'they are all tents.' : 'it is a tent.') };
        }
      }
    }
    // 3. a tree with only one possible square left
    for (var ti = 0; ti < p.treeList.length; ti++) {
      var tr = p.treeList[ti], options = [], hasTent = false;
      for (k = 0; k < p.orth[tr].length; k++) {
        var j = p.orth[tr][k];
        if (K[j] === EMPTY) options.push(j);
        else if (K[j] === TENT) hasTent = true;
      }
      if (options.length === 1 && !hasTent) {
        return { i: options[0], v: TENT, rule: 'only', focus: [tr], line: null,
          why: 'This tree has only one free square next to it, so its tent has to go there.' };
      }
    }
    // 4. squares whose neighbouring trees all already have a tent of their own
    var satisfied = new Uint8Array(N);
    for (ti = 0; ti < p.treeList.length; ti++) {
      var tr2 = p.treeList[ti];
      for (k = 0; k < p.orth[tr2].length; k++) {
        var tj = p.orth[tr2][k];
        if (K[tj] !== TENT) continue;
        var cnt = 0;
        for (var m = 0; m < p.orth[tj].length; m++) if (p.trees[p.orth[tj][m]]) cnt++;
        if (cnt === 1) { satisfied[tr2] = 1; break; }
      }
    }
    for (i = 0; i < N; i++) {
      if (K[i] !== EMPTY) continue;
      var near = [], all = true;
      for (k = 0; k < p.orth[i].length; k++) {
        if (p.trees[p.orth[i][k]]) { near.push(p.orth[i][k]); if (!satisfied[p.orth[i][k]]) all = false; }
      }
      if (near.length && all) {
        return { i: i, v: GRASS, rule: 'done', focus: near, line: null,
          why: 'The tree' + (near.length > 1 ? 's' : '') + ' next to this square already ha' +
            (near.length > 1 ? 've' : 's') + ' a tent, so no tent is needed here.' };
      }
    }
    // 5. squares with no tree next to them
    for (i = 0; i < N; i++) {
      if (K[i] !== EMPTY) continue;
      var hasT = false;
      for (k = 0; k < p.orth[i].length; k++) if (p.trees[p.orth[i][k]]) { hasT = true; break; }
      if (!hasT) {
        return { i: i, v: GRASS, rule: 'notree', focus: [], line: null,
          why: 'A tent must sit right next to a tree (up, down, left or right). This square has no tree beside it, so it is grass.' };
      }
    }
    // 6. what-if lookahead
    if (level >= 2) {
      for (i = 0; i < N; i++) {
        if (K[i] !== EMPTY) continue;
        var K1 = K.slice();
        K1[i] = TENT;
        for (k = 0; k < p.around[i].length; k++) if (K1[p.around[i][k]] === EMPTY) K1[p.around[i][k]] = GRASS;
        if (contradiction(p, K1)) {
          return { i: i, v: GRASS, rule: 'whatif', focus: [], line: null,
            why: "Try imagining a tent here: it would leave some tree without a tent, or break a row or column number. So this square must be grass." };
        }
        var K2 = K.slice();
        K2[i] = GRASS;
        if (contradiction(p, K2)) {
          return { i: i, v: TENT, rule: 'whatif', focus: [], line: null,
            why: "Try imagining grass here: it would leave some tree with nowhere to put its tent, or break a row or column number. So this square must be a tent." };
        }
      }
    }
    return null;
  }

  function logicSolve(p, level) {
    var K = initialKnowledge(p), guard = 0, d;
    while ((d = deduce(p, K, level)) && guard++ < 1000) K[d.i] = d.v;
    var ok = true;
    for (var i = 0; i < p.N; i++) {
      if (p.trees[i]) continue;
      if (K[i] === EMPTY || (K[i] === TENT) !== !!p.solution[i]) ok = false;
    }
    return ok;
  }

  /* ---------- generator ---------- */
  function generate(levelId, seed) {
    var L = LEVELS[levelId] || LEVELS.easy;
    var rng = makeRng(L.id + ':' + seed);
    var fallback = null, attempts = 0, chosen = null;
    var logicBudget = L.logic ? 400 : 0;
    while (!chosen) {
      attempts++;
      var p = randomPuzzle(L.n, L.tents, rng);
      if (!p) continue;
      var res = solve(p, 2);
      if (res.count !== 1) continue;
      p.solution = res.solution;
      if (!fallback) fallback = p;
      if (L.logic && attempts <= logicBudget && !logicSolve(p, L.logic)) continue;
      chosen = p;
      if (attempts > 100000) break;
    }
    chosen.level = L.id;
    chosen.seed = String(seed);
    chosen.attempts = attempts;
    return chosen;
  }

  /* ---------- play helpers ---------- */
  function knowledgeFromMarks(p, marks) {
    var K = initialKnowledge(p);
    for (var i = 0; i < p.N; i++) {
      if (p.trees[i]) continue;
      if (marks[i] === TENT && p.solution[i]) K[i] = TENT;
      else if (marks[i] === GRASS && !p.solution[i]) K[i] = GRASS;
    }
    return K;
  }
  function mistakes(p, marks) {
    var out = [];
    for (var i = 0; i < p.N; i++) {
      if (p.trees[i]) continue;
      if ((marks[i] === TENT && !p.solution[i]) || (marks[i] === GRASS && p.solution[i])) out.push(i);
    }
    return out;
  }
  function isWin(p, marks) {
    for (var i = 0; i < p.N; i++) {
      if (p.trees[i]) continue;
      if ((marks[i] === TENT) !== !!p.solution[i]) return false;
    }
    return true;
  }
  // tents that touch another tent (shown in red while playing; this is a rule, not a spoiler)
  function conflicts(p, marks) {
    var out = [];
    for (var i = 0; i < p.N; i++) {
      if (marks[i] !== TENT) continue;
      for (var k = 0; k < p.around[i].length; k++) if (marks[p.around[i][k]] === TENT) { out.push(i); break; }
    }
    return out;
  }
  function counts(p, marks) {
    var rows = new Array(p.n).fill(0), cols = new Array(p.n).fill(0);
    for (var i = 0; i < p.N; i++) if (marks[i] === TENT) { rows[(i / p.n) | 0]++; cols[i % p.n]++; }
    return { rows: rows, cols: cols };
  }
  // A hint for the player's current board.
  function hint(p, marks) {
    var bad = mistakes(p, marks);
    if (bad.length) {
      return { kind: 'mistake', cells: bad,
        why: bad.length === 1 ? 'One of your marks looks wrong. Check the highlighted square.'
          : bad.length + ' of your marks look wrong. Check the highlighted squares.' };
    }
    var K = knowledgeFromMarks(p, marks);
    var d = deduce(p, K, 2);
    if (d) { d.kind = 'move'; return d; }
    var i, pick = -1;
    for (i = 0; i < p.N; i++) if (p.solution[i] && marks[i] !== TENT) { pick = i; break; }
    if (pick >= 0) return { kind: 'move', i: pick, v: TENT, rule: 'forced', focus: [], line: null,
      why: 'Everything else in the puzzle points to a tent here.' };
    for (i = 0; i < p.N; i++) if (!p.trees[i] && !p.solution[i] && marks[i] === EMPTY) {
      return { kind: 'move', i: i, v: GRASS, rule: 'forced', focus: [], line: null,
        why: 'This square cannot hold a tent, so it is grass.' };
    }
    return null;
  }

  /* ---------- self test ---------- */
  function selfTest(perLevel, log) {
    log = log || function () {};
    var failures = 0;
    LEVEL_ORDER.forEach(function (id) {
      var t0 = Date.now(), worst = 0, logicOK = 0;
      for (var s = 0; s < perLevel; s++) {
        var a = Date.now();
        var p = generate(id, 'selftest-' + s);
        worst = Math.max(worst, Date.now() - a);
        var res = solve(p, 2);
        if (res.count !== 1) { failures++; log('FAIL ' + id + ' #' + s + ': ' + res.count + ' solutions'); }
        for (var i = 0; i < p.N; i++) if (res.solution && res.solution[i] !== p.solution[i]) { failures++; log('FAIL ' + id + ' #' + s + ': stored solution differs'); break; }
        // every logical deduction must agree with the solution
        var K = initialKnowledge(p), d, guard = 0;
        while ((d = deduce(p, K, 2)) && guard++ < 500) {
          if ((d.v === TENT) !== !!p.solution[d.i]) { failures++; log('FAIL ' + id + ' #' + s + ': wrong deduction (' + d.rule + ')'); break; }
          K[d.i] = d.v;
        }
        if (logicSolve(p, LEVELS[id].logic || 2)) logicOK++;
        // hint on an empty board must be a correct move
        var marks = initialKnowledge(p);
        var h = hint(p, marks);
        if (!h || h.kind !== 'move' || (h.v === TENT) !== !!p.solution[h.i]) { failures++; log('FAIL ' + id + ' #' + s + ': bad hint'); }
      }
      log(id + ': ' + perLevel + ' puzzles, ' + (Date.now() - t0) + 'ms total, worst ' + worst + 'ms, logic-solvable ' + logicOK + '/' + perLevel);
    });
    log(failures ? failures + ' FAILURE(S)' : 'All checks passed');
    return failures === 0;
  }

  var TT = {
    EMPTY: EMPTY, GRASS: GRASS, TENT: TENT, TREE: TREE,
    LEVELS: LEVELS, LEVEL_ORDER: LEVEL_ORDER,
    generate: generate, solve: solve, deduce: deduce, logicSolve: logicSolve,
    hint: hint, isWin: isWin, mistakes: mistakes, conflicts: conflicts, counts: counts,
    selfTest: selfTest, makeRng: makeRng
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TT;
  else root.TT = TT;
})(typeof window !== 'undefined' ? window : this);
