/**
 * policia.controller.js
 * Recibe el token reCAPTCHA resuelto desde el frontend Angular
 * No necesita browser ni servicios de pago
 */

const axios = require("axios");
const https = require("https");

const POLICIA_BASE = "https://antecedentes.policia.gov.co:7005";
const POLICIA_URL = `${POLICIA_BASE}/WebJudicial/index.xhtml`;
const POLICIA_FORM = `${POLICIA_BASE}/WebJudicial/antecedentes.xhtml`;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Connection: "keep-alive",
};

function parseCookies(existing, header) {
  const cookies = { ...existing };
  const headers = Array.isArray(header) ? header : [header].filter(Boolean);
  headers.forEach((h) => {
    const [pair] = h.split(";");
    const [name, ...rest] = pair.split("=");
    if (name?.trim()) cookies[name.trim()] = rest.join("=").trim();
  });
  return cookies;
}
function cookiesToHeader(c) {
  return Object.entries(c)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
function extraerCamposOcultos(html) {
  const campos = {};
  (html.match(/<input[^>]+type=["']hidden["'][^>]*>/gi) || []).forEach(
    (tag) => {
      const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
      const value = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
      if (name) campos[name] = value;
    },
  );
  return campos;
}

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "cc", recaptchaToken } = req.body;

  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  // Si no viene token, devolver 428 para que Angular muestre el captcha
  if (!recaptchaToken) {
    return res.status(428).json({
      error: "captcha_required",
      mensaje: "Se requiere resolver el reCAPTCHA antes de continuar.",
      sitekey: "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH",
    });
  }

  const tipoMap = {
    "Cédula de Ciudadanía": "cc",
    "Cédula de Extranjería": "cx",
    Pasaporte: "pa",
    "Documento País Origen": "dp",
    cc: "cc",
    cx: "cx",
    pa: "pa",
    dp: "dp",
  };
  const tipoValor = tipoMap[tipoDocumento] || "cc";

  console.log(
    `--- Consultando antecedentes para: ${cedula} (token: ${recaptchaToken.substring(0, 20)}...) ---`,
  );
  let cookies = {};

  try {
    // PASO 1: GET términos
    const r1 = await axios.get(POLICIA_URL, {
      httpsAgent,
      headers: { ...BASE_HEADERS, Accept: "text/html" },
    });
    cookies = parseCookies(cookies, r1.headers["set-cookie"]);
    const campos1 = extraerCamposOcultos(r1.data);
    if (!campos1["javax.faces.ViewState"])
      throw new Error("Sin ViewState en términos.");

    // PASO 2: POST aceptar términos
    const r2 = await axios.post(
      POLICIA_URL,
      new URLSearchParams({
        ...campos1,
        aceptaOption: "true",
        "javax.faces.partial.ajax": "true",
        "javax.faces.source": "continuarBtn",
        "javax.faces.partial.execute": "@all",
        "javax.faces.partial.render": "@all",
        "javax.faces.behavior.event": "action",
        "javax.faces.partial.event": "click",
        form: "form",
        continuarBtn: "continuarBtn",
      }).toString(),
      {
        httpsAgent,
        headers: {
          ...BASE_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Faces-Request": "partial/ajax",
          "X-Requested-With": "XMLHttpRequest",
          Referer: POLICIA_URL,
          Origin: POLICIA_BASE,
          Cookie: cookiesToHeader(cookies),
        },
      },
    );
    cookies = parseCookies(cookies, r2.headers["set-cookie"]);

    // PASO 3: GET formulario
    const r3 = await axios.get(POLICIA_FORM, {
      httpsAgent,
      headers: {
        ...BASE_HEADERS,
        Accept: "text/html",
        Referer: POLICIA_URL,
        Cookie: cookiesToHeader(cookies),
      },
    });
    cookies = parseCookies(cookies, r3.headers["set-cookie"]);
    const campos3 = extraerCamposOcultos(r3.data);
    if (!campos3["javax.faces.ViewState"])
      throw new Error("Sin ViewState en formulario.");

    // PASO 4: POST consulta con token del frontend
    console.log("🔍 Enviando consulta con token del usuario...");
    const r4 = await axios.post(
      POLICIA_FORM,
      new URLSearchParams({
        ...campos3,
        formAntecedentes: "formAntecedentes",
        cedulaTipo: tipoValor,
        cedulaInput: cedula,
        "g-recaptcha-response": recaptchaToken,
        captchaAntecedentes_response: recaptchaToken,
        j_idt17: "",
      }).toString(),
      {
        httpsAgent,
        headers: {
          ...BASE_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: POLICIA_FORM,
          Origin: POLICIA_BASE,
          Cookie: cookiesToHeader(cookies),
        },
      },
    );

    const html4 =
      typeof r4.data === "string" ? r4.data : JSON.stringify(r4.data);
    const texto = html4
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

    console.log("Status:", r4.status);
    console.log("Respuesta (600):", texto.substring(0, 600));

    const noRegistra =
      texto.includes("NO REGISTRA") ||
      texto.includes("SIN ANTECEDENTES") ||
      texto.includes("NO PRESENTA");
    const registra =
      texto.includes("REGISTRA ANTECEDENTES") ||
      texto.includes("PRESENTA ANTECEDENTES") ||
      texto.includes("CONDENA");

    // Token inválido/expirado — pedir nuevo captcha
    if (!noRegistra && !registra && texto.includes("CAPTCHA")) {
      return res.status(428).json({
        error: "captcha_invalid",
        mensaje:
          "El token reCAPTCHA expiró o es inválido. Por favor resuélvelo de nuevo.",
        sitekey: "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH",
      });
    }

    const mensaje = noRegistra
      ? "La persona NO registra antecedentes judiciales."
      : registra
        ? "La persona REGISTRA antecedentes judiciales."
        : "Sin resultado claro. Revisa el detalle.";

    console.log(`✅ ${cedula}: ${mensaje}`);

    return res.json({
      fuente: "Policía Nacional de Colombia",
      status: noRegistra || registra ? "success" : "sin_resultado",
      cedula,
      tipoDocumento,
      tieneAntecedentes: registra && !noRegistra,
      mensaje,
      detalle: texto.substring(0, 800),
    });
  } catch (error) {
    console.error("❌ ERROR:", error.message);
    return res.status(502).json({
      error: "Error en consulta Policía Nacional",
      detalle: error.message,
    });
  }
};
