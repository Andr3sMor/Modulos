const axios = require("axios");

const SCRAPE_TOKEN = process.env.SCRAPE_TOKEN;
const JCC_BASE = "https://sgr.jcc.gov.co:8181";
const JCC_URL = `${JCC_BASE}/apex/f?p=138:1:::NO:::`;

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  console.log(`--- Consultando JCC para: ${cedula} ---`);

  try {
    // Probar primero sin render=true
    const url1 = `http://api.scrape.do/?token=${SCRAPE_TOKEN}&url=${encodeURIComponent(JCC_URL)}`;
    console.log("URL Scrape.do:", url1);

    const r1 = await axios.get(url1, { timeout: 60000 });

    console.log("Status:", r1.status);
    const html1 = r1.data.toString();
    console.log(
      "HTML (800 chars):",
      html1
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 800),
    );

    return res.json({
      fuente: "Debug Scrape.do",
      status: r1.status,
      html: html1
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 1000),
    });
  } catch (error) {
    console.error("❌ ERROR JCC:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error(
        "Data:",
        JSON.stringify(error.response.data).substring(0, 300),
      );
    }
    return res.status(502).json({
      error: "Error en consulta JCC",
      detalle: error.message,
      responseData: error.response?.data,
    });
  }
};
