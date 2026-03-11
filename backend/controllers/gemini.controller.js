const axios = require("axios");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function buscarPersonaConIA(req, res) {
  const { nombre } = req.body;

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "El nombre es requerido" });
  }

  if (!GEMINI_API_KEY) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY no configurada en el servidor" });
  }

  const prompt = `
Eres un asistente de inteligencia policial colombiano. Busca en fuentes públicas de internet 
información sobre la persona llamada "${nombre.trim()}" en Colombia.

Genera un informe estructurado con exactamente estas secciones:

1. IDENTIDAD
Datos públicos conocidos: edad aproximada, ciudad, profesión, cargo o rol público si se conoce.

2. PRESENCIA DIGITAL
Redes sociales activas, páginas web personales o empresariales, menciones públicas relevantes.

3. ACTIVIDAD PÚBLICA
Noticias, artículos de prensa, registros en cámara de comercio, empresas constituidas, contratos con el estado (SECOP), cargos públicos.

4. VÍNCULOS
Personas, empresas o entidades asociadas públicamente a este nombre.

5. ALERTAS
Si aparece en noticias de carácter judicial, policial, investigativo, listas de sanciones o bases de datos de riesgo. Si no hay alertas, indicarlo claramente.

6. PERFIL DE RIESGO: BAJO / MEDIO / ALTO
Justificación breve basada en los hallazgos anteriores.

---
INSTRUCCIONES IMPORTANTES:
- Si hay múltiples personas con ese nombre, analiza las más relevantes por separado numerándolas (Persona 1, Persona 2...).
- Si no encuentras información sobre alguna sección, escribe "Sin información disponible" en esa sección.
- No inventes datos. Si no hay información, dilo claramente.
- Usa lenguaje formal, objetivo y profesional.
- Basa tu respuesta ÚNICAMENTE en información pública verificable que encuentres en internet.
`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      },
    );

    const candidates = response.data?.candidates;
    if (!candidates || candidates.length === 0) {
      return res.status(500).json({ error: "Gemini no devolvió resultados" });
    }

    // Extraer texto (puede venir en múltiples partes cuando usa google_search)
    const parts = candidates[0]?.content?.parts || [];
    const texto = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("");

    res.json({ analisis: texto });
  } catch (err) {
    console.error("Error Gemini:", err?.response?.data || err.message);
    res.status(500).json({
      error: "Error al consultar Gemini AI",
      detalle: err?.response?.data?.error?.message || err.message,
    });
  }
}

module.exports = { buscarPersonaConIA };
