"use strict";

const axios = require("axios");
const https = require("https");

const agent = new https.Agent({ rejectUnauthorized: false });
const BASE_URL =
  "https://cfiscal.contraloria.gov.co/certificados/certificadopersonanatural.aspx";

const HEADERS_BASE = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9",
  Connection: "keep-alive",
};

const TIPO_MAP = {
  CC: "CC",
  CE: "CE",
  TI: "TI",
  PA: "PA",
  PEP: "PEP",
  PPT: "PPT",
  "Cédula de Ciudadanía": "CC",
  "Cédula de Extranjería": "CE",
  "Tarjeta de identidad": "TI",
  Pasaporte: "PA",
};

// ─── Controller ───────────────────────────────────────────────────────────────

exports.consultarContraloria = async (req, res) => {
  const { cedula, tipo_documento = "CC" } = req.body;

  if (!cedula) {
    return res.status(400).json({ error: "El campo cedula es requerido" });
  }

  console.log(`--- Iniciando consulta Contraloría para: ${cedula} ---`);

  try {
    // 1. GET para obtener campos ASP.NET y cookie de sesión
    const { viewState, viewStateGenerator, eventValidation, cookie } =
      await fetchFormFields();

    // 2. POST con los campos del formulario
    const { buffer, contentType } = await submitForm({
      cedula,
      tipoDocumento: TIPO_MAP[tipo_documento] || "CC",
      viewState,
      viewStateGenerator,
      eventValidation,
      cookie,
    });

    // 3. Responder según lo que devolvió el portal
    if (contentType.includes("pdf") || contentType.includes("octet-stream")) {
      console.log("✅ Contraloría — PDF recibido.");
      return res.json({
        fuente: "Contraloría General de la República",
        status: "success",
        data: {
          cedula,
          pdfBase64: buffer.toString("base64"),
          fecha: new Date().toLocaleString(),
        },
      });
    }

    // Si llegó HTML, revisar si el captcha bloqueó
    const html = buffer.toString("utf-8");

    if (
      html.toLowerCase().includes("captcha") ||
      html.toLowerCase().includes("robot")
    ) {
      throw new Error("El portal validó el captcha — no se pudo omitir.");
    }

    // Algunos portados devuelven el resultado en HTML en lugar de PDF
    console.log("✅ Contraloría — respuesta HTML recibida.");
    return res.json({
      fuente: "Contraloría General de la República",
      status: "success",
      data: {
        cedula,
        html: html,
        fecha: new Date().toLocaleString(),
      },
    });
  } catch (error) {
    console.error("❌ ERROR CONTRALORÍA:", error.message);
    return res.status(502).json({
      error: "Error al consultar Contraloría",
      detalle: error.message,
    });
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchFormFields() {
  console.log("[Contraloría] Obteniendo campos del formulario...");

  const response = await axios.get(BASE_URL, {
    httpsAgent: agent,
    headers: HEADERS_BASE,
    timeout: 15000,
  });

  const html = response.data;

  // Extraer cookie de sesión
  const cookie = (response.headers["set-cookie"] || [])
    .map((c) => c.split(";")[0])
    .join("; ");

  // Extraer campos ASP.NET con regex — sin dependencias extra
  const viewState = extractField(html, "__VIEWSTATE");
  const viewStateGenerator = extractField(html, "__VIEWSTATEGENERATOR");
  const eventValidation = extractField(html, "__EVENTVALIDATION");

  if (!viewState) throw new Error("No se pudo obtener __VIEWSTATE");

  console.log("[Contraloría] ✅ Campos ASP.NET obtenidos.");
  return { viewState, viewStateGenerator, eventValidation, cookie };
}

async function submitForm({
  cedula,
  tipoDocumento,
  viewState,
  viewStateGenerator,
  eventValidation,
  cookie,
}) {
  console.log("[Contraloría] Enviando formulario...");

  const params = new URLSearchParams();
  params.append("MainContent_LineasScriptManager_HiddenField", "");
  params.append("__EVENTTARGET", "");
  params.append("__EVENTARGUMENT", "");
  params.append("__VIEWSTATE", viewState);
  params.append("__VIEWSTATEGENERATOR", viewStateGenerator);
  params.append("__EVENTVALIDATION", eventValidation);
  params.append("ctl00$MainContent$ddlTipoDocumento", tipoDocumento);
  params.append("ctl00$MainContent$txtNumeroDocumento", String(cedula));
  params.append("g-recaptcha-response", "test"); // probar si el portal valida o no
  params.append("ctl00$MainContent$btnBuscar", "Buscar");

  const response = await axios.post(BASE_URL, params.toString(), {
    httpsAgent: agent,
    headers: {
      ...HEADERS_BASE,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: BASE_URL,
      Origin: "https://cfiscal.contraloria.gov.co",
      Cookie: cookie,
    },
    responseType: "arraybuffer",
    timeout: 30000,
  });

  return {
    buffer: Buffer.from(response.data),
    contentType: response.headers["content-type"] || "",
  };
}

// Extrae el value de un input hidden por su id
function extractField(html, fieldId) {
  const match = html.match(
    new RegExp(`id="${fieldId}"[^>]*value="([^"]*)"`, "i") ||
      new RegExp(`name="${fieldId}"[^>]*value="([^"]*)"`, "i"),
  );
  if (match) return match[1];

  // Formato alternativo: value antes del id
  const match2 = html.match(
    new RegExp(`value="([^"]*)"[^>]*id="${fieldId}"`, "i"),
  );
  return match2 ? match2[1] : "";
}
