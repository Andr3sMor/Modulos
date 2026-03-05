/**
 * policia.controller.js
 * Bypass reCAPTCHA v2 replicando el flujo exacto del browser:
 * anchor → userverify → POST a la Policía
 */

const axios = require("axios");
const https = require("https");

const POLICIA_BASE = "https://antecedentes.policia.gov.co:7005";
const POLICIA_URL = `${POLICIA_BASE}/WebJudicial/index.xhtml`;
const POLICIA_FORM = `${POLICIA_BASE}/WebJudicial/antecedentes.xhtml`;
const RECAPTCHA_SITEKEY = "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH";

// co = base64url("https://antecedentes.policia.gov.co:7005")
const RECAPTCHA_CO = Buffer.from("https://antecedentes.policia.gov.co:7005")
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=/g, ".");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Connection: "keep-alive",
};

const GOOGLE_HEADERS = {
  "User-Agent": BASE_HEADERS["User-Agent"],
  "Accept-Language": "es-CO,es;q=0.9",
  Origin: "https://www.google.com",
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

// ── Paso 1: Obtener versión v del script reCAPTCHA ────────────────────────────
async function obtenerVersion() {
  try {
    const r = await axios.get(
      `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITEKEY}`,
      { headers: GOOGLE_HEADERS, timeout: 10000 },
    );
    const m = r.data.match(/po\.src='([^']+)'/);
    if (m) {
      const v = m[1].match(/releases\/([^/]+)\//)?.[1];
      if (v) {
        console.log("📦 Versión reCAPTCHA:", v);
        return v;
      }
    }
  } catch (e) {
    console.log("⚠️  No se pudo obtener versión, usando fallback");
  }
  return "QvLuXwupqtKMva7GIh5eGl3U"; // versión real del network capture
}

// ── Paso 2: GET anchor → obtener token c ─────────────────────────────────────
async function obtenerTokenAnchor(v) {
  const url = `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITEKEY}&co=${RECAPTCHA_CO}&hl=es&v=${v}&size=normal&cb=${Math.random().toString(36).slice(2, 10)}`;

  console.log("🔑 Solicitando anchor...");
  const r = await axios.get(url, {
    headers: {
      ...GOOGLE_HEADERS,
      Accept: "text/html,application/xhtml+xml",
      Referer: POLICIA_FORM,
    },
    timeout: 15000,
  });

  const m = r.data.match(/recaptcha-token[^>]+value="([^"]+)"/);
  if (!m) {
    console.log("Anchor HTML (200):", r.data.substring(0, 200));
    throw new Error("No se encontró recaptcha-token en anchor.");
  }
  console.log("✅ Token anchor obtenido.");
  return m[1];
}

// ── Paso 3: POST userverify → obtener g-recaptcha-response ───────────────────
async function obtenerTokenFinal(c, v) {
  const url = `https://www.google.com/recaptcha/api2/reload?k=${RECAPTCHA_SITEKEY}`;

  const body = new URLSearchParams({
    v: v,
    reason: "q",
    k: RECAPTCHA_SITEKEY,
    c: c,
    sa: "",
    co: RECAPTCHA_CO,
    hl: "es",
    size: "normal",
    chr: "%5B89%2C64%2C27%5D",
    vh: "13599012192",
    bg: "!a22gbWgKAAQVGC0wbQEHewAQJmYnS9txUfPbVSaRL3csAw8CyLz7nwx6l6SYZonxsU1uGAJa16QHFjVdloSIkbk6cdKGNubS5qlJmhnzreCTV8IeOLLq5OI_OA1MfdVd7O9H1irVCKWkXO5x5cRVJ7CSiQPI63CWw3mEzC402XFOpofz9l18rK8OaFrK-lwoe5tlkfG5Jr3vfJ2BNl1kdytofzkUhToEqOEVs8XmXwfxiPSGBqZmHKTXyAyAzEX5TfEARUmyXIUMy_NytrbnsybcDuYEzJmG964hlVs_PZljGlTLn3XmeI5tzWMP5Y3LKGvSMvx_EX72krB2e2yOXftI69tNE2Q4xQosqI4tQRgQ7mOJf0Gq53mO7bcGqWQd3HXbdGFZPexHjpnWGV3izJneADqSDx2H3qZhSM7TDLMKD1pItsU8F7RkbMPUAOEBEBKsXt2rTGiqZz2qU3eqY4eJwoWmY4h35DaTxxG0n9_aTlbrz-f35FBkJN0GJrTSnjXwCuBPIT8mMdVxfi0LnQo46gfNcnLWopUc58L9P1W68mkLqpg4ZchS3H2G-RELWpGjoQMgT0YzYZLQH9TMmIdUQn6y68_1d8rWXJc-d5BnT453k-wx7lt2ftCCdvC0MEzTjiWpyBh8V6UeoshzN7psyKy5O_WSRCX9Q6zSpJrMJSSpq08fZ04ZTgr-81Cp1Jt-RtSYVXsf6Q_qIONi653eYKwvdjAEE5DANaH-40ng9GbXKjWYB8QCiofMLU8yD-ktcnog5TYzEdmEgAYehWC6BC_7Lw8ladNsY_wJxDDPQl86MhXM0xfpOm-LjYLgg_fww7Wl6WKH1iZK2YisTQYUYezkpzCWjpE5Zar7vUVHg5KUSeMlPtMCAoefRuKP_Yy35Y_1xmAGa35kwg7tL1WUML4aVxW4M7zWCbakYE80m9zEmTb-Rd_uAQikGtwW3o9ayvPM9fZ0cKWemEY7jxxUnibXUpaokEpw2tmcAB_j8NlnPyDZVaoFUBQzVEsOtt0CpzOplIk5fQ0a0ST7",
  });

  console.log("🔄 Enviando reload a Google...");
  const r = await axios.post(url, body.toString(), {
    headers: {
      ...GOOGLE_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `https://www.google.com/recaptcha/api2/anchor?ar=1&k=${RECAPTCHA_SITEKEY}&co=${RECAPTCHA_CO}&hl=es&v=${v}&size=normal`,
    },
    timeout: 15000,
  });

  console.log("reload status:", r.status);
  console.log("reload respuesta (200):", String(r.data).substring(0, 200));

  // Respuesta: )]}'\n["rresp","TOKEN",...]
  const raw = String(r.data).replace(/^\)\]\}'\n/, "");
  const m = raw.match(/"rresp","([^"]+)"/);
  if (m) {
    console.log("✅ Token reCAPTCHA obtenido:", m[1].substring(0, 30) + "...");
    return m[1];
  }

  // Intentar parsear como array
  try {
    const arr = JSON.parse(raw);
    const token = Array.isArray(arr)
      ? arr.flat(5).find((x) => typeof x === "string" && x.length > 50)
      : null;
    if (token) {
      console.log("✅ Token (array):", token.substring(0, 30) + "...");
      return token;
    }
  } catch {}

  throw new Error(
    `reload no devolvió token. Respuesta: ${String(r.data).substring(0, 300)}`,
  );
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
    // ── PASO 1: GET términos ───────────────────────────────────────────
    console.log("📄 Obteniendo página de términos...");
    const r1 = await axios.get(POLICIA_URL, {
      httpsAgent,
      headers: { ...BASE_HEADERS, Accept: "text/html" },
    });
    cookies = parseCookies(cookies, r1.headers["set-cookie"]);
    const campos1 = extraerCamposOcultos(r1.data);
    if (!campos1["javax.faces.ViewState"])
      throw new Error("Sin ViewState en términos.");

    // ── PASO 2: POST aceptar términos ──────────────────────────────────
    console.log("✅ Aceptando términos...");
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

    // ── PASO 3: GET formulario ─────────────────────────────────────────
    console.log("📋 Obteniendo formulario...");
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

    // ── PASO 4: Obtener token reCAPTCHA ────────────────────────────────
    const v = await obtenerVersion();
    const tokenAnchor = await obtenerTokenAnchor(v);
    const tokenCaptcha = await obtenerTokenFinal(tokenAnchor, v);

    // ── PASO 5: POST consulta ──────────────────────────────────────────
    console.log(`🔍 Enviando consulta: ${tipoValor} ${cedula}`);
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

    const html4 =
      typeof r4.data === "string" ? r4.data : JSON.stringify(r4.data);
    const texto = html4
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

    console.log("Status consulta:", r4.status);
    console.log("Respuesta (600):", texto.substring(0, 600));

    // ── PASO 6: Parsear resultado ──────────────────────────────────────
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
    return res
      .status(502)
      .json({
        error: "Error en consulta Policía Nacional",
        detalle: error.message,
      });
  }
};
