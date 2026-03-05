const axios = require("axios");
const https = require("https");

const agent = new https.Agent({ rejectUnauthorized: false });

const JCC_BASE = "https://sgr.jcc.gov.co:8181";

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  console.log(`--- Consultando JCC para: ${cedula} ---`);

  try {
    // Paso 1: GET para obtener cookies y tokens de sesión
    console.log("📄 Obteniendo sesión JCC...");
    const r1 = await axios.get(`${JCC_BASE}/apex/f?p=138:1:::NO:::`, {
      httpsAgent: agent,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9",
      },
    });

    console.log("Status GET:", r1.status);
    console.log(
      "HTML (600 chars):",
      r1.data
        .toString()
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 600),
    );

    // Extraer cookies
    const cookies = (r1.headers["set-cookie"] || [])
      .map((c) => c.split(";")[0])
      .join("; ");
    console.log("Cookies:", cookies);

    // Extraer campos ocultos del formulario
    const html = r1.data.toString();
    const pInstance =
      html.match(/name="p_instance"\s+value="([^"]+)"/)?.[1] || "";
    const pFlow =
      html.match(/name="p_flow_id"\s+value="([^"]+)"/)?.[1] || "138";
    const pFlowStep =
      html.match(/name="p_flow_step_id"\s+value="([^"]+)"/)?.[1] || "1";
    const pInstance2 =
      html.match(/name="p_instance"\s+value="([^"]+)"/)?.[1] || "";

    console.log("p_instance:", pInstance, "p_flow:", pFlow);

    // Paso 2: POST con el número de cédula
    console.log("🔍 Enviando consulta...");
    const body = new URLSearchParams({
      p_flow_id: pFlow,
      p_flow_step_id: pFlowStep,
      p_instance: pInstance,
      p_debug: "",
      p_request: "SEARCH",
      p_reload_on_submit: "S",
      p_widget_name: "wwv_flow",
      p_widget_action: "DEFAULT",
      p_t01: cedula, // campo número documento
      p_t02: "CC", // tipo documento
    });

    const r2 = await axios.post(
      `${JCC_BASE}/apex/wwv_flow.accept`,
      body.toString(),
      {
        httpsAgent: agent,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: `${JCC_BASE}/apex/f?p=138:1:::NO:::`,
          Cookie: cookies,
        },
      },
    );

    console.log("Status POST:", r2.status);
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
