// ================================================================
// BIOME-PARAMS.JS — Todos los parámetros de generación de terreno
// ----------------------------------------------------------------
// EDITA AQUÍ. Estos valores rigen los mundos NUEVOS que crees.
// Los mundos ya creados conservan su propia copia (anti-corrupción).
// Para experimentar en vivo sobre un mundo abierto usa la consola:
//   win.biomeSettings  |  win.riverSettings
// (afecta solo a los chunks que se generen después del cambio)
// ================================================================

window.WORLD_PARAMS = {

	// ---------------- CLIMA (dónde nace cada bioma) ----------------
	clima: {
		escala: 0.0007,          // Tamaño de zonas: menor = zonas más grandes (medido: 1000-2500 bloques)
		escalaHumedad: 0.6,      // El canal de humedad corre más ancho: bosques más extensos
		contraste: 0.3,          // Estira los valores del ruido al rango completo
		tempDesierto: 0.55,      // DESIERTO donde la temperatura ≥ esto (medido: ~35% del mundo)
		humBosque: 0.48,         // BOSQUE donde la humedad ≥ esto (medido: ~22%)
		humPantano: 0.53,        // PANTANO donde humedad ≥ esto Y el suelo es llano (ver pantano.planicieMin)
		sequedadDesierto: 0.35, // El calor reseca la humedad: desiertos coherentes, no cortan bosques
		doblezRelieve: 0.04,     // Cuánto doblan las fronteras con el relieve (bajo: líneas fluidas sin dientes)
		bandaRelieve: 0.16,      // Banda de valores donde el relieve puede doblar la frontera
	},

	// ---------------- TERRENO (compartido por todos) ----------------
	terreno: {
		datum: 71,               // Nivel general del terreno (medido: suelo p50=72, ~10 bloques sobre el agua)
		datumMontana: 71,        // Las montañas nacen del mismo nivel base
		ampLlanura: 10,          // Amplitud donde erosion es alta: llanuras claras
		ampMontana: 80,          // Amplitud donde erosion es baja (curva cúbica: montañas solo en erosion genuinamente baja)
		alturaPicos: 95,         // Picos de piedra por encima de esta altura
		rugosidad: 0.25,         // Octavas de detalle: 0 = ondas puras y suaves, 1 = terreno original
		frecuenciaOndulacion: 0.01, // Longitud de onda del terreno base (~100 bloques)
	},

	// ---------------- AGUA Y COSTAS ----------------
	agua: {
		nivelMar: 62,            // Altura de la superficie del agua (ríos, lagos y mares comparten este nivel)
		shelfCosta: 12,          // Banda de degradé sobre el agua: las orillas suben en terrazas de 1 bloque
		planicieCosta: 0.25,     // Menor = costas más planas y suaves
		estanteMarino: 3,        // Fondo uniforme de mares/lagos a esta profundidad
		wobbleCosta: 0.3,        // Irregularidad de la línea costera del mar (las costas de río no la usan)
		bandaWobble: 4,          // Alcance vertical del wobble
		escalaWobble: 0.12,      // Frecuencia del wobble
	},

	// ---------------- CONTINENTES (la forma grande del mundo) ----------------
	continentes: {
		escalaWarp: 1 / 220,   // Frecuencia del deformado de dominio: menor = giros más amplios y suaves
		fuerzaWarp: 35,        // Amplitud del deformado en bloques (lo que quita el aspecto de "mancha" y círculos)
		escala: 1 / 420,       // Frecuencia del continentalness: menor = continentes y océanos más grandes
		ganancia: 2.6,         // Contraste del canal de continents
		sesgo: 0.35,           // Balance tierra/agua: mayor = más tierra
		curva: [              // continentalness -> altura respecto al datum (datum 71, agua 62)
			[-1, -34],       // océano profundo
			[-0.5, -22],     // océano
			[-0.2, -9],      // justo bajo la línea de agua (costa)
			[-0.05, -1],     // orilla
			[0.05, -1],      // llanura: el datum
			[0.3, 2],        // interior
			[0.6, 6],        // meseta
			[1, 11],         // meseta alta
		],
	},

	// ---------------- MONTAÑAS (crestas redondeadas) ----------------
	montañas: {
		escalaRugosidad: 1 / 260,    // Frecuencia llanura/países escarpados
		rugosidadMin: -0.6,          // Ruido a partir del cual la montaña ASOMA (falda temprana y suave). Si subes esto, el macizo aparece de golpe: pared al pie
		rugosidadMax: 0.25,          // Ruido en el que ya es totalmente escarpado
		escalaCresta: 1 / 350,        // Tamaño de los picos: menor = cúpulas más anchas y laderas más suaves
		agudeza: 1.2,                 // Cuánta parte del ruido positivo se eleva. Los picos son CÚPULAS redondeadas sobre máximos aislados del ruido — jamás lomos lineales (sin crestas)
		baseCresta: 8,                // Altura del macizo antes de las crestas
		altura: 30,                   // Altura extra de las crestas sobre el macizo
		continenteMin: 0.25,          // Continentalsness donde empiezan las montañas tierra adentro
		continenteMax: 0.8,           // ... donde los cordales están a pleno
		rugosidadCrestaMin: 0.65,     // Rugosidad donde aparecen las crestas
		rugosidadCrestaMax: 1,     // ... a pleno
		erosionMin: 0.35,             // Erosión a la que el cordal está a pleno (solo país genuinamente poco erosionado)
		erosionMax: 0.6,             // Erosión a la que el cordal desaparece del todo (coherente con /locate mountains)
	},

	// ---------------- RÍOS FRONTERA (el río ES la frontera) ----------------
	rios: {
		ancho: 18,               // Ancho del canal en bloques (constante: el borde es la curva pura del meandro)
		valleMin: 20,            // Ancho medio mínimo del valle (orillas de pradera suaves)
		valleMax: 110,           // Tope del valle (cruces de montaña)
		pendiente: 0.38,         // Cap de pendiente de las laderas del valle (menor = más suave)
		profundidad: 5,          // Profundidad máxima del lecho (terraced)
		terrazas: 5,             // Plateaus del lecho con pasos de 1 bloque
		escalaRed: 1 / 450,      // Frecuencia de la red de ríos naturales: menor = ríos más largos y escasos
		nucleoRed: 0.005,        // Valor de ruido dentro del cauce (fuerza de corte total)
		anchoRed: 0.4,           // Banda de desvanecimiento del tallado. Ancha = valles fluviales suaves; 0.4 es la banda más estrecha que mantiene rm alto en el hilo y evita franjas secas en cruces de montaña (0 gaps)
		altaMin: 16,             // Altura sobre el agua donde los ríos empiezan a desvanecerse
		altaMax: 40,             // Altura sobre el agua donde ya no hay ríos (las tierras altas quedan secas)
		cauce: 3,                // Los ríos cortan hasta nivelMar - esto, así el agua los inunda
		corteMax: 52,           // Tope del corte: hasta qué altura un río aún corta hasta el agua. El lecho NUNCA baja de nivelMar-cauce (lo fija floorR); caps altos solo extienden la continuidad por cumbres
		floodBoost: 1.0,        // Multiplicador de garantía sobre shape.river: 1.0 = corte clásico. >1 inunda dips del ruido PERO duplica la pendiente de bancales (pasos de 3) - mantener en 1
	},

	// ---------------- LAGOS (hondonadas generadas, jamás cortes) ----------------
	lagos: {
		escala: 0.007,           // Frecuencia del ruido de lagos
		umbral: 0.3,            // Umbral base (mayor = menos lagos). Medido con boosts: ~130 lagos, máx 128
		borde: 0.2,             // Ancho del anillo de orilla en unidades de ruido
		banda: 5,                // Rampa LINEAL del fade: cero en datum+banda (línea de diseño: las colinas no se tocan), pleno en datum (donde viven las hondonadas). La rampa vieja comprimía la caída en 1.5 bloques y dibujaba muros de 14 bloques
		profundidad: 1,          // Profundidad del agua de las charcas (someras)
		fadeDesierto: 0.08,      // Los lagos mueren ANTES de entrar al desierto
	},

	// ---------------- BIOMAS ----------------
	llanuras: {
		arboles: 0.002,          // Densidad de árboles (muy ralos)
		// boostLagos: 1.0        // (implícito: 1.0)
	},

	bosque: {
		arboles: 0.02,           // Densidad de árboles (bosque propiamente)
		boostLagos: 1.5,         // Lagos más frecuentes que en llanuras (medido: ~2% del bosque es agua)
	},

	desierto: {
		arboles: 0,              // Sin árboles
		// boostLagos: 0         // (implícito: 0 — el fade térmico los elimina)
	},

	pantano: {
		planicieMin: 0.55,       // Erosión mínima (suelo llano) para que exista pantano
		aplanado: 0.10,          // El pantano comprime su terreno hacia el agua: suelo ~1-2 bloques sobre el nivel del mar (datum 71 -> ~63), relieve residual ~±1 bloque
		arboles: 0.01,           // Árboles dispersos (mitad del bosque)
		boostLagos: 3.6,         // El pantano ES la tierra de charcas (antes 1.9 = ~11% de agua; con 3.6 + el aplanado buscamos ~30%)
		rampa: 0.03,             // Anchura de la rampa de aplanado en humedad (antes 0.08 hard-coded): el pantano queda plano ya en el interior, no solo en su núcleo (banda de transición de 0.03 en humedad ~= 70 bloques)
	},

	playas: {
		activas: true,           // Arena automática en la línea de agua
		ancho: 4,                // Banda de arena sobre el agua
		planicie: 0.25,          // Compresión dentro de la banda de arena
	},

	// ---------------- VEGETACIÓN (hierba decorativa en cruz) ----------------
	vegetacion: {
		densidad: 0.3,           // Fracción de columnas con hierba sobre el suelo de hierba (valor global y respaldo)
		altas: 0.175,            // De esa hierba, fracción que son plantas altas de 2 bloques

		// Densidad por bioma (claves de biomeAt() en inglés). Lo que no
		// aparezca aquí cae en `densidad`. El pantano lleva POCO césped:
		// se ve ralo, en su verde claro, por la ciénaga.
		densidadPorBioma: {
			plains: 0.3,
			forest: 0.3,
			swamp: 0.075,
		},

		// Tinte de las plantas (textura gris x este color). REGLA: NINGÚN
		// bioma va oscuro — llanura, bosque y pantano van verdes claros
		// (el verde oscuro del pantano se eliminó; el más apagado es el
		// bosque, al nivel del terreno grassTop ~99/255).
		// (el botón de tintes sale de biomeAt(), así que las claves son
		// en inglés). Si borras este bloque manda el fallback de game.js
		// (mismos valores).
		// Luz de salida sobre grass.png: llanura 112 | bosque 97 | pantano 112
		tintes: {
			plains: [ 0x9b, 0xfa, 0x7d ],
			forest: [ 0x73, 0xe6, 0x61 ],
			swamp: [ 0x9b, 0xfa, 0x7d ],
		},
	},
}
