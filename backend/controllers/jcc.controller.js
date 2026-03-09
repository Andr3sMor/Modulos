/**
 * jcc.controller.js - CORREGIDO
 * Fix: mejor extracción de campos APEX, manejo de redirecciones y headers completos
 */

const axios = require("axios");
const https = require("https");
const agent = new https.Agent({ rejectUnauthorized: false });

const JCC_BASE = process.env.JCC_WORKER_URL || "https://sgr.jcc.gov.co:8181";
const JCC_URL = `${JCC_BASE}/apex/f?p=138:1:::NO:::`;

const HEADERS_BASE = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
};

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  console.log(`--- Consultando JCC para: ${cedula} (via ${JCC_BASE}) ---`);

  try {
    // Paso 1: GET página inicial para obtener campos APEX
    console.log("📄 GET página JCC...");
    const r1 = await axios.get(JCC_URL, {
      httpsAgent: agent,
      headers: HEADERS_BASE,
      timeout: 30000,
      maxRedirects: 5,
    });
    console.log("Status GET:", r1.status);

    const html1 = r1.data.toString();

    // Extraer cookies correctamente
    const rawCookies = r1.headers["set-cookie"] || [];
    const cookies = rawCookies.map((c) => c.split(";")[0]).join("; ");
    console.log("🍪 Cookies obtenidas:", cookies ? "Sí" : "No");

    // Extraer TODOS los campos ocultos del formulario wwv_flow
    const campos = {};
    const hiddenRegex = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
    const matches = html1.match(hiddenRegex) || [];

    matches.forEach((tag) => {
      const nameMatch = tag.match(/name=["']([^"']+)["']/i);
      const valueMatch = tag.match(/value=["']([^"']*)["']/i);
      const name = nameMatch?.[1];
      const value = valueMatch?.[1] ?? "";
      if (name) campos[name] = value;
    });

    console.log("📋 Campos encontrados:", Object.keys(campos));

    // Verificar campos críticos de APEX
    if (!campos["p_instance"]) {
      console.warn("⚠️  p_instance no encontrado en el HTML");
    }
    if (!campos["p_flow_id"]) {
      console.warn("⚠️  p_flow_id no encontrado en el HTML");
    }

    // Extraer también el action del formulario si existe
    const formActionMatch = html1.match(
      /action=["']([^"']*wwv_flow[^"']*)["']/i,
    );
    const postUrl = formActionMatch
      ? formActionMatch[1].startsWith("http")
        ? formActionMatch[1]
        : `${JCC_BASE}${formActionMatch[1]}`
      : `${JCC_BASE}/apex/wwv_flow.accept`;

    console.log("🎯 URL de POST:", postUrl);

    // Paso 2: POST consulta con todos los campos del formulario
    const postData = {
      ...campos,
      p_request: "CONSULTAR",
      p_reload_on_submit: "S",
      p_widget_name: "wwv_flow",
      p_widget_action: "DEFAULT",
      p_t01: cedula,
      p_t02: "CC", // Tipo de documento: Cédula de Ciudadanía
    };

    const body = new URLSearchParams(postData);

    console.log("🔍 POST consulta a:", postUrl);
    console.log("📤 Campos enviados:", Object.keys(postData).join(", "));

    const r2 = await axios.post(postUrl, body.toString(), {
      httpsAgent: agent,
      headers: {
        ...HEADERS_BASE,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: JCC_URL,
        Origin: JCC_BASE,
        Cookie: cookies,
      },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500, // No lanzar error en 4xx
    });

    console.log("Status POST:", r2.status);

    if (r2.status === 400) {
      console.error(
        "❌ 400 Bad Request - HTML recibido (500 chars):",
        r2.data
          ?.toString()
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .substring(0, 500),
      );
      return res.status(502).json({
        error: "Error en consulta JCC",
        detalle: `El servidor JCC rechazó la solicitud (400). Posiblemente el sitio cambió su formulario o requiere sesión válida.`,
        debug: {
          camposEnviados: Object.keys(postData),
          p_instance: !!campos["p_instance"],
          p_flow_id: campos["p_flow_id"],
        },
      });
    }

    const texto = r2.data
      .toString()
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    console.log("📝 Respuesta (600):", texto.substring(0, 600));

    const textoUpper = texto.toUpperCase();
    const esContador =
      textoUpper.includes("CONTADOR PÚBLICO") ||
      textoUpper.includes("CONTADOR PUBLICO") ||
      textoUpper.includes("HABILITADO") ||
      textoUpper.includes("TARJETA PROFESIONAL");

    const noEsContador =
      textoUpper.includes("NO REGISTRA") ||
      textoUpper.includes("NO SE ENCUENTRA") ||
      textoUpper.includes("NO EXISTE");

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
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data?.toString().substring(0, 300));
    }
    return res.status(502).json({
      error: "Error en consulta JCC",
      detalle: error.message,
    });
  }
};
