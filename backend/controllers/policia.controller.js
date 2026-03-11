/**
 * policia.controller.js  (versión mejorada)
 *
 * Flujo:
 * 1. POST /api/consulta-antecedentes → inicia Puppeteer, llena form, intenta captcha solo
 *    - Si resuelve solo → devuelve resultado directo
 *    - Si necesita challenge → guarda sesión, devuelve { sessionId, captchaImageBase64 }
 *
 * 2. POST /api/resolver-captcha { sessionId, token } → inyecta token, envía form, devuelve resultado
 *
 * FIXES aplicados:
 *  - Manejo correcto del 302 que devuelve antecedentes.xhtml (JSF redirect)
 *  - Espera explícita del ViewState antes de hacer submit
 *  - Inyección de token reCAPTCHA más robusta (textarea + eventos + callback)
 *  - Selector de submit mejorado con fallback a evaluación directa del form JSF
 *  - Detección de resultado ampliada para más patrones de respuesta
 *  - Logs más descriptivos para facilitar debugging
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const POLICIA_BASE = "https://antecedentes.policia.gov.co:7005";
const POLICIA_URL = `${POLICIA_BASE}/WebJudicial/index.xhtml`;
const POLICIA_FORM = `${POLICIA_BASE}/WebJudicial/antecedentes.xhtml`;
const RECAPTCHA_SITE_KEY = "6LcsIwQaAAAAAFCsaI-dkR6hgKsZwwJRsmE0tIJH";

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

// Sesiones activas en memoria: sessionId → { browser, page, cedula, tipoDocumento, createdAt }
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

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

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

/** Busca el primer elemento que coincida con alguno de los selectores */
async function buscar(page, selectores) {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

/** Interpreta el texto de la página para determinar si hay o no antecedentes */
function extraerResultado(texto) {
  const upper = texto.toUpperCase();
  const noRegistra =
    upper.includes("NO REGISTRA") ||
    upper.includes("SIN ANTECEDENTES") ||
    upper.includes("NO PRESENTA") ||
    upper.includes("NO SE ENCONTRARON") ||
    upper.includes("NO TIENE ANTECEDENTES");
  const registra =
    upper.includes("REGISTRA ANTECEDENTES") ||
    upper.includes("PRESENTA ANTECEDENTES") ||
    upper.includes("CONDENA") ||
    upper.includes("TIENE ANTECEDENTES");
  return { noRegistra, registra };
}

/** Construye la respuesta JSON final */
function buildRespuesta(cedula, tipoDocumento, texto) {
  const upper = texto.toUpperCase();
  const { noRegistra, registra } = extraerResultado(upper);

  // Detectar si el captcha fue rechazado
  const captchaRechazado =
    !noRegistra &&
    !registra &&
    (upper.includes("CAPTCHA") ||
      upper.includes("DEBE SELECCIONAR") ||
      upper.includes("VERIFICACIÓN"));

  if (captchaRechazado) {
    throw new Error("reCAPTCHA rechazado o inválido. Intenta de nuevo.");
  }

  return {
    fuente: "Policía Nacional de Colombia",
    status: noRegistra || registra ? "success" : "sin_resultado",
    cedula,
    tipoDocumento,
    tieneAntecedentes: registra && !noRegistra,
    mensaje: noRegistra
      ? "La persona NO registra antecedentes judiciales."
      : registra
        ? "La persona REGISTRA antecedentes judiciales."
        : "Sin resultado claro. Revisa el detalle.",
    detalle: texto.substring(0, 800),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 1: Navegar hasta el formulario con los datos listos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abre el browser, acepta términos, navega a antecedentes.xhtml
 * y llena tipo de documento + cédula.
 * Retorna la page lista para resolver el captcha.
 */
async function prepararFormulario(browser, cedula, tipoValor) {
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });
  await page.setBypassCSP(true);

  // ── 1. Página de términos ──────────────────────────────────────────────────
  console.log("📄 Cargando términos...");
  await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 30000 });

  await page.click("input[name='aceptaOption'][value='true']");
  await sleep(400);

  console.log("🖱️  Aceptando términos...");
  await Promise.all([
    // El servidor responde 302 → waitForNavigation lo sigue automáticamente
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 }),
    page.click("#continuarBtn"),
  ]);

  console.log("URL tras términos:", page.url());

  // Si por alguna razón no llegamos a antecedentes.xhtml, navegar directo
  if (!page.url().includes("antecedentes")) {
    console.log("⚠️  Navegando directo a antecedentes.xhtml...");
    await page.goto(POLICIA_FORM, {
      waitUntil: "networkidle2",
      timeout: 20000,
    });
  }

  // ── 2. Esperar que el ViewState de JSF esté presente ──────────────────────
  //    Sin ViewState válido el servidor rechaza el POST.
  await page
    .waitForSelector("input[name='javax.faces.ViewState']", { timeout: 10000 })
    .catch(() => console.warn("⚠️  ViewState no encontrado, continuando..."));

  // Debug: listar todos los campos del formulario
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
  console.log("🔍 Campos del formulario:", JSON.stringify(els, null, 2));

  // ── 3. Seleccionar tipo de documento ──────────────────────────────────────
  const selectTipo = await buscar(page, [
    "select[id='formAntecedentes:cedulaTipo']",
    "select[id='cedulaTipo']",
    "select[name*='cedulaTipo']",
    "select",
  ]);

  if (selectTipo) {
    const selId = await page.evaluate(
      (el) => (el.id ? `#${el.id}` : `[name='${el.name}']`),
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
      // Fallback: buscar opción que contenga "ciudadan"
      const op = opciones.find((o) => o.t?.toLowerCase().includes("ciudadan"));
      if (op) await page.select(selId, op.v).catch(() => {});
    });
  }

  // ── 4. Ingresar número de cédula ──────────────────────────────────────────
  const inputCedula = await buscar(page, [
    "input[id='formAntecedentes:cedulaInput']",
    "input[id='cedulaInput']",
    "input[name*='cedulaInput']",
    "input[id*='cedula' i]:not([type='hidden'])",
    "input[name*='cedula' i]:not([type='hidden'])",
  ]);

  if (!inputCedula) throw new Error("No se encontró el campo de cédula.");

  await inputCedula.click({ clickCount: 3 });
  await inputCedula.type(cedula, { delay: 50 });
  console.log(`📝 Cédula ingresada: ${cedula}`);

  return page;
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 2: Intentar resolver reCAPTCHA solo con el checkbox
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna: "resuelto" | "challenge" | "sin_captcha"
 */
async function intentarCaptchaAutomatico(page) {
  console.log("⏳ Esperando iframe reCAPTCHA...");

  const tieneCaptcha = await page
    .waitForSelector("iframe[src*='recaptcha']", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!tieneCaptcha) {
    console.log("⚠️  No hay reCAPTCHA iframe, continuando sin captcha.");
    return "sin_captcha";
  }

  // El anchor frame es el que contiene el checkbox
  const anchorFrame = page
    .frames()
    .find((f) => f.url().includes("recaptcha") && f.url().includes("anchor"));

  if (!anchorFrame) {
    console.warn("⚠️  Anchor frame no encontrado.");
    return "sin_captcha";
  }

  await anchorFrame.waitForSelector("#recaptcha-anchor", { timeout: 8000 });
  await anchorFrame.click("#recaptcha-anchor");
  console.log("🖱️  Click en checkbox reCAPTCHA...");
  await sleep(4000);

  const checked = await anchorFrame
    .evaluate(() =>
      document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked"),
    )
    .catch(() => null);

  console.log("reCAPTCHA aria-checked:", checked);

  if (checked === "true") return "resuelto";
  return "challenge";
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 3: Capturar imagen del challenge (cuando Google pide seleccionar fotos)
// ─────────────────────────────────────────────────────────────────────────────

async function capturarChallenge(page) {
  // Esperar que aparezca el bframe (grilla de imágenes)
  await page
    .waitForSelector("iframe[src*='recaptcha/api2/bframe']", { timeout: 10000 })
    .catch(() => {});
  await sleep(1200);

  const bframeEl = await page.$("iframe[src*='recaptcha/api2/bframe']");
  if (bframeEl) {
    const box = await bframeEl.boundingBox();
    if (box) {
      return page.screenshot({
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
        encoding: "base64",
      });
    }
  }
  // Fallback: screenshot completo del viewport
  return page.screenshot({ encoding: "base64", fullPage: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 4: Enviar el formulario y leer el resultado
// ─────────────────────────────────────────────────────────────────────────────

async function enviarYLeerResultado(page) {
  console.log("🚀 Enviando formulario...");

  // Intentar encontrar el botón de submit con múltiples selectores
  const btnSubmit = await buscar(page, [
    "input[id$='consultarBtn']",
    "button[id$='consultarBtn']",
    "input[id*='consultar' i]",
    "button[id*='consultar' i]",
    "input[value*='Consultar']",
    "button[value*='Consultar']",
    "input[type='submit']",
    "button[type='submit']",
  ]);

  if (btnSubmit) {
    console.log("🔘 Botón submit encontrado, haciendo click...");
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
        .catch(() => {}),
      btnSubmit.click(),
    ]);
  } else {
    // Fallback: submit directo del form JSF por JS
    console.log("⚠️  Botón no encontrado, haciendo submit directo del form...");
    await page.evaluate(() => {
      const form =
        document.querySelector("form[id*='formAntecedentes']") ||
        document.querySelector("form");
      if (form) form.submit();
    });
    await page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
      .catch(() => {});
  }

  // Esperar un poco extra para que JSF procese el 302 y cargue el resultado
  await sleep(2500);

  const contenido = await page.evaluate(() => document.body.innerText || "");
  const texto = contenido.replace(/\s+/g, " ").trim().toUpperCase();
  console.log("📄 Respuesta (primeros 600 chars):", texto.substring(0, 600));
  return texto;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER 1: Iniciar consulta
// POST /api/consulta-antecedentes
// Body: { cedula: string, tipoDocumento?: string }
// ─────────────────────────────────────────────────────────────────────────────

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "cc" } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const tipoValor = TIPO_MAP[tipoDocumento] || "cc";
  console.log(`\n${"─".repeat(60)}`);
  console.log(`🔍 Consultando: ${cedula} (${tipoValor})`);
  console.log(`${"─".repeat(60)}`);

  let browser;
  try {
    browser = await lanzarBrowser();
    const page = await prepararFormulario(browser, cedula, tipoValor);
    const estadoCaptcha = await intentarCaptchaAutomatico(page);

    if (estadoCaptcha === "resuelto" || estadoCaptcha === "sin_captcha") {
      // ✅ Captcha OK → enviar y devolver resultado
      const texto = await enviarYLeerResultado(page);
      await browser.close().catch(() => {});
      return res.json(buildRespuesta(cedula, tipoDocumento, texto));
    }

    // ⚠️ Google exige challenge visual → capturar y guardar sesión
    console.log("🖼️  Challenge detectado, capturando imagen...");
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

    return res.status(202).json({
      requiereCaptcha: true,
      sessionId,
      captchaImageBase64: `data:image/png;base64,${imageBase64}`,
      siteKey: RECAPTCHA_SITE_KEY,
      mensaje:
        "Se requiere resolver el captcha manualmente. Envía el token a /api/resolver-captcha.",
    });
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error("❌ ERROR consultarAntecedentes:", error.message);
    return res.status(502).json({
      error: "Error en consulta Policía Nacional",
      detalle: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER 2: Recibir token resuelto e inyectarlo
// POST /api/resolver-captcha
// Body: { sessionId: string, token: string }
// ─────────────────────────────────────────────────────────────────────────────

exports.resolverCaptcha = async (req, res) => {
  const { sessionId, token } = req.body;
  if (!sessionId || !token)
    return res.status(400).json({ error: "sessionId y token son requeridos." });

  const sesion = sesiones.get(sessionId);
  if (!sesion)
    return res.status(404).json({ error: "Sesión no encontrada o expirada." });

  const { browser, page, cedula, tipoDocumento } = sesion;
  sesiones.delete(sessionId); // Consumir la sesión inmediatamente

  try {
    console.log(`🔑 Inyectando token en sesión ${sessionId}...`);

    /**
     * FIX CLAVE: La inyección del token necesita:
     *   1. Escribir en el textarea oculto de reCAPTCHA
     *   2. Disparar los eventos 'input' y 'change' para que JSF / React lo detecte
     *   3. Intentar llamar el callback interno de grecaptcha si existe
     */
    await page.evaluate((tkn) => {
      // 1. Textarea estándar de reCAPTCHA
      const selectores = [
        "textarea[name='g-recaptcha-response']",
        "#g-recaptcha-response",
        "textarea[id*='captcha']",
        "textarea[name*='captcha']",
      ];

      for (const sel of selectores) {
        const el = document.querySelector(sel);
        if (el) {
          el.style.display = "block"; // Hacerlo visible para que JSF lo tome
          el.value = tkn;
          // Disparar eventos para que frameworks detecten el cambio
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      // 2. Intentar disparar el callback de grecaptcha directamente
      try {
        const cfg = window.___grecaptcha_cfg;
        if (cfg && cfg.clients) {
          // Iterar todos los clientes registrados
          for (const clientKey of Object.keys(cfg.clients)) {
            const client = cfg.clients[clientKey];
            // Buscar recursivamente una función "callback"
            const findAndCall = (obj, depth = 0) => {
              if (depth > 4 || !obj || typeof obj !== "object") return;
              for (const key of Object.keys(obj)) {
                if (key === "callback" && typeof obj[key] === "function") {
                  try {
                    obj[key](tkn);
                  } catch (_) {}
                } else {
                  findAndCall(obj[key], depth + 1);
                }
              }
            };
            findAndCall(client);
          }
        }
      } catch (_) {}
    }, token);

    await sleep(1000);

    const texto = await enviarYLeerResultado(page);
    await browser.close().catch(() => {});
    return res.json(buildRespuesta(cedula, tipoDocumento, texto));
  } catch (error) {
    await browser.close().catch(() => {});
    console.error("❌ ERROR resolverCaptcha:", error.message);
    return res.status(502).json({
      error: "Error al procesar el captcha",
      detalle: error.message,
    });
  }
};
