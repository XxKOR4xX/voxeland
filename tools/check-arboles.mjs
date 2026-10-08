// Static+integration checks for the TreeGen worldgen trees. Run: node tools/check-arboles.mjs
//
// El bloque de árbol de populate() se extrae del fuente REAL de game.js
// y se ejecuta contra mocks de Chunk/world (misma técnica que el bind de
// hojaTile en check.mjs): si alguien retoca el volcado o el gate, avisa.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const require2 = createRequire(import.meta.url)
const TreeGen = require2(root + "png/trees/tree_gen.js")
const src = readFileSync(root + "game.js", "utf8")

let fails = 0
const ok = (cond, msg) => { console.log((cond ? "  OK   " : "  FALLO") + " " + msg); if (!cond) fails++ }

// --- 1. generateTree: perfiles, determinismo y CONECTIVIDAD -------------
for (const k of ["roble", "abedul", "sauce"]) {
	ok(TreeGen.WORLDGEN[k] !== undefined, `perfil worldgen: ${k}`)
}
{
	const P = TreeGen.WORLDGEN.roble
	ok(TreeGen.generateTree(P, 12345).size === TreeGen.generateTree(P, 12345).size,
		"generateTree determinista")
	const P2 = Object.assign({}, P, { budget: 50 })
	ok(TreeGen.generateTree(P2, 999).size < 2000, "P.budget recorta la estructura")
}

// conectividad del leño: flood fill 6-vecino desde la base (0,0,0).  El
// relleno de diagonales de logStep debe dejar TODOS los bloques de la
// rama unidos al tronco — una rama cortada queda flotando.
{
	const DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]
	let peor = 0, especiePeor = ""
	for (const [nombre, P0] of Object.entries(TreeGen.WORLDGEN)) {
		for (let s = 1; s <= 12; s++) {
			const P = Object.assign({}, P0)
			P.height = P0.height + (s % (P0.heightVar + 1))
			const vox = TreeGen.generateTree(P, s * 7919)
			const logs = new Set()
			for (const o of vox.values()) if (o.t === 0) logs.add(o.x + "," + o.y + "," + o.z)
			const seen = new Set(["0,0,0"])
			const cola = [[0, 0, 0]]
			while (cola.length) {
				const [x, y, z] = cola.pop()
				for (const [dx, dy, dz] of DIRS) {
					const k = (x + dx) + "," + (y + dy) + "," + (z + dz)
					if (logs.has(k) && !seen.has(k)) { seen.add(k); cola.push([x + dx, y + dy, z + dz]) }
				}
			}
			const aislados = logs.size - seen.size
			if (aislados > peor) { peor = aislados; especiePeor = nombre }
		}
	}
	ok(peor === 0, `leños 100% conectados al tronco (flood fill 6v, peor: ${peor} aislados${peor ? " en " + especiePeor : ""})`)
}

// --- 2. extraer el bloque de árbol de populate() ------------------------
const bloque = src.match(/if \(trees && arbolEnRejilla\(wx, wz\)[\s\S]*?blockIds\.dirt\)\r?\n\t\t\t\t\}/)
ok(bloque !== null, "bloque de árbol localizado en populate()")
ok(/t === 2\) continue/.test(bloque[0]), "el volcado ignora las enredaderas (t===2)")
ok(/o\.t === 0 \|\| !this\.getBlock/.test(bloque[0]), "in-chunk: el leño pisa, las hojas solo sobre aire")
ok(/world\.spawnLog\(X, Y, Z, id\)/.test(bloque[0]), "fuera del chunk: el leño va por spawnLog (nunca cortado)")
ok(/world\.spawnBlock\(X, Y, Z, id\)/.test(bloque[0]), "fuera del chunk: las hojas van por spawnBlock")
ok(/ARBOL_CELDA \* ARBOL_CELDA/.test(bloque[0]), "la densidad se agrupa por celda (chance x area)")
const cuerpo = bloque[0].replace(/\r/g, "")

// helpers del fuente real: ARBOL_BLOQUES, treeSpeciesAt, arbolEnRejilla
const spSrc = src.match(/const ARBOL_BLOQUES = \{[\s\S]*?\n\t\}/)[0]
const fnSrc = src.match(/function treeSpeciesAt\(x, z\) \{[\s\S]*?\n\t\}/)[0]
const rejillaSrc = src.match(/const ARBOL_CELDA = \d+\r?\n[\s\S]*?function arbolEnRejilla\(x, z\) \{[\s\S]*?\r?\n\t\}/)
ok(rejillaSrc !== null, "arbolEnRejilla + constantes localizadas")
const ARBOL_CELDA = Number(rejillaSrc[0].match(/ARBOL_CELDA = (\d+)/)[1])
const ARBOL_MARGEN = Number(rejillaSrc[0].match(/ARBOL_MARGEN = (\d+)/)[1])
const bindRejilla = new Function("hash", rejillaSrc[0] + "\nreturn arbolEnRejilla")

// --- 3. mocks ------------------------------------------------------------
const blockIds = { air: 0, grass: 1, dirt: 3, stone: 4, waterBlock: 9,
	oakLog: 20, birchLog: 21, darkOakLog: 22, acaciaLog: 23, jungleLog: 24, spruceLog: 25,
	leaves: 30, birchLeaves: 31, blossomLeaves: 32, swampLeaves: 33 }
const bioma = (x, z) => (x > 100 ? "swamp" : x < -100 ? "forest" : "plains")
let seedMundo = 12345
const hash = (x, z) => {   // stub determinista, mismo rango [-1,1] que el del juego
	let h = Math.imul(x * 374761393 ^ seedMundo, 668265263) + Math.imul(z ^ seedMundo, 2246822519) | 0
	h = Math.imul(h ^ h >>> 13, 1274126177)
	return (h ^ h >>> 16) / 2147483647
}
const treeSpeciesAt = new Function("biomeAt", "hash", fnSrc + "\nreturn treeSpeciesAt")(bioma, hash)
const ARBOL_BLOQUES = new Function(spSrc + "\nreturn ARBOL_BLOQUES")()

function makeChunk(cx, cz) {
	const bloques = new Map()
	return {
		x: cx * 16, z: cz * 16,
		bloques,
		getBlock(x, y, z) { return bloques.get(x + "," + y + "," + z) || 0 },
		setBlock(x, y, z, id) { bloques.set(x + "," + y + "," + z, id) },
	}
}
function makeWorld() {
	const spawns = [], logs = []
	return {
		spawns, logs,
		spawnBlock(X, Y, Z, id) { spawns.push([X, Y, Z, id]) },
		spawnLog(X, Y, Z, id) { logs.push([X, Y, Z, id]) },
	}
}
const world = makeWorld()

// el cuerpo extraído acaba en el setBlock de dirt: no añadir nada detrás
const fnCuerpo = new Function("trees", "arbolEnRejilla", "hash", "treeChanceAt", "treeSpeciesAt",
	"ARBOL_BLOQUES", "ARBOL_CELDA", "blockIds", "TreeGen", "world", "wx", "wz", "ground",
	"i", "k", "groundBlock", cuerpo)
const SIEMPRE = () => true, CHANCE1 = () => 1
function arbol(chunk, i, k, wx, wz, ground, opts = {}) {
	fnCuerpo.call(chunk, true, opts.rejilla || SIEMPRE, hash, opts.chance || CHANCE1,
		treeSpeciesAt, ARBOL_BLOQUES, ARBOL_CELDA, blockIds, TreeGen,
		opts.world || world, wx, wz, ground, i, k, blockIds.grass)
}

// --- 4. árbol centrado -----------------------------------------------------
{
	const c = makeChunk(0, 0)
	arbol(c, 8, 8, 8, 8, 70)
	ok(c.getBlock(8, 71, 8) === blockIds.oakLog, "tronco plantado en ground+1 (8,71,8) = oakLog")
	ok(c.getBlock(8, 70, 8) === blockIds.dirt, "base de césped -> dirt")
	let nLog = 0, nHoja = 0
	for (const id of c.bloques.values()) {
		if (id === blockIds.oakLog) nLog++
		else if (id === blockIds.leaves || id === blockIds.blossomLeaves) nHoja++
	}
	ok(nLog > 30, `estructura de leño sana (${nLog} oakLog > 30)`)
	ok(nHoja > 200, `copa presente (${nHoja} hojas > 200)`)
	const fuera = [...world.spawns, ...world.logs].every(([X, Z]) => (X >> 4) !== 0 || (Z >> 4) !== 0)
	ok(fuera, `lo que derrama cae fuera del chunk (${world.spawns.length + world.logs.length} spawns)`)
}

// --- 5. árbol en la esquina: leño por spawnLog, hoja por spawnBlock ------
{
	const w = makeWorld()
	const c = makeChunk(0, 0)
	arbol(c, 15, 15, 15, 15, 70, { world: w })
	ok(w.logs.length > 20, `la copa y las ramas cruzan al vecino (${w.logs.length} leños fuera > 20)`)
	ok(w.logs.every(([X, Z]) => X >= 16 || Z >= 16), "spawnLog solo recibe coords FUERA del chunk")
	ok(w.logs.every(([, , , id]) => id === blockIds.oakLog), "spawnLog solo recibe LEÑO (nunca hojas)")
	ok(w.spawns.length > 0 && w.spawns.every(([, , , id]) => id === blockIds.leaves || id === blockIds.blossomLeaves),
		"spawnBlock fuera del chunk solo recibe HOJAS")
	// el vecino recibe la MISMA copa que si el árbol fuera suyo
	const w2 = makeWorld()
	const c2 = makeChunk(1, 1)
	arbol(c2, 15, 15, 15, 15, 70, { world: w2 })
	const huella = (c, l1, l2) => {
		const out = []
		for (const [k, id] of c.bloques) {
			if (id === blockIds.dirt) continue   // pad del chunk ejecutor, no del árbol
			const [x, y, z] = k.split(",").map(Number)
			out.push((c.x + x) + "," + y + "," + (c.z + z) + "," + id)
		}
		for (const [X, Y, Z, id] of [...l1, ...l2]) out.push(X + "," + Y + "," + Z + "," + id)
		return out.sort().join(";")
	}
	ok(huella(c, w.spawns, w.logs) === huella(c2, w2.spawns, w2.logs),
		"determinismo: misma columna => mismo árbol (venga del chunk que venga)")
}

// --- 6. hojas in-chunk no pisan terreno -----------------------------------
{
	const c = makeChunk(0, 0)
	for (let y = 71; y <= 90; y++) c.setBlock(12, y, 8, blockIds.stone)
	arbol(c, 8, 8, 8, 8, 70)
	let hojasEnPiedra = 0
	for (let y = 71; y <= 90; y++) {
		const id = c.getBlock(12, y, 8)
		if (id === blockIds.leaves || id === blockIds.blossomLeaves) hojasEnPiedra++
	}
	ok(hojasEnPiedra === 0, "ninguna hoja rebaja la colina (solo van sobre aire)")
}

// --- 7. pantano -> sauce ----------------------------------------------------
{
	const c = makeChunk(7, 0)   // chunk con origen 112: contiene wx=116
	arbol(c, 4, 4, 116, 4, 63)
	let nDark = 0, nSwamp = 0
	for (const id of c.bloques.values()) {
		if (id === blockIds.darkOakLog) nDark++
		if (id === blockIds.swampLeaves) nSwamp++
	}
	ok(nDark > 5, `sauce: tronco darkOakLog (${nDark} > 5)`)
	ok(nSwamp > 100, `sauce: copa swampLeaves (${nSwamp} > 100)`)
}

// --- 8. bosque: mezcla roble/abedul ----------------------------------------
{
	let roble = 0, abedul = 0
	for (let wx = -300; wx < -100; wx += 7) {
		const c = makeChunk(wx >> 4, 0)
		arbol(c, 4, 4, wx, 4, 70)
		const ids = new Set(c.bloques.values())
		if (ids.has(blockIds.birchLog)) abedul++
		else if (ids.has(blockIds.oakLog)) roble++
	}
	const total = roble + abedul
	const pct = abedul / total
	ok(total === 29 && pct > 0.2 && pct < 0.6,
		`bosque: ${roble} robles / ${abedul} abedules (${(pct * 100).toFixed(0)}% abedul, esperado ~40%)`)
}

// --- 9. la rejilla: UNA candidata por celda, separación garantizada -------
{
	const elegida = bindRejilla(hash)
	const pts = []
	for (let x = -200; x < 200; x++) for (let z = -200; z < 200; z++) {
		if (elegida(x, z)) pts.push([x, z])
	}
	ok(pts.length === 400 * 400 / (ARBOL_CELDA * ARBOL_CELDA),
		`una candidata por celda (${pts.length} en 400x400, esperadas ${400 * 400 / (ARBOL_CELDA * ARBOL_CELDA)})`)
	let minD = Infinity
	for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
		const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
		if (d < minD) minD = d
	}
	ok(minD >= 2 * ARBOL_MARGEN, `separación mínima entre árboles: ${minD} >= 2*${ARBOL_MARGEN}`)
	// determinista: la misma columna responde igual siempre
	ok(pts.length === (() => { let n = 0; for (let x = -200; x < 200; x++) for (let z = -200; z < 200; z++) if (elegida(x, z)) n++; return n })(),
		"arbolEnRejilla determinista")
}

// --- 10. gate end-to-end: distancia mínima ENTRE PLANTADOS ---------------
{
	// gate completo del fuente (rejilla real + densidad saturada) sobre
	// 8 chunks: los troncos que salen respetan la separación mínima.
	const troncos = []
	for (let cxi = -2; cxi < 2; cxi++) for (let czi = -2; czi < 2; czi++) {
		const c = makeChunk(cxi, czi)
		for (let i = 0; i < 16; i++) for (let k = 0; k < 16; k++) {
			arbol(c, i, k, c.x + i, c.z + k, 70, { rejilla: bindRejilla(hash) })
		}
		for (let i = 0; i < 16; i++) for (let k = 0; k < 16; k++) {
			if (c.getBlock(i, 71, k) === blockIds.oakLog || c.getBlock(i, 71, k) === blockIds.birchLog) {
				troncos.push([c.x + i, c.z + k])
			}
		}
	}
	ok(troncos.length === 64, `árboles en 64x64 con densidad saturada: ${troncos.length} (uno por celda de la rejilla)`)
	let minD = Infinity
	for (let a = 0; a < troncos.length; a++) for (let b = a + 1; b < troncos.length; b++) {
		const d = Math.hypot(troncos[a][0] - troncos[b][0], troncos[a][1] - troncos[b][1])
		if (d < minD) minD = d
	}
	ok(minD >= 2 * ARBOL_MARGEN, `troncos plantados a >= ${2 * ARBOL_MARGEN} bloques (mínimo real: ${minD})`)
}

console.log(fails ? `\n${fails} FALLOS` : "\ntodo OK")
process.exit(fails ? 1 : 0)
