const axios = require("axios");

const TIPOS = [
  { id: "Entity", nombre: "Offshore Entities" },
  { id: "Officer", nombre: "Officers" },
  { id: "Intermediary", nombre: "Intermediaries" },
  { id: "Address", nombre: "Addresses" },
  { id: "Other", nombre: "Others" },
];

async function buscarPorTipo(nombre, tipo) {
  try {
    const r = await axios.post(
      "https://offshoreleaks.icij.org/api/v1/reconcile",
      { queries: { q0: { query: nombre, type: tipo.id, limit: 10 } } },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      },
    );

    const resultados = r.data?.q0?.result || [];
    return {
      tipo: tipo.id,
      nombre: tipo.nombre,
      total: resultados.length,
      resultados: resultados.map((r) => ({
        id: r.id,
        nombre: r.name,
        score: Math.round(r.score),
        match: r.match,
        url: `https://offshoreleaks.icij.org/nodes/${r.id}`,
      })),
    };
  } catch (err) {
    console.error(`Error tipo ${tipo.id}:`, err.message);
    return { tipo: tipo.id, nombre: tipo.nombre, total: 0, resultados: [] };
  }
}

exports.consultarOffshore = async (req, res) => {
  const { nombre } = req.body;
  if (!nombre)
    return res.status(400).json({ error: "El campo 'nombre' es requerido." });

  console.log(`--- Consultando Offshore Leaks para: ${nombre} ---`);

  try {
    const resultadosCats = await Promise.all(
      TIPOS.map((t) => buscarPorTipo(nombre, t)),
    );

    const totalGeneral = resultadosCats.reduce((acc, c) => acc + c.total, 0);
    const tieneRegistros = totalGeneral > 0;

    console.log(`✅ Total: ${totalGeneral}`);
    resultadosCats.forEach((c) => console.log(`  ${c.nombre}: ${c.total}`));

    return res.json({
      fuente: "ICIJ Offshore Leaks",
      nombre,
      tieneRegistros,
      totalResultados: totalGeneral,
      categorias: resultadosCats,
    });
  } catch (error) {
    console.error("❌ ERROR Offshore:", error.message);
    return res.status(502).json({
      error: "Error en consulta Offshore Leaks",
      detalle: error.message,
    });
  }
};
