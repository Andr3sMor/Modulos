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
    // ── GET directo al webcert (no al SharePoint) ──────────────────────────
    console.log("📄 GET webcert/Certificado.aspx...");
    const r1 = await axiosInst.get(FORM_URL, { headers: HEADERS });
    console.log("✅ GET Status:", r1.status);
    console.log(
      "📍 GET URL final (tras redirects):",
      r1.request?.res?.responseUrl || r1.config?.url,
    );

    let cookies = parseCookies(r1.headers);
    const html = r1.data.toString();

    // Log completo de inputs para ver qué tiene este formulario
    const todosInputs = [...html.matchAll(/<input[^>]+>/gi)]
      .map((m) => m[0])
      .join("\n");
    console.log("📋 TODOS LOS INPUTS:\n", todosInputs.substring(0, 2000));

    const todosNames = [...html.matchAll(/name="([^"]+)"/gi)]
      .map((m) => m[1])
      .join(" | ");
    console.log("📋 NAMES:", todosNames.substring(0, 800));

    // Captcha
    const captchaMatch =
      html.match(/¿\s*[Cc]uanto\s+es\s+([^?<]+)\?/i) ||
      html.match(/[Cc]uanto\s+es\s+([0-9\s\+\-\*xX×]+)/i);
    const textoCaptcha = captchaMatch?.[1]?.trim() || "NO ENCONTRADO";
    console.log(`🔢 Captcha raw: "${textoCaptcha}"`);

    return res.json({
      debug: true,
      status: r1.status,
      inputs: todosNames,
      captcha: textoCaptcha,
    });
  } catch (error) {
    console.error("❌ ERROR:", error.message);
    return res.status(502).json({ error: error.message });
  }
};
