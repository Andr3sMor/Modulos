"use strict";
/**
 * infobae.controller.js
 *
 * Busca noticias en Infobae por nombre usando su buscador público.
 * Solo devuelve noticias que cumplan LOS DOS filtros:
 *   1. La noticia menciona el nombre buscado (título o resumen)
 *   2. La noticia tiene relación con corrupción, lavado de activos o terrorismo
 *
 * Usa fetch nativo de Node 18+ (sin dependencias externas).
 */

// Palabras clave de temas sensibles (filtro 2)
const PALABRAS_CLAVE = [
  // Lavado de activos
  "lavado de activos",
  "lavado de dinero",
  "lavado",
  "activos ilicitos",
  "testaferro",
  "testaferros",
  "enriquecimiento ilicito",
  // Corrupción
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
  "sanciones disciplinarias",
  "contraloria",
  "procuraduria",
  // Terrorismo y crimen organizado
  "terrorismo",
  "terrorista",
  "terroristas",
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
  "paramilitarismo",
  "extorsion",
  "contrabando",
  "trafico de armas",
  "trafico de drogas",
  // Proceso judicial relacionado
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

// Normaliza texto: minúsculas, sin tildes, sin caracteres especiales
function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Filtro 1: la noticia menciona el nombre buscado
function mencionaNombre(titulo, resumen, nombre) {
  const textoNormalizado = normalizar(`${titulo} ${resumen}`);
  const partes = normalizar(nombre)
    .split(" ")
    .filter((p) => p.length > 2);

  if (partes.length === 0) return false;
  if (textoNormalizado.includes(normalizar(nombre))) return true;

  if (partes.length >= 2) {
    const partesEncontradas = partes.filter((p) =>
      textoNormalizado.includes(p),
    );
    const umbral = Math.max(2, Math.ceil(partes.length / 2));
    return partesEncontradas.length >= umbral;
  }

  return textoNormalizado.includes(partes[0]);
}

// Filtro 2: la noticia tiene relación con corrupción/lavado/terrorismo
function esTemaRelevante(titulo, resumen) {
  const textoNormalizado = normalizar(`${titulo} ${resumen}`);
  return PALABRAS_CLAVE.some((kw) => textoNormalizado.includes(normalizar(kw)));
}

exports.consultarInfobae = async (req, res) => {
  const { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El campo 'nombre' es requerido." });
  }

  const nombreLimpio = nombre.trim();
  const query = encodeURIComponent(nombreLimpio);
  const url = `https://www.infobae.com/buscador/?query=${query}`;

  console.log(`[Infobae] 🔍 Buscando: "${nombreLimpio}"`);

  try {
    const html = await fetchConReintentos(url);
    const noticias = parsearResultados(html);

    const conNombre = noticias.filter((n) =>
      mencionaNombre(n.titulo, n.resumen, nombreLimpio),
    );
    const relevantes = conNombre.filter((n) =>
      esTemaRelevante(n.titulo, n.resumen),
    );

    console.log(
      `[Infobae] ✅ ${noticias.length} totales → ` +
        `${conNombre.length} mencionan el nombre → ` +
        `${relevantes.length} relevantes por tema`,
    );

    return res.json({
      fuente: "Infobae",
      terminoBuscado: nombreLimpio,
      totalResultados: noticias.length,
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

// ─── Fetch nativo (Node 18+) con reintentos ───────────────────────────────────
async function fetchConReintentos(url, intentos = 3) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://www.infobae.com/",
  };

  for (let i = 1; i <= intentos; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const resp = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);

      return await resp.text();
    } catch (err) {
      console.warn(`[Infobae] ⚠️ Intento ${i}/${intentos}: ${err.message}`);
      if (i === intentos) throw err;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

// ─── Parsear resultados del HTML ──────────────────────────────────────────────
function parsearResultados(html) {
  // Estrategia 1: __PRELOADED_STATE__
  try {
    const match = html.match(
      /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/,
    );
    if (match) {
      const estado = JSON.parse(match[1]);
      const items =
        estado?.searchResults?.items ||
        estado?.search?.results ||
        estado?.results ||
        [];
      if (items.length > 0) {
        return items
          .map((item) => ({
            titulo: item.title || item.headline || "",
            resumen: item.description || item.summary || item.excerpt || "",
            fecha: item.publishedAt || item.date || item.published_at || "",
            enlace: item.url || item.link || item.href || "",
          }))
          .filter((n) => n.titulo);
      }
    }
  } catch (_) {}

  // Estrategia 2: __NEXT_DATA__
  try {
    const match = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (match) {
      const data = JSON.parse(match[1]);
      const items =
        data?.props?.pageProps?.initialState?.searchResults?.items ||
        data?.props?.pageProps?.results ||
        data?.props?.pageProps?.searchResults ||
        [];
      if (items.length > 0) {
        return items
          .map((item) => ({
            titulo: item.title || item.headline || "",
            resumen: item.description || item.summary || item.excerpt || "",
            fecha: item.publishedAt || item.date || item.published_at || "",
            enlace: item.url || item.link || item.href || "",
          }))
          .filter((n) => n.titulo);
      }
    }
  } catch (_) {}

  // Estrategia 3: parseo directo de HTML
  return parsearHtmlDirecto(html);
}

function parsearHtmlDirecto(html) {
  const noticias = [];

  // Intentar con <article>
  const bloqueRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let bloqueMatch;

  while ((bloqueMatch = bloqueRegex.exec(html)) !== null) {
    const bloque = bloqueMatch[1];

    const tituloMatch =
      bloque.match(/<h[23][^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*<\/h[23]>/) ||
      bloque.match(/<h[23][^>]*>([^<]+)<\/h[23]>/) ||
      bloque.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</) ||
      bloque.match(/class="[^"]*headline[^"]*"[^>]*>([^<]+)</);

    const enlaceMatch = bloque.match(
      /href="(https?:\/\/(?:www\.)?infobae\.com[^"]+)"/,
    );
    const resumenMatch =
      bloque.match(/class="[^"]*description[^"]*"[^>]*>([^<]{20,})</) ||
      bloque.match(/class="[^"]*summary[^"]*"[^>]*>([^<]{20,})</) ||
      bloque.match(/<p[^>]*>([^<]{20,})<\/p>/);
    const fechaMatch =
      bloque.match(/<time[^>]*datetime="([^"]+)"/) ||
      bloque.match(/class="[^"]*date[^"]*"[^>]*>([^<]+)</);

    if (tituloMatch && enlaceMatch) {
      noticias.push({
        titulo: limpiarTexto(tituloMatch[1]),
        resumen: resumenMatch ? limpiarTexto(resumenMatch[1]) : "",
        fecha: fechaMatch ? limpiarTexto(fechaMatch[1]) : "",
        enlace: enlaceMatch[1],
      });
    }
  }

  // Fallback con divs
  if (noticias.length === 0) {
    const divRegex =
      /class="[^"]*search-result[^"]*"[^>]*>([\s\S]*?)(?=class="[^"]*search-result|<\/section|<\/main)/gi;
    let divMatch;

    while ((divMatch = divRegex.exec(html)) !== null) {
      const bloque = divMatch[1];

      const tituloMatch =
        bloque.match(
          /class="[^"]*title[^"]*"[^>]*>\s*(?:<[^>]+>)*([^<]{5,})/,
        ) || bloque.match(/<h[234][^>]*>([^<]{5,})<\/h[234]>/);
      const enlaceMatch = bloque.match(
        /href="(https?:\/\/(?:www\.)?infobae\.com[^"]+)"/,
      );
      const resumenMatch =
        bloque.match(/class="[^"]*desc[^"]*"[^>]*>([^<]{10,})</) ||
        bloque.match(/<p[^>]*>([^<]{10,})<\/p>/);
      const fechaMatch = bloque.match(/<time[^>]*>([^<]+)<\/time>/);

      if (tituloMatch && enlaceMatch) {
        noticias.push({
          titulo: limpiarTexto(tituloMatch[1]),
          resumen: resumenMatch ? limpiarTexto(resumenMatch[1]) : "",
          fecha: fechaMatch ? limpiarTexto(fechaMatch[1]) : "",
          enlace: enlaceMatch[1],
        });
      }
    }
  }

  return noticias;
}

function limpiarTexto(texto) {
  return texto
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
