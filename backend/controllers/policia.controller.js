/**
 * policia.controller.js
 *
 * Flujo:
 *  1. Puppeteer abre policia.gov.co (headless:false pero ventana fuera de pantalla)
 *  2. Llena el formulario automáticamente
 *  3. Intenta resolver reCAPTCHA solo con el checkbox
 *     ✅ Pasó solo  → envía form directamente, el usuario no ve nada
 *     ❌ Necesita challenge → abre ventana VISIBLE y compacta al usuario
 *        → Banner: "Haz clic en No soy un robot, la ventana se cerrará sola"
 *        → Puppeteer detecta el token en el DOM (polling + callback)
 *        → Cierra la ventana automáticamente
 *        → Inyecta token en página principal, envía form, devuelve resultado
 *
 * NOTA PRODUCCIÓN: En servidores sin display (Render, Railway) necesitas Xvfb.
 * En local (Windows/Mac/Linux con escritorio) funciona directo.
 */

const puppeteer = require("puppeteer");

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

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER
// ─────────────────────────────────────────────────────────────────────────────

async function lanzarBrowser() {
  return puppeteer.launch({
    // headless: false siempre — necesario para poder mostrar ventana en challenge.
    // La pestaña principal se mueve fuera de pantalla; el usuario no la ve.
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--ignore-certificate-errors",
      "--window-size=500,620",
      "--window-position=-2000,0", // Inicia fuera de pantalla
    ],
    ignoreHTTPSErrors: true,
    defaultViewport: null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

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

function buildRespuesta(cedula, tipoDocumento, texto) {
  const upper = texto.toUpperCase();
  const { noRegistra, registra } = extraerResultado(upper);

  const captchaRechazado =
    !noRegistra &&
    !registra &&
    (upper.includes("CAPTCHA") ||
      upper.includes("DEBE SELECCIONAR") ||
      upper.includes("VERIFICACIÓN"));

  if (captchaRechazado) {
    throw new Error("reCAPTCHA rechazado. Intenta de nuevo.");
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
// PASO 1: Navegar y llenar el formulario en una page dada
// ─────────────────────────────────────────────────────────────────────────────

async function prepararFormulario(page, cedula, tipoValor) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });
  await page.setBypassCSP(true);

  console.log("📄 Cargando términos...");
  await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 30000 });

  await page.click("input[name='aceptaOption'][value='true']").catch(() => {});
  await sleep(400);

  console.log("🖱️  Aceptando términos...");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 }),
    page.click("#continuarBtn"),
  ]);

  if (!page.url().includes("antecedentes")) {
    await page.goto(POLICIA_FORM, {
      waitUntil: "networkidle2",
      timeout: 20000,
    });
  }

  // Esperar ViewState de JSF
  await page
    .waitForSelector("input[name='javax.faces.ViewState']", { timeout: 10000 })
    .catch(() => console.warn("⚠️  ViewState no encontrado"));

  // Tipo de documento
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
    await page.select(selId, tipoValor).catch(async () => {
      const opciones = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el
          ? Array.from(el.options).map((o) => ({ v: o.value, t: o.text }))
          : [];
      }, selId);
      const op = opciones.find((o) => o.t?.toLowerCase().includes("ciudadan"));
      if (op) await page.select(selId, op.v).catch(() => {});
    });
  }

  // Cédula
  const inputCedula = await buscar(page, [
    "input[id='formAntecedentes:cedulaInput']",
    "input[id='cedulaInput']",
    "input[name*='cedulaInput']",
    "input[id*='cedula' i]:not([type='hidden'])",
  ]);
  if (!inputCedula) throw new Error("No se encontró el campo de cédula.");
  await inputCedula.click({ clickCount: 3 });
  await inputCedula.type(cedula, { delay: 50 });
  console.log(`📝 Cédula ingresada: ${cedula}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 2: Intentar checkbox solo
// ─────────────────────────────────────────────────────────────────────────────

async function intentarCheckboxSolo(page) {
  console.log("⏳ Esperando iframe reCAPTCHA...");

  const tieneCaptcha = await page
    .waitForSelector("iframe[src*='recaptcha']", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!tieneCaptcha) {
    console.log("⚠️  Sin reCAPTCHA, continuando.");
    return "sin_captcha";
  }

  const anchorFrame = page
    .frames()
    .find((f) => f.url().includes("recaptcha") && f.url().includes("anchor"));

  if (!anchorFrame) return "sin_captcha";

  await anchorFrame.waitForSelector("#recaptcha-anchor", { timeout: 8000 });
  await anchorFrame.click("#recaptcha-anchor");
  console.log("🖱️  Click en checkbox...");
  await sleep(4000);

  const checked = await anchorFrame
    .evaluate(() =>
      document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked"),
    )
    .catch(() => null);

  console.log("aria-checked:", checked);
  return checked === "true" ? "resuelto" : "challenge";
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 3: Abrir ventana visible y esperar token del usuario
// ─────────────────────────────────────────────────────────────────────────────

async function abrirVentanaYEsperarToken(browser, cedula, tipoValor) {
  console.log("🪟  Abriendo ventana visible para el challenge...");

  const pageVisible = await browser.newPage();

  // Mover esta ventana AL CENTRO de la pantalla (visible para el usuario)
  const session = await pageVisible.target().createCDPSession();
  await session
    .send("Browser.setWindowBounds", {
      windowId: await session
        .send("Browser.getWindowForTarget")
        .then((r) => r.windowId),
      bounds: { left: 200, top: 100, width: 500, height: 620 },
    })
    .catch(() => {});

  await pageVisible.setViewport({ width: 480, height: 580 });

  // Parchear el callback de grecaptcha ANTES de que la página cargue
  await pageVisible.evaluateOnNewDocument(() => {
    window.__captchaToken__ = null;
    const patchClients = () => {
      try {
        const cfg = window.___grecaptcha_cfg;
        if (!cfg?.clients) return;
        for (const k of Object.keys(cfg.clients)) {
          const walk = (obj, depth = 0) => {
            if (!obj || typeof obj !== "object" || depth > 6) return;
            for (const key of Object.keys(obj)) {
              if (
                key === "callback" &&
                typeof obj[key] === "function" &&
                !obj.__patched__
              ) {
                const orig = obj[key];
                obj[key] = (token) => {
                  window.__captchaToken__ = token;
                  return orig(token);
                };
                obj.__patched__ = true;
              } else {
                walk(obj[key], depth + 1);
              }
            }
          };
          walk(cfg.clients[k]);
        }
      } catch (_) {}
    };
    // Intentar cada 300ms durante 30s
    const iv = setInterval(patchClients, 300);
    setTimeout(() => clearInterval(iv), 30000);
  });

  // Navegar y llenar el formulario en la ventana visible
  await prepararFormulario(pageVisible, cedula, tipoValor);

  // Inyectar banner de instrucción
  await pageVisible.evaluate(() => {
    // Ocultar header/footer para que quepa mejor el captcha
    document
      .querySelectorAll("header, footer, nav, .header, .footer")
      .forEach((el) => (el.style.display = "none"));

    const banner = document.createElement("div");
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: #1a56db; color: #fff; font-size: 13px; font-weight: 600;
      padding: 10px 14px; text-align: center; font-family: sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,.35); letter-spacing: 0.2px;
    `;
    banner.textContent =
      "🤖 Completa el captcha. La ventana se cerrará automáticamente.";
    document.body.prepend(banner);
    document.body.style.paddingTop = "44px";
  });

  // Esperar token: polling del textarea O del window.__captchaToken__
  console.log("👁️  Esperando resolución del challenge (máx 3 min)...");
  const TIMEOUT_MS = 3 * 60 * 1000;
  const inicio = Date.now();

  let token = null;
  while (!token && Date.now() - inicio < TIMEOUT_MS) {
    await sleep(500);
    token = await pageVisible
      .evaluate(() => {
        // Primero revisar el callback parchado
        if (window.__captchaToken__) return window.__captchaToken__;
        // Luego el textarea estándar
        const ta =
          document.querySelector("textarea[name='g-recaptcha-response']") ||
          document.querySelector("#g-recaptcha-response");
        return ta?.value?.length > 20 ? ta.value : null;
      })
      .catch(() => null);
  }

  // Cerrar ventana visible
  console.log("🔒 Cerrando ventana del challenge...");
  await pageVisible.close().catch(() => {});

  if (!token)
    throw new Error("Timeout: el usuario no resolvió el captcha en 3 minutos.");

  console.log("✅ Token obtenido.");
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 4: Inyectar token y enviar formulario
// ─────────────────────────────────────────────────────────────────────────────

async function inyectarTokenYEnviar(page, token) {
  if (token) {
    console.log("💉 Inyectando token en página principal...");
    await page.evaluate((tkn) => {
      const selectores = [
        "textarea[name='g-recaptcha-response']",
        "#g-recaptcha-response",
      ];
      for (const sel of selectores) {
        const el = document.querySelector(sel);
        if (el) {
          el.style.display = "block";
          el.value = tkn;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      // Disparar callback interno de grecaptcha
      try {
        const cfg = window.___grecaptcha_cfg;
        if (cfg?.clients) {
          const walk = (obj, depth = 0) => {
            if (!obj || typeof obj !== "object" || depth > 6) return;
            for (const key of Object.keys(obj)) {
              if (key === "callback" && typeof obj[key] === "function") {
                try {
                  obj[key](tkn);
                } catch (_) {}
              } else {
                walk(obj[key], depth + 1);
              }
            }
          };
          for (const k of Object.keys(cfg.clients)) walk(cfg.clients[k]);
        }
      } catch (_) {}
    }, token);
    await sleep(800);
  }

  console.log("🚀 Enviando formulario...");

  const btnSubmit = await buscar(page, [
    "input[id$='consultarBtn']",
    "button[id$='consultarBtn']",
    "input[id*='consultar' i]",
    "button[id*='consultar' i]",
    "input[value*='Consultar']",
    "input[type='submit']",
    "button[type='submit']",
  ]);

  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
      .catch(() => {}),
    btnSubmit
      ? btnSubmit.click()
      : page.evaluate(() => {
          const form =
            document.querySelector("form[id*='formAntecedentes']") ||
            document.querySelector("form");
          if (form) form.submit();
        }),
  ]);

  await sleep(2500);

  const contenido = await page.evaluate(() => document.body.innerText || "");
  const texto = contenido.replace(/\s+/g, " ").trim();
  console.log("📄 Respuesta:", texto.substring(0, 600));
  return texto;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
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
    const pages = await browser.pages();
    const page = pages[0]; // Pestaña inicial (fuera de pantalla)

    await prepararFormulario(page, cedula, tipoValor);
    const estadoCaptcha = await intentarCheckboxSolo(page);

    let texto;

    if (estadoCaptcha === "resuelto" || estadoCaptcha === "sin_captcha") {
      // ✅ El usuario no necesita hacer nada
      console.log("✅ Resuelto automáticamente, el usuario no ve nada.");
      texto = await inyectarTokenYEnviar(page, null);
    } else {
      // ⚠️ Necesita challenge → ventana visible
      const token = await abrirVentanaYEsperarToken(browser, cedula, tipoValor);
      texto = await inyectarTokenYEnviar(page, token);
    }

    await browser.close().catch(() => {});
    return res.json(buildRespuesta(cedula, tipoDocumento, texto));
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    console.error("❌ ERROR:", error.message);
    return res.status(502).json({
      error: "Error en consulta Policía Nacional",
      detalle: error.message,
    });
  }
};
