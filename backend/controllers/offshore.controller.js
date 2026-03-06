const axios = require("axios");

exports.consultarOffshore = async (req, res) => {
  const { nombre } = req.body;
  if (!nombre)
    return res.status(400).json({ error: "El campo 'nombre' es requerido." });

  console.log(`--- Consultando Offshore Leaks para: ${nombre} ---`);

  try {
    // Búsqueda por nombre usando la API de reconciliación
    const response = await axios.post(
      "https://offshoreleaks.icij.org/api/v1/reconcile",
      {
        queries: {
          q0: { query: nombre },
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      },
    );

    const resultados = response.data?.q0?.result || [];
    console.log(`✅ Resultados encontrados: ${resultados.length}`);

    return res.json({
      fuente: "ICIJ Offshore Leaks",
      nombre,
      totalResultados: resultados.length,
      tieneRegistros: resultados.length > 0,
      resultados: resultados.slice(0, 10).map((r) => ({
        nombre: r.name,
        tipo: r.type?.[0]?.name || "Desconocido",
        score: r.score,
        match: r.match,
        url: `https://offshoreleaks.icij.org/nodes/${r.id}`,
      })),
    });
  } catch (error) {
    console.error("❌ ERROR Offshore:", error.message);
    return res.status(502).json({
      error: "Error en consulta Offshore Leaks",
      detalle: error.message,
    });
  }
};
