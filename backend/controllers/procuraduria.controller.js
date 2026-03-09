const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const BASE = "https://www.procuraduria.gov.co";
const FORM_URL = `${BASE}/Pages/Generacion-de-antecedentes.aspx`;
const APPS_BASE = "https://apps.procuraduria.gov.co";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Connection: "keep-alive",
};

const axiosInst = axios.create({
  httpsAgent,
  timeout: 30000,
  maxRedirects: 5,
  validateStatus: (s) => s < 600,
});

function extraerInput(html, name) {
  const m =
    html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i")) ||
    html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`, "i"));
  return m ? m[1] : "";
}

function resolverCaptcha(pregunta) {
  const match = pregunta.match(/(\d+)\s*([\+\-\*xX×])\s*(\d+)/);
  if (!match) return "0";
  const [, a, op, b] = match;
  if (op === "+") return String(+a + +b);
  if (op === "-") return String(+a - +b);
  return String(+a * +b);
}

function parseCookies(headers, existing = "") {
  const setCookie = headers["set-cookie"] || [];
  let result = existing;
  setCookie.forEach((c) => {
    const par = c.split(";")[0];
    const key = par.split("=")[0].trim();
    if (!result.includes(key + "="))
      result = result ? `${result}; ${par}` : par;
  });
  return result;
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

    let cookies = parseCookies(r1.headers);
    const html = r1.data.toString();

    const vs = extraerInput(html, "__VIEWSTATE");
    const vsg = extraerInput(html, "__VIEWSTATEGENERATOR");
    const ev = extraerInput(html, "__EVENTVALIDATION");
    const idPregunta = extraerInput(html, "IdPregunta") || "20";

    console.log(`📋 VIEWSTATE: ${vs ? "OK" : "NO"}`);

    // Log todos los inputs para ver IDs reales
    const todosInputs = [...html.matchAll(/<input[^>]+>/gi)]
      .map((m) => m[0].substring(0, 150))
      .join("\n");
    console.log("📋 Inputs HTML:\n", todosInputs.substring(0, 1500));

    const todosSelects = [...html.matchAll(/name="([^"]+)"[^>]*>/gi)]
      .map((m) => m[1])
      .join(" | ");
    console.log("📋 Todos los name:", todosSelects.substring(0, 600));

    // Extraer captcha
    const textoCaptcha =
      html.match(/¿\s*[Cc]uanto\s+es\s+([^?<]+)\?/i)?.[1]?.trim() ||
      html.match(/[Cc]uanto\s+es\s+([0-9\s\+\-\*xX×]+)/i)?.[1]?.trim() ||
      "6 + 2";
    const respuestaCaptcha = resolverCaptcha(textoCaptcha);
    console.log(`🔢 Captcha: "${textoCaptcha}" → ${respuestaCaptcha}`);

    // Detectar ScriptManager
    const smMatch =
      html.match(/id="([^"]*)"[^>]*>\s*<\/script[^>]*>\s*.*ScriptManager/i) ||
      html.match(/ScriptManager.*?id="([^"]+)"/is);
    // Intentar detectar el trigger del ScriptManager desde el botón Generar
    const btnMatch = html.match(
      /id="([^"]*(?:Generar|btnExportar|btnConsultar)[^"]*)"/i,
    );
    const btnId = btnMatch ? btnMatch[1] : "btnExportar";
    console.log("🔘 Botón:", btnId);

    // Detectar ScriptManager ID buscando el patrón típico
    const smIdMatch = html.match(
      /Sys\.WebForms\.PageRequestManager\._initialize\('([^']+)'/,
    );
    const smId = smIdMatch ? smIdMatch[1] : "ctl00$ScriptManager1";
    console.log("📡 ScriptManager:", smId);

    // ── POST generar ───────────────────────────────────────────────────────
    const postData = new URLSearchParams({
      [smId]: `UpdatePanel1|${btnId}`,
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      __LASTFOCUS: "",
      __VIEWSTATE: vs,
      __VIEWSTATEGENERATOR: vsg,
      __EVENTVALIDATION: ev,
      ddlTipoID: ddlTipoID,
      txtNumID: cedula,
      rblTipoCert: tipoCertificado,
      txtRespuestaPregunta: respuestaCaptcha,
      txtEmail: "",
      IdPregunta: idPregunta,
      __ASYNCPOST: "true",
      [btnId]: "Generar",
    });

    console.log("🔍 POST generar...");
    const r2 = await axiosInst.post(FORM_URL, postData.toString(), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "X-MicrosoftAjax": "Delta=true",
        Referer: FORM_URL,
        Origin: BASE,
        Cookie: cookies,
      },
    });

    cookies = parseCookies(r2.headers, cookies);
    const resp2 = r2.data.toString();
    console.log("✅ POST Status:", r2.status);
    console.log("📄 Respuesta (1000):", resp2.substring(0, 1000));

    // ── Extraer URL certificado ────────────────────────────────────────────
    let certUrl = "";

    if (r2.status === 301 || r2.status === 302) {
      const loc = r2.headers["location"] || "";
      certUrl = loc.startsWith("http") ? loc : `${APPS_BASE}${loc}`;
    }

    if (!certUrl) {
      const redirectMatch = resp2.match(/pageRedirect\|\|([^|]+)\|/);
      if (redirectMatch) {
        const decoded = decodeURIComponent(redirectMatch[1]);
        certUrl = decoded.startsWith("http")
          ? decoded
          : decoded.startsWith("/")
            ? `${APPS_BASE}${decoded}`
            : `${APPS_BASE}/${decoded}`;
      }
    }

    console.log(
      "🎟️  URL certificado:",
      certUrl ? certUrl.substring(0, 120) : "NO ENCONTRADA",
    );

    if (!certUrl || certUrl.includes("Error.aspx") || certUrl === FORM_URL) {
      return res.status(502).json({
        error: "Error consultando Procuraduría",
        detalle: certUrl?.includes("Error.aspx")
          ? "El servidor rechazó el formulario."
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
    return res
      .status(502)
      .json({
        error: "Error consultando Procuraduría",
        detalle: error.message,
      });
  }
};
