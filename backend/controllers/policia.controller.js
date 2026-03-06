const axios = require("axios");
const https = require("https");

const SCRAPE_TOKEN = process.env.SCRAPE_TOKEN;
const POLICIA_BASE = "https://antecedentes.policia.gov.co:7005";
const POLICIA_URL = `${POLICIA_BASE}/WebJudicial/index.xhtml`;
const POLICIA_FORM = `${POLICIA_BASE}/WebJudicial/antecedentes.xhtml`;
const RECAPTCHA_SITEKEY = "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH";

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
      const value = tag.match(/value=["']([^"']*)/i)?.[1] ?? "";
      if (name) campos[name] = value;
    },
  );
  return campos;
}

async function obtenerVersionRecaptcha() {
  try {
    const r = await axios.get("https://www.google.com/recaptcha/api.js", {
      headers: { "User-Agent": BASE_HEADERS["User-Agent"] },
    });
    const match = r.data.match(/releases\/([^/]+)\//);
    return match ? match[1] : "v2-53e66d3d589f5";
  } catch {
    return "v2-53e66d3d589f5";
  }
}

async function obtenerTokenAnchor(version) {
  const co = Buffer.from(POLICIA_BASE + ":7005")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, ".");

  const anchorUrl = `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITEKEY}&co=${co}&hl=es&v=${version}&size=normal&cb=${Math.random().toString(36).substring(2)}`;

  const r = await axios.get(anchorUrl, {
    headers: { ...BASE_HEADERS, Referer: POLICIA_FORM },
  });

  const tokenMatch = r.data.match(/recaptcha-token[^>]+value="([^"]+)"/);
  if (!tokenMatch) throw new Error("No se encontró recaptcha-token en anchor.");
  return tokenMatch[1];
}

async function obtenerTokenFinal(tokenAnchor, version) {
  const co = Buffer.from(POLICIA_BASE + ":7005")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, ".");

  const reloadUrl = `https://www.google.com/recaptcha/api2/reload?k=${RECAPTCHA_SITEKEY}`;

  const body = new URLSearchParams({
    v: version,
    reason: "q",
    k: RECAPTCHA_SITEKEY,
    c: tokenAnchor,
    sa: "",
    co,
    hl: "es",
    size: "normal",
    chr: "%5B89%2C64%2C27%5D",
    vh: "13599012192",
    bg: "!GEpWGq0mlTHGqO8GxWd6T3JASMAAAAAPQAAAABMHG8aAAASdwAAABkBmgSLNuTzPbICXFBTNSdAA",
  });

  const r = await axios.post(reloadUrl, body.toString(), {
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `https://www.google.com/recaptcha/api2/anchor?k=${RECAPTCHA_SITEKEY}`,
      Origin: "https://www.google.com",
    },
  });

  const match = r.data.match(/"rresp","([^"]+)"/);
  if (!match) throw new Error("No se encontró rresp en Google reload.");
  return match[1];
}

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "cc" } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

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

  console.log(`--- Consultando antecedentes para: ${cedula} ---`);
  let cookies = {};

  try {
    // PASO 1: GET términos
    const r1 = await axios.get(POLICIA_URL, {
      httpsAgent,
      headers: BASE_HEADERS,
    });
    cookies = parseCookies(cookies, r1.headers["set-cookie"]);
    const campos1 = extraerCamposOcultos(r1.data);
    if (!campos1["javax.faces.ViewState"])
      throw new Error("Sin ViewState en términos.");

    // PASO 2: POST aceptar términos
    const body2 = new URLSearchParams({
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
    });

    const r2 = await axios.post(POLICIA_URL, body2.toString(), {
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
    });
    cookies = parseCookies(cookies, r2.headers["set-cookie"]);

    // PASO 3: GET formulario
    const r3 = await axios.get(POLICIA_FORM, {
      httpsAgent,
      headers: {
        ...BASE_HEADERS,
        Referer: POLICIA_URL,
        Cookie: cookiesToHeader(cookies),
      },
    });
    cookies = parseCookies(cookies, r3.headers["set-cookie"]);
    const campos3 = extraerCamposOcultos(r3.data);
    if (!campos3["javax.faces.ViewState"])
      throw new Error("Sin ViewState en formulario.");

    // PASO 4: Token reCAPTCHA
    const version = await obtenerVersionRecaptcha();
    const tokenAnchor = await obtenerTokenAnchor(version);
    const tokenCaptcha = await obtenerTokenFinal(tokenAnchor, version);

    // PASO 5: POST consulta
    const body4 = new URLSearchParams({
      ...campos3,
      formAntecedentes: "formAntecedentes",
      cedulaTipo: tipoValor,
      cedulaInput: cedula,
      "g-recaptcha-response": tokenCaptcha,
      captchaAntecedentes_response: tokenCaptcha,
      j_idt17: "",
    });

    const r4 = await axios.post(POLICIA_FORM, body4.toString(), {
      httpsAgent,
      headers: {
        ...BASE_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: POLICIA_FORM,
        Origin: POLICIA_BASE,
        Cookie: cookiesToHeader(cookies),
      },
    });

    const texto = (
      typeof r4.data === "string" ? r4.data : JSON.stringify(r4.data)
    )
      .replace(/<[^>]+>/g, " ")
      .toUpperCase();

    const noRegistra =
      texto.includes("NO REGISTRA") ||
      texto.includes("SIN ANTECEDENTES") ||
      texto.includes("NO PRESENTA");
    const registra =
      texto.includes("REGISTRA ANTECEDENTES") ||
      texto.includes("PRESENTA ANTECEDENTES") ||
      texto.includes("CONDENA");

    const mensaje = noRegistra
      ? "La persona NO registra antecedentes judiciales."
      : registra
        ? "La persona REGISTRA antecedentes judiciales."
        : "Sin resultado claro. Revisa el detalle.";

    return res.json({
      fuente: "Policía Nacional de Colombia",
      status: noRegistra || registra ? "success" : "sin_resultado",
      cedula,
      tipoDocumento,
      tieneAntecedentes: registra && !noRegistra,
      mensaje,
      detalle: texto.replace(/\s+/g, " ").trim().substring(0, 800),
    });
  } catch (error) {
    console.error("❌ ERROR:", error.message);
    return res.status(502).json({
      error: "Error en consulta Policía Nacional",
      detalle: error.message,
    });
  }
};
