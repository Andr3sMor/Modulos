"use strict";
/**
 * infobae.controller.js
 *
 * Usa la API interna de Infobae (Queryly) para obtener resultados reales
 * de búsqueda, sin depender de renderizado JavaScript del lado del cliente.
 *
 * Solo devuelve noticias que cumplan LOS DOS filtros:
 *   1. La noticia menciona el nombre buscado (título o resumen)
 *   2. Tiene relación con corrupción, lavado de activos o terrorismo
 *
 * FIXES aplicados:
 *   - mencionaNombre: ahora exige que TODAS las partes del nombre aparezcan
 *   - enlace: se construye URL completa prefijando https://www.infobae.com
 *             cuando el link devuelto por Queryly es relativo
 */

const QUERYLY_KEY = "62d9c40063044c14";
const BATCH_SIZE = 20; // Infobae devuelve hasta 20 por página
const INFOBAE_BASE_URL = "https://www.infobae.com";

// Palabras clave de temas sensibles (filtro 2)
const PALABRAS_CLAVE = [
  "lavado de activos",
  "lavado de dinero",
  "lavado",
  "activos ilicitos",
  "testaferro",
  "enriquecimiento ilicito",
  "corrupcion",
  "corrupto",
  "corruptos",
  "soborno",
  "coima",
  "cohecho",
  "peculado",
  "malversacion",
  "desfalco",
  "defraudacion",
  "fraude",
  "estafa",
  "anticorrupcion",
  "parapolitica",
  "inhabilidad",
  "sancionado",
  "contraloria",
  "procuraduria",
  "terrorismo",
  "terrorista",
  "financiacion del terrorismo",
  "narcotrafico",
  "narcotraficante",
  "cartel",
  "clan del golfo",
  "bacrim",
  "guerrilla",
  "farc",
  "eln",
  "auc",
  "paramilitares",
  "extorsion",
  "contrabando",
  "trafico de armas",
  "trafico de drogas",
  "capturado por",
  "detenido por",
  "arrestado por",
  "imputado",
  "condenado",
  "judicializado",
  "proceso penal",
  "investigado por",
  "fiscalia investiga",
  "evasion fiscal",
  "evasion de impuestos",
];

/**
 * Normaliza un texto: minúsculas, sin tildes, sin caracteres especiales.
 */
function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * FIX 1: Validación estricta del nombre.
 *
 * - Coincidencia exacta del nombre completo (prioritaria).
 * - Ignora palabras cortas (≤3 chars) que son artículos/preposiciones.
 * - Para nombres de 1 parte significativa: debe aparecer exactamente.
 * - Para nombres de 2+ partes: exige que TODAS aparezcan (no solo la mitad).
 */
function mencionaNombre(titulo, resumen, nombre) {
  const textoNorm = normalizar(`${titulo} ${resumen}`);
  const nombreNorm = normalizar(nombre);

  // Coincidencia exacta del nombre completo (prioritaria)
  if (textoNorm.includes(nombreNorm)) return true;

  // Filtrar partes significativas (ignorar artículos, preposiciones cortas)
  const partes = nombreNorm.split(" ").filter((p) => p.length > 3);

  if (partes.length === 0) return false;

  // Para nombre de 1 sola parte significativa
  if (partes.length === 1) return textoNorm.includes(partes[0]);

  // Para nombres de 2+ partes: TODAS deben aparecer en el texto
  const encontradas = partes.filter((p) => textoNorm.includes(p));
  return encontradas.length === partes.length;
}

/**
 * Verifica si el texto contiene al menos una palabra clave de tema sensible.
 */
function esTemaRelevante(titulo, resumen) {
  const textoNorm = normalizar(`${titulo} ${resumen}`);
  return PALABRAS_CLAVE.some((kw) => textoNorm.includes(normalizar(kw)));
}

/**
 * FIX 2: Construye la URL completa de la noticia.
 *
 * Queryly a veces devuelve rutas relativas (ej. /colombia/2026/...)
 * en vez de URLs completas. En ese caso se prefija el dominio de Infobae.
 */
function construirEnlace(enlaceRaw) {
  if (!enlaceRaw) return "";
  if (enlaceRaw.startsWith("http://") || enlaceRaw.startsWith("https://")) {
    return enlaceRaw;
  }
  // Ruta relativa → agregar dominio base
  const ruta = enlaceRaw.startsWith("/") ? enlaceRaw : `/${enlaceRaw}`;
  return `${INFOBAE_BASE_URL}${ruta}`;
}

exports.consultarInfobae = async (req, res) => {
  const { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El campo 'nombre' es requerido." });
  }

  const nombreLimpio = nombre.trim();
  console.log(`[Infobae] 🔍 Buscando: "${nombreLimpio}"`);

  try {
    // Obtener hasta 2 páginas (40 resultados) para mayor cobertura
    const todasLasNoticias = [];

    for (let endindex = 0; endindex <= BATCH_SIZE; endindex += BATCH_SIZE) {
      const url =
        `https://api.queryly.com/json.aspx` +
        `?queryly_key=${QUERYLY_KEY}` +
        `&query=${encodeURIComponent(nombreLimpio)}` +
        `&endindex=${endindex}` +
        `&batchsize=${BATCH_SIZE}` +
        `&showfaceted=true` +
        `&extendeddatafields=creator,imageresizer,promo_image` +
        `&timezoneoffset=300`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
          Referer: "https://www.infobae.com/",
          Accept: "application/json, text/javascript, */*",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        console.warn(
          `[Infobae] ⚠️ Queryly respondió ${resp.status} en página ${endindex}`,
        );
        break;
      }

      const data = await resp.json();
      const items = data?.items || [];

      if (items.length === 0) break;

      for (const item of items) {
        // FIX 2: construir enlace completo
        const enlaceRaw = item.link || item.url || "";
        const enlace = construirEnlace(enlaceRaw);

        todasLasNoticias.push({
          titulo: item.title || item.headline || "",
          resumen:
            item.description || item.summary || item.promo_description || "",
          fecha: item.pubdate || item.published_at || item.displaydate || "",
          enlace,
        });
      }

      // Si devolvió menos del batch, no hay más páginas
      if (items.length < BATCH_SIZE) break;
    }

    // Aplicar filtros en secuencia
    // FIX 1: mencionaNombre ahora exige coincidencia estricta
    const conNombre = todasLasNoticias.filter((n) =>
      mencionaNombre(n.titulo, n.resumen, nombreLimpio),
    );
    const relevantes = conNombre.filter((n) =>
      esTemaRelevante(n.titulo, n.resumen),
    );

    console.log(
      `[Infobae] ✅ ${todasLasNoticias.length} totales → ` +
        `${conNombre.length} mencionan el nombre → ` +
        `${relevantes.length} relevantes por tema`,
    );

    return res.json({
      fuente: "Infobae",
      terminoBuscado: nombreLimpio,
      totalResultados: todasLasNoticias.length,
      totalConNombre: conNombre.length,
      totalRelevantes: relevantes.length,
      tieneRelevantes: relevantes.length > 0,
      noticias: relevantes,
    });
  } catch (error) {
    console.error("[Infobae] ❌ Error:", error.message);
    return res.status(502).json({
      error: "Error consultando Infobae",
      detalle: error.message,
    });
  }
};
