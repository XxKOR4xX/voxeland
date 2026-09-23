export const win = window.parent
export const doc = document

export const canvas = document.getElementById("overlay")
export const ctx = canvas.getContext("2d")
export const savebox = document.getElementById("savebox")
export const boxCenterTop = document.getElementById("boxcentertop")
export const saveDirections = document.getElementById("savedirections")
export const message = document.getElementById("message")
export const worldsEl = document.getElementById("worlds")
export const quota = document.getElementById("quota")
export const hoverbox = document.getElementById("onhover")

window.canvas = canvas
window.ctx = ctx
window.savebox = savebox
window.boxCenterTop = boxCenterTop
window.saveDirections = saveDirections
window.message = message
window.worlds = worldsEl
window.quota = quota

ctx.canvas.width = window.innerWidth
ctx.canvas.height = window.innerHeight

export const CUBE     = 0
export const SLAB     = 0x100 // 9th bit
export const STAIR    = 0x200 // 10th bit
export const FLIP     = 0x400 // 11th bit
export const NORTH    = 0 // 12th and 13th bits for the 4 directions
export const SOUTH    = 0x800
export const EAST     = 0x1000
export const WEST     = 0x1800
export const ROTATION = 0x1800 // Mask for the direction bits

export const state = {
	version: "Alpha",
	reach: 100, // Max distance player can place or break blocks
	sky: [0.33, 0.54, 0.72], // 0 to 1 RGB color scale
	superflat: false,
	trees: true,
	caves: true,

	// Configurable and savable settings
	settings: {
		renderDistance: 10,
		fov: 70, // Field of view in degrees
		mouseSense: 100 // Mouse sensitivity as a percentage of the default
	},
	locked: true,
	generatedChunks: 0,
	mouseX: 0,
	mouseY: 0,
	mouseDown: false,
	width: window.innerWidth,
	height: window.innerHeight,

	generator: {
		height: 80, // Height of the hills
		smooth: 0.01, // Smoothness of the terrain
		extra: 30, // Extra height added to the world.
		caveSize: 0.00 // Redefined right above where it's used
	},
	maxHeight: 255,
	blockOutlines: false,
	blockFill: true,
	updateHUD: true,
	blockMode: CUBE,

	tex: null,
	textureMap: null,
	dirtBuffer: null,
	dirtTexture: null,
	textureCoords: null,
	texCoordsBuffers: null,
	mainbg: null,
	dirtbg: null, // Background images

	bigArray: win.bigArray || new Float32Array(600000),
	drawScreens: {
		"main menu": () => {},
		"options": () => {},
		"play": () => {},
		"pause": () => {},
		"creation menu": () => {},
		"inventory": () => {},
		"multiplayer menu": () => {},
		"comingsoon menu": () => {},
		"loadsave menu": () => {},
	},
	hitBox: {},
	holding: 0,
	Key: {},
	modelView: win.modelView || new Float32Array(16),
	glCache: null,
	freezeFrame: 0,
	p: null,
	p2: {
		x: 0,
		y: 0,
		z: 0,
	},
	move: {
		x: 0,
		y: 0,
		z: 0,
		ang: Math.sqrt(0.5),
	},
	inventory: {
		hotbar: [ 1, 2, 3, 4, 5, 6, 7, 8, 9 ],
		main: [],
		hotbarSlot: 0,
		size: 40 * Math.min(window.innerWidth, window.innerHeight) / 600,
		holding: 0,
	},
	screen: "main menu",
	previousScreen: "main menu",
	gl: null,
	program3D: null,
	program2D: null,
	world: null,
	worldSeed: 0,
	caveNoise: null,
	analytics: {
		totalTickTime: 0,
		worstFrameTime: 0,
		totalRenderTime: 0,
		totalFrameTime: 0,
		lastUpdate: 0,
		frames: 1,
		displayedTickTime: "0",
		displayedRenderTime: "0",
		displayedFrameTime: "0",
		displayedwFrameTime: 0,
		fps: 0,
	},
}

win.bigArray = state.bigArray
win.modelView = state.modelView

if (state.height === 400) alert("Canvas is too small. Click the \"Settings\" button to the left of the \"Vote Up\" button under the editor and change the height to 600.")

export function getPointer() {
	if (canvas.requestPointerLock) {
		canvas.requestPointerLock()
	}
}
export function releasePointer() {
	if (doc.exitPointerLock) {
		doc.exitPointerLock()
	}
}

export let PVector = function(x, y, z) {
	this.x = x
	this.y = y
	this.z = z
	this.set = function(x, y, z) {
		if (y === undefined) {
			this.x = x.x
			this.y = x.y
			this.z = x.z
		} else {
			this.x = x
			this.y = y
			this.z = z
		}
	}
	this.normalize = function() {
		let mag = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
		this.x /= mag
		this.y /= mag
		this.z /= mag
	}
	this.add = function(v) {
		this.x += v.x
		this.y += v.y
		this.z += v.z
	}
	this.mult = function(m) {
		this.x *= m
		this.y *= m
		this.z *= m
	}
}

export let fill = function(r, g, b) {
	if (g === undefined) {
		g = r
		b = r
	}
	ctx.fillStyle = "rgb(" + r + ", " + g + ", " + b + ")"
}
export let stroke = function(r, g, b) {
	if (g === undefined) {
		g = r
		b = r
	}
	ctx.strokeStyle = "rgb(" + r + ", " + g + ", " + b + ")"
}
export let line = function(x1, y1, x2, y2) {
	ctx.moveTo(x1, y1)
	ctx.lineTo(x2, y2)
}
export function text(txt, x, y, h) {
	h = h || 0

	let lines = txt.split("\n")
	for (let i = 0; i < lines.length; i++) {
		ctx.fillText(lines[i], x, y + h * i)
	}
}
export function textSize(size) {
	ctx.font = size + 'px Poppins' // VT323
}
export let strokeWeight = function(num) {
	ctx.lineWidth = num
}
export const ARROW = "arrow"
export const HAND = "pointer"
export const CROSS = "crosshair"
export let cursor = function(type) {
	canvas.style.cursor = type
}

export let Block = {
	top: 0x4,
	bottom: 0x8,
	north: 0x20,
	south: 0x10,
	east: 0x2,
	west: 0x1,
}
export let Sides = {
	top: 0,
	bottom: 1,
	north: 2,
	south: 3,
	east: 4,
	west: 5,
}

// GLSL Shader code (written in script tags at the top of the file)
let vertexShaderSrc3D = document.getElementById("blockVertexShader").text
let fragmentShaderSrc3D = document.getElementById("blockFragmentShader").text
let vertexShaderSrc2D = document.getElementById("2dVertexShader").text
let fragmentShaderSrc2D = document.getElementById("2dFragmentShader").text

export function createProgramObject(curContext, vetexShaderSource, fragmentShaderSource) {
	let vertexShaderObject = curContext.createShader(curContext.VERTEX_SHADER)
	curContext.shaderSource(vertexShaderObject, vetexShaderSource)
	curContext.compileShader(vertexShaderObject)
	if (!curContext.getShaderParameter(vertexShaderObject, curContext.COMPILE_STATUS)) {
		throw curContext.getShaderInfoLog(vertexShaderObject)
	}

	let fragmentShaderObject = curContext.createShader(curContext.FRAGMENT_SHADER)
	curContext.shaderSource(fragmentShaderObject, fragmentShaderSource)
	curContext.compileShader(fragmentShaderObject)
	if (!curContext.getShaderParameter(fragmentShaderObject, curContext.COMPILE_STATUS)) {
		throw curContext.getShaderInfoLog(fragmentShaderObject)
	}

	let programObject = curContext.createProgram()
	curContext.attachShader(programObject, vertexShaderObject)
	curContext.attachShader(programObject, fragmentShaderObject)
	curContext.linkProgram(programObject)
	if (!curContext.getProgramParameter(programObject, curContext.LINK_STATUS)) {
		throw "Error linking shaders."
	}

	return programObject
}

export function objectify(x, y, z, width, height, textureX, textureY) {
	return {
		x: x,
		y: y,
		z: z,
		w: width,
		h: height,
		tx: textureX,
		ty: textureY
	}
}

export let shapes = {
	cube: {
		verts: [
			[objectify( 0,  0,  0, 16, 16, 0, 0)], //bottom
			[objectify( 0, 16, 16, 16, 16, 0, 0)], //top
			[objectify(16, 16, 16, 16, 16, 0, 0)], //north
			[objectify( 0, 16,  0, 16, 16, 0, 0)], //south
			[objectify(16, 16,  0, 16, 16, 0, 0)], //east
			[objectify( 0, 16, 16, 16, 16, 0, 0)]  //west
		],
		cull: {
			top: 3,
			bottom: 3,
			north: 3,
			south: 3,
			east: 3,
			west: 3
		},
		texVerts: [],
		varients: [],
		buffer: null,
		size: 6
	},
	slab: {
		verts: [
			[objectify( 0, 0,  0, 16, 16, 0, 0)], //bottom
			[objectify( 0, 8, 16, 16, 16, 0, 0)], //top
			[objectify(16, 8, 16, 16, 8, 0, 0)], //north
			[objectify( 0, 8,  0, 16, 8, 0, 0)], //south
			[objectify(16, 8,  0, 16, 8, 0, 0)], //east
			[objectify( 0, 8, 16, 16, 8, 0, 0)]  //west
		],
		cull: {
			top: 0,
			bottom: 3,
			north: 1,
			south: 1,
			east: 1,
			west: 1
		},
		texVerts: [],
		buffer: null,
		size: 6,
		varients: [],
		flip: true,
		rotate: false
	},
	stair: {
		verts: [
			[objectify( 0, 0,  0, 16, 16, 0, 0)], //bottom
			[objectify( 0, 8,  8, 16, 8, 0, 8), objectify( 0, 16,  16, 16, 8, 0, 0)], //top
			[objectify(16, 16, 16, 16, 16, 0, 0)], //north
			[objectify( 0, 8,  0, 16, 8, 0, 0), objectify( 0, 16,  8, 16, 8, 0, 0)], //south
			[objectify(16, 8, 0, 8, 8, 8, 0), objectify(16, 16, 8, 8, 16, 0, 0)], //east
			[objectify( 0, 8, 8, 8, 8, 0, 0), objectify( 0, 16, 16, 8, 16, 8, 0)]  //west
		],
		cull: {
			top: 0,
			bottom: 3,
			north: 3,
			south: 0,
			east: 0,
			west: 0
		},
		texVerts: [],
		buffer: null,
		size: 10,
		varients: [],
		flip: true,
		rotate: true
	},
}
win.shapes = shapes

export function compareArr(arr, out) {
	let minX = 1000
	let maxX = -1000
	let minY = 1000
	let maxY = -1000
	let minZ = 1000
	let maxZ = -1000
	let min = Math.min
	let max = Math.max
	let num = 0
	for (let i = 0; i < arr.length; i += 3) {
		num = arr[i]
		minX = minX > num ? num : minX
		maxX = maxX < num ? num : maxX
		num = arr[i + 1]
		minY = minY > num ? num : minY
		maxY = maxY < num ? num : maxY
		num = arr[i + 2]
		minZ = minZ > num ? num : minZ
		maxZ = maxZ < num ? num : maxZ
	}
	out[0] = minX
	out[1] = minY
	out[2] = minZ
	out[3] = maxX
	out[4] = maxY
	out[5] = maxZ
	return out
}

export let indexOrder;
(function() {
	let arr = []
	for (let i = 0; i < 100000; i++) {
		arr.push(0 + i * 4, 1 + i * 4, 2 + i * 4, 0 + i * 4, 2 + i * 4, 3 + i * 4)
	}
	indexOrder = new Uint32Array(arr)
})()

export function uniformMatrix(cacheId, programObj, vrName, transpose, matrix) {
	let vrLocation = state.glCache[cacheId]
	if(vrLocation === undefined) {
		vrLocation = state.gl.getUniformLocation(programObj, vrName)
		state.glCache[cacheId] = vrLocation
	}
	state.gl.uniformMatrix4fv(vrLocation, transpose, matrix)
}
export function vertexAttribPointer(cacheId, programObj, vrName, size, VBO) {
	let vrLocation = state.glCache[cacheId]
	if(vrLocation === undefined) {
		vrLocation = state.gl.getAttribLocation(programObj, vrName)
		state.glCache[cacheId] = vrLocation
	}
	if (vrLocation !== -1) {
		state.gl.enableVertexAttribArray(vrLocation)
		state.gl.bindBuffer(state.gl.ARRAY_BUFFER, VBO)
		state.gl.vertexAttribPointer(vrLocation, size, state.gl.FLOAT, false, 0, 0)

	}
}

export function cross(v1, v2, result) {
	let x = v1.x,
		y = v1.y,
		z = v1.z,
		x2 = v2.x,
		y2 = v2.y,
		z2 = v2.z
	result.x = y * z2 - y2 * z
	result.y = z * x2 - z2 * x
	result.z = x * y2 - x2 * y
}

export const matrix = new Float32Array(16); // A temperary matrix that may store random data.
export const projection = new Float32Array(16)
export const defaultModelView = new Float32Array([ -10,0,0,0,0,10,0,0,0,0,-10,0,0,0,0,1 ])

export class Matrix {
	constructor(arr) {
		this.elements = new Float32Array(arr || 16)
	}
	translate(x, y, z) {
		let a = this.elements
		a[3] += a[0] * x + a[1] * y + a[2] * z
		a[7] += a[4] * x + a[5] * y + a[6] * z
		a[11] += a[8] * x + a[9] * y + a[10] * z
		a[15] += a[12] * x + a[13] * y + a[14] * z
	}
	rotX(angle) {
		let elems = this.elements
		let c = Math.cos(angle)
		let s = Math.sin(angle)
		let t = elems[1]
		elems[1] = t * c + elems[2] * s
		elems[2] = t * -s + elems[2] * c
		t = elems[5]
		elems[5] = t * c + elems[6] * s
		elems[6] = t * -s + elems[6] * c
		t = elems[9]
		elems[9] = t * c + elems[10] * s
		elems[10] = t * -s + elems[10] * c
		t = elems[13]
		elems[13] = t * c + elems[14] * s
		elems[14] = t * -s + elems[14] * c
	}
	rotY(angle) {
		let c = Math.cos(angle)
		let s = Math.sin(angle)
		let elems = this.elements
		let t = elems[0]
		elems[0] = t * c + elems[2] * -s
		elems[2] = t * s + elems[2] * c
		t = elems[4]
		elems[4] = t * c + elems[6] * -s
		elems[6] = t * s + elems[6] * c
		t = elems[8]
		elems[8] = t * c + elems[10] * -s
		elems[10] = t * s + elems[10] * c
		t = elems[12]
		elems[12] = t * c + elems[14] * -s
		elems[14] = t * s + elems[14] * c
	}
	transpose() {
		let matrix = this.elements
		let temp = matrix[4]
		matrix[4] = matrix[1]
		matrix[1] = temp

		temp = matrix[8]
		matrix[8] = matrix[2]
		matrix[2] = temp

		temp = matrix[6]
		matrix[6] = matrix[9]
		matrix[9] = temp

		temp = matrix[3]
		matrix[3] = matrix[12]
		matrix[12] = temp

		temp = matrix[7]
		matrix[7] = matrix[13]
		matrix[13] = temp

		temp = matrix[11]
		matrix[11] = matrix[14]
		matrix[14] = temp
	}
	copyArray(from) {
		let to = this.elements
		for (let i = 0; i < from.length; i++) {
			to[i] = from[i]
		}
	}
	copyMatrix(from) {
		let to = this.elements
		from = from.elements
		for (let i = 0; i < from.length; i++) {
			to[i] = from[i]
		}
	}
}

export class Plane {
	constructor(nx, ny, nz) {
		this.set(nx, ny, nz)
	}
	set(nx, ny, nz) {
		// Pre-computed chunk offsets to reduce branching during culling
		this.dx = nx > 0 ? 16 : 0
		this.dy = ny > 0
		this.dz = nz > 0 ? 16 : 0

		// Normal vector for the plane
		this.nx = nx
		this.ny = ny
		this.nz = nz
	}
}

export const defaultTransformation = new Matrix([ -10,0,0,0,0,10,0,0,0,0,-10,0,0,0,0,1 ])

export class Camera {
	constructor() {
		this.x = 0
		this.y = 0
		this.z = 0
		this.rx = 0; // Pitch
		this.ry = 0; // Yaw
		this.currentFov = 0
		this.defaultFov = state.settings.fov
		this.targetFov = state.settings.fov
		this.step = 0
		this.lastStep = 0
		this.projection = new Float32Array(5)
		this.transformation = new Matrix()
		this.direction = { x: 1, y: 0, z: 0 }; // Normalized direction vector
		this.frustum = [] // The 5 planes of the viewing frustum (there's no far plane)
		for (let i = 0; i < 5; i++) {
			this.frustum.push(new Plane(1, 0, 0))
		}
	}
	FOV(fov, time) {
		if (fov === this.currentFov) return

		if (!fov) {
			let now = Date.now()
			fov = this.currentFov + this.step * (now - this.lastStep)
			this.lastStep = now
			if (Math.sign(this.targetFov - this.currentFov) !== Math.sign(this.targetFov - fov)) {
				fov = this.targetFov
			}
		}
		else if (time) {
			this.targetFov = fov
			this.step = (fov - this.currentFov) / time
			this.lastStep = Date.now()
			return
		} else {
			this.targetFov = fov
		}

		const tang = Math.tan(fov * Math.PI / 360)
		const scale = 1 / tang
		const near = 1
		const far = 1000000
		this.currentFov = fov; // Store the state of the projection matrix
		this.nearH = near * tang; // This is needed for frustum culling

		this.projection[0] = scale / state.width * state.height
		this.projection[1] = scale
		this.projection[2] = -far / (far - near)
		this.projection[3] = -1
		this.projection[4] = -far * near / (far - near)
	}
	transform() {
		this.transformation.copyMatrix(defaultTransformation)
		this.transformation.rotX(this.rx)
		this.transformation.rotY(this.ry)
		this.transformation.translate(-this.x, -this.y, -this.z)
	}
	getMatrix() {
		let proj = this.projection
		let view = this.transformation.elements
		matrix[0]  = proj[0] * view[0]
		matrix[1]  = proj[1] * view[4]
		matrix[2]  = proj[2] * view[8] + proj[3] * view[12]
		matrix[3]  = proj[4] * view[8]
		matrix[4]  = proj[0] * view[1]
		matrix[5]  = proj[1] * view[5]
		matrix[6]  = proj[2] * view[9] + proj[3] * view[13]
		matrix[7]  = proj[4] * view[9]
		matrix[8]  = proj[0] * view[2]
		matrix[9]  = proj[1] * view[6]
		matrix[10] = proj[2] * view[10] + proj[3] * view[14]
		matrix[11] = proj[4] * view[10]
		matrix[12] = proj[0] * view[3]
		matrix[13] = proj[1] * view[7]
		matrix[14] = proj[2] * view[11] + proj[3] * view[15]
		matrix[15] = proj[4] * view[11]
		return matrix
	}
	setDirection() {
		if (this.targetFov !== this.currentFov) {
			this.FOV()
		}
		this.direction.x = -Math.sin(this.ry) * Math.cos(this.rx)
		this.direction.y = Math.sin(this.rx)
		this.direction.z = Math.cos(this.ry) * Math.cos(this.rx)
		this.computeFrustum()
	}
	computeFrustum() {
		let X = vec1
		let dir = this.direction
		X.x = dir.z
		X.y = 0
		X.z = -dir.x
		X.normalize()

		let Y = vec2
		Y.set(dir)
		Y.mult(-1)
		cross(Y, X, Y)

		//Near plane
		this.frustum[0].set(dir.x, dir.y, dir.z)

		let aux = vec3
		aux.set(Y)
		aux.mult(this.nearH)
		aux.add(dir)
		aux.normalize()
		cross(aux, X, aux)
		this.frustum[1].set(aux.x, aux.y, aux.z)

		aux.set(Y)
		aux.mult(-this.nearH)
		aux.add(dir)
		aux.normalize()
		cross(X, aux, aux)
		this.frustum[2].set(aux.x, aux.y, aux.z)

		aux.set(X)
		aux.mult(-this.nearH * state.width / state.height)
		aux.add(dir)
		aux.normalize()
		cross(aux, Y, aux)
		this.frustum[3].set(aux.x, aux.y, aux.z)

		aux.set(X)
		aux.mult(this.nearH * state.width / state.height)
		aux.add(dir)
		aux.normalize()
		cross(Y, aux, aux)
		this.frustum[4].set(aux.x, aux.y, aux.z)
	}
	canSee(x, y, z, maxY) {
		x -= 0.5
		y -= 0.5
		z -= 0.5
		maxY += 0.5
		let px = 0, py = 0, pz = 0, plane = null
		let cx = state.p.x, cy = state.p.y, cz = state.p.z
		for (let i = 0; i < 5; i++) {
			plane = this.frustum[i]
			px = x + plane.dx
			py = plane.dy ? maxY : y
			pz = z + plane.dz
			if ((px - cx) * plane.nx + (py - cy) * plane.ny + (pz - cz) * plane.nz < 0) {
				return false
			}
		}
		return true
	}
}

export function trans(matrix, x, y, z) {
	let a = matrix
	a[3] += a[0] * x + a[1] * y + a[2] * z
	a[7] += a[4] * x + a[5] * y + a[6] * z
	a[11] += a[8] * x + a[9] * y + a[10] * z
	a[15] += a[12] * x + a[13] * y + a[14] * z
}
export function rotX(matrix, angle) {
	// This function is basically multiplying 2 4x4 matrices together,
	// but 1 of them has a bunch of 0's and 1's in it,
	// so I removed all terms that multiplied by 0, and just left off the 1's.
	// mat2 = [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
	let elems = matrix
	let c = Math.cos(angle)
	let s = Math.sin(angle)
	let t = elems[1]
	elems[1] = t * c + elems[2] * s
	elems[2] = t * -s + elems[2] * c
	t = elems[5]
	elems[5] = t * c + elems[6] * s
	elems[6] = t * -s + elems[6] * c
	t = elems[9]
	elems[9] = t * c + elems[10] * s
	elems[10] = t * -s + elems[10] * c
	t = elems[13]
	elems[13] = t * c + elems[14] * s
	elems[14] = t * -s + elems[14] * c
}
export function rotY(matrix, angle) {
//source = c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1
	let c = Math.cos(angle)
	let s = Math.sin(angle)
	let elems = matrix
	let t = elems[0]
	elems[0] = t * c + elems[2] * -s
	elems[2] = t * s + elems[2] * c
	t = elems[4]
	elems[4] = t * c + elems[6] * -s
	elems[6] = t * s + elems[6] * c
	t = elems[8]
	elems[8] = t * c + elems[10] * -s
	elems[10] = t * s + elems[10] * c
	t = elems[12]
	elems[12] = t * c + elems[14] * -s
	elems[14] = t * s + elems[14] * c
}
export function transpose(matrix) {
	let temp = matrix[4]
	matrix[4] = matrix[1]
	matrix[1] = temp

	temp = matrix[8]
	matrix[8] = matrix[2]
	matrix[2] = temp

	temp = matrix[6]
	matrix[6] = matrix[9]
	matrix[9] = temp

	temp = matrix[3]
	matrix[3] = matrix[12]
	matrix[12] = temp

	temp = matrix[7]
	matrix[7] = matrix[13]
	matrix[13] = temp

	temp = matrix[11]
	matrix[11] = matrix[14]
	matrix[14] = temp
}
export function matMult() {
//Multiply the projection matrix by the view matrix; this is optimized specifically for these matrices by removing terms that are always 0.
	let pre = projection
	let view = state.modelView
	matrix[0] = pre[0] * view[0]
	matrix[1] = pre[0] * view[1]
	matrix[2] = pre[0] * view[2]
	matrix[3] = pre[0] * view[3]
	matrix[4] = pre[5] * view[4]
	matrix[5] = pre[5] * view[5]
	matrix[6] = pre[5] * view[6]
	matrix[7] = pre[5] * view[7]
	matrix[8] = pre[10] * view[8] + pre[11] * view[12]
	matrix[9] = pre[10] * view[9] + pre[11] * view[13]
	matrix[10] = pre[10] * view[10] + pre[11] * view[14]
	matrix[11] = pre[10] * view[11] + pre[11] * view[15]
	matrix[12] = pre[14] * view[8]
	matrix[13] = pre[14] * view[9]
	matrix[14] = pre[14] * view[10]
	matrix[15] = pre[14] * view[11]
}
export function copyArr(a, b) {
	for (let i = 0; i < a.length; i++) {
		b[i] = a[i]
	}
}
export function FOV(fov) {
	let tang = Math.tan(fov * 0.5 * Math.PI / 180)
	let scale = 1 / tang
	let near = 1
	let far = 1000000
	state.currentFov = fov

	projection[0] = scale / state.width * state.height
	projection[5] = scale
	projection[10] = -far / (far - near)
	projection[11] = -1
	projection[14] = -far * near / (far - near)
}
export function initModelView(camera, x, y, z, rx, ry) {
	if (camera) {
		camera.transform()
		uniformMatrix("view3d", state.program3D, "uView", false, camera.getMatrix())
	} else {
		copyArr(defaultModelView, state.modelView)
		rotX(state.modelView, rx)
		rotY(state.modelView, ry)
		trans(state.modelView, -x, -y, -z)
		matMult()
		transpose(matrix)
		uniformMatrix("view3d", state.program3D, "uView", false, matrix)
	}
}

let vec1 = new PVector(), vec2 = new PVector(), vec3 = new PVector()

export function use2d() {
	state.gl.disableVertexAttribArray(state.glCache.aTexture)
	state.gl.disableVertexAttribArray(state.glCache.aShadow)
	state.gl.disableVertexAttribArray(state.glCache.aVertex)
	state.gl.useProgram(state.program2D)
	
	state.gl.enableVertexAttribArray(state.glCache.aVertex2)
	state.gl.enableVertexAttribArray(state.glCache.aTexture2)
	state.gl.enableVertexAttribArray(state.glCache.aShadow2)
}
export function use3d() {
	state.gl.disableVertexAttribArray(state.glCache.aTexture2)
	state.gl.disableVertexAttribArray(state.glCache.aShadow2)
	state.gl.disableVertexAttribArray(state.glCache.aVertex2)
	state.gl.useProgram(state.program3D)
	
	state.gl.enableVertexAttribArray(state.glCache.aVertex)
	state.gl.enableVertexAttribArray(state.glCache.aTexture)
	state.gl.enableVertexAttribArray(state.glCache.aShadow)
}

export function roundBits(number) {
	return Math.round(number * 1000000) / 1000000
}