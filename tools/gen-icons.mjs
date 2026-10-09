// gen-icons.mjs - genera los iconos PWA de VOXELAND (carpeta icons/).
//
// Dibuja un bloque de hierba voxel en pixel art 16x16 (franja verde arriba,
// tierra con moteados abajo) y lo escala a cada tamano con vecino mas
// cercano, como hacen los atlas del juego.  Sin dependencias: el PNG se
// escribe a mano (zlib de Node para el IDAT + CRC32 propio).
//
//   node tools/gen-icons.mjs
//
// Salidas: icons/icon-192.png, icon-512.png, icon-maskable-512.png,
// favicon-32.png y apple-touch-icon-180.png.
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// ---------------------------------------------------------------- PNG -----
const TABLA_CRC = (() => {
	const t = new Int32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
		t[n] = c
	}
	return t
})()

function crc32(buf) {
	let c = -1
	for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
	return (c ^ -1) >>> 0
}

function trozoPNG(tipo, datos) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(datos.length)
	const tipoBuf = Buffer.from(tipo, "ascii")
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(Buffer.concat([tipoBuf, datos])))
	return Buffer.concat([len, tipoBuf, datos, crc])
}

// PNG RGBA 8 bits sin entrelazado: scanlines con filtro 0.
function pngRGBA(ancho, alto, rgba) {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(ancho, 0)
	ihdr.writeUInt32BE(alto, 4)
	ihdr[8] = 8   // bit depth
	ihdr[9] = 6   // color type: RGBA
	const fila = ancho * 4 + 1
	const crudo = Buffer.alloc(alto * fila)
	for (let y = 0; y < alto; y++) {
		crudo[y * fila] = 0
		rgba.copy(crudo, y * fila + 1, y * ancho * 4, (y + 1) * ancho * 4)
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
		trozoPNG("IHDR", ihdr),
		trozoPNG("IDAT", deflateSync(crudo, { level: 9 })),
		trozoPNG("IEND", Buffer.alloc(0)),
	])
}

// ------------------------------------------------------------- pixel art --
function hex(h) {
	return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]
}

// PRNG determinista (mismo icono en cada ejecucion).
function mulberry32(semilla) {
	return function() {
		semilla |= 0
		semilla = semilla + 0x6D2B79F5 | 0
		let t = Math.imul(semilla ^ semilla >>> 15, 1 | semilla)
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
		return ((t ^ t >>> 14) >>> 0) / 4294967296
	}
}

// Paletas con pesos (repetir un tono = mas probabilidad): verde estilo
// pradera del juego y tierra moteada como los bloques de game.js.
const VERDES = ["#91bd59", "#7fb147", "#7fb147", "#6e9e3f", "#6e9e3f", "#a5ce63"]
const TIERRA = ["#8a5f3c", "#8a5f3c", "#8a5f3c", "#79553a", "#79553a", "#9b7653", "#5f4128"]

// Bloque de hierba 16x16: 3 filas verdes, fila 3 de transicion con la
// tierra asomando y alguna gota de hierba colgando en la fila 4.
function arteBloque(n = 16) {
	const rng = mulberry32(20261008)
	const px = new Array(n * n)
	const elige = paleta => hex(paleta[(rng() * paleta.length) | 0])
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const r = rng()
			if (y < 3) px[y * n + x] = elige(VERDES)
			else if (y === 3) px[y * n + x] = r < 0.6 ? elige(VERDES) : elige(TIERRA)
			else if (y === 4 && r < 0.22) px[y * n + x] = elige(VERDES)
			else px[y * n + x] = elige(TIERRA)
		}
	}
	return px
}

// Compone un lienzo w x h: fondo solido (o transparente) y el arte
// 16x16 escalado a tam px en (ox, oy) con vecino mas cercano.
function componer(w, h, arte, n, tam, ox, oy, fondo) {
	const rgba = Buffer.alloc(w * h * 4)
	for (let i = 0; i < w * h; i++) rgba.set(fondo, i * 4)
	for (let y = 0; y < tam; y++) {
		const sy = Math.min(n - 1, (y * n / tam) | 0)
		for (let x = 0; x < tam; x++) {
			const sx = Math.min(n - 1, (x * n / tam) | 0)
			rgba.set(arte[sy * n + sx], ((oy + y) * w + (ox + x)) * 4)
		}
	}
	return pngRGBA(w, h, rgba)
}

// ------------------------------------------------------------- salida -----
const arte = arteBloque()
const TRANSPARENTE = [0, 0, 0, 0]
// Fondo del maskable: verde oscuro de pradera para que el bloque destaque
// dentro de la zona segura (circulo interior al 80%).
const FONDO_MASKABLE = hex("#24391b")

const salida = {
	"icons/icon-192.png": componer(192, 192, arte, 16, 192, 0, 0, TRANSPARENTE),
	"icons/icon-512.png": componer(512, 512, arte, 16, 512, 0, 0, TRANSPARENTE),
	"icons/icon-maskable-512.png": componer(512, 512, arte, 16, 358, 77, 77, FONDO_MASKABLE),
	"icons/favicon-32.png": componer(32, 32, arte, 16, 32, 0, 0, TRANSPARENTE),
	"icons/apple-touch-icon-180.png": componer(180, 180, arte, 16, 180, 0, 0, FONDO_MASKABLE),
}

mkdirSync(join(root, "icons"), { recursive: true })
for (const [ruta, buf] of Object.entries(salida)) {
	writeFileSync(join(root, ruta), buf)
	console.log("escrito " + ruta + " (" + buf.length + " bytes)")
}
