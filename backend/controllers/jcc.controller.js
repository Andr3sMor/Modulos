const axios = require("axios");
const https = require("https");

const agent = new https.Agent({ rejectUnauthorized: false });
const SCRAPE_TOKEN = process.env.SCRAPE_TOKEN;

function scrapeUrl(url) {
  return `http://api.scrape.do?token=${SCRAPE_TOKEN}&url=${encodeURIComponent(url)}&render=true`;
}

const JCC_BASE = "https://sgr.jcc.gov.co:8181";

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  console.log(`--- Consultando JCC para: ${cedula} ---`);

  try {
    // Paso 1: GET página inicial con render JS
    console.log("📄 Obteniendo página JCC via Scrape.do...");
    const r1 = await axios.get(
      scrapeUrl(`${JCC_BASE}/apex/f?p=138:1:::NO:::`),
      {
        timeout: 60000,
      },
    );

    console.log("Status:", r1.status);
    const html1 = r1.data.toString();
    console.log(
      "HTML (600 chars):",
      html1
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 600),
    );

    // Extraer campos del formulario
    const pInstance =
      html1.match(/name="p_instance"\s+value="([^"]+)"/)?.[1] || "";
    const pFlow =
      html1.match(/name="p_flow_id"\s+value="([^"]+)"/)?.[1] || "138";
    const pFlowStep =
      html1.match(/name="p_flow_step_id"\s+value="([^"]+)"/)?.[1] || "1";
    const pPageSubmissionId =
      html1.match(/name="p_page_submission_id"\s+value="([^"]+)"/)?.[1] || "";

    console.log("Campos:", { pInstance, pFlow, pFlowStep, pPageSubmissionId });

    // Extraer cookies del header
    const cookies = (r1.headers["set-cookie"] || [])
      .map((c) => c.split(";")[0])
      .join("; ");

    // Paso 2: POST consulta
    console.log("🔍 Enviando consulta...");
    const body = new URLSearchParams({
      p_flow_id: pFlow,
      p_flow_step_id: pFlowStep,
      p_instance: pInstance,
      p_page_submission_id: pPageSubmissionId,
      p_debug: "",
      p_request: "CONSULTAR",
      p_reload_on_submit: "S",
      p_widget_name: "wwv_flow",
      p_widget_action: "DEFAULT",
      p_t01: cedula,
      p_t02: "CC",
    });

    const r2 = await axios.post(
      scrapeUrl(`${JCC_BASE}/apex/wwv_flow.accept`),
      body.toString(),
      {
        timeout: 60000,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookies,
        },
      },
    );

    const texto = r2.data
      .toString()
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    console.log("Respuesta (600 chars):", texto.substring(0, 600));

    const esContador =
      texto.toUpperCase().includes("CONTADOR PÚBLICO") ||
      texto.toUpperCase().includes("HABILITADO") ||
      texto.toUpperCase().includes("CONTADOR PUBLICO");

    const noEsContador =
      texto.toUpperCase().includes("NO REGISTRA") ||
      texto.toUpperCase().includes("NO SE ENCUENTRA");

    return res.json({
      fuente: "Junta Central de Contadores",
      esContador,
      documento: cedula,
      mensaje: esContador
        ? "La persona ES Contador Público registrado."
        : noEsContador
          ? "La persona NO está registrada como Contador Público."
          : "Sin resultado claro.",
      detalle: texto.substring(0, 600),
    });
  } catch (error) {
    console.error("❌ ERROR JCC:", error.message);
    return res.status(502).json({
      error: "Error en consulta JCC",
      detalle: error.message,
    });
  }
};
