// routes/gemini-persona.js
const express = require("express");
const router = express.Router();

router.post("/api/buscar-persona-ia", async (req, res) => {
  const { nombre } = req.body;

  if (!nombre) return res.status(400).json({ error: "Nombre requerido" });

  const prompt = `
Eres un asistente de inteligencia policial. Busca en fuentes públicas de internet 
información sobre la persona llamada "${nombre}" en Colombia.

Genera un informe estructurado con exactamente estas secciones:
1. **IDENTIDAD**: Datos públicos conocidos (edad aproximada, ciudad, documento de identidad, profesión si se conoce)
2. **PRESENCIA DIGITAL**: Redes sociales, páginas web, menciones públicas relevantes
3. **ACTIVIDAD PÚBLICA**: Noticias, artículos, registros públicos, empresas registradas
4. **VÍNCULOS**: Personas o entidades asociadas públicamente
5. **ALERTAS**: Si aparece en noticias de carácter judicial, policial o investigativo
6. **PERFIL DE RIESGO**: BAJO / MEDIO / ALTO con justificación breve

Si hay múltiples personas con ese nombre, lista las más relevantes por separado.
Si no encuentras información, indícalo claramente.
Usa lenguaje formal y objetivo. No inventes datos.
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // ← Esto activa la búsqueda real en Google
          tools: [{ google_search: {} }],
        }),
      },
    );

    const data = await response.json();
    const texto =
      data?.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        ?.map((p) => p.text)
        ?.join("") ?? "Sin respuesta";

    // Fuentes que usó Gemini para buscar
    const fuentes =
      data?.candidates?.[0]?.grounding_metadata?.search_entry_point
        ?.rendered_content ?? null;

    res.json({ analisis: texto, fuentes });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error al consultar Gemini", detalle: err.message });
  }
});

module.exports = router;
