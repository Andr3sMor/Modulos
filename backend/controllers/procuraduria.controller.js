/**
 * procuraduria.controller.js
 *
 * El formulario usa ASP.NET UpdatePanel con __ASYNCPOST=true.
 * La respuesta NO es una redirección HTTP 302 sino texto plano con formato:
 *   length|type|id|content|length|type|id|content|...
 * donde uno de los bloques es "pageRedirect" con la URL destino.
 */

const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const BASE_URL = "https://procuraduria.gov.co";
const FORM_URL = `${BASE_URL}/Pages/Generacion-de-antecedentes.aspx`;
const CERT_BASE = "https://apps.procuraduria.gov.co/webcert";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

const axiosInst = axios.create({
  httpsAgent,
  timeout: 30000,
  maxRedirects: 0,
  validateStatus: (s) => s < 600,
});

function extraerInput(html, name) {
  const m =
    html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i")) ||
    html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`, "i")) ||
    html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`, "i"));
  return m ? m[1] : "";
}

function resolverCaptcha(pregunta) {
  const match = pregunta.match(/(\d+)\s*([\+\-\*x×])\s*(\d+)/);
  if (!match) return "0";
  const a = parseInt(match[1]);
  const op = match[2];
  const b = parseInt(match[3]);
  if (op === "+") return String(a + b);
  if (op === "-") return String(a - b);
  if (op === "*" || op === "x" || op === "×") return String(a * b);
  return "0";
}

function parseCookies(headers, existing = "") {
  const setCookie = headers["set-cookie"] || [];
  let result = existing;
  setCookie.forEach((c) => {
    const par = c.split(";")[0];
    const key = par.split("=")[0].trim();
    if (!result.includes(key + "=")) {
      result = result ? `${result}; ${par}` : par;
    }
  });
  return result;
}

/**
 * Parsea la respuesta de ASP.NET ScriptManager (UpdatePanel / __ASYNCPOST)
 * Formato: "len|tipo|id|contenido|len|tipo|id|contenido|..."
 * Busca un bloque de tipo "pageRedirect" que contiene la URL destino.
 */
function parsearRespuestaAsync(texto) {
  // Buscar pageRedirect directamente
  const redirectMatch = texto.match(/pageRedirect\|\|([^|]+)\|/);
  if (redirectMatch) return redirectMatch[1];

  // Buscar también en formato scriptBlock con window.location
  const locationMatch = texto.match(
    /window\.location[^=]*=\s*['"]([^'"]+)['"]/,
  );
  if (locationMatch) return locationMatch[1];

  // Buscar URL de certificado directamente
  const certMatch = texto.match(/Certificado\.aspx\?t=([^|&\s"']+)/i);
  if (certMatch) return `${CERT_BASE}/Certificado.aspx?t=${certMatch[1]}`;

  return null;
}

const tipoIDMap = {
  CC: "1",
  CE: "2",
  PA: "3",
  "Cédula de Ciudadanía": "1",
  "Cédula de Extranjería": "2",
  Pasaporte: "3",
};

exports.consultarProcuraduria = async (req, res) => {
  const { cedula, tipoDocumento = "CC", tipoCertificado = "1" } = req.body;

  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const ddlTipoID = tipoIDMap[tipoDocumento] || "1";

  console.log(`\n=== Consulta Procuraduría: ${cedula} ===`);

  try {
    // ── Paso 1: GET formulario ─────────────────────────────────────────────
    console.log("📄 GET formulario...");
    const r1 = await axiosInst.get(FORM_URL, { headers: HEADERS });
    console.log("✅ GET Status:", r1.status);

    if (r1.status >= 400) {
      return res.status(502).json({
        error: "Error consultando Procuraduría",
        detalle: `No se pudo cargar el formulario (HTTP ${r1.status})`,
      });
    }

    let cookies = parseCookies(r1.headers);
    const html = r1.data.toString();

    const viewState = extraerInput(html, "__VIEWSTATE");
    const viewStateGenerator = extraerInput(html, "__VIEWSTATEGENERATOR");
    const eventValidation = extraerInput(html, "__EVENTVALIDATION");
    const idPregunta = extraerInput(html, "IdPregunta") || "20";

    const textoCaptcha =
      html.match(/¿\s*[Cc]uanto\s+es\s+([^?<]+)\?/i)?.[1]?.trim() ||
      html.match(/Cuanto\s+es\s+([0-9\s\+\-\*x×]+)/i)?.[1]?.trim() ||
      "6 + 2";

    console.log("📋 VIEWSTATE:", viewState ? "OK" : "NO ENCONTRADO");
    console.log(
      "📋 Captcha:",
      textoCaptcha,
      "→",
      resolverCaptcha(textoCaptcha),
    );

    const respuestaCaptcha = resolverCaptcha(textoCaptcha);

    // ── Paso 2: POST con __ASYNCPOST=true (UpdatePanel) ───────────────────
    // El campo ctl05 es el ScriptManager trigger, crítico para el async post
    const postData = new URLSearchParams({
      ctl05: "UpdatePanel1|btnExportar", // ScriptManager trigger
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      __LASTFOCUS: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      __EVENTVALIDATION: eventValidation,
      foo: "",
      ddlTipoID: ddlTipoID,
      txtNumID: cedula,
      rblTipoCert: tipoCertificado,
      txtRespuestaPregunta: respuestaCaptcha,
      txtEmail: "",
      IdPregunta: idPregunta,
      __ASYNCPOST: "true",
      btnExportar: "Generar",
    });

    console.log("🔍 POST formulario (ASYNCPOST)...");
    const r2 = await axiosInst.post(FORM_URL, postData.toString(), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "X-MicrosoftAjax": "Delta=true",
        Referer: FORM_URL,
        Origin: BASE_URL,
        Cookie: cookies,
      },
    });

    console.log("✅ POST Status:", r2.status);
    cookies = parseCookies(r2.headers, cookies);

    const respuestaTexto = r2.data.toString();
    console.log("📄 Respuesta POST (500):", respuestaTexto.substring(0, 500));

    // ── Paso 3: Extraer URL del certificado ────────────────────────────────
    let certUrl = "";

    // Caso A: redirección HTTP clásica
    if (r2.status === 301 || r2.status === 302) {
      const location = r2.headers["location"] || "";
      certUrl = location.startsWith("http")
        ? location
        : `${CERT_BASE}${location}`;
    }

    // Caso B: respuesta async de UpdatePanel
    if (!certUrl) {
      const urlExtraida = parsearRespuestaAsync(respuestaTexto);
      if (urlExtraida) {
        certUrl = urlExtraida.startsWith("http")
          ? urlExtraida
          : `${CERT_BASE}/${urlExtraida.replace(/^\//, "")}`;
      }
    }

    console.log(
      "🎟️  URL certificado:",
      certUrl ? certUrl.substring(0, 80) + "..." : "NO ENCONTRADA",
    );

    if (!certUrl) {
      // Mostrar texto plano para diagnóstico
      const textoPlano = respuestaTexto
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 600);
      console.error("❌ Sin URL de certificado. Respuesta:", textoPlano);
      return res.status(502).json({
        error: "Error consultando Procuraduría",
        detalle:
          "No se obtuvo URL del certificado. Respuesta del servidor: " +
          textoPlano,
      });
    }

    // ── Paso 4: GET certificado ────────────────────────────────────────────
    console.log("📜 GET certificado...");
    const r3 = await axiosInst.get(certUrl, {
      headers: { ...HEADERS, Referer: FORM_URL, Cookie: cookies },
    });

    console.log("✅ Certificado Status:", r3.status);

    const htmlCert = r3.data.toString();
    const textoCert = htmlCert
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

    console.log("📝 Certificado (400):", textoCert.substring(0, 400));

    const sinSanciones =
      textoCert.includes("NO REGISTRA") ||
      textoCert.includes("SIN ANTECEDENTES") ||
      textoCert.includes("NO SE ENCONTRARON") ||
      textoCert.includes("NO TIENE SANCIONES");

    const conSanciones =
      textoCert.includes("SANCIONADO") ||
      textoCert.includes("INHABILIT") ||
      textoCert.includes("SUSPENDIDO") ||
      textoCert.includes("DESTITUIDO");

    return res.json({
      fuente: "Procuraduría General de la Nación",
      tieneSanciones: conSanciones,
      sinSanciones,
      documento: cedula,
      mensaje: conSanciones
        ? "La persona REGISTRA sanciones en la Procuraduría."
        : sinSanciones
          ? "La persona NO registra sanciones en la Procuraduría."
          : "No se pudo determinar el resultado con claridad.",
      certificadoUrl: certUrl,
      detalle: textoCert.substring(0, 500),
    });
  } catch (error) {
    console.error("❌ ERROR Procuraduría:", error.message);
    if (error.response) {
      console.error("  Status:", error.response.status);
    }
    return res.status(502).json({
      error: "Error consultando Procuraduría",
      detalle: error.message,
    });
  }
};
