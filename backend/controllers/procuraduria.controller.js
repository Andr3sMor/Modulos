/**
 * procuraduria.controller.js
 */

const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const APPS_BASE = "https://apps.procuraduria.gov.co";
const FORM_URL = `${APPS_BASE}/webcert/Certificado.aspx`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Connection: "keep-alive",
};

const axiosInst = axios.create({
  httpsAgent,
  timeout: 10000,
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

function parsearRespuestaAsync(texto) {
  // Formato UpdatePanel: len|tipo|id|contenido|
  // pageRedirect viene URL-encoded → decodificar
  const redirectMatch = texto.match(/pageRedirect\|\|([^|]+)\|/);
  if (redirectMatch) return decodeURIComponent(redirectMatch[1]);

  const locationMatch = texto.match(
    /window\.location[^=]*=\s*['"]([^'"]+)['"]/,
  );
  if (locationMatch) return locationMatch[1];

  const certMatch = texto.match(/Certificado\.aspx\?t=([^|&\s"']+)/i);
  if (certMatch) return `/webcert/Certificado.aspx?t=${certMatch[1]}`;

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
    // ── GET formulario ─────────────────────────────────────────────────────
    console.log("📄 GET formulario...");
    const r1 = await axiosInst.get(FORM_URL, { headers: HEADERS });
    console.log("✅ GET Status:", r1.status);

    if (r1.status >= 400) {
      return res
        .status(502)
        .json({
          error: "Error consultando Procuraduría",
          detalle: `HTTP ${r1.status}`,
        });
    }

    let cookies = parseCookies(r1.headers);
    const html = r1.data.toString();

    const viewState = extraerInput(html, "__VIEWSTATE");
    const viewStateGenerator = extraerInput(html, "__VIEWSTATEGENERATOR");
    const eventValidation = extraerInput(html, "__EVENTVALIDATION");
    const idPregunta = extraerInput(html, "IdPregunta") || "20";

    // Log de inputs para debug
    const inputsDebug = [
      ...html.matchAll(/name="([^"]+)"[^>]*value="([^"]*)"/gi),
    ]
      .map((m) => `${m[1]}=${m[2].substring(0, 20)}`)
      .join(" | ");
    console.log("📋 Inputs formulario:", inputsDebug.substring(0, 600));

    // ── Paso 2: POST btnNuevaConsulta para cargar el formulario real ───────
    // El formulario inicial solo tiene btnNuevaConsulta — hay que clickearlo
    // para que el UpdatePanel cargue los campos ddlTipoID, txtNumID, etc.
    console.log("🔄 POST Nueva Consulta (cargar formulario)...");
    const postPaso1 = new URLSearchParams({
      ctl05: "UpdatePanel1|btnNuevaConsulta",
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      __LASTFOCUS: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      __EVENTVALIDATION: eventValidation,
      rblTipoCert: tipoCertificado,
      __ASYNCPOST: "true",
      btnNuevaConsulta: "Nueva Consulta",
    });

    const r1b = await axiosInst.post(FORM_URL, postPaso1.toString(), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "X-MicrosoftAjax": "Delta=true",
        Referer: FORM_URL,
        Origin: APPS_BASE,
        Cookie: cookies,
      },
    });

    cookies = parseCookies(r1b.headers, cookies);
    console.log("✅ POST Nueva Consulta Status:", r1b.status);

    // Extraer el HTML del UpdatePanel de la respuesta async
    const respPaso1 = r1b.data.toString();
    console.log(
      "📄 Respuesta Nueva Consulta (800):",
      respPaso1.substring(0, 800),
    );

    // Parsear HTML embebido en la respuesta UpdatePanel
    // Formato: len|updatePanel|id|htmlContent|
    const upMatch = respPaso1.match(
      /\d+\|updatePanel\|[^|]+\|([\s\S]+?)\|\d+\|/,
    );
    const htmlFormulario = upMatch ? upMatch[1] : respPaso1;

    // Extraer nuevos ViewState del panel de respuesta
    const vs2 = extraerInput(respPaso1, "__VIEWSTATE") || viewState;
    const vsg2 =
      extraerInput(respPaso1, "__VIEWSTATEGENERATOR") || viewStateGenerator;
    const ev2 = extraerInput(respPaso1, "__EVENTVALIDATION") || eventValidation;

    // Detectar campos reales del formulario de consulta
    const inputsForm2 = [
      ...respPaso1.matchAll(/name="([^"]+)"[^>]*value="([^"]*)"/gi),
    ]
      .map((m) => `${m[1]}=${m[2].substring(0, 20)}`)
      .join(" | ");
    console.log("📋 Inputs paso 2:", inputsForm2.substring(0, 600));

    // Extraer captcha del HTML del UpdatePanel
    const textoCaptcha =
      htmlFormulario.match(/¿\s*[Cc]uanto\s+es\s+([^?<]+)\?/i)?.[1]?.trim() ||
      htmlFormulario.match(/Cuanto\s+es\s+([0-9\s\+\-\*x×]+)/i)?.[1]?.trim() ||
      respPaso1.match(/¿\s*[Cc]uanto\s+es\s+([^?<]+)\?/i)?.[1]?.trim() ||
      "6 + 2";

    const respuestaCaptcha = resolverCaptcha(textoCaptcha);
    console.log(`🔢 Captcha: "${textoCaptcha}" → ${respuestaCaptcha}`);

    // Extraer IdPregunta del HTML actualizado
    const idPregunta2 =
      extraerInput(htmlFormulario, "IdPregunta") ||
      extraerInput(respPaso1, "IdPregunta") ||
      idPregunta;

    // Detectar botón de generar
    const btnGenMatch =
      respPaso1.match(
        /id="(btn[^"]*(?:Generar|Exportar|Consultar|Enviar)[^"]*)"[^>]*type="submit"/i,
      ) || respPaso1.match(/type="submit"[^>]*id="(btn[^"]+)"/i);
    const btnGenerar = btnGenMatch ? btnGenMatch[1] : "btnExportar";
    console.log("🔘 Botón generar:", btnGenerar);

    // ── POST final con datos de consulta ──────────────────────────────────
    const postData = new URLSearchParams({
      ctl05: `UpdatePanel1|${btnGenerar}`,
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      __LASTFOCUS: "",
      __VIEWSTATE: vs2,
      __VIEWSTATEGENERATOR: vsg2,
      __EVENTVALIDATION: ev2,
      ddlTipoID: ddlTipoID,
      txtNumID: cedula,
      rblTipoCert: tipoCertificado,
      txtRespuestaPregunta: respuestaCaptcha,
      txtEmail: "",
      IdPregunta: idPregunta2,
      __ASYNCPOST: "true",
      [btnGenerar]: "Generar",
    });

    console.log("🔍 POST consulta final...");
    const r2 = await axiosInst.post(FORM_URL, postData.toString(), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "X-MicrosoftAjax": "Delta=true",
        Referer: FORM_URL,
        Origin: APPS_BASE,
        Cookie: cookies,
      },
    });

    console.log("✅ POST Status:", r2.status);
    cookies = parseCookies(r2.headers, cookies);

    const respuestaTexto = r2.data.toString();
    console.log("📄 Respuesta POST (600):", respuestaTexto.substring(0, 600));

    // ── Extraer URL certificado ────────────────────────────────────────────
    let certUrl = "";

    if (r2.status === 301 || r2.status === 302) {
      const location = r2.headers["location"] || "";
      certUrl = location.startsWith("http")
        ? location
        : `${APPS_BASE}${location}`;
    }

    if (!certUrl) {
      const urlExtraida = parsearRespuestaAsync(respuestaTexto);
      if (urlExtraida) {
        certUrl = urlExtraida.startsWith("http")
          ? urlExtraida
          : `${APPS_BASE}${urlExtraida.startsWith("/") ? "" : "/"}${urlExtraida}`;
      }
    }

    console.log(
      "🎟️  URL certificado:",
      certUrl ? certUrl.substring(0, 100) : "NO ENCONTRADA",
    );

    // Si redirigió a Error.aspx el POST falló
    if (!certUrl || certUrl.includes("Error.aspx")) {
      return res.status(502).json({
        error: "Error consultando Procuraduría",
        detalle: certUrl.includes("Error.aspx")
          ? "El servidor rechazó el formulario. Posible cambio en los campos o captcha."
          : "No se obtuvo URL del certificado.",
      });
    }

    // ── GET certificado ────────────────────────────────────────────────────
    console.log("📜 GET certificado...");
    const r3 = await axiosInst.get(certUrl, {
      headers: { ...HEADERS, Referer: FORM_URL, Cookie: cookies },
    });
    console.log("✅ Certificado Status:", r3.status);

    const textoCert = r3.data
      .toString()
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
    const esTimeout =
      error.code === "ETIMEDOUT" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ECONNRESET";
    return res.status(502).json({
      error: "Error consultando Procuraduría",
      detalle: esTimeout
        ? "El servidor de la Procuraduría no es accesible desde este servidor cloud. El portal puede estar bloqueando IPs de Render/AWS."
        : error.message,
    });
  }
};
