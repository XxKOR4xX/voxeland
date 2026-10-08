// Static+integration checks for the TreeGen worldgen trees. Run: node tools/check-arboles.mjs
//
// El bloque de árbol de populate() se extrae del fuente REAL de game.js
// y se ejecuta contra mocks de Chunk/world (misma técnica que el bind de
// hojaTile en check.mjs): si alguien retoca el volcado, este check avisa.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const require2 = createRequire(import.meta.url)
const TreeGen = require2(root + "png/trees/tree_gen.js")
const src = readFileSync(root + "game.js", "utf8")

let fails = 0
const ok = (cond, msg) => { console.log((cond ? "  OK   " : "  FALLO") + " " + msg); if (!cond) fails++ }

// --- 1. generateTree y perfiles worldgen --------------------------------
for (const k of ["roble", "abedul", "sauce"]) {
	ok(TreeGen.WORLDGEN[k] !== undefined, `perfil worldgen: ${k}`)
}
{
	// determinismo puro del generador + budget respetado
	const P = TreeGen.WORLDGEN.roble
	const a = TreeGen.generateTree(P, 12345), b = TreeGen.generateTree(P, 12345)
	ok(a.size === b.size, `generateTree determinista (${a.size} voxels)`)
	const P2 = Object.assign({}, P, { budget: 50 })
	const c = TreeGen.generateTree(P2, 999)
	ok(c.size > 0 && c.size < 2000, `P.budget recorta la estructura (${c.size} voxels con budget 50)`)
	// enredaderas desactivadas en los perfiles del mundo (sin bloque aún)
	let vines = 0
	for (const o of TreeGen.generateTree(Object.assign({}, TreeGen.WORLDGEN.sauce, { vines: 1 }), 77).values()) {
		if (o.t === 2) vines++
	}
	ok(vines > 0, "putVine existe: la sauce del visor SI puede echar enredaderas (el worldgen las lleva a 0)")
}

// --- 2. extraer el bloque de árbol de populate() -------------------------
const bloque = src.match(/if \(trees && random\(\) < treeChanceAt\(wx, wz\)[\s\S]*?blockIds\.dirt\)\r?\n\t\t\t\t\}/)
ok(bloque !== null, "bloque de árbol localizado en populate()")
ok(/t === 2\) continue/.test(bloque[0]), "el volcado ignora las enredaderas (t===2)")
ok(/o\.t === 0 \|\| !this\.getBlock/.test(bloque[0]), "in-chunk: el leño pisa, las hojas solo sobre aire")
ok(/world\.spawnBlock\(X, Y, Z, id\)/.test(bloque[0]), "fuera del chunk: todo via spawnBlock")
const cuerpo = bloque[0].replace(/\r/g, "")

// treeSpeciesAt + ARBOL_BLOQUES del fuente real
const spSrc = src.match(/const ARBOL_BLOQUES = \{[\s\S]*?\n\t\}/)[0]
const fnSrc = src.match(/function treeSpeciesAt\(x, z\) \{[\s\S]*?\n\t\}/)[0]
ok(spSrc.includes("sauce") && fnSrc.includes("swamp"), "ARBOL_BLOQUES/treeSpeciesAt: el pantano lleva sauce")

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
const spawnLog = []
const world = { spawnBlock(X, Y, Z, id) { spawnLog.push([X, Y, Z, id]) } }

// el cuerpo extraído acaba en el setBlock de dirt: no añadir nada detrás
const fnCuerpo = new Function("trees", "random", "treeChanceAt", "treeSpeciesAt", "ARBOL_BLOQUES",
	"blockIds", "TreeGen", "world", "wx", "wz", "ground", "i", "k", "hash", "groundBlock", cuerpo)
function arbol(chunk, i, k, wx, wz, ground) {
	fnCuerpo.call(chunk, true, () => 0.5, () => 1, treeSpeciesAt, ARBOL_BLOQUES,
		blockIds, TreeGen, world, wx, wz, ground, i, k, hash, blockIds.grass)
}

// --- 4. árbol centrado -----------------------------------------------------
{
	const c = makeChunk(0, 0)
	spawnLog.length = 0
	arbol(c, 8, 8, 8, 8, 70)
	ok(c.getBlock(8, 71, 8) === blockIds.oakLog, "tronco plantado en ground+1 (8,71,8) = oakLog")
	ok(c.getBlock(8, 70, 8) === blockIds.dirt, "base de césped -> dirt")
	let nLog = 0, nHoja = 0, nBlossom = 0
	for (const id of c.bloques.values()) {
		if (id === blockIds.oakLog) nLog++
		else if (id === blockIds.leaves) nHoja++
		else if (id === blockIds.blossomLeaves) nBlossom++
	}
	ok(nLog > 30, `estructura de leño sana (${nLog} oakLog > 30)`)
	ok(nHoja + nBlossom > 200, `copa presente (${nHoja + nBlossom} hojas > 200)`)
	const fuera = spawnLog.every(([X, Z]) => (X >> 4) !== 0 || (Z >> 4) !== 0)
	ok(fuera, `lo que derrama cae fuera del chunk (${spawnLog.length} spawns)`)
}

// --- 5. árbol en la esquina + determinismo entre chunks --------------------
{
	const c = makeChunk(0, 0)
	spawnLog.length = 0
	arbol(c, 15, 15, 15, 15, 70)
	ok(spawnLog.length > 50, `árbol en esquina: la copa cruza al vecino (${spawnLog.length} spawns > 50)`)
	ok(spawnLog.every(([X, Z]) => X >= 16 || Z >= 16), "spawnBlock solo recibe coords FUERA del chunk")
	ok(spawnLog.every(([, Y]) => Y >= 71), "spawns siempre por encima del suelo (Y >= ground+1)")
	// el vecino recibe la MISMA copa que si el árbol fuera suyo
	const c2 = makeChunk(1, 1)
	const log2 = []
	const world2 = { spawnBlock: (X, Y, Z, id) => log2.push([X, Y, Z, id]) }
	fnCuerpo.call(c2, true, () => 0.5, () => 1, treeSpeciesAt, ARBOL_BLOQUES,
		blockIds, TreeGen, world2, 15, 15, 70, 15, 15, hash, blockIds.grass)
	// huella TOTAL del árbol: bloques in-chunk (a coords de mundo) + spawns
	const huella = (c, l) => {
		const out = []
		for (const [k, id] of c.bloques) {
			if (id === blockIds.dirt) continue   // pad del chunk ejecutor, no del árbol
			const [x, y, z] = k.split(",").map(Number)
			out.push((c.x + x) + "," + y + "," + (c.z + z) + "," + id)
		}
		for (const [X, Y, Z, id] of l) out.push(X + "," + Y + "," + Z + "," + id)
		return out.sort().join(";")
	}
	ok(huella(c, spawnLog) === huella(c2, log2), "determinismo: misma columna => mismo árbol (venga del chunk que venga)")
}

// --- 6. hojas in-chunk no pisan terreno -----------------------------------
{
	const c = makeChunk(0, 0)
	// ladera: la columna (12, ·, 8) es piedra maciza hasta arriba
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

console.log(fails ? `\n${fails} FALLOS` : "\ntodo OK")
process.exit(fails ? 1 : 0)
