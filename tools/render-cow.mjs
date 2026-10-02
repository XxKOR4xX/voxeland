// Rasteriza la vaca en CPU con exactamente el mismo pipeline que identidades.js
// (skinning -> uModel -> uView -> proyeccion -> FS con vShadow y niebla) para
// poder mirar la imagen y separar "el math esta mal" de "el estado de GL esta mal".
// Run: node tools/render-cow.mjs   -> tools/_cow.png
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import zlib from "node:zlib"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
globalThis.window = globalThis
;(0, eval)(readFileSync(join(root, "glb.js"), "utf8"))

const W = 640, H = 360
const fichaCOW = await window.VXLGLB.preparar(
	readFileSync(join(root, "models", "LOW-POLY", "COW.glb")))
const m = window.VXLGLB.parsear(fichaCOW)
const ficha = { escala: 0.36, yawOffset: 0, anims: { idle: "Cow|Cow_Idle", walk: "Cow|Cow_Walk" } }

// ------------------------------------------------------------- matrices ----
const scratch = new Float32Array(16)
function mul4(out, a, b) {
	for (let c = 0; c < 4; c++) {
		const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3]
		for (let r = 0; r < 4; r++) {
			scratch[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3
		}
	}
	out.set(scratch)
}
function rotY(out, ang) {
	const c = Math.cos(ang), s = Math.sin(ang)
	out.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
}
function traslacion(out, x, y, z) {
	out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
}
const identidad = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

// iguales que en identidades.js: uModel = T(x, pies, z) * (rotY * baseModelo)
const b = m.bounds
const cx = (b.min[0] + b.max[0]) / 2
const cz = (b.min[2] + b.max[2]) / 2
const s = ficha.escala
const baseModelo = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -s * cx, 0, -s * cz, 1]

function matrizEntidad(x, y, z, encab) {
	const tmpA = new Float32Array(16), tmpB = new Float32Array(16)
	const out = new Float32Array(16)
	rotY(tmpB, -(encab + ficha.yawOffset))
	mul4(tmpA, tmpB, baseModelo)
	traslacion(tmpB, x, y, z)
	mul4(out, tmpB, tmpA)
	return out
}

// camara perspectiva estandar (fove 70) mirando al buey
function lookAt(eye, target, up) {
	const n = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] }
	const sub = (a, b2) => [a[0] - b2[0], a[1] - b2[1], a[2] - b2[2]]
	const crs = (a, b2) => [a[1] * b2[2] - a[2] * b2[1], a[2] * b2[0] - a[0] * b2[2], a[0] * b2[1] - a[1] * b2[0]]
	const dts = (a, b2) => a[0] * b2[0] + a[1] * b2[1] + a[2] * b2[2]
	const z = n(sub(eye, target)), x = n(crs(up, z)), y = crs(z, x)
	return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
		-dts(x, eye), -dts(y, eye), -dts(z, eye), 1]
}
function proyeccion(fovDeg, aspect, near, far) {
	const f = 1 / Math.tan(fovDeg * Math.PI / 360)
	return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1,
		0, 0, 2 * far * near / (near - far), 0]
}
function mulPV(mv, p) { const out = new Float32Array(16); mul4(out, p, mv); return out }

// ------------------------------------------------------------- esqueleto ----
const huesos = new Float32Array(m.numHuesos * 16)
window.VXLGLB.calcularHuesos(m, m.clips["Cow|Cow_Walk"], 0.4, huesos)

// sk + uModel sobre cada vertice (mismo orden que VS_SKIN)
function transformar() {
	const P = m.malla.pos, N = m.malla.nor, J = m.malla.joints, Wt = m.malla.weights
	const uM = matrizEntidad(0, 0, 0, 0)
	const n = P.length / 3
	const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3)
	for (let v = 0; v < n; v++) {
		const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2]
		const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2]
		let x = 0, y = 0, z = 0, ax = 0, ay = 0, az = 0
		for (let k = 0; k < 4; k++) {
			const w = Wt[v * 4 + k]
			if (!w) continue
			const bo = J[v * 4 + k] * 16
			x += w * (huesos[bo] * px + huesos[bo + 4] * py + huesos[bo + 8] * pz + huesos[bo + 12])
			y += w * (huesos[bo + 1] * px + huesos[bo + 5] * py + huesos[bo + 9] * pz + huesos[bo + 13])
			z += w * (huesos[bo + 2] * px + huesos[bo + 6] * py + huesos[bo + 10] * pz + huesos[bo + 14])
			ax += w * (huesos[bo] * nx + huesos[bo + 4] * ny + huesos[bo + 8] * nz)
			ay += w * (huesos[bo + 1] * nx + huesos[bo + 5] * ny + huesos[bo + 9] * nz)
			az += w * (huesos[bo + 2] * nx + huesos[bo + 6] * ny + huesos[bo + 10] * nz)
		}
		// uModel * (x,y,z,1)
		pos[v * 3] = uM[0] * x + uM[4] * y + uM[8] * z + uM[12]
		pos[v * 3 + 1] = uM[1] * x + uM[5] * y + uM[9] * z + uM[13]
		pos[v * 3 + 2] = uM[2] * x + uM[6] * y + uM[10] * z + uM[14]
		// mat3(uModel) * n
		nor[v * 3] = uM[0] * ax + uM[4] * ay + uM[8] * az
		nor[v * 3 + 1] = uM[1] * ax + uM[5] * ay + uM[9] * az
		nor[v * 3 + 2] = uM[2] * ax + uM[6] * ay + uM[10] * az
	}
	return { pos, nor }
}

// ------------------------------------------------------------- raster ------
const L = (() => { const v = [0.42, 0.86, 0.28]; const l = Math.hypot(...v); return v.map(x => x / l) })()
// Constantes de sombreado(): hay que mantenerlas a mano con identidades.js.
const PASO = 1.0
const LUZ_ARRIBA = 1.0
const LUZ_ABAJO = 0.75
// El escalon por orientacion que usan los bloques (game.js getShadows).
function caraSombra(ux, uy, uz) {
	const ax = Math.abs(ux), ay = Math.abs(uy), az = Math.abs(uz)
	if (ay >= ax && ay >= az) return uy > 0 ? LUZ_ARRIBA : LUZ_ABAJO
	return az >= ax ? 0.95 : 0.80
}
const imagen = new Uint8Array(W * H * 4)
const zb = new Float32Array(W * H).fill(Infinity)
// vShadow por pixel del ultimo pase con sombreado (para las metricas)
const luzBuf = new Float32Array(W * H)
// media de vShadow del pase con sombreado: el pase "plano" la reutiliza para
// que las dos mitades tengan el mismo brillo medio y la unica diferencia sea
// el gradiente (si no, la mitad plana sale mas oscura y la compara mal).
let mediaSombra = 0.5

function px(x, y, r, g, bl) {
	const i = (y * W + x) * 4
	imagen[i] = r; imagen[i + 1] = g; imagen[i + 2] = bl; imagen[i + 3] = 255
}

function rasterizar(pos, nor, uv, ao, idx, vp, cullBack, forzarPlano) {
	let suma = 0, cuenta = 0
	for (let i = 0; i < idx.length; i += 3) {
		const vi = [idx[i], idx[i + 1], idx[i + 2]]
		const clip = [], scr = [], ndcZ = []
		let fuera = false
		for (const v of vi) {
			const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2]
			const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]
			if (cw <= 0) { fuera = true; break }
			const c = [
				(vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw,
				(vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw,
				(vp[2] * x + vp[6] * y + vp[10] * z + vp[14]) / cw, cw]
			clip.push(c)
			scr.push([(c[0] + 1) * 0.5 * W, (1 - (c[1] + 1) * 0.5) * H])
			ndcZ.push((c[2] + 1) * 0.5)
		}
		if (fuera) continue
		// winding en pantalla
		const area = (scr[1][0] - scr[0][0]) * (scr[2][1] - scr[0][1]) -
			(scr[2][0] - scr[0][0]) * (scr[1][1] - scr[0][1])
		if (Math.abs(area) < 1e-9) continue
		// CCW en pantalla = area < 0 con y hacia abajo
		if (cullBack && area > 0) continue
		const minX = Math.max(0, Math.floor(Math.min(scr[0][0], scr[1][0], scr[2][0])))
		const maxX = Math.min(W - 1, Math.ceil(Math.max(scr[0][0], scr[1][0], scr[2][0])))
		const minY = Math.max(0, Math.floor(Math.min(scr[0][1], scr[1][1], scr[2][1])))
		const maxY = Math.min(H - 1, Math.ceil(Math.max(scr[0][1], scr[1][1], scr[2][1])))
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const px0 = x + 0.5, py0 = y + 0.5
				const w0 = ((scr[1][0] - px0) * (scr[2][1] - py0) - (scr[2][0] - px0) * (scr[1][1] - py0)) / area
				const w1 = ((scr[2][0] - px0) * (scr[0][1] - py0) - (scr[0][0] - px0) * (scr[2][1] - py0)) / area
				const w2 = 1 - w0 - w1
				if (w0 < 0 || w1 < 0 || w2 < 0) continue
				const z = w0 * ndcZ[0] + w1 * ndcZ[1] + w2 * ndcZ[2]
				const k = y * W + x
				if (z >= zb[k]) continue
				// interpolacion perspectiva de uv
				const iw = w0 / clip[0][3] + w1 / clip[1][3] + w2 / clip[2][3]
				const u = (w0 * uv[vi[0] * 2] / clip[0][3] + w1 * uv[vi[1] * 2] / clip[1][3] + w2 * uv[vi[2] * 2] / clip[2][3]) / iw
				const v = (w0 * uv[vi[0] * 2 + 1] / clip[0][3] + w1 * uv[vi[1] * 2 + 1] / clip[1][3] + w2 * uv[vi[2] * 2 + 1] / clip[2][3]) / iw
				let nx = w0 * nor[vi[0] * 3] + w1 * nor[vi[1] * 3] + w2 * nor[vi[2] * 3]
				let ny = w0 * nor[vi[0] * 3 + 1] + w1 * nor[vi[1] * 3 + 1] + w2 * nor[vi[2] * 3 + 1]
				let nz = w0 * nor[vi[0] * 3 + 2] + w1 * nor[vi[1] * 3 + 2] + w2 * nor[vi[2] * 3 + 2]
				const aov = w0 * ao[vi[0]] + w1 * ao[vi[1]] + w2 * ao[vi[2]]
				let vShadow
				if (forzarPlano) vShadow = mediaSombra
				else {
					const l = Math.hypot(nx, ny, nz)
					const ux = l > 0 ? nx / l : 0, uy = l > 0 ? ny / l : 0, uz = l > 0 ? nz / l : 0
					// igual que sombreado() en identidades.js: half-lambert +
					// hemisferio, mezclado con el escalon por cara del motor y
					// multiplicado por el aAO horneado en glb.js.
					const hl = ux * L[0] + uy * L[1] + uz * L[2]
					const suave = 0.18 + 0.50 * (hl * 0.5 + 0.5) + 0.32 * (uy * 0.5 + 0.5)
					const cara = caraSombra(ux, uy, uz)
					vShadow = suave * (1 + (cara - 1) * PASO) * aov
					suma += vShadow
					cuenta++
				}
				const ti = ((Math.round(u * 255) & 255) + (Math.round(v * 255) & 255) * 256) * 4
				zb[k] = z
				luzBuf[k] = vShadow
				px(x, y,
					Math.min(255, tex[ti] * vShadow),
					Math.min(255, tex[ti + 1] * vShadow),
					Math.min(255, tex[ti + 2] * vShadow))
			}
		}
	}
	if (cuenta) mediaSombra = suma / cuenta
}

const tex = Buffer.from(fichaCOW.rgba)

// ------------------------------------------------------------- escena ------
function render(nombre, forzarPlano, camara) {
	imagen.fill(0); zb.fill(Infinity); luzBuf.fill(0)
	for (let i = 0; i < imagen.length; i += 4) {
		imagen[i] = 40; imagen[i + 1] = 60; imagen[i + 2] = 90; imagen[i + 3] = 255
	}
	const { pos, nor } = transformar()
	// la vaca mira hacia +Z; camara al frente-elevada
	const eye = camara ? camara.eye : [1.15, 0.8, 1.7]
	const target = camara ? camara.target : [0, 0.6, 0]
	const view = lookAt(eye, target, [0, 1, 0])
	const proj = proyeccion(70, W / H, 0.1, 100)
	const vp = new Float32Array(16)
	mul4(vp, proj, view)
	rasterizar(pos, nor, m.malla.uv, m.malla.ao, m.malla.indices, vp, true, forzarPlano)
	if (nombre) writeFileSync(join(root, "tools", nombre), png(W, H, imagen))
	if (nombre) console.log(nombre + " escrito")
}

// ------------------------------------------------------------- png ---------
const CRC = (() => {
	const t = new Int32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		t[n] = c
	}
	return t
})()
function crc32(buf) {
	let c = 0xffffffff
	for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}
function chunk(tipo, data) {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
	const td = Buffer.concat([Buffer.from(tipo, "ascii"), data])
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
	return Buffer.concat([len, td, crc])
}
function png(w, h, rgba) {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
	const filas = Buffer.alloc(h * (w * 4 + 1))
	for (let y = 0; y < h; y++) {
		filas[y * (w * 4 + 1)] = 0
		for (let i = 0; i < w * 4; i++) filas[y * (w * 4 + 1) + 1 + i] = rgba[y * w * 4 + i]
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(filas)),
		chunk("IEND", Buffer.alloc(0)),
	])
}

function capturar(archivo, plano) {
	render(archivo, plano)
	return Uint8Array.from(imagen)
}
const sombreado = capturar("_cow.png", false)
const plano = capturar("_cow_flat.png", true)

// side-by-side: izquierda con sombreado, derecha plano (misma escala)
{
	const W2 = W * 2
	const out = new Uint8Array(W2 * H * 4)
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const i = (y * W + x) * 4
		out.set(sombreado.subarray(i, i + 4), (y * W2 + x) * 4)
		out.set(plano.subarray(i, i + 4), (y * W2 + W + x) * 4)
	}
	writeFileSync(join(root, "tools", "_cow_cmp.png"), png(W2, H, out))
	console.log("_cow_cmp.png escrito")
}

// ----------------------------------------------------------- metricas ------
// Regresion de "la vaca se ve plana": el tono se apilaba en la banda alta y
// seguia al angulo de camara en vez de a la forma.
//   sigma   -> desviacion tipica del vShadow visible; mas = mas relieve.
//   >=0.70  -> fraccion de la superficie en la banda plana de arriba.
const CAMARAS = [
	["cenital",     [0.6, 3.4, 1.2], [0, 1.4, 0]],
	["3/4 frontal", [1.6, 1.4, 2.2], [0, 1.2, 0]],
	["frontal",     [0.2, 1.3, 3.0], [0, 1.2, 0]],
	["lateral",     [3.0, 1.3, 0.2], [0, 1.2, 0]],
	["3/4 trasera", [-1.7, 1.5, -2.2], [0, 1.2, 0]],
	["lateral c/c", [1.6, 1.1, 0.1], [0, 1.1, 0]],
]
console.log("metricas de vShadow por camara:")
const todo = []
for (const [nombre, eye, target] of CAMARAS) {
	render(null, false, { eye, target })
	const v = []
	for (let i = 0; i < luzBuf.length; i++) if (luzBuf[i] > 0) v.push(luzBuf[i])
	if (!v.length) { console.log("  " + nombre + ": sin pixeles visibles"); continue }
	todo.push(...v)
	const media = v.reduce((a, b) => a + b, 0) / v.length
	const sigma = Math.sqrt(v.reduce((a, b) => a + (b - media) * (b - media), 0) / v.length)
	const alta = v.filter(x => x >= 0.7).length / v.length
	const baja = v.filter(x => x < 0.2).length / v.length
	console.log("  " + nombre.padEnd(12) + " min " + Math.min(...v).toFixed(3) +
		" max " + Math.max(...v).toFixed(3) + " media " + media.toFixed(3) +
		" sigma " + sigma.toFixed(3) + "  >=0.70 " + (alta * 100).toFixed(0) + "%" +
		"  <0.20 " + (baja * 100).toFixed(1) + "%")
}
if (todo.length) {
	const gm = todo.reduce((a, b) => a + b, 0) / todo.length
	const gs = Math.sqrt(todo.reduce((a, b) => a + (b - gm) * (b - gm), 0) / todo.length)
	console.log("  conjunto     media " + gm.toFixed(3) + " sigma " + gs.toFixed(3) +
		"  >=0.70 " + (todo.filter(x => x >= 0.7).length / todo.length * 100).toFixed(0) + "%" +
		"  <0.20 " + (todo.filter(x => x < 0.2).length / todo.length * 100).toFixed(1) + "%")
}

// primer plano lateral, para mirar el resultado de cerca
render(null, false, { eye: [1.6, 1.1, 0.1], target: [0, 1.1, 0] })
writeFileSync(join(root, "tools", "_cow_lateral.png"), png(W, H, imagen))
console.log("_cow_lateral.png escrito")
