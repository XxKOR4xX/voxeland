// Static checks for the grass/plant integration. Run: node tools/check.mjs
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const src = readFileSync(root + "game.js", "utf8")
// ProcBlocks: la misma librería de tiles procedurales que carga el juego.
// Las funciones de textura de game.js la consumen vía procTile/procPixels.
const ProcBlocks = createRequire(import.meta.url)("../png/blocks/procedural_blocks.js")

let fails = 0
const ok = (cond, msg) => {
	console.log((cond ? "  OK   " : "  FALLO") + " " + msg)
	if (!cond) fails++
}

// --- 1. keys of the `textures` object ---------------------------------
const texBlock = src.split("let textures = {")[1].split("\n\t}")[0]
const texKeys = new Set([...texBlock.matchAll(/(\w+):\s*(?:"|function)/g)].map(m => m[1]))
console.log("texturas registradas: " + texKeys.size)

// --- 2. plantTextureNames vs textures ---------------------------------
const namesBlock = src.match(/const plantTextureNames = \[([^\]]*)\]/)[1]
const plantNames = [...namesBlock.matchAll(/"(\w+)"/g)].map(m => m[1])
console.log("texturas de planta: " + plantNames.length)
for (const n of plantNames) ok(texKeys.has(n), `plantTextureNames -> textures.${n}`)

// --- 1b. presupuesto del atlas: tiles realmente horneados -------------
// claves + tintes de planta (3 biomas) + (PROC_VARIANTS-1) por textura
// proc + (PROC_VARIANTS-1) por hoja del generador + (STRING_VARIANTS-1)
// como mucho por textura b36 que no sea planta.
const procTexCount = [...texBlock.matchAll(/\bprocTile\(/g)].length
const hojaTexCount = [...texBlock.matchAll(/\bhojaTile\(/g)].length
const PROC_VARIANTS = Number((src.match(/const PROC_VARIANTS = (\d+)/) || [])[1]) || 1
const STRING_VARIANTS = Number((src.match(/const STRING_VARIANTS = (\d+)/) || [])[1]) || 1
const textureSize = Number((src.match(/const TEXTURE_SIZE = (\d+)/) || [])[1]) || 256
const capacity = (textureSize / 16) ** 2
const stringKeys = [...texBlock.matchAll(/(\w+):\s*"/g)].map(m => m[1])
const stringVarCount = stringKeys.filter(k => !plantNames.includes(k)).length
const baked = texKeys.size + plantNames.length * 3 + procTexCount * (PROC_VARIANTS - 1)
	+ hojaTexCount * (PROC_VARIANTS - 1) + stringVarCount * (STRING_VARIANTS - 1)
console.log(`tiles horneados: <= ${baked} de ${capacity} (${texKeys.size} claves + ${plantNames.length * 3} tintes + ${procTexCount}x${PROC_VARIANTS - 1} proc + ${hojaTexCount}x${PROC_VARIANTS - 1} hojas + ${stringVarCount}x${STRING_VARIANTS - 1} b36)`)
ok(baked <= capacity, `atlas: <= ${baked} tiles horneados <= ${capacity}`)
ok(procTexCount > 0, `texturas ProcBlocks registradas (${procTexCount})`)
ok(hojaTexCount === 8, `ocho hojas del generador: roble, abedul, florada, pantano y sus discos (${hojaTexCount})`)
ok(/const STRING_FLIPS = /.test(src) && /plantTextureNames\.indexOf\(i\) < 0/.test(src),
	"las b36 toman variantes por simetria (las plantas se quedan con las suyas)")

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
ok(/new Float32Array\(1200000\)/.test(src), "bigArray ampliado para las plantas y el arbusto")
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
// Runs the REAL leaf functions (game.js -> hojaTile: el port del
// generador de arbustos) against a stub setPixel and measures the
// opaque pixels: the three canopies (oak, birch and the blossomed one)
// must stay at the terrain level.  The blossomed canopy is brighter BY
// DESIGN (it carries flowers): its range is 90-130.
const leavesSrc = (src.match(/leaves: function\(n(?:, ?v)?\) \{[\s\S]*?\n\t\t\}/) || [])[0] || ""
const birchSrc = (src.match(/birchLeaves: function\(n(?:, ?v)?\) \{[\s\S]*?\n\t\t\}/) || [])[0] || ""
const blossomSrc = (src.match(/blossomLeaves: function\(n(?:, ?v)?\) \{[\s\S]*?\n\t\t\}/) || [])[0] || ""
const leavesDiscSrc = (src.match(/leavesDisc: function\(n(?:, ?v)?\) \{[\s\S]*?\n\t\t\}/) || [])[0] || ""
const procSrc = src.slice(src.indexOf("function procPixels("), src.indexOf("\n\tlet textures = {"))
let hojaRoble = NaN, hojaAbedul = NaN, hojaFlor = NaN
let semillasDistintas = false, petalosRosa = false, mascaraDisco = false
if (leavesSrc && birchSrc && blossomSrc && leavesDiscSrc && procSrc.includes("function hojaTile(")) {
	const px = []
	// procSrc arrastra TODO (rngHoja, hsl2rgb, PALETAS_HOJA, florBlossom,
	// hojaTile y los consts HUECOS_HOJA/FLOR_ROSA): el bind es directo.
	const bindHojas = new Function("setPixel",
		procSrc + "\nreturn { " + leavesSrc + ",\n" + birchSrc + ",\n" + blossomSrc
		+ ",\n" + leavesDiscSrc + " }")
	const hojas = bindHojas((n, x, y, r, g, b, a) => px.push(r, g, b, a))
	const luzCopa = () => {
		let sum = 0, count = 0
		for (let i = 0; i < px.length; i += 4) {
			if (px[i + 3] >= 200) {
				sum += tintLum([px[i], px[i + 1], px[i + 2]])
				count++
			}
		}
		return count ? sum / count : NaN
	}
	hojas.leaves(0, 0)
	const v0 = px.slice()
	hojaRoble = luzCopa()
	px.length = 0
	hojas.leaves(0, 1)
	const v1 = px.slice()
	px.length = 0
	hojas.leaves(0, 2)
	const v2 = px.slice()
	// cada semilla es un tile distinto (v0 vs v1, v1 vs v2, v0 vs v2)
	semillasDistintas = [v1, v2].every(o => o.length === v0.length
		&& o.some((q, i) => q !== v0[i]))
		&& v1.length === v2.length && v1.some((q, i) => q !== v2[i])
	px.length = 0
	hojas.birchLeaves(0, 0)
	hojaAbedul = luzCopa()
	px.length = 0
	hojas.blossomLeaves(0, 0)
	hojaFlor = luzCopa()
	// petalos rosa del blossom: con la densidad al 25% (0-1 por tile) se
	// miran las 8 variantes y basta que varias lleven flor
	px.length = 0
	hojas.blossomLeaves(0, 0)
	hojaFlor = luzCopa()
	let conFlor = 0
	for (let v = 0; v < PROC_VARIANTS; v++) {
		px.length = 0
		hojas.blossomLeaves(0, v)
		if (px.some((q, i) => i % 4 === 0 && px[i + 3] >= 200 && q > px[i + 1] + 30)) conFlor++
	}
	petalosRosa = conFlor >= 2
	px.length = 0
	hojas.leavesDisc(0, 0)
	// mascara circular: las 4 esquinas transparentes y ~la area del
	// circulo en pixeles opacos (menos que el tile entero)
	let opacosDisco = 0
	for (let i = 3; i < px.length; i += 4) if (px[i] >= 200) opacosDisco++
	mascaraDisco = px[3] === 0 && px[63] === 0 && px[963] === 0 && px[1023] === 0
		&& opacosDisco > 100 && opacosDisco < 180
}
ok(Number.isFinite(hojaRoble) && hojaRoble >= 90 && hojaRoble <= 120,
	`copa de roble clara: luz media ${Number.isFinite(hojaRoble) ? Math.round(hojaRoble) : "?"} (90-120, terreno ~99)`)
ok(Number.isFinite(hojaAbedul) && hojaAbedul >= 90 && hojaAbedul <= 120,
	`copa de abedul clara: luz media ${Number.isFinite(hojaAbedul) ? Math.round(hojaAbedul) : "?"} (90-120)`)
ok(Number.isFinite(hojaFlor) && hojaFlor >= 90 && hojaFlor <= 130,
	`copa florada brillante: luz media ${Number.isFinite(hojaFlor) ? Math.round(hojaFlor) : "?"} (90-130: lleva flores)`)
ok(semillasDistintas, "las semillas del generador cambian de verdad el tile")
ok(petalosRosa, "la copa florada lleva petalos rosa (blossom estampado)")
ok(mascaraDisco, "el tile de disco lleva la mascara circular (esquinas transparentes)")

// --- 10b. variantes por posicion (modo 'variants' de ProcBlocks) -------
// Cada textura proc se hornea PROC_VARIANTS veces con semillas distintas:
// si dos variantes salieran identicas, el muro repetiria igual.
const procTypes = [...texBlock.matchAll(/procTile\(n, "(\w+)"/g)].map(m => m[1])
const bindProc = new Function("ProcBlocks",
	src.slice(src.indexOf("function procPixels("), src.indexOf("\n\tfunction procTile("))
	+ "\nreturn procPixels")
const procPixels = bindProc(ProcBlocks)
const clonadas = []
for (const t of procTypes) {
	const vs = []
	for (let v = 0; v < PROC_VARIANTS; v++) vs.push(procPixels(t, v))
	let maxDiff = 0
	for (let a = 0; a < vs.length; a++) {
		for (let b = a + 1; b < vs.length; b++) {
			let d = 0
			for (let i = 0; i < 1024; i++) if (vs[a][i] !== vs[b][i]) d++
			if (d > maxDiff) maxDiff = d
		}
	}
	if (maxDiff < 8) clonadas.push(`${t} (${maxDiff} B)`)
}
ok(clonadas.length === 0, `las ${procTypes.length} texturas proc tienen variantes distintas (${clonadas.join(", ")})`)

// el mesher elige la variante segun la posicion del bloque
ok(/let vi = plant \? 0 : posHash3\(x2, y2, z2\) % PROC_VARIANTS/.test(src),
	"genMesh: la variante sale de posHash3(x2, y2, z2)")
ok(/let vars = plant \? null : variantTiles\[texName\]/.test(src)
	&& /let texIndex = vars \? vars\[vi % vars\.length\] : textureMap\[texName\]/.test(src),
	"genMesh: los cubos usan variantTiles (las plantas siguen con plantTile)")
// posHash3: determinista, sensible a las 3 coordenadas y reparte variantes
const posHash3 = new Function("return " + src.match(/function posHash3\(x, y, z\) \{[\s\S]*?\n\t\}/)[0])()
const vistos = new Set()
for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) vistos.add(posHash3(x, 7, z) % PROC_VARIANTS)
ok(posHash3(3, 4, 5) === posHash3(3, 4, 5) && posHash3(3, 4, 5) !== posHash3(4, 4, 5)
	&& posHash3(3, 4, 5) !== posHash3(3, 5, 5) && posHash3(3, 4, 5) !== posHash3(3, 4, 6),
	"posHash3 determinista y sensible a x, y, z")
ok(vistos.size === PROC_VARIANTS, `posHash3 reparte las ${PROC_VARIANTS} variantes (vistas ${vistos.size})`)

// --- 10c. UVs de las caras escalan con el tamano del atlas ---------------
// Si el atlas crece y los UVs de initShapes se quedan al divisor viejo,
// cada cara muestra trozos de los tiles vecinos (texturas de otros
// materiales mezcladas por todo el mundo).
{
	const mapCoordsSrc = src.match(/function mapCoords\(rect, face\) \{[\s\S]*?\n\t\t\}/)[0]
	const mapQuadSrc = src.match(/function mapQuad\(rect\) \{[\s\S]*?\n\t\t\}/)[0]
	const bindMaps = new Function("TEXTURE_SIZE", "compareArr",
		mapCoordsSrc + "\n" + mapQuadSrc + "\nreturn { mapCoords, mapQuad }")
	const { mapCoords, mapQuad } = bindMaps(textureSize, (a) => a.slice())
	const tile = 16 / textureSize   // lo que mide UN tile en UV
	const face = mapCoords({ x: 0, y: 0, z: 0, w: 16, h: 16, tx: 0, ty: 0 }, 1)
	const maxDelta = Math.max(...face.tex)
	ok(Math.abs(maxDelta - tile) < 1e-9,
		`mapCoords: una cara completa abarca un tile (${maxDelta.toFixed(5)} = 16/${textureSize})`)
	const quad = mapQuad({ corners: [0, 0, 0, 16, 0, 16, 16, 16, 16, 0, 0, 0], uv: [0, 16, 16, 16, 16, 0, 0, 0] })
	const maxQuad = Math.max(...quad.tex)
	ok(Math.abs(maxQuad - tile) < 1e-9,
		`mapQuad: el quad de la planta abarca un tile (${maxQuad.toFixed(5)})`)
	ok(/c \/ 16 \/ \(TEXTURE_SIZE \/ 16\)/.test(src) && /rect\.uv\.map\(c => c \/ TEXTURE_SIZE\)/.test(src),
		"los divisores UV usan TEXTURE_SIZE (ningun 256 ni 16/16 suelto)")
}

// --- 10d. copa del generador: asterisco (4 discos + el horizontal) ------
// 4 discos verticales a 0/45/90/135 (radio 1.0 bloque) + el horizontal a
// media altura.  Los discos coplanares de vecinos SI se solapan (es la
// forma del asterisco): el mesher los separa a lo largo de su normal con
// ((x+y+z) mod 3) * 0.03 — dos vecinos con discos coplanares siempre
// difieren en la suma (1 o 2), nunca coinciden.  Colision: hitVerts (el
// cubo), nunca los discos.
{
	const planeSrc = src.match(/const bushPlanes = \(\(\) => \{[\s\S]*?\n\t\}\)\(\)/)[0]
	const planos = new Function("plantQuad", planeSrc + "\nreturn bushPlanes")(
		(c, u, t) => ({ corners: c, uv: u, tex: t }))
	const total = Object.values(planos).reduce((a, l) => a + l.length, 0)
	ok(total === 5, `bushPlanes trae los 4 discos del asterisco + el horizontal (${total})`)
	ok(planos.bottom.length === 0, "nada asoma por debajo del bloque")
	const fuera = []
	for (const [slot, list] of Object.entries(planos)) {
		for (const q of list) {
			if (q.corners.length !== 12 || q.uv.length !== 8) fuera.push(`${slot}: ${q.corners.length}/12 corners`)
			if (q.tex !== "DISC") fuera.push(`${slot}: tex ${q.tex} (deberia pedir el tile de disco)`)
			for (const c of q.corners) if (c < -9 || c > 25) fuera.push(`${slot}: corner ${c}`)
			for (const u of q.uv) if (u < -0.01 || u > 16.01) fuera.push(`${slot}: uv ${u}`)
		}
	}
	ok(fuera.length === 0, "discos sanos: 4 esquinas, UVs en el tile, piden DISC (" + fuera.slice(0, 3).join("; ") + ")")
	// asterisco: 4 discos verticales que SOBRESALEN (radio 1.0 bloque)
	for (const slot of ["north", "east", "west", "south"]) {
		for (const q of planos[slot]) {
			const xs = [], ys = [], zs = []
			for (let i = 0; i < 12; i += 3) { xs.push(q.corners[i]); ys.push(q.corners[i + 1]); zs.push(q.corners[i + 2]) }
			if (Math.max(...xs) <= 16 && Math.min(...xs) >= 0 && Math.max(...ys) <= 16
				&& Math.min(...ys) >= 0 && Math.max(...zs) <= 16 && Math.min(...zs) >= 0) {
				fuera.push(`${slot}: disco dentro del cubo (no sobresale)`)
			}
		}
	}
	const alcance = Math.max(...planos.north[0].corners)
	ok(alcance >= 23.9, `discos grandes: radio 1.0 bloque (${(alcance - 8).toFixed(1)} px desde el centro)`)
	// el horizontal: a media altura y del tamaño de los verticales
	// (radio 1.0: ASOMA del bloque y se ve; con radio 8 quedaba
	// escondido tras los huecos de las caras del cubo)
	{
		const q = planos.top[0]
		const mediaAltura = [1, 4, 7, 10].every(i => Math.abs(q.corners[i] - 8) < 1e-9)
		const asoma = Math.max(...q.corners) >= 23.9 && Math.min(...q.corners) <= -7.9
		ok(mediaAltura && asoma,
			"el disco horizontal a media altura (y=8) y con radio 1.0: asoma del bloque y SE VE")
	}
	// el giro del asterisco: 0/45/90/135 (PI*k/4), no la variante girada
	ok(/const a = Math\.PI \* k \/ 4/.test(planeSrc), "asterisco: los discos van a 0/45/90/135 grados")

	// ANTI-PARPADEO: los pares coplanares entre vecinos existen (la
	// forma lo pide) pero el desplazamiento del mesher los separa:
	// h = (x+2y+4z) mod 8, y para las 26 direcciones vecinas el delta
	// de h NUNCA es 0 mod 8 -> coplanares siempre a desplazamientos
	// distintos -> sin coincidencia, sin z-fighting.
	const planoDe = (q) => {
		const c = q.corners
		const u = [c[3] - c[0], c[4] - c[1], c[5] - c[2]]
		const v = [c[6] - c[3], c[7] - c[4], c[8] - c[5]]
		const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
		const len = Math.hypot(n[0], n[1], n[2]) || 1
		const nn = [n[0] / len, n[1] / len, n[2] / len]
		return { n: nn, d: nn[0] * c[0] + nn[1] * c[1] + nn[2] * c[2] }
	}
	const caja = (q, o) => {
		const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
		for (let i = 0; i < 12; i += 3) for (let a = 0; a < 3; a++) {
			const val = q.corners[i + a] + o[a]
			if (val < mn[a]) mn[a] = val
			if (val > mx[a]) mx[a] = val
		}
		return { mn, mx }
	}
	const todos = []
	for (const list of Object.values(planos)) for (const q of list) todos.push(q)
	// las 26 direcciones vecinas (alcance del disco = 1 bloque)
	const vecinos = []
	for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
		if (dx || dy || dz) vecinos.push([dx * 16, dy * 16, dz * 16])
	}
	ok(vecinos.length === 26, `las ${vecinos.length} direcciones vecinas cubren todo el alcance de los discos`)
	// primera: el delta de h nunca es 0 para NINGUN direccion
	const huecos = vecinos.filter(o => ((o[0] / 16 + 2 * (o[1] / 16) + 4 * (o[2] / 16)) % 8 + 8) % 8 === 0)
	ok(huecos.length === 0, `el hash (x+2y+4z) mod 8 separa TODAS las direcciones vecinas (${huecos.length} huecos)`)
	const peleas = []
	let coplanares = 0
	for (const off of vecinos) {
		for (const qA of todos) {
			const pA = planoDe(qA)
			const cA = caja(qA, [0, 0, 0])
			const ejeN = [0, 1, 2].reduce((a, b) => Math.abs(pA.n[b]) > Math.abs(pA.n[a]) ? b : a)
			for (const qB of todos) {
				const pB = planoDe(qB)
				const dot = pA.n[0] * pB.n[0] + pA.n[1] * pB.n[1] + pA.n[2] * pB.n[2]
				if (Math.abs(Math.abs(dot) - 1) > 1e-6) continue
				let nB = pB.n, dB = pB.d
				if (dot < 0) { nB = [-pB.n[0], -pB.n[1], -pB.n[2]]; dB = -pB.d }
				dB = dB + nB[0] * off[0] + nB[1] * off[1] + nB[2] * off[2]
				if (Math.abs(dB - pA.d) > 1e-6) continue
				const cB = caja(qB, off)
				let solapan = true
				for (const i of [0, 1, 2]) {
					if (i === ejeN) continue
					if (cA.mx[i] <= cB.mn[i] || cB.mx[i] <= cA.mn[i]) { solapan = false; break }
				}
				if (!solapan) continue
				coplanares++
				// par coplanar con solape: el delta de h (en BLOQUES)
				// tiene que ser != 0 mod 8 -> desplazamientos distintos
				const [bx, by, bz] = [off[0] / 16, off[1] / 16, off[2] / 16]
				const m = ((bx + 2 * by + 4 * bz) % 8 + 8) % 8
				if (m === 0) peleas.push(`offset ${JSON.stringify(off)}: sin separacion`)
			}
		}
	}
	ok(coplanares > 0, `hay ${coplanares} pares coplanares entre vecinos (la forma del asterisco los abraza)`)
	ok(peleas.length === 0, `anti-parpadeo: el desplazamiento del mesher separa TODOS los pares coplanares (${peleas.slice(0, 3).join("; ")})`)

	// doble winding CORRECTO: la copia invertida debe compartir plano y
	// llevar el winding OPUESTO (mismo winding = disco de una sola cara,
	// el bug del diagonal y del horizontal).  Se extrae el bushFlecos
	// REAL y se mide sobre los 5 discos.
	{
		const flecosSrc = src.match(/const bushFlecos = \(arr\) => arr\.concat\(arr\.map\(q => plantQuad\([\s\S]*?q\.tex\)\)\)/)[0]
		const bushFlecosFn = new Function("plantQuad", flecosSrc + "\nreturn bushFlecos")(
			(c, u, t) => ({ corners: c, uv: u, tex: t }))
		const dobles = bushFlecosFn(todos)
		const unLado = []
		for (let i = 0; i < todos.length; i++) {
			const pA = planoDe(dobles[i])
			const pB = planoDe(dobles[todos.length + i])
			const dot = pA.n[0] * pB.n[0] + pA.n[1] * pB.n[1] + pA.n[2] * pB.n[2]
			let dB = pB.d
			if (dot < 0) dB = -pB.d
			const mismoPlano = Math.abs(Math.abs(dot) - 1) < 1e-6 && Math.abs(dB - pA.d) < 1e-6
			if (!(mismoPlano && dot < 0)) unLado.push(`disco ${i}`)
		}
		ok(unLado.length === 0, `doble winding correcto: los 5 discos visibles desde AMBOS lados (${unLado.join(", ")})`)
	}

	ok(/if \(verts\.tex === "DISC"\)/.test(src)
		&& /\(\(\(\(x2 \+ 2 \* y2 \+ 4 \* z2\) % 8\) \+ 8\) % 8\) \* 0\.04/.test(src),
		"el mesher desplaza los discos ((x+2y+4z) mod 8) * 0.04: separacion >= 0.04, por encima de la resolucion del depth buffer hasta ~50 bloques")
	ok(/barray\[index\] = verts\[0\] \+ x2 \+ ox/.test(src), "el desplazamiento se aplica a los vertices del disco")
	ok(/q\.corners\.slice\(9, 12\)/.test(src),
		"la copia invertida invierte el ORDEN de vertices (el reverse plano cruza x por z)")

	ok(/texName === "DISC"/.test(src) && /\+ "Disc"/.test(src),
		"el mesher resuelve el tile de disco por bloque (leaves -> leavesDisc)")
	ok(/bushFlecos = \(arr\) => arr\.concat\(arr\.map/.test(src),
		"cada disco lleva doble winding (visible desde ambos lados)")
	ok(/baseBlock\.shape = baseBlock\.bush \? shapes\.bush : shapes\.cube/.test(src),
		"initShapes: los bloques bush usan shapes.bush")
	ok(/shapes\.bush\.hitVerts = shapes\.cube\.verts/.test(src)
		&& /shapes\.bush\.buffer = shapes\.cube\.buffer/.test(src),
		"bush: apuntar, romper y outline siguen siendo el cubo COMPLETO")
	ok(/let verts = data\.shape\.hitVerts \|\| data\.shape\.verts/.test(src),
		"collided: los discos no collisionan (usa hitVerts = el cubo)")
	ok(/obj\.cross \|\| face\.corners \? mapQuad\(face\) : mapCoords\(face, i\)/.test(src),
		"mapper mixto: rects del cubo + quads libres de discos")
	ok(/shadows = verts\.tex === "DISC" \? CROSS_SHADOW : faceShadows/.test(src),
		"los discos llevan luz plana (0.95): el AO del slot no corresponde a su geometria central")
	ok(/objectify\( 2,  2,  2, 12, 12, 2, 2\)/.test(src),
		"el nucleo de la copa es un cubo de 0.75 (12 px), no el bloque entero")
	const bushBlocks = [...blockBlock.matchAll(/\{\s*name:\s*"(leaves|birchLeaves|blossomLeaves)"[\s\S]*?bush: true/g)]
	ok(bushBlocks.length === 3, "leaves, birchLeaves y blossomLeaves marcados como bush")
	ok(/especie === "roble" && dado\(\) < 0\.125/.test(src), "1 de cada 8 arboles sale florado")
	ok(/blossomLeaves: 0\.3/.test(src), "blossomLeaves se rompe tan rapido como leaves")
	ok(/rnd\(\) < 0\.625 \? 1 : 0/.test(src), "flores al 25% de densidad (0-1 blossom por tile, antes 2-3)")
	ok(/0\.65 \+ rnd\(\) \* 0\.3/.test(src), "flores al 25% de tamano (0.65-0.95 px, antes 2.6-3.8)")
	ok(/blockIds\.blossomLeaves/.test(src), "blossomLeaves en LEAF_IDS (la manzana al romper)")
}

// --- 10e. copas SIN cull entre ellas (el nucleo 0.75 evita el z-fight) --
// Si dos hojas se cullaran entre si, el interior de la copa quedaria
// hueco: a traves de los huecos se veria el TRONCO en vez de las hojas
// de los bloques de detras.  El z-fighting se evita por GEOMETRIA: con
// el nucleo de 0.75 las caras apiladas nunca son coplanares.  El
// hideFace REAL contra datos fake.
{
	const hfSrc = src.slice(src.indexOf("function hideFace("), src.indexOf("// Las plantas (shape cross)"))
	const bindHF = new Function("world", "blockData", "getBlock", "screen",
		hfSrc + "\nreturn hideFace")
	const world = {}
	const C = { top: 3, bottom: 3, north: 3, south: 3, east: 3, west: 3 }
	const HOJA = 10, ABEDUL = 11, CRISTAL = 12, TIERRA = 13, PLANTA = 14
	const blockData = []
	blockData[HOJA] = { transparent: true, shadow: true, bush: true, shape: { cull: C } }
	blockData[ABEDUL] = { transparent: true, shadow: true, bush: true, shape: { cull: C } }
	blockData[CRISTAL] = { transparent: true, shadow: true, shape: { cull: C } }
	blockData[TIERRA] = { shape: { cull: C } }
	blockData[PLANTA] = { cross: true, shape: { cull: C } }
	blockData[HOJA | 0x100] = { transparent: true, shadow: true, bush: true,
		shape: { cull: { top: 0, bottom: 3, north: 1, south: 1, east: 1, west: 1 } } }
	const hideFace = bindHF(world, blockData, () => 0, "play")
	const visto = (vecino, tipo, sDir = "top", dir = "bottom") =>
		hideFace(0, 0, 0, null, tipo, () => vecino, sDir, dir)
	ok(visto(HOJA, HOJA) === 1, "hoja contra hoja: dibujada (el interior de la copa se ve)")
	ok(visto(ABEDUL, HOJA) === 1, "hoja contra abedul: dibujada (copas mixtas)")
	ok(visto(0, HOJA) === 1, "hoja contra aire: dibujada")
	ok(visto(CRISTAL, HOJA) === 1, "hoja contra cristal: dibujada (transparente no-bush)")
	ok(visto(TIERRA, HOJA) === 0, "hoja contra tierra: cullada (el opaco la tapa)")
	ok(visto(HOJA, TIERRA) === 1, "tierra contra hoja: dibujada (la hoja no tapa)")
	ok(visto(HOJA | 0x100, HOJA, "bottom", "top") === 1,
		"un slab de hoja NO traga la cara del cubo de arriba (rangos de cull)")
	ok(visto(PLANTA, PLANTA) === 1, "las plantas siguen sin cullarse")
	ok(!/let arbusto = /.test(src), "sin cull arbusto-arbusto: el nucleo de 0.75 evita el z-fight por geometria")
}

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
	ok(proy(b, 0, 0, 5) === null, "proyectarHud: w<=0 (detrás) devuelve null")
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

// --- Guardar/Abrir libros en archivo local (.json) ---------------------
{
	// Bloque puro de game.js (desde LIBRO_FORMATO hasta el marcador): solo
	// depende de las tablas de items, que se inyectan como parametros
	// (mismo truco que pixelesPorBloque mas arriba).
	const libroSrc = src.slice(src.indexOf("const LIBRO_FORMATO"), src.indexOf("[libro:fin-puras]"))
	ok(libroSrc.includes('const LIBRO_FORMATO = "voxeland.libro"'), "archivo de libro: formato declarado")
	ok(/function serializarLibro/.test(libroSrc) && /function sanitizarLibro/.test(libroSrc),
		"archivo de libro: serializar/sanitizar dentro del bloque puro")
	const BT = ["azul", "marron", "verde", "rojo", "morado"]
	const BP = ["pergamino", "marfil", "crema"]
	const IB = 1024 + 7
	const items = {}
	for (let ti = 0; ti < BT.length; ti++) {
		for (let pi = 0; pi < BP.length; pi++) {
			items[IB + ti * BP.length + pi] = { name: "Libro", book: true, pages: 16, tono: BT[ti], papel: BP[pi] }
		}
	}
	const lib = new Function("BOOK_TONOS", "BOOK_PAPELES", "ITEM_BOOK", "ITEMS", "version",
		libroSrc + "\nreturn { serializarLibro, sanitizarLibro }")(BT, BP, IB, items, "0.1 Alpha")

	// round trip: slot completo -> archivo -> slot identico
	const slot1 = {
		state: IB + 3 * 3 + 2, count: 1, title: "Cronicas de VOXELAND",
		text: ["Pagina 1", "Pagina 2"], signed: true, signDate: 1750000000000,
		chapters: [4, -1, 10, -1], chapNames: ["Inicio", "", "Final", ""],
		fontSize: 12, coverFontSize: 15
	}
	const archivo = lib.serializarLibro(slot1)
	ok(archivo.format === "voxeland.libro" && archivo.v === 1, "serializar: formato + version del archivo")
	ok(archivo.libro.tono === "rojo" && archivo.libro.papel === "crema", "serializar: tono/papel del item en el archivo")
	const slot2 = lib.sanitizarLibro(archivo)
	ok(slot2 && slot2.state === slot1.state && slot2.count === 1, "round trip: mismo id de item y count 1")
	ok(slot2.title === slot1.title && slot2.signed === true && slot2.signDate === slot1.signDate,
		"round trip: titulo y firma")
	ok(JSON.stringify(slot2.text) === JSON.stringify(slot1.text.concat(Array(14).fill(""))),
		"round trip: text viaja y se rellena a 16 paginas")
	ok(JSON.stringify(slot2.chapters) === JSON.stringify(slot1.chapters)
		&& JSON.stringify(slot2.chapNames) === JSON.stringify(slot1.chapNames),
		"round trip: capitulos y sus nombres")
	ok(slot2.fontSize === 12 && slot2.coverFontSize === 15, "round trip: tamanos de letra")

	// tolerancia entre versiones: tono/papel que aun no existen -> state
	// guardado; sin nada valido -> ITEM_BOOK historico
	ok(lib.sanitizarLibro({ libro: { tono: "dorado", papel: "seda", state: slot1.state, title: "futuro", text: ["hola"] } }).state === slot1.state,
		"tolerancia: tono/papel desconocidos caen al state guardado")
	ok(lib.sanitizarLibro({ libro: { tono: "dorado", papel: "seda", state: 55555, text: [] } }).state === IB,
		"tolerancia: sin tono ni state validos cae al ITEM_BOOK historico")

	// archivo sucio/antiguo: todo al rango actual
	const sucio = lib.sanitizarLibro({ libro: {
		title: "x".repeat(50), text: ["y".repeat(300)],
		chapters: [999, 2.7, "3", null], chapNames: ["n".repeat(30)],
		fontSize: 99, coverFontSize: 1, signed: "si"
	} })
	ok(sucio.title.length === 32, "sanitizar: titulo recortado a 32")
	ok(sucio.text.length === 16 && sucio.text[0].length === 256,
		"sanitizar: paginas recortadas a 256 y rellenadas a 16")
	ok(JSON.stringify(sucio.chapters) === JSON.stringify([14, 2, 2, -1]),
		"sanitizar: capitulos con clamp, pares y -1 en el hueco")
	ok(sucio.chapNames[0].length === 14 && sucio.fontSize === 24 && sucio.coverFontSize === 10 && sucio.signed === true,
		"sanitizar: nombre de capitulo, tamanos de letra y firma")
	ok(lib.sanitizarLibro(null) === null && lib.sanitizarLibro({ format: "voxeland.libro" }) === null
		&& lib.sanitizarLibro({ libro: "texto" }) === null, "sanitizar: lo que no es un libro -> null")

	// integracion en el juego: input, boton de export en la escena,
	// descarga real y hueco + save() al importar
	ok(/<input type="file" id="librofile"/.test(htmlSrc) && /accept="\.json/.test(htmlSrc),
		"input #librofile type=file que acepta .json en index.html")
	ok(/getElementById\("librofile"\)/.test(src) && /librofile\.addEventListener\("change"/.test(src),
		"game.js engancha #librofile y reacciona a change")
	ok(/drawBookTabs\(L\)\r?\n\t\tdrawBookSave\(L\)/.test(src), "drawBook pinta el boton Guardar (pie del libro)")
	ok(/URL\.createObjectURL/.test(src) && /revokeObjectURL/.test(src) && /\.download = nombreArchivoLibro/.test(src),
		"exportarLibro descarga via Blob + <a download> y libera el objectURL")
	const expSrc = src.slice(src.indexOf("function exportarLibro"), src.indexOf("function importarTextoLibro"))
	ok(/flushBookAll\(\)/.test(expSrc), "exportarLibro flusha el texto al slot antes de leerlo")
	const impSrc = src.slice(src.indexOf("function importarTextoLibro"), src.indexOf("function importarLibroArchivo"))
	ok(/inventory\.hotbar/.test(impSrc) && /inventory\.main/.test(impSrc) && /save\(\)/.test(impSrc),
		"importar: hueco (hotbar->main) y save() al terminar")
	ok(/"pause", importarLibroArchivo/.test(src), "boton Importar libro en el menu pause")
	ok(/game\.js\?v=20261008/.test(htmlSrc), "cache-buster de game.js actualizado")

	// disposicion del widget: pestañas alineadas con la X, -> anclada al
	// centro del libro cerrado (no salta al abrir) y Guardar en el pie
	const tabsSrc = src.slice(src.indexOf("function bookCloseInset"), src.indexOf("function rightClickBookChapter"))
	ok(/const x0 = L\.sx \+ L\.sw - bookCloseInset\(L\) - total/.test(tabsSrc),
		"el borde derecho de las pestañas se alinea con el de la X (misma formula del inset)")
	ok(/const inset = bookCloseInset\(L\)/.test(src), "drawBookClose usa el helper compartido del inset")
	const mkTabs = new Function(tabsSrc + "\nreturn { bookTabsLayout, bookCloseInset }")()
	{
		const Lp = { bx: 434, bw: 832, sx: 610, sw: 656, tabS: 30, by: 238, tabsH: 36 }
		const t = mkTabs.bookTabsLayout(Lp)
		const total = t.portW + 4 * t.th + 4 * t.gap
		ok(t.x0 + total === Lp.sx + Lp.sw - mkTabs.bookCloseInset(Lp),
			"la fila de pestañas termina justo en el borde derecho de la X")
	}
	const layoutSrc = src.slice(src.indexOf("function bookLayout"), src.indexOf("function drawBook()"))
	ok(/function bookCoverCenterX/.test(layoutSrc), "bookCoverCenterX junto a bookLayout (bloque extraible)")
	const mk = new Function("width", "height", "BOOK_BOX", "bookView",
		layoutSrc + "\nreturn { bookLayout, bookCoverCenterX }")
	const BB = { w: 0.65, h: 0.65, margin: 14, tabs: 36, foot: 40 }
	const mkCover = mk(1280, 720, BB, "cover")
	const mkPages = mk(1280, 720, BB, "pages")
	const Lc = mkCover.bookLayout()
	const Lp = mkPages.bookLayout()
	ok(Math.abs(Lc.sx + Lc.sw / 2 - mkCover.bookCoverCenterX(Lc)) < 1e-9,
		"la -> de la portada vive en el centro del libro cerrado")
	ok(mkPages.bookCoverCenterX(Lp) === mkCover.bookCoverCenterX(Lc),
		"la -> no salta al abrir el libro (misma coordenada en hojas)")
	const footSrc = src.slice(src.indexOf("function drawBookFoot"), src.indexOf("function drawBookClose"))
	ok(/const nextX = Math\.round\(bookCoverCenterX\(L\) - nw \/ 2\)/.test(footSrc),
		"en hojas la -> se ancla a bookCoverCenterX y la < aparece a su lado")
	ok(/const x = Math\.round\(bookCoverCenterX\(L\) - nw \/ 2\)/.test(footSrc),
		"en portada la -> se ancla a bookCoverCenterX")
	const saveSrc = src.slice(src.indexOf("function drawBookSave"), src.indexOf("// Selector de archivos"))
	ok(/L\.sx \+ L\.sw - 4/.test(saveSrc) && /y: L\.footY, w: tw \+ 14, h: L\.footH/.test(saveSrc),
		"el boton Guardar vive en el pie, pegado a la esquina inferior derecha")
}

console.log(fails ? `\n${fails} FALLOS` : "\ntodo OK")
process.exit(fails ? 1 : 0)
