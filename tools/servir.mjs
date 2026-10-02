// servir.mjs - servidor estatico sin dependencias para VOXELAND.
//
// El modelo es models/LOW-POLY/COW.glb y baja por fetch, y Chrome bloquea
// fetch sobre file://: para probar en local hay que servir el juego.
//
//   node tools/servir.mjs [puerto]     ->  http://localhost:8080
//   (o doble clic en JUGAR.bat: arranca esto y abre el navegador)
//
// Sin cache (en desarrollo nada de versiones viejas) y con el querystring
// ignorado, igual que hace la red real con los ?v= de las etiquetas.
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, normalize, sep } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const puerto = +(process.argv[2] || 8080)

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".glb": "model/gltf-binary",
	".gltf": "model/gltf+json",
	".wasm": "application/wasm",
	".ogg": "audio/ogg",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
}

const servidor = createServer((req, res) => {
	let ruta
	try {
		ruta = decodeURIComponent(String(req.url || "/").split("?")[0])
	} catch (e) {
		res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
		res.end("400")
		return
	}
	if (ruta.endsWith("/")) ruta += "index.html"
	const abs = normalize(join(root, ruta))
	if (abs !== root && !abs.startsWith(root + sep)) {
		res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
		res.end("403")
		return
	}
	if (!existsSync(abs) || !statSync(abs).isFile()) {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
		res.end("404 " + ruta)
		return
	}
	const pto = abs.lastIndexOf(".")
	const ext = pto >= 0 ? abs.slice(pto).toLowerCase() : ""
	res.writeHead(200, {
		"Content-Type": MIME[ext] || "application/octet-stream",
		"Cache-Control": "no-store",
	})
	res.end(readFileSync(abs))
})
// segundo intento con el puerto ocupado (doble clic en JUGAR.bat otra vez):
// no es un error, ya hay servidor y basta con abrir el navegador
servidor.on("error", e => {
	if (e.code === "EADDRINUSE") {
		console.log("ya hay un servidor en el puerto " + puerto + "; este no hace falta " +
			"(abre http://localhost:" + puerto + ")")
		process.exit(0)
	}
	console.error("servir.mjs: " + e.message)
	process.exit(1)
})
servidor.listen(puerto, () => {
	console.log("VOXELAND en http://localhost:" + puerto + "   (Ctrl+C para parar)")
	console.log("servido desde " + root)
})
