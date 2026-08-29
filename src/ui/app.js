// 앱 컨트롤러: 입력 목록 · 캔버스 · 분석 패널을 잇는다.

import { View } from './view.js';
import { Renderer, PALETTE, SWATCHES, DASHES, defaultStyle } from './renderer.js';
import { createContext, createObject, computeObject, analyzeObject, missingRefs, intersectionsOf, dependsOn, sweepHooks } from './objects.js';
import { sweepSteps } from '../analysis/sweep.js';
import { analyzePointSet } from '../analysis/pointset.js';
import { renderMath } from './mathhtml.js';
import { setAngleMode, getAngleMode } from '../math/functions.js';
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
  ['a = 1; -2 <= a <= 2', '훑기 버튼을 눌러 볼 파라미터'],
  ['x^2 + a y^2 = 1', '↑ 와 함께 — 쌍곡선·두 직선·타원·원이 갈리는 지점을 찾는다'],
  ['y = x^3 + a x', '↑ 와 함께 — 실근이 3개에서 1개로 바뀌는 지점'],
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
    // 먼저 한 번 풀어 두어야 목록에 "접선: y = 9x − 16" 같은 계산 결과가 함께 나온다
    this.compute();
    this.renderInputs();
    this.buildExamples();
    this.schedule();
  }

  // ── 상태 ────────────────────────────────
  addObject(source = '', style = null) {
    const obj = createObject(source, this.ctx, this.nextId++, this.colorSeq);
    obj.color = PALETTE[this.colorSeq % PALETTE.length];
    obj.style = style ? { ...defaultStyle(obj.color), ...style } : defaultStyle(obj.color);
    obj.color = obj.style.color;
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
    next.style = obj.style;
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
        o: this.objects.filter((o) => o.source.trim())
          .map((o) => [o.source, o.visible ? 1 : 0, packStyle(o.style)]),
        c: [+this.view.cx.toFixed(10), +this.view.cy.toFixed(10),
            +this.view.scaleX.toFixed(6), +this.view.scaleY.toFixed(6)],
        t: this.theme,
        i: this.showIntersections ? 1 : 0,
        g: getAngleMode(),
      };
      const enc = btoa(unescape(encodeURIComponent(JSON.stringify(state))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      history.replaceState(null, '', `#${enc}`);
      localStorage.setItem('graph-state', enc);
    } catch { /* 저장은 실패해도 계산에는 지장이 없다 */ }
  }

  restore() {
    const applyAngle = (m) => {
      if (m && m !== getAngleMode()) {
        setAngleMode(m);
        const btn = document.querySelector('[data-act="angle"]');
        if (btn) { btn.textContent = m === 'deg' ? '°' : 'π'; }
      }
    };
    const src = location.hash.slice(1) || (() => {
      try { return localStorage.getItem('graph-state') || ''; } catch { return ''; }
    })();
    if (!src) return false;
    try {
      const json = decodeURIComponent(escape(atob(src.replace(/-/g, '+').replace(/_/g, '/'))));
      const st = JSON.parse(json);
      if (!st || !Array.isArray(st.o)) return false;
      applyAngle(st.g);
      for (const [text, vis, sty] of st.o) {
        const o = this.addObject(text, unpackStyle(sty));
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
      const st = o.style || defaultStyle(o.color);
      if (d.mask) r.drawMask(d.mask, st.color, b);
      if (d.areaFill && d.areaFill.length) r.drawArea(d.areaFill, st.color);
      if (d.polylines && d.polylines.length) {
        const dash = d.dash || (d.ghost ? [4, 4] : DASHES[st.dash] || null);
        r.drawPolylines(d.polylines, st.color, d.ghost ? 1.2 : st.width, dash, st.opacity);
      }
      if (d.stems && d.points) {
        // 화면 밖으로 치솟는 항의 막대는 그리지 않는다 (세로줄만 남아 지저분해진다)
        const stems = d.points
          .filter(([, y]) => y >= b.ymin && y <= b.ymax)
          .map(([x, y]) => [x, 0, x, y]);
        r.drawPolylines(stems, st.color, 1, [2, 3], st.opacity * 0.8);
      }
      if (d.points && d.points.length) {
        const many = d.points.length > 400;
        r.drawPoints(d.points, st.color, many ? 2.4 : st.pointSize,
          { style: st.pointStyle, opacity: st.opacity });
        if (!many && d.points.length <= 10 && o.kind !== 'sequence' && !d.labels) {
          r.drawLabels(
            d.points.map(([x, y]) => ({ x, y, text: `(${pretty(x)}, ${pretty(y)})` })),
            st.color,
          );
        }
      }
      // 접선의 방정식, 정적분의 값처럼 그림 위에 직접 적어 주는 글
      if (d.labels && d.labels.length) r.drawLabels(d.labels, st.color);
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
      sw.style.background = (o.style || {}).color || o.color;
      sw.title = '색·굵기·선 모양 바꾸기';
      sw.style.opacity = o.visible ? 1 : .25;
      sw.onclick = () => {
        const open = row.querySelector('.style-panel');
        if (open) { open.remove(); return; }
        row.append(this.buildStylePanel(o, sw));
      };

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
        const els = [...document.querySelectorAll('#inputs input.expr')];
        const at = els.indexOf(input);
        if (e.key === 'ArrowUp' && at > 0) { e.preventDefault(); els[at - 1].focus(); return; }
        if (e.key === 'ArrowDown' && at >= 0 && at < els.length - 1) {
          e.preventDefault();
          els[at + 1].focus();
          return;
        }
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
      const eye = document.createElement('button');
      eye.className = 'iconbtn';
      eye.textContent = o.visible ? '●' : '○';
      eye.title = '보이기/숨기기';
      eye.onclick = () => {
        o.visible = !o.visible;
        eye.textContent = o.visible ? '●' : '○';
        sw.style.opacity = o.visible ? 1 : .25;
        this.schedule();
        this.scheduleSave();
      };
      const an = document.createElement('button');
      an.className = 'iconbtn' + (this.selected === o ? ' on' : '');
      an.textContent = '분석';
      an.onclick = () => { this.selected = o; this.renderInputs(); this.showAnalysis(o); };
      const del = document.createElement('button');
      del.className = 'iconbtn';
      del.textContent = '✕';
      del.title = '삭제';
      del.onclick = () => this.removeObject(o);
      acts.append(eye, an, del);

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
        if (o.kind === 'value' || o.kind === 'constant' || o.kind === 'setting') {
          meta.innerHTML += `<span class="tag pt">${escapeHtml(o.label)}</span>`;
        }
        if (o.valueKind === 'exact') meta.innerHTML += '<span class="tag">정확값</span>';
        else if (o.valueKind === 'big') meta.innerHTML += '<span class="tag">고정밀</span>';
        if (d && d.equation) meta.innerHTML += `<span class="tag pt">${escapeHtml(d.equation)}</span>`;
        if (d && d.value !== undefined && o.kind === 'integral') {
          meta.innerHTML += `<span class="tag pt">= ${escapeHtml(pretty(d.value))}</span>`;
        }
        row.append(meta);
        // 입력한 식을 수학처럼 보이게 다시 그려 준다 (분수는 쌓고, 지수는 위로)
        const ast = o.asts && o.asts[o.asts.length - 1];
        if (ast && !['constant', 'list', 'value'].includes(o.kind)) {
          const m = document.createElement('div');
          m.className = 'item-math';
          m.innerHTML = renderMath(ast);
          row.append(m);
        } else if (o.label && o.label !== o.source) {
          const s2 = document.createElement('div');
          s2.className = 'item-math';
          s2.style.fontFamily = 'var(--mono)';
          s2.style.fontSize = '11.5px';
          s2.style.color = 'var(--muted)';
          s2.textContent = o.label;
          row.append(s2);
        }
        if (o.slider) row.append(this.buildSlider(o));
      }
      host.append(row);
    }
  }

  /** 색·굵기·선 모양·점 모양을 고르는 패널 */
  buildStylePanel(o, swatchEl) {
    const st = o.style || (o.style = defaultStyle(o.color));
    const panel = document.createElement('div');
    panel.className = 'style-panel';

    const colors = document.createElement('div');
    colors.className = 'sw-grid';
    for (const c of SWATCHES) {
      const b = document.createElement('button');
      b.className = 'sw-dot' + (c === st.color ? ' on' : '');
      b.style.background = c;
      b.onclick = () => {
        st.color = c;
        o.color = c;
        swatchEl.style.background = c;
        colors.querySelectorAll('.sw-dot').forEach((n) => n.classList.remove('on'));
        b.classList.add('on');
        this.schedule();
        this.scheduleSave();
      };
      colors.append(b);
    }
    panel.append(colors);

    const rowOf = (label, node) => {
      const r = document.createElement('div');
      r.className = 'style-row';
      const l = document.createElement('span');
      l.textContent = label;
      r.append(l, node);
      return r;
    };
    const slider = (min, max, step, value, apply) => {
      const i = document.createElement('input');
      i.type = 'range';
      i.min = min; i.max = max; i.step = step; i.value = value;
      i.oninput = () => { apply(parseFloat(i.value)); this.schedule(); };
      i.onchange = () => this.scheduleSave();
      return i;
    };
    const chips = (options, current, apply) => {
      const wrap = document.createElement('div');
      wrap.className = 'chips';
      for (const [key, label] of options) {
        const b = document.createElement('button');
        b.className = 'chip' + (key === current ? ' on' : '');
        b.textContent = label;
        b.onclick = () => {
          apply(key);
          wrap.querySelectorAll('.chip').forEach((n) => n.classList.remove('on'));
          b.classList.add('on');
          this.schedule();
          this.scheduleSave();
        };
        wrap.append(b);
      }
      return wrap;
    };

    panel.append(rowOf('굵기', slider(0.5, 6, 0.1, st.width, (v) => { st.width = v; })));
    panel.append(rowOf('진하기', slider(0.15, 1, 0.05, st.opacity, (v) => { st.opacity = v; })));
    panel.append(rowOf('선', chips(
      [['solid', '실선'], ['dashed', '파선'], ['dotted', '점선'], ['loose', '긴 파선']],
      st.dash, (v) => { st.dash = v; },
    )));
    panel.append(rowOf('점', chips(
      [['filled', '채움'], ['open', '테두리'], ['square', '네모'], ['cross', '×']],
      st.pointStyle, (v) => { st.pointStyle = v; },
    )));
    panel.append(rowOf('점 크기', slider(2, 12, 0.5, st.pointSize, (v) => { st.pointSize = v; })));
    return panel;
  }

  /** 상수 정의에 붙는 슬라이더 — 값을 끌면 그 값을 쓰는 식이 함께 움직인다 */
  buildSlider(o) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-row';
    const play = document.createElement('button');
    play.className = 'iconbtn play';
    play.textContent = o.slider.playing ? '⏸' : '▶';
    play.title = '값을 자동으로 훑기';
    const mode = document.createElement('button');
    mode.className = 'iconbtn play';
    mode.textContent = o.slider.mode === 'oscillate' ? '↔' : '↻';
    mode.title = o.slider.mode === 'oscillate' ? '끝에서 되돌아옴' : '끝에서 처음으로';
    const scan = document.createElement('button');
    scan.className = 'iconbtn play scan';
    scan.textContent = '훑기';
    scan.title = '값을 훑으며 해집합의 분류가 바뀌는 지점을 찾는다';
    scan.onclick = () => this.runSweep(o, scan);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = o.slider.min;
    input.max = o.slider.max;
    input.step = o.slider.step;
    input.value = o.value;
    const out = document.createElement('span');
    out.className = 'slider-val';
    out.textContent = `${o.defName} = ${trimNum(o.value, 4)}`;
    o.slider.render = (v) => {
      input.value = v;
      out.textContent = `${o.defName} = ${trimNum(v, 4)}`;
    };

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
    play.onclick = () => {
      o.slider.playing = !o.slider.playing;
      play.textContent = o.slider.playing ? '⏸' : '▶';
      if (o.slider.playing) this.startAnimation();
    };
    mode.onclick = () => {
      o.slider.mode = o.slider.mode === 'oscillate' ? 'loop' : 'oscillate';
      mode.textContent = o.slider.mode === 'oscillate' ? '↔' : '↻';
      mode.title = o.slider.mode === 'oscillate' ? '끝에서 되돌아옴' : '끝에서 처음으로';
    };
    o.slider.apply = apply;
    const track = document.createElement('div');
    track.className = 'slider-track';
    track.append(input);
    if (o.sweep) track.append(this.sweepTicks(o));
    wrap.append(play, mode, scan, track, out);
    return wrap;
  }

  /** 슬라이더 위에 분기점 눈금을 얹는다 */
  sweepTicks(o) {
    const marks = document.createElement('div');
    marks.className = 'sweep-ticks';
    const span = o.slider.max - o.slider.min;
    const put = (v, cls, title) => {
      if (!(span > 0) || v < o.slider.min || v > o.slider.max) return;
      const el = document.createElement('span');
      el.className = `tick ${cls}`;
      el.style.left = `${((v - o.slider.min) / span) * 100}%`;
      el.title = title;
      marks.append(el);
    };
    for (const t of o.sweep.transitions) put(t.at, 'change', `${t.atText}: ${t.before.label} → ${t.after.label}`);
    for (const e of o.sweep.events) put(e.at, 'event', `${e.atText}: ${e.sig.label}`);
    return marks;
  }

  /**
   * 슬라이더를 훑으며 분류가 바뀌는 지점을 찾는다.
   * 계산이 무거우므로 프레임마다 조금씩 나누어 돌린다 — 화면이 멈추지 않게.
   */
  async runSweep(o, btn) {
    if (this.sweeping) return;
    // 슬라이더 자신과 값을 담기만 하는 줄(상수·리스트)은 뺀다
    const deps = this.objects.filter((x) => x.visible && !x.error
      && x !== o && x.defName !== o.defName
      && !['constant', 'list', 'value', 'defined', 'empty'].includes(x.kind)
      && dependsOn(x, o.defName));
    if (!deps.length) { this.toast(`${o.defName} 를 쓰는 그래프가 없습니다`); return; }

    this.sweeping = true;
    const original = o.value;
    btn.textContent = '0%';
    btn.disabled = true;
    const setParam = (t) => {
      const def = this.ctx.defs.get(o.defName);
      if (!def) return;
      def.body = { type: 'num', value: t };
      def.compiled = null;
    };
    // 식이 다항식이면 분기점을 기호적으로 미리 구해 둔다.
    // 훑어서 찾는 것보다 정확하고, 왜 그 자리인지(판별식이 0 등)까지 말할 수 있다.
    const { exactAt, exactKind } = sweepHooks(deps, this.ctx, o.defName);

    const it = sweepSteps({
      objects: deps,
      setParam,
      min: o.slider.min,
      max: o.slider.max,
      bounds: this.view.bounds(),
      compute: (obj, b, opts) => computeObject(obj, b, opts),
      restore: original,
      exactAt,
      exactKind,
    });

    let res = null;
    for (;;) {
      const t0 = performance.now();
      let step;
      // 한 프레임에 12ms 어치만 돌리고 화면에 숨 쉴 틈을 준다
      do { step = it.next(); } while (!step.done && performance.now() - t0 < 12);
      if (step.done) { res = step.value; break; }
      btn.textContent = `${Math.round((step.value || 0) * 100)}%`;
      await new Promise((r) => requestAnimationFrame(r));
    }

    setParam(original);
    o.value = original;
    o.sweep = res;
    this.sweeping = false;
    btn.disabled = false;
    btn.textContent = '훑기';
    this.needsCompute = true;
    this.compute();
    this.renderInputs();
    this.showSweep(o);
    this.schedule();
  }

  showSweep(o) {
    const res = o.sweep;
    if (!res) return;
    const findings = [];
    for (const st of res.stages) {
      findings.push({
        type: 'stage', confidence: 1,
        title: `${o.defName} ∈ [${st.fromText}, ${st.toText}]`,
        detail: st.sig ? st.sig.label : '판정할 수 없음',
      });
    }
    for (const t of res.transitions) {
      findings.push({
        type: 'transition', confidence: 1,
        title: `분기점  ${o.defName} = ${t.atText}${t.approx ? ' (근사)' : ''}`,
        detail: `${t.before.label}  →  ${t.after.label}`
          + (t.isolated ? `\n이 값에서만: ${t.isolated.label}` : '')
          + (t.reason ? `\n근거: ${t.reason}` : ''),
        jump: t.at,
      });
    }
    for (const e of res.events) {
      findings.push({
        type: 'moment', confidence: 1,
        title: `특이한 순간  ${o.defName} = ${e.atText}`,
        detail: `이 값에서만 ${e.sig.label} 가 됩니다.`
          + (e.reason ? `\n근거: ${e.reason}` : ''),
        jump: e.at,
      });
    }
    const n = res.transitions.length + res.events.length;
    this.paintAnalysis({
      title: '파라미터 훑기',
      lead: n
        ? `${o.defName} 를 ${o.slider.min} 에서 ${o.slider.max} 까지 훑어 `
          + `분류가 달라지는 자리 ${n}곳을 찾았습니다. 카드를 누르면 그 값으로 옮겨 갑니다.`
        : `${o.defName} 를 통틀어 해집합의 분류가 달라지지 않습니다.`,
      findings,
      summary: '훑기',
    }, `${o.defName} = ${trimNum(o.slider.min, 4)} … ${trimNum(o.slider.max, 4)}`);

    // 분기점 카드를 누르면 그 값으로 이동
    const host = document.getElementById('analysis');
    const cards = [...host.querySelectorAll('.card')];
    findings.forEach((f, i) => {
      if (f.jump === undefined || !cards[i]) return;
      cards[i].classList.add('jumpable');
      cards[i].onclick = () => {
        const def = this.ctx.defs.get(o.defName);
        if (def) { def.body = { type: 'num', value: f.jump }; def.compiled = null; }
        o.value = f.jump;
        o.label = `${o.defName} = ${pretty(f.jump)}`;
        if (o.slider.render) o.slider.render(f.jump);
        const keep = o.source.includes(';') ? o.source.slice(o.source.indexOf(';')) : '';
        o.source = `${o.defName} = ${trimNum(f.jump, 8)}${keep}`;
        this.needsCompute = true;
        this.compute();
        this.renderInputs();
        this.schedule();
        this.scheduleSave();
      };
    });
  }

  /** 재생 중인 슬라이더를 시간에 따라 움직인다 */
  startAnimation() {
    if (this.animRaf) return;
    let last = performance.now();
    const step = (now) => {
      const playing = this.objects.filter((o) => o.slider && o.slider.playing && o.slider.apply);
      if (!playing.length) { this.animRaf = null; return; }
      const dt = Math.min(0.1, (now - last) / 1000);
      // 계산이 무거우면 프레임을 건너뛰어 손놀림이 끊기지 않게 한다
      const budget = Math.max(16, (this.lastCost || 0) * 1.3);
      if (now - last >= budget) {
        last = now;
        for (const o of playing) {
          const s = o.slider;
          const span = s.max - s.min;
          const speed = s.speed ?? span / 6;        // 기본: 6초에 한 바퀴
          s.dir = s.dir || 1;
          let v = o.value + speed * dt * s.dir;
          if (v > s.max) {
            if (s.mode === 'oscillate') { v = s.max - (v - s.max); s.dir = -1; }
            else v = s.min + ((v - s.min) % span);
          } else if (v < s.min) {
            if (s.mode === 'oscillate') { v = s.min + (s.min - v); s.dir = 1; }
            else v = s.max - ((s.max - v) % span);
          }
          s.apply(v);
          if (s.render) s.render(v);
        }
      }
      this.animRaf = requestAnimationFrame(step);
    };
    this.animRaf = requestAnimationFrame(step);
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
    const title = document.createElement('span');
    title.textContent = `${res.title} — ${subject}`;
    const copy = document.createElement('button');
    copy.className = 'iconbtn copy';
    copy.textContent = '복사';
    copy.title = '분석 결과를 글로 복사';
    copy.onclick = () => this.copyAnalysis(res, subject);
    h.append(title, copy);
    host.append(h);
    if (res.note) {
      const n = document.createElement('div');
      n.className = 'an-note';
      n.textContent = `ℹ ${res.note}`;
      host.append(n);
    }
    // 무엇을 다루고 있는지 — 객체 유형·정의역·좌표별 식
    if (res.profile && res.profile.length) {
      const p = document.createElement('table');
      p.className = 'an-profile';
      p.innerHTML = res.profile
        .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`)
        .join('');
      host.append(p);
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
    // 가설이 하나라도 있으면 그게 무슨 뜻인지 먼저 밝힌다
    if (findings.some((f) => f.hypothesis)) {
      const n = document.createElement('div');
      n.className = 'an-note';
      n.textContent = 'ℹ 아래에서 규칙 이라고 적은 것은 모두 주어진 데이터와 맞는 후보(가설)입니다. '
        + '유한한 데이터만으로는 규칙이 하나로 정해지지 않습니다. '
        + '가능한 경우 분석에 쓰지 않은 항을 더 만들어 확인한 결과를 함께 적었습니다.';
      host.append(n);
    }
    for (const f of findings) {
      const c = document.createElement('div');
      c.className = 'card' + ((f.confidence ?? 1) < 0.85 ? ' low' : '');
      const badge = f.hypothesis ? '<span class="badge guess">가설</span>'
        : f.basic ? '<span class="badge fact">사실</span>' : '';
      const ver = f.verified
        ? `<span class="badge ${f.verified.passed === f.verified.checked ? 'ok' : 'bad'}">`
          + `검증 ${f.verified.passed}/${f.verified.checked}</span>` : '';
      c.innerHTML =
        `<div class="card-t"><span>${badge}${ver}${escapeHtml(f.title)}</span>` +
        `<span class="conf">확신도 ${Math.round((f.confidence ?? 1) * 100)}%</span></div>` +
        (f.detail ? `<div class="card-d">${escapeHtml(f.detail)}</div>` : '') +
        (f.formula ? `<div class="formula">${escapeHtml(f.formula)}</div>` : '') +
        (f.table ? diffTableHtml(f.table) : '') +
        (f.extra ? `<div class="card-d">${escapeHtml(f.extra)}</div>` : '') +
        (f.next && f.next.every((x) => typeof x === 'number' && isFinite(x))
          ? `<div class="next">다음 항 예측 → ${f.next.map((x) => pretty(x)).join(',  ')}</div>` : '') +
        (f.derivation || f.steps
          ? `<details class="how"><summary>어떻게 구했나</summary><div>`
            + escapeHtml(f.derivation || (f.steps || []).join(' ')) + '</div></details>' : '') +
        (f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : '');
      host.append(c);
    }
  }

  /** 분석 결과를 붙여 넣기 좋은 글로 만들어 복사한다 */
  async copyAnalysis(res, subject) {
    const lines = [`${res.title} — ${subject}`];
    if (res.note) lines.push(`(${res.note})`);
    if (res.lead) lines.push(res.lead);
    lines.push('');
    for (const f of res.findings || []) {
      lines.push(`· ${f.title}`);
      if (f.detail) lines.push(`  ${String(f.detail).replace(/\n/g, '\n  ')}`);
      if (f.formula) lines.push(`  ${f.formula}`);
      if (f.extra) lines.push(`  ${f.extra}`);
      if (f.next && f.next.every((v) => typeof v === 'number' && isFinite(v))) {
        lines.push(`  다음 항 예측: ${f.next.map((v) => pretty(v)).join(', ')}`);
      }
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.toast('분석 결과를 복사했습니다');
    } catch {
      this.toast('복사에 실패했습니다');
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
      const rect0 = c.getBoundingClientRect();
      const grab = this.grabPoint(e.clientX - rect0.left, e.clientY - rect0.top);
      if (grab) { this.dragPoint = grab; c.setPointerCapture(e.pointerId); return; }
      dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (active.has(e.pointerId)) active.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.dragPoint) {
        this.movePoint(this.dragPoint, this.view.toMathX(px), this.view.toMathY(py));
        moved = true;
        return;
      }
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
      c.style.cursor = this.grabPoint(px, py) ? 'grab' : 'crosshair';
      this.hover = this.probe(px, py);
      this.schedule();
    });
    const end = (e) => {
      if (this.dragPoint) {
        this.finishPointDrag();
        this.dragPoint = null;
      }
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
      if (act === 'angle') {
        const next = getAngleMode() === 'deg' ? 'rad' : 'deg';
        setAngleMode(next);
        e.target.textContent = next === 'deg' ? '°' : 'π';
        e.target.title = next === 'deg' ? '각도 단위: 도 (눌러서 라디안)' : '각도 단위: 라디안 (눌러서 도)';
        // 함수 구현이 바뀌었으므로 모든 식을 다시 만든다
        const snap = this.objects.map((o) => [o.source, o.visible, o.style]);
        this.objects = [];
        this.ctx = createContext();
        for (const [src2, vis, sty] of snap) {
          const ob = this.addObject(src2, sty);
          ob.visible = vis;
        }
        this.renderInputs();
        this.toast(next === 'deg' ? '각도 단위를 도(°)로 바꿨습니다' : '각도 단위를 라디안으로 바꿨습니다');
      }
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

  /** 끌 수 있는 점이 커서 아래 있는지 */
  grabPoint(px, py) {
    for (const o of this.objects) {
      if (!o.visible || !o.dragVars || !o.data || !o.data.points) continue;
      const p = o.data.points[0];
      if (!p) continue;
      const d = Math.hypot(this.view.toPxX(p[0]) - px, this.view.toPxY(p[1]) - py);
      if (d < 14) return { obj: o, vars: o.dragVars };
    }
    return null;
  }

  movePoint(grab, mx, my) {
    const set = (name, value) => {
      const def = this.ctx.defs.get(name);
      if (!def) return;
      def.body = { type: 'num', value };
      def.compiled = null;
      const owner = this.objects.find((o) => o.defName === name);
      if (owner) {
        owner.value = value;
        owner.label = `${name} = ${pretty(value)}`;
        if (owner.slider) {
          owner.slider.min = Math.min(owner.slider.min, value);
          owner.slider.max = Math.max(owner.slider.max, value);
          if (owner.slider.render) owner.slider.render(value);
        }
      }
    };
    if (grab.vars[0]) set(grab.vars[0], mx);
    if (grab.vars[1]) set(grab.vars[1], my);
    this.needsCompute = true;
    this.schedule();
  }

  /** 점을 놓으면 슬라이더 정의의 원문도 새 값으로 고쳐 둔다 */
  finishPointDrag() {
    for (const name of this.dragPoint.vars.filter(Boolean)) {
      const owner = this.objects.find((o) => o.defName === name);
      if (!owner) continue;
      const keep = owner.source.includes(';') ? owner.source.slice(owner.source.indexOf(';')) : '';
      // 끌어 놓은 좌표를 슬라이더 눈금에 맞춰 반올림한다 (2.625001 → 2.625)
      const step = owner.slider ? owner.slider.step : 0.001;
      const snapped = Math.round(owner.value / step) * step;
      owner.value = snapped;
      const def = this.ctx.defs.get(name);
      if (def) { def.body = { type: 'num', value: snapped }; def.compiled = null; }
      owner.source = `${name} = ${trimNum(snapped, 6)}${keep}`;
    }
    this.deferCompute = false;
    this.needsCompute = true;
    this.renderInputs();
    this.schedule();
    this.scheduleSave();
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

/** 스타일을 짧은 배열로 (링크 길이를 아끼려고) */
function packStyle(s) {
  if (!s) return null;
  return [s.color, s.width, s.dash, s.opacity, s.pointSize, s.pointStyle];
}
function unpackStyle(a) {
  if (!Array.isArray(a)) return null;
  return { color: a[0], width: a[1], dash: a[2], opacity: a[3], pointSize: a[4], pointStyle: a[5] };
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
  setting: '설정',
  tangent: '접선·법선', integral: '정적분', limit: '극한',
  union: '합집합', list: '리스트', regression: '회귀', pointseq: '점열',
  constant: '상수', defined: '정의', statement: '판정', empty: '빈 칸',
};

/** 계차표를 표로 */
function diffTableHtml(t) {
  const cell = (v) => (v === null || v === undefined ? '' : escapeHtml(pretty(v)));
  const head = `<tr><th></th>${t.header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const body = t.rows.map((r) =>
    `<tr><th>${escapeHtml(r.label)}</th>${r.cells.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="difftable">${head}${body}</table>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
