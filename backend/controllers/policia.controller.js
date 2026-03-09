/**
 * policia.controller.js
 *
 * Flujo:
 * 1. POST /api/consulta-antecedentes → inicia Puppeteer, llena form, intenta captcha solo
 *    - Si resuelve solo → devuelve resultado directo
 *    - Si necesita challenge → guarda sesión, devuelve { sessionId, captchaImageBase64 }
 *
 * 2. POST /api/resolver-captcha { sessionId, token } → inyecta token, envía form, devuelve resultado
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const POLICIA_BASE = "https://antecedentes.policia.gov.co:7005";
const POLICIA_URL = `${POLICIA_BASE}/WebJudicial/index.xhtml`;
const POLICIA_FORM = `${POLICIA_BASE}/WebJudicial/antecedentes.xhtml`;

const TIPO_MAP = {
  "Cédula de Ciudadanía": "cc",
  "Cédula de Extranjería": "cx",
  Pasaporte: "pa",
  "Documento País Origen": "dp",
  cc: "cc",
  cx: "cx",
  pa: "pa",
  dp: "dp",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sesiones activas en memoria: sessionId → { browser, page, cedula, tipoDocumento }
const sesiones = new Map();

// Limpiar sesiones viejas (más de 10 min) cada 5 minutos
setInterval(
  () => {
    const ahora = Date.now();
    for (const [id, ses] of sesiones.entries()) {
      if (ahora - ses.createdAt > 10 * 60 * 1000) {
        ses.browser.close().catch(() => {});
        sesiones.delete(id);
        console.log(`🗑️  Sesión expirada eliminada: ${id}`);
      }
    }
  },
  5 * 60 * 1000,
);

async function lanzarBrowser() {
  if (!process.env.RENDER) {
    const puppeteerFull = require("puppeteer");
    return puppeteerFull.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--ignore-certificate-errors",
      ],
    });
  }
  return puppeteer.launch({
    args: [
      ...chromium.args,
      "--ignore-certificate-errors",
      "--disable-web-security",
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}

async function buscar(page, selectores) {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

function extraerResultado(texto) {
  const noRegistra =
    texto.includes("NO REGISTRA") ||
    texto.includes("SIN ANTECEDENTES") ||
    texto.includes("NO PRESENTA");
  const registra =
    texto.includes("REGISTRA ANTECEDENTES") ||
    texto.includes("PRESENTA ANTECEDENTES") ||
    texto.includes("CONDENA");
  return { noRegistra, registra };
}

/** Llega al formulario con el campo de cédula listo, devuelve la page */
async function prepararFormulario(browser, cedula, tipoValor) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });
  await page.setBypassCSP(true);

  // Términos
  console.log("📄 Cargando términos...");
  await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 30000 });

  // Seleccionar radio "Acepto"
  await page.click("input[name='aceptaOption'][value='true']");
  await sleep(400);

  // Continuar → esperar navegación a antecedentes.xhtml
  console.log("🖱️  Aceptando términos...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 }),
    page.click("#continuarBtn"),
  ]);

  console.log("URL tras términos:", page.url());

  if (!page.url().includes("antecedentes")) {
    await page.goto(POLICIA_FORM, {
      waitUntil: "networkidle2",
      timeout: 20000,
    });
  }

  // Log elementos para debug
  const els = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll("input, select, textarea, button"),
    ).map((el) => ({
      tag: el.tagName,
      id: el.id,
      name: el.name,
      type: el.type,
      value: (el.value || "").substring(0, 40),
    })),
  );
  console.log("🔍 Elementos formulario:", JSON.stringify(els));

  // Seleccionar tipo doc
  const selectTipo = await buscar(page, [
    "select[id='formAntecedentes:cedulaTipo']",
    "select[id='cedulaTipo']",
    "select[name*='cedulaTipo']",
    "select",
  ]);
  if (selectTipo) {
    const selId = await page.evaluate(
      (el) => (el.id ? `[id='${el.id}']` : `[name='${el.name}']`),
      selectTipo,
    );
    const opciones = await page.evaluate((s) => {
      const el = document.querySelector(s);
      return el
        ? Array.from(el.options).map((o) => ({ v: o.value, t: o.text }))
        : [];
    }, selId);
    console.log("Opciones tipo doc:", JSON.stringify(opciones));
    await page.select(selId, tipoValor).catch(async () => {
      const op = opciones.find((o) => o.t?.toLowerCase().includes("ciudadan"));
      if (op) await page.select(selId, op.v).catch(() => {});
    });
  }

  // Ingresar cédula
  const inputCedula = await buscar(page, [
    "input[id='formAntecedentes:cedulaInput']",
    "input[id='cedulaInput']",
    "input[name*='cedulaInput']",
    "input[id*='cedula' i]:not([type='hidden'])",
    "input[name*='cedula' i]:not([type='hidden'])",
  ]);
  if (!inputCedula) throw new Error("No se encontró campo de cédula.");
  await inputCedula.click({ clickCount: 3 });
  await inputCedula.type(cedula, { delay: 50 });
  console.log(`📝 Cédula ingresada: ${cedula}`);

  return page;
}

/** Intenta resolver el captcha con solo el checkbox.
 *  Devuelve: "resuelto" | "challenge" | "sin_captcha" */
async function intentarCaptchaAutomatico(page) {
  console.log("⏳ Esperando reCAPTCHA...");
  const tieneCaptcha = await page
    .waitForSelector("iframe[src*='recaptcha']", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!tieneCaptcha) {
    console.log("⚠️ No hay iframe de reCAPTCHA, continuando sin captcha.");
    return "sin_captcha";
  }

  const anchorFrame = page
    .frames()
    .find((f) => f.url().includes("recaptcha") && f.url().includes("anchor"));
  if (!anchorFrame) return "sin_captcha";

  await anchorFrame.waitForSelector("#recaptcha-anchor", { timeout: 8000 });
  await anchorFrame.click("#recaptcha-anchor");
  console.log("🖱️ Click checkbox reCAPTCHA...");
  await sleep(4000);

  const checked = await anchorFrame.evaluate(() =>
    document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked"),
  );
  console.log("reCAPTCHA checked:", checked);

  if (checked === "true") return "resuelto";
  return "challenge";
}

/** Toma screenshot solo del iframe del captcha challenge */
async function capturarChallenge(page) {
  // Esperar a que aparezca el bframe (el challenge de imágenes)
  await page
    .waitForSelector("iframe[src*='recaptcha/api2/bframe']", { timeout: 10000 })
    .catch(() => {});
  await sleep(1000);

  // Buscar el iframe del challenge
  const bframeEl = await page.$("iframe[src*='recaptcha/api2/bframe']");
  if (bframeEl) {
    const box = await bframeEl.boundingBox();
    if (box) {
      const screenshot = await page.screenshot({
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
        encoding: "base64",
      });
      return screenshot;
    }
  }
  // Fallback: screenshot completo
  return await page.screenshot({ encoding: "base64", fullPage: false });
}

/** Envía el formulario y lee el resultado */
async function enviarYLeerResultado(page) {
  console.log("🚀 Enviando formulario...");
  const btnSubmit = await buscar(page, [
    "input[id$='consultarBtn']",
    "button[id$='consultarBtn']",
    "input[value*='Consultar']",
    "button[value*='Consultar']",
    "input[type='submit']",
    "button[type='submit']",
  ]);

  if (btnSubmit) {
    await btnSubmit.click();
  } else {
    await page.evaluate(() => {
      const form =
        document.querySelector("form[id*='formAntecedentes']") ||
        document.querySelector("form");
      if (form) form.submit();
    });
  }

  await page
    .waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 })
    .catch(() => {});
  await sleep(2000);

  const contenido = await page.evaluate(() => document.body.innerText || "");
  const texto = contenido.replace(/\s+/g, " ").trim().toUpperCase();
  console.log("Respuesta (600):", texto.substring(0, 600));
  return texto;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 1: Iniciar consulta
// ══════════════════════════════════════════════════════════════════════════════
exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "cc" } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const tipoValor = TIPO_MAP[tipoDocumento] || "cc";
  console.log(`--- Consultando: ${cedula} ---`);

  let browser;
  try {
    browser = await lanzarBrowser();
    const page = await prepararFormulario(browser, cedula, tipoValor);

    const estadoCaptcha = await intentarCaptchaAutomatico(page);

    if (estadoCaptcha === "resuelto" || estadoCaptcha === "sin_captcha") {
      // ✅ Captcha resuelto solo → enviar y devolver resultado
      const texto = await enviarYLeerResultado(page);
      await browser.close().catch(() => {});

      const { noRegistra, registra } = extraerResultado(texto);
      const captchaRechazado =
        !noRegistra &&
        !registra &&
        (texto.includes("CAPTCHA") || texto.includes("DEBE SELECCIONAR"));
      if (captchaRechazado)
        throw new Error("reCAPTCHA rechazado. Intenta de nuevo.");

      return res.json({
        fuente: "Policía Nacional de Colombia",
        status: noRegistra || registra ? "success" : "sin_resultado",
        cedula,
        tipoDocumento,
        tieneAntecedentes: registra && !noRegistra,
        mensaje: noRegistra
          ? "La persona NO registra antecedentes judiciales."
          : registra
            ? "La persona REGISTRA antecedentes judiciales."
            : "Sin resultado claro.",
        detalle: texto.substring(0, 800),
      });
    }

    // ⚠️ Google exige challenge → capturar imagen y guardar sesión
    console.log("🖼️ Challenge requerido, capturando imagen...");
    const imageBase64 = await capturarChallenge(page);

    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sesiones.set(sessionId, {
      browser,
      page,
      cedula,
      tipoDocumento,
      createdAt: Date.now(),
    });
    console.log(`💾 Sesión guardada: ${sessionId}`);

    // Responder con la imagen del challenge para que el usuario la resuelva
    return res.status(202).json({
      requiereCaptcha: true,
      sessionId,
      captchaImageBase64: `data:image/png;base64,${imageBase64}`,
      siteKey: "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH",
      mensaje: "Se requiere resolver el captcha manualmente.",
    });
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error("❌ ERROR:", error.message);
    return res.status(502).json({
      error: "Error en consulta Policía Nacional",
      detalle: error.message,
    });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 2: Recibir token resuelto por el usuario e inyectarlo
// ══════════════════════════════════════════════════════════════════════════════
exports.resolverCaptcha = async (req, res) => {
  const { sessionId, token } = req.body;
  if (!sessionId || !token)
    return res.status(400).json({ error: "sessionId y token son requeridos." });

  const sesion = sesiones.get(sessionId);
  if (!sesion)
    return res.status(404).json({ error: "Sesión no encontrada o expirada." });

  const { browser, page, cedula, tipoDocumento } = sesion;
  sesiones.delete(sessionId);

  try {
    console.log(`🔑 Inyectando token en sesión ${sessionId}...`);

    // Inyectar el token en el textarea oculto de reCAPTCHA
    await page.evaluate((tkn) => {
      // Textarea principal
      const ta =
        document.querySelector("textarea[name='g-recaptcha-response']") ||
        document.querySelector("#g-recaptcha-response");
      if (ta) {
        ta.style.display = "block";
        ta.value = tkn;
      }
      // Algunos sitios usan también este campo
      const ta2 = document.querySelector("textarea[id*='captcha']");
      if (ta2) ta2.value = tkn;

      // Disparar callback de reCAPTCHA si existe
      if (window.grecaptcha) {
        try {
          window.___grecaptcha_cfg?.clients?.[0]?.aa?.callback?.(tkn);
        } catch (_) {}
      }
    }, token);

    await sleep(800);

    const texto = await enviarYLeerResultado(page);
    await browser.close().catch(() => {});

    const { noRegistra, registra } = extraerResultado(texto);
    const captchaRechazado =
      !noRegistra &&
      !registra &&
      (texto.includes("CAPTCHA") || texto.includes("DEBE SELECCIONAR"));
    if (captchaRechazado)
      throw new Error("El token fue rechazado. Intenta de nuevo.");

    return res.json({
      fuente: "Policía Nacional de Colombia",
      status: noRegistra || registra ? "success" : "sin_resultado",
      cedula,
      tipoDocumento,
      tieneAntecedentes: registra && !noRegistra,
      mensaje: noRegistra
        ? "La persona NO registra antecedentes judiciales."
        : registra
          ? "La persona REGISTRA antecedentes judiciales."
          : "Sin resultado claro.",
      detalle: texto.substring(0, 800),
    });
  } catch (error) {
    await browser.close().catch(() => {});
    console.error("❌ ERROR resolverCaptcha:", error.message);
    return res.status(502).json({
      error: "Error al procesar el captcha",
      detalle: error.message,
    });
  }
};
