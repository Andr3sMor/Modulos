/**
 * policia.controller.js
 * Acepta términos automáticamente y consulta antecedentes sin reCAPTCHA
 */

const axios = require("axios");
const https = require("https");

const POLICIA_BASE = "https://antecedentes.policia.gov.co:7005";
const POLICIA_URL = `${POLICIA_BASE}/WebJudicial/index.xhtml`;
const POLICIA_FORM = `${POLICIA_BASE}/WebJudicial/antecedentes.xhtml`;

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

function htmlContieneFormulario(html) {
  return (
    html.includes("cedulaTipo") ||
    html.includes("cedulaInput") ||
    html.includes("formAntecedentes")
  );
}

async function aceptarTerminos(cookies) {
  const r1 = await axios.get(POLICIA_URL, {
    httpsAgent,
    headers: { ...BASE_HEADERS, Cookie: cookiesToHeader(cookies) },
    timeout: 15000,
  });
  cookies = parseCookies(cookies, r1.headers["set-cookie"]);
  const campos1 = extraerCamposOcultos(r1.data);
  if (!campos1["javax.faces.ViewState"])
    throw new Error("Sin ViewState en términos.");

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
      timeout: 15000,
    },
  );
  cookies = parseCookies(cookies, r2.headers["set-cookie"]);
  return cookies;
}

// ── Controller principal ──────────────────────────────────────────────────────
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
    let campos;

    // ── INTENTO 1: acceso directo al formulario ──
    console.log("⚡ Intentando acceso directo al formulario...");
    const rDirect = await axios.get(POLICIA_FORM, {
      httpsAgent,
      headers: { ...BASE_HEADERS },
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
      timeout: 15000,
    });
    cookies = parseCookies(cookies, rDirect.headers["set-cookie"]);

    if (htmlContieneFormulario(rDirect.data)) {
      console.log("✅ Acceso directo exitoso.");
      campos = extraerCamposOcultos(rDirect.data);
    } else {
      // ── INTENTO 2: aceptar términos y reintentar ──
      console.log("🔄 Aceptando términos automáticamente...");
      cookies = await aceptarTerminos(cookies);

      const r2 = await axios.get(POLICIA_FORM, {
        httpsAgent,
        headers: {
          ...BASE_HEADERS,
          Referer: POLICIA_URL,
          Cookie: cookiesToHeader(cookies),
        },
        timeout: 15000,
      });
      cookies = parseCookies(cookies, r2.headers["set-cookie"]);

      if (!htmlContieneFormulario(r2.data)) {
        throw new Error(
          "No se pudo acceder al formulario tras aceptar términos.",
        );
      }
      campos = extraerCamposOcultos(r2.data);
    }

    if (!campos["javax.faces.ViewState"])
      throw new Error("Sin ViewState en formulario.");

    // ── POST consulta (sin reCAPTCHA) ────────────────────────────────
    console.log(`🔍 Enviando consulta: ${tipoValor} ${cedula}`);
    const rConsulta = await axios.post(
      POLICIA_FORM,
      new URLSearchParams({
        ...campos,
        formAntecedentes: "formAntecedentes",
        cedulaTipo: tipoValor,
        cedulaInput: cedula,
        "g-recaptcha-response": "",
        captchaAntecedentes_response: "",
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
        timeout: 20000,
      },
    );

    const texto = (
      typeof rConsulta.data === "string"
        ? rConsulta.data
        : JSON.stringify(rConsulta.data)
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

    console.log("Respuesta (600):", texto.substring(0, 600));

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
