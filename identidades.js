// identidades.js - Sistema de entidades/mobs ("identidades") de VOXELAND.
//
//   1. IDENTIDADES  -> tabla de fichas: modelo, escala, hitbox, animaciones,
//                      biomas de spawn... anyadir un animal nuevo es anyadir
//                      una ficha + el .glb en models/LOW-POLY/.
//   2. update()     -> spawn/despawn, IA (idle / walk / eat), fisica y reloj
//                      de animacion.  Se llama desde drawScreens.play.
//   3. render()     -> skinning (GPU con textura de huesos, CPU como
//                      respaldo) + la misma niebla que los bloques.
//
// El modelo es models/LOW-POLY/COW.glb y baja por fetch (tools/servir.mjs);
// Chrome bloquea fetch sobre file://, asi que el doble clic ya no sirve.
(function () {

	const TICKS = 1000 / 33            // milisegundos por "tick" del motor
	const GRAVEDAD = -0.032            // igual que p.gravityStength
	const MAX_VY = 1.5                 // igual que p.maxYVelocity
	// Saciedad e hidratacion: viven en stats, asi que se guardan y
	// restauran con el mundo sin tocar el esquema del save.
	const SACIEDAD_COMER = 80          // >= esta cifra no pastorea: espera
	const SACIEDAD_MORDISCO = 10       // % que sube cada mordisco
	const SACIEDAD_DESGASTE = 0.4      // % por segundo
	const HIDRATACION_UMBRAL = 40      // por debajo va a por agua
	const HIDRATACION_RIEGO = 60       // % por segundo bebiendo (una visita llena)
	const HIDRATACION_DESGASTE = 0.9   // % por segundo
	const RADIO_AGUA = 48               // radio de busca de agua (sin agua cerca, hasta el lago)
	// Distancia a la que acaba el bloque OBJETIVO cuando la vaca se
	// planta a comer/beber, medida del glb (boca z 1,61 u * escala 0,36
	// = 0,58 en el bocado; 0,61-0,69 en el trago).  El bloque debe quedar
	// JUSTO DEBAJO de la cabeza, no mas alla: al arrancar la vaca gira a
	// apuntarlo y se desliza hasta dejarlo a esta distancia.
	const BOCA = 0.6                   // hierba: el mordisco a la altura de la boca
	const BOCA_AGUA = 0.5              // agua: un poco mas cerca (lo afina el usuario)
	// El trago SOLO se cierra en la frontera del bucle del clip (tAnim por
	// debajo de esto): el temporizador (4-6 s) expira dentro de la 2a vuelta
	// y sin este corte la segunda animacion de beber se cortaba a media.
	const TRAGO_CORTE = 0.15
	// Salto y rodeo: dos impulsos.  SALTO_VY1 sube un escalon de 1 con el
	// impulso MINIMO suficiente: la integracion Euler del motor resta la
	// gravedad ANTES de mover, asi que el ascenso real es un ~7% menor
	// que vy^2/2g; con 0,28 sube ~1,07 bloques (en 60 fps ~1,15) y con
	// 0,27 se quedaba en 0,996: insuficiente sin el remate del snap.
	// SALTO_VY2 el muro de 2 (apogeo ~2,3).  SALTO_BAJADA baja de una
	// cima.  SALTO_MS dura hasta aterrizar.  El rodeo no tiene reloj
	// propio: comparte el de bloqueo del llamante (2,5 s sin poder ir recto).
	const SALTO_VY1 = 0.28
	const SALTO_VY2 = 0.40
	const SALTO_BAJADA = 0.12
	const SALTO_MS = 1500
	// Etiqueta del modelo de luz.  Se imprime al arrancar y sale en estado()
	// para poder comprobar desde la consola que el navegador esta ejecutando
	// este archivo y no una copia cacheada de una version anterior.
	const SHADING = "caras2026"
	// Modo de sombreado, para diagnosticar desde el navegador (F12):
	//   "off"    -> se anula la luz (vShadow = 1).  Si la vaca sigue viendose
	//                plana con esto, el problema no es el sombreado.
	//   "solo"   -> el FS ignora la textura y pinta solo la luz en gris: un
	//                degradado claro/oscuro demuestra que ESTE shader corre.
	//   "actual" -> produccion.
	const MODO = "actual"

	// ------------------------------------------------------------- fichas ---
	const IDENTIDADES = {
		vaca: {
			modelo: "COW",
			alto: 1.5,                 // bloques de alto (patas -> lomo)
			ancho: 0.7,                // ancho del AABB (bloques)
			escala: 0.36,              // bloques por unidad del modelo
			yawOffset: 0,              // el modelo mira hacia +Z: 0 | PI
			velocidad: 0.05,           // bloques por tick (x30.3 ~ 1.5 bloq/s)
			despawn: 192,              // bloques a los que se borra
			objetivo: 8,               // cuantas mantener vivas
			radioSpawn: [12, 48],
			biomas: ["plains", "forest"],
			skins: {                   // bioma -> nombre (o lista al azar) en png/skins
				plains: ["Cow1", "Cow2"],
				swamp: "Cow1",
				desert: "Cow2",
				forest: ["Cow3", "Cow4"],
			},
			skinDefecto: "Cow1",       // bioma sin skin o sin VXL.biomeAt
			pastoreo: true,            // busca y se come la gramilla del mapa
			anims: {
				idle: "Cow|Cow_Idle",
				walk: "Cow|Cow_Walk",
				eat: "Cow|Cow_Eat1",
				beber: "Cow|Cow_Ea2",   // segundo clip de eat (2,125 s): beber
			},
		},
	}

	// ------------------------------------------------------------- estado ---
	let gl = null
	let modelo = null
	const skins = {}           // nombre de skin -> textura WebGL (png/skins)
	let nombresSkin = []       // skins declaradas en las fichas (arg de /vaca)
	let listo = false
	let cargando = false      // esperando al fetch del .glb
	let prog = null
	let loc = null
	let cpuSkin = false
	let entidades = []
	let ultimoMundo = null
	let ultimaActualizacion = 0
	let siguienteSpawn = 0

	const vista = new Float32Array(16)
	const uModelo = new Float32Array(16)
	let huesos = new Float32Array(16 * 128)
	const tmpA = new Float32Array(16)
	const tmpB = new Float32Array(16)
	let posCPU = null
	let norCPU = null
	let skinPos = null
	let skinNor = null
	const baseModelo = {}
	// sombra de contacto (programa aparte: el motor no proyecta sombras)
	let progSombra = null
	let locSombra = null
	let bufSombra = null
	// opacidad del quad de sombra; los semi-ejes viven en el VS_SOMBRA
	const SOMBRA_OPACIDAD = 0.35
	// El quad descansa un pelin por encima del suelo.  Con la profundidad del
	// motor (near=1, far=1e6) la precision en 20 bloques es ~2.4e-5, asi que
	// 0.03 son mas de 1000x esa precision: no pelea por la profundidad.
	const SOMBRA_Y = 0.03
	// marco de seleccion de entidad (programa aparte: aristas amarillas del
	// AABB de la vaca que el jugador esta mirando, mira el marco de bloque)
	let progCaja = null
	let locCaja = null
	let bufCaja = null
	const uCaja = new Float32Array(16)   // modelo del AABB (se reutiliza)
	const CAJA_COLOR = [1.0, 0.88, 0.1]  // amarillo marco de bloque
	const CAJA_MARGEN = 0.02
	// entidad apuntada por el rayo del jugador (la marca game.js lookingAt)
	let apuntada = null

	// ------------------------------------------------------------- shaders ---
	let FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
	precision highp float;
#else
	precision mediump float;
#endif
	uniform sampler2D uTex;
	varying vec2 vUV;
	varying float vShadow;
	varying float vFog;
	void main() {
		vec4 color = texture2D(uTex, vUV);
		color.rgb *= vShadow;
		color.r += (0.33 - color.r) * vFog;
		color.g += (0.54 - color.g) * vFog;
		color.b += (0.72 - color.b) * vFog;
		gl_FragColor = color;
		if (gl_FragColor.a == 0.0) discard;
	}`
	// MODO "solo": sin textura ni niebla, pinta la luz en gris.  Es la prueba
	// definitiva de que este shader es el que corre en el navegador.
	if (MODO === "solo") {
		FS = FS
			.replace("vec4 color = texture2D(uTex, vUV);", "vec4 color = vec4(1.0);")
			.replace("color.rgb *= vShadow;", "color.rgb = vec3(vShadow);")
			// la niebla tambien: a media distancia el gris se fundia con el
			// cielo y el diagnostico perdia el degradado justo donde hay que
			// mirarlo.
			.replace("color.r += (0.33 - color.r) * vFog;", "")
			.replace("color.g += (0.54 - color.g) * vFog;", "")
			.replace("color.b += (0.72 - color.b) * vFog;", "")
	}

	// MODO "off": vShadow = 1 sin luz NI oclusion.  Si con esto la vaca sigue
	// viendose plana, el sombreado no es el problema.  Hay que apagar tambien
	// el `* aAO`: o bien queda `vShadow = 1.0; * aAO;` (sintaxis rota) o la
	// luz sigue variando por el AO y el diagnostico miente.
	function aplicarModo(vs) {
		if (MODO !== "off") return vs
		return vs.replace(/vShadow = sombreado\(n\) \* aAO;/g, "vShadow = 1.0;")
	}

	// Sombra de contacto: un quad horizontal eliptico bajo el cuerpo.  Sin
	// ella la vaca flota sobre el terreno aunque el sombreado este perfecto.
	// Semi-ejes en bloques (el modelo mide 1.6 x 6.8 unidades * escala 0.36).
	const VS_SOMBRA = `
attribute vec2 aPos;
uniform mat4 uVista;
uniform vec4 uCuerpo;   // centro x,y,z + yaw
uniform vec3 uPos;
uniform float uDist;
varying vec2 vUV;
varying float vFog;
const float RX = 0.38;
const float RZ = 1.15;
void main() {
	vUV = aPos;
	float c = cos(uCuerpo.w);
	float s = sin(uCuerpo.w);
	vec2 rel = vec2(aPos.x * RX, aPos.y * RZ);
	// Rotacion en el plano (x,z) con la MISMA matriz que rotY() del cuerpo:
	// la transpuesta (x*c - y*s / x*s + y*c) espejaba la elipse, y una vaca
	// que caminaba al este proyectaba la sombra al oeste.
	vec2 giro = vec2(rel.x * c + rel.y * s, -rel.x * s + rel.y * c);
	vec3 w = vec3(uCuerpo.x + giro.x, uCuerpo.y, uCuerpo.z + giro.y);
	float range = max(uDist / 5.0, 8.0);
	vFog = clamp((length(uPos.xz - w.xz) - uDist + range) / range, 0.0, 1.0);
	gl_Position = uVista * vec4(w, 1.0);
}`

	const FS_SOMBRA = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
	precision highp float;
#else
	precision mediump float;
#endif
uniform float uOpacidad;
varying vec2 vUV;
varying float vFog;
void main() {
	float a = 1.0 - length(vUV);
	a = a * a * (1.0 - vFog) * uOpacidad;
	if (a <= 0.0) discard;
	gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`

	// Marco de seleccion de entidad: 12 aristas de un cubo escalado al AABB
	// de la vaca apuntada.  Sin skinning ni niebla: solo uVista * uModelo.
	const VS_CAJA = `
attribute vec3 aPos;
uniform mat4 uVista;
uniform mat4 uModelo;
void main() {
	gl_Position = uVista * uModelo * vec4(aPos, 1.0);
}`

	const FS_CAJA = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
	precision highp float;
#else
	precision mediump float;
#endif
uniform vec3 uColor;
void main() {
	gl_FragColor = vec4(uColor, 1.0);
}`

	// Cubo unitario centrado en el origen (lados de 1): 12 aristas x 2 vert.
	const CAJA_VERTS = new Float32Array([
		-.5, -.5, -.5,   .5, -.5, -.5,
		 .5, -.5, -.5,   .5, -.5,  .5,
		 .5, -.5,  .5,  -.5, -.5,  .5,
		-.5, -.5,  .5,  -.5, -.5, -.5,
		-.5,  .5, -.5,   .5,  .5, -.5,
		 .5,  .5, -.5,   .5,  .5,  .5,
		 .5,  .5,  .5,  -.5,  .5,  .5,
		-.5,  .5,  .5,  -.5,  .5, -.5,
		-.5, -.5, -.5,  -.5,  .5, -.5,
		 .5, -.5, -.5,   .5,  .5, -.5,
		 .5, -.5,  .5,   .5,  .5,  .5,
		-.5, -.5,  .5,  -.5,  .5,  .5,
	])

	const SOMBREADO = `
	// Bloque de sombreado: UNA sola definicion, compartida por VS_BASE y
	// VS_SKIN, para que los dos shaders no se puedan desincronizar.
	//
	// El motor no tiene luz direccional.  Los bloques sacan el volumen de
	// aShadow, un float por vertice horneado en game.js:4622 (getShadows)
	// = AO por vecinos (shade = [1, .85, .7, .6, .3] segun cuantos bloques
	// solidos rodean la esquina) multiplicado por un escalon fijo por cara:
	// 1.0 / 0.95 / 0.95 / 0.8 / 0.8 / 0.75.  No hay coseno ni normales.
	//
	// La vaca hacia un lambert suave distinto y se le veia "plano, sin
	// volumen": un degradado continuo no comunica volumen en un mundo hecho
	// de escalones, y ademas la vaca no se atenuaba donde el cuerpo se toca
	// a si misma.
	//
	//   cara(n)  -> el mismo escalon por orientacion que los bloques.
	//   suave    -> el half-lambert + hemisferio anterior (PASO = 0 lo
	//               recupera), mezclado con el escalon.
	//   aAO      -> oclusion horneada en glb.js oclusion(): cuanto de la
	//               propia malla hay por delante de la normal.  Es lo que
	//               oscurece entrepiernas, cuello y barriga.
	//
	// Regresiones ya vistas: el lambert con max() dejaba el 53.8% de los
	// vertices clavados en el minimo; el techo 0.32+0.68*d apilaba el 79%
	// de la superficie visible en [0.70,1.00] y el tono seguia a la camara.
	const float PASO = 1.0;
	// El nombre de las caras esta cruzado en el motor: Sides.top = 0
	// (game.js:1975) pero mapCoords dice "case 0: // Bottom" (game.js:2199)
	// y getShadows.top muestrea y-1 (game.js:4626, "Actually the bottom...").
	// Si en el juego la cara de arriba de un bloque sale mas oscura que los
	// lados, basta con intercambiar estos dos valores.
	const float LUZ_ARRIBA = 1.0;
	const float LUZ_ABAJO = 0.75;
	float cara(vec3 u) {
		vec3 a = abs(u);
		if (a.y >= a.x && a.y >= a.z) return u.y > 0.0 ? LUZ_ARRIBA : LUZ_ABAJO;
		return a.z >= a.x ? 0.95 : 0.80;
	}
	float sombreado(vec3 n) {
		vec3 u = normalize(n);
		vec3 luzClave = normalize(vec3(0.42, 0.86, 0.28));
		float hl = dot(u, luzClave) * 0.5 + 0.5;
		float cielo = u.y * 0.5 + 0.5;
		float suave = 0.18 + 0.50 * hl + 0.32 * cielo;
		// multiplicacion, no mezcla: el motor aplica shade[ao] * escalon de
		// cara, y con mezcla el escalon (0.75..1.0) aplastaba el gradiente
		// (el rango visible bajaba de 0.152 a 0.095 de desviacion tipica).
		return suave * mix(1.0, cara(u), PASO);
	}
	`

	const VS_BASE = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute float aAO;
attribute vec2 aUV;
uniform mat4 uView;
uniform mat4 uModel;
uniform vec3 uPos;
uniform float uDist;
	varying vec2 vUV;
	varying float vShadow;
	varying float vFog;
` + SOMBREADO + `
	void main() {
		vec4 pos = uModel * vec4(aPos, 1.0);
	vec3 n = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNor);
	vShadow = sombreado(n) * aAO;
	vUV = aUV;
	float range = max(uDist / 5.0, 8.0);
	vFog = clamp((length(uPos.xz - pos.xz) - uDist + range) / range, 0.0, 1.0);
	gl_Position = uView * pos;
}`

	const VS_SKIN = `
precision highp sampler2D;
attribute vec3 aPos;
attribute vec3 aNor;
attribute float aAO;
attribute vec2 aUV;
attribute vec4 aJoints;
attribute vec4 aWeights;
uniform mat4 uView;
uniform mat4 uModel;
uniform sampler2D uBones;
uniform float uHuesos;
uniform vec3 uPos;
uniform float uDist;
	varying vec2 vUV;
	varying float vShadow;
	varying float vFog;
` + SOMBREADO + `
	vec4 colHueso(float h, float c) {
	return texture2D(uBones, vec2((c + 0.5) * 0.25, (h + 0.5) / uHuesos));
}
mat4 hueso(float h) {
	return mat4(colHueso(h, 0.0), colHueso(h, 1.0), colHueso(h, 2.0), colHueso(h, 3.0));
}
void main() {
	mat4 sk = aWeights.x * hueso(aJoints.x)
		+ aWeights.y * hueso(aJoints.y)
		+ aWeights.z * hueso(aJoints.z)
		+ aWeights.w * hueso(aJoints.w);
	vec4 pos = uModel * (sk * vec4(aPos, 1.0));
	vec3 n = mat3(sk[0].xyz, sk[1].xyz, sk[2].xyz) * aNor;
	n = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * n;
	vShadow = sombreado(n) * aAO;
	vUV = aUV;
	float range = max(uDist / 5.0, 8.0);
	vFog = clamp((length(uPos.xz - pos.xz) - uDist + range) / range, 0.0, 1.0);
	gl_Position = uView * pos;
}`

	// ------------------------------------------------------------ matematica
	function mul4(out, a, b) {
		for (let c = 0; c < 4; c++) {
			const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3]
			for (let r = 0; r < 4; r++) {
				tmpA[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3
			}
		}
		out.set(tmpA)
	}

	function traslacion(out, x, y, z) {
		out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])
	}

	function rotY(out, ang) {
		const c = Math.cos(ang), s = Math.sin(ang)
		out.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
	}

	// ---------------------------------------------------------------- init --
	function compilar(vsSrc, fsSrc) {
		const v = gl.createShader(gl.VERTEX_SHADER)
		gl.shaderSource(v, vsSrc)
		gl.compileShader(v)
		if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) throw "shader: " + gl.getShaderInfoLog(v)
		const f = gl.createShader(gl.FRAGMENT_SHADER)
		gl.shaderSource(f, fsSrc)
		gl.compileShader(f)
		if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) throw "shader: " + gl.getShaderInfoLog(f)
		const p = gl.createProgram()
		gl.attachShader(p, v)
		gl.attachShader(p, f)
		gl.linkProgram(p)
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw "link: " + gl.getProgramInfoLog(p)
		return p
	}

	function atributos(programa) {
		const a = {}
		for (const n of ["aPos", "aNor", "aAO", "aUV", "aJoints", "aWeights"]) {
			a[n] = gl.getAttribLocation(programa, n)
		}
		const u = {}
		for (const n of ["uView", "uModel", "uPos", "uDist", "uTex", "uBones", "uHuesos"]) {
			u[n] = gl.getUniformLocation(programa, n)
		}
		return { a, u }
	}

	// El quad de sombra usa otros nombres (uVista/uCuerpo y no uModel, para
	// no mezclar sus matrices con las de las vacas).
	function atributosSombra(programa) {
		const a = {}, u = {}
		a.aPos = gl.getAttribLocation(programa, "aPos")
		for (const n of ["uVista", "uCuerpo", "uPos", "uDist", "uOpacidad"]) {
			u[n] = gl.getUniformLocation(programa, n)
		}
		return { a, u }
	}

	// El marco de entidad: uVista + uModelo (escala/traduccion del AABB) y
	// color plano, todo separado para no mezclarlo ni con vacas ni con sombra.
	function atributosCaja(programa) {
		const a = {}, u = {}
		a.aPos = gl.getAttribLocation(programa, "aPos")
		u.uVista = gl.getUniformLocation(programa, "uVista")
		u.uModelo = gl.getUniformLocation(programa, "uModelo")
		u.uColor = gl.getUniformLocation(programa, "uColor")
		return { a, u }
	}

	function init(contexto) {
		if (listo || cargando) return
		gl = contexto || window.gl
		if (!gl) return

		// Compatibilidad: skinning en GPU hace falta textura de huesos (RGBA/FLOAT)
		// y vertex texture fetch.  Si falta cualquiera de las dos, se usa CPU.
		const floatOK = !!gl.getExtension("OES_texture_float")
		const vtex = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) | 0
		cpuSkin = !floatOK || vtex === 0
		if (cpuSkin) {
			console.warn("identidades: sin skinning en GPU (OES_texture_float=" + floatOK +
				", vertex textures=" + vtex + "); se usa el respaldo en CPU")
		}

		// initWebgl() nos deja el programa de bloques activo: lo devolvemos al salir.
		const anterior = gl.getParameter(gl.CURRENT_PROGRAM)
		try {
			prog = compilar(aplicarModo(cpuSkin ? VS_BASE : VS_SKIN), FS)
		} catch (e) {
			console.warn("identidades: " + e)
			gl.useProgram(anterior)
			return
		}
		loc = atributos(prog)
		gl.useProgram(prog)
		gl.uniform1i(loc.u.uTex, 2)
		if (loc.u.uBones) gl.uniform1i(loc.u.uBones, 3)

		// El .glb crudo baja por fetch (Chrome bloquea file://: en local,
		// node tools/servir.mjs).  montar() termina el init cuando llega.
		cargando = true
		const url = "models/LOW-POLY/" + IDENTIDADES.vaca.modelo + ".glb"
		window.VXLGLB.cargarUrl(gl, url).then(montar).catch(e => {
			cargando = false
			console.warn("identidades: no carga " + url + ": " + e.message +
				" (¿servidor local? node tools/servir.mjs)")
		})

		gl.useProgram(anterior)
	}

	// Segunda mitad del init: el .glb ya esta parseado y la GPU lista.
	async function montar(m) {
		modelo = m
		// al terminar el fetch el programa activo es el de los bloques:
		// volvemos al nuestro para poder fijar uHuesos.
		const previo = gl.getParameter(gl.CURRENT_PROGRAM)
		gl.useProgram(prog)
		if (loc.u.uHuesos) gl.uniform1f(loc.u.uHuesos, modelo.numHuesos)
		huesos = new Float32Array(modelo.numHuesos * 16)
		if (cpuSkin) {
			posCPU = gl.createBuffer()
			norCPU = gl.createBuffer()
			gl.bindBuffer(gl.ARRAY_BUFFER, posCPU)
			gl.bufferData(gl.ARRAY_BUFFER, modelo.malla.pos, gl.DYNAMIC_DRAW)
			gl.bindBuffer(gl.ARRAY_BUFFER, norCPU)
			gl.bufferData(gl.ARRAY_BUFFER, modelo.malla.nor, gl.DYNAMIC_DRAW)
		}

		// matriz base del modelo: centrar en XZ + escalar (pies en y = 0)
		const b = modelo.bounds
		const cx = (b.min[0] + b.max[0]) / 2
		const cz = (b.min[2] + b.max[2]) / 2
		for (const k in IDENTIDADES) {
			const f = IDENTIDADES[k]
			if (f.modelo !== "COW") continue
			const s = f.escala
			baseModelo[k] = new Float32Array([
				s, 0, 0, 0,
				0, s, 0, 0,
				0, 0, s, 0,
				-s * cx, 0, -s * cz, 1,
			])
		}
		// sombra de contacto: programa + quad.  Si falla no es fatal, la vaca
		// simplemente se queda sin sombra en el suelo.
		try {
			progSombra = compilar(VS_SOMBRA, FS_SOMBRA)
			locSombra = atributosSombra(progSombra)
			bufSombra = gl.createBuffer()
			gl.bindBuffer(gl.ARRAY_BUFFER, bufSombra)
			gl.bufferData(gl.ARRAY_BUFFER,
				new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
		} catch (e) {
			progSombra = null
			locSombra = null
			console.warn("identidades: sin sombra de contacto: " + e)
		}

		// marco de seleccion de entidad: aristas del AABB de la vaca que el
		// jugador mira.  Si falla no es fatal: simplemente no se dibuja.
		try {
			progCaja = compilar(VS_CAJA, FS_CAJA)
			locCaja = atributosCaja(progCaja)
			bufCaja = gl.createBuffer()
			gl.bindBuffer(gl.ARRAY_BUFFER, bufCaja)
			gl.bufferData(gl.ARRAY_BUFFER, CAJA_VERTS, gl.STATIC_DRAW)
		} catch (e) {
			progCaja = null
			locCaja = null
			console.warn("identidades: sin marco de entidad: " + e)
		}

		// texturas por bioma: png/skins/<n>.png.  Si alguna falla, esa skin
		// se queda en la embebida del glb y el juego sigue funcionando.
		const nombres = new Set()
		for (const k in IDENTIDADES) {
			const fi = IDENTIDADES[k]
			if (!fi.skins) continue
			for (const bio in fi.skins) {
				const v = fi.skins[bio]
				if (Array.isArray(v)) v.forEach(n => nombres.add(n))
				else nombres.add(v)
			}
		}
		nombresSkin = Array.from(nombres)
		await Promise.all(Array.from(nombres, async n => {
			try {
				const res = await fetch("png/skins/" + n + ".png")
				if (!res.ok) throw new Error("HTTP " + res.status)
				const t = await window.VXLGLB.decodificarPNG(new Uint8Array(await res.arrayBuffer()))
				skins[n] = window.VXLGLB.texturaRGBA(gl, t.rgba, t.w, t.h)
			} catch (e) {
				console.warn("identidades: sin skin " + n + ": " + e.message)
			}
		}))

		gl.useProgram(previo)

		listo = true
		ultimaActualizacion = performance.now()
		siguienteSpawn = 0
		console.log("identidades: vaca lista (" + modelo.numHuesos + " huesos, " +
			Object.keys(modelo.clips).length + " clips, skinning " + (cpuSkin ? "CPU" : "GPU") +
			", skins " + Object.keys(skins).length +
			", luz " + SHADING + (MODO === "actual" ? "" : ", modo " + MODO) + ")")
	}

	// --------------------------------------------------------------- spawn --
	function solido(b) {
		if (!b) return false
		const V = window.VXL
		if (!V) return false
		if ((b & 0xff) === V.blockIds.waterBlock) return false
		const d = V.blockData[b & 0xff]
		return !!d && !d.passable
	}

	// Lava: la vaca la ESQUIVA (a diferencia del agua, de la que ademas
	// bebe).  En los mocks de tools/check-identidades.mjs no existe
	// blockIds.lava, y un id nunca es `undefined`, asi que ahi este
	// filtro no cambia nada.
	function esLava(b) {
		const V = window.VXL
		return !!V && !!V.blockIds && (b & 0xff) === V.blockIds.lava
	}

	// Bioma de (x,z) o null si el motor aun no esta.
	function biomaEn(x, z) {
		const V = window.VXL
		return V && V.biomeAt ? V.biomeAt(x, z) : null
	}

	// Skin que le toca a una vaca nacida en (x,z): la del bioma de spawn
	// (si el bioma trae varias, se elige una al azar).
	function piel(f, x, z) {
		const b = biomaEn(x, z)
		const s = (f.skins && b && f.skins[b]) || f.skinDefecto || null
		return Array.isArray(s) ? s[(Math.random() * s.length) | 0] : s
	}

	// Identificador unico de entidad (cow_ + 8 hex).  Se guarda con el
	// mundo: el mismo animal recupera su id al recargar la partida.
	function nuevoId() {
		let s = ""
		for (let i = 0; i < 8; i++) s += ((Math.random() * 16) | 0).toString(16)
		return "cow_" + s
	}

	// Stats y genoma: por ahora VALORES FIJOS de ejemplo para TODAS las
	// vacas.  El sistema genetico (pendiente) los reemplazara por genes
	// reales; hasta entonces el panel muestra siempre estos numeros.
	function statsNuevos() {
		return {
			age: 1.0,
			gender: "female",
			weight_kg: 540.2,
			milk_capacity_l: 18.5,
			is_pregnant: false,
			salud: 100,
			saciedad: 100,          // 100 llena; < SACIEDAD_COMER pastorea
			hidratacion: 100,       // 100 hidratada; < UMBRAL va a por agua
		}
	}
	function genomeNuevo() {
		return { coat_matrix_seed: 142857, weight_gene: 0.68, milk_gene: 0.52 }
	}

	// skinForzada: nombre opcional ("Cow4"); si no esta entre las skins
	// declaradas en las fichas se ignora y manda la del bioma.
	function spawn(nombre, x, y, z, skinForzada) {
		const f = IDENTIDADES[nombre]
		if (!f || !listo) return null
		const alto = f.alto
		const e = {
			ficha: f,
			nombre,
			id: nuevoId(),             // cow_XXXXXXXX, unico por entidad
			skin: (skinForzada && nombresSkin.indexOf(skinForzada) >= 0)
				? skinForzada : piel(f, x, z),
			biomeOrigen: biomaEn(x, z),// bioma de spawn (se guarda con el mundo)
			stats: statsNuevos(),
			genome: genomeNuevo(),
			x, y, z,
			vx: 0, vy: 0, vz: 0,
			w: f.ancho / 2,
			bottomH: alto * 0.7,
			topH: alto * 0.3,
			maxVy: MAX_VY,
			spectator: false,
			onGround: false,
			canStepX: false,
			canStepZ: false,
			previousX: x, previousY: y, previousZ: z,
			encab: Math.random() * Math.PI * 2,
			encabObj: 0,
			estado: "idle",
			temporizador: 800 + Math.random() * 2500,
			anim: "idle",
			tAnim: Math.random() * 3,
			bloqueado: false,
			picado: 0,                 // mordiscos dados en el bocado actual
			pastor: null,              // mata que esta persiguiendo (pastoreo)
			proxBusq: 0,               // ms para el proximo escaneo de grama
			pastorBloq: 0,             // ms bloqueado yendo hacia una mata
			beber: null,               // columna de agua hacia la que va (sed)
			beberBloq: 0,              // ms bloqueado yendo hacia el agua
			proh: 0,                   // ms que una mata inalcanzable sigue excluida
			prohCol: null,
			buscaPausa: 0,             // ms de pausa general de busqueda (2 fallos)
			fallosBusq: 0,             // intentos seguidos fallidos contra un obstaculo
			saltarT: 0,                // ms que dura el salto en el aire
			saltos: 0,                 // saltos dados (contador de tests)
			esquivando: 0,             // ms de rodeo acumulados (0 = sin rodeo)
			esquivObj: 0,              // rumbo del rodeo actual
			cimaY: 0,                  // suelo del ultimo aterrizaje/lanzamiento
			cimaIntentos: 0,           // aterrizajes sin progresar (tope de saltos)
			distIntento: Infinity,     // ultima distancia ganada (0,75) al objetivo
			arrimo: null,              // {x,z} deslizamiento hasta el bloque de la boca
		}
		e.encabObj = e.encab
		entidades.push(e)
		return e
	}

	// ----------------------------------------------------------- guardado --
	// Esquema de cada entidad dentro del record del mundo (IndexedDB):
	//   entity_id, type, position{x,y,z}, biome_origin, texture_variant,
	//   encab, stats{}, genome{}
	function exportar() {
		const r3 = v => Math.round(v * 1000) / 1000
		return entidades.map(e => ({
			entity_id: e.id,
			type: e.nombre,
			position: { x: r3(e.x), y: r3(e.y), z: r3(e.z) },
			biome_origin: e.biomeOrigen,
			texture_variant: e.skin,
			encab: r3(e.encab),
			stats: Object.assign({}, e.stats),
			genome: Object.assign({}, e.genome),
		}))
	}

	// Restaura la lista completa del guardado (REEMPLAZA las actuales).
	// Devuelve cuantas entidades se restauraron; las entradas desconocidas
	// (type inexistente, posicion invalida) se saltan sin cortar el resto.
	function restaurar(lista) {
		if (!Array.isArray(lista)) return 0
		const V = window.VXL
		// update() vacia la lista si cambio el mundo desde la ultima vez;
		// marcar el actual evita que borre justo lo recien restaurado.
		if (V) ultimoMundo = V.world
		entidades.length = 0
		let n = 0
		for (const d of lista) {
			if (!d || typeof d !== "object") continue
			const f = IDENTIDADES[d.type]
			const pos = d.position
			if (!f || !pos) continue
			if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) continue
			const e = spawn(d.type, pos.x, pos.y, pos.z)
			if (!e) continue
			if (typeof d.entity_id === "string" && d.entity_id) e.id = d.entity_id
			if (typeof d.texture_variant === "string" && d.texture_variant) e.skin = d.texture_variant
			if (Number.isFinite(d.encab)) e.encab = e.encabObj = d.encab
			if (typeof d.biome_origin === "string" && d.biome_origin) e.biomeOrigen = d.biome_origin
			if (d.stats && typeof d.stats === "object") e.stats = Object.assign(e.stats, d.stats)
			if (d.genome && typeof d.genome === "object") e.genome = Object.assign(e.genome, d.genome)
			// saves antiguos sin estos campos (o JSON corrupto): a los defaults
			if (!Number.isFinite(e.stats.saciedad)) e.stats.saciedad = 100
			if (!Number.isFinite(e.stats.hidratacion)) e.stats.hidratacion = 100
			n++
		}
		return n
	}

	// Ray vs AABB de cada entidad (slab por eje, como rayTrace de bloques).
	// Devuelve la entidad mas cercana cuyo t (sobre la direccion normalizada)
	// quede dentro de `alcance`, o null.  `t` es distancia en bloques: se
	// compara directamente con hitBox.closest del motor.
	function apuntar(ox, oy, oz, dx, dy, dz, alcance) {
		if (!(alcance > 0)) return null
		const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
		if (!(len > 0)) return null
		const ix = dx / len, iy = dy / len, iz = dz / len
		let mejor = null
		let mejorT = alcance
		for (let i = 0; i < entidades.length; i++) {
			const e = entidades[i]
			let tmin = 0
			let tmax = mejorT
			// eje x: si el rayo es paralelo, o toca la banda o falla ya
			if (Math.abs(ix) < 1e-9) {
				if (ox < e.x - e.w || ox > e.x + e.w) continue
			} else {
				let ta = (e.x - e.w - ox) / ix
				let tb = (e.x + e.w - ox) / ix
				if (ta > tb) { const s = ta; ta = tb; tb = s }
				if (ta > tmin) tmin = ta
				if (tb < tmax) tmax = tb
				if (tmin > tmax) continue
			}
			// eje y: de e.y - bottomH (cascos) a e.y + topH (lomo)
			if (Math.abs(iy) < 1e-9) {
				if (oy < e.y - e.bottomH || oy > e.y + e.topH) continue
			} else {
				let ta = (e.y - e.bottomH - oy) / iy
				let tb = (e.y + e.topH - oy) / iy
				if (ta > tb) { const s = ta; ta = tb; tb = s }
				if (ta > tmin) tmin = ta
				if (tb < tmax) tmax = tb
				if (tmin > tmax) continue
			}
			// eje z
			if (Math.abs(iz) < 1e-9) {
				if (oz < e.z - e.w || oz > e.z + e.w) continue
			} else {
				let ta = (e.z - e.w - oz) / iz
				let tb = (e.z + e.w - oz) / iz
				if (ta > tb) { const s = ta; ta = tb; tb = s }
				if (ta > tmin) tmin = ta
				if (tb < tmax) tmax = tb
				if (tmin > tmax) continue
			}
			mejor = e
			mejorT = tmin
		}
		return mejor ? { e: mejor, t: mejorT } : null
	}

	// Suelo real de la columna (x,z): los PIES sobre la cara superior del
	// bloque (bloques centrados en enteros: la cara superior de `y` esta en
	// y + 0.5, ver shapes.cube -> mapCoords / genMesh) o null si la columna
	// no sirve (chunk sin cargar, bloque solido encima, agua...).
	function sueloColumna(x, z) {
		const V = window.VXL
		const world = V.world
		const f = IDENTIDADES.vaca
		const ch = world.chunks[x >> 4] && world.chunks[x >> 4][z >> 4]
		if (!ch || !ch.buffer || !ch.tops) return null
		// tops[] = bloque solido mas alto de la columna (tras la limadera
		// de pendientes, asi que es el suelo real y no terrainHeight())
		const y = ch.tops[(z & 15) * 16 + (x & 15)]
		if (!solido(world.getBlock(x, y, z))) return null
		const arriba = world.getBlock(x, y + 1, z)
		if (solido(arriba) || solido(world.getBlock(x, y + 2, z))) return null
		if ((arriba & 0xff) === V.blockIds.waterBlock || esLava(arriba)) return null
		return { x: x, y: y + 0.5 + f.alto * 0.7, z: z }
	}

	function buscarSuelo() {
		const V = window.VXL
		const p = V.p
		const f = IDENTIDADES.vaca
		for (let intento = 0; intento < 8; intento++) {
			const ang = Math.random() * Math.PI * 2
			const r = f.radioSpawn[0] + Math.random() * (f.radioSpawn[1] - f.radioSpawn[0])
			const x = Math.round(p.x + Math.cos(ang) * r)
			const z = Math.round(p.z + Math.sin(ang) * r)
			if (Math.abs(x - p.x) < 6 && Math.abs(z - p.z) < 6) continue
			if (f.biomas.indexOf(V.biomeAt(x, z)) < 0) continue
			const s = sueloColumna(x, z)
			if (s) return s
		}
		return null
	}

	// Spawn MANUAL a `dist` bloques POR DELANTE del jugador: la direccion
	// horizontal de la mirada, sin filtro de bioma (el /vaca de chat).
	// Devuelve null si esa columna no tiene suelo libre justo delante.
	function spawnFrente(nombre, dist, skinForzada) {
		const V = window.VXL
		const p = V && V.p
		if (!p || !p.direction) return null
		let hx = p.direction.x
		let hz = p.direction.z
		const len = Math.sqrt(hx * hx + hz * hz)
		if (len < 0.05) {      // mirando al cielo o al suelo: +Z
			hx = 0
			hz = 1
		} else {
			hx /= len
			hz /= len
		}
		const x = Math.round(p.x + hx * dist)
		const z = Math.round(p.z + hz * dist)
		const s = sueloColumna(x, z)
		if (!s) return null
		return spawn(nombre || "vaca", s.x, s.y, s.z, skinForzada)
	}

	// ----------------------------------------------------------------- IA ---
	function corto(a) {
		while (a > Math.PI) a -= Math.PI * 2
		while (a < -Math.PI) a += Math.PI * 2
		return a
	}

	function delante(e, dx, dz) {
		const V = window.VXL
		const world = V.world
		const pies = e.y - e.bottomH
		const x = Math.round(e.x + dx)
		const z = Math.round(e.z + dz)
		const suelo = Math.floor(pies - 0.5)
		const cuerpo = Math.round(pies + 0.1)
		const techo = Math.round(pies + 1.1)
		// El agua no es suelo transitable: ni pisarla con el bloque de abajo
		// ni meter el cuerpo por delante.  Cubre orillas bajas y charcas con
		// agua SIN solido debajo a la altura de los pies (si la hay,
		// solido() ya devuelve false y se rechaza igual).
		for (let y = suelo; y <= techo; y++) {
			const b = world.getBlock(x, y, z)
			if ((b & 0xff) === V.blockIds.waterBlock || esLava(b)) return false
		}
		// Bloques centrados en enteros: el que esta bajo los pies es
		// floor(pies - 0.5); los de encima, round(pies + delta).
		// solido() ignora hierba y otros bloques pasables.
		const abajo = solido(world.getBlock(x, suelo, z))
		const enCuerpo = solido(world.getBlock(x, cuerpo, z))
		if (!abajo) {
			// Bajada de UN bloque: suelo solido un nivel mas abajo y el
			// cuerpo libre; la gravedad la aterriza.  De 2+ sigue siendo
			// barranco (el guardia de antes).
			return !solido(world.getBlock(x, suelo - 1, z)) ? false : !enCuerpo
		}
		if (enCuerpo) {
			// Escalon de 1 bloque: NO es transitable andando.  El motor
			// real anula canStep si la cara del bloque sube mas de 0,5
			// sobre los pies (game.js:3302), asi que un bloque COMPLETO
			// solo se supera saltando; aqui se decide lo mismo para no
			// apuntar un rumbo que no se puede recorrer (la vaca daria
			// empujones hasta olvidar el objetivo en vez de saltarlo).
			return false
		}
		return !solido(world.getBlock(x, techo, z))
	}

	function columnaPropia(e) {
		return { x: Math.round(e.x), z: Math.round(e.z) }
	}

	function columnaFrente(e) {
		return {
			x: Math.round(e.x) + Math.round(-Math.sin(e.encab)),
			z: Math.round(e.z) + Math.round(Math.cos(e.encab)),
		}
	}

	// Punto al que deslizarse para dejar la columna objetivo a la
	// distancia 'boca' en la direccion de la mirada (el bloque acaba
	// justo debajo de la cabeza).  El punto se acota en espacio de
	// POSICION a la propia columna: round() no cambia en todo el camino,
	// asi el deslizamiento nunca cruza a la columna de al lado (ni al
	// agua) ni se sale del suelo que pisa.  null si no hay que moverse.
	function arrimar(e, obj, boca) {
		const dx = obj.x - e.x
		const dz = obj.z - e.z
		const d = Math.hypot(dx, dz)
		if (d < 0.02) return null
		const avance = Math.max(-0.75, Math.min(0.75, d - boca))
		let tx = e.x + dx / d * avance
		let tz = e.z + dz / d * avance
		const cx = Math.round(e.x)
		const cz = Math.round(e.z)
		if (Math.round(tx) !== cx) tx = cx + (tx > cx ? 0.49 : -0.49)
		if (Math.round(tz) !== cz) tz = cz + (tz > cz ? 0.49 : -0.49)
		if (Math.hypot(tx - e.x, tz - e.z) < 0.02) return null
		return { x: tx, z: tz }
	}

	function esGrama(b) {
		const ids = window.VXL.blockIds
		return b === ids.tallGrassBottom || b === ids.tallGrassTop || b === ids.grassPlant
	}

	// ¿Hay gramilla en la columna propia o en la de delante?  Mira tres
	// alturas (y-1, y, y+1) para tumbas a un paso de desnivel.  Devuelve
	// la COLUMNA con gramilla (la propia primero: la que muerde
	// picarGrama) o null.
	function hayGrama(e) {
		const world = window.VXL.world
		const y = Math.floor(e.y - e.bottomH - 0.5) + 1
		const cols = [columnaPropia(e), columnaFrente(e)]
		for (let i = 0; i < 2; i++) {
			const c = cols[i]
			for (let h = y + 1; h >= y - 1; h--) {
				if (esGrama(world.getBlock(c.x, h, c.z) & 0xff)) return c
			}
		}
		return null
	}

	// La mata transitable mas cercana en un radio de 9 bloques (pastoreo).
	// Barre con ch.tops[] como buscarSuelo(): el suelo real de la columna,
	// que es donde el generador pudo poner gramilla.
	function buscarGrama(e) {
		const V = window.VXL
		const world = V.world
		const cx = Math.round(e.x)
		const cz = Math.round(e.z)
		const radio = 9
		let mejor = null
		let mejorD = Infinity
		for (let dz = -radio; dz <= radio; dz++) {
			for (let dx = -radio; dx <= radio; dx++) {
				const d2 = dx * dx + dz * dz
				if (d2 > radio * radio || d2 >= mejorD) continue
				const x = cx + dx
				const z = cz + dz
				// una mata a la que no se pudo llegar hace un rato, la
				// seguimos esquivando mientras dure la exclusion
				if (e.proh > 0 && e.prohCol && x === e.prohCol.x && z === e.prohCol.z) continue
				const ch = world.chunks[x >> 4] && world.chunks[x >> 4][z >> 4]
				if (!ch || !ch.tops) continue
				const top = ch.tops[(z & 15) * 16 + (x & 15)]
				if (!solido(world.getBlock(x, top, z))) continue
				let agua = false
				let libre = true
				for (let y = top; y <= top + 2; y++) {
					const b = world.getBlock(x, y, z)
					if ((b & 0xff) === V.blockIds.waterBlock) agua = true
					if (y > top && solido(b)) libre = false
				}
				if (agua || !libre) continue
				if (esGrama(world.getBlock(x, top + 1, z) & 0xff)
						|| esGrama(world.getBlock(x, top + 2, z) & 0xff)) {
					mejor = { x: x, z: z }
					mejorD = d2
				}
			}
		}
		return mejor
	}

	// La columna de agua mas cercana en un radio de RADIO_AGUA
	// (hidratacion).  La vaca no puede pisar el agua (delante() la
	// rechaza), asi que el objetivo es la orilla: al llegar, aguaCerca()
	// dispara la bebida.
	function buscarAgua(e) {
		const V = window.VXL
		const world = V.world
		const cx = Math.round(e.x)
		const cz = Math.round(e.z)
		let mejor = null
		let mejorD = Infinity
		for (let dz = -RADIO_AGUA; dz <= RADIO_AGUA; dz++) {
			for (let dx = -RADIO_AGUA; dx <= RADIO_AGUA; dx++) {
				const d2 = dx * dx + dz * dz
				if (d2 === 0 || d2 > RADIO_AGUA * RADIO_AGUA || d2 >= mejorD) continue
				const x = cx + dx
				const z = cz + dz
				const ch = world.chunks[x >> 4] && world.chunks[x >> 4][z >> 4]
				if (!ch || !ch.tops) continue
				const top = ch.tops[(z & 15) * 16 + (x & 15)]
				// el agua vive alrededor del nivel del terreno de la columna
				for (let y = top - 4; y <= top + 6; y++) {
					if ((world.getBlock(x, y, z) & 0xff) === V.blockIds.waterBlock) {
						mejor = { x: x, z: z }
						mejorD = d2
						break
					}
				}
			}
		}
		return mejor
	}

	// ¿Agua a alcance para beber?  Devuelve la COLUMNA de agua mas
	// cercana ({x, z}) o null: en la propia columna o en alguna de las
	// 8 vecinas (DIAGONALES incluidas: la vaca se para en cuanto el
	// lookahead de 0,8 toca el agua, y desde un enfoque diagonal esa
	// casilla queda en diagonal de la suya).  Se mira desde TRES bloques
	// por debajo de los pies hasta la cabeza: asi se bebe desde el filo
	// de un desnivel de 2 (o desde la meseta sobre un lago) sin meterse
	// en el agua, que hayDescenso rechaza a proposito.  Ese margen de 3
	// tambien cubre las charcas de un bloque hundidas respecto a la orilla.
	// Prefiere columna VECINA (para poder apuntarla: el agua solo bajo
	// los pies es respaldo, sin rumbo util que darle).
	function aguaCerca(e) {
		const V = window.VXL
		const world = V.world
		const pies = e.y - e.bottomH
		const suelo = Math.floor(pies - 0.5)
		const techo = Math.round(pies + 1.1)
		const cx = Math.round(e.x)
		const cz = Math.round(e.z)
		let mejor = null
		let mejorD = Infinity
		let propia = false
		for (let dz = -1; dz <= 1; dz++) {
			for (let dx = -1; dx <= 1; dx++) {
				const d2 = dx * dx + dz * dz
				for (let y = suelo - 3; y <= techo; y++) {
					if ((world.getBlock(cx + dx, y, cz + dz) & 0xff) === V.blockIds.waterBlock) {
						if (d2 === 0) propia = true
						else if (d2 < mejorD) {
							mejorD = d2
							mejor = { x: cx + dx, z: cz + dz }
						}
						break
					}
				}
			}
		}
		return mejor || (propia ? { x: cx, z: cz } : null)
	}

	// Mordisco de pastoreo: quita el siguiente trozo en ORDEN (primero la
	// copa de la mata doble, luego la base); los dos van dentro de la misma
	// animacion.  Mira la columna propia y la de delante en tres alturas;
	// un solo trozo por llamada.
	function picarGrama(e) {
		const world = window.VXL.world
		const ids = window.VXL.blockIds
		const y = Math.floor(e.y - e.bottomH - 0.5) + 1
		const cols = [columnaPropia(e), columnaFrente(e)]
		for (let i = 0; i < 2; i++) {
			const c = cols[i]
			// 1) la copa, sin tocar la base
			for (let h = y + 1; h >= y - 1; h--) {
				if ((world.getBlock(c.x, h, c.z) & 0xff) === ids.tallGrassTop) {
					world.setBlock(c.x, h, c.z, 0)
					e.stats.saciedad = Math.min(100, e.stats.saciedad + SACIEDAD_MORDISCO)
					return
				}
			}
			// 2) la base (o una mata doble que ya no tiene copa, o hierba plana)
			for (let h = y + 1; h >= y - 1; h--) {
				const b = world.getBlock(c.x, h, c.z) & 0xff
				if (b === ids.tallGrassBottom || b === ids.grassPlant) {
					world.setBlock(c.x, h, c.z, 0)
					e.stats.saciedad = Math.min(100, e.stats.saciedad + SACIEDAD_MORDISCO)
					return
				}
			}
		}
	}

	// Dos intentos seguidos contra lo inalcanzable (mata detras de un
	// desnivel de +2, charco tras un repicado...): en vez de acosar al
	// obstaculo re-apuntando cada 2 s en un vaiven infinito, la vaca
	// hace una pausa general de busqueda y sigue paseando; al pasarla
	// vuelve a buscar con normalidad.
	function falloBusqueda(e) {
		e.fallosBusq++
		if (e.fallosBusq >= 2) {
			e.buscaPausa = 12000 + Math.random() * 8000
			e.fallosBusq = 0
		}
	}

	// ¿La celda 0,8 por delante en la direccion a es transitable?  Es la
	// misma medicion que hace rumbo() dentro de pensar().
	function transitable(e, a) {
		return delante(e, -Math.sin(a) * 0.8, Math.cos(a) * 0.8)
	}

	// ¿El bloque que tapa el paso es un muro de EXACTAMENTE 1 o 2 alturas,
	// con aire suficiente arriba y sin agua?  Entonces se salta: el motor
	// real no sube bloques COMpletos andando (anula canStep por encima de
	// 0,5 sobre los pies), asi que el de 1 ahora tambien es saltable.
	// Con soloUno=true solo vale el de 1 (el paseo aleatorio no salta
	// muros de 2: eso es cosa del rumbo a un objetivo).  La de 3+ solo se
	// puede rodear; un hueco o un charco no es algo que se pueda saltar
	// (se caeria dentro).  Devuelve la ALTURA del obstaculo: 1 | 2 | false
	// (el llamante usa la altura para elegir el impulso del salto).
	function saltable(e, a, soloUno) {
		const V = window.VXL
		const world = V.world
		const x = Math.round(e.x - Math.sin(a) * 0.8)
		const z = Math.round(e.z + Math.cos(a) * 0.8)
		const suelo = Math.floor(e.y - e.bottomH - 0.5)
		for (let y = suelo; y <= suelo + 4; y++) {
			const b = world.getBlock(x, y, z)
			if ((b & 0xff) === V.blockIds.waterBlock || esLava(b)) return false
		}
		if (!solido(world.getBlock(x, suelo + 1, z))) return false
		if (!solido(world.getBlock(x, suelo + 2, z))) {
			// 1 de alto: dos bloques de aire encima para el cuerpo
			return !solido(world.getBlock(x, suelo + 3, z)) ? 1 : false
		}
		if (soloUno) return false
		// 2 de alto: dos de aire encima de la cresta
		return (!solido(world.getBlock(x, suelo + 3, z))
			&& !solido(world.getBlock(x, suelo + 4, z))) ? 2 : false
	}

	// Delante hay un desnivel de 2+ con suelo seco a poca distancia (para
	// poder saltarlo desde la cima; si no hay fondo o hay agua, no).
	function hayDescenso(e, a) {
		const V = window.VXL
		const world = V.world
		const x = Math.round(e.x - Math.sin(a) * 0.8)
		const z = Math.round(e.z + Math.cos(a) * 0.8)
		const suelo = Math.floor(e.y - e.bottomH - 0.5)
		if (solido(world.getBlock(x, suelo, z))) return false
		if (solido(world.getBlock(x, suelo - 1, z))) return false
		let fondo = false
		for (let y = suelo - 1; y >= suelo - 4; y--) {
			const b = world.getBlock(x, y, z)
			if ((b & 0xff) === V.blockIds.waterBlock || esLava(b)) return false
			if (solido(b)) { fondo = true; break }
		}
		return fondo
	}

	// La direccion transitable mas cercana al objetivo: primero las rectas
	// a 90 grados, luego las diagonales.  null si no hay ninguna.
	function elegirRodeo(e, directo) {
		const offs = [Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75]
		for (let i = 0; i < offs.length; i++) {
			const a = directo + offs[i]
			if (transitable(e, a)) return a
		}
		return null
	}

	// El objetivo directo esta tapado: intenta saltarlo (muro de 2 o bajada
	// desde una cima) o rodearlo por una direccion transitable.  No decide
	// si el objetivo se olvida: eso lo lleva el contador de bloqueo (2,5 s
	// sin poder ir recto) del llamante, igual que antes del rodeo.
	function superarObstaculo(e, ds, directo) {
		if (e.saltarT > 0) return                 // ya en el aire: deja que acabe
		if (e.cimaIntentos < 5) {
			if (saltable(e, directo)) {
				// la altura del obstaculo decide el impulso: 1 con el
				// salto BAJO (no hace falta volar 4 bloques para un
				// escalon) y 2 con el alto, que alcanza la cresta
				const alt = saltable(e, directo)
				e.saltarT = SALTO_MS
				e.saltos++
				e.vy = alt >= 2 ? SALTO_VY2 : SALTO_VY1
				e.cimaY = Math.floor(e.y - e.bottomH - 0.5)
				return
			}
			// Camino en bajada (2+, con fondo seco a <= 4 y sin agua:
			// eso ya lo valida hayDescenso): salto corto hacia delante.
			// Sin el, el guardia antivacio le daria la vuelta al borde y
			// la vaca quedaria pegada arriba (o reintentando contra la
			// meta sin descender nunca: el bug de las pilladas al bajar
			// a por agua).  NO se pide cima ni nivel exacto: basta con
			// que el presupuesto cimaIntentos<5 siga abierto (el
			// estancamiento se cuenta al ATERRIZAR, aqui solo se lanza).
			if (hayDescenso(e, directo)) {
				e.saltarT = SALTO_MS
				e.saltos++
				e.vy = SALTO_BAJADA
				e.cimaY = Math.floor(e.y - e.bottomH - 0.5)
				return
			}
		}
		if (e.esquivando > 0 && !transitable(e, e.esquivObj)) {
			// el tramo del rodeo se ha tapado: se cambia de direccion sin
			// reiniciar el contador (solo es metrica, no reloj de rendicion)
			e.esquivObj = elegirRodeo(e, directo)
			if (e.esquivObj === null) e.esquivando = 0
		} else if (e.esquivando <= 0) {
			const a = elegirRodeo(e, directo)
			if (a === null) return
			e.esquivObj = a
			e.esquivando = 1
		}
		e.esquivando += ds * 1000
		e.encabObj = e.esquivObj
	}

	function pensar(e, ds) {
		const f = e.ficha
		// desgaste de los dos sistemas (ds en segundos)
		e.stats.saciedad = Math.max(0, e.stats.saciedad - SACIEDAD_DESGASTE * ds)
		e.stats.hidratacion = Math.max(0, e.stats.hidratacion - HIDRATACION_DESGASTE * ds)
		// la mata que no se pudo alcanzar vuelve a poder elegirse pasado un rato
		if (e.proh > 0) e.proh -= ds * 1000
		// la pausa general de busqueda tambien corre
		e.buscaPausa = Math.max(0, e.buscaPausa - ds * 1000)
		const puedeBuscar = e.buscaPausa <= 0
		// aterrizaje del salto: al tocar suelo se cierra el vuelo y se
		// anota el nivel donde ha caido.  Cualquier CAMBIO de nivel
		// (subir o bajar) cuenta como progreso y resetea los intentos;
		// aterrizar en el MISMO nivel es estanco y suma intentos (tope
		// 5), asi que ningun salto se repite para siempre.
		if (e.saltarT > 0) {
			if (e.onGround && e.vy <= 0) {
				e.saltarT = 0
				const s = Math.floor(e.y - e.bottomH - 0.5)
				if (s === e.cimaY) {
					e.cimaIntentos++
				} else {
					e.cimaY = s
					e.cimaIntentos = 0
				}
			} else {
				e.saltarT = Math.max(0, e.saltarT - ds * 1000)
			}
		}
		e.temporizador -= ds * 1000
		if (e.temporizador <= 0) {
			if (e.estado === "walk") {
				// con la barriga llena, hidratacion correcta y sin objetivo,
				// larga estancia quieta (sin hambre ni sed no hay motivo
				// para divagar)
				const llena = e.stats.saciedad >= SACIEDAD_COMER
					&& e.stats.hidratacion >= HIDRATACION_UMBRAL
					&& !e.pastor && !e.beber
				e.estado = "idle"
				e.temporizador = llena
					? 9000 + Math.random() * 7000
					: 2000 + Math.random() * 4000
				e.anim = "idle"
				e.tAnim = 0
				e.pastor = null
				e.beber = null
			} else if (e.estado === "idle") {
				const agua = puedeBuscar && e.stats.hidratacion < HIDRATACION_UMBRAL
					? buscarAgua(e) : null
				if (agua) {
					// sedienta: a por la orilla mas cercana; al llegar,
					// aguaCerca() la pone a beber (en el bloque de abajo)
					e.pastor = null
					e.beber = agua
					e.beberBloq = 0
					e.esquivando = 0
					e.cimaIntentos = 0
					e.distIntento = Infinity
					e.estado = "walk"
					e.temporizador = 6000 + Math.random() * 6000
					e.encabObj = Math.atan2(-(agua.x - e.x), agua.z - e.z)
					e.anim = "walk"
					e.tAnim = 0
				} else if (puedeBuscar && f.pastoreo && f.anims.eat
						&& e.stats.saciedad < SACIEDAD_COMER) {
					// pastoreo: escanea la zona; si hay gramilla, va a por ella
					// (si no, a pasear, con el mismo rumbo aleatorio de siempre).
					// Solo con hambre: con la barriga llena espera a que baje.
					const g = buscarGrama(e)
					e.pastor = g || null
					e.pastorBloq = 0
					e.esquivando = 0
					e.cimaIntentos = 0
					e.distIntento = Infinity
					e.estado = "walk"
					e.temporizador = 6000 + Math.random() * 6000
					e.encabObj = Math.random() * Math.PI * 2
					e.anim = "walk"
					e.tAnim = 0
				} else if (!f.pastoreo && Math.random() < 0.3) {
					// comer sin gramilla: solo para especies SIN pastoreo;
					// la vaca no llega aqui (si tiene pastoreo, llena pasea)
					e.estado = "eat"
					e.temporizador = f.anims.eat ? 2200 + Math.random() * 1400 : 3000
					e.anim = f.anims.eat ? "eat" : "idle"
					e.tAnim = 0
					e.picado = 0
			} else {
				// paseo corto; con la barriga llena e hidratacion correcta,
				// ademas continuando el rumbo en vez de girar 180 grados:
				// menos divagacion
				const llena = e.stats.saciedad >= SACIEDAD_COMER
					&& e.stats.hidratacion >= HIDRATACION_UMBRAL
				e.estado = "walk"
				e.temporizador = llena
					? 2500 + Math.random() * 2000
					: 4000 + Math.random() * 5000
				e.encabObj = llena
					? e.encab + (Math.random() - 0.5) * 1.2
					: Math.random() * Math.PI * 2
				e.anim = "walk"
				e.tAnim = 0
			}
		} else if (e.estado === "drink") {
			// fin del trago: SOLO en la frontera del bucle del clip
			// (Cow_Ea2, 2,125 s a ritmo 0,7 -> 3,036 s por vuelta).  El
			// temporizador (4-6 s) expira dentro de la 2a vuelta y, sin
			// este corte, esa segunda animacion se cortaba a media; se
			// espera al segundo envuelto: salida ~6,07 s = dos ciclos
			// COMPLETOS de beber.  Si aun tiene sed (fue interrumpida),
			// el proximo ciclo la manda otra vez al agua.
			if (e.tAnim <= TRAGO_CORTE) {
				e.estado = "idle"
				e.temporizador = 2000 + Math.random() * 4000
				e.anim = "idle"
				e.tAnim = 0
				e.beber = null
				e.arrimo = null
			}
		} else {
				// fin del bocado: si queda otra mata en la suya o en la de
				// delante (p. ej. una junto a la recien comida), la
				// encadena; si no, a descansar y a escanear otra vez.
				// Con la barriga llena corta el encadenado: espera.
				const gc = f.pastoreo && e.stats.saciedad < SACIEDAD_COMER
					? hayGrama(e) : null
				if (gc) {
					e.estado = "eat"
					e.temporizador = 2200 + Math.random() * 1400
					e.anim = "eat"
					e.tAnim = 0
					e.picado = 0
					// como al arrancar el primer bocado: gira a apuntar la
					// mata y desliza hasta dejarla justo debajo de la boca
					if (Math.hypot(gc.x - e.x, gc.z - e.z) > 0.05)
						e.encab = e.encabObj = Math.atan2(-(gc.x - e.x), gc.z - e.z)
					e.arrimo = arrimar(e, gc, BOCA)
				} else {
					e.estado = "idle"
					e.temporizador = 2500 + Math.random() * 4000
					e.anim = "idle"
					e.tAnim = 0
					e.arrimo = null
				}
			}
		}

		const rumbo = a => delante(e, -Math.sin(a) * 0.8, Math.cos(a) * 0.8)
		if (puedeBuscar && e.estado === "walk" && f.pastoreo && !e.pastor
				&& !e.beber && e.stats.saciedad < SACIEDAD_COMER) {
			// sin mata elegida: cada 2 s mira si hay gramilla cerca y, si la
			// hay, se pone en camino (así una zona se va vaciando mata a mata).
			// Con sed va primero al agua; con la barriga llena, no escanea.
			e.proxBusq -= ds * 1000
			if (e.proxBusq <= 0) {
				e.proxBusq = 2000
				const g = buscarGrama(e)
				if (g) {
					e.pastor = g
					e.pastorBloq = 0
					e.esquivando = 0
					e.cimaIntentos = 0
					e.distIntento = Infinity
				}
			}
		}
		const aguada = e.estado === "walk" && e.stats.hidratacion < HIDRATACION_UMBRAL
			? aguaCerca(e) : null
		if (aguada) {
			// orilla alcanzada (o de paso junto a un charco con sed): se
			// planta y bebe con el segundo clip de eat mirando al agua.
			// La visita dura 4-6 s de reloj y el cierre se ancla a la
			// frontera del bucle: dos animaciones COMPLETAS (~6,07 s).
			e.estado = "drink"
			e.anim = "beber"
			e.temporizador = 4000 + Math.random() * 2000
			e.tAnim = 0
			e.pastor = null
			e.fallosBusq = 0      // llego a beber: se perdona el fracaso
			// el trago no gira encab (solo la rama walk lo gira): fija
			// aqui la mirada justo al bloque de agua detectado, o si no
			// la vaca bebe de espaldas (rumbo de paseo, o tras el volteo
			// de bloqueo encab + PI, o con el giro aun a medias)
			if (aguada.x !== Math.round(e.x) || aguada.z !== Math.round(e.z))
				e.encab = e.encabObj = Math.atan2(-(aguada.x - e.x), aguada.z - e.z)
			// y desliza hasta dejar esa columna justo debajo de la boca:
			// el agua se ve al volverse, no mas alla de la cabeza
			e.arrimo = arrimar(e, aguada, BOCA_AGUA)
		}
		if (e.estado === "walk" && e.beber) {
			// rumbo a la columna de agua; el reloj de bloqueo solo se
			// resetea con PROGRESO REAL (0,75 bloques mas cerca): el rodeo
			// y la vuelta al muro no lo cuentan.  A los 2,5 s sin avance
			// se olvida (como la mata inalcanzable)
			e.encabObj = Math.atan2(-(e.beber.x - e.x), e.beber.z - e.z)
			const dB = Math.hypot(e.beber.x - e.x, e.beber.z - e.z)
			if (dB < e.distIntento - 0.75) {
				e.distIntento = dB
				e.beberBloq = 0
			}
			if (!rumbo(e.encabObj)) {
				superarObstaculo(e, ds, e.encabObj)
				e.beberBloq += ds * 1000
				if (e.beberBloq > 2500) {
					falloBusqueda(e)
					e.beber = null
					e.beberBloq = 0
					e.esquivando = 0
					e.cimaIntentos = 0
					e.distIntento = Infinity
					e.encabObj = e.encab + Math.PI
				}
			} else {
				e.esquivando = 0
				e.cimaIntentos = 0
			}
		}
		if (e.estado === "walk" && e.pastor) {
			// perseguir la mata; primero: ¿ya tiene gramilla en su columna o
			// justo delante? Entonces se planta y da el bocado
			const propia = columnaPropia(e)
			const frente = columnaFrente(e)
			// ademas de la coincidencia de columna, la gramilla tiene que
			// estar ALCANZABLE (y-1..y+1 de los pies): una mata encima de
			// una meseta de 2 choca con la columna desde abajo pero no se
			// puede morder; sin este corte la vaca masticaba aire al pie
			// de la meseta y nunca saltaba a por ella
			// Tampoco se muerde EN EL AIRE: a media altura los y-1..y+1 de
			// los pies ya alcanzan la mata de la meseta, el bocado cortaba
			// el vx del vuelo, la vaca caia al pie y solo llegaba a morder
			// la base desde abajo (la copa quedaba sin comer).
			const g = e.saltarT <= 0
					&& ((propia.x === e.pastor.x && propia.z === e.pastor.z)
					|| (frente.x === e.pastor.x && frente.z === e.pastor.z))
					? hayGrama(e) : null
			if (g) {
				e.estado = "eat"
				e.anim = "eat"
				e.temporizador = 2200 + Math.random() * 1400
				e.tAnim = 0
				e.picado = 0
				e.pastor = null
				e.fallosBusq = 0    // llego a la mata: se perdona el fracaso
				// la hierba acaba JUSTO DELANTE de la cabeza (igual que el
				// agua): gira a apuntar la columna y desliza hasta dejarla
				// a la distancia de la boca (la cabeza baja a BOCA al morder)
				if (Math.hypot(g.x - e.x, g.z - e.z) > 0.05)
					e.encab = e.encabObj = Math.atan2(-(g.x - e.x), g.z - e.z)
				e.arrimo = arrimar(e, g, BOCA)
			} else {
				// rumbo directo (el motor avanza en la direccion (-sin, cos));
				// el reloj de bloqueo solo se resetea con PROGRESO REAL
				// (0,75 bloques mas cerca): rodear o dar vueltas al muro no
				// cuenta.  A los 2,5 s sin avance se olvida de esa mata y la
				// excluye 8 s
				e.encabObj = Math.atan2(-(e.pastor.x - e.x), e.pastor.z - e.z)
				const dP = Math.hypot(e.pastor.x - e.x, e.pastor.z - e.z)
				if (dP < e.distIntento - 0.75) {
					e.distIntento = dP
					e.pastorBloq = 0
				}
				if (!rumbo(e.encabObj)) {
					superarObstaculo(e, ds, e.encabObj)
					e.pastorBloq += ds * 1000
					if (e.pastorBloq > 2500) {
						falloBusqueda(e)
						e.proh = 8000
						e.prohCol = e.pastor
						e.pastor = null
						e.pastorBloq = 0
						e.esquivando = 0
						e.cimaIntentos = 0
						e.distIntento = Infinity
					}
				} else {
					e.esquivando = 0
					e.cimaIntentos = 0
				}
			}
		}
		if (e.estado === "walk") {
			// en pleno salto NO se redecide el rumbo: la sonda ve el
			// escalon a media altura, daria media vuelta en el aire y
			// el vuelo saldria hacia detras
			if (e.saltarT <= 0 && !e.pastor && !e.beber
					&& (!rumbo(e.encabObj) || e.bloqueado)) {
				// primero: si lo que tapa el paso es un escalon de 1 (el
				// motor real no lo sube andando), se SALTA en vez de media
				// vuelta; despues la vuelta (barranco u agua justo
				// delante) y hasta 5 intentos aleatorios hasta dar con
				// suelo transitable
				if (e.saltarT <= 0 && e.cimaIntentos < 5 && saltable(e, e.encabObj, true)) {
					e.saltarT = SALTO_MS
					e.saltos++
					e.vy = SALTO_VY1
					e.cimaY = Math.floor(e.y - e.bottomH - 0.5)
				} else {
					e.encabObj = e.encab + Math.PI
					for (let i = 0; i < 5 && !rumbo(e.encabObj); i++) {
						e.encabObj = Math.random() * Math.PI * 2
					}
					e.cimaIntentos = 0
				}
				e.bloqueado = false
			}
			const d = corto(e.encabObj - e.encab)
			const giro = 3 * ds
			e.encab += Math.max(-giro, Math.min(giro, d))
			const v = f.velocidad
			if (e.saltarT > 0) {
				// en pleno salto va RECTO hacia el objetivo: el cuerpo todava
				// apunta al obstaculo y el vuelo no da tiempo a girar
				e.vx = -Math.sin(e.encabObj) * v
				e.vz = Math.cos(e.encabObj) * v
			} else if (rumbo(e.encab)) {
				// solo avanza si la direccion ACTUAL es transitable: si no, la
				// vaca gira en el sitio en la orilla en vez de ir meterse en el
				// agua mientras calcula el nuevo rumbo
				e.vx = -Math.sin(e.encab) * v
				e.vz = Math.cos(e.encab) * v
			} else {
				e.vx = 0
				e.vz = 0
			}
		} else if (e.arrimo && (e.estado === "eat" || e.estado === "drink")) {
			// arrimo: desliza a velocidad de paseo hasta dejar el bloque
			// objetivo (acotado a la propia columna en arrimar) justo
			// debajo de la boca; el ultimo paso corto se fija a mano
			const ax = e.arrimo.x - e.x
			const az = e.arrimo.z - e.z
			const ad = Math.hypot(ax, az)
			if (ad <= f.velocidad) {
				e.x = e.arrimo.x
				e.z = e.arrimo.z
				e.arrimo = null
				e.vx = 0
				e.vz = 0
			} else {
				e.vx = ax / ad * f.velocidad
				e.vz = az / ad * f.velocidad
			}
		} else {
			e.vx = 0
			e.vz = 0
		}

		const clip = f.anims[e.anim] || f.anims.idle
		const c = modelo.clips[clip]
		const dur = c ? c.dur : 1
		const ritmo = e.estado === "walk"
			? Math.max(0.7, Math.min(2, f.velocidad * 30.3 / 1.4))
			: e.estado === "drink" ? 0.7 : 1   // trago lento: la cabeza pesa
		e.tAnim += ds * ritmo
		if (e.tAnim >= dur) {
			if (e.estado === "eat") {
				// una sola animacion por mata: al acabar el clip acaba el
				// bocado (el bloque de transiciones de arriba lo recoge al
				// frame siguiente con el timer a 0).  Beber NO se corta
				// aqui: su clip va en bucle y el temporizador de entrada
				// (4-6 s) solo arma la salida, que se ejecuta en la
				// frontera del bucle (TRAGO_CORTE) para no cortar la 2a
				// animacion a media.
				e.tAnim = dur
				e.temporizador = 0
			} else {
				e.tAnim %= dur
			}
		}

		// los dos mordiscos de la mata dentro de UNA animacion: primero la
		// copa (~0,65 s, la cabeza ya baja) y luego la base (~1,1 s)
		if (e.estado === "eat") {
			if (e.picado < 1 && e.tAnim >= 0.65) {
				e.picado = 1
				picarGrama(e)
			} else if (e.picado < 2 && e.tAnim >= 1.1) {
				e.picado = 2
				picarGrama(e)
			}
		}
		// bebiendo: el trago sube la hidratacion mientras siga el agua al lado
		if (e.estado === "drink" && aguaCerca(e)) {
			e.stats.hidratacion = Math.min(100, e.stats.hidratacion + HIDRATACION_RIEGO * ds)
		}
	}

	// ------------------------------------------------------------ fisica ----
	function fisica(e, dt) {
		const V = window.VXL
		const world = V.world
		const ds = dt * (TICKS / 1000)

		const bajo = (world.getBlock(Math.round(e.x), Math.round(e.y - e.bottomH + 0.2), Math.round(e.z)) & 0xff)
		const agua = bajo === V.blockIds.waterBlock || esLava(bajo)
		// Mismo orden que runGravity(): el suelo del fotograma anterior decide.
		// En pleno salto el impulso manda: no se pone a cero hasta aterrizar.
		if (e.onGround && e.saltarT <= 0) {
			e.vy = 0
		} else if (agua) {
			e.vy += GRAVEDAD * dt * 0.4
			if (e.vy < -0.15) e.vy = -0.15
		} else {
			e.vy += GRAVEDAD * dt
			if (e.vy < -e.maxVy) e.vy = -e.maxVy
		}

		// bloques que rozan el AABB (Y ampliado al destino del salto/caida)
		const contactos = []
		const yMov = e.vy * dt
		const x0 = Math.floor(e.x - e.w) - 1, x1 = Math.floor(e.x + e.w) + 1
		const y0 = Math.floor(Math.min(e.y, e.y + yMov) - e.bottomH) - 1
		const y1 = Math.floor(Math.max(e.y, e.y + yMov) + e.topH) + 1
		const z0 = Math.floor(e.z - e.w) - 1, z1 = Math.floor(e.z + e.w) + 1
		for (let x = x0; x <= x1; x++) {
			for (let y = y0; y <= y1; y++) {
				for (let z = z0; z <= z1; z++) {
					const b = world.getBlock(x, y, z)
					if (b) contactos.push([x, y, z, b])
				}
			}
		}

		e.previousX = e.x
		e.previousY = e.y
		e.previousZ = e.z
		e.onGround = false
		e.canStepX = false
		e.canStepZ = false
		e.bloqueado = false

		// eje Y
		e.y += e.vy * dt
		for (let i = 0; i < contactos.length; i++) {
			const c = contactos[i]
			if (window.VXL.collided(e, c[0], c[1], c[2], 0, e.vy, 0, c[3])) {
				e.y = e.previousY
				e.vy = 0
				break
			}
		}
		if (e.y === e.previousY) {
			e.canStepX = true
			e.canStepZ = true
		}

		// eje X (y Z): en pleno salto NO se choca de lado, el vuelo cruza el
		// obstaculo; sin eso la vaca se plantaria contra el muro hasta el
		// apogeo y caeria de vuelta al punto de partida
		e.x += e.vx * dt
		if (e.saltarT <= 0) {
			for (let i = 0; i < contactos.length; i++) {
				const c = contactos[i]
				if (window.VXL.collided(e, c[0], c[1], c[2], e.vx, 0, 0, c[3])) {
					// bloques centrados en enteros: si su borde superior esta
					// al nivel de los pies (o por debajo) es SUELO, no obstaculo
					if (e.y - e.bottomH >= c[1] + 0.5 - 0.001) continue
					if (e.canStepX && !solido(world.getBlock(c[0], c[1] + 1, c[2]))
							&& !solido(world.getBlock(c[0], c[1] + 2, c[2]))) {
						continue
					}
					e.x = e.previousX
					e.vx = 0
					e.bloqueado = true
					break
				}
			}
		}

		// eje Z
		e.z += e.vz * dt
		if (e.saltarT <= 0) {
			for (let i = 0; i < contactos.length; i++) {
				const c = contactos[i]
				if (window.VXL.collided(e, c[0], c[1], c[2], 0, 0, e.vz, c[3])) {
					if (e.y - e.bottomH >= c[1] + 0.5 - 0.001) continue
					if (e.canStepZ && !solido(world.getBlock(c[0], c[1] + 1, c[2]))
							&& !solido(world.getBlock(c[0], c[1] + 2, c[2]))) {
						continue
					}
					e.z = e.previousZ
					e.vz = 0
					e.bloqueado = true
					break
				}
			}
		}

		// no lanzarse al vacio: si no hay suelo delante, se da la vuelta
		// (si no, el guardia daria media vuelta en el filo de la cresta y
		// la vaca se quedaria paseando por ahi; en pleno salto no mira)
		if (e.onGround && e.saltarT <= 0 && e.estado === "walk" && (e.vx || e.vz)) {
			const dx = -Math.sin(e.encab) * 0.7
			const dz = Math.cos(e.encab) * 0.7
			if (!delante(e, dx, dz)) {
				e.encabObj = e.encab + Math.PI + (Math.random() - 0.5)
				e.vx = 0
				e.vz = 0
			}
		}
		// caida fuera del mundo
		if (e.y < -8) e.quitar = true
	}

	// -------------------------------------------------------------- update --
	function update() {
		if (!listo) return
		const V = window.VXL
		const p = V && V.p
		const world = V && V.world
		if (!p || !world) return

		const ahora = performance.now()
		let dt = (ahora - ultimaActualizacion) / TICKS
		ultimaActualizacion = ahora
		if (!(dt > 0)) return
		if (dt > 2) dt = 2

		if (ultimoMundo !== world) {
			ultimoMundo = world
			entidades.length = 0
			siguienteSpawn = 0
		}

		// mantenimiento de la poblacion
		const f = IDENTIDADES.vaca
		if (entidades.length < f.objetivo && ahora >= siguienteSpawn) {
			siguienteSpawn = ahora + 1500
			const s = buscarSuelo()
			if (s) spawn("vaca", s.x, s.y, s.z)
		}

		const ds = dt * (TICKS / 1000)
		for (let i = entidades.length - 1; i >= 0; i--) {
			const e = entidades[i]
			const d = Math.hypot(e.x - p.x, e.z - p.z)
			if (d > e.ficha.despawn || e.quitar) {
				entidades.splice(i, 1)
				continue
			}
			pensar(e, ds)
			fisica(e, dt)
		}
	}

	// -------------------------------------------------------------- render --
	function matrizEntidad(e) {
		const f = e.ficha
		rotY(tmpB, -(e.encab + f.yawOffset))
		mul4(tmpA, tmpB, baseModelo[e.nombre])
		traslacion(tmpB, e.x, e.y - e.bottomH, e.z)
		mul4(uModelo, tmpB, tmpA)
	}

	function pintarBuffer(nombre, buf, size, tipo, norm) {
		const l = loc.a[nombre]
		if (l === undefined || l < 0) return
		gl.bindBuffer(gl.ARRAY_BUFFER, buf)
		gl.vertexAttribPointer(l, size, tipo === undefined ? gl.FLOAT : tipo, !!norm, 0, 0)
		gl.enableVertexAttribArray(l)
	}

	function render() {
		if (!listo || !entidades.length) return
		const V = window.VXL
		const p = V.p
		if (!p) return

		// uView = proyeccion * vista (se calcula con el programa de bloques)
		vista.set(V.vista())

		gl.useProgram(prog)
		gl.uniform1i(loc.u.uTex, 2)
		if (loc.u.uBones) gl.uniform1i(loc.u.uBones, 3)
		if (loc.u.uHuesos) gl.uniform1f(loc.u.uHuesos, modelo.numHuesos)
		gl.uniformMatrix4fv(loc.u.uView, false, vista)
		gl.uniform3f(loc.u.uPos, p.x, p.y, p.z)
		gl.uniform1f(loc.u.uDist, V.fogDist)

		const gpu = modelo.gpu
		// textura por entidad (skin segun bioma de spawn): se reenlaza
		// dentro del bucle solo cuando cambia entre vacas consecutivas.
		let texActual = null
		// El motor deja POLYGON_OFFSET_FILL(1,1) activo para todo: con su
		// near=1/far=1000000 el desplazamiento de un triangulo inclinado es
		// mayor que toda la profundidad de la vaca, asi que los bordes se
		// empujan atras y la malla deja de auto-ocluirse.  Se apaga solo aqui.
		gl.disable(gl.POLYGON_OFFSET_FILL)
		// El material del GLB declara doubleSided y el motor deja CULL_FACE
		// BACK para los bloques: sin esto, si alguna vez se reexporta el
		// modelo con el winding cambiado, sus caras traseras desaparecen.
		// 700 triangulos: el coste de no cullear es nulo.
		gl.disable(gl.CULL_FACE)
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices)
		// aAO es estatica (se hornea al cargar la malla) y no depende de la
		// entidad: basta con fijarla una vez antes del bucle.
		pintarBuffer("aAO", gpu.ao, 1)
		for (let i = 0; i < entidades.length; i++) {
			const e = entidades[i]
			const alto = e.ficha.alto
			if (!p.canSee(e.x, e.y - e.bottomH, e.z, e.y - e.bottomH + alto)) continue

			const clip = modelo.clips[e.ficha.anims[e.anim]] || modelo.clips[e.ficha.anims.idle]
			VXLGLB.calcularHuesos(modelo, clip, e.tAnim, huesos)
			if (cpuSkin) {
				subirSkinCPU()
				pintarBuffer("aPos", posCPU, 3)
				pintarBuffer("aNor", norCPU, 3)
			} else {
				VXLGLB.subirHuesos(gl, gpu.huesos, huesos)
				pintarBuffer("aPos", gpu.pos, 3)
				pintarBuffer("aNor", gpu.nor, 3)
				pintarBuffer("aJoints", gpu.joints, 4, gl.UNSIGNED_BYTE, false)
				pintarBuffer("aWeights", gpu.weights, 4)
			}
			pintarBuffer("aUV", gpu.uv, 2)

			matrizEntidad(e)
			gl.uniformMatrix4fv(loc.u.uModel, false, uModelo)
			const tex = (e.skin && skins[e.skin]) || gpu.textura
			if (tex !== texActual) {
				gl.activeTexture(gl.TEXTURE2)
				gl.bindTexture(gl.TEXTURE_2D, tex)
				texActual = tex
			}
			gl.drawElements(gl.TRIANGLES, gpu.cantidad, gpu.tipoIndice, 0)
		}
		gl.activeTexture(gl.TEXTURE0)

		// ------------------------------------------------ sombra de contacto
		// Quad eliptico a ras de suelo, alpha-blended.  Va despues de las
		// vacas: esta por debajo del cuerpo, asi que la profundidad deja al
		// descubrir solo el anillo que rodea los cascos.
		if (progSombra && locSombra && locSombra.a.aPos >= 0) {
			gl.useProgram(progSombra)
			gl.bindBuffer(gl.ARRAY_BUFFER, bufSombra)
			gl.vertexAttribPointer(locSombra.a.aPos, 2, gl.FLOAT, false, 0, 0)
			gl.enableVertexAttribArray(locSombra.a.aPos)
			gl.uniformMatrix4fv(locSombra.u.uVista, false, vista)
			gl.uniform3f(locSombra.u.uPos, p.x, p.y, p.z)
			gl.uniform1f(locSombra.u.uDist, V.fogDist)
			gl.uniform1f(locSombra.u.uOpacidad, SOMBRA_OPACIDAD)
			gl.enable(gl.BLEND)
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
			for (let i = 0; i < entidades.length; i++) {
				const e = entidades[i]
				const alto = e.ficha.alto
				if (!p.canSee(e.x, e.y - e.bottomH, e.z, e.y - e.bottomH + alto)) continue
				gl.uniform4f(locSombra.u.uCuerpo,
					e.x, e.y - e.bottomH + SOMBRA_Y, e.z,
					-(e.encab + e.ficha.yawOffset))
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
			}
			gl.disable(gl.BLEND)
			gl.disableVertexAttribArray(locSombra.a.aPos)
			gl.useProgram(prog)
		}

		// ------------------------------------------- marco de la entidad apuntada
		// Caja de aristas amarillas alrededor del AABB de la vaca que el
		// jugador mira.  lookingAt() anulo hitBox.pos cuando la entidad gana,
		// asi que el marco de bloque no aparece a la vez.
		if (progCaja && locCaja && locCaja.a.aPos >= 0 && apuntada
			&& entidades.indexOf(apuntada) >= 0
			&& p.canSee(apuntada.x, apuntada.y - apuntada.bottomH, apuntada.z,
				apuntada.y - apuntada.bottomH + apuntada.ficha.alto)) {
			const e = apuntada
			const hw = e.w + CAJA_MARGEN
			const hh = (e.bottomH + e.topH) / 2 + CAJA_MARGEN
			uCaja[0] = hw * 2; uCaja[1] = 0; uCaja[2] = 0; uCaja[3] = 0
			uCaja[4] = 0; uCaja[5] = hh * 2; uCaja[6] = 0; uCaja[7] = 0
			uCaja[8] = 0; uCaja[9] = 0; uCaja[10] = hw * 2; uCaja[11] = 0
			uCaja[12] = e.x
			uCaja[13] = e.y - e.bottomH + (e.bottomH + e.topH) / 2
			uCaja[14] = e.z
			uCaja[15] = 1
			gl.useProgram(progCaja)
			gl.bindBuffer(gl.ARRAY_BUFFER, bufCaja)
			gl.vertexAttribPointer(locCaja.a.aPos, 3, gl.FLOAT, false, 0, 0)
			gl.enableVertexAttribArray(locCaja.a.aPos)
			gl.uniformMatrix4fv(locCaja.u.uVista, false, vista)
			gl.uniformMatrix4fv(locCaja.u.uModelo, false, uCaja)
			gl.uniform3f(locCaja.u.uColor, CAJA_COLOR[0], CAJA_COLOR[1], CAJA_COLOR[2])
			gl.drawArrays(gl.LINES, 0, 24)
			gl.disableVertexAttribArray(locCaja.a.aPos)
			gl.useProgram(prog)
		}

		// restaurar el estado del motor (bloques)
		for (const n of ["aPos", "aNor", "aAO", "aUV", "aJoints", "aWeights"]) {
			if (loc.a[n] >= 0) gl.disableVertexAttribArray(loc.a[n])
		}
		gl.enable(gl.POLYGON_OFFSET_FILL)
		gl.enable(gl.CULL_FACE)
		V.restaurar3D()
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, V.indexBuffer)
		gl.activeTexture(gl.TEXTURE0)
	}

	// Respaldo sin vertex texture fetch: se pinta el esqueleto en CPU.
	function subirSkinCPU() {
		const m = modelo.malla
		const n = m.pos.length / 3
		if (!skinPos) {
			skinPos = new Float32Array(m.pos.length)
			skinNor = new Float32Array(m.nor.length)
		}
		for (let v = 0; v < n; v++) {
			const px = m.pos[v * 3], py = m.pos[v * 3 + 1], pz = m.pos[v * 3 + 2]
			const nx = m.nor[v * 3], ny = m.nor[v * 3 + 1], nz = m.nor[v * 3 + 2]
			let x = 0, y = 0, z = 0, ax = 0, ay = 0, az = 0
			for (let k = 0; k < 4; k++) {
				const w = m.weights[v * 4 + k]
				if (!w) continue
				const b = m.joints[v * 4 + k] * 16
				x += w * (huesos[b] * px + huesos[b + 4] * py + huesos[b + 8] * pz + huesos[b + 12])
				y += w * (huesos[b + 1] * px + huesos[b + 5] * py + huesos[b + 9] * pz + huesos[b + 13])
				z += w * (huesos[b + 2] * px + huesos[b + 6] * py + huesos[b + 10] * pz + huesos[b + 14])
				ax += w * (huesos[b] * nx + huesos[b + 4] * ny + huesos[b + 8] * nz)
				ay += w * (huesos[b + 1] * nx + huesos[b + 5] * ny + huesos[b + 9] * nz)
				az += w * (huesos[b + 2] * nx + huesos[b + 6] * ny + huesos[b + 10] * nz)
			}
			skinPos[v * 3] = x
			skinPos[v * 3 + 1] = y
			skinPos[v * 3 + 2] = z
			skinNor[v * 3] = ax
			skinNor[v * 3 + 1] = ay
			skinNor[v * 3 + 2] = az
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, posCPU)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, skinPos)
		gl.bindBuffer(gl.ARRAY_BUFFER, norCPU)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, skinNor)
	}

	// -------------------------------------------------------------- export --
	window.IDENTIDADES = IDENTIDADES
	window.VXLIdentidades = {
		fichas: IDENTIDADES,
		lista: () => entidades,
		spawn: (nombre, x, y, z, skin) => {
			const p = window.VXL && window.VXL.p
			const world = window.VXL && window.VXL.world
			if (x === undefined) {
				if (!p || !world) return null
				const s = buscarSuelo()
				if (!s) return null
				return spawn(nombre || "vaca", s.x, s.y, s.z, skin)
			}
			return spawn(nombre || "vaca", x, y, z, skin)
		},
		spawnFrente: spawnFrente,
		skinsDisponibles: () => nombresSkin.slice(),
		limpiar: () => { entidades.length = 0 },
		estado: () => ({ listo, cpuSkin, n: entidades.length, luz: SHADING, skins }),
		exportar: exportar,
		restaurar: restaurar,
		apuntar: apuntar,
		setApuntada: e => { apuntada = e },
		entidadApuntada: () => apuntada,
	}

	window.initIdentidades = init
	window.updateIdentidades = update
	window.renderIdentidades = render
})()
