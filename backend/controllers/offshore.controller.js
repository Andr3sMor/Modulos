const axios = require("axios");

// Categorías de ICIJ Offshore Leaks
// cat=1: Entities, cat=2: Officers, cat=3: Intermediaries, cat=4: Addresses, cat=5: Others
const CATEGORIAS = [
  { id: 1, nombre: "Offshore Entities" },
  { id: 2, nombre: "Officers" },
  { id: 3, nombre: "Intermediaries" },
  { id: 4, nombre: "Addresses" },
  { id: 5, nombre: "Others" },
];

async function buscarCategoria(nombre, catId) {
  try {
    const url = `https://offshoreleaks.icij.org/search?q=${encodeURIComponent(nombre)}&cat=${catId}&utf8=%E2%9C%93`;
    const r = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es,en;q=0.9",
      },
      timeout: 15000,
    });

    const html = r.data.toString();

    // Extraer resultados de la tabla
    const resultados = [];
    const filas = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

    filas.forEach((fila) => {
      // Extraer link y nombre
      const linkMatch = fila.match(
        /href="\/nodes\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>/,
      );
      if (!linkMatch) return;

      const id = linkMatch[1];
      const nombreResultado = linkMatch[2].trim();

      // Extraer país/jurisdicción
      const celdas = fila.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      const textosCeldas = celdas
        .map((c) => c.replace(/<[^>]+>/g, "").trim())
        .filter((t) => t);

      resultados.push({
        id,
        nombre: nombreResultado,
        pais: textosCeldas[1] || "",
        jurisdiccion: textosCeldas[2] || "",
        fuente: textosCeldas[3] || "",
        url: `https://offshoreleaks.icij.org/nodes/${id}`,
      });
    });

    // Extraer total de resultados
    const totalMatch = html.match(/(\d[\d,]*)\s+result/i);
    const total = totalMatch
      ? parseInt(totalMatch[1].replace(/,/g, ""))
      : resultados.length;

    return { catId, total, resultados: resultados.slice(0, 5) };
  } catch (err) {
    console.error(`Error categoría ${catId}:`, err.message);
    return { catId, total: 0, resultados: [] };
  }
}

exports.consultarOffshore = async (req, res) => {
  const { nombre } = req.body;
  if (!nombre)
    return res.status(400).json({ error: "El campo 'nombre' es requerido." });

  console.log(`--- Consultando Offshore Leaks para: ${nombre} ---`);

  try {
    // Buscar en todas las categorías en paralelo
    const promesas = CATEGORIAS.map((cat) => buscarCategoria(nombre, cat.id));
    const resultadosCats = await Promise.all(promesas);

    // Construir respuesta con resumen por categoría
    const categorias = CATEGORIAS.map((cat, i) => ({
      id: cat.id,
      nombre: cat.nombre,
      total: resultadosCats[i].total,
      resultados: resultadosCats[i].resultados,
    }));

    const totalGeneral = categorias.reduce((acc, c) => acc + c.total, 0);
    const tieneRegistros = totalGeneral > 0;

    console.log(`✅ Total registros: ${totalGeneral}`);
    categorias.forEach((c) => console.log(`  ${c.nombre}: ${c.total}`));

    return res.json({
      fuente: "ICIJ Offshore Leaks",
      nombre,
      tieneRegistros,
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
