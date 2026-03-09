/**
 * jcc.controller.js - CORREGIDO
 * Fix principal: forzar HTTPS en todas las peticiones y redirecciones
 * El error "plain HTTP request was sent to HTTPS port" ocurre porque
 * axios sigue redirecciones cambiando https:// por http://
 */

const axios = require("axios");
const https = require("https");

// Agente HTTPS que ignora certificados autofirmados Y fuerza siempre HTTPS
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

const JCC_BASE = process.env.JCC_WORKER_URL || "https://sgr.jcc.gov.co:8181";
const JCC_URL = `${JCC_BASE}/apex/f?p=138:1:::NO:::`;

// Función para garantizar que una URL siempre use HTTPS
function forzarHttps(url) {
  if (!url) return url;
  // Si es ruta relativa, agregar la base
  if (url.startsWith("/")) return `${JCC_BASE}${url}`;
  // Si empieza con http:// reemplazar por https://
  if (url.startsWith("http://")) return url.replace("http://", "https://");
  return url;
}

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

// Instancia de axios con redirecciones manuales para forzar HTTPS
const axiosJCC = axios.create({
  httpsAgent,
  timeout: 30000,
  maxRedirects: 0, // Manejamos redirecciones manualmente para forzar HTTPS
  validateStatus: (status) => status < 400 || status === 302 || status === 301,
});

// Función para hacer GET siguiendo redirecciones y forzando HTTPS
async function getConHttps(url, headers = {}) {
  let currentUrl = forzarHttps(url);
  let cookies = "";
  let response;
  let intentos = 0;

  while (intentos < 5) {
    console.log(`  → GET ${currentUrl}`);
    response = await axiosJCC.get(currentUrl, {
      headers: { ...HEADERS_BASE, ...headers, Cookie: cookies },
    });

    // Acumular cookies
    const nuevasCookies = (response.headers["set-cookie"] || [])
      .map((c) => c.split(";")[0])
      .join("; ");
    if (nuevasCookies)
      cookies = cookies ? `${cookies}; ${nuevasCookies}` : nuevasCookies;

    // Si hay redirección, seguirla forzando HTTPS
    if (response.status === 301 || response.status === 302) {
      const location = response.headers["location"];
      if (!location) break;
      currentUrl = forzarHttps(location);
      intentos++;
      continue;
    }
    break;
  }

  return { response, cookies, finalUrl: currentUrl };
}

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  console.log(`\n--- Consultando JCC para: ${cedula} ---`);

  try {
    // Paso 1: GET página inicial siguiendo redirecciones con HTTPS forzado
    console.log("📄 GET página JCC...");
    const { response: r1, cookies, finalUrl } = await getConHttps(JCC_URL);

    console.log("✅ Status GET:", r1.status, "| URL final:", finalUrl);
    console.log("🍪 Cookies:", cookies ? "Sí" : "No");

    const html1 = r1.data.toString();

    // Extraer campos ocultos del formulario APEX
    const campos = {};
    const hiddenRegex = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
    (html1.match(hiddenRegex) || []).forEach((tag) => {
      const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
      const value = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
      if (name) campos[name] = value;
    });

    console.log(
      "📋 Campos APEX encontrados:",
      Object.keys(campos).join(", ") || "NINGUNO",
    );

    if (!campos["p_instance"]) {
      console.warn(
        "⚠️  ADVERTENCIA: p_instance no encontrado — puede que el HTML cambió",
      );
    }

    // Determinar URL del POST (desde action del form, o default)
    const formActionMatch = html1.match(
      /action=["']([^"']*wwv_flow[^"']*)["']/i,
    );
    const postUrl = forzarHttps(
      formActionMatch
        ? formActionMatch[1].startsWith("http")
          ? formActionMatch[1]
          : `${JCC_BASE}${formActionMatch[1]}`
        : `${JCC_BASE}/apex/wwv_flow.accept`,
    );

    console.log("🎯 POST URL:", postUrl);

    // Paso 2: POST con campos del formulario + datos de búsqueda
    const postData = {
      ...campos,
      p_request: "CONSULTAR",
      p_reload_on_submit: "S",
      p_widget_name: "wwv_flow",
      p_widget_action: "DEFAULT",
      p_t01: cedula,
      p_t02: "CC",
    };

    const body = new URLSearchParams(postData);

    console.log("🔍 Enviando POST...");
    const r2 = await axiosJCC.post(forzarHttps(postUrl), body.toString(), {
      headers: {
        ...HEADERS_BASE,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: forzarHttps(JCC_URL),
        Origin: JCC_BASE,
        Cookie: cookies,
      },
      validateStatus: (status) => status < 600,
    });

    console.log("✅ Status POST:", r2.status);

    if (r2.status >= 400) {
      const htmlError = r2.data
        ?.toString()
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .substring(0, 400);
      console.error("❌ Error en POST:", htmlError);
      return res.status(502).json({
        error: "Error en consulta JCC",
        detalle: `Servidor JCC respondió ${r2.status}. Detalle: ${htmlError}`,
      });
    }

    const texto = r2.data
      .toString()
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    console.log("📝 Respuesta:", texto.substring(0, 600));

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
      console.error("  Status:", error.response.status);
      const body = error.response.data
        ?.toString()
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .substring(0, 400);
      console.error("  Body:", body);
    }
    return res.status(502).json({
      error: "Error en consulta JCC",
      detalle: error.message,
    });
  }
};
