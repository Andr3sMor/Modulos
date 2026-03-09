/**
 * procuraduria.controller.js
 *
 * Flujo:
 * 1. GET https://procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx
 *    → extraer __VIEWSTATE, __VIEWSTATEGENERATOR, __EVENTVALIDATION, IdPregunta
 *    → resolver la operación matemática del captcha
 * 2. POST con todos los campos → obtener token "t" en la URL de redirección
 * 3. GET/POST a Certificado.aspx?t=...&tpo=2 → verificar antecedentes
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

// Extrae el valor de un input hidden del HTML
function extraerInput(html, name) {
  const match =
    html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i")) ||
    html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`, "i")) ||
    html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`, "i"));
  return match ? match[1] : "";
}

// Resuelve operaciones simples: "6 + 2", "3 - 1", "4 * 2"
function resolverCaptcha(pregunta) {
  const limpia = pregunta.replace(/[¿?¡!]/g, "").trim();
  // Buscar patrón: número operador número
  const match = limpia.match(/(\d+)\s*([\+\-\*x×])\s*(\d+)/);
  if (!match) {
    console.warn("⚠️ No se pudo parsear captcha:", pregunta);
    return "0";
  }
  const a = parseInt(match[1]);
  const op = match[2];
  const b = parseInt(match[3]);
  if (op === "+") return String(a + b);
  if (op === "-") return String(a - b);
  if (op === "*" || op === "x" || op === "×") return String(a * b);
  return "0";
}

// Acumula cookies de respuestas sucesivas
function parseCookies(headers, existing = "") {
  const setCookie = headers["set-cookie"] || [];
  let result = existing;
  setCookie.forEach((c) => {
    const par = c.split(";")[0];
    const key = par.split("=")[0].trim();
    if (!result.includes(key + "=")) {
      result = result ? `${result}; ${par}` : par;
    } else {
      // actualizar valor existente
      result = result.replace(new RegExp(`${key}=[^;]*(;|$)`), par + "$1");
    }
  });
  return result;
}

exports.consultarProcuraduria = async (req, res) => {
  const { cedula, tipoDocumento = "CC", tipoCertificado = "1" } = req.body;

  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  // Mapear tipo de documento a valor del select
  const tipoIDMap = {
    CC: "1",
    CE: "2",
    PA: "3",
    "Cédula de Ciudadanía": "1",
    "Cédula de Extranjería": "2",
    Pasaporte: "3",
  };
  const ddlTipoID = tipoIDMap[tipoDocumento] || "1";

  console.log(`\n=== Consulta Procuraduría: ${cedula} ===`);

  try {
    // ── Paso 1: GET formulario ─────────────────────────────────────────────
    console.log("📄 GET formulario Procuraduría...");
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

    // Extraer campos ASP.NET
    const viewState = extraerInput(html, "__VIEWSTATE");
    const viewStateGenerator = extraerInput(html, "__VIEWSTATEGENERATOR");
    const eventValidation = extraerInput(html, "__EVENTVALIDATION");

    // Extraer IdPregunta y texto del captcha
    const idPregunta =
      extraerInput(html, "IdPregunta") ||
      html.match(/IdPregunta[^>]*value="([^"]+)"/i)?.[1] ||
      "20";

    const textoCaptcha =
      html.match(/¿\s*[Cc]uanto\s+es\s+([^?]+)\?/i)?.[1]?.trim() ||
      html.match(/Cuanto\s+es\s+([^<"?]+)/i)?.[1]?.trim() ||
      html.match(/id="lblPregunta"[^>]*>([^<]+)</i)?.[1]?.trim() ||
      "6 + 2";

    console.log("📋 VIEWSTATE:", viewState ? "OK" : "NO ENCONTRADO");
    console.log("📋 Captcha texto:", textoCaptcha);

    const respuestaCaptcha = resolverCaptcha(textoCaptcha);
    console.log("🔢 Respuesta captcha:", respuestaCaptcha);

    // ── Paso 2: POST formulario ────────────────────────────────────────────
    const postData = new URLSearchParams({
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
      btnExportar: "Generar",
    });

    console.log("🔍 POST formulario...");
    const r2 = await axiosInst.post(FORM_URL, postData.toString(), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: FORM_URL,
        Origin: BASE_URL,
        Cookie: cookies,
      },
    });

    console.log("✅ POST Status:", r2.status);
    cookies = parseCookies(r2.headers, cookies);

    // Buscar token "t" en la redirección o en el HTML
    let tokenT = "";
    let certUrl = "";

    if (r2.status === 302 || r2.status === 301) {
      const location = r2.headers["location"] || "";
      console.log("🔀 Redirección a:", location);
      const tMatch = location.match(/[?&]t=([^&]+)/);
      tokenT = tMatch ? decodeURIComponent(tMatch[1]) : "";
      certUrl = location.startsWith("http")
        ? location
        : `${CERT_BASE}${location}`;
    } else {
      // A veces el redirect está embebido en el HTML como meta refresh o JS
      const htmlR2 = r2.data.toString();
      const tMatch =
        htmlR2.match(/Certificado\.aspx\?t=([^&"'\s]+)/i) ||
        htmlR2.match(
          /window\.location[^=]*=\s*['"]([^'"]+Certificado[^'"]+)['"]/i,
        );
      if (tMatch) {
        certUrl = tMatch[1].startsWith("http")
          ? tMatch[1]
          : `${CERT_BASE}/${tMatch[1]}`;
        const tm = certUrl.match(/[?&]t=([^&]+)/);
        tokenT = tm ? decodeURIComponent(tm[1]) : "";
      }
    }

    console.log(
      "🎟️  Token t:",
      tokenT ? tokenT.substring(0, 30) + "..." : "NO ENCONTRADO",
    );

    if (!tokenT && !certUrl) {
      // Puede que el captcha falló — revisar mensaje en HTML
      const htmlR2 = r2.data.toString();
      const errorMsg =
        htmlR2.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim() ||
        htmlR2.match(/lblMensaje[^>]*>([^<]+)</i)?.[1]?.trim() ||
        "No se obtuvo token de certificado";
      console.error("❌ Sin token:", errorMsg);
      return res.status(502).json({
        error: "Error consultando Procuraduría",
        detalle: errorMsg,
      });
    }

    // ── Paso 3: GET/POST certificado ───────────────────────────────────────
    if (!certUrl) {
      certUrl = `${CERT_BASE}/Certificado.aspx?t=${encodeURIComponent(tokenT)}&tpo=2`;
    }

    console.log("📜 GET certificado:", certUrl.substring(0, 80) + "...");
    const r3 = await axiosInst.get(certUrl, {
      headers: { ...HEADERS, Referer: FORM_URL, Cookie: cookies },
    });

    console.log("✅ Certificado Status:", r3.status);
    cookies = parseCookies(r3.headers, cookies);

    const htmlCert = r3.data.toString();
    const textoCert = htmlCert
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

    console.log("📝 Texto certificado (400):", textoCert.substring(0, 400));

    // Interpretar resultado
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
