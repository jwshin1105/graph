// 앱 컨트롤러: 입력 목록 · 캔버스 · 분석 패널을 잇는다.

import { View } from './view.js';
import { Renderer, PALETTE } from './renderer.js';
import { createContext, createObject, computeObject, analyzeObject, missingRefs, intersectionsOf } from './objects.js';
import { analyzePointSet } from '../analysis/pointset.js';
import { pretty, trimNum } from '../math/numeric.js';

const EXAMPLES = [
  ['sin(x)^2 + sin(y)^2 = 0', '해가 곡선이 아니라 격자 점열 — 등고선법이 놓치는 해'],
  ['x^2 + y^2 = 0', '한 점만이 해인 방정식'],
  ['y^2 = x^2(x-1)', '곡선 + 원점의 고립해'],
  ['sin x = 0', '해가 등차수열 xₙ = nπ 임을 자동으로 찾아냄'],
  ['x^2+y^2=4 and y=x^2-1', '연립방정식의 해를 점열로'],
  ['a_1=1; a_n=2a_{n-1}+1', '점화식 → 일반항 2ⁿ−1 복원'],
  ['[1,1,2,3,5,8,13,21]', '피보나치 판별 + 비네 공식'],
  ['{(1,3),(2,5),(3,7),(4,9)}', '점열에서 규칙 추출'],
  ['y = x^3 - 3x', '극값·변곡점·근을 한 번에'],
  ['(x^2+1)/x', '수직·사선 점근선 자동 검출'],
  ['x^2/9 + y^2/4 = 1', '이차곡선 자동 판별'],
  ['r = 1 + cos(θ)', '극좌표 곡선(심장형)'],
  ['(cos t, sin 2t)', '매개변수 곡선(리사주)'],
  ['y < x^2 - 2', '부등식 영역'],
  ['|x| + |y| = 2', '절댓값 방정식'],
  ['tan x = x', '초월방정식의 근을 점열로'],
  ['x^2+y^2=4 or y=x', '두 해집합의 합집합'],
  ['sin x=0 and cos x=-1', '한 변수 연립방정식의 공통근'],
  ['r = θ; 0 <= θ <= 8π', '범위를 지정한 나선'],
  ['y = sum(x^k/fact(k), k, 0, 8)', 'e^x 의 테일러 부분합 (Σ 지원)'],
  ['y = integral(sin(u), u, 0, x)', '정적분으로 정의한 함수'],
  ['y = floor(x)', '계단함수 — 도약에서 선을 끊는다'],
  ['x^3 + y^3 = 3x y', '데카르트의 잎 (매듭점 포함)'],
  ['P_n = (n, 2^n); 1 <= n <= 8', '점열을 직접 만들어 규칙 확인'],
  ['Q_k = (cos(2πk/7), sin(2πk/7)); 0 <= k <= 6', '정7각형 — 회전 규칙까지 읽어냄'],
  ['a = 2; y = a x^2', '슬라이더로 계수를 끌어 보기'],
  ['y = x^2 {0 < x < 3}', '정의역 제한 — 조건이 참인 곳만'],
  ['y = {x < 0: -x, x^2}', '조각별로 정의한 함수'],
  ['y = [1, 2, 3] x', '리스트로 여러 곡선을 한 번에'],
  ['x_1 = [1,2,3,4,5]', '자료 리스트 (표 대신)'],
  ['y_1 = [2.1, 3.9, 6.2, 7.8, 10.1]', '짝이 되는 자료'],
  ['y_1 ~ a x_1 + b', '최소제곱 회귀 — 계수와 R²를 구한다'],
  ['(x_1, y_1)', '자료를 점으로 찍기'],
  ['mean(y_1)', '통계 함수 (mean·median·stdev·total)'],
];

const START = ['sin(x)^2 + sin(y)^2 = 0', 'y = x^3 - 3x'];

class App {
  constructor() {
    this.canvas = document.getElementById('board');
    this.view = new View();
    this.renderer = new Renderer(this.canvas, this.view);
    this.ctx = createContext();
    this.objects = [];
    this.nextId = 1;
    this.colorSeq = 0;
    this.selected = null;
    this.hover = null;
    this.needsCompute = true;
    this.showIntersections = false;
    this.intersections = [];
    this.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

    this.applyTheme();
    this.bind();
    this.renderer.resize();
    this.view.scale = Math.min(this.view.width / 13, this.view.height / 9);
    if (!this.restore()) START.forEach((s) => this.addObject(s));
    this.applyTheme();
    this.pushHistory();
    this.renderInputs();
    this.buildExamples();
    this.schedule();
  }

  // ── 상태 ────────────────────────────────
  addObject(source = '') {
    const obj = createObject(source, this.ctx, this.nextId++, this.colorSeq);
    obj.color = PALETTE[this.colorSeq % PALETTE.length];
    this.colorSeq++;
    this.objects.push(obj);
    this.needsCompute = true;
    return obj;
  }

  updateObject(obj, source) {
    const idx = this.objects.indexOf(obj);
    if (obj.defName) { this.ctx.defs.delete(obj.defName); this.ctx.seqs.delete(obj.defName); }
    if (obj.name) this.ctx.seqs.delete(obj.name);
    const next = createObject(source, this.ctx, obj.id, obj.colorIndex);
    next.color = obj.color;
    next.visible = obj.visible;
    this.objects[idx] = next;
    if (this.selected === obj) this.selected = next;
    this.needsCompute = true;
    return next;
  }

  removeObject(obj) {
    this.pushHistory();
    if (obj.defName) this.ctx.defs.delete(obj.defName);
    if (obj.name) this.ctx.seqs.delete(obj.name);
    this.objects = this.objects.filter((o) => o !== obj);
    if (this.selected === obj) this.selected = null;
    this.needsCompute = true;
    this.renderInputs();
    this.schedule();
  }

  // ── 저장 · 복원 ──────────────────────────
  /** 현재 상태를 주소창 해시와 로컬 저장소에 남긴다 */
  save() {
    try {
      const state = {
        v: 1,
        o: this.objects.filter((o) => o.source.trim()).map((o) => [o.source, o.visible ? 1 : 0]),
        c: [+this.view.cx.toFixed(10), +this.view.cy.toFixed(10),
            +this.view.scaleX.toFixed(6), +this.view.scaleY.toFixed(6)],
        t: this.theme,
        i: this.showIntersections ? 1 : 0,
      };
      const enc = btoa(unescape(encodeURIComponent(JSON.stringify(state))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      history.replaceState(null, '', `#${enc}`);
      localStorage.setItem('graph-state', enc);
    } catch { /* 저장은 실패해도 계산에는 지장이 없다 */ }
  }

  restore() {
    const src = location.hash.slice(1) || (() => {
      try { return localStorage.getItem('graph-state') || ''; } catch { return ''; }
    })();
    if (!src) return false;
    try {
      const json = decodeURIComponent(escape(atob(src.replace(/-/g, '+').replace(/_/g, '/'))));
      const st = JSON.parse(json);
      if (!st || !Array.isArray(st.o)) return false;
      for (const [text, vis] of st.o) {
        const o = this.addObject(text);
        o.visible = vis !== 0;
      }
      if (Array.isArray(st.c)) {
        this.view.cx = st.c[0];
        this.view.cy = st.c[1];
        this.view.scaleX = st.c[2];
        this.view.scaleY = st.c[3] ?? st.c[2];
        this.view.locked = Math.abs(this.view.scaleY - this.view.scaleX) < 1e-9;
      }
      if (st.t) this.theme = st.t;
      this.showIntersections = !!st.i;
      return this.objects.length > 0;
    } catch { return false; }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  /** 식 목록의 현재 모습을 되돌리기 더미에 쌓는다 */
  pushHistory() {
    const snap = JSON.stringify(this.objects.map((o) => [o.source, o.visible ? 1 : 0]));
    this.history = this.history || [];
    if (this.history[this.history.length - 1] === snap) return;
    this.history.push(snap);
    if (this.history.length > 60) this.history.shift();
    if (!this.restoringHistory) this.future = [];
  }

  applySnapshot(snap) {
    this.restoringHistory = true;
    const list = JSON.parse(snap);
    this.objects = [];
    this.ctx = createContext();
    this.selected = null;
    for (const [text, vis] of list) {
      const o = this.addObject(text);
      o.visible = vis !== 0;
    }
    this.needsCompute = true;
    this.compute();
    this.renderInputs();
    this.schedule();
    this.scheduleSave();
    this.restoringHistory = false;
  }

  undo() {
    this.pushHistory();          // 지금 모습이 더미 맨 위에 있도록 맞춘다
    if (!this.history || this.history.length < 2) { this.toast('되돌릴 것이 없습니다'); return; }
    const cur = this.history.pop();
    (this.future = this.future || []).push(cur);
    this.applySnapshot(this.history[this.history.length - 1]);
    this.toast('되돌렸습니다');
  }

  redo() {
    if (!this.future || !this.future.length) { this.toast('다시 할 것이 없습니다'); return; }
    const snap = this.future.pop();
    this.history.push(snap);
    this.applySnapshot(snap);
    this.toast('다시 했습니다');
  }

  // ── 계산 · 그리기 ────────────────────────
  compute() {
    // 보이는 영역보다 조금 넓게 계산해 둔다. 끌기 중에는 다시 풀지 않으므로
    // 이 여유분이 있어야 손을 놓기 전까지 가장자리가 비어 보이지 않는다.
    const b = padBounds(this.view.bounds(), 0.12);
    const t0 = performance.now();
    let pts = 0;
    for (const o of this.objects) {
      if (!o.visible || o.error) { o.data = null; continue; }
      try {
        o.data = computeObject(o, b);
        pts += (o.data.points || []).length;
        // 아직 정의되지 않은 이름을 쓰고 있으면 조용히 NaN 을 내는 대신 알려 준다
        const miss = missingRefs(o, this.ctx);
        o.missing = miss.length ? miss : null;
      } catch (e) {
        o.data = null;
        o.runtimeError = e.message;
      }
    }
    this.intersections = this.showIntersections ? intersectionsOf(this.objects, b) : [];
    this.needsCompute = false;
    this.lastCost = performance.now() - t0;
    this.lastPoints = pts;
    this.scheduleSave();
  }

  draw() {
    const r = this.renderer;
    const b = this.view.bounds();
    r.clear();
    r.beginFrame();
    r.drawGrid();

    for (const o of this.objects) {
      if (!o.visible || !o.data) continue;
      const d = o.data;
      if (d.mask) r.drawMask(d.mask, o.color, b);
      if (d.polylines && d.polylines.length) {
        r.drawPolylines(d.polylines, o.color, d.ghost ? 1.2 : 2.1, d.dash || (d.ghost ? [4, 4] : null));
      }
      if (d.stems && d.points) {
        // 화면 밖으로 치솟는 항의 막대는 그리지 않는다 (세로줄만 남아 지저분해진다)
        const stems = d.points
          .filter(([, y]) => y >= b.ymin && y <= b.ymax)
          .map(([x, y]) => [x, 0, x, y]);
        r.drawPolylines(stems, o.color, 1, [2, 3]);
      }
      if (d.points && d.points.length) {
        const many = d.points.length > 400;
        r.drawPoints(d.points, o.color, many ? 2.4 : 4.6);
        if (!many && d.points.length <= 10 && o.kind !== 'sequence') {
          r.drawLabels(
            d.points.map(([x, y]) => ({ x, y, text: `(${pretty(x)}, ${pretty(y)})` })),
            o.color,
          );
        }
      }
    }

    if (this.showIntersections && this.intersections.length) {
      r.drawPoints(this.intersections, this.colors().mark, 5, { hollow: true });
      if (this.intersections.length <= 12) {
        r.drawLabels(this.intersections.map(([x, y]) => ({ x, y, text: `(${pretty(x)}, ${pretty(y)})` })),
          this.colors().mark);
      }
    }
    if (this.hover) {
      r.drawCrosshair(this.hover.px, this.hover.py, this.hover.text);
    }
    this.updateStatus();
  }

  colors() {
    return { mark: this.theme === 'dark' ? '#fbbf24' : '#b45309' };
  }

  updateStatus() {
    const el = document.getElementById('status');
    const b = this.view.bounds();
    const span = b.xmax - b.xmin;
    // 확대할수록 자릿수를 늘려야 [0, 0] 처럼 뭉개지지 않는다
    const digits = Math.min(12, Math.max(3, 2 - Math.floor(Math.log10(span))));
    el.textContent =
      `x ∈ [${trimNum(b.xmin, digits)}, ${trimNum(b.xmax, digits)}]  ·  1칸 ≈ ${trimNum(span / 10, digits)}`
      + (this.lastCost ? `  ·  ${this.lastCost.toFixed(0)}ms` : '')
      + (this.lastPoints ? `  ·  점 ${this.lastPoints}개` : '')
      + (this.showIntersections ? `  ·  교점 ${this.intersections.length}개` : '')
      + (this.view.locked ? '' : `  ·  y축 ${trimNum(this.view.aspect, 3)}배`);
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      // 끌거나 확대하는 동안에는 다시 풀지 않고 이미 구해 둔 해집합을 그대로 그린다.
      // 해집합은 수학 좌표로 저장되어 있으므로 화면 변환만 바뀌면 그림은 그대로 맞고,
      // 무거운 음함수가 여럿 올라와 있어도 손놀림이 끊기지 않는다.
      if (this.needsCompute && !this.deferCompute) this.compute();
      this.draw();
    });
  }

  /** 상호작용이 끝난 뒤 다시 계산하도록 예약 */
  deferRecompute(ms = 160) {
    this.deferCompute = true;
    clearTimeout(this.deferTimer);
    this.deferTimer = setTimeout(() => {
      this.deferCompute = false;
      this.needsCompute = true;
      this.schedule();
    }, ms);
  }

  // ── UI ──────────────────────────────────
  renderInputs() {
    const host = document.getElementById('inputs');
    host.innerHTML = '';
    for (const o of this.objects) {
      const row = document.createElement('div');
      row.className = 'item' + (o.error ? ' err' : '');

      const head = document.createElement('div');
      head.className = 'item-head';

      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = o.color;
      sw.title = '보이기/숨기기';
      sw.onclick = () => { o.visible = !o.visible; sw.style.opacity = o.visible ? 1 : .25; this.schedule(); };
      sw.style.opacity = o.visible ? 1 : .25;

      const input = document.createElement('input');
      input.className = 'expr';
      input.value = o.source;
      input.placeholder = '예: x^2 + y^2 = 4';
      input.spellcheck = false;
      input.onchange = () => {
        this.pushHistory();
        const next = this.updateObject(o, input.value);
        this.renderInputs();
        if (this.selected === next) this.showAnalysis(next);
        this.schedule();
        this.scheduleSave();
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          input.blur();
          if (o === this.objects[this.objects.length - 1] && input.value.trim()) {
            this.addObject('');
            this.renderInputs();
            const els = host.querySelectorAll('input.expr');
            els[els.length - 1]?.focus();
          }
        }
      };

      const acts = document.createElement('div');
      acts.className = 'acts';
      const an = document.createElement('button');
      an.className = 'iconbtn' + (this.selected === o ? ' on' : '');
      an.textContent = '분석';
      an.onclick = () => { this.selected = o; this.renderInputs(); this.showAnalysis(o); };
      const del = document.createElement('button');
      del.className = 'iconbtn';
      del.textContent = '✕';
      del.title = '삭제';
      del.onclick = () => this.removeObject(o);
      acts.append(an, del);

      head.append(sw, input, acts);
      row.append(head);

      if (o.error) {
        const em = document.createElement('div');
        em.className = 'errmsg';
        em.textContent = `⚠ ${o.error}`;
        row.append(em);
      } else if (o.source.trim()) {
        if (o.missing) {
          const w = document.createElement('div');
          w.className = 'notemsg';
          w.textContent = `⚠ ${o.missing.join(', ')} 가 아직 정의되지 않았습니다.`;
          row.append(w);
        }
        if (o.note) {
          const w = document.createElement('div');
          w.className = 'notemsg';
          w.textContent = `ℹ ${o.note}`;
          row.append(w);
        }
        const meta = document.createElement('div');
        meta.className = 'item-meta';
        meta.innerHTML = `<span class="tag">${KIND_LABEL[o.kind] || o.kind}</span>`;
        const d = o.data;
        if (d) {
          if (d.polylines?.length) meta.innerHTML += `<span class="tag">곡선 ${d.polylines.length}가지</span>`;
          if (d.isolated?.length) meta.innerHTML += `<span class="tag pt">점 ${d.isolated.length}개</span>`;
          if (d.empty) meta.innerHTML += '<span class="tag none">해 없음</span>';
          if (d.dense) meta.innerHTML += `<span class="tag none">해가 촘촘함(${d.total}+)</span>`;
        }
        if (o.data && o.data.branches) {
          meta.innerHTML += `<span class="tag">곡선 ${o.data.branches}개 묶음</span>`;
        }
        if (o.kind === 'regression') {
          meta.innerHTML += `<span class="tag pt">R² = ${o.r2.toFixed(5)}</span>`;
        }
        if (o.kind === 'value' || o.kind === 'constant') {
          meta.innerHTML += `<span class="tag pt">${escapeHtml(o.label)}</span>`;
        }
        if (o.label && o.label !== o.source) {
          const s = document.createElement('span');
          s.textContent = o.label;
          s.style.fontFamily = 'var(--mono)';
          meta.append(s);
        }
        row.append(meta);
        if (o.slider) row.append(this.buildSlider(o));
      }
      host.append(row);
    }
  }

  /** 상수 정의에 붙는 슬라이더 — 값을 끌면 그 값을 쓰는 식이 함께 움직인다 */
  buildSlider(o) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-row';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = o.slider.min;
    input.max = o.slider.max;
    input.step = o.slider.step;
    input.value = o.value;
    const out = document.createElement('span');
    out.className = 'slider-val';
    out.textContent = `${o.defName} = ${trimNum(o.value, 4)}`;

    const apply = (v) => {
      o.value = v;
      const def = this.ctx.defs.get(o.defName);
      if (def) { def.body = { type: 'num', value: v }; def.compiled = null; }
      o.label = `${o.defName} = ${pretty(v)}`;
      out.textContent = `${o.defName} = ${trimNum(v, 4)}`;
      this.needsCompute = true;
      this.schedule();
    };
    input.oninput = () => { this.deferRecompute(90); apply(parseFloat(input.value)); };
    input.onchange = () => {
      // 손을 놓으면 원래 입력 문자열도 갱신해 두어야 저장·공유에 값이 남는다
      const keep = o.source.includes(';') ? o.source.slice(o.source.indexOf(';')) : '';
      o.source = `${o.defName} = ${trimNum(parseFloat(input.value), 6)}${keep}`;
      const el = [...document.querySelectorAll('#inputs input.expr')][this.objects.indexOf(o)];
      if (el) el.value = o.source;
      this.deferCompute = false;
      this.needsCompute = true;
      this.schedule();
      this.scheduleSave();
    };
    wrap.append(input, out);
    return wrap;
  }

  buildExamples() {
    const list = document.getElementById('exampleList');
    for (const [expr, desc] of EXAMPLES) {
      const b = document.createElement('button');
      b.className = 'ex';
      b.innerHTML = `<code>${escapeHtml(expr)}</code><span>${escapeHtml(desc)}</span>`;
      b.onclick = () => {
        const empty = this.objects.find((o) => !o.source.trim());
        if (empty) this.updateObject(empty, expr);
        else this.addObject(expr);
        this.needsCompute = true;
        this.compute();
        // 예제 하나만 놓인 상태라면 해가 잘 보이도록 화면을 맞춰 준다
        if (this.objects.filter((o) => o.source.trim()).length === 1) this.fitToSolutions();
        this.renderInputs();
        const target = this.objects.find((o) => o.source === expr);
        if (target) { this.selected = target; this.showAnalysis(target); this.renderInputs(); }
        this.schedule();
      };
      list.append(b);
    }
  }

  showIntersectionAnalysis() {
    const host = document.getElementById('analysis');
    host.innerHTML = '';
    if (!this.intersections.length) {
      host.innerHTML = '<div class="an-empty">보이는 범위 안에서 곡선끼리 만나는 점이 없습니다.</div>';
      return;
    }
    // 곡선 쌍마다 따로 보아야 규칙이 드러난다.
    // (여러 쌍의 교점을 한 덩어리로 섞으면 아무 규칙도 안 보인다)
    const groups = this.intersections.groups || [];
    const findings = [];
    for (const g of groups) {
      const r = analyzePointSet(g.points);
      const head = `${g.labels[0]} ∩ ${g.labels[1]}`;
      findings.push({
        type: 'pair', title: `${head} — 교점 ${g.points.length}개`, confidence: 1,
        detail: g.points.slice(0, 6).map(([x, y]) => `(${pretty(x)}, ${pretty(y)})`).join(', ')
          + (g.points.length > 6 ? ' …' : ''),
      });
      for (const f of r.findings.slice(0, 3)) {
        findings.push({ ...f, title: `└ ${f.title}`, confidence: Math.min(f.confidence ?? 1, 0.99) });
      }
    }
    this.paintAnalysis({
      title: '교점 분석',
      lead: `${groups.length}쌍의 곡선이 모두 ${this.intersections.length}개 점에서 만납니다.`,
      findings,
      summary: '교점',
    }, '곡선끼리 만나는 점');
  }

  showAnalysis(obj) {
    const host = document.getElementById('analysis');
    host.innerHTML = '';
    if (!obj || obj.error) {
      host.innerHTML = '<div class="an-empty">분석할 수 있는 식이 아닙니다.</div>';
      return;
    }
    if (this.needsCompute) this.compute();
    const res = analyzeObject(obj, this.view.bounds(), this.ctx);
    if (!res) {
      host.innerHTML = '<div class="an-empty">이 형태는 아직 분석 대상이 아닙니다.</div>';
      return;
    }
    this.paintAnalysis(res, obj.label);
  }

  paintAnalysis(res, subject) {
    const host = document.getElementById('analysis');
    host.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'an-head';
    h.textContent = `${res.title} — ${subject}`;
    host.append(h);
    if (res.note) {
      const n = document.createElement('div');
      n.className = 'an-note';
      n.textContent = `ℹ ${res.note}`;
      host.append(n);
    }
    if (res.lead || res.summary) {
      const l = document.createElement('div');
      l.className = 'an-lead';
      l.textContent = res.lead || res.summary;
      host.append(l);
    }
    const findings = res.findings || [];
    if (!findings.length) {
      host.innerHTML += '<div class="an-empty">뚜렷한 규칙을 찾지 못했습니다.<br />범위를 넓히거나 항을 더 주면 더 잘 찾습니다.</div>';
      return;
    }
    for (const f of findings) {
      const c = document.createElement('div');
      c.className = 'card' + ((f.confidence ?? 1) < 0.85 ? ' low' : '');
      c.innerHTML =
        `<div class="card-t"><span>${escapeHtml(f.title)}</span>` +
        `<span class="conf">확신도 ${Math.round((f.confidence ?? 1) * 100)}%</span></div>` +
        (f.detail ? `<div class="card-d">${escapeHtml(f.detail)}</div>` : '') +
        (f.formula ? `<div class="formula">${escapeHtml(f.formula)}</div>` : '') +
        (f.extra ? `<div class="card-d">${escapeHtml(f.extra)}</div>` : '') +
        (f.next && f.next.every((x) => typeof x === 'number' && isFinite(x))
          ? `<div class="next">다음 항 예측 → ${f.next.map((x) => pretty(x)).join(',  ')}</div>` : '') +
        (f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : '');
      host.append(c);
    }
  }

  applyTheme() {
    document.documentElement.dataset.theme = this.theme;
    this.renderer.setTheme(this.theme);
  }

  fitToSolutions() {
    const xs = [], ys = [];
    for (const o of this.objects) {
      if (!o.visible || !o.data) continue;
      for (const p of o.data.points || []) { xs.push(p[0]); ys.push(p[1]); }
      for (const l of o.data.polylines || []) {
        for (let i = 0; i < l.length; i += 2) { xs.push(l[i]); ys.push(l[i + 1]); }
      }
    }
    if (xs.length < 2) return;
    const pad = 0.2;
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 - x0 < 1e-6) { x0 -= 1; x1 += 1; }
    if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
    this.view.fit(x0, x1, y0, y1, pad, false);
    this.needsCompute = true;
    this.schedule();
  }

  // ── 이벤트 ──────────────────────────────
  bind() {
    const c = this.canvas;
    let dragging = false, lastX = 0, lastY = 0, moved = false;
    const active = new Map();       // 손가락 두 개를 추적해 핀치 줌을 지원한다
    let pinch = null;

    const pinchState = () => {
      const [a, b] = [...active.values()];
      const rect = c.getBoundingClientRect();
      return {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mx: (a.x + b.x) / 2 - rect.left,
        my: (a.y + b.y) / 2 - rect.top,
      };
    };

    c.addEventListener('pointerdown', (e) => {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.deferCompute = true;
      if (active.size === 2) { pinch = pinchState(); dragging = false; return; }
      dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (active.has(e.pointerId)) active.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (active.size === 2 && pinch) {
        const now = pinchState();
        if (pinch.dist > 0 && now.dist > 0) {
          this.view.zoomAt(now.mx, now.my, now.dist / pinch.dist);
          this.view.panPx(now.mx - pinch.mx, now.my - pinch.my);
        }
        pinch = now;
        moved = true;
        this.needsCompute = true;
        this.schedule();
        return;
      }
      if (dragging) {
        moved = true;
        this.view.panPx(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX; lastY = e.clientY;
        this.needsCompute = true;
        this.schedule();
        return;
      }
      this.hover = this.probe(px, py);
      this.schedule();
    });
    const end = (e) => {
      if (e && active.has(e.pointerId)) active.delete(e.pointerId);
      if (active.size < 2) pinch = null;
      if (active.size > 0) return;
      dragging = false;
      this.deferCompute = false;
      if (moved) { this.needsCompute = true; }
      this.schedule();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.hover = null; this.schedule(); });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const f = Math.pow(0.999, e.deltaY);
      // shift 를 누르면 세로만, alt 를 누르면 가로만 확대·축소한다
      const axis = e.shiftKey ? 'y' : e.altKey ? 'x' : 'both';
      this.view.zoomAt(e.clientX - rect.left, e.clientY - rect.top, f, axis);
      this.needsCompute = true;
      this.deferRecompute();
      this.schedule();
    }, { passive: false });

    c.addEventListener('dblclick', () => {
      this.view.cx = 0; this.view.cy = 0;
      this.view.scale = Math.min(this.view.width / 13, this.view.height / 9);
      this.needsCompute = true;
      this.schedule();
    });

    window.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { if (!typing) { e.preventDefault(); this.undo(); } }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { if (!typing) { e.preventDefault(); this.redo(); } }
    });

    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.needsCompute = true;
      this.schedule();
    });

    document.getElementById('addBtn').onclick = () => {
      this.addObject('');
      this.renderInputs();
      const els = document.querySelectorAll('#inputs input.expr');
      els[els.length - 1]?.focus();
    };
    document.getElementById('clearBtn').onclick = () => {
      this.objects = [];
      this.ctx = createContext();
      this.selected = null;
      this.addObject('');
      this.renderInputs();
      document.getElementById('analysis').innerHTML =
        '<div class="an-empty">식 옆의 <b>분석</b> 버튼을 누르면<br />해집합의 규칙성을 찾아 드립니다.</div>';
      this.needsCompute = true;
      this.schedule();
    };
    document.getElementById('exampleBtn').onclick = () => {
      const s = document.getElementById('examples');
      s.hidden = !s.hidden;
    };

    document.getElementById('tools').addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      const cx = this.view.width / 2, cy = this.view.height / 2;
      if (act === 'zoomin') this.view.zoomAt(cx, cy, 1.4);
      if (act === 'zoomout') this.view.zoomAt(cx, cy, 1 / 1.4);
      if (act === 'reset') {
        this.view.cx = 0; this.view.cy = 0;
        this.view.scale = Math.min(this.view.width / 13, this.view.height / 9);
      }
      if (act === 'fit') { this.compute(); this.fitToSolutions(); }
      if (act === 'theme') { this.theme = this.theme === 'dark' ? 'light' : 'dark'; this.applyTheme(); this.scheduleSave(); }
      if (act === 'square') { this.view.squareUp(); }
      if (act === 'cross') {
        this.showIntersections = !this.showIntersections;
        e.target.classList.toggle('on', this.showIntersections);
        this.needsCompute = true;
        this.compute();
        if (this.showIntersections) this.showIntersectionAnalysis();
      }
      if (act === 'link') { this.copyLink(); return; }
      if (act === 'png') { this.savePng(); return; }
      this.needsCompute = true;
      this.schedule();
    });
  }

  async copyLink() {
    this.save();
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      this.toast('링크를 복사했습니다');
    } catch {
      this.toast('주소창의 링크를 복사해 주세요');
    }
  }

  toast(text) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.getElementById('stage').append(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  savePng() {
    this.compute();
    this.draw();
    this.canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'graph.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  /** 마우스 근처의 해를 찾아 좌표를 알려 준다 */
  probe(px, py) {
    const mx = this.view.toMathX(px);
    const my = this.view.toMathY(py);
    let best = null, bestD = 18;
    for (const o of this.objects) {
      if (!o.visible || !o.data) continue;
      for (const p of o.data.points || []) {
        const d = Math.hypot(this.view.toPxX(p[0]) - px, this.view.toPxY(p[1]) - py);
        if (d < bestD) { bestD = d; best = { p, o, kind: '해' }; }
      }
      for (const l of o.data.polylines || []) {
        for (let i = 0; i < l.length; i += 2) {
          const d = Math.hypot(this.view.toPxX(l[i]) - px, this.view.toPxY(l[i + 1]) - py);
          if (d < bestD) { bestD = d; best = { p: [l[i], l[i + 1]], o, kind: '곡선' }; }
        }
      }
    }
    if (best) {
      return {
        px: this.view.toPxX(best.p[0]), py: this.view.toPxY(best.p[1]),
        text: `${best.kind} (${pretty(best.p[0])}, ${pretty(best.p[1])})`,
      };
    }
    return { px, py, text: `(${trimNum(mx, 4)}, ${trimNum(my, 4)})` };
  }
}

/** 화면 영역을 비율만큼 넓힌 계산용 경계 */
function padBounds(b, pad) {
  const dx = (b.xmax - b.xmin) * pad;
  const dy = (b.ymax - b.ymin) * pad;
  return {
    xmin: b.xmin - dx, xmax: b.xmax + dx,
    ymin: b.ymin - dy, ymax: b.ymax + dy,
    width: b.width * (1 + 2 * pad), height: b.height * (1 + 2 * pad),
  };
}

const KIND_LABEL = {
  function: '함수', functionY: 'x=f(y)', implicit: '음함수', region: '영역',
  system: '연립방정식', equation1d: '방정식', points: '점열', point: '점',
  sequence: '수열', parametric: '매개변수', polar: '극좌표', value: '값',
  union: '합집합', list: '리스트', regression: '회귀', pointseq: '점열',
  constant: '상수', defined: '정의', statement: '판정', empty: '빈 칸',
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
