/**
 * policia.controller.js
 * Flujo correcto:
 * 1. Ir a index.xhtml (términos)
 * 2. Aceptar términos → el servidor redirige a antecedentes.xhtml
 * 3. Operar DIRECTAMENTE en antecedentes.xhtml sin navegar de nuevo
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const POLICIA_BASE = "https://antecedentes.policia.gov.co:7005";
const POLICIA_URL = `${POLICIA_BASE}/WebJudicial/index.xhtml`;

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

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "cc" } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const tipoValor = TIPO_MAP[tipoDocumento] || "cc";
  console.log(`--- Consultando: ${cedula} ---`);

  let browser;
  try {
    browser = await lanzarBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });
    await page.setBypassCSP(true);

    // ── PASO 1: Cargar términos ────────────────────────────────────
    console.log("📄 Cargando index.xhtml (términos)...");
    await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 30000 });
    console.log("URL después de goto:", page.url());

    // ── PASO 2: Aceptar términos y esperar redirección ─────────────
    // El servidor redirige automáticamente a antecedentes.xhtml tras aceptar
    const checkbox = await buscar(page, [
      "#aceptaOption",
      "input[id$='aceptaOption']",
      "input[type='checkbox']",
    ]);
    if (checkbox) {
      await checkbox.click();
      await sleep(300);
    }

    const btnContinuar = await buscar(page, [
      "#continuarBtn",
      "input[id$='continuarBtn']",
      "button[id$='continuarBtn']",
      "input[value*='ontinuar']",
      "button[value*='ontinuar']",
    ]);

    if (!btnContinuar)
      throw new Error("No se encontró botón de continuar en términos.");

    console.log(
      "✅ Aceptando términos y esperando redirección a antecedentes.xhtml...",
    );
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 }),
      btnContinuar.click(),
    ]);

    console.log("URL tras aceptar términos:", page.url());

    // ── PASO 3: Verificar que estamos en antecedentes.xhtml ────────
    if (!page.url().includes("antecedentes")) {
      throw new Error(`Redirección inesperada. URL actual: ${page.url()}`);
    }

    // ── PASO 4: Log de todos los elementos para debug ──────────────
    const elementos = await page.evaluate(() =>
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
    console.log(
      "🔍 Elementos en antecedentes.xhtml:",
      JSON.stringify(elementos),
    );

    // ── PASO 5: Seleccionar tipo de documento ──────────────────────
    const selectTipo = await buscar(page, [
      "select[id='formAntecedentes:cedulaTipo']",
      "select[id='cedulaTipo']",
      "select[name*='cedulaTipo']",
      "select",
    ]);

    if (selectTipo) {
      const selectorId = await page.evaluate(
        (el) => (el.id ? `[id='${el.id}']` : `[name='${el.name}']`),
        selectTipo,
      );
      // Ver opciones disponibles
      const opciones = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el
          ? Array.from(el.options).map((o) => ({ v: o.value, t: o.text }))
          : [];
      }, selectorId);
      console.log("Opciones tipo doc:", JSON.stringify(opciones));

      // Seleccionar por value, o por texto si falla
      await page.select(selectorId, tipoValor).catch(async () => {
        const opcion = opciones.find((o) =>
          o.t?.toLowerCase().includes("ciudadan"),
        );
        if (opcion) await page.select(selectorId, opcion.v).catch(() => {});
      });
    }

    // ── PASO 6: Ingresar cédula ────────────────────────────────────
    console.log(`📝 Ingresando cédula: ${cedula}`);
    const inputCedula = await buscar(page, [
      "input[id='formAntecedentes:cedulaInput']",
      "input[id='cedulaInput']",
      "input[name*='cedulaInput']",
      "input[id*='cedula' i]:not([type='hidden'])",
      "input[name*='cedula' i]:not([type='hidden'])",
    ]);

    if (!inputCedula) {
      console.log(
        "HTML actual (800):",
        (await page.content()).substring(0, 800),
      );
      throw new Error("No se encontró campo de cédula en antecedentes.xhtml.");
    }

    await inputCedula.click({ clickCount: 3 });
    await inputCedula.type(cedula, { delay: 50 });

    // ── PASO 7: reCAPTCHA ──────────────────────────────────────────
    console.log("⏳ Esperando reCAPTCHA...");
    await page
      .waitForSelector("iframe[src*='recaptcha']", { timeout: 12000 })
      .catch(() => console.log("⚠️ No se detectó iframe de reCAPTCHA."));

    try {
      const frames = page.frames();
      const anchorFrame = frames.find(
        (f) => f.url().includes("recaptcha") && f.url().includes("anchor"),
      );
      if (anchorFrame) {
        await anchorFrame.waitForSelector("#recaptcha-anchor", {
          timeout: 8000,
        });
        await anchorFrame.click("#recaptcha-anchor");
        console.log("🖱️ Click en checkbox reCAPTCHA...");
        await sleep(4000);

        const checked = await anchorFrame.evaluate(() =>
          document
            .querySelector("#recaptcha-anchor")
            ?.getAttribute("aria-checked"),
        );
        console.log(`reCAPTCHA checked: ${checked}`);

        if (checked !== "true") {
          console.log("🖼️ Esperando resolución de challenge (máx 30s)...");
          await page
            .waitForFunction(
              () => {
                const ta = document.querySelector(
                  "textarea[name='g-recaptcha-response']",
                );
                return ta && ta.value && ta.value.length > 10;
              },
              { timeout: 30000 },
            )
            .catch(() => console.log("⚠️ Challenge no resuelto."));
        }
      }
    } catch (e) {
      console.log("⚠️ Error reCAPTCHA:", e.message);
    }

    // ── PASO 8: Enviar formulario ──────────────────────────────────
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
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 })
          .catch(() => {}),
        btnSubmit.click(),
      ]);
    } else {
      await page.evaluate(() => {
        const form =
          document.querySelector("form#formAntecedentes") ||
          document.querySelector("form");
        if (form) form.submit();
      });
      await page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 })
        .catch(() => {});
    }

    await sleep(2000);

    // ── PASO 9: Leer resultado ─────────────────────────────────────
    const contenido = await page.evaluate(() => document.body.innerText || "");
    const texto = contenido.replace(/\s+/g, " ").trim().toUpperCase();
    console.log("Respuesta (600):", texto.substring(0, 600));

    const noRegistra =
      texto.includes("NO REGISTRA") ||
      texto.includes("SIN ANTECEDENTES") ||
      texto.includes("NO PRESENTA");
    const registra =
      texto.includes("REGISTRA ANTECEDENTES") ||
      texto.includes("PRESENTA ANTECEDENTES") ||
      texto.includes("CONDENA");
    const captchaRechazado =
      !noRegistra &&
      !registra &&
      (texto.includes("CAPTCHA") || texto.includes("DEBE SELECCIONAR"));

    if (captchaRechazado)
      throw new Error(
        "El servidor rechazó la consulta por reCAPTCHA. Intenta de nuevo.",
      );

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
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};
