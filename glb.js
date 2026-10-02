// glb.js - parser glTF 2.0 binario + recursos de GPU.
// El .glb crudo viaja por red (o se lee con fs en los tests): fetch ->
// partirGLB -> decodificarPNG -> cargar.  Sin paso de empaquetado ni base64:
// el archivo models/LOW-POLY/*.glb ES la fuente.  Arranque local:
// node tools/servir.mjs  (Chrome bloquea fetch sobre file://).
//
//   VXLGLB.cargarUrl(gl, url) -> Promise<modeloGPU>
//   VXLGLB.preparar(bytes)    -> Promise<{json,bin,rgba,w,h}>  (ficha en crudo)
//   VXLGLB.cargar(gl, ficha)  -> modeloGPU (listo para dibujar)
//   VXLGLB.calcularHuesos(modelo, clip, t, out) -> matrices de piel
//
// Convencion de matrices: column-major (igual que glTF y que WebGL con
// transpose = false).
window.VXLGLB = (function () {

	// ------------------------------------------------------------ glb crudo
	function partirGLB(buffer) {
		const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
		if (b.length < 20) throw new Error("glb demasiado corto (" + b.length + " B)")
		const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
		if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("no es un .glb (magic)")
		const version = dv.getUint32(4, true)
		if (version !== 2) throw new Error("glTF version " + version + " (se espera 2)")
		const total = dv.getUint32(8, true)
		if (total !== b.length) throw new Error(
			"la longitud del header no cuadra (" + total + " vs " + b.length + ")")
		let off = 12
		let json = null
		let bin = null
		while (off + 8 <= b.length) {
			const len = dv.getUint32(off, true)
			const tipo = dv.getUint32(off + 4, true)
			const datos = b.subarray(off + 8, off + 8 + len)
			if (tipo === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(datos))
			else if (tipo === 0x004e4942) bin = datos
			off += 8 + len + ((4 - (len & 3)) & 3)
		}
		if (!json) throw new Error("chunk JSON no encontrado")
		if (!bin) throw new Error("chunk BIN no encontrado")
		return { json, bin }
	}

	// ------------------------------------------------------------------ PNG
	// El PNG embebido en el glb a RGBA crudo.  Mismo codigo en el navegador
	// y en los tests de node: la unica dependencia es DecompressionStream
	// (Chrome 80+, Firefox 113+, Safari 16.4+, node 18+).
	const be32 = (b, o) => (b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0

	async function inflateZlib(bytes) {
		const ds = new DecompressionStream("deflate")
		const stream = new Blob([bytes]).stream().pipeThrough(ds)
		return new Uint8Array(await new Response(stream).arrayBuffer())
	}

	async function decodificarPNG(bytes) {
		if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("no es un PNG")
		let off = 8
		let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0
		const idat = []
		let trns = null
		while (off + 8 <= bytes.length) {
			const len = be32(bytes, off)
			const tipo = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
			const datos = bytes.subarray(off + 8, off + 8 + len)
			if (tipo === "IHDR") {
				w = be32(datos, 0)
				h = be32(datos, 4)
				bitDepth = datos[8]
				colorType = datos[9]
				interlace = datos[12]
			} else if (tipo === "IDAT") {
				idat.push(datos)
			} else if (tipo === "tRNS") {
				trns = datos
			} else if (tipo === "IEND") {
				break
			}
			off += 12 + len
		}
		if (bitDepth !== 8) throw new Error("PNG bitDepth " + bitDepth + " no soportado")
		if (interlace !== 0) throw new Error("PNG con interlace no soportado")
		const canales = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
		if (!canales) throw new Error("PNG colorType " + colorType + " no soportado")
		if (!idat.length) throw new Error("PNG sin IDAT")
		let total = 0
		for (const p of idat) total += p.length
		const z = new Uint8Array(total)
		let zo = 0
		for (const p of idat) { z.set(p, zo); zo += p.length }
		const bruto = await inflateZlib(z)

		const bpp = canales
		const stride = w * bpp
		if (bruto.length < (stride + 1) * h) throw new Error(
			"PNG truncado (" + bruto.length + " B, esperado " + (stride + 1) * h + ")")
		const salida = new Uint8Array(w * h * 4)
		let prev = new Uint8Array(stride)
		let src = 0
		for (let y = 0; y < h; y++) {
			const filtro = bruto[src++]
			const fila = new Uint8Array(stride)
			for (let x = 0; x < stride; x++) {
				const raw = bruto[src++]
				const a = x >= bpp ? fila[x - bpp] : 0
				const b2 = prev[x]
				const c = x >= bpp ? prev[x - bpp] : 0
				let v
				switch (filtro) {
					case 0: v = raw; break
					case 1: v = raw + a; break
					case 2: v = raw + b2; break
					case 3: v = raw + ((a + b2) >> 1); break
					case 4: {
						const p = a + b2 - c
						const pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c)
						v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c)
						break
					}
					default: throw new Error("filtro PNG " + filtro)
				}
				fila[x] = v & 255
			}
			for (let x = 0; x < w; x++) {
				const o = (y * w + x) * 4
				if (canales === 4) {
					salida[o] = fila[x * 4]
					salida[o + 1] = fila[x * 4 + 1]
					salida[o + 2] = fila[x * 4 + 2]
					salida[o + 3] = fila[x * 4 + 3]
				} else if (canales === 3) {
					salida[o] = fila[x * 3]
					salida[o + 1] = fila[x * 3 + 1]
					salida[o + 2] = fila[x * 3 + 2]
					salida[o + 3] = 255
				} else if (canales === 2) {
					salida[o] = salida[o + 1] = salida[o + 2] = fila[x * 2]
					salida[o + 3] = fila[x * 2 + 1]
				} else {
					salida[o] = salida[o + 1] = salida[o + 2] = fila[x]
					salida[o + 3] = trns && x < trns.length ? trns[x] : 255
				}
			}
			prev = fila
		}
		return { w, h, rgba: salida }
	}

	// --------------------------------------------------------------- ficha
	// Contrato {json, bin, rgba, w, h} EN CRUDO para parsear()/cargar().
	// Preflight: el parser lee 1 malla x 1 primitiva y exactamente 1 textura
	// embebida; cualquier otro glb falla aqui con un mensaje claro.
	async function preparar(bytes) {
		const { json, bin } = partirGLB(bytes)
		const nMallas = (json.meshes || []).length
		const nPrims = (json.meshes || []).reduce((a, m) => a + m.primitives.length, 0)
		if (nMallas !== 1 || nPrims !== 1) throw new Error(
			"el parser soporta 1 malla x 1 primitiva; este glb trae " +
			nMallas + " mallas / " + nPrims + " primitivas")
		if (!json.images || json.images.length !== 1) throw new Error(
			"se espera 1 textura embebida; este glb trae " +
			(json.images ? json.images.length : 0))
		const img = json.images[0]
		if (img.uri) throw new Error("la textura no esta embebida (uri=" + img.uri + ")")
		const bv = json.bufferViews[img.bufferView]
		const inicio = bv.byteOffset || 0
		const png = bin.subarray(inicio, inicio + bv.byteLength)
		const t = await decodificarPNG(png)
		return { json, bin, rgba: t.rgba, w: t.w, h: t.h }
	}

	async function cargarUrl(gl, url) {
		let res
		try {
			res = await fetch(url)
		} catch (e) {
			throw new Error("sin red contra " + url + " (" + e.message + ")")
		}
		if (!res.ok) throw new Error(url + " -> HTTP " + res.status)
		const ficha = await preparar(new Uint8Array(await res.arrayBuffer()))
		return cargar(gl, ficha)
	}

	// ------------------------------------------------------------- utilidades
	const TIPOS = {
		SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4,
		MAT2: 4, MAT3: 9, MAT4: 16,
	}
	const CTOR = {
		5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
		5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
	}

	function leerAcceso(json, bin, accessor) {
		const bv = json.bufferViews[accessor.bufferView]
		const n = TIPOS[accessor.type]
		const Ctor = CTOR[accessor.componentType]
		if (!n || !Ctor) throw new Error("accessor no soportado: " + accessor.type + "/" + accessor.componentType)
		const bytes = Ctor.BYTES_PER_ELEMENT
		const total = accessor.count * n
		const inicio = (bv.byteOffset || 0) + (accessor.byteOffset || 0)
		const stride = bv.byteStride || n * bytes
		const out = new Ctor(total)
		if (stride === n * bytes) {
			// copia por bytes: no depende de la alineacion del buffer origen
			new Uint8Array(out.buffer, out.byteOffset, total * bytes)
				.set(bin.subarray(inicio, inicio + total * bytes))
		} else {
			for (let i = 0; i < accessor.count; i++) {
				const src = inicio + i * stride
				new Uint8Array(out.buffer, out.byteOffset + i * n * bytes, n * bytes)
					.set(bin.subarray(src, src + n * bytes))
			}
		}
		if (accessor.normalized) {
			const escala = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[accessor.componentType]
			if (escala) for (let i = 0; i < out.length; i++) out[i] /= escala
		}
		return out
	}

	function mul(out, a, b) {
		// out = a * b (column-major). out puede solapar con a/b: se usa scratch.
		const t = MUL_SCRATCH
		for (let c = 0; c < 4; c++) {
			const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3]
			for (let r = 0; r < 4; r++) {
				t[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3
			}
		}
		out.set(t)
	}
	const MUL_SCRATCH = new Float32Array(16)

	function trs(out, t, r, s) {
		const x = r[0], y = r[1], z = r[2], w = r[3]
		const x2 = x + x, y2 = y + y, z2 = z + z
		const xx = x * x2, xy = x * y2, xz = x * z2
		const yy = y * y2, yz = y * z2, zz = z * z2
		const wx = w * x2, wy = w * y2, wz = w * z2
		const sx = s[0], sy = s[1], sz = s[2]
		out[0] = (1 - (yy + zz)) * sx
		out[1] = (xy + wz) * sx
		out[2] = (xz - wy) * sx
		out[3] = 0
		out[4] = (xy - wz) * sy
		out[5] = (1 - (xx + zz)) * sy
		out[6] = (yz + wx) * sy
		out[7] = 0
		out[8] = (xz + wy) * sz
		out[9] = (yz - wx) * sz
		out[10] = (1 - (xx + yy)) * sz
		out[11] = 0
		out[12] = t[0]
		out[13] = t[1]
		out[14] = t[2]
		out[15] = 1
	}

	// ---------------------------------------------------------- parseo CPU ----
	function parsear(ficha) {
		const json = ficha.json
		const bin = ficha.bin

		const prim = json.meshes[0].primitives[0]
		const attrs = prim.attributes
		const malla = {
			pos: leerAcceso(json, bin, json.accessors[attrs.POSITION]),
			nor: attrs.NORMAL !== undefined ? leerAcceso(json, bin, json.accessors[attrs.NORMAL]) : null,
			uv: attrs.TEXCOORD_0 !== undefined ? leerAcceso(json, bin, json.accessors[attrs.TEXCOORD_0]) : null,
			joints: leerAcceso(json, bin, json.accessors[attrs.JOINTS_0]),
			weights: leerAcceso(json, bin, json.accessors[attrs.WEIGHTS_0]),
			indices: leerAcceso(json, bin, json.accessors[prim.indices]),
		}
		if (prim.indices === undefined) throw new Error("la primitiva no tiene indices")
		if (!malla.nor) malla.nor = normalesPlanas(malla)
		if (!malla.uv) {
			malla.uv = new Float32Array(malla.pos.length / 3 * 2)
		}
		malla.ao = oclusion(malla)

		// limites del modelo (para escala, hitbox y apoyar los pies en el suelo)
		const pa = json.accessors[attrs.POSITION]
		const bounds = { min: pa.min || [0, 0, 0], max: pa.max || [0, 0, 0] }

		// jerarquia
		const nodos = json.nodes.map((n, i) => ({
			i,
			nombre: n.name || ("nodo" + i),
			hijos: n.children || [],
			t: n.translation || [0, 0, 0],
			r: n.rotation || [0, 0, 0, 1],
			s: n.scale || [1, 1, 1],
		}))
		const escena = json.scenes[json.scene || 0]
		const raices = escena ? escena.nodes : [0]

		// skin
		let huesos = [], ibm = null, numHuesos = 0
		if (json.skins && json.skins.length) {
			const skin = json.skins[0]
			huesos = skin.joints
			numHuesos = huesos.length
			ibm = leerAcceso(json, bin, json.accessors[skin.inverseBindMatrices])
		}

		// clips: por nodo, T/R/S
		const clips = {}
		for (const anim of json.animations || []) {
			const dur = { v: 0 }
			const porNodo = {}
			for (const canal of anim.channels) {
				const s = anim.samplers[canal.sampler]
				const path = canal.target.path
				if (s.interpolation !== "LINEAR" && s.interpolation !== "STEP") {
					throw new Error("interpolacion no soportada: " + s.interpolation)
				}
				const tiempos = leerAcceso(json, bin, json.accessors[s.input])
				const valores = leerAcceso(json, bin, json.accessors[s.output])
				const comps = TIPOS[json.accessors[s.output].type]
				if (tiempos.length) dur.v = Math.max(dur.v, tiempos[tiempos.length - 1])
				const idx = canal.target.node
				if (!porNodo[idx]) porNodo[idx] = {}
				porNodo[idx][path === "translation" ? "T" : path === "rotation" ? "R" : "S"] = {
					tiempos,
					valores,
					comps,
					interp: s.interpolation,
				}
			}
			clips[anim.name] = { nombre: anim.name, dur: dur.v || 1, porNodo }
		}

		return {
			malla, bounds, nodos, raices, huesos, ibm, numHuesos, clips,
			local: new Float32Array(nodos.length * 16),
			global: new Float32Array(nodos.length * 16),
			identidad: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
		}
	}

	function normalesPlanas(m) {
		const pos = m.pos, idx = m.indices
		const nor = new Float32Array(pos.length)
		for (let i = 0; i < idx.length; i += 3) {
			const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3
			const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
			const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
			const nx = uy * vz - uz * vy
			const ny = uz * vx - ux * vz
			const nz = ux * vy - uy * vx
			for (const o of [a, b, c]) {
				nor[o] += nx
				nor[o + 1] += ny
				nor[o + 2] += nz
			}
		}
		for (let i = 0; i < nor.length; i += 3) {
			const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1
			nor[i] /= l
			nor[i + 1] /= l
			nor[i + 2] /= l
		}
		return nor
	}

	// --------------------------------------------------------------- oclusion
	// AO horneado por vertice, calculado una vez al cargar la malla.
	//
	// Para cada vertice se integra la malla que tiene por delante de su plano
	// tangente: cuanto mas superficie propia cae en el hemisferio de su normal,
	// mas oscuro.  En una cara plana los triangulos vecinos son coplanarios
	// (cos ~ 0) y no se oscurece; en una hendidura (entrepiernas, cuello,
	// bajo la barriga) la geometria del otro lado si entra de frente.
	//
	// Es el equivalente del shade[] del motor (game.js:4622 getShadows, que
	// oscurece segun cuantos vecinos solidos rodean la esquina).  Sin esto la
	// vaca no se atenua donde el cuerpo se toca a si misma y se ve pegada y
	// plana al lado de los bloques.
	//
	//   occ = SUM_t area_t * max(0, n . dir_t) / (1 + (dist_t / AO_R)^2)
	//   ao  = clamp(1 - AO_K * occ, AO_MIN, 1)
	//
	// Coste: vertices x triangulos (~1M iteraciones de aritmetica plana), unos
	// pocos ms.  No cambia el formato glTF, asi que no hay que re-paquetear.
	const AO_R = 0.6     // radio de influencia, en unidades del modelo
	const AO_K = 0.28    // traduccion de oclusion en oscurecimiento
	const AO_MIN = 0.35  // suelo: nada queda completamente negro

	function oclusion(m) {
		const pos = m.pos, nor = m.nor, idx = m.indices
		const nV = pos.length / 3
		const nT = idx.length / 3

		// centroide, area y normal de cada triangulo (una vez)
		const cx = new Float32Array(nT), cy = new Float32Array(nT), cz = new Float32Array(nT)
		const ar = new Float32Array(nT)
		for (let t = 0; t < nT; t++) {
			const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3
			const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2]
			const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]
			const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
			ar[t] = Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5
			cx[t] = (pos[a] + pos[b] + pos[c]) / 3
			cy[t] = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3
			cz[t] = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3
		}

		const invR2 = 1 / (AO_R * AO_R)
		const ao = new Float32Array(nV)
		for (let i = 0; i < nV; i++) {
			const vx = pos[i * 3], vy = pos[i * 3 + 1], vz = pos[i * 3 + 2]
			const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2]
			let occ = 0
			for (let t = 0; t < nT; t++) {
				const dx = cx[t] - vx, dy = cy[t] - vy, dz = cz[t] - vz
				const d2 = dx * dx + dy * dy + dz * dz
				if (d2 < 1e-12) continue
				const cos = (nx * dx + ny * dy + nz * dz) / Math.sqrt(d2)
				if (cos <= 0) continue
				occ += ar[t] * cos / (1 + d2 * invR2)
			}
			ao[i] = Math.min(1, Math.max(AO_MIN, 1 - AO_K * occ))
		}
		return ao
	}

	// -------------------------------------------------------------- animacion
	// T y S necesitan arrays distintos: los nodos animados suelen tener canal
	// de traslacion Y de escala, y si comparten scratch la traslacion acaba
	// leyendo la escala (el esqueleto se dispara y la malla sale hecha un asco).
	const V3T = new Float32Array(3)
	const V3S = new Float32Array(3)
	const V4 = new Float32Array(4)

	function copiarValores(valores, base, comps, out) {
		for (let i = 0; i < comps; i++) out[i] = valores[base + i]
	}

	function leerClave(s, t, out) {
		const ti = s.tiempos
		const n = ti.length
		const comps = s.comps
		if (!n) return
		if (t <= ti[0]) return copiarValores(s.valores, 0, comps, out)
		if (t >= ti[n - 1]) return copiarValores(s.valores, (n - 1) * comps, comps, out)
		let lo = 0, hi = n - 1
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1
			if (ti[mid] <= t) lo = mid
			else hi = mid
		}
		if (s.interp === "STEP") return copiarValores(s.valores, lo * comps, comps, out)
		const a = ti[lo], b = ti[hi]
		const f = b === a ? 0 : (t - a) / (b - a)
		const va = lo * comps, vb = hi * comps
		for (let i = 0; i < comps; i++) out[i] = s.valores[va + i] + (s.valores[vb + i] - s.valores[va + i]) * f
		if (comps === 4) {
			// rotacion: nlerp + normalizacion (y signo coherente)
			const d = out[0] * s.valores[vb] + out[1] * s.valores[vb + 1] +
				out[2] * s.valores[vb + 2] + out[3] * s.valores[vb + 3]
			if (d < 0) {
				out[0] = -out[0]
				out[1] = -out[1]
				out[2] = -out[2]
				out[3] = -out[3]
			}
			const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1
			out[0] /= l
			out[1] /= l
			out[2] /= l
			out[3] /= l
		}
	}

	function calcularHuesos(modelo, clip, t, out) {
		const nodos = modelo.nodos
		const loc = modelo.local
		const glo = modelo.global
		for (let i = 0; i < nodos.length; i++) {
			const n = nodos[i]
			let T = n.t, R = n.r, S = n.s
			const ch = clip ? clip.porNodo[i] : null
			if (ch) {
			if (ch.T) { leerClave(ch.T, t, V3T); T = V3T }
			if (ch.R) { leerClave(ch.R, t, V4); R = V4 }
			if (ch.S) { leerClave(ch.S, t, V3S); S = V3S }
			}
			trs(loc.subarray(i * 16, i * 16 + 16), T, R, S)
		}
		for (const raiz of modelo.raices) propagar(modelo, raiz, modelo.identidad)
		for (let j = 0; j < modelo.huesos.length; j++) {
			const b = j * 16
			// glTF: jointMatrix = globalTransform * inverseBindMatrix (el
			// orden importa: con ibm * global en reposo salia identidad pero
			// al animar cada hueso giraba alrededor del origen del modelo y
			// la vaca se hundia/hecha un asco).
			mul(out.subarray(b, b + 16),
				glo.subarray(modelo.huesos[j] * 16, modelo.huesos[j] * 16 + 16),
				modelo.ibm.subarray(b, b + 16))
		}
	}

	function propagar(modelo, i, parent) {
		const b = i * 16
		const g = modelo.global.subarray(b, b + 16)
		mul(g, parent, modelo.local.subarray(b, b + 16))
		const hijos = modelo.nodos[i].hijos
		for (let k = 0; k < hijos.length; k++) propagar(modelo, hijos[k], g)
	}

	// ------------------------------------------------------------------ GPU ---
	function buffer(gl, datos, tipo) {
		const b = gl.createBuffer()
		gl.bindBuffer(tipo || gl.ARRAY_BUFFER, b)
		gl.bufferData(tipo || gl.ARRAY_BUFFER, datos, gl.STATIC_DRAW)
		return b
	}

	function texturaRGBA(gl, rgba, w, h) {
		const tex = gl.createTexture()
		gl.activeTexture(gl.TEXTURE2)
		gl.bindTexture(gl.TEXTURE_2D, tex)
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
		gl.generateMipmap(gl.TEXTURE_2D)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.activeTexture(gl.TEXTURE0)
		return tex
	}

	// Textura de matrices de huesos: 4 texels de ancho = 4 columnas de un mat4,
	// una fila por hueso. RGBA/FLOAT -> necesita OES_texture_float.
	function crearHuesos(gl, numHuesos) {
		const ext = gl.getExtension("OES_texture_float")
		if (!ext) return null
		const tex = gl.createTexture()
		const datos = new Float32Array(numHuesos * 16)
		gl.activeTexture(gl.TEXTURE3)
		gl.bindTexture(gl.TEXTURE_2D, tex)
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, numHuesos, 0, gl.RGBA, gl.FLOAT, datos)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.activeTexture(gl.TEXTURE0)
		return { tex, datos, numHuesos }
	}

	function subirHuesos(gl, huesos, matriz) {
		gl.activeTexture(gl.TEXTURE3)
		gl.bindTexture(gl.TEXTURE_2D, huesos.tex)
		huesos.datos.set(matriz)
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, huesos.numHuesos, gl.RGBA, gl.FLOAT, huesos.datos)
		gl.activeTexture(gl.TEXTURE0)
	}

	function cargar(gl, ficha) {
		const modelo = parsear(ficha)
		const m = modelo.malla
		// game.js ata su indexBuffer UNA sola vez al arrancar y no lo vuelve
		// a atar: si aqui se deja ELEMENT_ARRAY_BUFFER apuntando a los
		// indices de la vaca, el mundo pasa a dibujarse con la malla del
		// animal.  Ademas un buffer no puede cambiarse de target (WebGL:
		// INVALID_OPERATION "buffers can not be used with multiple targets")
		// por eso los indices se crean ya como ELEMENT_ARRAY_BUFFER.
		const idxPrevio = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)
		const gpu = {
			pos: buffer(gl, m.pos),
			nor: buffer(gl, m.nor),
			ao: buffer(gl, m.ao),
			uv: buffer(gl, m.uv),
			joints: buffer(gl, m.joints),
			weights: buffer(gl, m.weights),
			indices: buffer(gl, m.indices, gl.ELEMENT_ARRAY_BUFFER),
			tipoIndice: m.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
			cantidad: m.indices.length,
			textura: texturaRGBA(gl, ficha.rgba, ficha.w, ficha.h),
			huesos: modelo.numHuesos ? crearHuesos(gl, modelo.numHuesos) : null,
		}
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxPrevio)
		modelo.gpu = gpu
		return modelo
	}

	return {
		parsear, cargar, cargarUrl, preparar, partirGLB, decodificarPNG,
		calcularHuesos, subirHuesos, oclusion, texturaRGBA,
		AO: { R: AO_R, K: AO_K, MIN: AO_MIN },
	}
})()
