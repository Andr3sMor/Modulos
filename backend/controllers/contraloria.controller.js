"use strict";

const axios = require("axios");
const https = require("https");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

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
    const { viewState, viewStateGenerator, eventValidation, cookie } =
      await fetchFormFields();

    const { buffer, contentType } = await submitForm({
      cedula,
      tipoDocumento: TIPO_MAP[tipo_documento] || "CC",
      viewState,
      viewStateGenerator,
      eventValidation,
      cookie,
    });

    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      const html = buffer.toString("utf-8");
      if (
        html.toLowerCase().includes("captcha") ||
        html.toLowerCase().includes("robot")
      ) {
        throw new Error("El portal validó el captcha — no se pudo omitir.");
      }
      throw new Error(
        "El portal no devolvió un PDF. Content-Type: " + contentType,
      );
    }

    // Extraer texto del PDF para determinar responsabilidad fiscal
    const { tieneFiscal, mensaje } = await analizarPDF(buffer);

    console.log(`✅ Contraloría — tieneFiscal: ${tieneFiscal}`);

    return res.json({
      fuente: "Contraloría General de la República",
      status: "success",
      data: {
        cedula,
        tieneFiscal,
        mensaje,
        pdfBase64: buffer.toString("base64"),
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

// ─── Parsear PDF ──────────────────────────────────────────────────────────────

async function analizarPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    const texto = data.text.toUpperCase();

    console.log(
      "[Contraloría] Texto extraído del PDF:",
      data.text.substring(0, 300),
    );

    // Detectar si tiene o no responsabilidad fiscal
    const tieneReporte =
      texto.includes("SE ENCUENTRA REPORTADO COMO RESPONSABLE FISCAL") &&
      !texto.includes("NO SE ENCUENTRA REPORTADO COMO RESPONSABLE FISCAL");

    const noTieneReporte = texto.includes(
      "NO SE ENCUENTRA REPORTADO COMO RESPONSABLE FISCAL",
    );

    if (noTieneReporte) {
      return {
        tieneFiscal: false,
        mensaje:
          "El número de identificación NO SE ENCUENTRA REPORTADO COMO RESPONSABLE FISCAL.",
      };
    }

    if (tieneReporte) {
      return {
        tieneFiscal: true,
        mensaje:
          "El número de identificación SE ENCUENTRA REPORTADO COMO RESPONSABLE FISCAL.",
      };
    }

    // Si el texto no coincide con ninguno de los patrones esperados
    console.warn(
      "[Contraloría] No se reconoció el patrón en el PDF. Texto:",
      data.text.substring(0, 500),
    );
    return {
      tieneFiscal: null,
      mensaje:
        "No se pudo determinar el estado fiscal. Descarga el certificado para revisarlo manualmente.",
    };
  } catch (parseError) {
    console.warn("[Contraloría] Error parseando PDF:", parseError.message);
    return {
      tieneFiscal: null,
      mensaje: "No se pudo leer el certificado automáticamente.",
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchFormFields() {
  console.log("[Contraloría] Obteniendo campos del formulario...");

  const response = await axios.get(BASE_URL, {
    httpsAgent: agent,
    headers: HEADERS_BASE,
    timeout: 15000,
  });

  const html = response.data;
  const cookie = (response.headers["set-cookie"] || [])
    .map((c) => c.split(";")[0])
    .join("; ");

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
  params.append("g-recaptcha-response", "test");
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

function extractField(html, fieldId) {
  const m1 = html.match(new RegExp(`id="${fieldId}"[^>]*value="([^"]*)"`, "i"));
  if (m1) return m1[1];
  const m2 = html.match(new RegExp(`value="([^"]*)"[^>]*id="${fieldId}"`, "i"));
  return m2 ? m2[1] : "";
}
