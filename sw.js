// sw.js - service worker de VOXELAND: instalable como app + offline.
//
// Estrategias (solo GET y solo mismo origen; arc.io y Google Fonts se dejan
// pasar sin tocar, el juego degrada bien sin ellos):
//   - Navegacion (index.html): red primero, cachE de respaldo.  Las
//     actualizaciones llegan solas y offline la pagina arranca igual.
//   - Resto (JS con ?v=, modelos .glb, skins, sprites, fuente): cachE
//     primero con clave = URL exacta.  Al subir un ?v= nuevo, index.html
//     fresco trae URLs nuevas, falla el cache y se baja la version nueva
//     sin tocar este fichero.  Todo lo que ya viste queda cacheado y
//     funciona offline (cache-as-you-play).
//
// pwa.js envia {type:"warm", urls:[...]} tras la primera visita para
// cachear el shell real (scripts con su ?v= del momento) y la vaca del
// menu, que en la primera carga se pidio antes de que el SW tomara el
// control.
const SHELL = "voxeland-shell-v1"
const RUNTIME = "voxeland-runtime-v1"

// Shell estatico: solo ficheros SIN versionado en la URL.
const PRECACHE = [
	"./",
	"./index.html",
	"./manifest.json",
	"./icons/favicon-32.png",
	"./icons/icon-192.png",
	"./icons/icon-512.png",
	"./icons/icon-maskable-512.png",
	"./icons/apple-touch-icon-180.png",
	"./fonts/PirataOne-Regular.ttf",
]

self.addEventListener("install", e => {
	e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)))
})

self.addEventListener("activate", e => {
	e.waitUntil((async () => {
		const nombres = await caches.keys()
		await Promise.all(
			nombres.filter(n => n !== SHELL && n !== RUNTIME).map(n => caches.delete(n))
		)
		await self.clients.claim()
	})())
})

self.addEventListener("fetch", e => {
	const req = e.request
	if (req.method !== "GET") return
	const url = new URL(req.url)
	if (url.origin !== self.location.origin) return
	// El propio sw.js nunca se cachea: el navegador debe poder comprobar
	// sus actualizaciones.
	if (url.pathname.endsWith("/sw.js")) return
	e.respondWith(req.mode === "navigate" ? redPrimero(req) : cachePrimero(req))
})

async function redPrimero(req) {
	try {
		const res = await fetch(req)
		if (res && res.ok) {
			caches.open(SHELL).then(c => c.put(req, res.clone()))
		}
		return res
	} catch (err) {
		// Offline: la pagina tal cual se visito y, si no, el shell.
		return (await caches.match(req))
			|| (await caches.match("./index.html"))
			|| Response.error()
	}
}

async function cachePrimero(req) {
	const enCache = await caches.match(req)
	if (enCache) return enCache
	const res = await fetch(req)
	if (res && res.ok) {
		const c = await caches.open(RUNTIME)
		await c.put(req, res.clone())
	}
	return res
}

self.addEventListener("message", e => {
	const msg = e.data
	if (!msg || typeof msg !== "object") return
	if (msg.type === "SKIP_WAITING") self.skipWaiting()
	else if (msg.type === "warm") e.waitUntil(calentar(msg.urls || []))
})

// Cachea lo que pwa.js acaba de usar pero se pidio antes del control del
// SW (primera visita).  Los que ya estan se saltan; los que fallen, igual.
async function calentar(urls) {
	const c = await caches.open(RUNTIME)
	await Promise.all(urls.map(u =>
		caches.match(u).then(enCache => {
			if (enCache) return null
			return fetch(u)
				.then(res => (res.ok ? c.put(u, res) : null))
				.catch(() => null)
		})
	))
}
