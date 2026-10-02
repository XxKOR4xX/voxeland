// Static checks for the grass/plant integration. Run: node tools/check.mjs
import { readFileSync } from "node:fs"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const src = readFileSync(root + "game.js", "utf8")

let fails = 0
const ok = (cond, msg) => {
	console.log((cond ? "  OK   " : "  FALLO") + " " + msg)
	if (!cond) fails++
}

// --- 1. keys of the `textures` object ---------------------------------
const texBlock = src.split("let textures = {")[1].split("\n\t}")[0]
const texKeys = new Set([...texBlock.matchAll(/(\w+):\s*(?:"|function)/g)].map(m => m[1]))
console.log("texturas registradas: " + texKeys.size)
ok(texKeys.size < 256, `atlas: ${texKeys.size} < 256`)

// --- 2. plantTextureNames vs textures ---------------------------------
const namesBlock = src.match(/const plantTextureNames = \[([^\]]*)\]/)[1]
const plantNames = [...namesBlock.matchAll(/"(\w+)"/g)].map(m => m[1])
console.log("texturas de planta: " + plantNames.length)
for (const n of plantNames) ok(texKeys.has(n), `plantTextureNames -> textures.${n}`)

// --- 3. blocks with variants ------------------------------------------
const blockBlock = src.split("let blockData = [")[1].split("\n\t]")[0]
const blockRe = /\{\s*name:\s*"(\w+)"[\s\S]*?(?=\{\s*name:|\s*$)/g
const blocks = [...blockBlock.matchAll(blockRe)].map(m => m[0])
const plantBlocks = blocks.filter(b => /variants:\s*\[/.test(b))
console.log("bloques con variants: " + plantBlocks.map(b => b.match(/name:\s*"(\w+)"/)[1]).join(", "))
for (const b of plantBlocks) {
	const name = b.match(/name:\s*"(\w+)"/)[1]
	const initial = (b.match(/textures:\s*"(\w+)"/) || [])[1]
	const variants = [...b.match(/variants:\s*\[([^\]]*)\]/)[1].matchAll(/"(\w+)"/g)].map(m => m[1])
	ok(initial === name + "_plains", `${name}: textures inicial = ${initial}`)
	ok(variants.length === 4, `${name}: 4 variantes`)
	for (const v of variants) ok(texKeys.has(v), `${name}: variante ${v} en textures`)
	ok(texKeys.has(name), `${name}: clave base en textures`)
	// every tinted tile the renderer can ask for must exist
	for (const v of variants) {
		for (const biome of ["plains", "forest", "swamp"]) {
			ok(texKeys.has(v), `tinte ${v}_${biome} deriva de ${v}`)
		}
	}
}
ok(plantBlocks.length === 3, "3 bloques de planta")

// --- 4. the tinted tiles really get baked -----------------------------
const tinted = [...src.matchAll(/textureMap\[name \+ "_" \+ biome\] = n/g)].length
ok(tinted === 1, "initTextures registra los tiles tintados")

// --- 5. plantTile() behaves (real source, mocked environment) ---------
const grab = (start, end) => src.slice(src.indexOf(start), src.indexOf(end))
// wp() comes from biome-params.js; the sandbox supplies an empty override so
// the real PLANT_TINTS = Object.assign(defaults, wp(...)) runs with defaults.
const funcs = grab("const PLANT_TINTS = Object.assign({", "\n\tfunction initTextures()")
const textureMap = {}
plantNames.forEach((n, i) => { textureMap[n] = i; textureMap[n + "_plains"] = 100 + i })
const biomeAt = () => "plains"
const wp = () => ({})
const sandbox = new Function("textureMap", "biomeAt", "wp",
	funcs + "\nreturn { plantTile, posHash, plantBiomeSuffix, PLANT_TINTS }")
const { plantTile, posHash, plantBiomeSuffix, PLANT_TINTS } = sandbox(textureMap, biomeAt, wp)

let bad = 0, seen = new Set()
for (let x = -500; x < 500; x += 7) {
	for (let z = -500; z < 500; z += 13) {
		const t = plantTile({ variants: plantNames.slice(0, 4) }, x, z)
		if (textureMap[t] === undefined) bad++
		seen.add(t)
	}
}
ok(bad === 0, `plantTile siempre da un tile existente (${bad} fallos)`)
ok(seen.size === 4, `plantTile usa las 4 variantes (vistas: ${seen.size})`)
for (const p of ["grassPlant", "tallGrassBottom", "tallGrassTop"]) {
	const variants = plantNames.filter(n => n.startsWith(p))
	let wrong = 0, used = new Set()
	ok(variants.length === 4, `${p}: 4 variantes`)
	for (let x = -99; x < 99; x += 3) {
		const t = plantTile({ variants }, x, x * 2)
		if (!t.startsWith(p) || textureMap[t] === undefined) wrong++
		else used.add(t)
	}
	ok(wrong === 0 && used.size === 4, `${p}: variantes correctas (${used.size} de 4, ${wrong} fallos)`)
}
ok(plantBiomeSuffix(1, 1) === "plains", "bioma fallback plains")
ok(posHash(0, 0) === posHash(0, 0) && posHash(1, 0) !== posHash(0, 0), "posHash determinista y no constante")

// --- 6. everything the mesher needs -----------------------------------
ok(/shape\.hitVerts \|\| shape\.verts/.test(src), "rayTrace usa hitVerts")
ok(/sourceData && sourceData\.cross/.test(src), "hideFace no culla las plantas")
ok(/data && data\.passable/.test(src), "collided: passable")
ok(/face\[1\] - py > 0\.6 && e\.previousY - e\.bottomH - y < face\[1\]/.test(src),
	"collided: el snap-Y lleva tope (no teletransporta a la copa)")
ok(/crossQuads\.concat\(crossQuads\.map\(q =>\s*plantQuad\(q\.corners\.slice\(\)\.reverse\(\)/.test(src),
	"las 8 caras: cada plano, doble winding (CULL_FACE BACK)")
ok(/\[\s*\], \/\/ top\s*\[\s*\], \/\/ bottom\s*\[\s*\], \/\/ north\s*crossVerts,/.test(src),
	"toda la geometría cuelga del slot south")
ok(/const crossQuads = \[[\s\S]*?0\.5[\s\S]*?\]/.test(src), "la base del quad está a 0.5px")
ok(/new Float32Array\(900000\)/.test(src), "bigArray ampliado para las plantas")
ok(/shapes\.cross\.hitVerts = shapes\.cube\.verts/.test(src), "cross.hitVerts = cubo")
ok(/baseBlock\.shape = shapes\.cross/.test(src), "initShapes asigna la forma cross")
ok(/weedDensity/.test(src) && /weedTall/.test(src), "parámetros de densidad")
ok(/blockIds\.tallGrassBottom/.test(src), "romper la base limpia la copa")
ok(/hidden: true/.test(src), "tallGrassTop oculto del catálogo")

// --- 7. no biome renders dark green grass -----------------------------
// (the old swamp tint measured 131 of raw luminance; the clear floor is
// 150 — anything at/below it means some biome went dark again.)
const tintLum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b
const parseTints = (text) => {
	const at = text.indexOf("plains: [")
	if (at < 0) return null
	const m = text.slice(at).match(/plains:\s*\[([^\]]+)\][\s\S]*?forest:\s*\[([^\]]+)\][\s\S]*?swamp:\s*\[([^\]]+)\]/)
	if (!m) return null
	const out = {}
	;["plains", "forest", "swamp"].forEach((k, i) => {
		out[k] = [...m[i + 1].matchAll(/0x[0-9a-f]+|\d+/g)].map(v => +v[0])
	})
	return out
}
const tintSources = [
	["game.js (fallback)", PLANT_TINTS],
	["biome-params.js", parseTints(readFileSync(root + "biome-params.js", "utf8"))],
]
for (const [label, t] of tintSources) {
	const lum = t ? ["swamp", "forest", "plains"].map(k => Math.round(tintLum(t[k]))) : null
	const minLum = t ? Math.min(...["plains", "forest", "swamp"].map(k => tintLum(t[k]))) : NaN
	ok(t && t.plains && t.forest && t.swamp
		&& tintLum(t.swamp) >= tintLum(t.forest) && minLum >= 150,
		`${label}: ningún bioma va oscuro (pantano/bosque/llanura = ${lum ? lum.join("/") : "?"}, mín ${t ? Math.round(minLum) : "?"} >= 150)`)
}

// --- 8. tall plant halves stay paired N/N -----------------------------
ok(/plantTile\(block, x2, z2\)/.test(src), "el mesher solo pasa (x, z): misma columna = misma variante")
ok(!/plantTile\(block, x2, y2/.test(src), "plantTile nunca recibe la altura")
const suffixOf = (n) => (n.match(/(\d*)$/)[1] || "1")
const bottomNames = plantNames.filter(n => n.startsWith("tallGrassBottom"))
const topNames = plantNames.filter(n => n.startsWith("tallGrassTop"))
ok(bottomNames.length === 4 && bottomNames.every((b, i) => suffixOf(b) === suffixOf(topNames[i])),
	`pareja bottom N + top N (${bottomNames.map((b, i) => suffixOf(b) || 1).join(",")})`)

// --- 9. swamp: plano, con muchos lagos y poco cesped ------------------
const paramsSrc = readFileSync(root + "biome-params.js", "utf8")
const paramOf = (block, k) => {
	const m = block.match(new RegExp("\\b" + k + ":\\s*([\\d.]+)"))
	return m ? +m[1] : NaN
}
const pantanoBlock = (paramsSrc.match(/pantano:\s*\{([\s\S]*?)\n\t\}/) || [])[1] || ""
const vegBlock = (paramsSrc.match(/densidadPorBioma:\s*\{([\s\S]*?)\}/) || [])[1] || ""

ok(/random\(\)\s*<\s*weedDensityAt\(wx, wz\)/.test(src), "populate: la densidad de hierba es por bioma")
ok(/function weedDensityAt\(x, z\)/.test(src) && /weedDensityByBiome/.test(src),
	"weedDensityAt con respaldo en weedDensity global")
ok(/swampFlattenRamp: wp\("pantano", "rampa", 0\.08\)/.test(src), "rampa del pantano: fallback 0.08")
ok(/swampHumidity\) \/ biomeSettings\.swampFlattenRamp\)/.test(src),
	"swampT usa la rampa parametrizada (sin 0.08 hard-coded)")

const aplanado = paramOf(pantanoBlock, "aplanado")
const boostLagos = paramOf(pantanoBlock, "boostLagos")
const rampa = paramOf(pantanoBlock, "rampa")
ok(aplanado > 0 && aplanado <= 0.15, `pantano.aplanado = ${aplanado} (plano: <= 0.15)`)
ok(boostLagos >= 3, `pantano.boostLagos = ${boostLagos} (muchos lagos: >= 3)`)
ok(rampa > 0 && rampa <= 0.05, `pantano.rampa = ${rampa} (plano ya dentro del bioma: <= 0.05)`)

const densPlains = paramOf(vegBlock, "plains")
const densSwamp = paramOf(vegBlock, "swamp")
ok(densSwamp > 0 && densSwamp < densPlains,
	`pantano con poco cesped: densidadPorBioma ${densSwamp} < ${densPlains}`)

// --- 10. foliage sits at the terrain green (no dark canopy) -----------
// Runs the real `leaves` texture function against a stub setPixel and
// measures the opaque pixels: the canopy must stay at the terrain level
// (~99/255, range 90-120) instead of the old deep green (~69).
const leavesSrc = (src.match(/leaves: function\(n\) \{[\s\S]*?\n\t\t\}/) || [])[0] || ""
let leavesLum = NaN
if (leavesSrc) {
	const px = []
	const bindLeaves = new Function("setPixel", "return { " + leavesSrc + " }.leaves")
	const leavesFn = bindLeaves((n, x, y, r, g, b, a) => px.push(r, g, b, a))
	leavesFn(0)
	let sum = 0, count = 0
	for (let i = 0; i < px.length; i += 4) {
		if (px[i + 3] >= 200) {
			sum += tintLum([px[i], px[i + 1], px[i + 2]])
			count++
		}
	}
	if (count) leavesLum = sum / count
}
ok(leavesSrc && Number.isFinite(leavesLum) && leavesLum >= 90 && leavesLum <= 120,
	`hojas claras: luz media ${Number.isFinite(leavesLum) ? Math.round(leavesLum) : "?"} (90-120, terreno ~99)`)

// --- 11. plant quads: uniform shadow + light bottom half ---------------
// The cross quads list their corners [LOW, LOW, HIGH, HIGH], the reverse
// of the cubes, so getShadows.south used to land the 0.665 AO on the top
// corners (a dark band at the waist of the double plant). Plants now use a
// flat 0.95 and the bottom textures sit at the tops' level (~150, the old
// ones measured 121).
ok(/const CROSS_SHADOW = \[\s*0\.95,\s*0\.95,\s*0\.95,\s*0\.95\s*\]/.test(src),
	"CROSS_SHADOW uniforme 0.95")
ok(/block\.cross \? CROSS_SHADOW : getShadows\[side\]/.test(src),
	"genMesh: las plantas no heredan el AO invertido de getShadows")

// Port of game.js getPixels: base36 literal -> RGBA pixels.
const b36chars = "0123456789abcdefghijklmnopqrstuvwxyz"
const b36num = (s) => { let n = 0; for (const c of s) n = n * 36 + b36chars.indexOf(c); return n }
const decodeB36 = (s) => {
	let d = 0
	while (s[4 + d] === "0") d++
	const ccount = b36num(s.slice(4 + d, 5 + d + d))
	const colors = []
	for (let i = 0; i < ccount; i++)
		colors.push(b36num(s.slice(5 + 2 * d + i * 7, 12 + 2 * d + i * 7)))
	const px = []
	for (const ch of s.slice(5 + 2 * d + ccount * 7)) {
		const v = colors[b36num(ch)]
		px.push([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])
	}
	return px
}
for (const key of ["tallGrassBottom", "tallGrassBottom2", "tallGrassBottom3", "tallGrassBottom4"]) {
	const str = (texBlock.match(new RegExp("\\b" + key + ':\\s*"([0-9a-z]+)"')) || [])[1]
	let mean = NaN
	if (str) {
		const px = decodeB36(str)
		let sum = 0, n = 0
		for (const [r, g, b, a] of px) if (a >= 200) { sum += tintLum([r, g, b]); n++ }
		if (n) mean = sum / n
	}
	ok(Number.isFinite(mean) && mean >= 140,
		`${key} claro: luz media ${Number.isFinite(mean) ? Math.round(mean) : "?"} (>= 140, copa ~150)`)
}

// --- 12. entidad: guardar, rayo y panel de inspeccion -------------------
const htmlSrc = readFileSync(root + "index.html", "utf8")
ok(/identidades: window\.VXLIdentidades && window\.VXLIdentidades\.exportar/.test(src),
	"save() guarda las entidades en el record del mundo")
ok(/V\.restaurar\(data\.identidades\)/.test(src),
	"al cargar se restauran las entidades del record")
ok(/const ALC_ENTIDAD = 16/.test(src)
	&& /VXLIdentidades\.apuntar\(p\.x, p\.y, p\.z, pd\.x, pd\.y, pd\.z, ALC_ENTIDAD\)/.test(src),
	"lookingAt() lanza el rayo de entidades con ALC_ENTIDAD = 16")
ok(/hitEnt\.t < hitBox\.closest\)\s*\{\s*hitBox\.pos = null/.test(src),
	"la entidad mas cercana apaga el marco/romper/colocar del bloque")
ok(/k === "h"/.test(src), "la tecla H abre/cierra el panel detallado")
ok(/id="ui-entidad"/.test(htmlSrc) && /getElementById\("ui-entidad"\)/.test(src),
	"index.html define #ui-entidad y game.js lo usa")

// --- 13. comando /vaca: spawn frontal + skin elegible -------------------
ok(/spawnFrente\("vaca", 3/.test(src),
	"/vaca spawnea con spawnFrente a 3 bloques")
ok(/\/vaca \[cow1-cow4\]/.test(src),
	"/help documenta /vaca [cow1-cow4]")
ok(/skinsDisponibles\(\)/.test(src),
	"/vaca valida el argumento contra skinsDisponibles()")

// --- 14. panel: saciedad e hidratacion ------------------------------------
ok(/uiFila\("Saciedad"/.test(src),
	"el panel de entidad muestra la saciedad")
ok(/uiFila\("Hidratacion"/.test(src),
	"el panel de entidad muestra la hidratacion")

// --- 15. HUD de survival: sprites de corazon y corazones del mob ---------
// Las rutas se declaran en loadHeartImg(); comprueba que el PNG existe de
// verdad en disco (si no, el juego caeria al corazon procedural sin avisar).
const heartSrc = src.match(/loadHeartImg\("(\w+)", "([^"]+)"\)/g) || []
ok(heartSrc.length === 3, `game.js carga 3 sprites de corazon (${heartSrc.length})`)
const heartKeys = new Set()
for (const line of heartSrc) {
	const m = line.match(/loadHeartImg\("(\w+)", "([^"]+)"\)/)
	heartKeys.add(m[1])
	const ruta = root + m[2]
	let bytes = null
	try { bytes = readFileSync(ruta) } catch { bytes = null }
	ok(bytes && bytes.length > 100 && bytes.slice(1, 4).toString() === "PNG",
		`existe y es PNG: ${m[2]}`)
}
for (const k of ["full", "half", "empty"]) ok(heartKeys.has(k), `sprite "${k}" cargado`)
ok(/encodeURI\(path\)/.test(src), "las rutas pasan por encodeURI (las carpetas llevan espacios)")
ok(/imageSmoothingEnabled = false/.test(src),
	"imageSmoothingEnabled = false (los sprites 16px no se pixelan al escalarlos)")

// drawHealthBar() usa sprites con fallback procedural
const barSrc = src.slice(src.indexOf("function drawHealthBar"), src.indexOf("function proyectarHud"))
ok(/drawHeartSprite\("empty"/.test(barSrc) && /drawHeartSprite\("full"/.test(barSrc)
	&& /drawHeartSprite\("half"/.test(barSrc),
	"drawHealthBar() pinta los 3 estados con sprite")
ok(/drawHeart\(x, y, size, fill\)/.test(barSrc),
	"drawHealthBar() cae a drawHeart() procedural si el sprite aun no cargo")
ok(/let size = s \* 0\.75/.test(barSrc),
	"corazones del player grandes: 75% del slot (antes 50%)")
ok(/let y = height - s \* 2\.55/.test(barSrc),
	"la fila agrandada sigue sin pisar el hotbar (mismo margen de 0.3s)")

// drawMobHearts(): proyeccion + fila de 4 corazones fijos
const mobSrc = src.slice(src.indexOf("function drawMobHearts"), src.indexOf("function drawBreakRing"))
ok(/proyectarHud\(/.test(mobSrc), "drawMobHearts() proyecta la cabeza con proyectarHud()")
ok(/p\.canSee\(e\.x, pies, e\.z, pies \+ e\.ficha\.alto\)/.test(mobSrc),
	"los corazones del mob se ocultan detras de bloques (p.canSee)")
ok(/const total = 4/.test(mobSrc), "el mob muestra 4 corazones, no 10")
ok(/pixelesPorBloque\(m, e\.x, pies \+ e\.ficha\.alto, e\.z, height\)/.test(mobSrc),
	"el tamaño se mide con el bloque proyectado de la vaca (crece al acercarse)")
ok(/ppb \* 0\.25/.test(mobSrc), "cada corazon es 1/4 del bloque proyectado")
ok(/Math\.max\(inventory\.size \/ 5, Math\.min\(inventory\.size \* 2,/.test(mobSrc),
	"el tamaño queda acotado (s/5..s*2): legible lejos, sin llenar la pantalla encima")
ok(/const cy = pt\.y - size/.test(mobSrc),
	"la fila cuelga hacia arriba desde la coronilla (pegada a la cabeza a cualquier distancia)")
ok(!/fillRect/.test(mobSrc), "sin recuadro negro detras de los corazones del mob")
ok(/salud - i \* 25/.test(mobSrc),
	"cada corazon del mob representa 25 de stats.salud")
ok(/entidadApuntada\(\)/.test(mobSrc), "los corazones salen de la entidad apuntada")
ok(/ctx\.drawImage\(gl\.canvas, 0, 0\)[\s\S]{0,200}drawHotbarBadges\(\)[\s\S]{0,80}drawMobHearts\(\)/.test(src),
	"drawMobHearts() se llama tras drawHotbarBadges() (el icono no lo tapa)")

// Repintar el HUD mientras se apunta (si no, los corazones se quedan clavados)
ok(/heartsMobPrev/.test(src)
	&& /\(eAp \|\| heartsMobPrev\) && !freezeFrame\)\s*\{\s*updateHUD = true/.test(src),
	"mientras hay entidad apuntada se fuerza updateHUD a cada frame")
ok(/heartsMobPrev = eAp/.test(src),
	"heartsMobPrev recuerda la entidad del frame anterior para borrarla")

// proyectarHud(): unidad de la proyeccion 3D->2D.  Se contrasta contra el
// getMatrix()/transform() REALES del juego (no contra una matriz inventada),
// porque proyectarHud() asume los indices column-major que sube GL.
const proySrc = src.slice(src.indexOf("function proyectarHud"), src.indexOf("function drawMobHearts"))
const proy = new Function(proySrc + "\nreturn proyectarHud")()
{
	// vista = identidad, proyeccion ortografica trivial: x->ndc_x, y->ndc_y,
	// w = 1 para cualquier z.  Punto (0,0) -> centro de pantalla.
	const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
	const c = proy(id, 0, 0, -5, 800, 600)
	ok(c && Math.abs(c.x - 400) < 1e-6 && Math.abs(c.y - 300) < 1e-6,
		`proyectarHud: el origen cae en el centro (${c ? Math.round(c.x) + "," + Math.round(c.y) : "null"})`)
	// ndc x = 1 (borde derecho) -> x = ancho; ndc y = -1 -> y = alto
	const r = proy(id, 1, -1, -5, 800, 600)
	ok(r && Math.abs(r.x - 800) < 1e-6 && Math.abs(r.y - 600) < 1e-6,
		`proyectarHud: ndc (1,-1) -> esquina inf-der (${r ? Math.round(r.x) + "," + Math.round(r.y) : "null"})`)
	// w <= 0: detras de la camara -> null (nada de corazones al reves)
	const b = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1]
	ok(proy(b, 0, 0, 5, 800, 600) === null, "proyectarHud: w<=0 (detrás) devuelve null")
	ok(proy(id, 1.5, 0, -5, 800, 600) === null, "proyectarHud: fuera de pantalla devuelve null")

	// Con la matriz de verdad: camara en (10,50,-20) mirando al este (ry=-90°),
	// FOV 70, 1280x720.  getMatrix() y transform() se extraen tal cual.
	const gmSrc = src.slice(src.indexOf("getMatrix() {"), src.indexOf("setDirection() {"))
	const getMatrix = new Function("matrix", "return {" + gmSrc + "}.getMatrix")(new Float32Array(16))
	const mSrc = src.slice(src.indexOf("class Matrix {"), src.indexOf("class Plane {"))
		+ "\n" + src.match(/let defaultTransformation = new Matrix\(\[[^\]]*\]\)/)[0]
	const trSrc = src.slice(src.indexOf("\t\ttransform() {"), src.indexOf("\t\tgetMatrix() {"))
		.trim().replace(/^transform\(\) \{/, "").replace(/\}$/, "")
	const real = new Function(mSrc
		+ "\nreturn { Matrix, transform: function(){" + trSrc + "} }")()
	const tang = Math.tan(70 * Math.PI / 360)
	const cam = {
		x: 10, y: 50, z: -20, rx: 0, ry: -Math.PI / 2,   // mira a +X
		projection: new Float32Array([1 / tang / 1280 * 720, 1 / tang, -1, -1, -1]),
		transformation: new real.Matrix(),
	}
	real.transform.call(cam)
	const mr = new Float32Array(getMatrix.call(cam))
	const frente = proy(mr, 16, 50, -20, 1280, 720)   // 6 bloques al frente
	ok(frente && Math.abs(frente.x - 640) < 1 && frente.y > 350 && frente.y < 370,
		`proyectarHud+getMatrix: el centro de la mira cae en (${frente ? Math.round(frente.x) + "," + Math.round(frente.y) : "null"})`)
	const arriba = proy(mr, 16, 52, -20, 1280, 720)
	ok(arriba && arriba.y < frente.y, "proyectarHud+getMatrix: arriba de la vaca sube en pantalla")
	const izq = proy(mr, 16, 50, -22, 1280, 720)
	ok(izq && izq.x < frente.x, "proyectarHud+getMatrix: a la izquierda baja la x")
	ok(proy(mr, 10, 50, -21, 1280, 720) === null, "proyectarHud+getMatrix: detras de la camara devuelve null")
	// pixelesPorBloque(): la regla con la que escalan los corazones del mob.
	// Se extrae y se prueba contra la misma matriz real de getMatrix().
	const ppbSrc = src.slice(src.indexOf("function pixelesPorBloque"), src.indexOf("function drawMobHearts"))
	const ppb = new Function(ppbSrc + "\nreturn pixelesPorBloque")()
	ok(ppb(id, 0, 0, -5, 720) === 360, "pixelesPorBloque: con la identidad un bloque mide h/2 px (360)")
	// camara real a 6 y 12 bloques: el doble de distancia = mitad de px/bloque
	const pb6 = ppb(mr, 16, 50, -20, 720)
	const pb12 = ppb(mr, 22, 50, -20, 720)
	ok(pb6 > 0 && pb12 > 0 && Math.abs(pb6 / pb12 - 2) < 0.03,
		`pixelesPorBloque: el doble de distancia = mitad de px/bloque (${pb6 && pb12 ? (pb6 / pb12).toFixed(2) : "?"}, ${Math.round(pb6)}px a 6 bloques)`)
	ok(pb6 > 80 && pb6 < 90,
		`pixelesPorBloque: 6 bloques a FOV70/720p ~ 86px (${Math.round(pb6)}px)`)
	// la fila de 4 corazones cabe en pantalla al proyectar una vaca a 6
	// bloques: size = ppb/4 ~ 21px, se cuelga hacia ARRIBA desde la coronilla.
	const w = proy(mr, 16, 51.65, -20, 1280, 720)
	const hsize = Math.max(48 / 5, Math.min(48 * 2, pb6 * 0.25))
	const filaW = 4 * (hsize + hsize / 8) - hsize / 8
	const sx = w.x - filaW / 2
	ok(w && sx >= 0 && sx + filaW <= 1280 && w.y - hsize >= 0 && w.y <= 720,
		`proyectarHud: la fila de 4 corazones cabe en pantalla (x ${Math.round(sx)}..${Math.round(sx + filaW)}, size ${Math.round(hsize)}px)`)
	// media y una septima parte del tamano: los corazones quedan legibles
	ok(hsize >= 48 / 5 - 1e-9, `el corazon a 6 bloques supera el minimo (${Math.round(hsize)}px >= 10px)`)
}

console.log(fails ? `\n${fails} FALLOS` : "\ntodo OK")
process.exit(fails ? 1 : 0)
