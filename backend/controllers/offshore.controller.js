const axios = require("axios");

const CATEGORIAS = [
  { id: 1, nombre: "Offshore Entities", tipo: "Entity" },
  { id: 2, nombre: "Officers", tipo: "Officer" },
  { id: 3, nombre: "Intermediaries", tipo: "Intermediary" },
  { id: 4, nombre: "Addresses", tipo: "Address" },
  { id: 5, nombre: "Others", tipo: "Other" },
];

async function buscarCategoria(nombre, cat) {
  const resultados = [];
  let total = 0;

  try {
    // Reconciliation API con limit alto
    const r = await axios.post(
      "https://offshoreleaks.icij.org/api/v1/reconcile",
      { queries: { q0: { query: nombre, type: cat.tipo, limit: 10000000 } } },
      { headers: { "Content-Type": "application/json" }, timeout: 20000 },
    );

    const items = r.data?.q0?.result || [];
    total = items.length;
    items.forEach((item) => {
      resultados.push({
        id: item.id,
        nombre: item.name,
        score: Math.round(item.score),
        match: item.match,
        url: `https://offshoreleaks.icij.org/nodes/${item.id}`,
      });
    });
  } catch (err) {
    console.error(`Error [${cat.nombre}]:`, err.message);
  }

  // Ordenar por score descendente
  resultados.sort((a, b) => b.score - a.score);

  console.log(`[${cat.nombre}] obtenidos=${resultados.length}`);
  return { tipo: cat.tipo, nombre: cat.nombre, total, resultados };
}

exports.consultarOffshore = async (req, res) => {
  const { nombre } = req.body;
  if (!nombre)
    return res.status(400).json({ error: "El campo 'nombre' es requerido." });

  console.log(`--- Consultando Offshore Leaks para: ${nombre} ---`);

  try {
    const categorias = await Promise.all(
      CATEGORIAS.map((cat) => buscarCategoria(nombre, cat)),
    );
    const totalGeneral = categorias.reduce((acc, c) => acc + c.total, 0);

    return res.json({
      fuente: "ICIJ Offshore Leaks",
      nombre,
      tieneRegistros: totalGeneral > 0,
      totalResultados: totalGeneral,
      categorias,
    });
  } catch (error) {
    console.error("❌ ERROR Offshore:", error.message);
    return res.status(502).json({
      error: "Error en consulta Offshore Leaks",
      detalle: error.message,
    });
  }
};
