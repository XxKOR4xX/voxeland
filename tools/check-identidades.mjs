// Prueba de humo de identidades.js sin navegador: fija un mundo plano con
// agua en una esquina, arranca el sistema con un gl simulado y corre 20 s de
// update()/render().  Comprueba spawn, física, IA de paseo y la matriz uModel.
// Run: node tools/check-identidades.mjs
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
globalThis.window = globalThis

let fails = 0
const ok = (cond, msg) => {
	console.log((cond ? "  OK   " : "  FALLO") + " " + msg)
	if (!cond) fails++
}
const num = n => Number(n).toFixed(3)

// ---------------------------------------------------------------- gl fake --
// El stub imita el linker real: getUniformLocation/getAttribLocation solo
// devuelven algo si el nombre esta declarado como attribute/uniform en los
// shaders realmente adjuntos al programa.  Asi una clave mal escrita (p. ej.
// loc.u.tex en vez de loc.u.uTex) se detecta en vez de pasar en silencio.
let atributos = 0
const subidas = [] // { nombre, m } de uniformMatrix4fv
const uniforms = new Map() // nombre -> ultimo valor de uniform1i/uniform1f
const estados = [] // "disable"/"enable" (POLYGON_OFFSET_FILL), "disableCull"/"enableCull", "draw"
const violaciones = [] // "0x8892->0x8893": un buffer atado con dos targets distintos
const texturasEnlazadas = [] // textura pasada a gl.bindTexture, en orden
const drawArraysLlamadas = [] // [mode, first, count] de gl.drawArrays (sombra=4, marco=24)
let vinculoElement = null // ELEMENT_ARRAY_BUFFER actual (lo reporta getParameter)
const ARRAY_BUFFER = 0x8892
const ELEMENT_ARRAY_BUFFER = 0x8893
const ELEMENT_ARRAY_BUFFER_BINDING = 0x8895
const POLYGON_OFFSET_FILL = 0x8037
const CULL_FACE = 0x0b44
function declarado(prog, nombre) {
	const src = (prog && prog.shaders ? prog.shaders : [])
		.map(s => s.src || "").join("\n")
	return new RegExp("\\b(?:attribute|uniform)\\s+\\w+\\s+" + nombre + "\\b").test(src)
}
const gl = new Proxy({
	COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82, CURRENT_PROGRAM: 0x8b8d,
	ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER_BINDING,
	POLYGON_OFFSET_FILL,
	CULL_FACE,
	getShaderParameter: () => true,
	getProgramParameter: () => true,
	getShaderInfoLog: () => "",
	getProgramInfoLog: () => "",
	getAttribLocation: (prog, n) => (declarado(prog, n) ? atributos++ : -1),
	getUniformLocation: (prog, n) => (declarado(prog, n) ? { nombre: n } : null),
	getParameter: p => (p === 0x8b8d ? {} : p === ELEMENT_ARRAY_BUFFER_BINDING ? vinculoElement : 8),
	getExtension: () => ({}),
	createShader: () => ({}),
	createProgram: () => ({}),
	createBuffer: () => ({}),
	bindBuffer: (target, b) => {
		if (b && typeof b === "object") {
			if (b.__tgt === undefined) b.__tgt = target
			else if (b.__tgt !== target) {
				violaciones.push("0x" + b.__tgt.toString(16) + "->0x" + target.toString(16))
			}
		}
		if (target === ELEMENT_ARRAY_BUFFER) vinculoElement = (b && typeof b === "object") ? b : null
	},
	createTexture: () => ({}),
	bindTexture: (target, tex) => { texturasEnlazadas.push(tex) },
	shaderSource: (sh, src) => { sh.src = src },
	attachShader: (prog, sh) => { (prog.shaders || (prog.shaders = [])).push(sh) },
	uniformMatrix4fv: (loc, tr, m) => subidas.push({ nombre: loc && loc.nombre, m: Array.from(m) }),
	uniform1i: (loc, v) => { if (loc) uniforms.set(loc.nombre, v) },
	uniform1f: (loc, v) => { if (loc) uniforms.set(loc.nombre, v) },
	disable: c => {
		if (c === POLYGON_OFFSET_FILL) estados.push("disable")
		if (c === CULL_FACE) estados.push("disableCull")
	},
	enable: c => {
		if (c === POLYGON_OFFSET_FILL) estados.push("enable")
		if (c === CULL_FACE) estados.push("enableCull")
	},
	drawElements: () => estados.push("draw"),
	drawArrays: (mode, first, count) => drawArraysLlamadas.push([mode, first, count]),
}, {
	get(t, k) {
		if (typeof k === "symbol") return undefined
		if (Object.prototype.hasOwnProperty.call(t, k)) return t[k]
		if (/^[A-Z][A-Z0-9_]*$/.test(k)) return 0x1000
		return () => undefined
	},
})

// ---------------------------------------------------------------- mundo ----
const SUELO = 49            // bloque alto de la llanura -> superficie 49.5
const AGUA_DESDE = 46
const AGUA_HASTA = 49
const esAgua = (x, z) => x >= 40 && x < 80 && z >= 40 && z < 80
const bloqueSuelo = (x, z) => (esAgua(x, z) ? 45 : SUELO)

const BLOCK = 1             // hierba solida
const AGUA = 9
// gramilla que el test puede colocar en cualquier parte (ver setBlock)
const HIERBA_ALTA_B = 10    // tallGrassBottom
const HIERBA_ALTA_T = 11    // tallGrassTop
const HIERBA_PLANA = 12     // grassPlant
const colocados = new Map() // "x,y,z" -> bloque
const clave = (x, y, z) => x + "," + y + "," + z
function getBlock(x, y, z) {
	const c = colocados.get(clave(x, y, z))
	if (c !== undefined) return c
	const suelo = bloqueSuelo(x, z)
	if (esAgua(x, z) && y >= AGUA_DESDE && y <= AGUA_HASTA) return AGUA
	return y <= suelo ? BLOCK : 0
}

const cacheChunks = new Map()
function chunkDe(cx, cz) {
	const k = cx + "," + cz
	let ch = cacheChunks.get(k)
	if (!ch) {
		const tops = new Uint8Array(256)
		for (let lz = 0; lz < 16; lz++) {
			for (let lx = 0; lx < 16; lx++) {
				const ax = (cx << 4) + lx, az = (cz << 4) + lz
				tops[lz * 16 + lx] = bloqueSuelo(ax, az)
			}
		}
		ch = { buffer: true, tops }
		cacheChunks.set(k, ch)
	}
	return ch
}

// collided() del motor, simplificado a cajas: todo se compara en coordenadas
// de bloque (cara en local [-0.5, 0.5]) y un contacto exacto --sin
// penetracion-- no cuenta, igual que en game.js.  Se reimplementa aqui porque
// game.js no se puede evaluar entero.
function collided(e, x, y, z, vx, vy, vz, block) {
	if (!block) return false
	// igual que el motor (game.js:3209): agua y plantas son pasables
	const id = block & 0xff
	if (id === AGUA || id === HIERBA_ALTA_B || id === HIERBA_ALTA_T || id === HIERBA_PLANA) return false
	const minX = x - 0.5, maxX = x + 0.5
	const minY = y - 0.5, maxY = y + 0.5
	const minZ = z - 0.5, maxZ = z + 0.5
	const px = e.x - e.w, pxx = e.x + e.w
	const py = e.y - e.bottomH, pyy = e.y + e.topH
	const pz = e.z - e.w, pzz = e.z + e.w
	if (pxx <= minX || px >= maxX) return false
	if (pyy <= minY || py >= maxY) return false
	if (pzz <= minZ || pz >= maxZ) return false
	if (vy) {
		if (vy <= 0) {
			// Tope identico al motor (game.js: collided): una cara a mas
			// de 0,6 sobre los pies NO teletransporta (subir escalones es
			// <= 0,5); sin esto la vaca que salta junto a un arbol acaba
			// en la copa.  La excepcion de los pies previos cubre el
			// aterrizaje rapido: si los pies estaban ya por encima de la
			// cara, la caida la ha cruzado en un frame y hay que dejarla
			// aterrizar (si no, caeria a traves del suelo).
			if (maxY - py > 0.6 && e.previousY - e.bottomH < maxY) return false
			e.onGround = true
			e.y = maxY + e.bottomH
			return false
		}
		return true
	}
	// igual que game.js:3302: si la cara superior del bloque sube mas de
	// 0,5 sobre los pies, el bloque COMPLETO no es escalable andando y se
	// anula el canStep del eje golpeado (sin esto el mock subia escalones
	// de 1 caminando y el juego real no)
	if (maxY - py > 0.5) {
		if (vx) e.canStepX = false
		if (vz) e.canStepZ = false
	}
	return !!vx || !!vz
}

const identidad = new Float32Array(16)
identidad[0] = identidad[5] = identidad[10] = identidad[15] = 1

const p = {
	x: 0, y: 52, z: 0,
	w: 3 / 8, bottomH: 1.62, topH: 0.18,
	spectator: false, onGround: false,
	canSee: () => true,
	transform() {},
	getMatrix: () => Float32Array.from(identidad),
	direction: { x: 0, y: 0, z: 1 },   // mirando a +Z: spawnFrente()
}

const setBlockLlamadas = [] // "x,y,z=bloque" por cada world.setBlock
const world = {
	getBlock,
	setBlock(x, y, z, b) {
		colocados.set(clave(x, y, z), b)
		setBlockLlamadas.push(clave(x, y, z) + "=" + b)
		// tops del chunk: buscarGrama/buscarAgua leen el suelo REAL de la
		// columna, asi que hay que subirlo al poner un bloque solido y
		// recomputarlo (mirando hacia abajo) al quitarselo.  Sin esto el
		// mock tiene la llanura plana en 49 y nada de lo colocado arriba
		// lo ve nunca el pastoreo.
		const ch = chunkDe(x >> 4, z >> 4)
		const idx = (z & 15) * 16 + (x & 15)
		if (b === BLOCK && y > ch.tops[idx]) {
			ch.tops[idx] = y
		} else if (b === 0 && ch.tops[idx] === y) {
			for (let yy = y - 1; yy >= 0; yy--) {
				if (getBlock(x, yy, z) === BLOCK) {
					ch.tops[idx] = yy
					break
				}
			}
		}
	},
	chunks: new Proxy({}, {
		get: (t, cx) => new Proxy({}, { get: (t2, cz) => chunkDe(+cx, +cz) }),
	}),
}

window.VXL = {
	get p() { return p },
	get world() { return world },
	get fogDist() { return 100 },
	get blockIds() {
		return { waterBlock: AGUA, tallGrassBottom: HIERBA_ALTA_B, tallGrassTop: HIERBA_ALTA_T, grassPlant: HIERBA_PLANA }
	},
	get blockData() { return [undefined, {}] },
	get indexBuffer() { return {} },
	collided,
	terrainHeight: () => SUELO,
	// posicional: <100 plains, 100 forest, 200 desert, 300 swamp, 400 beach
	biomeAt: (x) => (x >= 400 ? "beach" : x >= 300 ? "swamp" :
		x >= 200 ? "desert" : x >= 100 ? "forest" : "plains"),
	vista: () => Float32Array.from(identidad),
	restaurar3D: () => {},
}

// ---------------------------------------------------------------- carga ----
;(0, eval)(readFileSync(join(root, "glb.js"), "utf8"))
;(0, eval)(readFileSync(join(root, "identidades.js"), "utf8"))

// El .glb crudo y las skins bajan por fetch: en node lo servimos desde
// disco y registramos las llamadas para comprobar que init() pide el glb
// una sola vez, con la URL correcta, y despues las 4 skins de vaca.
const llamadasFetch = []
const glbCOW = readFileSync(join(root, "models", "LOW-POLY", "COW.glb"))
globalThis.fetch = async url => {
	llamadasFetch.push(String(url))
	return new Response(readFileSync(join(root, String(url))))
}

window.initIdentidades(gl)
for (let i = 0; i < 200 && !window.VXLIdentidades.estado().listo; i++) {
	await new Promise(r => setTimeout(r, 2))
}
const st0 = window.VXLIdentidades.estado()
ok(st0.listo === true, "init() termina listo tras el fetch del glb")
const pedidas = ["models/LOW-POLY/COW.glb", "png/skins/Cow1.png",
	"png/skins/Cow2.png", "png/skins/Cow3.png", "png/skins/Cow4.png"]
ok(llamadasFetch.length === pedidas.length
	&& pedidas.every((u, i) => llamadasFetch[i] === u),
	"init() pide el glb y luego las 4 skins (" + llamadasFetch.join(", ") + ")")

// copia propia del parseo para bounds/malla (el modelo de init() es interno)
const vacaCOW = window.VXLGLB.parsear(await window.VXLGLB.preparar(glbCOW))
ok(st0.cpuSkin === false, "usa skinning en GPU (cpuSkin=" + st0.cpuSkin + ")")
ok(gl.getUniformLocation({}, "noExiste") === null,
	"el stub rechaza uniforms que no estan declarados")
ok(uniforms.get("uTex") === 2,
	"init() fija uTex=2, la unidad de la textura del modelo (valor: " +
	uniforms.get("uTex") + ")")
ok(uniforms.get("uBones") === 3,
	"init() fija uBones=3, la unidad de la textura de huesos (valor: " +
	uniforms.get("uBones") + ")")
const numHuesos = uniforms.get("uHuesos")
ok(typeof numHuesos === "number" && numHuesos > 0,
	"init() fija uHuesos al numero de huesos (valor: " + numHuesos + ")")

// skins por bioma de spawn (el biomeAt del mock depende de x: ver arriba)
ok(Object.keys(st0.skins).length === 4,
	"carga las 4 skins de vaca (" + Object.keys(st0.skins).join(" ") + ")")
const sk = x => {
	const e = window.VXLIdentidades.spawn("vaca", x, 51, 10)
	const s = e ? e.skin : "(sin entidad)"
	window.VXLIdentidades.limpiar()
	return s
}
// plains trae dos skins en el array: piel() se queda con una al azar
// (se mockea Math.random para cubrir los dos indices sin azar)
const realRandom = Math.random
Math.random = () => 0.01           // indice 0 -> Cow1
const sA = sk(10)
Math.random = () => 0.99           // indice 1 -> Cow2
const sB = sk(10)
Math.random = realRandom
ok(sA === "Cow1" && sB === "Cow2",
	"plains elige al azar entre Cow1 y Cow2 (salio " + sA + " y " + sB + ")")
// forest tambien trae dos skins en el array (Cow3 y Cow4)
Math.random = () => 0.01           // indice 0 -> Cow3
const sC = sk(120)
Math.random = () => 0.99           // indice 1 -> Cow4
const sD = sk(120)
Math.random = realRandom
ok(sC === "Cow3" && sD === "Cow4",
	"forest elige al azar entre Cow3 y Cow4 (salio " + sC + " y " + sD + ")")
ok(sk(220) === "Cow2", "vaca nacida en desert lleva Cow2 (salio " + sk(220) + ")")
ok(sk(320) === "Cow1", "vaca nacida en swamp lleva Cow1 (salio " + sk(320) + ")")
ok(sk(420) === "Cow1", "bioma sin skin usa la por defecto (salio " + sk(420) + ")")

// 20 s a 33 ms por frame, con render incluido
const PASO = 33
let reloj = performance.now()
const realNow = performance.now
performance.now = () => reloj
reloj = 0
let renders = 0
let errorRender = null
for (let i = 0; i < 600; i++) {
	reloj += PASO
	try {
		window.updateIdentidades()
		window.renderIdentidades()
		renders++
	} catch (e) {
		errorRender = e
		break
	}
}
performance.now = realNow

ok(errorRender === null, "update()/render() no lanzan en 600 frames" +
	(errorRender ? " (se paro en el frame " + renders + ": " + errorRender + ")" : ""))
ok(renders === 600, "los 600 frames se pintaron")

const lista = window.VXLIdentidades.lista()
ok(lista.length >= 1, "ha spawneado al menos una vaca (hay " + lista.length + ")")

const finitos = lista.every(e => [e.x, e.y, e.z, e.vx, e.vy, e.vz, e.encab]
	.every(Number.isFinite))
ok(finitos, "todas las coordenadas son finitas")

const suelo = 49.5
const clavadas = lista.filter(e => Math.abs(e.y - e.bottomH - suelo) < 0.6)
ok(clavadas.length === lista.length, "todas descansan sobre la superficie " +
	suelo + " (" + clavadas.length + "/" + lista.length + ")")

const quietas = lista.filter(e => Math.abs(e.x) < 1e-6 && Math.abs(e.z) < 1e-6)
ok(quietas.length < lista.length, "al menos una ha paseado por su cuenta")

const enAgua = lista.filter(e => esAgua(Math.round(e.x), Math.round(e.z)))
ok(enAgua.length === 0, "ninguna ha spawneado en el lago (hay " + enAgua.length + ")")

// ---------------------------------------------------------------- uModel ---
// La ultima pasada de render deja subidas las matrices de todas las vacas.
subidas.length = 0
// Se borran las units para comprobar que render() las fija cada frame.
uniforms.delete("uTex")
uniforms.delete("uBones")
uniforms.delete("uHuesos")
try { window.renderIdentidades() } catch (e) { errorRender = e }
ok(errorRender === null, "render() final no lanza")
ok(uniforms.get("uTex") === 2 && uniforms.get("uBones") === 3,
	"render() fija uTex=2 y uBones=3 cada frame (uTex=" + uniforms.get("uTex") +
	", uBones=" + uniforms.get("uBones") + ")")

// El motor deja POLYGON_OFFSET_FILL(1,1) activo; con su near/far descomunales
// el offset supera la profundidad de la vaca y desordena su auto-occlusion.
const iOff = estados.lastIndexOf("disable")
const iOn = iOff < 0 ? -1 : estados.indexOf("enable", iOff)
const dibujadoEntre = iOff >= 0 && iOn > iOff && estados.slice(iOff + 1, iOn).includes("draw")
const nOff = estados.filter(s => s === "disable").length
const nOn = estados.filter(s => s === "enable").length
ok(dibujadoEntre && nOff === nOn && nOn > 0,
	"render() apaga POLYGON_OFFSET_FILL mientras dibuja y lo restaura (" +
	nOff + " disable / " + nOn + " enable, hay draw entre medias: " +
	dibujadoEntre + ")")

// El material del GLB declara doubleSided: el paso de vacas debe apagar
// tambien CULL_FACE y restaurarlo, si no el motor se come las caras traseras.
const iCull = estados.lastIndexOf("disableCull")
const iCullOn = iCull < 0 ? -1 : estados.indexOf("enableCull", iCull)
const dibujadoEntreCull = iCull >= 0 && iCullOn > iCull &&
	estados.slice(iCull + 1, iCullOn).includes("draw")
const nCullOff = estados.filter(s => s === "disableCull").length
const nCullOn = estados.filter(s => s === "enableCull").length
ok(dibujadoEntreCull && nCullOff === nCullOn && nCullOn > 0,
	"render() apaga CULL_FACE mientras dibuja y lo restaura (doubleSided) (" +
	nCullOff + " disable / " + nCullOn + " enable, hay draw entre medias: " +
	dibujadoEntreCull + ")")

// WebGL: un buffer no puede atarse a dos targets (ARRAY y ELEMENT).  El
// navegador lo avisa con INVALID_OPERATION "buffers can not be used with
// multiple targets" y el draw sale basura; aqui se modela la regla para
// que el error no dependa de tener un navegador delante.
ok(violaciones.length === 0,
	"ningun buffer se usa con dos targets (INVALID_OPERATION bindBuffer)" +
	(violaciones.length ?
		" (hay " + violaciones.length + ", primero " + violaciones[0] + ")" : ""))

const uModel = subidas.filter(s => s.nombre === "uModel").map(s => s.m)
ok(uModel.length === lista.length, "subio una uModel por vaca (" +
	uModel.length + "/" + lista.length + ")")

const ficha = window.IDENTIDADES.vaca
const bounds = vacaCOW.bounds
const cx = (bounds.min[0] + bounds.max[0]) / 2
const cz = (bounds.min[2] + bounds.max[2]) / 2
const escala = ficha.escala

// el ancla del modelo (cx, 0, cz) --lo que baseModelo centra en el origen--
// debe caer exactamente en (e.x, pies, e.z)
const conTraslacion = lista.filter((e, i) => {
	const m = uModel[i]
	if (!m) return false
	const pies = e.y - e.bottomH
	const ax = m[0] * cx + m[4] * 0 + m[8] * cz + m[12]
	const ay = m[1] * cx + m[5] * 0 + m[9] * cz + m[13]
	const az = m[2] * cx + m[6] * 0 + m[10] * cz + m[14]
	return Math.abs(ax - e.x) < 1e-3 && Math.abs(ay - pies) < 1e-3 &&
		Math.abs(az - e.z) < 1e-3
})
ok(conTraslacion.length === lista.length, "uModel ancla el modelo en (x, pies, z) (" +
	conTraslacion.length + "/" + lista.length + ")")

// el modelo debe apoyar en los pies y medir ~alto bloques
const apoyos = uModel.map(m => {
	const y0 = m[1] * cx + m[5] * bounds.min[1] + m[9] * cz + m[13]
	const y1 = m[1] * cx + m[5] * bounds.max[1] + m[9] * cz + m[13]
	return [y0, y1 - y0]
})
ok(apoyos.every(([y0]) => Math.abs(y0 - suelo) < 0.05),
	"los cascos tocan el suelo (desviacion " +
	num(Math.max(...apoyos.map(([y0]) => Math.abs(y0 - suelo)))) + ")")
const alturas = apoyos.map(a => a[1])
ok(Math.min(...alturas) > 1.0 && Math.max(...alturas) < 2.0,
	"miden entre 1.0 y 2.0 bloques (min " + num(Math.min(...alturas)) +
	", max " + num(Math.max(...alturas)) + ")")

// orientacion: el forward del modelo (+Z local, ya escalado por baseModelo)
// debe mirar a (−sin(encab), 0, cos(encab))
const alFrente = lista.filter(e => {
	const m = uModel[lista.indexOf(e)]
	if (!m) return false
	const dx = m[8] / escala, dz = m[10] / escala, dy = m[9] / escala
	const esperadoX = -Math.sin(e.encab), esperadoZ = Math.cos(e.encab)
	return Math.abs(dx - esperadoX) < 1e-3 && Math.abs(dz - esperadoZ) < 1e-3 &&
		Math.abs(dy) < 1e-3
})
ok(alFrente.length === lista.length, "la vaca mira hacia su direccion de marcha (" +
	alFrente.length + "/" + lista.length + ")")

// ------------------------------------------------- sombra de contacto -----
// El quad de sombra es una elipse girada por uCuerpo.w.  El bug clasico es
// transponer la rotacion: la elipse queda espejada respecto al cuerpo (vaca
// que camina al este -> sombra al oeste).  Este test acopla los DOS extremos
// del codigo: la expresion real de uCuerpo.w y la formula real de `giro`,
// exigiendo que apunten igual que rotY() del cuerpo.
const fuenteIdent = readFileSync(join(root, "identidades.js"), "utf8")
const vec2 = (x, y) => [x, y]

// rotY(tmpB, <expresion>) en matrizEntidad()
const lineaRot = (fuenteIdent.match(/^[ \t]*rotY\(tmpB, ([^\n]+)\)$/m) || [])[1] || ""
// uniform4f(locSombra.u.uCuerpo, e.x, e.y - e.bottomH + SOMBRA_Y, e.z, <exp>)
const mCall = fuenteIdent.match(/uniform4f\(locSombra\.u\.uCuerpo,([\s\S]*?)\)$/m)
const exprSombra = ((mCall ? mCall[1].split(",") : [])[3] || "").trim()

const vsSombraSrc = (fuenteIdent.match(/const VS_SOMBRA = `([\s\S]*?)`/) || [])[1] || ""
const lineaGiro = (vsSombraSrc.match(/vec2 giro = ([^;]+);/) || [])[1] || ""

let fCuerpo = null, fSombra = null, fGiro = null
try {
	fCuerpo = new Function("e", "f", "return (" + lineaRot + ")")
	fSombra = new Function("e", "f", "return (" + exprSombra + ")")
	fGiro = new Function("rel", "c", "s", "vec2", "return " + lineaGiro + ";")
} catch (e) { /* abajo se reporta como fallo */ }

const YAWS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2,
	Math.PI, -Math.PI * 3 / 4, 2.73]
let peorF = 1, peorL = 1
if (fCuerpo && fSombra && fGiro && lineaRot && exprSombra && lineaGiro) {
	for (const k of YAWS) {
		const e = { encab: k, ficha }
		const aC = fCuerpo(e, ficha)   // angulo real de rotY() del cuerpo
		const aS = fSombra(e, ficha)   // w real de uCuerpo (la sombra)
		const c = Math.cos(aS), s = Math.sin(aS)
		// el eje largo (rel.y = RZ) es el +Z del modelo: su frente
		const gF = fGiro({ x: 0, y: 1 }, c, s, vec2)
		// el eje corto (rel.x = RX) es su lateral +X
		const gL = fGiro({ x: 1, y: 0 }, c, s, vec2)
		// rotY(aC) sobre (x,z): +Z -> (sin aC, cos aC), +X -> (cos aC, -sin aC)
		const eF = [Math.sin(aC), Math.cos(aC)]
		const eL = [Math.cos(aC), -Math.sin(aC)]
		peorF = Math.min(peorF, gF[0] * eF[0] + gF[1] * eF[1])
		peorL = Math.min(peorL, gL[0] * eL[0] + gL[1] * eL[1])
	}
	ok(peorF > 1 - 1e-9 && peorL > 1 - 1e-9,
		"la sombra gira igual que el cuerpo en " + YAWS.length + " rumbos " +
		"(dot minimo frente " + num(peorF) + ", lateral " + num(peorL) + ")")
} else {
	ok(false, "se extraen rotY(), uCuerpo.w y la formula de giro de VS_SOMBRA")
}

// ---------------------------------------------------------------- luz -----
// Regresion del bug "la vaca se ve plana, sin volumen", en tres tandas:
//   1. el lambert antiguo `0.5 + 0.5*max(dot(n, L), 0.0)` con una luz casi
//      cenital recortaba a 0.5 toda normal que no mirara hacia arriba+delante
//      y el 53.8% de los vertices quedaba clavado en el minimo -> cero
//      gradiente.
//   2. el half-lambert que lo arreglo seguia apilando el 79% de la superficie
//      visible en la banda plana [0.70,1.00]: el tono dependia del angulo de
//      camara, no de la forma.
//   3. ni uno ni otro servian en el juego, porque el motor NO tiene luz
//      direccional: los bloques dan volumen con un escalon fijo por cara
//      (game.js:4622 getShadows) mas AO por vecinos, y la vaca hacia un
//      degradado distinto sin oclusion propia.
// Ahora el shader usa la tabla de caras del motor y multiplica por aAO, la
// oclusion horneada en glb.js.  Este test extrae la expresion REAL de
// identidades.js y la evalua sobre las normales + el ao del modelo.

// --- estructura ---------------------------------------------------------
// SOMBREADO esta definido UNA sola vez y los dos vertex shaders lo
// concatenan: si alguien lo duplica para "tocar solo uno", el recuento salta
// a 2 y los dos shaders dejan de poder coincidir.
const bloques = [...fuenteIdent.matchAll(/const SOMBREADO = `([\s\S]*?)`/g)]
	.map(m => m[1])
ok(bloques.length === 1, "SOMBREADO esta definido una sola vez y se comparte (" +
	bloques.length + "/1)")
ok(/const VS_BASE = `[\s\S]*?` \+ SOMBREADO/.test(fuenteIdent) &&
	/const VS_SKIN = `[\s\S]*?` \+ SOMBREADO/.test(fuenteIdent),
	"VS_BASE y VS_SKIN concatenan ese mismo bloque")
ok((fuenteIdent.match(/vShadow = sombreado\(n\) \* aAO;/g) || []).length === 2,
	"los dos shaders calculan vShadow = sombreado(n) * aAO")
ok((fuenteIdent.match(/attribute float aAO;/g) || []).length === 2,
	"los dos shaders declaran el attribute aAO")

// --- MODO de diagnostico -------------------------------------------------
// off: apaga la luz Y el aAO de golpe.  Si el reemplazo no es exacto, el
// modo miente (o rompe el shader) y el experimento no sirve de nada.
const srcModo = (fuenteIdent.match(/function aplicarModo\(vs\) \{[\s\S]*?\n\t\}/) || [])[0] || ""
const mRe = srcModo.match(/vs\.replace\(\/(.+)\/g, "(.+)"\)/)
const mSkin = fuenteIdent.match(/const VS_SKIN = `([\s\S]*?)` \+ SOMBREADO \+ `([\s\S]*?)`/)
const vsSkinFull = mSkin ? mSkin[1] + (bloques[0] || "") + mSkin[2] : ""
let vsApagado = null
if (mRe && vsSkinFull) {
	try {
		vsApagado = vsSkinFull.replace(new RegExp(mRe[1], "g"), mRe[2])
	} catch (e) { vsApagado = null }
}
const lineaVSh = vsApagado === null ? "" :
	(vsApagado.split("\n").find(l => /vShadow\s*=/.test(l)) || "").trim()
ok(lineaVSh === "vShadow = 1.0;",
	"MODO off deja la asignacion exactamente en `vShadow = 1.0;` (sale: `" +
	lineaVSh + "`)")

// solo: sin textura, sin niebla, solo el gris de la luz.
const srcSolo = (fuenteIdent.match(/if \(MODO === "solo"\) \{[\s\S]*?\n\t\}/) || [])[0] || ""
const paresSolo = [...srcSolo.matchAll(/\.replace\("([^"]*)", "([^"]*)"\)/g)]
const mFs = fuenteIdent.match(/let FS = `([\s\S]*?)`/)
let fsSolo = mFs ? mFs[1] : ""
for (const m of paresSolo) fsSolo = fsSolo.split(m[1]).join(m[2])
const mainSolo = (fsSolo.match(/void main\(\) \{([\s\S]*)\}/) || [])[1] || ""
ok(paresSolo.length >= 5, "MODO solo reescribe textura, luz y niebla (" +
	paresSolo.length + " reemplazos)")
ok(/vec4\(1\.0\)/.test(mainSolo) && /vec3\(vShadow\)/.test(mainSolo),
	"MODO solo ignora la textura y pinta vShadow en gris")
ok(!/vFog/.test(mainSolo), "MODO solo no deja niebla en main (sale: " +
	(/vFog/.test(mainSolo) ? "con vFog" : "sin vFog") + ")")

// --- linter GLSL ---------------------------------------------------------
// Ningun test compila el GLSL: la mock de GL acepta cualquier fuente, asi que
// un error de sintaxis solo apareceria en el navegador (init() aborta y no
// hay vacas).  Este lint caza la clase tipica: no-ASCII, llaves
// desbalanceadas, varyings que no coinciden y tokens usados sin declarar.
const mBase = fuenteIdent.match(/const VS_BASE = `([\s\S]*?)` \+ SOMBREADO \+ `([\s\S]*?)`/)
const fsSombraSrc = (fuenteIdent.match(/const FS_SOMBRA = `([\s\S]*?)`/) || [])[1] || ""
const vsCajaSrc = (fuenteIdent.match(/const VS_CAJA = `([\s\S]*?)`/) || [])[1] || ""
const fsCajaSrc = (fuenteIdent.match(/const FS_CAJA = `([\s\S]*?)`/) || [])[1] || ""
const fuentes = {
	VS_BASE: mBase ? mBase[1] + (bloques[0] || "") + mBase[2] : "",
	VS_SKIN: vsSkinFull,
	FS: mFs ? mFs[1] : "",
	VS_SOMBRA: vsSombraSrc,
	FS_SOMBRA: fsSombraSrc,
	VS_CAJA: vsCajaSrc,
	FS_CAJA: fsCajaSrc,
}
const sinComentarios = s => s.replace(/\/\/[^\n]*/g, "")
const nombres = (src, tipo) => [...src.matchAll(
	new RegExp("\\b" + tipo + "\\s+\\w+\\s+(\\w+)", "g"))].map(m => m[1])
const problemas = []
for (const [nom, src] of Object.entries(fuentes)) {
	if (!src) { problemas.push(nom + ": no se pudo extraer"); continue }
	if (/[^\x00-\x7F]/.test(src)) problemas.push(nom + ": contiene no-ASCII")
	const limpio = sinComentarios(src)
	const cuenta = ch => limpio.split(ch).length - 1
	if (cuenta("{") !== cuenta("}")) problemas.push(nom + ": llaves desbalanceadas")
	if (cuenta("(") !== cuenta(")")) problemas.push(nom + ": parentesis desbalanceados")
	if (!/void\s+main\s*\(/.test(limpio)) problemas.push(nom + ": sin void main")
	const decl = [...nombres(src, "attribute"), ...nombres(src, "uniform"),
		...nombres(src, "varying")]
	for (const t of new Set(limpio.match(/\b[uv][A-Z]\w*\b|\ba[A-Z]\w*\b/g) || [])) {
		if (decl.indexOf(t) < 0) problemas.push(nom + ": token " + t + " sin declarar")
	}
}
for (const [vs, fs] of [["VS_BASE", "FS"], ["VS_SKIN", "FS"],
	["VS_SOMBRA", "FS_SOMBRA"], ["VS_CAJA", "FS_CAJA"]]) {
	const hv = nombres(fuentes[vs], "varying")
	const falta = nombres(fuentes[fs], "varying").filter(v => hv.indexOf(v) < 0)
	if (falta.length) problemas.push(fs + " declara varying que " + vs +
		" no escribe: " + falta.join(","))
}
for (const fs of ["FS", "FS_SOMBRA", "FS_CAJA"]) {
	if (!/precision\s+\w+\s+float/.test(fuentes[fs])) problemas.push(fs + ": sin precision para float")
}
ok(problemas.length === 0, "lint GLSL: 7 shaders sin anomalias" +
	(problemas.length ? " (" + problemas.join("; ") + ")" : ""))

const conv = s => s.replace(/\b(float|vec2|vec3|vec4|int|bool)\s+(\w+)\s*=/g, "let $2 =")
const cuerpo = bloques[0] || ""
const extraer = nom => (cuerpo.match(
	new RegExp("float " + nom + "\\(vec3 \\w+\\) \\{([\\s\\S]*?)\\}")) || [])[1]
const cuerpoCara = extraer("cara")
const cuerpoSom = extraer("sombreado")
ok(!!cuerpoCara && !!cuerpoSom, "SOMBREADO declara cara() y sombreado()")

const cte = n => {
	const m = cuerpo.match(new RegExp("const float " + n + " = ([0-9.]+)"))
	return m ? +m[1] : NaN
}
const PASO_LUZ = cte("PASO")
const LUZ_ARRIBA = cte("LUZ_ARRIBA")
const LUZ_ABAJO = cte("LUZ_ABAJO")
ok(isFinite(PASO_LUZ) && PASO_LUZ >= 0 && PASO_LUZ <= 1,
	"PASO esta declarado entre 0 y 1 (valor " + num(PASO_LUZ) + ")")
// la tabla debe ser la del motor: 1.0 / 0.95 / 0.95 / 0.80 / 0.80 / 0.75
// (game.js:4622-4740, getShadows)
ok(isFinite(LUZ_ARRIBA) && isFinite(LUZ_ABAJO) && LUZ_ARRIBA === 1 &&
	LUZ_ABAJO === 0.75, "cara() usa el escalon vertical del motor (1.0/0.75)")
ok(cuerpoCara && /0\.95/.test(cuerpoCara) && /0\.80/.test(cuerpoCara),
	"cara() usa los escalones laterales del motor (0.95 en Z, 0.80 en X)")
ok(cuerpoSom && /normalize\(vec3\(0\.42,\s*0\.86,\s*0\.28\)\)/.test(cuerpoSom),
	"sombreado() conserva la luzClave del half-lambert")
ok(cuerpoSom && /\bhl\b/.test(cuerpoSom) && /\bcielo\b/.test(cuerpoSom) &&
	/u\.y/.test(cuerpoSom),
	"sombreado() sigue mezclando half-lambert con el termino hemisferio (u.y)")

if (cuerpoCara && cuerpoSom) {
	// shim: el GLSL devuelve vec3 con `.x/.y/.z`; aqui se montan sobre un
	// array para que `dot()` siga pudiendo indexar con [0..2].
	const vec = a => { const r = Array.from(a); r.x = r[0]; r.y = r[1]; r.z = r[2]; return r }
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
	const normalize = v => { const h = Math.hypot(...v); return h ? vec([v[0] / h, v[1] / h, v[2] / h]) : vec([0, 0, 0]) }
	const vec3 = (a, b, c) => vec([a, b, c])
	const abs = v => vec([Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])])
	const mix = (x, y, t) => x + (y - x) * t
	const f = new Function("n", "dot", "normalize", "vec3", "abs", "mix",
		"PASO", "LUZ_ARRIBA", "LUZ_ABAJO",
		"function cara(u){" + conv(cuerpoCara) + "}\n" + conv(cuerpoSom))

	const malla = vacaCOW.malla
	const nor = malla.nor, pos = malla.pos, ao = malla.ao
	const nV = pos.length / 3

	// --- aAO: la oclusion horneada que faltaba ---------------------------
	ok(ao && ao.length === nV, "glb.js hornea aAO por vertice (" +
		(ao ? ao.length : 0) + "/" + nV + ")")
	if (ao && ao.length === nV) {
		const la = Array.from(ao)
		const minAo = Math.min(...la), maxAo = Math.max(...la)
		const mediaAo = la.reduce((a, b) => a + b, 0) / nV
		ok(la.every(x => x >= 0.35 - 1e-6 && x <= 1 + 1e-6),
			"aAO acotado a [0.35, 1.0] (min " + num(minAo) + ", max " + num(maxAo) + ")")
		ok(maxAo - minAo >= 0.5, "aAO cubre la figura: el cuerpo si se atenua " +
			"donde se toca a si mismo (rango " + num(maxAo - minAo) + ", minimo 0.5)")
		ok(mediaAo > 0.85 && mediaAo <= 1, "aAO no ensucia la vaca (media " +
			num(mediaAo) + ", esperado > 0.85)")
		let lomo = 0
		for (let i = 1; i < nV; i++) if (pos[i * 3 + 1] > pos[lomo * 3 + 1]) lomo = i
		ok(la[lomo] > mediaAo, "el lomo queda por encima de la media (ao " +
			num(la[lomo]) + " > " + num(mediaAo) + ")")
	}

	// --- lo que de verdad llega al FS: sombreado(n) * aAO ----------------
	const luz = [], final = []
	for (let i = 0; i < nV; i++) {
		const s = f([nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]],
			dot, normalize, vec3, abs, mix, PASO_LUZ, LUZ_ARRIBA, LUZ_ABAJO)
		luz.push(s)
		final.push(s * ao[i])
	}
	const estad = v => {
		const min = Math.min(...v), max = Math.max(...v)
		return {
			min, max,
			media: v.reduce((a, b) => a + b, 0) / v.length,
			muertos: v.filter(x => Math.abs(x - min) < 1e-6).length / v.length,
		}
	}
	ok(luz.every(x => isFinite(x)) && final.every(x => isFinite(x)),
		"sombreado() * aAO devuelve valores finitos")
	const eLuz = estad(luz), eFin = estad(final)
	ok(eLuz.max - eLuz.min >= 0.3, "la luz sola ya diferencia orientaciones " +
		"(rango " + num(eLuz.max - eLuz.min) + ", minimo 0.3)")
	ok(eFin.max - eFin.min >= 0.5, "luz * aAO cubre la figura (rango " +
		num(eFin.max - eFin.min) + ", minimo 0.5)")
	ok(eFin.muertos < 0.05, "casi ningun vertice queda clavado en el minimo (" +
		(eFin.muertos * 100).toFixed(1) + "% muertos, tope 5%; con el lambert " +
		"antiguo era 53.8%)")
	ok(eFin.media > 0.35 && eFin.media < 0.65,
		"el brillo medio sigue siendo razonable (media " + num(eFin.media) +
		", banda 0.35..0.65; es la media por vertice sin ponderar, la que se " +
		"ve en pantalla sale mas alta)")
	ok(!/max\s*\(/.test(cuerpoCara + cuerpoSom), "sombreado() no recorta con max() " +
		"(el corte antiguo mataba el gradiente)")
	console.log("        luz: rango " + num(eLuz.min) + ".." + num(eLuz.max) +
		" | luz*aAO: " + num(eFin.min) + ".." + num(eFin.max) +
		" media " + num(eFin.media))
}

// ------------------------------------------------------------------ IA -----
// Escenarios con una vaca suelta y la poblacion automatica apagada:
const objetivoReal = window.IDENTIDADES.vaca.objetivo
window.IDENTIDADES.vaca.objetivo = 0
window.VXLIdentidades.limpiar()
const realPerf = performance.now
let escReloj = 0
performance.now = () => escReloj
const alto = window.IDENTIDADES.vaca.alto

ok(window.IDENTIDADES.vaca.anims.beber === "Cow|Cow_Ea2",
	"el clip de beber es el segundo eat del glb (" +
	window.IDENTIDADES.vaca.anims.beber + ")")

// 1) No meterse en el agua: la columna de delante tiene suelo solido PERO
//    agua a la altura del cuerpo (charca sobre tierra, como en los
//    pantanos).  Sin el escaneo de agua de delante() la vaca la cruza.
colocados.set(clave(40, 49, 60), BLOCK) // tierra firme...
colocados.set(clave(40, 50, 60), AGUA)  // ...con agua a la altura del cuerpo
colocados.set(clave(41, 49, 60), BLOCK)
colocados.set(clave(41, 50, 60), AGUA)
const orilla = window.VXLIdentidades.spawn("vaca", 39, 49.5 + alto * 0.7, 60)
orilla.estado = "walk"
orilla.anim = "walk"
orilla.encab = orilla.encabObj = -Math.PI / 2 // mirando al agua (+x)
orilla.temporizador = 1e9
const x0 = orilla.x
const z0 = orilla.z
let maxX = -1e9
for (let i = 0; i < 200; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (orilla.x > maxX) maxX = orilla.x
}
ok(maxX < 40, "la IA no cruza hacia el agua aunque haya tierra solida debajo " +
	"(maxX " + num(maxX) + ", tope 40)")
const seMovio = Math.max(Math.abs(orilla.x - x0), Math.abs(orilla.z - z0))
ok(seMovio > 0.5, "y aun asi la vaca sigue paseando (se desplazo " + num(seMovio) +
	" bloques)")
colocados.delete(clave(40, 49, 60))
colocados.delete(clave(40, 50, 60))
colocados.delete(clave(41, 49, 60))
colocados.delete(clave(41, 50, 60))

// 1b) El trago mira JUSTO AL AGUA: con la vaca de espaldas al charco y
//     sed, al entrar en drink debe girar para quedar con el bloque de
//     agua delante.  encab se congela durante todo el trago (solo la
//     rama walk lo gira), asi que el giro tiene que fijarse en el
//     arranque del trago; sin el fix la vaca bebia con el rumbo de
//     paseo (de espaldas) o con el volteo de bloqueo encab + PI.
colocados.set(clave(40, 49, 60), BLOCK) // tierra firme con...
colocados.set(clave(40, 50, 60), AGUA)  // ...charco a +x de la vaca
const espalda = window.VXLIdentidades.spawn("vaca", 39, 49.5 + alto * 0.7, 60)
espalda.estado = "walk"
espalda.anim = "walk"
espalda.encab = espalda.encabObj = Math.PI / 2 // de espaldas: mira a -x
espalda.temporizador = 1e9
espalda.stats.hidratacion = 30    // sed (el umbral es 40)
espalda.stats.saciedad = 100      // sin hambre: no divaga a por gramilla
espalda.beber = null; espalda.pastor = null; espalda.proxBusq = 1e9
let bebioEspalda = false, encabTrago = 0
for (let i = 0; i < 30 && !bebioEspalda; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (espalda.estado === "drink") {
		bebioEspalda = true
		encabTrago = espalda.encab
	}
}
ok(bebioEspalda, "la vaca sedienta de espaldas al charco igual llega a beber")
const dirAguaX = -Math.sin(encabTrago), dirAguaZ = Math.cos(encabTrago)
const puntoAgua = dirAguaX * (40 - espalda.x) + dirAguaZ * (60 - espalda.z)
ok(puntoAgua > 0, "bebe MIRANDO al bloque de agua (punto " + num(puntoAgua) +
	(puntoAgua > 0 ? ", delante" : ", DE ESPALDAS") + ")")
colocados.delete(clave(40, 49, 60))
colocados.delete(clave(40, 50, 60))

// 1c) El bloque objetivo acaba JUSTO DEBAJO de la cabeza: medida del
//     glb, la boca queda a 0,58-0,69 bloques del cuerpo (bocado y
//     trago).  Al arrancar comer/beber la vaca gira a apuntar la
//     columna y se DESLIZA (arrimo) hasta dejarla a esa distancia; sin
//     el arrimo el bloque se quedaba hasta 0,9 mas alla de la cabeza.
//     El deslizamiento se acota a la propia columna: el charco jamas
//     acaba pisado (round estable en todo el camino).
window.VXLIdentidades.limpiar()
colocados.set(clave(36, 50, 60), HIERBA_ALTA_B)
colocados.set(clave(36, 51, 60), HIERBA_ALTA_T)
const mordedora = window.VXLIdentidades.spawn("vaca", 35, 49.5 + alto * 0.7, 60)
mordedora.estado = "walk"
mordedora.anim = "walk"
// mirada sesgada 0,3 rad fuera del eje de la mata: sin el giro al
// arrancar el bocado el bloque no acaba "delante" sino de reojo
mordedora.encab = mordedora.encabObj = -Math.PI / 2 + 0.3
mordedora.temporizador = 1e9
mordedora.stats.saciedad = 0        // hambre: pastorea enseguida
mordedora.stats.hidratacion = 100   // sin sed: el charco de 1c-B no la tienta
mordedora.pastor = { x: 36, z: 60 } // ya sabe a que mata ir
mordedora.beber = null; mordedora.proxBusq = 1e9
for (let i = 0; i < 15; i++) {
	escReloj += 33
	window.updateIdentidades()
}
ok(mordedora.estado === "eat", "la vaca se planta a comer ante la mata cercana " +
	"(estado " + mordedora.estado + ")")
const dm = Math.hypot(36 - mordedora.x, 60 - mordedora.z)
ok(Math.abs(dm - 0.6) <= 0.05, "la hierba acaba a la boca (distancia " + num(dm) +
	", esperada 0,600)")
const dmPunto = (-Math.sin(mordedora.encab) * (36 - mordedora.x)
	+ Math.cos(mordedora.encab) * (60 - mordedora.z)) / (dm || 1)
ok(dmPunto > 0.97, "y justo DELANTE de la mirada (punto " + num(dmPunto) +
	(dmPunto > 0.97 ? "" : ", de reojo") + ")")
ok(Math.round(mordedora.x) === 35 && Math.round(mordedora.z) === 60,
	"el deslizamiento no sale de su propia columna (x " + num(mordedora.x) + ")")
colocados.delete(clave(36, 50, 60))
colocados.delete(clave(36, 51, 60))

// 1c-B) Igual con el agua, aun un poco mas cerca (BOCA_AGUA = 0,5) y
//       sin pisar nunca la columna del charco.  (fuera del lago del
//       mock: esAgua ocupa x 40..79, z 40..79)
colocados.set(clave(36, 49, 65), BLOCK)
colocados.set(clave(36, 50, 65), AGUA)
const tragadora = window.VXLIdentidades.spawn("vaca", 35, 49.5 + alto * 0.7, 65)
tragadora.estado = "walk"
tragadora.anim = "walk"
tragadora.encab = tragadora.encabObj = -Math.PI / 2 // mirando al charco (+x)
tragadora.temporizador = 1e9
tragadora.stats.hidratacion = 20   // sed (el umbral es 40)
tragadora.stats.saciedad = 100     // sin hambre: no divaga a por gramilla
tragadora.beber = null; tragadora.pastor = null; tragadora.proxBusq = 1e9
let bebioCerca = false, entroAlAgua = false, dCharco = 0
for (let i = 0; i < 30; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (Math.round(tragadora.x) === 36 && Math.round(tragadora.z) === 65)
		entroAlAgua = true
	if (tragadora.estado === "drink" && i >= 15) {
		bebioCerca = true
		dCharco = Math.hypot(36 - tragadora.x, 65 - tragadora.z)
	}
}
ok(bebioCerca, "la vaca sedienta se planta a beber")
ok(!entroAlAgua, "y NO pisa la columna del agua en el deslizamiento")
ok(Math.abs(dCharco - 0.5) <= 0.06, "el charco acaba a la boca (distancia " +
	num(dCharco) + ", esperada 0,500)")
colocados.delete(clave(36, 49, 65))
colocados.delete(clave(36, 50, 65))
window.VXLIdentidades.limpiar()

// 2) Mata doble: dos mordiscos DENTRO de una sola animacion (copa a
//    ~0,65 s, base a ~1,1 s) y el bocado acaba al terminar el clip
colocados.set(clave(11, 50, 10), HIERBA_ALTA_B)
colocados.set(clave(11, 51, 10), HIERBA_ALTA_T)
colocados.set(clave(9, 50, 10), HIERBA_ALTA_B)
setBlockLlamadas.length = 0
const comilona = window.VXLIdentidades.spawn("vaca", 10, 49.5 + alto * 0.7, 10)
comilona.encab = comilona.encabObj = -Math.PI / 2 // mirando a +x (hacia 11)
comilona.estado = "eat"
comilona.anim = "eat"
comilona.temporizador = 1e9
comilona.tAnim = 0
escReloj += 33
window.updateIdentidades()
ok(getBlock(11, 51, 10) === HIERBA_ALTA_T && setBlockLlamadas.length === 0,
	"la mata sigue intacta al empezar la animacion de comer (se arranca " +
	"un momento despues)")
for (let i = 0; i < 19; i++) {
	escReloj += 33
	window.updateIdentidades()
}
ok(getBlock(11, 51, 10) === 0 && getBlock(11, 50, 10) === HIERBA_ALTA_B,
	"el primer mordisco se lleva SOLO la copa (copa " + getBlock(11, 51, 10) +
	", base " + getBlock(11, 50, 10) + ")")
ok(setBlockLlamadas.length === 1 && setBlockLlamadas[0] === clave(11, 51, 10) + "=0",
	"sin tocar la base (" + setBlockLlamadas.join(" ") + ")")
for (let i = 0; i < 21; i++) {
	escReloj += 33
	window.updateIdentidades()
}
ok(getBlock(11, 50, 10) === 0,
	"el segundo mordisco se come la base en la MISMA animacion")
ok(getBlock(9, 50, 10) === HIERBA_ALTA_B, "no toca la que tiene a la espalda")
ok(setBlockLlamadas.length === 2
	&& setBlockLlamadas[0] === clave(11, 51, 10) + "=0"
	&& setBlockLlamadas[1] === clave(11, 50, 10) + "=0",
	"en orden: primero copa y luego base (" + setBlockLlamadas.join(" ") + ")")
for (let i = 0; i < 30; i++) {
	escReloj += 33
	window.updateIdentidades()
}
ok(comilona.estado === "idle", "una sola animacion por mata: al terminar el clip " +
	"acaba el bocado (estado " + comilona.estado + ")")
ok(setBlockLlamadas.length === 2, "y no vuelve a comer (" +
	setBlockLlamadas.length + " setBlock)")

// 3) Pastoreo completo: la vaca busca las mats sola y se come toda la zona
colocados.delete(clave(9, 50, 10))
window.VXLIdentidades.limpiar()
setBlockLlamadas.length = 0
colocados.set(clave(24, 50, 20), HIERBA_ALTA_B)
colocados.set(clave(24, 51, 20), HIERBA_ALTA_T)
colocados.set(clave(16, 50, 23), HIERBA_ALTA_B)
colocados.set(clave(16, 51, 23), HIERBA_ALTA_T)
colocados.set(clave(20, 50, 26), HIERBA_PLANA)
const pastora = window.VXLIdentidades.spawn("vaca", 20, 49.5 + alto * 0.7, 20)
pastora.stats.saciedad = 0   // con hambre: si no, no pastorea
for (let i = 0; i < 2500; i++) {
	escReloj += 33
	window.updateIdentidades()
}
const sinComer = [[24, 50, 20], [24, 51, 20], [16, 50, 23], [16, 51, 23], [20, 50, 26]]
	.filter(c => getBlock(c[0], c[1], c[2]) !== 0)
ok(sinComer.length === 0, "busca y se come TODA la zona (quedan " +
	sinComer.length + " mitades sin comer: " +
	(sinComer.map(c => c.join(",")).join(" ") || "ninguna") + ")")
ok(setBlockLlamadas.length === 5, "cada mitad se come una sola vez (" +
	setBlockLlamadas.length + " setBlock)")

// 4) Sin gramilla en un radio: no debe entrar nunca en eat (masticar aire)
window.VXLIdentidades.limpiar()
const ayuna = window.VXLIdentidades.spawn("vaca", 5, 49.5 + alto * 0.7, 30)
let comioAire = false
for (let i = 0; i < 600; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (ayuna.estado === "eat") comioAire = true
}
ok(!comioAire, "sin grama cerca no entra en estado eat (no mastica aire)")

// 5) Escalon de 1 bloque: lo SUBE en linea recta (bug "se queda pillada").
//    El motor real no lo sube andando (anula canStep por encima de 0,5:
//    game.js:3302) --asi que lo debe SALTAR en cuanto lo ve, sin llegar
//    a embestirlo ni dar media vuelta.
colocados.set(clave(30, 50, 30), BLOCK)
const escaladora = window.VXLIdentidades.spawn("vaca", 27, 49.5 + alto * 0.7, 30)
escaladora.encab = escaladora.encabObj = -Math.PI / 2 // mirando a +x (hacia 30)
escaladora.estado = "walk"
escaladora.anim = "walk"
escaladora.temporizador = 1e9
escaladora.stats.saciedad = 100   // que no se desvie a pastar
let subio = false
let maxPies = 0
let embestio = false
for (let i = 0; i < 300; i++) {
	escReloj += 33
	window.updateIdentidades()
	const pies = escaladora.y - escaladora.bottomH
	if (pies > maxPies) maxPies = pies
	if (pies >= 50.5 - 1e-9) subio = true
	if (escaladora.bloqueado) embestio = true
}
	ok(subio, "sube el escalon de 1 bloque en linea recta (pies max " + num(maxPies) + ")")
	// el salto de 1 es BAJO: con el impulso viejo (0,5) la vaca volaba a
	// pies 53,4 (apogeo ~4 bloques); con SALTO_VY1 (impulso minimo
	// suficiente) ronda los 50,6
	ok(maxPies < 52, "el salto del escalon queda bajo (pies max " + num(maxPies) + ")")
	ok(escaladora.saltos > 0 && !embestio, "lo salta al verlo, sin embestir " +
	"(" + escaladora.saltos + " saltos, " +
	(embestio ? "llego a empujar" : "sin empujar") + ")")
ok(escaladora.x > 31, "y sigue andando tras subirlo (x final " + num(escaladora.x) + ")")
colocados.delete(clave(30, 50, 30))
window.VXLIdentidades.limpiar()

// 6) Saciedad: llena NO pastorea aunque haya gramilla y la saciedad decae;
//    con hambre si, y cada mordisco la sube
colocados.set(clave(13, 50, 33), HIERBA_ALTA_B)
colocados.set(clave(13, 51, 33), HIERBA_ALTA_T)
const llena = window.VXLIdentidades.spawn("vaca", 11, 49.5 + alto * 0.7, 33)
llena.encab = llena.encabObj = -Math.PI / 2 // mirando a +x (hacia 13)
llena.stats.saciedad = 100
let comioLlena = false
for (let i = 0; i < 400; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (llena.estado === "eat") comioLlena = true
}
ok(!comioLlena && getBlock(13, 51, 33) === HIERBA_ALTA_T
	&& getBlock(13, 50, 33) === HIERBA_ALTA_B,
	"con la barriga llena no pastorea aunque tenga gramilla delante")
ok(llena.stats.saciedad < 100, "y la saciedad va decayendo con el tiempo (" +
	num(llena.stats.saciedad) + "% tras 400 frames)")
// se vuelve a plantar delante de la mata (en la fase llena pudo pasear lejos)
llena.x = 11
llena.z = 33
llena.encab = llena.encabObj = -Math.PI / 2
llena.vx = llena.vz = 0
llena.stats.saciedad = 0
for (let i = 0; i < 1200 && getBlock(13, 50, 33) !== 0; i++) {
	escReloj += 33
	window.updateIdentidades()
}
ok(getBlock(13, 51, 33) === 0 && getBlock(13, 50, 33) === 0,
	"con hambre si que se come la mata entera")
ok(llena.stats.saciedad >= 10, "los mordiscos suben la saciedad (" +
	num(llena.stats.saciedad) + "%)")
colocados.delete(clave(13, 50, 33))
colocados.delete(clave(13, 51, 33))
window.VXLIdentidades.limpiar()

// 7) Hidratacion: con sed va al agua, BEBE en la orilla con el clip de eat
//    sin pisar el agua, se rellena y la bebida DURA (clip en bucle)
colocados.set(clave(20, 50, 35), AGUA)  // charca suelta en la llanura
const sedienta = window.VXLIdentidades.spawn("vaca", 18, 49.5 + alto * 0.7, 35)
sedienta.stats.hidratacion = 0
let bebio = false
let animOk = true
let tragoFrames = 0
let pisoAgua = false
let maxHidr = 0
	let tAnimPrev = -1
	let envuelta = false
	let lastDrinkTAnim = 1e9
	for (let i = 0; i < 900; i++) {
		escReloj += 33
		window.updateIdentidades()
		if (sedienta.estado === "drink") {
			bebio = true
			tragoFrames++
			lastDrinkTAnim = sedienta.tAnim
		// la animacion debe ser "beber" en TODOS los frames del trago
		if (sedienta.anim !== "beber") animOk = false
		// el clip (2,125 s a ritmo 0,7) debe volver a empezar: si tAnim
		// se queda clavado al final, la vaca se queda con la pose final
		// "cortada" en el primer minuto del trago
		if (tAnimPrev >= 0 && sedienta.tAnim < tAnimPrev - 1e-9) envuelta = true
		tAnimPrev = sedienta.tAnim
	} else {
		tAnimPrev = -1
	}
	// pisar la columna del agua (20,35) si; rodearla por (20,34) es legitimo
	if (Math.round(sedienta.x) === 20 && Math.round(sedienta.z) === 35) pisoAgua = true
	if (sedienta.stats.hidratacion > maxHidr) maxHidr = sedienta.stats.hidratacion
}
const trago = tragoFrames * 0.033
ok(bebio && animOk, "con sed llega a la orilla y bebe con la animacion " +
	"durante todo el trago (" + (bebio ? (animOk ? "ok" : "anim cortada") : "nunca bebe") + ")")
ok(maxHidr >= 95, "bebiendo se rellena la hidratacion (" +
	num(maxHidr) + "% max, fin " + num(sedienta.stats.hidratacion) + "%)")
ok(trago >= 3.5, "la bebida dura con la cabeza abajo (" + num(trago) +
	" s; el clip de 2,125 s solo llegaba a 2,1 s)")
	ok(envuelta, "y el clip se repite en bucle durante el trago (" +
		(envuelta ? "volvio a empezar" : "tAnim clavado: anim cortada") + ")")
	// el corte se ancla a la frontera del bucle: el ULTIMO frame en drink
	// deja tAnim ~0 (recien envuelto), nunca a media 2a vuelta
	ok(lastDrinkTAnim < 0.2, "acaba el trago en la frontera del bucle, sin " +
		"cortar la 2a animacion (tAnim final " + num(lastDrinkTAnim) + ")")
ok(!pisoAgua, "y nunca se mete en la columna del agua (x " + num(sedienta.x) +
	", z " + num(sedienta.z) + ")")
colocados.delete(clave(20, 50, 35))
window.VXLIdentidades.limpiar()

// 8) Enfoque DIAGONAL al agua: aguaCerca() solo miraba la propia + las 4
//    vecinas ortogonales, asi que la vaca se paraba mirando el agua 2,5 s
//    y se daba la vuelta sin llegar a beber (el "a veces no" del reporte).
//    La vaca arranca mirando exactamente a 45 grados: la parada cae en la
//    diagonal y solo con las 9 columnas dispara la bebida sin vararse.
colocados.set(clave(20, 50, 35), AGUA)
const diagonal = window.VXLIdentidades.spawn("vaca", 18, 49.5 + alto * 0.7, 33)
diagonal.stats.hidratacion = 0
diagonal.estado = "idle"          // arranca decidida: sed -> buscarAgua ->
diagonal.temporizador = 1         // camino DIAGONAL al agua de (20,35)
diagonal.anim = "idle"
diagonal.encab = diagonal.encabObj = -Math.PI / 4  // recta SE: (18,33)->(20,35)
let bebioDiag = false
let animDiag = false
let diagAband = 0
let diagBeberAntes = false
for (let i = 0; i < 400 && !bebioDiag; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (!diagonal.beber && diagBeberAntes) diagAband++
	diagBeberAntes = !!diagonal.beber
	if (diagonal.estado === "drink") {
		bebioDiag = true
		if (diagonal.anim === "beber") animDiag = true
	}
}
ok(bebioDiag && animDiag && diagAband === 0,
	"enfoque diagonal en linea recta: bebe sin vararse en la orilla (" +
	(bebioDiag ? (diagAband === 0 ? "ok" : "varada x" + diagAband)
		: "se queda sin beber") + ")")
colocados.delete(clave(20, 50, 35))
window.VXLIdentidades.limpiar()

// 9) Borde de colina: la gramilla al otro lado de un desnivel de +3 no
//    debe provocar acoso (avanzar hasta el muro, pararse 2,5 s, dar la
//    vuelta y re-apuntar en bucle = "pequeños movimientos repetitivos").
//    Tras DOS intentos fallidos la vaca hace una pausa de busqueda; al
//    pasarla debe volver a buscar con normalidad.
//    Recinto cerrado para que la metrica no dependa de si la vaca se
//    aleja del radio de 9 por suerte: la colina de +3 no se escala (ni
//    se salta: con 2 bloques la vaca la superaria), la jaula la mantiene
//    siempre en rango de las matas de detras.
const paredes = []
for (let z = 27; z <= 34; z++) {              // muro oeste
	for (const y of [50, 51, 52]) {
		world.setBlock(23, y, z, 1); paredes.push([23, y, z])
	}
}
for (let x = 23; x <= 40; x++) {              // caras norte y sur
	for (const z of [27, 34]) {
		for (const y of [50, 51, 52]) {
			world.setBlock(x, y, z, 1); paredes.push([x, y, z])
		}
	}
}
for (let x = 30; x <= 40; x++) for (let z = 27; z <= 34; z++) {  // colina +3 al este
	for (const y of [50, 51, 52]) {
		world.setBlock(x, y, z, 1); paredes.push([x, y, z])
	}
}
// gramilla en lo alto de la colina (setBlock deja tops=52: buscarGrama la ve)
const gramaAlta = [[33, 29], [36, 31], [39, 30]]
for (const g of gramaAlta) {
	colocados.set(clave(g[0], 53, g[1]), HIERBA_ALTA_B)
	colocados.set(clave(g[0], 54, g[1]), HIERBA_ALTA_T)
}
const jaula = window.VXLIdentidades.spawn("vaca", 26.5, 49.5 + alto * 0.7, 30)
jaula.encab = jaula.encabObj = -Math.PI / 2    // mirando a la colina
jaula.estado = "walk"; jaula.anim = "walk"
jaula.temporizador = 60000                     // solo manda el escaneo de 2 s
jaula.stats.saciedad = 40                      // hambre: pastorea todo el rato
jaula.stats.hidratacion = 100
jaula.pastor = null; jaula.pastorBloq = 0; jaula.proh = 0; jaula.prohCol = null
jaula.proxBusq = 0; jaula.bloqueado = false
let acq = 0, t2 = -1, ac3TrasT2 = false, maxPausa = 0
let acqEnPausa = false
let pastorAntes = false, gramCerca = false, comioDespues = false
for (let i = 0; i < 2400; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (jaula.pastor && !pastorAntes) {
		acq++
		if (jaula.buscaPausa > 0) acqEnPausa = true
		if (acq === 2) t2 = i
		else if (acq === 3 && t2 >= 0 && i - t2 <= 300) ac3TrasT2 = true
	}
	pastorAntes = !!jaula.pastor
	if (jaula.buscaPausa > maxPausa) maxPausa = jaula.buscaPausa
	if (i === 1000 && !gramCerca) {
		// ya con la primera pausa agotada: una mata SÍ alcanzable dentro
		colocados.set(clave(26, 50, 31), HIERBA_ALTA_B)
		colocados.set(clave(26, 51, 31), HIERBA_ALTA_T)
		gramCerca = true
	}
	if (i >= 1000 && jaula.estado === "eat") comioDespues = true
}
ok(maxPausa > 0, "tras dos intentos fallidos contra la colina hace una " +
	"pausa de busqueda (" + num(maxPausa) + " ms max)")
ok(!ac3TrasT2, "ni una tercera mata en los 300 frames tras la segunda " +
	"(sin la pausa volvia a re-apuntar en cuanto olvidaba)")
ok(!acqEnPausa, "ni una mata apuntada mientras dura la pausa de busqueda " +
	"(el escaneo deberia seguir cortado)" )
ok(comioDespues, "pasada la pausa vuelve a buscar y se come la mata " +
	"alcanzable que aparece en el frame 1000")
for (const c of paredes) world.setBlock(c[0], c[1], c[2], 0)
for (const g of gramaAlta) {
	colocados.delete(clave(g[0], 53, g[1])); colocados.delete(clave(g[0], 54, g[1]))
}
colocados.delete(clave(26, 50, 31)); colocados.delete(clave(26, 51, 31))
for (let x = 23; x <= 40; x++) for (let z = 27; z <= 34; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 10) Lo mismo por la via del AGUA: buscarAgua() no tiene exclusion (proh),
//     asi que en cada paseo a idle re-apuntaba al mismo charco tras el
//     repicado de +2.  Misma pausa tras dos fallos.
const paredes2 = []
for (let z = 27; z <= 34; z++) {              // muro oeste
	world.setBlock(23, 50, z, 1); paredes2.push([23, 50, z])
	world.setBlock(23, 51, z, 1); paredes2.push([23, 51, z])
}
for (let x = 23; x <= 40; x++) {              // caras norte y sur
	for (const z of [27, 34]) {
		world.setBlock(x, 50, z, 1); paredes2.push([x, 50, z])
		world.setBlock(x, 51, z, 1); paredes2.push([x, 51, z])
	}
}
const celdasPozo = []
for (let x = 29; x <= 40; x++) for (let z = 27; z <= 34; z++) {
	// Repicado a -5 (suelo natural en y=44) y agua desde x=31.  Con la
	// bajada sin gate la vaca saltaba dentro (fondo seco a <=4 es legal)
	// y bebia desde el interior: el charco dejaba de ser inalcanzable y
	// no llegaba la pausa de busqueda.  A -5 el fondo queda fuera de
	// suelo-4 y hayDescenso rechaza el salto; el agua queda ademas
	// fuera de aguaCerca (suelo-3 = y46) desde la orilla.
	for (let y = 45; y <= 49; y++) {
		colocados.set(clave(x, y, z), 0); celdasPozo.push([x, y, z])
	}
	if (x >= 31) {
		colocados.set(clave(x, 45, z), AGUA); celdasPozo.push([x, 45, z])
		colocados.set(clave(x, 46, z), AGUA); celdasPozo.push([x, 46, z])
	}
}
const pozo = window.VXLIdentidades.spawn("vaca", 26.5, 49.5 + alto * 0.7, 30)
pozo.encab = pozo.encabObj = -Math.PI / 2      // mirando al charco
pozo.estado = "walk"; pozo.anim = "walk"
pozo.temporizador = 5000                       // ciclos walk/idle normales
pozo.stats.saciedad = 100                      // sin gramilla de por medio
pozo.stats.hidratacion = 30                    // sed: va a por el agua
pozo.beber = null; pozo.beberBloq = 0; pozo.proxBusq = 0; pozo.bloqueado = false
let maxPausaAgua = 0, dentro = true, beberAcq = 0, beberAntes = false
for (let i = 0; i < 1500; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (pozo.buscaPausa > maxPausaAgua) maxPausaAgua = pozo.buscaPausa
	if (pozo.x >= 30.5) dentro = false
	if (pozo.beber && !beberAntes) beberAcq++
	beberAntes = !!pozo.beber
}
ok(maxPausaAgua > 0, "el charco inalcanzable tambien entra en la pausa de " +
	"busqueda (" + num(maxPausaAgua) + " ms max, " + beberAcq + " intentos)")
ok(dentro, "la vaca no entra en el repicado ni lo rodea (x " + num(pozo.x) + ")")
for (const c of paredes2) world.setBlock(c[0], c[1], c[2], 0)
for (const c of celdasPozo) colocados.delete(clave(c[0], c[1], c[2]))
for (let x = 23; x <= 40; x++) for (let z = 27; z <= 34; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 11) Rodeo: la mata esta detras de un muro de 3 (insaltable) pero al
//     sur hay un hueco; en vez de acosar el muro, la vaca bordea por el
//     hueco y se la come.  esquivando > 0 durante el rodeo; pre-fix ese
//     campo no existe (0) y el rodeo no ocurre.
const paredes3 = []
for (let z = 27; z <= 31; z++) {              // muro al este, hueco en z=32,33
	for (const y of [50, 51, 52]) {
		world.setBlock(29, y, z, 1); paredes3.push([29, y, z])
	}
}
colocados.set(clave(33, 50, 30), HIERBA_ALTA_B)
colocados.set(clave(33, 51, 30), HIERBA_ALTA_T)
const rodeo = window.VXLIdentidades.spawn("vaca", 26.5, 49.5 + alto * 0.7, 30)
rodeo.encab = rodeo.encabObj = -Math.PI / 2    // mirando al muro
rodeo.estado = "walk"; rodeo.anim = "walk"
rodeo.temporizador = 60000                     // solo manda el escaneo de 2 s
rodeo.stats.saciedad = 40
rodeo.stats.hidratacion = 100
rodeo.pastor = null; rodeo.pastorBloq = 0; rodeo.proh = 0; rodeo.prohCol = null
rodeo.proxBusq = 0; rodeo.bloqueado = false
rodeo.beber = null; rodeo.beberBloq = 0
let maxEsquivando = 0, comioRodeo = false
for (let i = 0; i < 1800; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (rodeo.esquivando > maxEsquivando) maxEsquivando = rodeo.esquivando
	if (rodeo.estado === "eat") comioRodeo = true
}
ok(maxEsquivando > 0 && comioRodeo,
	"rodeo por el hueco del muro: esquiva y llega a la mata (esquivando " +
	num(maxEsquivando) + " ms, " + (comioRodeo ? "comio" : "sin comer") + ")")
for (const c of paredes3) world.setBlock(c[0], c[1], c[2], 0)
colocados.delete(clave(33, 50, 30)); colocados.delete(clave(33, 51, 30))
for (let x = 23; x <= 40; x++) for (let z = 27; z <= 34; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 12) Salto: bolsillo sellado por un anillo de 3 con una cresta de 2 al
//     este (lo unico saltable) y la mata detras.  Sin salto la vaca no
//     puede salir nunca del bolsillo; con salto pasa la cresta y come.
const paredes4 = []
const anillo3 = (x, z) => {
	for (const y of [50, 51, 52]) {
		world.setBlock(x, y, z, 1); paredes4.push([x, y, z])
	}
}
for (let z = 27; z <= 34; z++) anillo3(23, z)                    // oeste
for (let x = 23; x <= 40; x++) { anillo3(x, 27); anillo3(x, 34) } // norte y sur
for (let z = 27; z <= 34; z++) {             // cresta de 2: lo unico saltable
	world.setBlock(29, 50, z, 1); paredes4.push([29, 50, z])
	world.setBlock(29, 51, z, 1); paredes4.push([29, 51, z])
}
colocados.set(clave(33, 50, 30), HIERBA_ALTA_B)
colocados.set(clave(33, 51, 30), HIERBA_ALTA_T)
const salta = window.VXLIdentidades.spawn("vaca", 26.5, 49.5 + alto * 0.7, 30)
salta.encab = salta.encabObj = -Math.PI / 2    // mirando a la cresta
salta.estado = "walk"; salta.anim = "walk"
salta.temporizador = 60000                     // solo manda el escaneo de 2 s
salta.stats.saciedad = 40
salta.stats.hidratacion = 100
salta.pastor = null; salta.pastorBloq = 0; salta.proh = 0; salta.prohCol = null
salta.proxBusq = 0; salta.bloqueado = false
salta.beber = null; salta.beberBloq = 0
let maxSaltos = 0, comioSalto = false
for (let i = 0; i < 1500; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (salta.saltos > maxSaltos) maxSaltos = salta.saltos
	if (salta.estado === "eat") comioSalto = true
}
ok(maxSaltos > 0 && comioSalto, "salta la cresta de 2 y se come la mata (" +
	maxSaltos + " saltos, " + (comioSalto ? "comio" : "sin comer") + ")")
for (const c of paredes4) world.setBlock(c[0], c[1], c[2], 0)
colocados.delete(clave(33, 50, 30)); colocados.delete(clave(33, 51, 30))
for (let x = 23; x <= 40; x++) for (let z = 27; z <= 34; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 13) Igual pero por la via del AGUA: la cresta de 2 sella el bolsillo
//     y detras hay orilla (x=30) y agua (x>=31).  Con sed, la vaca salta
//     la cresta, aterriza en la orilla y bebe.  Pre-fix no puede salir.
const paredes5 = []
const anillo5 = (x, z) => {
	for (const y of [50, 51, 52]) {
		world.setBlock(x, y, z, 1); paredes5.push([x, y, z])
	}
}
for (let z = 27; z <= 34; z++) anillo5(23, z)                     // oeste
for (let x = 23; x <= 40; x++) { anillo5(x, 27); anillo5(x, 34) } // norte y sur
for (let z = 27; z <= 34; z++) {             // cresta de 2: lo unico saltable
	world.setBlock(29, 50, z, 1); paredes5.push([29, 50, z])
	world.setBlock(29, 51, z, 1); paredes5.push([29, 51, z])
}
const agua13 = []
for (let x = 31; x <= 40; x++) for (let z = 27; z <= 34; z++) {
	colocados.set(clave(x, 49, z), AGUA); agua13.push([x, 49, z])
}
const crestased = window.VXLIdentidades.spawn("vaca", 26.5, 49.5 + alto * 0.7, 30)
crestased.encab = crestased.encabObj = -Math.PI / 2   // mirando a la cresta
crestased.estado = "walk"; crestased.anim = "walk"
crestased.temporizador = 5000                   // ciclos walk/idle: al idle busca agua
crestased.stats.saciedad = 100
crestased.stats.hidratacion = 30
crestased.pastor = null; crestased.pastorBloq = 0; crestased.proh = 0; crestased.prohCol = null
crestased.proxBusq = 0; crestased.bloqueado = false
crestased.beber = null; crestased.beberBloq = 0
let maxSaltosAgua = 0, bebioSalto = false
for (let i = 0; i < 1500; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (crestased.saltos > maxSaltosAgua) maxSaltosAgua = crestased.saltos
	if (crestased.estado === "drink") bebioSalto = true
}
ok(maxSaltosAgua > 0 && bebioSalto, "salta la cresta por la sed y bebe en la " +
	"orilla (" + maxSaltosAgua + " saltos, " +
	(bebioSalto ? "bebio" : "sin beber") + ")")
for (const c of paredes5) world.setBlock(c[0], c[1], c[2], 0)
for (const c of agua13) colocados.delete(clave(c[0], c[1], c[2]))
for (let x = 23; x <= 40; x++) for (let z = 27; z <= 34; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 14) Subir 2 bloques: la mata esta ENCIMA de una meseta de 2.  Desde el
//     suelo la columna de delante coincide con la de la mata, pero esta a
//     2 de altura y no es alcanzable: sin comprobar la altura la vaca
//     masticaba aire al pie de la meseta y nunca saltaba.  Debe saltar,
//     aterrizar en la cima y comer ALLI.
const meseta2 = []
for (const x of [14, 15]) for (const z of [59, 60, 61]) {
	for (const y of [50, 51]) {
		world.setBlock(x, y, z, 1); meseta2.push([x, y, z])
	}
}
colocados.set(clave(14, 52, 60), HIERBA_ALTA_B)
colocados.set(clave(14, 53, 60), HIERBA_ALTA_T)
const subidora = window.VXLIdentidades.spawn("vaca", 10, 49.5 + alto * 0.7, 60)
subidora.encab = subidora.encabObj = -Math.PI / 2   // mirando a +x (meseta en 14)
subidora.estado = "walk"; subidora.anim = "walk"
subidora.temporizador = 60000                    // solo manda el escaneo de 2 s
subidora.stats.saciedad = 40
subidora.stats.hidratacion = 100
subidora.pastor = null; subidora.pastorBloq = 0; subidora.proh = 0; subidora.prohCol = null
subidora.proxBusq = 0; subidora.bloqueado = false
subidora.beber = null; subidora.beberBloq = 0
let maxSaltosSubida = 0, maxPiesSubida = 0, comioSubida = false
for (let i = 0; i < 2000; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (subidora.saltos > maxSaltosSubida) maxSaltosSubida = subidora.saltos
	const piesSub = subidora.y - subidora.bottomH
	if (piesSub > maxPiesSubida) maxPiesSubida = piesSub
	if (getBlock(14, 52, 60) === 0 && getBlock(14, 53, 60) === 0) comioSubida = true
}
	ok(comioSubida && maxSaltosSubida > 0 && maxPiesSubida >= 51.5 - 1e-9,
		"sube la meseta de 2 y come la mata encima (saltos " + maxSaltosSubida +
		", pies max " + num(maxPiesSubida) + ", " +
		(comioSubida ? "comio" : "sin comer") + ")")
	// el salto de 2 tampoco vuela: con SALTO_VY2 el apogeo son ~52,0;
	// con el impulso viejo subia a 53,4
	ok(maxPiesSubida < 52.6, "el salto de la meseta queda contenido (pies max " +
		num(maxPiesSubida) + ")")
for (const c of meseta2) world.setBlock(c[0], c[1], c[2], 0)
colocados.delete(clave(14, 52, 60)); colocados.delete(clave(14, 53, 60))
for (let x = 8; x <= 17; x++) for (let z = 57; z <= 63; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 15) Agua lejana: con RADIO_AGUA = 9 la vaca solo ve lo que hay muy
//     cerca; el lago del este (x>=40, z>=40) queda a ~42 bloques y pasa
//     desapercibido.  Con sed intensa debe encontrarlo e ir a beber.
const sedLarga = window.VXLIdentidades.spawn("vaca", 10, 49.5 + alto * 0.7, 10)
sedLarga.estado = "idle"; sedLarga.anim = "idle"
sedLarga.temporizador = 1                        // decide ya: buscarAgua
sedLarga.stats.saciedad = 100                    // sin gramilla de por medio
sedLarga.stats.hidratacion = 0
let bebioLejos = false
for (let i = 0; i < 3000 && !bebioLejos; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (sedLarga.estado === "drink") bebioLejos = true
}
ok(bebioLejos, "encuentra y bebe del agua a ~42 bloques con RADIO_AGUA " +
	"ampliado (con el radio 9 no la ve: " +
	(bebioLejos ? "bebio" : "nunca bebe") + ")")
window.VXLIdentidades.limpiar()

// 16) Barriga llena: sin hambre ni sed no pastorea ni busca agua, pero
//     tampoco deberia divagar girando sin parar: largas estancias
//     quietas y paseos cortos que continuan el rumbo.  Recorrido total
//     en 40 s con tope (antes paseaba ~60% del tiempo).
const holgazana = window.VXLIdentidades.spawn("vaca", 20, 49.5 + alto * 0.7, 60)
holgazana.estado = "idle"; holgazana.anim = "idle"
holgazana.temporizador = 1
holgazana.stats.saciedad = 100
holgazana.stats.hidratacion = 100
let caminoTotal = 0
let pxH = holgazana.x, pzH = holgazana.z
for (let i = 0; i < 1200; i++) {
	escReloj += 33
	window.updateIdentidades()
	caminoTotal += Math.hypot(holgazana.x - pxH, holgazana.z - pzH)
	pxH = holgazana.x; pzH = holgazana.z
}
ok(caminoTotal > 0.5 && caminoTotal < 20,
	"con la barriga llena casi no divaga (recorrio " + num(caminoTotal) +
	" bloques en 40 s, tope 20)")
window.VXLIdentidades.limpiar()

// 17) Bajar a por agua: la vaca esta en una meseta de 2 y el agua esta
//     en el suelo de al lado.  La bajada estaba gateada por
//     e.cima/e.cimaY (solo se actualizaban al saltar hacia ARRIBA), asi
//     que una vaca que nunca subio o que camino bajando escalones jamas
//     saltaba el filo: quedaba pegada arriba (barranco para delante,
//     paseo confinado a la meseta) hasta que el reloj de beberBloq la
//     olvidaba sin beber nunca.  Debe DESCENDER con el salto de bajada
//     e ir a beber.
const mesetaB = []
for (const x of [26, 27]) for (const z of [12, 13]) {
	for (const y of [50, 51]) {
		world.setBlock(x, y, z, 1); mesetaB.push([x, y, z])
	}
}
const agua17 = []
for (let x = 31; x <= 34; x++) for (let z = 11; z <= 14; z++) {
	colocados.set(clave(x, 49, z), AGUA); agua17.push([x, 49, z])
}
const bajadora = window.VXLIdentidades.spawn("vaca", 26, 51.5 + alto * 0.7, 12)
bajadora.encab = bajadora.encabObj = -Math.PI / 2  // mirando a +x (meseta en 26-27, agua en 31+)
bajadora.estado = "idle"; bajadora.anim = "idle"
bajadora.temporizador = 1                         // decide ya: buscarAgua
bajadora.stats.saciedad = 100                     // sin gramilla de por medio
bajadora.stats.hidratacion = 0
bajadora.pastor = null; bajadora.pastorBloq = 0; bajadora.proh = 0; bajadora.prohCol = null
bajadora.proxBusq = 0; bajadora.bloqueado = false
bajadora.beber = null; bajadora.beberBloq = 0
let bebioBajada = false, saltosBajada = 0
for (let i = 0; i < 2000 && !bebioBajada; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (bajadora.saltos > saltosBajada) saltosBajada = bajadora.saltos
	if (bajadora.estado === "drink") bebioBajada = true
}
ok(bebioBajada && saltosBajada > 0, "baja de la meseta de 2 por el agua (" +
	saltosBajada + " saltos, " + (bebioBajada ? "bebio" : "sin beber") + ")")
for (const c of mesetaB) world.setBlock(c[0], c[1], c[2], 0)
for (const c of agua17) colocados.delete(clave(c[0], c[1], c[2]))
for (let x = 25; x <= 35; x++) for (let z = 10; z <= 15; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 18) Beber desde el filo: el agua esta JUSTO debajo del borde de la
//     meseta (dos bloques por debajo de los pies).  No debe saltar ni
//     meterse en el agua: con aguaCerca mirando hasta suelo-3 bebe
//     desde arriba; con el alcance viejo (suelo-1) el agua quedaba un
//     nivel fuera de vista, hayDescenso rechazaba la columna (agua) y
//     la vaca daba vueltas sin beber.  Corte a 80 ticks: el beber
//     correcto llega en ~12 y el erróneo no puede llegar ni por el
//     rodeo ni por un paseo posterior.
const mesetaF = []
for (const x of [26, 27]) for (const z of [12, 13]) {
	for (const y of [50, 51]) {
		world.setBlock(x, y, z, 1); mesetaF.push([x, y, z])
	}
}
colocados.set(clave(28, 49, 12), AGUA)
const filo = window.VXLIdentidades.spawn("vaca", 26, 51.5 + alto * 0.7, 12)
filo.encab = filo.encabObj = -Math.PI / 2          // mirando a +x (borde y agua en 28)
filo.estado = "idle"; filo.anim = "idle"
filo.temporizador = 1                              // decide ya: buscarAgua
filo.stats.saciedad = 100
filo.stats.hidratacion = 0
filo.pastor = null; filo.pastorBloq = 0; filo.proh = 0; filo.prohCol = null
filo.proxBusq = 0; filo.bloqueado = false
filo.beber = null; filo.beberBloq = 0
let bebioFilo = false, saltosFilo = 0
for (let i = 0; i < 80 && !bebioFilo; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (filo.saltos > saltosFilo) saltosFilo = filo.saltos
	if (filo.estado === "drink") bebioFilo = true
}
ok(bebioFilo && saltosFilo === 0, "bebe del filo de la meseta sin saltar ni " +
	"meterse en el agua (" + saltosFilo + " saltos, " +
	(bebioFilo ? "bebio" : "sin beber") + ")")
for (const c of mesetaF) world.setBlock(c[0], c[1], c[2], 0)
colocados.delete(clave(28, 49, 12))
for (let x = 25; x <= 35; x++) for (let z = 10; z <= 15; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 19) Copa: teletransporte a la copa del arbol.  El snap-Y de collided
//     aceptaba CUALQUIER cara entre pies y cabeza (para subir
//     escalones), asi que una vaca que saltaba junto al arbol --con la
//     X sin choque lateral en pleno salto-- penetraba en la columna de
//     hojas y al caer acababa ENGANCHADA en la copa (el mock, ademas,
//     cascadeara capa por capa hasta la cima).  Debe saltar junto al
//     arbol (el escalon de 1 lo dispara).  La copa si se puede PISAR
//     si el salto la alcanzo (decision: poder quedarse); lo prohibido
//     es el TELETRANSPORTE (frame con +0,61 o mas) y volar por encima
//     del alcance de vy2 (apogeo ~53,0 desde la meseta).
const arbol19 = []
const bloques19 = (x, y, z) => { world.setBlock(x, y, z, 1); arbol19.push([x, y, z]) }
bloques19(17, 50, 70)                               // escalon junto al arbol (dispara el salto)
for (let y = 50; y <= 53; y++) bloques19(20, y, 70) // tronco
for (let x = 18; x <= 22; x++) for (let z = 68; z <= 72; z++) {
	if (x === 20 && z === 70) continue               // el tronco ocupa el centro
	bloques19(x, 51, z)                              // capa baja (falda)
	bloques19(x, 52, z)
}
for (let x = 19; x <= 21; x++) for (let z = 69; z <= 71; z++) bloques19(x, 53, z)
bloques19(20, 54, 70)
const trepadora = window.VXLIdentidades.spawn("vaca", 16.6, 49.5 + alto * 0.7, 70)
trepadora.encab = trepadora.encabObj = -Math.PI / 2  // mirando al escalon/arbol (+x)
trepadora.estado = "walk"; trepadora.anim = "walk"
trepadora.temporizador = 60000                    // solo manda el escaneo de 2 s
trepadora.stats.saciedad = 40
trepadora.stats.hidratacion = 100
trepadora.pastor = null; trepadora.pastorBloq = 0; trepadora.proh = 0; trepadora.prohCol = null
trepadora.proxBusq = 0; trepadora.bloqueado = false
trepadora.beber = null; trepadora.beberBloq = 0
let saltosCopa = 0, piesCopa = 0
let telecopiaCopa = false, prevPiesCopa = trepadora.y - trepadora.bottomH
for (let i = 0; i < 1500; i++) {
	escReloj += 33
	window.updateIdentidades()
	if (trepadora.saltos > saltosCopa) saltosCopa = trepadora.saltos
	const piesCop = trepadora.y - trepadora.bottomH
	if (piesCop > piesCopa) piesCopa = piesCop
	// teletransporte = un salto de +0,61 en un solo frame (la fisica
	// legitima sube 0,40 como maximo con vy2 y el aterrizaje 0,60,
	// el tope del motor); el snap sin tope sube de golpe 1,0+
	if (piesCop - prevPiesCopa > 0.61) telecopiaCopa = true
	prevPiesCopa = piesCop
}
ok(saltosCopa > 0, "junto al arbol salta el escalon (saltos " + saltosCopa + ")")
// la copa se puede PISAR si el salto la alcanzo (decision: poder
// quedarse); lo que no puede pasar es el TELETRANSPORTE ni superar
// el alcance de vy2 desde la meseta (apogeo ~53,0)
ok(!telecopiaCopa, "el vuelo junto al arbol no teletransporta a la copa (" +
	(telecopiaCopa ? "SALTO DE +0,61 EN UN FRAME" : "sin salto") + ")")
ok(piesCopa <= 53.2, "el vuelo junto al arbol queda contenido (pies max " +
	num(piesCopa) + ")")
for (const c of arbol19) world.setBlock(c[0], c[1], c[2], 0)
for (let x = 15; x <= 24; x++) for (let z = 66; z <= 74; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

// 20) Tope del snap-Y en caida lateral, con spawn fijo (sin depender de
//     trayectorias): la vaca cae JUNTO a un pilote de 2 con los pies por
//     debajo de la cara superior de y=51 (a mas de 0,6).  Con el tope
//     aterriza en la cara que tiene debajo (cara 50,5 de y=50); sin el
//     tope, collided la subiria de golpe a 51,5 (+1,1 en un frame) y
//     cascadearia hasta la cima: el bug de la vaca en la copa.  Se
//     detecta por frame (>+0,61 = teletransporte) y por altura final.
const pilote20 = []
for (const y of [50, 51]) {
	world.setBlock(17, y, 41, 1); pilote20.push([17, y, 41])
}
const caediza = window.VXLIdentidades.spawn("vaca", 17.7, 50.4 + alto * 0.7, 41)
caediza.encab = caediza.encabObj = -Math.PI / 2
caediza.estado = "walk"; caediza.anim = "walk"
caediza.temporizador = 60000
caediza.stats.saciedad = 100
caediza.stats.hidratacion = 100
caediza.pastor = null; caediza.beber = null
caediza.proxBusq = 0; caediza.bloqueado = false
let telecopia20 = false, piesMax20 = 0
let prevPies20 = caediza.y - caediza.bottomH
for (let i = 0; i < 200; i++) {
	escReloj += 33
	window.updateIdentidades()
	const pies20 = caediza.y - caediza.bottomH
	if (pies20 - prevPies20 > 0.61) telecopia20 = true
	prevPies20 = pies20
	if (pies20 > piesMax20) piesMax20 = pies20
}
ok(!telecopia20, "la caida junto al pilote no teletransporta (" +
	(telecopia20 ? "SALTO DE +0,61 EN UN FRAME" : "sin salto") +
	", pies max " + num(piesMax20) + ")")
ok(piesMax20 <= 50.5 + 1e-9, "acaba en el rellano de y=50, no en la cima " +
	"(pies max " + num(piesMax20) + ")")
for (const c of pilote20) world.setBlock(c[0], c[1], c[2], 0)
for (let x = 15; x <= 19; x++) for (let z = 39; z <= 43; z++)
	chunkDe(x >> 4, z >> 4).tops[(z & 15) * 16 + (x & 15)] = 49
window.VXLIdentidades.limpiar()

performance.now = realPerf
window.IDENTIDADES.vaca.objetivo = objetivoReal
window.VXLIdentidades.limpiar()

// skin por bioma en el render: cada vaca dibuja con su propia textura
const vLlanura = window.VXLIdentidades.spawn("vaca", 10, 51, 10)
const vBosque = window.VXLIdentidades.spawn("vaca", 120, 51, 10)
texturasEnlazadas.length = 0
window.renderIdentidades()
const stF = window.VXLIdentidades.estado()
ok(!!vLlanura && !!vBosque && vLlanura.skin !== vBosque.skin
	&& texturasEnlazadas.includes(stF.skins[vLlanura.skin])
	&& texturasEnlazadas.includes(stF.skins[vBosque.skin]),
	"render enlaza la skin de cada bioma (" + vLlanura.skin + " y " +
	vBosque.skin + " entre " + texturasEnlazadas.length + " binds)")
window.VXLIdentidades.limpiar()

// ----------------------------------------------------- guardar + apuntar --
// 1) Datos por entidad: id unico, stats/genoma del ejemplo y bioma origen
const aLlan = window.VXLIdentidades.spawn("vaca", 10, 51, 10)
const bBosque = window.VXLIdentidades.spawn("vaca", 120, 51, 10)
const cDesierto = window.VXLIdentidades.spawn("vaca", 250, 51, 10)
ok(!!aLlan && !!bBosque && !!cDesierto
	&& /^cow_[0-9a-f]{8}$/.test(aLlan.id)
	&& /^cow_[0-9a-f]{8}$/.test(bBosque.id)
	&& aLlan.id !== bBosque.id && bBosque.id !== cDesierto.id,
	"ids unicos cow_XXXXXXXX (" + aLlan.id + ", " + bBosque.id + ", " + cDesierto.id + ")")
ok(aLlan.stats.age === 1.0 && aLlan.stats.gender === "female"
	&& aLlan.stats.weight_kg === 540.2 && aLlan.stats.milk_capacity_l === 18.5
	&& aLlan.stats.is_pregnant === false && aLlan.stats.salud === 100,
	"stats fijas del ejemplo (" + JSON.stringify(aLlan.stats) + ")")
ok(aLlan.genome.coat_matrix_seed === 142857 && aLlan.genome.weight_gene === 0.68
	&& aLlan.genome.milk_gene === 0.52,
	"genoma fijo del ejemplo (" + JSON.stringify(aLlan.genome) + ")")
ok(aLlan.biomeOrigen === "plains" && bBosque.biomeOrigen === "forest"
	&& cDesierto.biomeOrigen === "desert",
	"biomeOrigen segun la posicion (" + aLlan.biomeOrigen + "/" + bBosque.biomeOrigen
	+ "/" + cDesierto.biomeOrigen + ")")

// 2) exportar(): esquema completo por entidad
const exportada = window.VXLIdentidades.exportar()
const claves = ["entity_id", "type", "position", "biome_origin", "texture_variant",
	"encab", "stats", "genome"]
ok(exportada.length === 3
	&& exportada.every(d => claves.every(k => k in d))
	&& exportada.every(d => d.type === "vaca")
	&& exportada.every(d => [d.position.x, d.position.y, d.position.z].every(Number.isFinite)),
	"exportar() da el esquema completo (" + Object.keys(exportada[0]).join(",") + ")")

// 3) Ida y vuelta: restaurar(exportar()) lo recupera TODO
const guardado = JSON.parse(JSON.stringify(exportada)) // sin referencias al vivo
window.VXLIdentidades.limpiar()
ok(window.VXLIdentidades.restaurar(guardado) === 3,
	"restaurar() reinserta las 3 exportadas")
const rt = window.VXLIdentidades.lista()
ok(rt.length === 3 && rt.every((e, i) =>
	e.id === guardado[i].entity_id
	&& e.x === guardado[i].position.x && e.y === guardado[i].position.y
	&& e.z === guardado[i].position.z
	&& e.skin === guardado[i].texture_variant
	&& e.encab === guardado[i].encab
	&& e.biomeOrigen === guardado[i].biome_origin
	&& e.stats.weight_kg === guardado[i].stats.weight_kg
	&& e.genome.coat_matrix_seed === guardado[i].genome.coat_matrix_seed),
	"ida y vuelta: id/pos/skin/rumbo/bioma/stats/genoma intactos")

// El MERGE: lo guardado se sobreescribe sobre los defaults de spawn
// (hoy stats/genoma son iguales para todas, asi que se fuerza un valor
// distinto para demostrar que la fusion funciona).
const especial = JSON.parse(JSON.stringify(guardado))
especial[0].stats.weight_kg = 444.4
especial[0].genome.weight_gene = 0.99
especial[0].stats.saciedad = 42
window.VXLIdentidades.limpiar()
window.VXLIdentidades.restaurar(especial)
const rtEspecial = window.VXLIdentidades.lista()
ok(rtEspecial.length === 3 && rtEspecial[0].stats.weight_kg === 444.4
	&& rtEspecial[0].genome.weight_gene === 0.99
	&& rtEspecial[1].stats.weight_kg === 540.2 && rtEspecial[1].genome.weight_gene === 0.68,
	"restaurar() fusiona stats/genoma guardados sobre los defaults (" +
	rtEspecial[0].stats.weight_kg + "/" + rtEspecial[0].genome.weight_gene + ")")
ok(rtEspecial[0].stats.saciedad === 42 && rtEspecial[1].stats.hidratacion === 100,
	"la saciedad/hidratacion viajan en stats con el save (" +
	rtEspecial[0].stats.saciedad + "/" + rtEspecial[1].stats.hidratacion + ")")

// saves viejos sin esos campos (o JSON corrupto): restaurar pone defaults
window.VXLIdentidades.limpiar()
const sinSed = JSON.parse(JSON.stringify(guardado))
delete sinSed[0].stats.saciedad
delete sinSed[0].stats.hidratacion
window.VXLIdentidades.restaurar(sinSed)
ok(window.VXLIdentidades.lista()[0].stats.saciedad === 100
	&& window.VXLIdentidades.lista()[0].stats.hidratacion === 100,
	"un save sin saciedad/hidratacion restaura a los defaults (100/100)")

// 4) Lo desconocido se salta y restaurar REEMPLAZA la lista previa
window.VXLIdentidades.limpiar()
window.VXLIdentidades.spawn("vaca", 5, 51, 5)
const nRest = window.VXLIdentidades.restaurar([
	{ type: "dragon", position: { x: 1, y: 2, z: 3 } },   // tipo inexistente
	{ type: "vaca" },                                     // sin position
	{ type: "vaca", position: { x: "a", y: 0, z: 0 } },   // posicion invalida
	guardado[0],
])
const listaRest = window.VXLIdentidades.lista()
ok(nRest === 1 && listaRest.length === 1 && listaRest[0].id === guardado[0].entity_id,
	"restaurar() salta lo desconocido y reemplaza la lista (n=" + nRest + ")")

// 5) apuntar(): el rayo frontal da t exacto a la cara del AABB (w=0.35)
window.VXLIdentidades.limpiar()
const objiva = window.VXLIdentidades.spawn("vaca", 10, 51, 10)
const frontal = window.VXLIdentidades.apuntar(10, 51, 0, 0, 0, 1, 16)
ok(!!frontal && frontal.e === objiva && Math.abs(frontal.t - 9.65) < 1e-9,
	"apuntar() frontal da la vaca a t=9,65 (" + (frontal ? num(frontal.t) : "null") + ")")
ok(window.VXLIdentidades.apuntar(20, 51, 0, 0, 0, 1, 16) === null,
	"apuntar() lateral se falla")
ok(window.VXLIdentidades.apuntar(12, 51, 0, 0, 0, 1, 16) === null,
	"apuntar() paralelo al AABB se falla (rama ix=0)")
ok(window.VXLIdentidades.apuntar(10, 51, 20, 0, 0, 1, 16) === null,
	"apuntar() por detras yendo en linea recta se falla")
ok(window.VXLIdentidades.apuntar(10, 51, -10, 0, 0, 1, 5) === null,
	"apuntar() con alcance corto se falla (t=9,65 > 5)")

// 6) gana la mas cercana aunque este la ultima en la lista
window.VXLIdentidades.limpiar()
window.VXLIdentidades.spawn("vaca", 30, 51, 14)              // lejana, indice 0
const cerca = window.VXLIdentidades.spawn("vaca", 30, 51, 6) // la primera en el rayo
const dos = window.VXLIdentidades.apuntar(30, 51, 0, 0, 0, 1, 16)
ok(!!dos && dos.e === cerca && Math.abs(dos.t - 5.65) < 1e-9,
	"apuntar() devuelve la mas cercana (" + (dos ? num(dos.t) : "null") + ")")

// 7) lista vacia -> null
window.VXLIdentidades.limpiar()
ok(window.VXLIdentidades.apuntar(0, 51, 0, 0, 0, 1, 16) === null,
	"apuntar() con el mundo vacio da null")

// 8) render() con entidad apuntada: no lanza y dibuja las 24 aristas del marco
const mirada = window.VXLIdentidades.spawn("vaca", 10, 51, 10)
window.VXLIdentidades.setApuntada(mirada)
drawArraysLlamadas.length = 0
let errCaja = null
try { window.renderIdentidades() } catch (e) { errCaja = e }
const cajas = drawArraysLlamadas.filter(c => c[2] === 24)
ok(errCaja === null && cajas.length === 1,
	"render() con la vaca apuntada no falla y dibuja el marco de 24 aristas (" +
	(errCaja ? String(errCaja) : cajas.length + " drawArrays") + ")")
window.VXLIdentidades.setApuntada(null)
drawArraysLlamadas.length = 0
window.renderIdentidades()
ok(drawArraysLlamadas.filter(c => c[2] === 24).length === 0,
	"sin entidad apuntada no se dibuja el marco")
window.VXLIdentidades.limpiar()

// ------------------------------------------- /vaca: frente + skin forzada --
// El p del mock mira a +Z (direction en el objeto p), suelo en 49 -> 49.5
const skDisp = window.VXLIdentidades.skinsDisponibles()
ok(skDisp.length === 4 && ["Cow1", "Cow2", "Cow3", "Cow4"].every(n => skDisp.includes(n)),
	"skinsDisponibles() lista las 4 (" + skDisp.join(", ") + ")")

const frente = window.VXLIdentidades.spawnFrente("vaca", 3)
ok(!!frente && frente.x === 0 && frente.z === 3,
	"spawnFrente() aparece a 3 bloques por delante (x=" + (frente ? frente.x : "null") +
	", z=" + (frente ? frente.z : "null") + ")")
ok(!!frente && Math.abs((frente.y - frente.bottomH) - 49.5) < 1e-9,
	"spawnFrente() los pies tocan la cara superior del suelo (" +
	(frente ? num(frente.y - frente.bottomH) : "null") + ")")
window.VXLIdentidades.limpiar()

// skin forzada en LLANURA: Cow4 no es de plains, pero manda el argumento
const conSkin = window.VXLIdentidades.spawnFrente("vaca", 3, "Cow4")
ok(!!conSkin && conSkin.skin === "Cow4",
	"spawnFrente() fuerza la skin pedida en plains (salio " +
	(conSkin ? conSkin.skin : "null") + ")")
window.VXLIdentidades.limpiar()

// skin inexistente -> manda la del bioma (plains: Cow1/Cow2)
const malaSkin = window.VXLIdentidades.spawnFrente("vaca", 3, "Cow99")
ok(!!malaSkin && (malaSkin.skin === "Cow1" || malaSkin.skin === "Cow2"),
	"skin inexistente cae a la del bioma (salio " +
	(malaSkin ? malaSkin.skin : "null") + ")")
window.VXLIdentidades.limpiar()

// justo delante hay AGUA (mock: agua en x,z >= 40 y < 80) -> null
const px0 = p.x
const pz0 = p.z
p.x = 44
p.z = 37                      // 3 al frente = (44, 40): columna de agua
const alAgua = window.VXLIdentidades.spawnFrente("vaca", 3)
p.x = px0
p.z = pz0
ok(alAgua === null, "spawnFrente() devuelve null si justo delante hay agua")

console.log(fails ? "\n" + fails + " FALLOS" : "\ntodo OK")
process.exit(fails ? 1 : 0)
