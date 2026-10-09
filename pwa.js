// pwa.js - PWA de VOXELAND: registra el service worker, cachea el shell de
// la primera visita y gestiona el boton INSTALAR (prompt nativo en
// Chrome/Edge/Android; en iOS/Safari, guia de "Anadir a pantalla de inicio").
//
// No toca el estado del juego: todo va en un IIFE con defensas por si el
// navegador no soporta algo (file:// no tiene SW y la pagina debe seguir
// funcionando igual).
(function() {
	"use strict"

	// --- service worker ---------------------------------------------------
	var protocoloOk = location.protocol === "https:"
		|| location.hostname === "localhost"
		|| location.hostname === "127.0.0.1"

	// Cachea lo esencial para que la app recien instalada arranque offline:
	// los scripts que acabo de cargar (con su ?v=), la vaca del menu
	// (COW.glb + skins), los corazones del HUD y la fuente del libro.
	// En la primera visita estos recursos se piden antes de que el SW tome
	// el control; el mensaje "warm" se los pasa para que los copie al cache.
	function calentar(sw) {
		var urls = [
			location.href,
			"./manifest.json",
			"./fonts/PirataOne-Regular.ttf",
			"./models/LOW-POLY/COW.glb",
			"./png/skins/Cow1.png",
			"./png/skins/Cow2.png",
			"./png/skins/Cow3.png",
			"./png/skins/Cow4.png",
			"./png/menu/ui/hud/heart_full.png",
			"./png/menu/ui/hud/heart_half.png",
			"./png/menu/ui/hud/heart_empty.png"
		]
		var scripts = document.getElementsByTagName("script")
		for (var i = 0; i < scripts.length; i++) {
			var src = scripts[i].getAttribute("src")
			if (!src) continue
			// Solo mismo origen: arc.io y demas CDN no se cachean.
			if (new URL(src, location.href).origin === location.origin) urls.push(new URL(src, location.href).href)
		}
		sw.postMessage({ type: "warm", urls: urls })
	}

	if ("serviceWorker" in navigator && protocoloOk) {
		try {
			navigator.serviceWorker.register("./sw.js").catch(function() {})
			var calentado = false
			navigator.serviceWorker.addEventListener("controllerchange", function() {
				if (calentado) return
				calentado = true
				var sw = navigator.serviceWorker.controller
				if (sw) calentar(sw)
			})
			if (navigator.serviceWorker.controller) {
				calentado = true
				calentar(navigator.serviceWorker.controller)
			}
		} catch (e) { /* sin SW el juego funciona igual, solo sin offline */ }
	}

	// --- boton INSTALAR ---------------------------------------------------
	var btn = document.getElementById("btn-install")
	if (!btn) return

	var esApp = window.matchMedia("(display-mode: standalone)").matches
		|| navigator.standalone === true
	if (esApp) return // ya instalada: ni boton ni guia

	var esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
		|| (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	var promptNativo = null

	window.addEventListener("beforeinstallprompt", function(e) {
		e.preventDefault()
		promptNativo = e
	})

	window.addEventListener("appinstalled", function() {
		btn.classList.add("hidden")
		var guia = document.getElementById("install-guia")
		if (guia) guia.parentNode.removeChild(guia)
	})

	btn.addEventListener("click", function() {
		if (promptNativo) {
			promptNativo.prompt()
			promptNativo = null
			return
		}
		mostrarGuia()
	})

	// En iOS no hay beforeinstallprompt: el boton lleva directo a la guia
	// de Compartir -> Anadir a pantalla de inicio.  En navegadores sin
	// prompt (p.ej. Firefox de escritorio) tambien sirve de ayuda.
	function mostrarGuia() {
		var vieja = document.getElementById("install-guia")
		if (vieja) {
			vieja.parentNode.removeChild(vieja)
			return
		}
		var panel = document.createElement("div")
		panel.id = "install-guia"
		if (esIOS) {
			panel.innerHTML = "<strong>Instalar VoxeLand en iPhone/iPad</strong><br>" +
				"1. Toca el boton <b>Compartir</b> (cuadrado con flecha hacia arriba).<br>" +
				"2. Desplazate y elige <b>Anadir a pantalla de inicio</b>.<br>" +
				"3. Confirma con <b>Anadir</b>.<br>" +
				"<span style='color:#c9c9c9'>(Toca esta ventana para cerrarla)</span>"
		} else {
			panel.innerHTML = "<strong>Instalar VoxeLand</strong><br>" +
				"Busca el icono de instalacion en la barra de direcciones " +
				"(o en el menu del navegador, <b>Instalar aplicacion</b> / " +
				"<b>Anadir a pantalla de inicio</b>).<br>" +
				"<span style='color:#c9c9c9'>(Toca esta ventana para cerrarla)</span>"
		}
		panel.addEventListener("click", function() {
			panel.parentNode.removeChild(panel)
		})
		document.body.appendChild(panel)
	}

	// Visible desde el principio: en Chrome el prompt nativo llega al
	// primer click si beforeinstallprompt ya se disparo, y si no, la guia.
	btn.classList.remove("hidden")
})()
