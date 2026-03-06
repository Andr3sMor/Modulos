/**
 * jcc.controller.js
 * Usa Cloudflare Worker como relay para evitar bloqueo de IP de Render
 * Cambia JCC_BASE por tu URL del Worker después de desplegarlo
 */

const axios = require("axios");
const https = require("https");
const agent = new https.Agent({ rejectUnauthorized: false });

// ⚠️ Reemplaza esto con tu URL real del Worker después del paso 3
const JCC_BASE = process.env.JCC_WORKER_URL || "https://sgr.jcc.gov.co:8181";
const JCC_URL = `${JCC_BASE}/apex/f?p=138:1:::NO:::`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9",
  Connection: "keep-alive",
};

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  console.log(`--- Consultando JCC para: ${cedula} (via ${JCC_BASE}) ---`);

  try {
    // Paso 1: GET página inicial
    console.log("📄 GET página JCC...");
    const r1 = await axios.get(JCC_URL, {
      httpsAgent: agent,
      headers: HEADERS,
      timeout: 30000,
    });
    console.log("Status GET:", r1.status);

    const html1 = r1.data.toString();
    const cookies = (r1.headers["set-cookie"] || [])
      .map((c) => c.split(";")[0])
      .join("; ");

    const campos = {};
    (html1.match(/<input[^>]+type=["']hidden["'][^>]*>/gi) || []).forEach(
      (tag) => {
        const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
        const value = tag.match(/value=["']([^"']*)/i)?.[1] ?? "";
        if (name) campos[name] = value;
      },
    );

    // Paso 2: POST consulta
    console.log("🔍 POST consulta...");
    const body = new URLSearchParams({
      ...campos,
      p_request: "CONSULTAR",
      p_reload_on_submit: "S",
      p_widget_name: "wwv_flow",
      p_widget_action: "DEFAULT",
      p_t01: cedula,
      p_t02: "CC",
    });

    const r2 = await axios.post(
      `${JCC_BASE}/apex/wwv_flow.accept`,
      body.toString(),
      {
        httpsAgent: agent,
        headers: {
          ...HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: JCC_URL,
          Origin: JCC_BASE,
          Cookie: cookies,
        },
        timeout: 30000,
      },
    );

    const texto = r2.data
      .toString()
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    console.log("Respuesta (600):", texto.substring(0, 600));

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
    return res
      .status(502)
      .json({ error: "Error en consulta JCC", detalle: error.message });
  }
};
