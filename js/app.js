/* =========================================================
   Random Cube — logic
   Plain JavaScript, no libraries. The 3D is CSS transforms;
   roll physics, lighting and shadows are computed here, only while rolling.
   When the die is at rest, the page doesn't spend a single frame.
   ========================================================= */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const TAU = Math.PI * 2;
  const MAX_N = 1000000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- storage (may be unavailable; then we simply don't save) ---------- */
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('random-cube:' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('random-cube:' + key, JSON.stringify(value)); } catch (_) { /* ignore */ }
    }
  };

  /* ---------- port of Python's random.randint(a, b) ----------
     Cryptographic RNG + rejection sampling, so there's no bias. */
  function randint(a, b) {
    const range = b - a + 1;
    if (!(window.crypto && crypto.getRandomValues)) {
      return a + Math.floor(Math.random() * range);
    }
    const limit = Math.floor(0x100000000 / range) * range;
    const buf = new Uint32Array(1);
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return a + (x % range);
  }

  /* ---------- vectors and quaternions ---------- */
  const V = {
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };

  // quaternion: [x, y, z, w]
  const Q = {
    id: () => [0, 0, 0, 1],
    axis(ax, ang) {
      const n = V.norm(ax), s = Math.sin(ang / 2);
      return [n[0] * s, n[1] * s, n[2] * s, Math.cos(ang / 2)];
    },
    mul(a, b) { // b first, then a
      const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
      return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz
      ];
    },
    normalize(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; },
    slerp(a, b, t) {
      let [bx, by, bz, bw] = b;
      let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
      if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
      let k0, k1;
      if (c > 0.9995) { k0 = 1 - t; k1 = t; }
      else {
        const o = Math.acos(c), so = Math.sin(o);
        k0 = Math.sin((1 - t) * o) / so;
        k1 = Math.sin(t * o) / so;
      }
      return Q.normalize([a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1]);
    },
    fromTo(u, v) { // rotation taking unit vector u to v
      const d = V.dot(u, v);
      if (d > 0.99999) return Q.id();
      if (d < -0.99999) {
        let ax = V.cross([1, 0, 0], u);
        if (Math.hypot(ax[0], ax[1], ax[2]) < 1e-6) ax = V.cross([0, 0, 1], u);
        return Q.axis(ax, Math.PI);
      }
      const c = V.cross(u, v);
      return Q.normalize([c[0], c[1], c[2], 1 + d]);
    },
    mat(q) { // 3x3, row-major
      const [x, y, z, w] = q;
      return [
        1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
        2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
        2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)
      ];
    }
  };
  const mulMV = (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
  ];
  const mulMtV = (m, v) => [ // transposed matrix times vector
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2]
  ];

  /* ---------- easing ---------- */
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
  function easeOutBounce(x) {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  }

  /* ---------- camera and light (table coordinates; y points down, as in CSS) ---------- */
  const CAM_TILT = -34; // degrees, matches .world in CSS
  const camA = CAM_TILT * Math.PI / 180;
  const CAM = [1, 0, 0, 0, Math.cos(camA), -Math.sin(camA), 0, Math.sin(camA), Math.cos(camA)];
  const UP = [0, -1, 0];
  const VIEW = V.norm(mulMtV(CAM, [0, 0, 1]));                    // direction toward the viewer
  const LIGHT = V.norm(mulMtV(CAM, V.norm([-0.5, -0.95, 0.55])));  // light from top-left-front
  const HALF = V.norm(V.add(LIGHT, VIEW));                         // for the highlight (Blinn-Phong)
  const SHADOW_DIR = V.norm([-LIGHT[0], 0, -LIGHT[2]]);            // where the shadow falls on the table

  /* ---------- faces ---------- */
  // n is the face normal, u is the "up" of the number on the face (die coordinates)
  const FACES = [
    { n: [0, 0, 1],  u: [0, -1, 0], css: 'translateZ(var(--h))' },
    { n: [0, 0, -1], u: [0, -1, 0], css: 'rotateY(180deg) translateZ(var(--h))' },
    { n: [1, 0, 0],  u: [0, -1, 0], css: 'rotateY(90deg) translateZ(var(--h))' },
    { n: [-1, 0, 0], u: [0, -1, 0], css: 'rotateY(-90deg) translateZ(var(--h))' },
    { n: [0, -1, 0], u: [0, 0, -1], css: 'rotateX(90deg) translateZ(var(--h))' },
    { n: [0, 1, 0],  u: [0, 0, 1],  css: 'rotateX(-90deg) translateZ(var(--h))' }
  ];
  // a real d6: opposite faces add up to 7
  const STD = [1, 6, 3, 4, 2, 5];

  const PIP_POS = { tl: [25, 25], tr: [75, 25], ml: [25, 50], c: [50, 50], mr: [75, 50], bl: [25, 75], br: [75, 75] };
  const LAYOUT = {
    1: ['c'], 2: ['tr', 'bl'], 3: ['tr', 'c', 'bl'], 4: ['tl', 'tr', 'bl', 'br'],
    5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br']
  };
  const FONT_K = [0, .58, .5, .4, .31, .25, .21, .18];

  /* ---------- DOM ---------- */
  const dieEl = $('#die');
  const shadowEl = $('#shadow');
  const worldEl = $('#world');
  const stageEl = $('#stage');
  const readoutEl = $('#readout');
  const labelEl = $('#readoutLabel');
  const resultEl = $('#result');
  const rangeNoteEl = $('#rangeNote');
  const nInput = $('#nInput');
  const stepperEl = nInput.parentElement;
  const presetsEl = $('#presets');
  const rollBtn = $('#rollBtn');
  const historyEl = $('#history');
  const historyEmptyEl = $('#historyEmpty');
  const statCount = $('#statCount');
  const statAvg = $('#statAvg');
  const statExp = $('#statExp');
  const soundBtn = $('#soundBtn');
  const fxEl = $('#fx');

  worldEl.style.transform = `rotateX(${CAM_TILT}deg)`;

  ['core-y', 'core-x', 'core-z'].forEach((cls) => {
    const c = document.createElement('div');
    c.className = 'core ' + cls;
    dieEl.appendChild(c);
  });

  const faces = FACES.map((f) => {
    const el = document.createElement('div');
    el.className = 'face';
    el.style.transform = f.css;
    const content = document.createElement('div');
    content.className = 'content';
    const shade = document.createElement('div');
    shade.className = 'shade';
    const gloss = document.createElement('div');
    gloss.className = 'gloss';
    el.append(content, shade, gloss);
    dieEl.appendChild(el);
    return { n: f.n, u: f.u, el, content, shade, gloss, value: 0, lastShade: -1, lastGloss: -1 };
  });

  function needsMark(v) { // underline 6 and 9 (and similar) so they aren't confused upside down
    const s = String(v);
    if (!/^[01689]+$/.test(s)) return false;
    const rot = { 0: '0', 1: '1', 6: '9', 8: '8', 9: '6' };
    const r = s.split('').reverse().map((d) => rot[d]).join('');
    return r !== s && r[0] !== '0';
  }

  function setFace(face, v, usePips) {
    face.value = v;
    if (usePips) {
      let html = '';
      for (const p of LAYOUT[v]) {
        const [x, y] = PIP_POS[p];
        html += `<span class="pip${v === 1 ? ' one' : ''}" style="left:${x}%;top:${y}%"></span>`;
      }
      face.content.innerHTML = html;
    } else {
      const len = String(v).length;
      face.content.innerHTML =
        `<span class="num${needsMark(v) ? ' mark' : ''}" style="--k:${FONT_K[Math.min(len, 7)]}">${v}</span>`;
    }
  }

  /* ---------- state ---------- */
  let n = sanitizeN(store.get('n', 6)) || 6;
  let S = 120; // die size in px (read from CSS)
  const st = { q: Q.id(), x: 0, z: 0, rolling: false };
  let history = Array.isArray(store.get('history', [])) ? store.get('history', []).slice(0, 60) : [];

  function sanitizeN(v) {
    const x = Number(v);
    if (!Number.isFinite(x) || !Number.isInteger(x) || x < 1) return 0;
    return Math.min(x, MAX_N);
  }

  function measure() {
    S = faces[0].el.offsetWidth || S;
  }

  /* ---------- assigning values to faces ---------- */
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function freshValue(avoid) {
    if (n <= 6) return randint(1, n);
    for (let i = 0; i < 20; i++) {
      const v = randint(1, n);
      if (!avoid.has(v)) return v;
    }
    return randint(1, n);
  }

  function assignAll(keepTop) {
    const pips = n <= 6;
    if (n === 6) {
      faces.forEach((f, i) => setFace(f, STD[i], true));
      return;
    }
    let vals;
    if (n < 6) {
      vals = [];
      for (let i = 1; i <= n; i++) vals.push(i);
      while (vals.length < 6) vals.push(randint(1, n));
      shuffle(vals);
    } else {
      const used = new Set();
      vals = [];
      while (vals.length < 6) {
        const v = freshValue(used);
        used.add(v);
        vals.push(v);
      }
    }
    faces.forEach((f, i) => setFace(f, vals[i], pips));
    if (keepTop != null && keepTop <= n) {
      const top = upFaceIndex(st.q);
      const other = faces.findIndex((f, i) => i !== top && f.value === keepTop);
      if (other >= 0) setFace(faces[other], faces[top].value, pips);
      setFace(faces[top], keepTop, pips);
    }
  }

  function upFaceIndex(q) {
    const m = Q.mat(q);
    let best = 0, bestDot = -2;
    faces.forEach((f, i) => {
      const d = V.dot(mulMV(m, f.n), UP);
      if (d > bestDot) { bestDot = d; best = i; }
    });
    return best;
  }

  /* For N ≠ 6 the rolled number goes onto a face that's currently hidden,
     so the swap is invisible and the die looks "honest". */
  function prepareFaces(value) {
    if (n === 6) return STD.indexOf(value);
    const pips = n <= 6;
    const m = Q.mat(st.q);
    const dots = faces.map((f) => V.dot(mulMV(m, f.n), VIEW));
    let hidden = faces.map((_, i) => i).filter((i) => dots[i] < -0.02);
    if (!hidden.length) hidden = [dots.indexOf(Math.min(...dots))];
    const k = pick(hidden);
    setFace(faces[k], value, pips);
    const used = new Set(faces.filter((_, i) => !hidden.includes(i)).map((f) => f.value));
    used.add(value);
    hidden.forEach((i) => {
      if (i === k) return;
      const v = freshValue(used);
      used.add(v);
      setFace(faces[i], v, pips);
    });
    return k;
  }

  /* Orientation where face k points up and its number reads upright for the viewer */
  function targetQuat(k, jitter) {
    const qa = Q.fromTo(faces[k].n, UP);
    const u = mulMV(Q.mat(qa), faces[k].u);
    const want = V.norm([-VIEW[0], 0, -VIEW[2]]);
    const ang = Math.atan2(V.dot(V.cross(u, want), UP), V.dot(u, want)) + jitter;
    return Q.mul(Q.axis(UP, ang), qa);
  }

  const niceJitter = () => (Math.random() < 0.5 ? -1 : 1) * rand(0.32, 0.62);

  /* ---------- rendering a frame ---------- */
  const RADIUS = 0.1; // corner rounding as a fraction of size (for table contact)
  const f6 = (v) => (Math.abs(v) < 1e-7 ? 0 : v.toFixed(5));

  function render(q, x, h, z) {
    const m = Q.mat(q);
    const half = S / 2, r = S * RADIUS;
    // lowest point of the rounded die, so it rocks on its edges instead of sinking into the table
    const lowest = (half - r) * (Math.abs(m[3]) + Math.abs(m[4]) + Math.abs(m[5])) + r;
    const px = x * S, pz = z * S;
    const py = half - lowest - h;

    dieEl.style.transform =
      `matrix3d(${f6(m[0])},${f6(m[3])},${f6(m[6])},0,${f6(m[1])},${f6(m[4])},${f6(m[7])},0,` +
      `${f6(m[2])},${f6(m[5])},${f6(m[8])},0,${f6(px)},${f6(py)},${f6(pz)},1)`;

    // dynamic lighting on every visible face
    for (const f of faces) {
      const nw = mulMV(m, f.n);
      if (V.dot(nw, VIEW) <= 0) continue;
      const diff = Math.max(0, V.dot(nw, LIGHT));
      const shade = 0.5 * Math.pow(1 - diff, 1.35);
      const spec = Math.pow(Math.max(0, V.dot(nw, HALF)), 28) * 0.75;
      const sh = Math.round(shade * 100) / 100, gl = Math.round(spec * 100) / 100;
      if (sh !== f.lastShade) { f.shade.style.opacity = sh; f.lastShade = sh; }
      if (gl !== f.lastGloss) { f.gloss.style.opacity = gl; f.lastGloss = gl; }
    }

    // table shadow: offset away from the light, spreads and fades with height
    const lift = h / S; // height of the die's lowest point above the table
    const off = S * (0.1 + lift * 0.45);
    const sx = px + SHADOW_DIR[0] * off, sz = pz + SHADOW_DIR[2] * off;
    const sc = 1 + lift * 0.55;
    shadowEl.style.transform = `translate3d(${f6(sx)}px,${f6(half - 1)}px,${f6(sz)}px) rotateX(90deg) scale(${f6(sc)})`;
    shadowEl.style.opacity = f6(1 / (1 + lift * 1.6));
  }

  /* ---------- sound (synthesized with Web Audio, no files) ---------- */
  const Sound = {
    on: store.get('sound', true) !== false,
    ctx: null,
    noise: null,
    ensure() {
      if (!this.on) return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        const len = Math.floor(this.ctx.sampleRate * 0.3);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    clack(vol) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700 + Math.random() * 1500;
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55 * vol, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t, Math.random() * 0.15, 0.09);

      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(300 + Math.random() * 60, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.07);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.32 * vol, t + 0.003);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g2).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.1);
    },
    chime() {
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime;
      [880, 1318.5, 1760].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        const s = t + i * 0.07;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.09, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.9);
        o.connect(g).connect(ctx.destination);
        o.start(s);
        o.stop(s + 1);
      });
    }
  };

  /* ---------- roll ---------- */
  const IMPACTS = [1 / 2.75, 2 / 2.75, 2.5 / 2.75, 2.625 / 2.75];
  const IMPACT_VOL = [1, 0.45, 0.22, 0.1];

  function roll() {
    if (st.rolling) return;
    commitInput();
    Sound.ensure();

    const N = n;
    const value = randint(1, N);
    const k = prepareFaces(value);

    const reduce = reduceMotion.matches;
    const q0 = st.q;
    const q1 = targetQuat(k, niceJitter());
    const x0 = st.x, z0 = st.z;

    // landing spot: near the center, but not the same spot
    let x1 = 0, z1 = 0, dist = 0;
    for (let i = 0; i < 8; i++) {
      x1 = rand(-0.5, 0.5);
      z1 = rand(-0.35, 0.35);
      dist = Math.hypot(x1 - x0, z1 - z0);
      if (dist > 0.45) break;
    }
    const dir = dist > 1e-3 ? [(x1 - x0) / dist, 0, (z1 - z0) / dist] : [1, 0, 0];
    // tumble axis: perpendicular to travel (rolls forward) + a bit of chaos
    const axis = V.norm(V.add(V.cross(dir, [0, 1, 0]), [rand(-.35, .35), rand(-.35, .35), rand(-.35, .35)]));
    const spins = reduce ? 0 : (Math.random() < 0.5 ? 2 : 3);
    const dur = reduce ? 450 : rand(1450, 1750);
    const H = reduce ? 0.3 : rand(1.3, 1.7);
    const RISE = 0.16, FALL = 0.66;

    st.rolling = true;
    setBusy(true);

    const t0 = performance.now();
    let impact = 0, lastFlick = 0;

    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);

      const ph = easeOutCubic(Math.min(1, t / 0.8));
      const x = x0 + (x1 - x0) * ph;
      const z = z0 + (z1 - z0) * ph;

      let h = 0;
      if (t < RISE) {
        h = H * easeOutQuad(t / RISE);
      } else {
        const f = Math.min(1, (t - RISE) / FALL);
        h = H * (1 - easeOutBounce(f));
        while (impact < IMPACTS.length && f >= IMPACTS[impact]) {
          if (Sound.on) Sound.clack(IMPACT_VOL[impact]);
          if (impact === 0 && navigator.vibrate) { try { navigator.vibrate(12); } catch (_) { /* ignore */ } }
          impact++;
        }
      }
      h *= S;

      const e = easeOutQuart(Math.min(1, t / 0.94));
      const q = Q.mul(Q.axis(axis, -spins * TAU * (1 - e)), Q.slerp(q0, q1, e));
      render(q, x, h, z);

      if (now - lastFlick > 75 && t < 0.85) {
        resultEl.textContent = randint(1, N);
        lastFlick = now;
      }

      if (t < 1) requestAnimationFrame(frame);
      else finish();
    }

    function finish() {
      st.q = q1;
      st.x = x1;
      st.z = z1;
      render(q1, x1, 0, z1);
      st.rolling = false;
      setBusy(false);
      showResult(value, N);
      pushHistory(value, N);
      commitInput(); // in case N was changed mid-roll
    }

    requestAnimationFrame(frame);
  }

  function setBusy(on) {
    rollBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    readoutEl.classList.toggle('rolling', on);
    if (on) {
      readoutEl.classList.remove('crit', 'low');
      labelEl.textContent = 'Rolling…';
    }
  }

  function showResult(value, N) {
    resultEl.textContent = value;
    rangeNoteEl.textContent = `from 1 to ${N.toLocaleString('en-US')}`;
    const isMax = N > 1 && value === N;
    const isMin = N > 2 && value === 1;
    readoutEl.classList.toggle('crit', isMax);
    readoutEl.classList.toggle('low', isMin);
    labelEl.textContent = isMax ? 'Max roll!' : isMin ? 'Lowest roll' : 'You rolled';

    if (!reduceMotion.matches && resultEl.animate) {
      resultEl.animate(
        [
          { transform: 'translateY(10px) scale(.7)', opacity: 0 },
          { transform: 'translateY(0) scale(1.07)', opacity: 1, offset: 0.6 },
          { transform: 'translateY(0) scale(1)', opacity: 1 }
        ],
        { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    }
    if (isMax && N >= 4) {
      burst();
      if (Sound.on) Sound.chime();
    }
  }

  function burst() {
    if (reduceMotion.matches || !document.body.animate) return;
    const r = resultEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      const size = rand(5, 11);
      s.style.width = s.style.height = size + 'px';
      s.style.left = cx - size / 2 + 'px';
      s.style.top = cy - size / 2 + 'px';
      frag.appendChild(s);
      const a = rand(0, TAU), d = rand(70, 190);
      const anim = s.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d * 0.7 + 30}px) scale(0)`, opacity: 0 }
        ],
        { duration: rand(700, 1150), easing: 'cubic-bezier(.12,.7,.3,1)' }
      );
      anim.onfinish = () => s.remove();
    }
    fxEl.appendChild(frag);
  }

  /* ---------- history and stats ---------- */
  function pushHistory(value, N) {
    history.unshift({ v: value, n: N });
    if (history.length > 60) history.length = 60;
    store.set('history', history);
    renderHistory(true);
  }

  function renderHistory(animateFirst) {
    const items = history.slice(0, 24);
    historyEl.innerHTML = items
      .map((h, i) => {
        const cls = [];
        if (i === 0 && animateFirst) cls.push('new');
        if (h.n > 1 && h.v === h.n) cls.push('max');
        else if (h.n > 2 && h.v === 1) cls.push('min');
        return `<li class="${cls.join(' ')}" title="from 1 to ${h.n}">${h.v}</li>`;
      })
      .join('');
    historyEmptyEl.hidden = history.length > 0;

    statCount.textContent = history.length ? history.length.toLocaleString('en-US') : '0';
    if (history.length) {
      const avg = history.reduce((s, h) => s + h.v, 0) / history.length;
      const exp = history.reduce((s, h) => s + (h.n + 1) / 2, 0) / history.length;
      statAvg.textContent = fmt(avg);
      statExp.textContent = fmt(exp);
    } else {
      statAvg.textContent = '—';
      statExp.textContent = fmt((n + 1) / 2);
    }
  }

  const fmt = (x) => x.toLocaleString('en-US', { maximumFractionDigits: x >= 1000 ? 0 : 2 });

  /* ---------- choosing N ---------- */
  function setN(v, fromInput) {
    v = sanitizeN(v);
    if (!v) return;
    stepperEl.classList.remove('invalid');
    if (!fromInput) nInput.value = v;
    presetsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', Number(b.dataset.n) === v));
    if (v === n) return;
    n = v;
    store.set('n', n);
    rangeNoteEl.textContent = `from 1 to ${n.toLocaleString('en-US')}`;
    if (!history.length) statExp.textContent = fmt((n + 1) / 2);
    if (st.rolling) return; // applied after landing

    const top = faces[upFaceIndex(st.q)].value;
    assignAll(top <= n ? top : null);
    readoutEl.classList.remove('crit', 'low');
    labelEl.textContent = 'Ready to roll';
    resultEl.textContent = '?';
    faces.forEach((f) => {
      if (f.content.animate && !reduceMotion.matches) {
        f.content.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 260, easing: 'ease-out' });
      }
    });
  }

  function commitInput() {
    const v = sanitizeN(nInput.value);
    if (v) {
      if (v !== n || faceModeMismatch()) { n = 0; setN(v); }
      else setN(v);
    } else {
      nInput.value = n;
      stepperEl.classList.remove('invalid');
    }
  }

  // faces show pips but need numbers (or vice versa), e.g. N was changed mid-roll
  function faceModeMismatch() {
    const hasPips = !!faces[0].content.querySelector('.pip');
    if (hasPips !== (n <= 6)) return true;
    if (n === 6) return faces.some((f, i) => f.value !== STD[i]);
    return faces.some((f) => f.value > n);
  }

  nInput.addEventListener('input', () => {
    const v = sanitizeN(nInput.value);
    stepperEl.classList.toggle('invalid', !v && nInput.value !== '');
    if (v) setN(v, true);
  });
  nInput.addEventListener('change', commitInput);
  nInput.addEventListener('blur', commitInput);

  stepperEl.querySelectorAll('.step').forEach((b) => {
    b.addEventListener('click', () => setN(clamp(n + Number(b.dataset.step), 1, MAX_N)));
  });
  presetsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (b) setN(Number(b.dataset.n));
  });

  /* ---------- material and sound ---------- */
  function setSkin(skin) {
    if (!['ivory', 'onyx', 'ruby'].includes(skin)) skin = 'ivory';
    dieEl.dataset.skin = skin;
    document.querySelectorAll('.skin').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.skin === skin)));
    store.set('skin', skin);
  }
  document.querySelectorAll('.skin').forEach((b) => b.addEventListener('click', () => setSkin(b.dataset.skin)));

  function setSound(on) {
    Sound.on = on;
    soundBtn.setAttribute('aria-pressed', String(on));
    store.set('sound', on);
  }
  soundBtn.addEventListener('click', () => {
    setSound(!Sound.on);
    if (Sound.on) Sound.clack(0.6);
  });

  /* ---------- controls ---------- */
  rollBtn.addEventListener('click', roll);
  stageEl.addEventListener('click', roll);

  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if ((e.code === 'Space' || e.key === ' ') && !typing && tag !== 'BUTTON') {
      e.preventDefault();
      roll();
    } else if (e.key === 'Enter' && e.target === nInput) {
      e.preventDefault();
      roll();
    } else if (!typing && (e.code === 'KeyM')) {
      soundBtn.click();
    }
  });

  $('#clearBtn').addEventListener('click', () => {
    history = [];
    store.set('history', history);
    renderHistory(false);
  });

  $('#copyBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = $('#pyCode').textContent;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
      ta.remove();
    }
    btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
  });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      measure();
      if (!st.rolling) render(st.q, st.x, 0, st.z);
    });
  });

  /* ---------- start ---------- */
  setSkin(store.get('skin', 'ivory'));
  setSound(Sound.on);
  nInput.value = n;
  presetsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', Number(b.dataset.n) === n));
  rangeNoteEl.textContent = `from 1 to ${n.toLocaleString('en-US')}`;
  measure();
  assignAll(null);
  st.q = targetQuat(n === 6 ? 0 : 4, -0.48); // on a d6, the "1" faces up
  render(st.q, 0, 0, 0);
  renderHistory(false);
})();
