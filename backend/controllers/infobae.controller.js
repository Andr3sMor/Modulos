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
 */

const QUERYLY_KEY = "62d9c40063044c14";
const BATCH_SIZE = 20; // Infobae devuelve hasta 20 por página

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

function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mencionaNombre(titulo, resumen, nombre) {
  const textoNorm = normalizar(`${titulo} ${resumen}`);
  const partes = normalizar(nombre)
    .split(" ")
    .filter((p) => p.length > 2);

  if (partes.length === 0) return false;
  if (textoNorm.includes(normalizar(nombre))) return true;

  if (partes.length >= 2) {
    const encontradas = partes.filter((p) => textoNorm.includes(p));
    const umbral = Math.max(2, Math.ceil(partes.length / 2));
    return encontradas.length >= umbral;
  }

  return textoNorm.includes(partes[0]);
}

function esTemaRelevante(titulo, resumen) {
  const textoNorm = normalizar(`${titulo} ${resumen}`);
  return PALABRAS_CLAVE.some((kw) => textoNorm.includes(normalizar(kw)));
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
        todasLasNoticias.push({
          titulo: item.title || item.headline || "",
          resumen:
            item.description || item.summary || item.promo_description || "",
          fecha: item.pubdate || item.published_at || item.displaydate || "",
          enlace: item.link || item.url || "",
        });
      }

      // Si devolvió menos del batch, no hay más páginas
      if (items.length < BATCH_SIZE) break;
    }

    // Aplicar filtros en secuencia
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
