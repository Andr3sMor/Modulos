const axios = require("axios");

const CATEGORIAS = [
  { id: 1, nombre: "Offshore Entities", tipo: "Entity" },
  { id: 2, nombre: "Officers", tipo: "Officer" },
  { id: 3, nombre: "Intermediaries", tipo: "Intermediary" },
  { id: 4, nombre: "Addresses", tipo: "Address" },
  { id: 5, nombre: "Others", tipo: "Other" },
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*",
  "Accept-Language": "es,en;q=0.9",
  Referer: "https://offshoreleaks.icij.org/",
  "X-Requested-With": "XMLHttpRequest",
};

async function buscarCategoria(nombre, cat) {
  const resultados = [];
  let desde = 0;
  const porPagina = 20;
  let total = 0;

  try {
    // Primera página para obtener el total
    const url = `https://offshoreleaks.icij.org/search?q=${encodeURIComponent(nombre)}&cat=${cat.id}&from=${desde}&utf8=%E2%9C%93`;
    const r = await axios.get(url, { headers: HEADERS, timeout: 20000 });

    // ICIJ devuelve JSON si se pide con Accept: application/json
    const data = r.data;

    if (data && data.hits) {
      total = data.hits.total?.value || data.hits.total || 0;
      const hits = data.hits.hits || [];
      hits.forEach((hit) => {
        const src = hit._source || {};
        resultados.push({
          id: hit._id,
          nombre: src.name || src.node_id || hit._id,
          pais: src.country_codes || src.countries || "",
          jurisdiccion: src.jurisdiction_description || src.jurisdiction || "",
          fuente: src.sourceID || src.dataset || "",
          score: Math.round((hit._score || 0) * 10),
          url: `https://offshoreleaks.icij.org/nodes/${hit._id}`,
        });
      });

      // Páginas siguientes hasta traer todos
      const paginas = Math.ceil(total / porPagina);
      const peticionesPendientes = [];

      for (let p = 1; p < Math.min(paginas, 20); p++) {
        peticionesPendientes.push(
          axios.get(
            `https://offshoreleaks.icij.org/search?q=${encodeURIComponent(nombre)}&cat=${cat.id}&from=${p * porPagina}&utf8=%E2%9C%93`,
            { headers: HEADERS, timeout: 20000 },
          ),
        );
      }

      const pagResults = await Promise.allSettled(peticionesPendientes);
      pagResults.forEach((pr) => {
        if (pr.status === "fulfilled" && pr.value.data?.hits?.hits) {
          pr.value.data.hits.hits.forEach((hit) => {
            const src = hit._source || {};
            resultados.push({
              id: hit._id,
              nombre: src.name || hit._id,
              pais: src.country_codes || src.countries || "",
              jurisdiccion:
                src.jurisdiction_description || src.jurisdiction || "",
              fuente: src.sourceID || src.dataset || "",
              score: Math.round((hit._score || 0) * 10),
              url: `https://offshoreleaks.icij.org/nodes/${hit._id}`,
            });
          });
        }
      });
    } else {
      // Fallback: usar API de reconciliación si el endpoint de búsqueda no devuelve JSON
      console.log(`[${cat.nombre}] Usando reconciliation API como fallback`);
      const r2 = await axios.post(
        "https://offshoreleaks.icij.org/api/v1/reconcile",
        { queries: { q0: { query: nombre, type: cat.tipo, limit: 50 } } },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 },
      );
      const items = r2.data?.q0?.result || [];
      total = items.length;
      items.forEach((item) => {
        resultados.push({
          id: item.id,
          nombre: item.name,
          pais: "",
          jurisdiccion: "",
          fuente: "",
          score: Math.round(item.score),
          url: `https://offshoreleaks.icij.org/nodes/${item.id}`,
        });
      });
    }
  } catch (err) {
    console.error(`Error [${cat.nombre}]:`, err.message);
  }

  console.log(`[${cat.nombre}] total=${total} obtenidos=${resultados.length}`);
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

    console.log(`✅ Total general: ${totalGeneral}`);

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
