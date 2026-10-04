/* ============================================================
 * procedural_blocks.js
 * Texturas de bloques 16x16 estilo Minecraft, minimalistas y
 * orgánicas, generadas de forma PROCEDURAL (sin tiles repetidos).
 *
 * IDEA CLAVE: cada pixel se calcula a partir de sus coordenadas
 * en el MUNDO (bx*16+px, by*16+py), no de las coordenadas dentro
 * del bloque. Asi el ruido continua de un bloque al vecino y
 * nunca se repite, da igual cuantos bloques pongas juntos.
 *
 * USO (canvas):
 *   const buf = ctx.createImageData(W*16, H*16);  // opaco de fondo
 *   ProcBlocks.renderInto(buf.data, W*16, ox, oy, 'stone', bx, by, seed, 'world');
 *   ctx.putImageData(buf, 0, 0);
 *
 * MODOS:
 *   'world'    -> ruido continuo en coordenadas de mundo (recomendado)
 *   'variants' -> 8 variantes tileables + rotacion/espejo al azar
 *                 (para motores que solo aceptan atlas de tiles)
 *   'tile'     -> 1 tile tileable fijo (el comportamiento repetitivo)
 *
 * pixel(type, wx, wy, seed, tile) -> [r,g,b,a]   (no modificar el array)
 * ============================================================ */
(function (root) {
  'use strict';
  const S = 16;

  const TYPES = ['dirt','stone','grass_top','grass_side','cobblestone','sand','gravel','snow',
    'bedrock','obsidian','planks','log_side','log_top','leaves','bricks','glass',
    'coal_ore','iron_ore','gold_ore','diamond_ore','redstone_ore','water','lava'];

  /* ---------- utilidades ---------- */
  const hexCache = {};
  function hex(h) {
    let c = hexCache[h];
    if (!c) {
      c = [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16), 255];
      hexCache[h] = c;
    }
    return c;
  }

  // hash entero -> [0,1)  (determinista, sin estado)
  function hash(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const smooth = t => t * t * (3 - 2 * t);

  // value noise suave. px/py = periodo del lattice (0 = infinito, sin repeticion)
  function vnoise(x, y, seed, px, py) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = smooth(x - x0), ty = smooth(y - y0);
    const wx = v => px ? ((v % px) + px) % px : v;
    const wy = v => py ? ((v % py) + py) % py : v;
    const a = hash(wx(x0), wy(y0), seed), b = hash(wx(x0 + 1), wy(y0), seed);
    const c = hash(wx(x0), wy(y0 + 1), seed), d = hash(wx(x0 + 1), wy(y0 + 1), seed);
    const u = a + (b - a) * tx, l = c + (d - c) * tx;
    return u + (l - u) * ty;
  }

  // dos octavas. cx,cy = tamano de celda en px (potencias de 2 si tile=true)
  function fbm(wx, wy, seed, cx, cy, tile) {
    cy = cy || cx;
    const p1x = tile ? S / cx : 0, p1y = tile ? S / cy : 0;
    const o1 = vnoise(wx / cx, wy / cy, seed, p1x, p1y);
    const o2 = vnoise(wx / (cx / 2), wy / (cy / 2), seed + 7919, p1x * 2, p1y * 2);
    return o1 * 0.65 + o2 * 0.35;
  }

  /* ---------- materiales simples: 3 tonos por manchas ---------- */
  // pal[0]=base, pal[1]=oscuro, pal[2]=claro ; cuts = umbrales del ruido
  const SIMPLE = {
    dirt:     { pal: ['#7a5a3f', '#6e4f36', '#86654a'], cell: 4, cuts: [.46, .61], seed: 1 },
    stone:    { pal: ['#8d8d8d', '#7c7c7c', '#9a9a9a'], cell: 4, cuts: [.46, .61], seed: 2 },
    grass_top:{ pal: ['#5e9b3c', '#528c33', '#6aa845'], cell: 4, cuts: [.45, .60], seed: 3 },
    sand:     { pal: ['#dcd0a2', '#d2c694', '#e4dab2'], cell: 8, cuts: [.46, .62], seed: 4 },
    gravel:   { pal: ['#8a8480', '#76716d', '#9c9692'], cell: 2, cuts: [.45, .60], seed: 5 },
    snow:     { pal: ['#f7fafc', '#e9f0f5', '#ffffff'], cell: 8, cuts: [.42, .62], seed: 6 },
    bedrock:  { pal: ['#4a4a4a', '#363636', '#5e5e5e'], cell: 2, cuts: [.45, .60], seed: 7 },
    obsidian: { pal: ['#1a1428', '#120e1e', '#2a2040'], cell: 4, cuts: [.50, .66], seed: 8 },
    leaves:   { pal: ['#3a7a28', '#2c6320', '#4a9232'], cell: 2, cuts: [.45, .60], seed: 9 },
    water:    { pal: ['#3b66e0', '#2f58cc', '#4d7bf0'], cell: 8, cy: 4, cuts: [.44, .60], seed: 10 },
    lava:     { pal: ['#e6560a', '#c93f05', '#ffa31a'], cell: 4, cuts: [.44, .62], seed: 11 },
    log_side: { pal: ['#6a5130', '#5b4527', '#78603c'], cell: 2, cy: 8, cuts: [.45, .60], seed: 17 }
  };
  function simple(def, wx, wy, seed, tile) {
    const v = fbm(wx, wy, def.seed * 131 + seed, def.cell, def.cy, tile);
    return hex(def.pal[(v > def.cuts[0]) + (v > def.cuts[1])]);
  }

  /* ---------- materiales con logica propia ---------- */
  function grassSide(wx, wy, seed, tile, px, py) {
    const f = vnoise(wx / 4, 0.5, seed + 121, tile ? 4 : 0, 0);
    const h = 2 + Math.floor(f * 3.2);                 // flequillo irregular
    return py < h ? simple(SIMPLE.grass_top, wx, wy, seed, tile)
                  : simple(SIMPLE.dirt, wx, wy, seed, tile);
  }

  function cobble(wx, wy, seed, tile) {
    const c = fbm(wx, wy, seed + 14, 8, 8, tile);
    if (Math.abs(c - 0.5) < 0.04) return hex('#5c5c5c');   // grietas = contornos del ruido
    const v = fbm(wx, wy, seed + 13, 4, 4, tile);
    return hex(['#858585', '#777777', '#919191'][(v > .45) + (v > .60)]);
  }

  const ORES = {
    coal_ore: ['#2a2a2a', '#1a1a1a'], iron_ore: ['#d6b49a', '#bd9578'],
    gold_ore: ['#f5d63a', '#d9b520'], diamond_ore: ['#58e6ee', '#2fc0cc'],
    redstone_ore: ['#e02020', '#a81212']
  };
  function ore(type, wx, wy, seed, tile, bx, by, px, py) {
    const n = 2 + Math.floor(hash(bx, by, seed + 555) * 2);          // 2-3 vetas por bloque
    const wob = fbm(wx, wy, seed + 31, 2, 2, tile);
    for (let i = 0; i < n; i++) {
      const cx = 2.5 + hash(bx, by, seed + 600 + i * 3) * 11;
      const cy = 2.5 + hash(bx, by, seed + 601 + i * 3) * 11;
      const r = 1.3 + hash(bx, by, seed + 602 + i * 3) * 1.4;
      const d = Math.hypot(px - cx, py - cy) + (wob - 0.5) * 3.2;     // borde irregular
      if (d < r) return hex(ORES[type][hash(wx, wy, seed + 9) > 0.7 ? 1 : 0]);
    }
    return simple(SIMPLE.stone, wx, wy, seed, tile);
  }

  function planks(wx, wy, seed, tile, bx, by, px, py) {
    const row = py >> 2;
    if ((py & 3) === 3) return hex('#7a5a30');
    const jx = 3 + Math.floor(hash(bx, by * 4 + row, seed + 6) * 10);  // junta distinta por tabla
    if (px === jx) return hex('#7a5a30');
    const shades = ['#a98349', '#b08a50', '#a07a42'];
    const sh = (row + Math.floor(hash(bx, by, seed + 5) * 3)) % 3;
    return hex(fbm(wx, wy, seed + 41, 8, 2, tile) > 0.58 ? '#b79257' : shades[sh]);
  }

  function logTop(wx, wy, seed, tile, bx, by, px, py) {
    const ox = 7.5 + (hash(bx, by, seed + 71) - 0.5) * 2;               // centro desplazado
    const oy = 7.5 + (hash(bx, by, seed + 72) - 0.5) * 2;
    const w = fbm(wx, wy, seed + 73, 4, 4, tile);
    const d = Math.hypot(px - ox, py - oy) + (w - 0.5) * 3.2;
    if (d > 7.0) return hex('#5b4527');
    return hex(Math.floor(d / 1.9) % 2 === 0 ? '#b3925c' : '#9c7c49');
  }

  function bricks(wx, wy, seed, tile) {
    const row = Math.floor(wy / 4), off = (row & 1) ? 4 : 0;
    if ((wy & 3) === 3 || ((wx + off) & 7) === 7) return hex('#c8c2b6');
    let ix = Math.floor((wx + off) / 8), iy = row;
    if (tile) { ix &= 1; iy &= 3; }
    const tones = ['#9a5441', '#8c4a39', '#a85f4b'];
    const t = tones[Math.floor(hash(ix, iy, seed + 81) * 3)];
    return hex(fbm(wx, wy, seed + 82, 2, 2, tile) > 0.64 ? '#a85f4b' : t);
  }

  function glass(wx, wy, seed, tile, bx, by, px, py) {
    const edge = px === 0 || py === 0 || px === S - 1 || py === S - 1;
    if (edge) return hash(wx, wy, seed + 90) > 0.14 ? [207, 233, 240, 255] : [0, 0, 0, 0];
    const gx = 3 + Math.floor(hash(bx, by, seed + 91) * 6);
    const gy = 3 + Math.floor(hash(bx, by, seed + 92) * 6);
    const dx = px - gx;
    if (dx >= 0 && dx < 3 && py - gy === dx) return [255, 255, 255, 230];
    return [230, 246, 251, 40];
  }

  /* ---------- API ---------- */
  function pixel(type, wx, wy, seed, tile) {
    seed = seed | 0;
    const bx = tile ? 0 : Math.floor(wx / S), by = tile ? 0 : Math.floor(wy / S);
    const px = ((wx % S) + S) % S, py = ((wy % S) + S) % S;
    if (SIMPLE[type]) return simple(SIMPLE[type], wx, wy, seed, tile);
    if (ORES[type]) return ore(type, wx, wy, seed, tile, bx, by, px, py);
    switch (type) {
      case 'grass_side':  return grassSide(wx, wy, seed, tile, px, py);
      case 'cobblestone': return cobble(wx, wy, seed, tile);
      case 'planks':      return planks(wx, wy, seed, tile, bx, by, px, py);
      case 'log_top':     return logTop(wx, wy, seed, tile, bx, by, px, py);
      case 'bricks':      return bricks(wx, wy, seed, tile);
      case 'glass':       return glass(wx, wy, seed, tile, bx, by, px, py);
    }
    return [255, 0, 255, 255];
  }

  // variantes: tile tileable (seed + variante) con rotacion/espejo por bloque
  const FLIP_ONLY = { grass_side: 1, log_side: 1, planks: 1, bricks: 1, glass: 1 };
  function variantPixel(type, px, py, bx, by, seed, nVar) {
    const v = Math.floor(hash(bx, by, seed + 999) * (nVar || 8));
    const t = Math.floor(hash(bx, by, seed + 1999) * 8);
    const flip = FLIP_ONLY[type] ? (t & 1) : (t >> 2);
    const rot = FLIP_ONLY[type] ? 0 : (t & 3);
    let x = px, y = py;
    if (flip) x = S - 1 - x;
    for (let i = 0; i < rot; i++) { const nx = S - 1 - y; y = x; x = nx; }
    return pixel(type, x, y, seed + v * 977, true);
  }

  // dibuja un bloque en un buffer RGBA (Uint8ClampedArray) con alpha-blend
  function renderInto(buf, W, ox, oy, type, bx, by, seed, mode) {
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const c = mode === 'world'    ? pixel(type, bx * S + px, by * S + py, seed, false)
                : mode === 'variants' ? variantPixel(type, px, py, bx, by, seed)
                :                       pixel(type, px, py, seed, true);
        const i = ((oy + py) * W + ox + px) * 4, a = c[3] / 255;
        if (a >= 1) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; }
        else if (a > 0) {
          buf[i] = c[0] * a + buf[i] * (1 - a);
          buf[i + 1] = c[1] * a + buf[i + 1] * (1 - a);
          buf[i + 2] = c[2] * a + buf[i + 2] * (1 - a);
          buf[i + 3] = 255;
        }
      }
    }
  }

  const api = { S, TYPES, hash, vnoise, fbm, pixel, variantPixel, renderInto };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProcBlocks = api;
})(typeof self !== 'undefined' ? self : this);
