/*
 * Grembiule 3D – modello procedurale con three.js (build UMD, vendor/three.min.js).
 *
 * Il grembiule è una superficie suddivisa, "drappeggiata" su un busto invisibile
 * (sezioni ellittiche), ritagliata con una alpha map a forma di grembiule.
 * Le texture (tessuto, cuciture, tasca, ricamo del logo) sono disegnate su canvas,
 * quindi il colore si cambia al volo senza scaricare nulla.
 *
 * API:  const viewer = Apron3D.create(canvas)
 *       viewer.ready (Promise) · viewer.setColor(colore) · viewer.setView('front'|'side'|'back')
 *       viewer.setActive(bool) · viewer.onViewChange = fn(nomeVista|null)
 */
(function () {
  'use strict';

  var THREE = window.THREE;
  var V3 = THREE.Vector3;

  /* ------------------------------------------------------------------ */
  /*  Misure (metri, sistema "piatto": x = orizzontale, y = dal fondo)  */
  /* ------------------------------------------------------------------ */
  var W = 0.72;            // larghezza
  var H = 0.95;            // altezza
  var HALF = W / 2;
  var BIB = 0.17;          // metà larghezza della pettorina
  var WAIST = 0.645;       // altezza della vita (dove finisce la giromanica)
  var ARM = 0.865;         // dove la giromanica torna verticale
  var CORNER = 0.03;       // raggio degli angoli in basso
  var POCKET = { x0: -0.285, x1: -0.075, y0: 0.30, y1: 0.50 };
  var LOGO = { w: 0.25, top: 0.888 };
  var STRAP_W = 0.025;
  var STRAP_T = 0.0016;
  var STRAP_PERIOD = 0.05;
  var FLOOR_Y = -0.26;
  var TARGET = new V3(0, 0.52, 0);
  var BODY_CENTER_Z = 0.11;     // sposta il busto in modo che ruoti attorno al centro

  var VIEWS = { front: 0, side: Math.PI / 2, back: Math.PI };

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function smooth(e0, e1, v) { var t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = reject;
      im.src = src;
    });
  }
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) {
    var A = rgb(a), B = rgb(b);
    return 'rgb(' + A.map(function (v, i) { return Math.round(v + (B[i] - v) * t); }).join(',') + ')';
  }
  function luminance(hex) { var c = rgb(hex); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }

  /* ------------------------------------------------------------------ */
  /*  Sagoma del grembiule                                              */
  /* ------------------------------------------------------------------ */
  function bezier(p0, c1, c2, p3, n, out) {
    for (var i = 1; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]
      ]);
    }
  }
  function arc(cx, cy, r, a0, a1, n, out) {
    for (var i = 0; i <= n; i++) {
      var a = a0 + (a1 - a0) * i / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  // poligono antiorario (y verso l'alto)
  function outline() {
    var p = [];
    arc(-HALF + CORNER, CORNER, CORNER, Math.PI, 1.5 * Math.PI, 8, p);
    arc(HALF - CORNER, CORNER, CORNER, 1.5 * Math.PI, 2 * Math.PI, 8, p);
    p.push([HALF, WAIST]);
    bezier([HALF, WAIST], [HALF - 0.13, WAIST + 0.012], [BIB, WAIST + 0.08], [BIB, ARM], 32, p);
    p.push([BIB, H]);
    p.push([-BIB, H]);
    p.push([-BIB, ARM]);
    bezier([-BIB, ARM], [-BIB, WAIST + 0.08], [-HALF + 0.13, WAIST + 0.012], [-HALF, WAIST], 32, p);
    return dedupe(p);
  }
  function dedupe(p) {
    var out = [];
    for (var i = 0; i < p.length; i++) {
      var q = out[out.length - 1];
      if (!q || Math.hypot(q[0] - p[i][0], q[1] - p[i][1]) > 1e-6) out.push(p[i]);
    }
    var f = out[0], l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) out.pop();
    return out;
  }
  // offset verso l'interno (d > 0) o l'esterno (d < 0), con giunzioni a spigolo vivo
  function inset(pts, d) {
    var n = pts.length, out = [];
    function ln(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; }
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      var n1 = ln(p0, p1), n2 = ln(p1, p2);
      var mx = n1[0] + n2[0], my = n1[1] + n2[1], ml = Math.hypot(mx, my) || 1;
      mx /= ml; my /= ml;
      var len = d / Math.max(mx * n1[0] + my * n1[1], 0.35);
      out.push([p1[0] + mx * len, p1[1] + my * len]);
    }
    return out;
  }
  function inside(x, y, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /* ------------------------------------------------------------------ */
  /*  Busto invisibile: sezioni ellittiche (semiasse a, b, sporgenza zc) */
  /* ------------------------------------------------------------------ */
  var BODY = [
    [0.40, 0.11, 0.030],   // y = 0.00 (orlo, sotto le ginocchia)
    [0.36, 0.13, 0.036],   // y = 0.19
    [0.32, 0.15, 0.050],   // y = 0.38 (fianchi)
    [0.30, 0.17, 0.064],   // y = 0.57 (pancia)
    [0.27, 0.15, 0.050],   // y = 0.76 (petto)
    [0.27, 0.11, 0.012]    // y = 0.95 (parte alta del petto)
  ];
  var STEP = H / (BODY.length - 1);
  function cr(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function body(y) {
    var last = BODY.length - 1;
    var t = clamp(y / STEP, 0, last - 1e-6), i = Math.floor(t), f = t - i;
    var k0 = BODY[Math.max(i - 1, 0)], k1 = BODY[i], k2 = BODY[Math.min(i + 1, last)], k3 = BODY[Math.min(i + 2, last)];
    return { a: cr(k0[0], k1[0], k2[0], k3[0], f), b: cr(k0[1], k1[1], k2[1], k3[1], f), zc: cr(k0[2], k1[2], k2[2], k3[2], f) };
  }
  // lunghezza d'arco cumulativa dell'ellisse dal centro davanti (phi = 0) a dietro (phi = PI)
  function arcTable(a, b) {
    var N = 360, s = new Float32Array(N + 1), px = 0, pz = b;
    for (var i = 1; i <= N; i++) {
      var p = Math.PI * i / N, x = a * Math.sin(p), z = b * Math.cos(p);
      s[i] = s[i - 1] + Math.hypot(x - px, z - pz);
      px = x; pz = z;
    }
    return s;
  }
  function phiAt(s, d) {
    var N = s.length - 1;
    if (d >= s[N]) return Math.PI;
    var lo = 0, hi = N;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (s[m] < d) lo = m; else hi = m; }
    return Math.PI * (lo + (d - s[lo]) / ((s[hi] - s[lo]) || 1)) / N;
  }
  // pieghe morbide che crescono verso l'orlo
  function fold(x, y) {
    var amp = 0.012 * smooth(0.6, 0.02, y);
    var amp2 = 0.0035 * smooth(0.62, 0.25, y);
    return amp * (0.55 * Math.sin(x * 24 + 0.6) + 0.3 * Math.sin(x * 45 + 2.1) + 0.15 * Math.sin(x * 83 + 1.0)) +
      amp2 * Math.sin(x * 61 + y * 9);
  }
  // punto (x, y) del grembiule piatto -> posizione sul busto
  function place(x, y, bd, tab, e) {
    bd = bd || body(y);
    tab = tab || arcTable(bd.a, bd.b);
    var sx = x < 0 ? -1 : 1, p = phiAt(tab, Math.abs(x));
    var nx = sx * Math.sin(p) / bd.a, nz = Math.cos(p) / bd.b, l = Math.hypot(nx, nz);
    nx /= l; nz /= l;
    var f = fold(x, y) + (e || 0);
    return {
      pos: new V3(sx * bd.a * Math.sin(p) + nx * f, y, bd.zc - bd.b + bd.b * Math.cos(p) + nz * f),
      normal: new V3(nx, 0, nz)
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Geometrie                                                          */
  /* ------------------------------------------------------------------ */
  function apronGeometry(poly) {
    var NX = 110, NY = 144, cell = W / NX;
    var grown = inset(poly, -cell * 1.5);
    var count = (NX + 1) * (NY + 1);
    var pos = new Float32Array(count * 3), uv = new Float32Array(count * 2), keep = new Uint8Array(count);
    for (var j = 0; j <= NY; j++) {
      var y = H * j / NY, bd = body(y), tab = arcTable(bd.a, bd.b);
      for (var i = 0; i <= NX; i++) {
        var x = -HALF + W * i / NX, k = j * (NX + 1) + i;
        var s = place(x, y, bd, tab);
        pos[k * 3] = s.pos.x; pos[k * 3 + 1] = s.pos.y; pos[k * 3 + 2] = s.pos.z;
        uv[k * 2] = i / NX; uv[k * 2 + 1] = j / NY;
        keep[k] = inside(x, y, grown) ? 1 : 0;
      }
    }
    var idx = [];
    for (j = 0; j < NY; j++) {
      for (i = 0; i < NX; i++) {
        var a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
        if (keep[a] || keep[b] || keep[c] || keep[d]) idx.push(a, b, c, b, d, c);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // nastro (laccio) a sezione rettangolare lungo una curva
  function ribbon(points, closed, normalFn, width, thick) {
    var curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
    var len = curve.getLength(), segs = Math.max(12, Math.ceil(len / 0.005));
    var P = [], N = [], B = [], S = [];
    for (var i = 0; i <= segs; i++) {
      var u = i / segs, p = curve.getPointAt(u), t = curve.getTangentAt(u).normalize();
      var n = normalFn(p).clone();
      n.addScaledVector(t, -n.dot(t)).normalize();
      P.push(p); N.push(n); B.push(new V3().crossVectors(t, n).normalize()); S.push(u * len);
    }
    var pos = [], nor = [], uv = [], idx = [], base = 0;
    [[true, 1], [true, -1], [false, 1], [false, -1]].forEach(function (sd) {
      var isN = sd[0], sg = sd[1];
      for (var i = 0; i <= segs; i++) {
        var F = (isN ? N[i] : B[i]).clone().multiplyScalar(sg);
        var A = isN ? B[i].clone().multiplyScalar(sg) : N[i].clone().multiplyScalar(-sg);
        var hF = isN ? thick / 2 : width / 2, hA = isN ? width / 2 : thick / 2;
        var c = P[i].clone().addScaledVector(F, hF);
        var v1 = c.clone().addScaledVector(A, hA), v2 = c.clone().addScaledVector(A, -hA);
        pos.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
        nor.push(F.x, F.y, F.z, F.x, F.y, F.z);
        var u = S[i] / STRAP_PERIOD;
        if (isN) uv.push(u, 1, u, 0); else uv.push(u, 0.5, u, 0.5);
      }
      for (i = 0; i < segs; i++) {
        var a = base + i * 2, b = a + 1, c2 = a + 2, d = a + 3;
        idx.push(a, c2, b, b, c2, d);
      }
      base += (segs + 1) * 2;
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  function strapGeometries() {
    var list = [];
    var lift = STRAP_T / 2 + 0.0012;

    /* laccio del collo */
    var top = place(-BIB + 0.0145, H - 0.002, null, null, lift);
    var bibN = place(-BIB + 0.0145, H).normal;
    var half = [
      place(-BIB + 0.0145, H - 0.04, null, null, lift).pos,
      top.pos,
      new V3(-0.152, 0.995, top.pos.z - 0.012),
      new V3(-0.136, 1.065, -0.035),
      new V3(-0.106, 1.135, -0.083),
      new V3(-0.068, 1.19, -0.13)
    ];
    var neck = half.concat([new V3(0, 1.215, -0.168)])
      .concat(half.slice().reverse().map(function (p) { return new V3(-p.x, p.y, p.z); }));
    list.push(ribbon(neck, false, function (p) {
      var t = smooth(H - 0.01, H + 0.13, p.y);
      var nb = new V3(p.x < 0 ? bibN.x : -bibN.x, 0, bibN.z);
      var nr = new V3(p.x, 0, p.z + 0.095).normalize();
      return nb.lerp(nr, t).normalize();
    }, STRAP_W, STRAP_T));

    /* lacci in vita, fino al fiocco dietro */
    var yt = WAIST - 0.02, bd = body(yt), tab = arcTable(bd.a, bd.b);
    var e = lift + 0.0015, a = bd.a + e, b = bd.b + e, cz = bd.zc - bd.b;
    var knot = new V3(0, yt, cz - b - 0.006);
    [-1, 1].forEach(function (sx) {
      var pts = [], p0 = phiAt(tab, HALF - 0.022);
      for (var k = 0; k <= 22; k++) {
        var ph = p0 + (Math.PI - 0.08 - p0) * k / 22;
        pts.push(new V3(sx * a * Math.sin(ph), yt, cz + b * Math.cos(ph)));
      }
      pts.push(new V3(sx * 0.012, yt, knot.z - 0.002));
      list.push(ribbon(pts, false, function (p) {
        return new V3(p.x / (a * a), 0, (p.z - cz) / (b * b)).normalize();
      }, STRAP_W, STRAP_T));
    });

    /* fiocco: nodo, due asole e due code */
    var kn = [];
    for (var k = 0; k < 10; k++) {
      var t = k / 10 * Math.PI * 2;
      kn.push(new V3(0, knot.y + 0.015 * Math.cos(t), knot.z - 0.004 + 0.0085 * Math.sin(t)));
    }
    list.push(ribbon(kn, true, function (p) {
      return new V3(0, (p.y - knot.y) / 0.015, (p.z - knot.z + 0.004) / 0.0085).normalize();
    }, 0.022, STRAP_T));

    [-1, 1].forEach(function (sx) {
      // asola: anello schiacciato sul piano orizzontale, con la punta un po' sollevata
      var C = new V3(sx * 0.05, knot.y, knot.z - 0.008), rx = 0.047, rz = 0.011, loop = [];
      for (var k = 0; k < 16; k++) {
        var t = k / 16 * Math.PI * 2;
        loop.push(new V3(C.x - sx * rx * Math.cos(t), C.y + 0.014 * (1 - Math.cos(t)) / 2, C.z + rz * Math.sin(t)));
      }
      list.push(ribbon(loop, true, function (p) {
        return new V3((p.x - C.x) / (rx * rx), 0, (p.z - C.z) / (rz * rz)).normalize();
      }, 0.024, STRAP_T));

      var len = sx < 0 ? 0.25 : 0.22;
      var tail = [
        new V3(sx * 0.004, knot.y - 0.004, knot.z - 0.008),
        new V3(sx * 0.018, knot.y - 0.05, knot.z - 0.012),
        new V3(sx * 0.036, knot.y - len * 0.55, knot.z - 0.01),
        new V3(sx * 0.05, knot.y - len, knot.z - 0.004)
      ];
      list.push(ribbon(tail, false, function () { return new V3(sx * 0.15, 0, -1).normalize(); }, STRAP_W, STRAP_T));
    });
    return list;
  }

  /* ------------------------------------------------------------------ */
  /*  Texture disegnate su canvas                                        */
  /* ------------------------------------------------------------------ */
  function Painter(cw, poly, masks) {
    this.cw = cw;
    this.ch = Math.round(cw * H / W);
    this.k = cw / W;
    this.poly = poly;
    this.masks = masks;
    this.hem = inset(poly, 0.011);
    this.noise = makeNoise(192);
  }
  Painter.prototype.X = function (x) { return (x + HALF) * this.k; };
  Painter.prototype.Y = function (y) { return (H - y) * this.k; };
  Painter.prototype.path = function (g, pts, closed, scale) {
    var s = scale || 1;
    g.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var X = this.X(pts[i][0]) * s, Y = this.Y(pts[i][1]) * s;
      if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
    }
    if (closed) g.closePath();
  };
  Painter.prototype.pocketPts = function (d) {
    var p = POCKET;
    return [[p.x0 + d, p.y0 + d], [p.x1 - d, p.y0 + d], [p.x1 - d, p.y1], [p.x0 + d, p.y1]];
  };
  Painter.prototype.logoRect = function () {
    var w = LOGO.w * this.k, h = w / this.masks.ratio;
    return { x: this.X(0) - w / 2, y: this.Y(LOGO.top), w: w, h: h };
  };

  function makeNoise(size) {
    var c = mk(size, size), g = c.getContext('2d'), d = g.createImageData(size, size), s = 1234567;
    for (var i = 0; i < size * size; i++) {
      s = (s * 16807) % 2147483647;
      var v = s / 2147483647, light = v > 0.5;
      d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = light ? 255 : 0;
      d.data[i * 4 + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 30);
    }
    g.putImageData(d, 0, 0);
    return c;
  }
  function twill(period, light, dark) {
    var c = mk(period, period), g = c.getContext('2d');
    g.lineWidth = 1;
    for (var o = -period; o <= period; o += period) {
      g.strokeStyle = light; g.beginPath(); g.moveTo(o, period); g.lineTo(o + period, 0); g.stroke();
      g.strokeStyle = dark; g.beginPath(); g.moveTo(o + period / 2, period); g.lineTo(o + period * 1.5, 0); g.stroke();
    }
    return c;
  }
  function satin(px, light, dark) {
    var n = Math.max(3, Math.round(px)), c = mk(n * 2, n * 2), g = c.getContext('2d');
    g.lineWidth = Math.max(1, n * 0.45);
    for (var o = -n * 2; o <= n * 4; o += n) {
      g.strokeStyle = (o / n) % 2 ? dark : light;
      g.beginPath(); g.moveTo(o, n * 2); g.lineTo(o + n * 1.2, 0); g.stroke();
    }
    return c;
  }
  function tatami(px, light, dark) {
    var h = Math.max(3, Math.round(px)), w = h * 8, c = mk(w, h * 3), g = c.getContext('2d');
    for (var r = 0; r < 3; r++) {
      g.fillStyle = light; g.fillRect(0, r * h, w, Math.max(1, h * 0.35));
      g.fillStyle = dark;
      var off = (r * w / 3) % w;
      g.fillRect(off, r * h, Math.max(1, h * 0.4), h);
      g.fillRect((off + w / 2) % w, r * h + h * 0.6, w * 0.6, Math.max(1, h * 0.25));
    }
    return c;
  }
  function tint(img, w, h, color, pattern) {
    var c = mk(Math.ceil(w), Math.ceil(h)), g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    if (pattern) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = g.createPattern(pattern, 'repeat');
      g.fillRect(0, 0, w, h);
    }
    return c;
  }
  function dashed(g, painter, pts, closed, color, widthM, dashM, gapM, scale) {
    var s = scale || 1, k = painter.k * s;
    g.save();
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, widthM * k);
    g.lineCap = 'round';
    g.setLineDash([dashM * k, gapM * k]);
    painter.path(g, pts, closed, s);
    g.stroke();
    g.restore();
  }

  // tessuto + cuciture + tasca + ricamo
  Painter.prototype.paintColor = function (canvas, col) {
    var g = canvas.getContext('2d'), k = this.k, fab = col.tessuto;
    var dark = luminance(fab) < 0.45;
    var seam = dark ? mix(fab, '#ffffff', 0.16) : mix(fab, '#000000', 0.16);
    var seamShadow = dark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.22)';

    g.save();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = fab; g.fillRect(0, 0, this.cw, this.ch);
    g.fillStyle = g.createPattern(this.noise, 'repeat'); g.fillRect(0, 0, this.cw, this.ch);
    g.fillStyle = g.createPattern(twill(Math.max(4, Math.round(k * 0.0022)), 'rgba(255,255,255,0.035)', 'rgba(0,0,0,0.05)'), 'repeat');
    g.fillRect(0, 0, this.cw, this.ch);

    // orlo: leggera ombra della doppia piega
    g.save();
    this.path(g, this.poly, true); g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.05)'; g.lineWidth = 0.034 * k;
    this.path(g, this.poly, true); g.stroke();
    g.restore();
    dashed(g, this, inset(this.poly, 0.0113), true, seamShadow, 0.0016, 0.0032, 0.0014);
    dashed(g, this, this.hem, true, seam, 0.0013, 0.0032, 0.0014);

    // tasca
    var pk = this.pocketPts(0);
    g.save();
    g.beginPath(); g.rect(0, 0, this.cw, this.ch); this.path(g, pk, true); g.clip('evenodd');
    g.shadowColor = dark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.28)';
    g.shadowBlur = 0.005 * k; g.shadowOffsetY = 0.0015 * k;
    g.fillStyle = fab; this.path(g, pk, true); g.fill();
    g.restore();
    var gx = this.X(POCKET.x0), gw = this.X(POCKET.x1) - gx, gy = this.Y(POCKET.y1);
    var grad = g.createLinearGradient(0, gy, 0, gy + 0.03 * k);
    grad.addColorStop(0, 'rgba(0,0,0,0.0)'); grad.addColorStop(0.1, 'rgba(0,0,0,0.10)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(gx, gy, gw, 0.03 * k);
    g.fillStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.35)';
    g.fillRect(gx, gy, gw, Math.max(1, 0.0015 * k));
    var ps = this.pocketPts(0.005);
    dashed(g, this, [ps[3], ps[0], ps[1], ps[2]], false, seamShadow, 0.0016, 0.0032, 0.0014);
    dashed(g, this, [ps[3], ps[0], ps[1], ps[2]], false, seam, 0.0013, 0.0032, 0.0014);
    var hy = POCKET.y1 - 0.022;
    dashed(g, this, [[POCKET.x0 + 0.003, hy], [POCKET.x1 - 0.003, hy]], false, seam, 0.0013, 0.0032, 0.0014);

    // ricamo del logo
    var r = this.logoRect(), sc = k / 2133;
    var darkThread = luminance(col.ricamo) < 0.3;
    var text = tint(this.masks.testo, r.w, r.h, col.ricamo,
      satin(3 * sc, darkThread ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.22)', darkThread ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.16)'));
    var pasta = tint(this.masks.pasta, r.w, r.h, '#efb51c',
      tatami(3 * sc, 'rgba(255,240,180,0.35)', 'rgba(120,70,0,0.30)'));
    g.save();
    g.shadowColor = dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.25)';
    g.shadowBlur = 0.0018 * k; g.shadowOffsetY = 0.0006 * k;
    g.drawImage(pasta, r.x, r.y);
    g.drawImage(text, r.x, r.y);
    g.restore();
    g.restore();
  };

  // rovescio: tessuto semplice + cuciture
  Painter.prototype.paintBack = function (canvas, col) {
    var g = canvas.getContext('2d'), s = canvas.width / this.cw, fab = mix(col.tessuto, '#000000', 0.08);
    var dark = luminance(col.tessuto) < 0.45;
    g.fillStyle = fab; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = g.createPattern(this.noise, 'repeat'); g.fillRect(0, 0, canvas.width, canvas.height);
    g.save();
    this.path(g, this.poly, true, s); g.clip();
    g.strokeStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'; g.lineWidth = 0.034 * this.k * s;
    this.path(g, this.poly, true, s); g.stroke();
    g.restore();
    dashed(g, this, this.hem, true, dark ? mix(col.tessuto, '#ffffff', 0.14) : mix(col.tessuto, '#000000', 0.14), 0.0013, 0.0032, 0.0014, s);
  };

  // nastro dei lacci (texture ripetuta)
  function paintStrap(canvas, col, noise) {
    var g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    var dark = luminance(col.tessuto) < 0.45;
    g.fillStyle = col.tessuto; g.fillRect(0, 0, w, h);
    g.fillStyle = g.createPattern(noise, 'repeat'); g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, w, h * 0.05); g.fillRect(0, h * 0.95, w, h * 0.05);
    g.strokeStyle = dark ? mix(col.tessuto, '#ffffff', 0.18) : mix(col.tessuto, '#000000', 0.18);
    g.lineWidth = Math.max(1, h * 0.04);
    g.setLineDash([w / 16 * 0.68, w / 16 * 0.32]);
    [0.15, 0.85].forEach(function (v) { g.beginPath(); g.moveTo(0, h * v); g.lineTo(w, h * v); g.stroke(); });
  }

  // mappa di rilievo -> normal map
  Painter.prototype.paintNormal = function (canvas) {
    var w = canvas.width, h = canvas.height, g = canvas.getContext('2d'), k = this.k;
    g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, w, h);
    g.fillStyle = g.createPattern(twill(Math.max(4, Math.round(k * 0.0022)), 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.06)'), 'repeat');
    g.fillRect(0, 0, w, h);

    // orlo in rilievo + cuciture incavate
    g.save();
    this.path(g, this.poly, true); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = 0.034 * k;
    this.path(g, this.poly, true); g.stroke();
    g.restore();
    dashed(g, this, this.hem, true, 'rgba(0,0,0,0.35)', 0.0016, 0.0032, 0.0014);

    // tasca
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.07)';
    this.path(g, this.pocketPts(0), true); g.fill();
    g.restore();
    var ps = this.pocketPts(0.005);
    dashed(g, this, [ps[3], ps[0], ps[1], ps[2]], false, 'rgba(0,0,0,0.35)', 0.0016, 0.0032, 0.0014);
    var hy = POCKET.y1 - 0.022;
    dashed(g, this, [[POCKET.x0 + 0.003, hy], [POCKET.x1 - 0.003, hy]], false, 'rgba(0,0,0,0.3)', 0.0016, 0.0032, 0.0014);

    // ricamo in rilievo
    var r = this.logoRect(), sc = k / 2133;
    var t = tint(this.masks.testo, r.w, r.h, 'rgb(78,78,78)', satin(3 * sc, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.35)'));
    var p = tint(this.masks.pasta, r.w, r.h, 'rgb(60,60,60)', tatami(3 * sc, 'rgba(255,255,255,0.15)', 'rgba(0,0,0,0.40)'));
    g.save();
    g.globalCompositeOperation = 'lighter';
    if ('filter' in g) g.filter = 'blur(' + Math.max(0.6, 0.0005 * k).toFixed(2) + 'px)';
    g.drawImage(p, r.x, r.y);
    g.drawImage(t, r.x, r.y);
    g.restore();

    // altezza -> normali (Sobel semplificato)
    var src = g.getImageData(0, 0, w, h).data, out = g.createImageData(w, h), d = out.data, s = 5.5 / 255;
    for (var y = 0; y < h; y++) {
      var yu = (y > 0 ? y - 1 : y) * w, yd = (y < h - 1 ? y + 1 : y) * w, row = y * w;
      for (var x = 0; x < w; x++) {
        var xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
        var dx = (src[(row + xr) * 4] - src[(row + xl) * 4]) * 0.5 * s;
        var dy = (src[(yu + x) * 4] - src[(yd + x) * 4]) * 0.5 * s;
        var inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), o = (row + x) * 4;
        d[o] = (-dx * inv * 0.5 + 0.5) * 255;
        d[o + 1] = (-dy * inv * 0.5 + 0.5) * 255;
        d[o + 2] = (inv * 0.5 + 0.5) * 255;
        d[o + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
  };

  Painter.prototype.paintAlpha = function (canvas) {
    var g = canvas.getContext('2d'), s = canvas.width / this.cw;
    g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#fff'; this.path(g, this.poly, true, s); g.fill();
  };

  Painter.prototype.paintRoughness = function (canvas) {
    var g = canvas.getContext('2d'), s = canvas.width / this.cw, r = this.logoRect();
    g.fillStyle = 'rgb(235,235,235)'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(tint(this.masks.testo, r.w * s, r.h * s, 'rgb(150,150,150)'), r.x * s, r.y * s);
    g.drawImage(tint(this.masks.pasta, r.w * s, r.h * s, 'rgb(130,130,130)'), r.x * s, r.y * s);
  };

  /* ------------------------------------------------------------------ */
  /*  Ambiente luminoso (versione ridotta di RoomEnvironment)            */
  /* ------------------------------------------------------------------ */
  function roomEnvironment(renderer) {
    var scene = new THREE.Scene(), box = new THREE.BoxGeometry();
    var room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x4a4038, side: THREE.BackSide }));
    room.scale.set(14, 9, 14); room.position.y = 3; scene.add(room);
    function panel(intensity, p, s, color) {
      var m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: color || 0xffffff }));
      m.material.color.multiplyScalar(intensity);
      m.position.set(p[0], p[1], p[2]); m.scale.set(s[0], s[1], s[2]);
      scene.add(m);
    }
    panel(8, [0, 7.4, 1], [5, 0.1, 5], 0xfff3e2);
    panel(5, [-6.8, 3.5, 2.5], [0.1, 3.5, 3.5]);
    panel(3.5, [6.8, 3, -1], [0.1, 3, 5], 0xffe7cc);
    panel(4, [0, 3, 6.8], [5, 3.5, 0.1]);
    panel(2.5, [0, 4, -6.8], [4, 2, 0.1]);
    var pmrem = new THREE.PMREMGenerator(renderer);
    var tex = pmrem.fromScene(scene, 0.04).texture;
    pmrem.dispose();
    scene.traverse(function (o) { if (o.material) o.material.dispose(); });
    box.dispose();
    return tex;
  }

  function radialTexture(stops, size) {
    var c = mk(size || 256, size || 256), g = c.getContext('2d'), r = c.width / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    stops.forEach(function (s) { grad.addColorStop(s[0], s[1]); });
    g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ------------------------------------------------------------------ */
  /*  Viewer                                                             */
  /* ------------------------------------------------------------------ */
  function create(canvas) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var scene = new THREE.Scene();
    scene.environment = roomEnvironment(renderer);

    var camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);

    /* luci */
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a1a10, 0.3));
    var key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(0.55, 3.6, 1.9);
    key.target.position.copy(TARGET);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -0.9; key.shadow.camera.right = 0.9;
    key.shadow.camera.top = 0.9; key.shadow.camera.bottom = -0.9;
    key.shadow.camera.near = 1; key.shadow.camera.far = 7;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 4;
    scene.add(key, key.target);
    var fill = new THREE.DirectionalLight(0xe6ecff, 0.7);
    fill.position.set(-2.2, 1.3, 1.6);
    scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(-0.8, 2.0, -2.6);
    scene.add(rim);
    var rim2 = new THREE.DirectionalLight(0xffe2c4, 0.9);
    rim2.position.set(2.4, 1.2, -1.8);
    scene.add(rim2);

    /* pavimento: anello, alone e ombra */
    var floor = new THREE.Group();
    floor.position.y = FLOOR_Y;
    var glow = new THREE.Mesh(new THREE.CircleGeometry(0.66, 96),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,214,120,0.16)'], [0.7, 'rgba(255,214,120,0.06)'], [1, 'rgba(255,214,120,0)']]), transparent: true, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    var ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.607, 160),
      new THREE.MeshBasicMaterial({ color: 0xe9b949, transparent: true, opacity: 0.75, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.001;
    var catcher = new THREE.Mesh(new THREE.CircleGeometry(0.6, 96), new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.002; catcher.receiveShadow = true;
    var blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(0,0,0,0.45)'], [0.55, 'rgba(0,0,0,0.15)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.003;
    floor.add(glow, ring, catcher, blob);
    scene.add(floor);

    /* modello */
    var model = new THREE.Group();
    var rig = new THREE.Group();
    rig.position.z = BODY_CENTER_Z;
    model.add(rig);
    scene.add(model);

    var state = {
      theta: reduceMotion ? 0 : -0.85, phi: 1.475, zoom: 1,
      vel: 0, anim: null, dragging: false, fit: 2.6, targetY: TARGET.y, active: false, dirty: true, ready: false
    };
    var viewer = { onViewChange: null };

    var maxTex = renderer.capabilities.maxTextureSize;
    var big = Math.min(window.screen.width, window.screen.height) * (window.devicePixelRatio || 1) > 900 && maxTex >= 4096;
    var CW = big ? 1536 : 1024;
    var aniso = renderer.capabilities.getMaxAnisotropy();
    var poly = outline();

    var colorCanvas = mk(CW, Math.round(CW * H / W));
    var normalCanvas = mk(CW, Math.round(CW * H / W));
    var backCanvas = mk(512, Math.round(512 * H / W));
    var alphaCanvas = mk(1024, Math.round(1024 * H / W));
    var roughCanvas = mk(512, Math.round(512 * H / W));
    var strapCanvas = mk(256, 64);

    function tex(c, srgb, repeat) {
      var t = new THREE.CanvasTexture(c);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      if (repeat) { t.wrapS = THREE.RepeatWrapping; }
      return t;
    }
    var colorTex = tex(colorCanvas, true), normalTex = tex(normalCanvas), backTex = tex(backCanvas, true);
    var alphaTex = tex(alphaCanvas), roughTex = tex(roughCanvas), strapTex = tex(strapCanvas, true, true);

    var fabricMat = new THREE.MeshPhysicalMaterial({
      map: colorTex, normalMap: normalTex, normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 1, roughnessMap: roughTex, alphaMap: alphaTex, alphaTest: 0.5,
      sheen: 0.7, sheenRoughness: 0.5, envMapIntensity: 0.5, side: THREE.FrontSide
    });
    fabricMat.shadowSide = THREE.DoubleSide;
    var backMat = new THREE.MeshPhysicalMaterial({
      map: backTex, roughness: 0.95, alphaMap: alphaTex, alphaTest: 0.5,
      sheen: 0.7, sheenRoughness: 0.55, envMapIntensity: 0.45, side: THREE.BackSide
    });
    var strapMat = new THREE.MeshPhysicalMaterial({
      map: strapTex, roughness: 0.9, sheen: 0.7, sheenRoughness: 0.5, envMapIntensity: 0.5
    });
    var depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: alphaTex, alphaTest: 0.5 });

    var geo = apronGeometry(poly);
    var front = new THREE.Mesh(geo, fabricMat);
    front.castShadow = true; front.receiveShadow = true; front.customDepthMaterial = depthMat;
    var back = new THREE.Mesh(geo, backMat);
    back.receiveShadow = true;
    rig.add(front, back);
    strapGeometries().forEach(function (g) {
      var m = new THREE.Mesh(g, strapMat);
      m.castShadow = true; m.receiveShadow = true;
      rig.add(m);
    });

    var painter = null;
    var current = null;
    var M = window.LOGO_RICAMO;
    viewer.ready = Promise.all([loadImage(M.testo), loadImage(M.pasta)]).then(function (imgs) {
      painter = new Painter(CW, poly, { testo: imgs[0], pasta: imgs[1], ratio: M.ratio });
      painter.paintNormal(normalCanvas);
      painter.paintAlpha(alphaCanvas);
      painter.paintRoughness(roughCanvas);
      normalTex.needsUpdate = alphaTex.needsUpdate = roughTex.needsUpdate = true;
      if (current) applyColor(current);
      state.ready = true;
      state.dirty = true;
      return viewer;
    });

    function applyColor(col) {
      painter.paintColor(colorCanvas, col);
      painter.paintBack(backCanvas, col);
      paintStrap(strapCanvas, col, painter.noise);
      colorTex.needsUpdate = backTex.needsUpdate = strapTex.needsUpdate = true;
      var lum = luminance(col.tessuto);
      var sheen = new THREE.Color(col.tessuto).lerp(new THREE.Color(0xffffff), lum < 0.1 ? 0.22 : lum < 0.45 ? 0.08 : 0.1);
      fabricMat.sheenColor.copy(sheen);
      backMat.sheenColor.copy(sheen);
      strapMat.sheenColor.copy(sheen);
      state.dirty = true;
    }

    viewer.setColor = function (col) {
      current = col;
      if (painter) applyColor(col);
    };

    /* camera e adattamento */
    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // inquadra dal fondo del grembiule (y ≈ 0) al laccio del collo (y ≈ 1.24),
      // lasciando spazio in basso per i pulsanti Fronte / Lato / Retro
      var tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      var top = h < 600 ? 30 : 56, bottom = h < 600 ? 70 : 96;
      var ppm = Math.min((h - top - bottom) / 1.28, (w - 40) / 0.86);   // pixel per metro
      var visible = h / ppm;
      state.fit = visible / 2 / tan;
      state.targetY = -0.02 - bottom / ppm + visible / 2;
      camera.updateProjectionMatrix();
      state.dirty = true;
    }
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
    resize();

    function placeCamera() {
      var d = state.fit * state.zoom;
      TARGET.y = state.targetY;
      camera.position.set(0, TARGET.y + d * Math.cos(state.phi), d * Math.sin(state.phi));
      camera.lookAt(TARGET);
      model.rotation.y = state.theta;
    }

    function nearestView() {
      var t = ((state.theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      for (var name in VIEWS) {
        var d = Math.abs(t - VIEWS[name]);
        d = Math.min(d, Math.PI * 2 - d);
        if (d < 0.12) return name;
      }
      return null;
    }
    var lastView = undefined;
    function notifyView() {
      var v = state.anim ? state.anim.view : nearestView();
      if (v !== lastView) { lastView = v; if (viewer.onViewChange) viewer.onViewChange(v); }
    }

    function animateTo(theta, phi, zoom, view, ms) {
      var dt = theta - state.theta;
      dt = Math.atan2(Math.sin(dt), Math.cos(dt));
      state.vel = 0;
      state.anim = {
        from: [state.theta, state.phi, state.zoom], to: [state.theta + dt, phi, zoom],
        t: 0, dur: reduceMotion ? 1 : (ms || 750), view: view
      };
    }
    viewer.setView = function (name) {
      if (!(name in VIEWS)) return;
      animateTo(VIEWS[name], 1.475, 1, name);
    };

    /* interazione: trascina, rotella, pizzico, tastiera */
    var pointers = new Map(), last = null, pinch = 0;
    function stopAnim() { state.anim = null; }
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stopAnim(); state.vel = 0; state.dragging = true;
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (pointers.size === 2) pinch = pinchDist();
      canvas.classList.add('is-dragging');
    });
    function pinchDist() {
      var p = Array.from(pointers.values());
      return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    }
    canvas.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        var d = pinchDist();
        if (pinch) state.zoom = clamp(state.zoom * pinch / d, 0.55, 1.35);
        pinch = d; state.dirty = true;
        return;
      }
      var now = performance.now(), dx = e.clientX - last.x, dy = e.clientY - last.y;
      state.theta += dx * 0.0085;
      state.phi = clamp(state.phi - dy * 0.004, 1.12, 1.72);
      var dtm = Math.max(1, now - last.t);
      state.vel = 0.8 * (dx * 0.0085 / dtm * 1000) + 0.2 * state.vel;
      last = { x: e.clientX, y: e.clientY, t: now };
      state.dirty = true;
    });
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (pointers.size === 0) {
        state.dragging = false;
        canvas.classList.remove('is-dragging');
        if (last && performance.now() - last.t > 80) state.vel = 0;
        if (reduceMotion) state.vel = 0;
      } else {
        var p = Array.from(pointers.values())[0];
        last = { x: p.x, y: p.y, t: performance.now() };
      }
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      stopAnim();
      state.zoom = clamp(state.zoom * (1 + clamp(e.deltaY, -100, 100) * 0.0012), 0.55, 1.35);
      state.dirty = true;
    }, { passive: false });
    canvas.addEventListener('dblclick', function () { animateTo(state.theta, 1.475, 1, nearestView(), 500); });
    canvas.addEventListener('keydown', function (e) {
      var step = Math.PI / 12;
      if (e.key === 'ArrowLeft') { animateTo(state.theta - step, state.phi, state.zoom, null, 250); }
      else if (e.key === 'ArrowRight') { animateTo(state.theta + step, state.phi, state.zoom, null, 250); }
      else if (e.key === 'ArrowUp') { animateTo(state.theta, clamp(state.phi - 0.1, 1.12, 1.72), state.zoom, null, 250); }
      else if (e.key === 'ArrowDown') { animateTo(state.theta, clamp(state.phi + 0.1, 1.12, 1.72), state.zoom, null, 250); }
      else if (e.key === '+' || e.key === '=') { animateTo(state.theta, state.phi, clamp(state.zoom * 0.9, 0.55, 1.35), null, 250); }
      else if (e.key === '-') { animateTo(state.theta, state.phi, clamp(state.zoom * 1.1, 0.55, 1.35), null, 250); }
      else return;
      e.preventDefault();
    });

    /* ciclo di rendering (solo quando serve) */
    var raf = 0, prev = 0, intro = !reduceMotion;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = prev ? Math.min(0.05, (now - prev) / 1000) : 0.016;
      prev = now;
      var moving = false;
      if (state.anim) {
        var a = state.anim;
        a.t += dt * 1000;
        var p = Math.min(1, a.t / a.dur), e = 1 - Math.pow(1 - p, 3);
        state.theta = a.from[0] + (a.to[0] - a.from[0]) * e;
        state.phi = a.from[1] + (a.to[1] - a.from[1]) * e;
        state.zoom = a.from[2] + (a.to[2] - a.from[2]) * e;
        if (p >= 1) state.anim = null;
        moving = true;
      } else if (!state.dragging && Math.abs(state.vel) > 0.01) {
        state.theta += state.vel * dt;
        state.vel *= Math.exp(-dt * 4.5);
        moving = true;
      }
      if (moving || state.dirty) {
        placeCamera();
        renderer.render(scene, camera);
        state.dirty = false;
        notifyView();
      }
    }

    viewer.setActive = function (on) {
      if (on && !raf) {
        prev = 0;
        resize();
        state.dirty = true;
        raf = requestAnimationFrame(frame);
        if (intro && state.ready) { intro = false; animateTo(0, 1.475, 1, 'front', 1400); }
      } else if (!on && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    viewer.ready.then(function () {
      if (raf && intro) { intro = false; animateTo(0, 1.475, 1, 'front', 1400); }
    });

    viewer.snapshot = function () { renderer.render(scene, camera); return canvas.toDataURL('image/png'); };
    return viewer;
  }

  function supported() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  window.Apron3D = { create: create, supported: supported };
})();
