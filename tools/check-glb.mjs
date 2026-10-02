// Comprobaciones del parser glb.js sin navegador.  Run: node tools/check-glb.mjs
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
globalThis.window = globalThis

const src = readFileSync(join(root, "glb.js"), "utf8")
;(0, eval)(src)

const glbCOW = readFileSync(join(root, "models", "LOW-POLY", "COW.glb"))

let fails = 0
const ok = (cond, msg) => {
	console.log((cond ? "  OK   " : "  FALLO") + " " + msg)
	if (!cond) fails++
}
const num = n => Number(n).toFixed(3)

const ficha = await window.VXLGLB.preparar(glbCOW)
const m = window.VXLGLB.parsear(ficha)

// --- 0. la fuente es el .glb crudo (sin packglb ni base64) ---------------
ok(ficha.w === 256 && ficha.h === 256, "textura 256x256 leida del PNG del glb")
ok(ficha.rgba instanceof Uint8Array && ficha.rgba.length === 256 * 256 * 4,
	"RGBA en crudo completo (" + ficha.rgba.length + " B)")
ok(typeof ficha.json === "object" && ficha.json !== null,
	"json ya parseado (objeto, no base64)")
ok(ficha.bin instanceof Uint8Array && ficha.bin.length > 0,
	"bin en crudo (" + ficha.bin.length + " B)")
ok(ficha.json.meshes.length === 1 && ficha.json.meshes[0].primitives.length === 1,
	"preflight: 1 malla x 1 primitiva")
ok(ficha.json.images.length === 1 && !ficha.json.images[0].uri,
	"preflight: 1 textura embebida (sin uri)")
let noPNG = null
try { await window.VXLGLB.preparar(glbCOW.subarray(0, 40)) } catch (e) { noPNG = e.message }
ok(noPNG !== null, "preparar rechaza un glb truncado (" + noPNG + ")")

// --- 1. recuentos basicos -------------------------------------------------
ok(m.malla.pos.length / 3 === 1456, "1456 vertices (hay " + m.malla.pos.length / 3 + ")")
ok(m.malla.indices.length === 2100, "2100 indices (hay " + m.malla.indices.length + ")")
ok(m.malla.nor.length === 1456 * 3, "normales presentes")
ok(m.malla.uv.length === 1456 * 2, "uv presentes")
ok(m.malla.joints.length === 1456 * 4, "joints presentes")
ok(m.malla.weights.length === 1456 * 4, "weights presentes")
ok(m.numHuesos === 49, "49 huesos (hay " + m.numHuesos + ")")
ok(m.ibm.length === 49 * 16, "49 inverse bind matrices")
ok(Object.keys(m.clips).length === 13, "13 clips (hay " + Object.keys(m.clips).length + ")")
ok(m.nodos.length === 51, "51 nodos (hay " + m.nodos.length + ")")
ok(m.raices.length === 1, "1 raiz de escena")

// --- 2. jerarquia: todos los nodos alcanzables ----------------------------
const vistos = new Set()
const baja = i => { vistos.add(i); for (const h of m.nodos[i].hijos) baja(h) }
for (const r of m.raices) baja(r)
ok(vistos.size === m.nodos.length, "jerarquia completa: " + vistos.size + "/" + m.nodos.length + " nodos alcanzables")
const huesosHuerfanos = m.huesos.filter(h => !vistos.has(h))
ok(!huesosHuerfanos.length, "todos los 49 huesos alcanzables desde la raiz" +
	(huesosHuerfanos.length ? " (faltan " + huesosHuerfanos.join(",") + ")" : ""))

// --- 3. pesos e indices de skinning --------------------------------------
let sumaMala = 0, indiceMala = 0
for (let v = 0; v < 1456; v++) {
	let s = 0
	for (let k = 0; k < 4; k++) {
		s += m.malla.weights[v * 4 + k]
		if (m.malla.joints[v * 4 + k] >= m.numHuesos) indiceMala++
	}
	if (Math.abs(s - 1) > 1e-4) sumaMala++
}
ok(sumaMala === 0, "los pesos suman 1.0 en todos los vertices (" + sumaMala + " malos)")
ok(indiceMala === 0, "todos los indices de hueso < " + m.numHuesos)

// --- 4. pose de reposo: el esqueleto debe reproducir el modelo ------------
const out = new Float32Array(m.numHuesos * 16)
window.VXLGLB.calcularHuesos(m, null, 0, out)
ok(Array.from(out).every(Number.isFinite), "matrices de hueso finitas en pose de reposo")

const min = [Infinity, Infinity, Infinity]
const max = [-Infinity, -Infinity, -Infinity]
const p = m.malla.pos
const idx = m.malla.indices
for (let i = 0; i < idx.length; i++) {
	const vi = idx[i] * 3
	let x = 0, y = 0, z = 0
	for (let k = 0; k < 4; k++) {
		const w = m.malla.weights[idx[i] * 4 + k]
		if (!w) continue
		const b = m.malla.joints[idx[i] * 4 + k] * 16
		const px = p[vi], py = p[vi + 1], pz = p[vi + 2]
		x += w * (out[b] * px + out[b + 4] * py + out[b + 8] * pz + out[b + 12])
		y += w * (out[b + 1] * px + out[b + 5] * py + out[b + 9] * pz + out[b + 13])
		z += w * (out[b + 2] * px + out[b + 6] * py + out[b + 10] * pz + out[b + 14])
	}
	for (let a = 0; a < 3; a++) {
		min[a] = Math.min(min[a], [x, y, z][a])
		max[a] = Math.max(max[a], [x, y, z][a])
	}
}
const b = m.bounds
console.log("        declarados min(" + b.min.map(num) + ") max(" + b.max.map(num) + ")")
console.log("        esqueleto  min(" + min.map(num) + ") max(" + max.map(num) + ")")
const desv = Math.max(
	...[0, 1, 2].map(i => Math.abs(min[i] - b.min[i])),
	...[0, 1, 2].map(i => Math.abs(max[i] - b.max[i]))
)
ok(desv < 0.01, "la pose de reposo reproduce los limites del modelo (desviacion " + num(desv) + ")")

// --- 5. clips ------------------------------------------------------------
let clipsMalos = 0
let nodosAnimMalos = 0
for (const nombre of Object.keys(m.clips)) {
	const c = m.clips[nombre]
	if (!(c.dur > 0)) clipsMalos++
	if (Object.keys(c.porNodo).length !== 50) nodosAnimMalos++
	const matrices = new Float32Array(m.numHuesos * 16)
	for (const t of [0, c.dur * 0.33, c.dur * 0.66, Math.max(0, c.dur - 0.001)]) {
		window.VXLGLB.calcularHuesos(m, c, t, matrices)
		for (let i = 0; i < matrices.length; i++) if (!Number.isFinite(matrices[i])) clipsMalos++
	}
}
ok(clipsMalos === 0, "los 13 clips generan matrices finitas y duran > 0")
ok(nodosAnimMalos === 0, "los 13 clips animan los 50 nodos")
console.log("        clips: " + Object.keys(m.clips).map(n => n.replace("Cow|", "")).join(", "))

// --- 6. rango de movimiento entre poses ----------------------------------
const distinto = (cA, cB) => {
	const a = new Float32Array(m.numHuesos * 16)
	const dA = new Float32Array(m.numHuesos * 16)
	const dB = new Float32Array(m.numHuesos * 16)
	window.VXLGLB.calcularHuesos(m, m.clips[cA], 0, dA)
	window.VXLGLB.calcularHuesos(m, m.clips[cB], 0, dB)
	let dif = 0
	for (let i = 0; i < a.length; i++) dif += Math.abs(dA[i] - dB[i])
	return dif
}
const idleVsWalk = distinto("Cow|Cow_Idle", "Cow|Cow_Walk")
const idleVsRun = distinto("Cow|Cow_Idle", "Cow|Cow_Run")
ok(idleVsWalk > 1, "Idle y Walk difieren (dist " + num(idleVsWalk) + ")")
ok(idleVsRun > 1, "Idle y Run difieren (dist " + num(idleVsRun) + ")")

// --- 7. los clips no pueden disparar la malla ------------------------------
// Regresion: T y S compartian el mismo array scratch en calcularHuesos, asi
// que la traslacion de cada nodo animado leia la escala (1,1,1) en vez de su
// offset real.  Acumulada por 40 nodos anidados, la vaca salia hecha un asco.
const limitesClip = (c, t) => {
	const mat = new Float32Array(m.numHuesos * 16)
	window.VXLGLB.calcularHuesos(m, c, t, mat)
	const mn = [Infinity, Infinity, Infinity]
	const mx = [-Infinity, -Infinity, -Infinity]
	const pos = m.malla.pos
	for (let i = 0; i < pos.length / 3; i++) {
		let x = 0, y = 0, z = 0
		for (let k = 0; k < 4; k++) {
			const w = m.malla.weights[i * 4 + k]
			if (!w) continue
			const b = m.malla.joints[i * 4 + k] * 16
			const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2]
			x += w * (mat[b] * px + mat[b + 4] * py + mat[b + 8] * pz + mat[b + 12])
			y += w * (mat[b + 1] * px + mat[b + 5] * py + mat[b + 9] * pz + mat[b + 13])
			z += w * (mat[b + 2] * px + mat[b + 6] * py + mat[b + 10] * pz + mat[b + 14])
		}
		mn[0] = Math.min(mn[0], x); mn[1] = Math.min(mn[1], y); mn[2] = Math.min(mn[2], z)
		mx[0] = Math.max(mx[0], x); mx[1] = Math.max(mx[1], y); mx[2] = Math.max(mx[2], z)
	}
	return { mn, mx }
}

let peorClip = 0, peorClipNombre = "", peorClipT = 0
for (const nombre of Object.keys(m.clips)) {
	const c = m.clips[nombre]
	for (let i = 0; i <= 8; i++) {
		const t = c.dur * i / 8
		const L = limitesClip(c, t)
		for (let a = 0; a < 3; a++) {
			const d = Math.max(Math.abs(L.mn[a] - min[a]), Math.abs(L.mx[a] - max[a]))
			if (d > peorClip) {
				peorClip = d
				peorClipNombre = nombre
				peorClipT = t
			}
		}
	}
}
ok(peorClip < 8, "ningun clip dispara la malla fuera del entorno del modelo " +
	"(peor " + num(peorClip) + " en " + peorClipNombre.replace("Cow|", "") +
	" t=" + num(peorClipT) + ", tope 8)")

// --- 9. el skin respeta el orden glTF: global * ibm -------------------------
// Regresion: calcularHuesos hacia ibm * global.  En reposo da igual (las dos
// dan identidad), pero al animar cada hueso giraba alrededor del origen del
// modelo en vez de alrededor de su propio pivote: la vaca se hundia y las
// patas salian de sitio aunque el shader y los pesos fueran correctos.
const mulM = (a, b) => {
	const t = new Float32Array(16)
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++)
			t[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
				a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
	return t
}
const matSkin = new Float32Array(m.numHuesos * 16)
window.VXLGLB.calcularHuesos(m, null, 0, matSkin) // m.global queda en reposo
const bindG = new Float32Array(m.global)
let peorOrden = 0, peorOrigen = 0
for (const nombre of Object.keys(m.clips)) {
	const c = m.clips[nombre]
	for (let i = 0; i <= 4; i++) {
		window.VXLGLB.calcularHuesos(m, c, c.dur * i / 4, matSkin)
		for (let j = 0; j < m.numHuesos; j++) {
			const ibm = m.ibm.subarray(j * 16, j * 16 + 16)
			const nodo = m.huesos[j] * 16
			const anim = m.global.subarray(nodo, nodo + 16)
			const esperado = mulM(anim, ibm)
			const cod = matSkin.subarray(j * 16, j * 16 + 16)
			for (let k = 0; k < 16; k++) {
				peorOrden = Math.max(peorOrden, Math.abs(cod[k] - esperado[k]))
			}
			// fisica del skinning: el origen de reposo del hueso tiene que
			// acabar en la posicion animada del mismo hueso
			const piel = mulM(cod, bindG.subarray(nodo, nodo + 16))
			for (let k = 0; k < 3; k++) {
				peorOrigen = Math.max(peorOrigen, Math.abs(piel[12 + k] - anim[12 + k]))
			}
		}
	}
}
ok(peorOrden < 1e-3, "el skin sigue el orden glTF global * ibm en los 13 clips (peor " +
	num(peorOrden) + ")")
ok(peorOrigen < 1e-3, "el origen de reposo de cada hueso llega a su posicion animada (peor " +
	num(peorOrigen) + ")")

// --- 10. los cascos no se hunden bajo el suelo ------------------------------
// El mismo bug del orden se veia asi en el juego: en Walk los cascos bajaban
// a y=-1.26 (la vaca se clavaba en el suelo).  Medido tras el arreglo:
// Walk -0.070, Run -0.057, Idle -0.010 -> tope laxo en -0.35.
let peorSuelo = 0, peorSueloClip = ""
for (const nombre of ["Cow|Cow_Walk", "Cow|Cow_Run", "Cow|Cow_Idle"]) {
	const c = m.clips[nombre]
	for (let i = 0; i <= 12; i++) {
		const L = limitesClip(c, c.dur * i / 12)
		if (L.mn[1] < peorSuelo) {
			peorSuelo = L.mn[1]
			peorSueloClip = nombre.replace("Cow|", "")
		}
	}
}
ok(peorSuelo >= -0.35, "en Walk/Run/Idle los cascos tocan el suelo sin hundirse (peor " +
	num(peorSuelo) + " en " + (peorSueloClip || "sin hundimiento") + ", tope -0.35)")

// --- 8. oclusion horneada (aAO) -------------------------------------------
// Sin aAO la vaca no se oscurece donde el cuerpo se toca a si misma (cuello,
// entrepiernas, bajo la barriga) y se ve plana al lado de los bloques, que
// si tienen AO por vecinos (game.js:4622 getShadows).
const ao = m.malla.ao
ok(ao && ao.length === 1456, "1456 valores de aAO (hay " + (ao ? ao.length : 0) + ")")
if (ao && ao.length === 1456) {
	const la = Array.from(ao)
	ok(la.every(x => Number.isFinite(x) && x >= 0.35 - 1e-6 && x <= 1 + 1e-6),
		"los valores son finitos y estan acotados a [0.35, 1.0]")
	const mediaAo = la.reduce((a, b) => a + b, 0) / la.length
	const minAo = Math.min(...la), maxAo = Math.max(...la)
	ok(maxAo - minAo >= 0.5, "hay oclusion real (rango " + num(maxAo - minAo) +
		", minimo 0.5)")
	ok(mediaAo > 0.85 && mediaAo <= 1, "la media no ensucia la malla (" +
		num(mediaAo) + ", esperado > 0.85)")
	let lomo = 0
	for (let i = 1; i < 1456; i++) if (p[i * 3 + 1] > p[lomo * 3 + 1]) lomo = i
	ok(la[lomo] > mediaAo, "el lomo (y maximo) esta por encima de la media (" +
		num(la[lomo]) + " > " + num(mediaAo) + ")")
}

console.log(fails ? "\n" + fails + " FALLOS" : "\ntodo OK")
process.exit(fails ? 1 : 0)
