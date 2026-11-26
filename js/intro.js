/*
 * Intro animata del logo.
 *
 * Un nido di fettuccine cade sul fondo marrone, si srotola e ogni fettuccina
 * si posa dove nel logo ci sono le strisce gialle. Poi salgono le scritte,
 * le fettuccine diventano la grafica del logo e il timbro vola al suo posto
 * nella home.
 *
 * WebGL puro, senza librerie. Ogni fettuccina scorre lungo un "binario"
 * (nido -> volo -> posa) misurato a lunghezza d'arco costante, quindi non si
 * allunga mai e il movimento resta fluido.
 *
 * API: RCIntro.play() · RCIntro.skip()
 */
(function () {
  'use strict';

  var html = document.documentElement;
  var root = document.getElementById('intro');
  var M = window.LOGO_RICAMO;
  if (!root) return;
  if (!M) { root.hidden = true; html.classList.remove('intro-playing', 'intro-lock'); return; }

  var canvas = root.querySelector('.intro-canvas');
  var stage = root.querySelector('.intro-stage');
  var art = root.querySelector('.intro-art');
  var pastaEl = root.querySelector('.intro-pasta');
  var stamp = root.querySelector('.intro-stamp');
  var bg = root.querySelector('.intro-bg');
  var skipBtn = root.querySelector('.intro-skip');

  /* Geometria del logo originale (2000 px) e della maschera del ricamo (1024 × 878) */
  var LOGO = 2000;
  var CROP = { x: 200, y: 334, w: 1556, h: 1334 };
  var MASK_W = 1024;
  var LINES = [[0, 242], [262, 463], [766, 878]];          // Ricette · Ciociare · E NON SOLO
  // posizione finale delle fettuccine nella maschera: x0, y0, x1, y1, larghezza
  var STRANDS = [
    [55, 558, 930, 509, 42],
    [120, 584, 965, 548, 36],
    [190, 600, 1012, 571, 44],
    [95, 621, 985, 609, 40],
    [18, 646, 1002, 643, 42],
    [60, 676, 992, 675, 40],
    [10, 694, 942, 692, 36],
    [35, 704, 1006, 704, 36]
  ];

  /* Tempi (secondi) */
  var TL = {
    fall: 0.55, land: 0.8,                       // il nido cade e si assesta
    start: 0.85, stagger: 0.1, dur: 1.45,        // le fettuccine si srotolano
    lines: [2.2, 2.36, 2.7],                     // scritte
    flat: 3.05, flatDur: 0.4,                    // la pasta diventa grafica
    stamp: 3.5, fly: 3.85, flyDur: 0.9
  };
  var FLAT_TL = {                                // senza WebGL: solo grafica
    lines: [0.25, 0.4, 0.75], pasta: 0.55, stamp: 1.35, fly: 1.7, flyDur: 0.9
  };

  /* ---------------- piccola libreria vettoriale ---------------- */
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  function easeInOut(x) { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function bez(a, b, c, d, t) {
    var u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    return [0, 1, 2].map(function (i) { return a[i] * w0 + b[i] * w1 + c[i] * w2 + d[i] * w3; });
  }
  function rotateAround(v, axis, ang) {           // v ⟂ axis
    var c = Math.cos(ang), s = Math.sin(ang), k = cross(axis, v);
    return norm([v[0] * c + k[0] * s, v[1] * c + k[1] * s, v[2] * c + k[2] * s]);
  }
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- DOM: scritte e strato giallo ---------------- */
  var lineEls = LINES.map(function () {
    var box = document.createElement('div');
    box.className = 'intro-line';
    var slider = document.createElement('div');
    slider.className = 'intro-slider';
    var img = document.createElement('img');
    img.alt = '';
    img.src = M.testo;
    slider.appendChild(img);
    box.appendChild(slider);
    art.appendChild(box);
    return box;
  });
  pastaEl.style.webkitMaskImage = pastaEl.style.maskImage = 'url("' + M.pasta + '")';

  var L = null;
  function layout() {
    var vw = root.clientWidth || window.innerWidth, vh = root.clientHeight || window.innerHeight;
    var S = Math.round(Math.min(vw * 0.84, vh * 0.6, 520));
    var left = Math.round((vw - S) / 2), top = Math.round((vh - S) / 2 - vh * 0.02);
    var k = S / LOGO;
    L = {
      vw: vw, vh: vh, S: S, left: left, top: top, u: S / 480,
      artX: left + CROP.x * k, artY: top + CROP.y * k, artW: CROP.w * k, artH: CROP.h * k
    };
    L.m = L.artW / MASK_W;
    stage.style.cssText = 'left:' + left + 'px;top:' + top + 'px;width:' + S + 'px;height:' + S + 'px';
    art.style.cssText = 'left:' + CROP.x * k + 'px;top:' + CROP.y * k + 'px;width:' + L.artW + 'px;height:' + L.artH + 'px';
    lineEls.forEach(function (el, i) {
      var y0 = LINES[i][0] * L.m, y1 = LINES[i][1] * L.m, img = el.firstChild.firstChild;
      el.style.top = y0 + 'px';
      el.style.height = (y1 - y0) + 'px';
      img.style.cssText = 'top:' + -y0 + 'px;width:' + L.artW + 'px;height:' + L.artH + 'px';
    });
    return L;
  }

  /* ---------------- WebGL ---------------- */
  var VS_PASTA = [
    'attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aTan; attribute vec3 aUv; attribute float aAo;',
    'uniform mat4 uProj; uniform mat4 uView;',
    'varying vec3 vNor; varying vec3 vTan; varying vec3 vPos; varying vec3 vUv; varying float vAo;',
    'void main() { vNor = aNor; vTan = aTan; vPos = aPos; vUv = aUv; vAo = aAo; gl_Position = uProj * uView * vec4(aPos, 1.0); }'
  ].join('\n');

  var FS_PASTA = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec3 vNor; varying vec3 vTan; varying vec3 vPos; varying vec3 vUv; varying float vAo;',
    'uniform vec3 uEye; uniform float uUnit; uniform float uFlat; uniform vec3 uFlatColor;',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
    '}',
    'float bump(vec2 q) { return noise(q * 2.0) * 0.6 + noise(q * 6.5) * 0.4; }',
    'void main() {',
    '  vec3 n0 = normalize(vNor);',
    '  vec3 t = normalize(vTan);',
    '  vec3 b = normalize(cross(n0, t));',
    '  vec3 V = normalize(uEye - vPos);',
    '  vec3 n = dot(n0, V) < 0.0 ? -n0 : n0;',      // la faccia che vediamo
    '  float s = vUv.x / uUnit; float v = vUv.y; float seed = vUv.z;',
    // superficie porosa della pasta trafilata al bronzo
    '  vec2 q = vec2(s * 0.3, v * 3.2) + seed * 17.0; float e = 0.05;',
    '  float h0 = bump(q); float hx = bump(q + vec2(e, 0.0)); float hy = bump(q + vec2(0.0, e));',
    '  n = normalize(n - (t * (hx - h0) + b * (hy - h0)) / e * 0.035);',
    // bordi leggermente arrotondati
    '  float ev = v * 2.0 - 1.0;',
    '  n = normalize(n + b * ev * smoothstep(0.5, 1.0, abs(ev)) * 0.5);',
    // colore: pasta all uovo dorata, con chiazze lente, pori e un velo di farina
    '  vec3 base = mix(vec3(0.93, 0.71, 0.23), vec3(0.99, 0.84, 0.38), noise(vec2(s * 0.012, seed * 9.0)));',
    '  base = mix(base, vec3(0.86, 0.56, 0.13), smoothstep(0.6, 0.95, noise(vec2(s * 0.04, v * 1.5 + seed * 5.0))) * 0.3);',
    '  float pores = noise(vec2(s * 1.1, v * 11.0) + seed * 13.0);',
    '  base *= 0.93 + 0.09 * pores;',
    '  float dust = smoothstep(0.9, 1.0, noise(vec2(s * 2.2, v * 22.0) + seed * 41.0));',
    '  base = mix(base, vec3(1.0, 0.94, 0.80), dust * 0.28);',
    '  base = pow(base, vec3(2.2));',
    '  vec3 L1 = normalize(vec3(-0.40, 0.55, 0.75));',
    '  vec3 L2 = normalize(vec3(0.65, -0.25, 0.5));',
    '  float ndl = dot(n, L1);',
    '  float diff = max(0.0, (ndl + 0.25) / 1.25);',
    '  vec3 light = vec3(1.0, 0.95, 0.86) * diff * 0.98 + vec3(0.45, 0.32, 0.2) * max(0.0, dot(n, L2)) * 0.45 + vec3(0.2, 0.13, 0.07);',
    '  vec3 col = base * light * vAo;',
    // la pasta sottile lascia passare un po di luce calda
    '  col += base * vec3(1.0, 0.55, 0.1) * (pow(1.0 - abs(ndl), 3.0) * 0.1 + max(0.0, -ndl) * 0.45) * vAo;',
    '  vec3 H = normalize(L1 + V);',
    '  col += vec3(1.0, 0.92, 0.74) * pow(max(dot(n, H), 0.0), 42.0) * 0.13 * (0.6 + 0.4 * pores);',
    '  float edge = smoothstep(0.0, 0.08, v) * smoothstep(1.0, 0.92, v);',
    '  col *= mix(0.86, 1.0, edge);',
    '  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));',
    '  gl_FragColor = vec4(mix(col, uFlatColor, uFlat), 1.0);',
    '}'
  ].join('\n');

  var VS_SHADOW = [
    'attribute vec4 aS; attribute float aCore;',
    'uniform mat4 uProj; uniform mat4 uView;',
    'varying float vAcross; varying float vAlpha; varying float vCore;',
    'void main() { vAcross = aS.z; vAlpha = aS.w; vCore = aCore; gl_Position = uProj * uView * vec4(aS.xy, 0.0, 1.0); }'
  ].join('\n');
  var FS_SHADOW = [
    'precision mediump float;',
    'varying float vAcross; varying float vAlpha; varying float vCore;',
    'void main() {',
    '  float a = vAlpha * (1.0 - smoothstep(vCore, 1.0, abs(vAcross)));',
    '  gl_FragColor = vec4(vec3(0.07, 0.025, 0.0) * a, a);',
    '}'
  ].join('\n');

  var VS_FLOUR = [
    'attribute vec4 aP; attribute float aA;',
    'uniform mat4 uProj; uniform mat4 uView; uniform float uScale;',
    'varying float vA;',
    'void main() { vec4 p = uView * vec4(aP.xyz, 1.0); gl_Position = uProj * p; gl_PointSize = aP.w * uScale / -p.z; vA = aA; }'
  ].join('\n');
  var FS_FLOUR = [
    'precision mediump float;',
    'varying float vA;',
    'void main() {',
    '  vec2 c = gl_PointCoord * 2.0 - 1.0;',
    '  float a = vA * smoothstep(1.0, 0.15, dot(c, c));',
    '  gl_FragColor = vec4(vec3(1.0, 0.96, 0.88) * a, a);',
    '}'
  ].join('\n');

  var gl = null, glReady = false, P = {}, buf = {};
  var NS = 120;                                    // segmenti per fettuccina
  var VERT = 13;                                   // float per vertice
  var FLOUR_N = 150;

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs, attrs, unis) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var o = { p: p, a: {}, u: {} };
    attrs.forEach(function (n) { o.a[n] = gl.getAttribLocation(p, n); });
    unis.forEach(function (n) { o.u[n] = gl.getUniformLocation(p, n); });
    return o;
  }
  function initGL() {
    if (glReady) return true;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true }) ||
        canvas.getContext('experimental-webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
      if (!gl) return false;
      P.pasta = program(VS_PASTA, FS_PASTA, ['aPos', 'aNor', 'aTan', 'aUv', 'aAo'], ['uProj', 'uView', 'uEye', 'uUnit', 'uFlat', 'uFlatColor']);
      P.shadow = program(VS_SHADOW, FS_SHADOW, ['aS', 'aCore'], ['uProj', 'uView']);
      P.flour = program(VS_FLOUR, FS_FLOUR, ['aP', 'aA'], ['uProj', 'uView', 'uScale']);
      var n = STRANDS.length;
      buf.pasta = gl.createBuffer();
      buf.shadow = gl.createBuffer();
      buf.flour = gl.createBuffer();
      buf.index = gl.createBuffer();
      buf.pastaData = new Float32Array(n * (NS + 1) * 2 * VERT);
      buf.shadowData = new Float32Array(n * (NS + 1) * 2 * 5);
      buf.flourData = new Float32Array(FLOUR_N * 5);
      var idx = new Uint16Array(n * NS * 6), o = 0;
      for (var s = 0; s < n; s++) {
        for (var k = 0; k < NS; k++) {
          var a = s * (NS + 1) * 2 + k * 2;
          idx[o++] = a; idx[o++] = a + 1; idx[o++] = a + 2;
          idx[o++] = a + 1; idx[o++] = a + 3; idx[o++] = a + 2;
        }
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      buf.count = idx.length;
      glReady = true;
    } catch (err) {
      console.warn('Intro: WebGL non disponibile', err);
      gl = null;
      glReady = false;
    }
    return glReady;
  }

  /* ---------------- le fettuccine ---------------- */
  var strands = [], flour = [], cam = {};
  var DS = 0.75;                                   // passo del binario (px)

  function resample(pts, Bs, marks) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
    var total = cum[cum.length - 1], n = Math.floor(total / DS) + 1;
    var Pa = new Float32Array(n * 3), Ba = new Float32Array(n * 3), j = 0;
    for (var k = 0; k < n; k++) {
      var a = k * DS;
      while (j < cum.length - 2 && cum[j + 1] < a) j++;
      var f = (a - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      for (var c = 0; c < 3; c++) {
        Pa[k * 3 + c] = pts[j][c] + (pts[j + 1][c] - pts[j][c]) * f;
        Ba[k * 3 + c] = Bs[j][c] + (Bs[j + 1][c] - Bs[j][c]) * f;
      }
    }
    return { P: Pa, B: Ba, n: n, marks: marks.map(function (m) { return cum[m]; }) };
  }

  function buildStrands() {
    var rand = rng(11), u = L.u;
    function toW(mx, my, z) { return [L.artX + mx * L.m - L.vw / 2, L.vh / 2 - (L.artY + my * L.m), z || 0]; }
    var nest = toW(512, 420, 0);
    cam.nest = nest;
    strands = STRANDS.map(function (d, i) {
      var a = toW(d[0], d[1]), b = toW(d[2], d[3]);
      var leftFirst = i % 3 !== 1;
      var A = leftFirst ? a : b, E = leftFirst ? b : a;
      var L0 = len(sub(E, A)), dir = norm(sub(E, A)), perp = [-dir[1], dir[0], 0];
      var width = d[4] * L.m, zBase = (1.2 + i * 1.5) * u, ph = rand() * 6.283;
      var pts = [], Bs = [];

      // 1) avvolta nel nido
      var R = (46 + rand() * 10) * u, amp = (11 + rand() * 9) * u, fr = 1.3 + rand() * 0.7;
      var th0 = i * 2.39996 + rand() * 0.6, beta0 = 0.35 + rand() * 0.45;
      var coil = L0 * 1.12, nC = 240;
      for (var k = 0; k <= nC; k++) {
        var th = th0 + (k / nC) * coil / R;
        var r = R + amp * Math.sin(fr * th + ph);
        var z = (5 + 0.42 * (r / u - 30) + 7 * Math.sin(2.2 * th + ph * 1.7)) * u;
        var cs = Math.cos(th), sn = Math.sin(th);
        pts.push([nest[0] + r * cs, nest[1] + r * sn, Math.max(1.5 * u, z)]);
        var be = beta0 + 0.4 * Math.sin(2.7 * th + ph * 0.6);
        Bs.push(norm([cs * Math.cos(be), sn * Math.cos(be), Math.sin(be)]));
      }
      var coilEnd = pts.length - 1;

      // 2) volo: due curve di Bézier raccordate in cima all'arco
      var P0 = pts[coilEnd], T0 = norm(sub(pts[coilEnd], pts[coilEnd - 1]));
      var Af = add(A, [0, 0, zBase]);
      var lift = (130 + rand() * 110) * u;
      var Tm = norm([Af[0] - P0[0], Af[1] - P0[1], 0]);
      var span = len(sub(Af, P0)), swing = (i % 2 ? 1 : -1) * (40 + rand() * 70) * u;
      var mid = add(add(mul(add(P0, Af), 0.5), mul([-Tm[1], Tm[0], 0], swing)), [0, 0, lift]);
      var segs = [
        [P0, add(P0, mul(T0, (70 + span * 0.25) * 1)), sub(mid, mul(Tm, span * 0.28)), mid],
        [mid, add(mid, mul(Tm, span * 0.28)), sub(Af, mul(dir, (110 + rand() * 60) * u)), Af]
      ];
      var flyStart = pts.length, flyT = [], prev = P0, Bprev = Bs[coilEnd];
      segs.forEach(function (sg) {
        for (var k = 1; k <= 90; k++) {
          var p = bez(sg[0], sg[1], sg[2], sg[3], k / 90), T = norm(sub(p, prev));
          var B = norm(sub(Bprev, mul(T, dot(Bprev, T))));      // trasporto parallelo
          pts.push(p); Bs.push(B); flyT.push(T);
          prev = p; Bprev = B;
        }
      });
      // torsione: arriva piatta sul fondo (a volte con un giro completo in volo)
      var Bline = dot(Bprev, perp) >= 0 ? perp : mul(perp, -1);
      var Tend = flyT[flyT.length - 1];
      var ang = Math.atan2(dot(cross(Bprev, Bline), Tend), dot(Bprev, Bline));
      if (i % 3 === 0) ang += (ang >= 0 ? 1 : -1) * Math.PI * 2;
      for (var f = 0; f < flyT.length; f++) {
        var w = smooth01((f + 1) / flyT.length);
        Bs[flyStart + f] = rotateAround(Bs[flyStart + f], flyT[f], ang * w);
      }

      // 3) posata sul fondo, con ondine appena accennate
      var nL = 160;
      for (k = 1; k <= nL; k++) {
        var s = L0 * k / nL;
        var wz = 1.5 * u * Math.sin(s / u * 0.07 + ph) * Math.sin(Math.PI * k / nL) + 0.6 * u * Math.sin(s / u * 0.19);
        pts.push(add(add(A, mul(dir, s)), add(mul(perp, 1.8 * u * Math.sin(s / u * 0.018)), [0, 0, zBase + wz])));
        Bs.push(Bline);
      }
      var rail = resample(pts, Bs, [coilEnd, pts.length - 1]);
      return {
        rail: rail, len: L0, width: width, seed: i * 0.137 + 0.11,
        p0: rail.marks[0], p1: (rail.n - 1) * DS,
        start: TL.start + i * TL.stagger
      };
    });

    // nuvoletta di farina quando il nido tocca il fondo
    flour = [];
    for (var j = 0; j < FLOUR_N; j++) {
      var a = rand() * Math.PI * 2, rr = (22 + rand() * 40) * u, sp = (50 + rand() * 190) * u;
      flour.push({
        x: nest[0] + Math.cos(a) * rr, y: nest[1] + Math.sin(a) * rr, z: (4 + rand() * 10) * u,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (40 + rand() * 120) * u,
        size: (2 + rand() * 4.5) * u, life: 0.55 + rand() * 0.6, a0: 0.25 + rand() * 0.45
      });
    }
  }

  function sampleRail(rail, a, outP, outB) {
    var x = a / DS, i = Math.floor(x);
    if (i < 0) { i = 0; x = 0; }
    if (i >= rail.n - 1) { i = rail.n - 2; x = rail.n - 1; }
    var f = x - i, P = rail.P, B = rail.B, o = i * 3;
    for (var c = 0; c < 3; c++) {
      outP[c] = P[o + c] + (P[o + 3 + c] - P[o + c]) * f;
      outB[c] = B[o + c] + (B[o + 3 + c] - B[o + c]) * f;
    }
  }

  function setupCamera() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(L.vw * dpr);
    canvas.height = Math.round(L.vh * dpr);
    var fov = 30 * Math.PI / 180, D = (L.vh / 2) / Math.tan(fov / 2);
    var near = Math.max(10, D * 0.25), far = D + 400, f = 1 / Math.tan(fov / 2), asp = L.vw / L.vh;
    cam.D = D;
    cam.dpr = dpr;
    cam.proj = new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
    cam.view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -D, 1]);
  }

  // il nido cade dall'alto (verso il fondo) e si assesta con un piccolo rimbalzo
  function dropAt(t) {
    if (t >= TL.land) return null;
    var z;
    if (t < TL.fall) { var f = t / TL.fall; z = cam.D * 0.55 * (1 - f * f); }
    else { var g = (t - TL.fall) / (TL.land - TL.fall); z = 14 * L.u * Math.sin(Math.PI * g) * (1 - g); }
    var ang = -0.9 * Math.pow(1 - Math.min(1, t / TL.land), 2);
    return { z: z, c: Math.cos(ang), s: Math.sin(ang) };
  }

  var tmpP = [], tmpB = [];
  for (var q = 0; q <= NS; q++) { tmpP.push([0, 0, 0]); tmpB.push([0, 0, 0]); }

  function render(t) {
    if (!glReady) return;
    var u = L.u, flat = smooth01((t - TL.flat) / TL.flatDur), drop = dropAt(t), nest = cam.nest;
    var V = buf.pastaData, S = buf.shadowData, vo = 0, so = 0;
    var LX = 0.3, LY = -0.42;                     // direzione dell'ombra (luce da in alto a sinistra)

    strands.forEach(function (st) {
      var p = st.p0 + (st.p1 - st.p0) * easeInOut((t - st.start) / TL.dur);
      for (var k = 0; k <= NS; k++) {
        sampleRail(st.rail, p - st.len + st.len * k / NS, tmpP[k], tmpB[k]);
        if (drop) {
          var P = tmpP[k], B = tmpB[k], dx = P[0] - nest[0], dy = P[1] - nest[1];
          P[0] = nest[0] + dx * drop.c - dy * drop.s; P[1] = nest[1] + dx * drop.s + dy * drop.c; P[2] += drop.z;
          var bx = B[0];
          B[0] = bx * drop.c - B[1] * drop.s; B[1] = bx * drop.s + B[1] * drop.c;
        }
      }
      var hw = st.width / 2;
      for (k = 0; k <= NS; k++) {
        var Pk = tmpP[k], a = tmpP[Math.max(0, k - 1)], b = tmpP[Math.min(NS, k + 1)];
        var T = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        var Bk = tmpB[k], bd = dot(Bk, T);
        var Bn = norm([Bk[0] - T[0] * bd, Bk[1] - T[1] * bd, Bk[2] - T[2] * bd]);
        var N = cross(T, Bn), sMat = st.len * k / NS;
        var arcPos = p - st.len + st.len * k / NS;
        var ao = 1 - (1 - (0.5 + 0.5 * smooth01((Pk[2] - (drop ? drop.z : 0)) / (26 * u)))) * (1 - smooth01((arcPos - st.p0 + 30 * u) / (60 * u)));
        for (var side = 0; side < 2; side++) {
          var sg = side ? 1 : -1;
          V[vo++] = Pk[0] + Bn[0] * hw * sg; V[vo++] = Pk[1] + Bn[1] * hw * sg; V[vo++] = Pk[2] + Bn[2] * hw * sg;
          V[vo++] = N[0]; V[vo++] = N[1]; V[vo++] = N[2];
          V[vo++] = T[0]; V[vo++] = T[1]; V[vo++] = T[2];
          V[vo++] = sMat; V[vo++] = side; V[vo++] = st.seed; V[vo++] = ao;
        }
        // ombra morbida proiettata sul fondo
        var z = Math.max(0, Pk[2]), cx = Pk[0] + LX * z, cy = Pk[1] + LY * z;
        var tl = Math.hypot(T[0], T[1]) || 1, ax = -T[1] / tl, ay = T[0] / tl;
        var core = hw * Math.abs(Bn[0] * ax + Bn[1] * ay) + 0.4 * u;
        var blur = 1.6 * u + Math.min(z, 150 * u) * 0.32, half = core + blur;
        var zr = z / (14 * u), alpha = 0.46 / (1 + zr * Math.sqrt(zr)) * (1 - smooth01(z / (150 * u))) * (1 - flat);
        for (side = 0; side < 2; side++) {
          var sgn = side ? 1 : -1;
          S[so++] = cx + ax * half * sgn; S[so++] = cy + ay * half * sgn; S[so++] = sgn; S[so++] = alpha; S[so++] = core / half;
        }
      }
    });

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ombre
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.shadow.p);
    gl.uniformMatrix4fv(P.shadow.u.uProj, false, cam.proj);
    gl.uniformMatrix4fv(P.shadow.u.uView, false, cam.view);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.shadow);
    gl.bufferData(gl.ARRAY_BUFFER, S, gl.DYNAMIC_DRAW);
    attrib(P.shadow.a.aS, 4, 5, 0);
    attrib(P.shadow.a.aCore, 1, 5, 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.index);
    gl.drawElements(gl.TRIANGLES, buf.count, gl.UNSIGNED_SHORT, 0);
    off(P.shadow.a.aS); off(P.shadow.a.aCore);

    // fettuccine
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.useProgram(P.pasta.p);
    gl.uniformMatrix4fv(P.pasta.u.uProj, false, cam.proj);
    gl.uniformMatrix4fv(P.pasta.u.uView, false, cam.view);
    gl.uniform3f(P.pasta.u.uEye, 0, 0, cam.D);
    gl.uniform1f(P.pasta.u.uUnit, u);
    gl.uniform1f(P.pasta.u.uFlat, flat);
    gl.uniform3f(P.pasta.u.uFlatColor, 254 / 255, 203 / 255, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pasta);
    gl.bufferData(gl.ARRAY_BUFFER, V, gl.DYNAMIC_DRAW);
    attrib(P.pasta.a.aPos, 3, VERT, 0);
    attrib(P.pasta.a.aNor, 3, VERT, 3);
    attrib(P.pasta.a.aTan, 3, VERT, 6);
    attrib(P.pasta.a.aUv, 3, VERT, 9);
    attrib(P.pasta.a.aAo, 1, VERT, 12);
    gl.drawElements(gl.TRIANGLES, buf.count, gl.UNSIGNED_SHORT, 0);
    off(P.pasta.a.aPos); off(P.pasta.a.aNor); off(P.pasta.a.aTan); off(P.pasta.a.aUv); off(P.pasta.a.aAo);

    // farina
    var age = t - TL.fall;
    if (age > 0 && age < 1.3) {
      var F = buf.flourData, fo = 0, drag = 3.2;
      flour.forEach(function (p) {
        var e = (1 - Math.exp(-drag * age)) / drag, life = clamp01(age / p.life);
        F[fo++] = p.x + p.vx * e; F[fo++] = p.y + p.vy * e;
        F[fo++] = Math.max(0, p.z + p.vz * e - 70 * u * age * age);
        F[fo++] = p.size;
        F[fo++] = p.a0 * Math.pow(1 - life, 1.6);
      });
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.useProgram(P.flour.p);
      gl.uniformMatrix4fv(P.flour.u.uProj, false, cam.proj);
      gl.uniformMatrix4fv(P.flour.u.uView, false, cam.view);
      gl.uniform1f(P.flour.u.uScale, cam.D * cam.dpr);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.flour);
      gl.bufferData(gl.ARRAY_BUFFER, F, gl.DYNAMIC_DRAW);
      attrib(P.flour.a.aP, 4, 5, 0);
      attrib(P.flour.a.aA, 1, 5, 4);
      gl.drawArrays(gl.POINTS, 0, FLOUR_N);
      off(P.flour.a.aP); off(P.flour.a.aA);
      gl.depthMask(true);
    }
  }
  function attrib(loc, size, stride, offset) {
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
  }
  function off(loc) { if (loc >= 0) gl.disableVertexAttribArray(loc); }

  /* ---------------- regia ---------------- */
  var anims = [], raf = 0, t0 = 0, playing = false, ending = false, flyStarted = false, use3D = false, tl = TL;
  var heroImg = null;
  var EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';

  function animate(el, frames, start, dur, easing) {
    var a = el.animate(frames, { delay: start * 1000, duration: dur * 1000, easing: easing || 'linear', fill: 'both' });
    anims.push(a);
    return a;
  }

  function schedule() {
    if (use3D) {
      animate(canvas, [{ opacity: 0 }, { opacity: 1 }], 0, 0.18);
      animate(pastaEl, [{ opacity: 0 }, { opacity: 1 }], TL.flat + 0.2, 0.3);
      animate(canvas, [{ opacity: 1 }, { opacity: 0 }], TL.flat + 0.38, 0.22);
    } else {
      animate(pastaEl, [{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0% 0 0)' }], FLAT_TL.pasta, 0.7, EASE_OUT);
    }
    lineEls.forEach(function (el, i) {
      animate(el.firstChild, [
        { transform: 'translateY(105%)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1, offset: 0.6 },
        { transform: 'translateY(0)', opacity: 1 }
      ], tl.lines[i], 0.8, EASE_OUT);
    });
    animate(stamp, [{ opacity: 0 }, { opacity: 1 }], tl.stamp, 0.35, 'ease-out');
    animate(skipBtn, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }], 0.3, tl.fly - 0.3);
  }

  // il timbro vola nella posizione del logo della home
  function startFly() {
    if (flyStarted) return;
    flyStarted = true;
    html.classList.remove('intro-lock');          // la pagina riprende la sua misura definitiva
    heroImg = document.querySelector('.hero-logo img');
    var view = document.querySelector('[data-view="home"]');
    if (!heroImg || !view || view.hidden || !heroImg.offsetWidth) {
      finish(true);
      return;
    }
    var r = heroImg.getBoundingClientRect(), rootR = root.getBoundingClientRect();
    var cx = r.left + r.width / 2 - rootR.left, cy = r.top + r.height / 2 - rootR.top;
    var sx = L.left + L.S / 2, sy = L.top + L.S / 2, sc = heroImg.offsetWidth / L.S;
    var to = 'translate(' + (cx - sx) + 'px,' + (cy - sy) + 'px) rotate(-3deg) scale(' + sc + ')';
    var fly = stage.animate([
      { transform: 'none' },
      { transform: to }
    ], { duration: tl.flyDur * 1000, easing: 'cubic-bezier(.65,0,.3,1)', fill: 'both' });
    fly.__start = tl.fly;
    anims.push(fly);
    var shadow = stamp.animate([
      { boxShadow: '0 0 0 rgba(0,0,0,0)' },
      { boxShadow: '0 ' + 30 / sc + 'px ' + 60 / sc + 'px ' + -25 / sc + 'px rgba(0,0,0,.6)' }
    ], { duration: tl.flyDur * 1000, easing: 'ease-in-out', fill: 'both' });
    shadow.__start = tl.fly;
    anims.push(shadow);
    fly.finished.then(land, function () {});
  }

  function frame(now) {
    var t = (now - t0) / 1000;
    if (use3D && t < TL.flat + 0.7) render(t);
    if (t >= tl.fly) { raf = 0; startFly(); return; }
    raf = requestAnimationFrame(frame);
  }

  // il sito compare solo dopo che il logo è arrivato al suo posto
  var revealTimer = 0;
  function reveal() {
    html.classList.remove('intro-playing', 'intro-lock', 'intro-reveal');
    void html.offsetWidth;                        // fa ripartire le animazioni d'entrata
    html.classList.add('intro-reveal');
    clearTimeout(revealTimer);
    revealTimer = setTimeout(function () { html.classList.remove('intro-reveal'); }, 2500);
  }

  // il logo è atterrato: lo sostituisce quello vero della home, poi sparisce il fondo
  function land() {
    if (!playing || ending) return;
    ending = true;
    stage.style.visibility = 'hidden';
    skipBtn.style.visibility = 'hidden';
    reveal();
    var a = bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, easing: 'ease-out', fill: 'forwards' });
    var done = function () { cleanup(); a.cancel(); };
    a.finished.then(done, done);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    raf = 0;
    playing = false;
    ending = false;
    anims.forEach(function (a) { a.cancel(); });
    anims = [];
    root.hidden = true;
    root.style.opacity = '';
    stage.style.visibility = '';
    skipBtn.style.visibility = '';
    html.classList.remove('intro-playing', 'intro-lock');
    window.removeEventListener('wheel', blockScroll, { passive: false });
    window.removeEventListener('touchmove', blockScroll, { passive: false });
    window.removeEventListener('resize', onResize);
    if (ro) ro.disconnect();
    stopWaiting();
    document.removeEventListener('keydown', onKey);
  }
  function blockScroll(e) { e.preventDefault(); }

  // "Salta intro" (o pagina senza logo grande): sfuma via e mostra subito il sito
  function finish() {
    if (!playing || ending) return;
    ending = true;
    cancelAnimationFrame(raf);
    reveal();
    var a = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: 'ease-out', fill: 'forwards' });
    var done = function () { cleanup(); a.cancel(); };
    a.finished.then(done, done);
  }

  // se la finestra cambia misura (barra del browser, pannello che si apre...)
  // l'intro si riadatta e continua, senza fermarsi
  var resizeRaf = 0;
  function onResize() {
    if (!playing || ending || !t0 || flyStarted) return;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      if (!playing || ending || flyStarted || !hasSize()) return;
      layout();
      if (use3D) { setupCamera(); buildStrands(); }
    });
  }
  var ro = null;

  // aspetta che la pagina sia visibile e abbia una misura vera prima di partire
  var waitTimer = 0, waitFn = null;
  function hasSize() { return root.clientWidth > 80 && root.clientHeight > 80; }
  function ready() { return !document.hidden && hasSize(); }
  function stopWaiting() {
    if (!waitFn) return;
    document.removeEventListener('visibilitychange', waitFn);
    window.removeEventListener('resize', waitFn);
    clearInterval(waitTimer);
    waitFn = null;
  }
  function whenReady(cb) {
    if (ready()) { cb(); return; }
    waitFn = function () { if (ready()) { stopWaiting(); cb(); } };
    document.addEventListener('visibilitychange', waitFn);
    window.addEventListener('resize', waitFn);
    waitTimer = setInterval(waitFn, 120);
  }
  function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(true); } }

  function play() {
    if (playing) return;
    playing = true;
    flyStarted = false;
    root.hidden = false;
    html.classList.add('intro-playing', 'intro-lock');
    html.classList.remove('intro-reveal');
    window.addEventListener('wheel', blockScroll, { passive: false });
    window.addEventListener('touchmove', blockScroll, { passive: false });
    var sb = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    html.style.scrollBehavior = sb;

    t0 = 0;
    document.addEventListener('keydown', onKey);
    whenReady(begin);
  }

  function begin() {
    if (!playing || ending) return;
    layout();
    use3D = initGL();
    tl = use3D ? TL : FLAT_TL;
    canvas.hidden = !use3D;
    if (use3D) {
      setupCamera();
      buildStrands();
      render(0);
    }
    t0 = performance.now();
    schedule();
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) {
      ro = new ResizeObserver(onResize);
      ro.observe(root);
    }
  }

  root.addEventListener('click', function () { finish(true); });
  skipBtn.addEventListener('click', function (e) { e.stopPropagation(); finish(true); });

  // il logo della home rilancia l'animazione
  var replay = document.querySelector('[data-replay-intro]');
  if (replay) {
    replay.addEventListener('click', function () { play(); });
  }

  // solo per controlli automatici: ferma l'animazione al secondo t
  function seek(t) {
    cancelAnimationFrame(raf);
    raf = 0;
    if (use3D) render(t);
    if (t >= tl.fly && !flyStarted) startFly();
    anims.forEach(function (a) { a.pause(); a.currentTime = Math.max(0, (t - (a.__start || 0)) * 1000); });
  }

  window.RCIntro = { play: play, skip: function () { finish(true); }, seek: seek };
  // parte da sola all'apertura del sito (aspettando che la pagina sia visibile)
  if (!root.hidden) play();
})();
