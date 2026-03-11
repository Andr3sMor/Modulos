const axios = require("axios");
const DDG = require("duck-duck-scrape");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function buscarPersonaConIA(req, res) {
  const { nombre } = req.body;

  if (!nombre?.trim()) {
    return res.status(400).json({ error: "El nombre es requerido" });
  }

  if (!GEMINI_API_KEY) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY no configurada en el servidor" });
  }

  try {
    // ── PASO 1: Buscar en DuckDuckGo (sin API key, completamente gratis) ──
    let resultadosWeb = "No se encontraron resultados públicos.";

    try {
      const searchResults = await DDG.search(`"${nombre.trim()}" Colombia`, {
        safeSearch: DDG.SafeSearchType.OFF,
        locale: "es-co",
      });

      if (searchResults?.results?.length > 0) {
        resultadosWeb = searchResults.results
          .slice(0, 8)
          .map((r) => `- ${r.title}: ${r.description} (${r.url})`)
          .join("\n");
      }
    } catch (ddgErr) {
      console.warn(
        "DuckDuckGo search falló, continuando sin resultados:",
        ddgErr.message,
      );
    }

    // ── PASO 2: Gemini analiza los resultados de la búsqueda ──────────────
    const prompt = `
Eres un asistente de inteligencia policial colombiano.
Basandote UNICAMENTE en los siguientes resultados de busqueda de internet sobre "${nombre.trim()}", genera un informe estructurado:

RESULTADOS DE BUSQUEDA EN INTERNET:
${resultadosWeb}

Genera el informe con estas secciones:

1. IDENTIDAD
Datos encontrados: ciudad, profesion, cargo o rol publico.

2. PRESENCIA PUBLICA
Redes sociales, paginas web, menciones en medios de comunicacion.

3. ACTIVIDAD DOCUMENTADA
Noticias, empresas constituidas, contratos con el estado, cargos publicos desempenados.

4. VINCULOS
Personas, empresas o entidades asociadas publicamente.

5. ALERTAS
Noticias de caracter judicial, policial o investigativo. Si no hay alertas, indicarlo claramente.

6. PERFIL DE RIESGO: BAJO / MEDIO / ALTO
Justificacion breve basada en los hallazgos.

---
Si hay multiples personas con ese nombre, separarlas (Persona 1, Persona 2...).
Si no hay informacion en alguna seccion, escribir "Sin informacion disponible".
No inventar datos. Solo usar lo que aparece en los resultados. Lenguaje formal y objetivo.
`;

    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 },
    );

    const parts = geminiRes.data?.candidates?.[0]?.content?.parts || [];
    const texto = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("");

    res.json({ analisis: texto });
  } catch (err) {
    console.error(
      "Error gemini.controller:",
      err?.response?.data || err.message,
    );
    res.status(500).json({
      error: "Error al consultar Gemini AI",
      detalle: err?.response?.data?.error?.message || err.message,
    });
  }
}

module.exports = { buscarPersonaConIA };
