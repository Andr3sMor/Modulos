/**
 * policia.controller.js
 * Puppeteer + @sparticuz/chromium
 * Selectores ajustados para PrimeFaces/JSF con namespace "formAntecedentes:"
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

async function lanzarBrowser() {
  if (!process.env.RENDER) {
    // Local: puppeteer completo con su propio Chromium
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
  // Render/producción: @sparticuz/chromium
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

/** Busca un elemento por múltiples selectores, devuelve el primero que exista */
async function buscarElemento(page, selectores) {
  for (const sel of selectores) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "cc" } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const tipoValor = TIPO_MAP[tipoDocumento] || "cc";
  console.log(`--- Consultando antecedentes Puppeteer para: ${cedula} ---`);

  let browser;
  try {
    browser = await lanzarBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });
    await page.setBypassCSP(true);

    // ── PASO 1: Términos ───────────────────────────────────────────
    console.log("📄 Cargando términos...");
    await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // ── PASO 2: Aceptar términos ───────────────────────────────────
    const btnContinuar = await buscarElemento(page, [
      "#continuarBtn",
      "input[id$='continuarBtn']",
      "button[id$='continuarBtn']",
      "input[value*='Continuar']",
      "button[value*='Continuar']",
    ]);
    if (btnContinuar) {
      console.log("✅ Aceptando términos...");
      const checkbox = await buscarElemento(page, [
        "#aceptaOption",
        "input[id$='aceptaOption']",
        "input[type='checkbox']",
      ]);
      if (checkbox) await checkbox.click();
      await page.waitForTimeout(500);
      await btnContinuar.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })
        .catch(() => {});
    }

    // ── PASO 3: Formulario ─────────────────────────────────────────
    console.log("📋 Cargando formulario...");
    await page.goto(POLICIA_FORM, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Si volvió a términos, aceptar de nuevo
    const btnContinuar2 = await buscarElemento(page, [
      "#continuarBtn",
      "input[id$='continuarBtn']",
      "button[id$='continuarBtn']",
    ]);
    if (btnContinuar2) {
      const checkbox2 = await buscarElemento(page, [
        "#aceptaOption",
        "input[type='checkbox']",
      ]);
      if (checkbox2) await checkbox2.click();
      await page.waitForTimeout(500);
      await btnContinuar2.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })
        .catch(() => {});
      await page.goto(POLICIA_FORM, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
    }

    // ── PASO 4: Volcar todos los inputs para debug ─────────────────
    const todosLosElementos = await page.evaluate(() =>
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
      "🔍 Elementos en formulario:",
      JSON.stringify(todosLosElementos),
    );

    // ── PASO 5: Llenar tipo de documento ──────────────────────────
    // JSF genera IDs como "formAntecedentes:cedulaTipo" pero también puede ser solo "cedulaTipo"
    const selectTipo = await buscarElemento(page, [
      "select[id='formAntecedentes:cedulaTipo']",
      "select[id='cedulaTipo']",
      "select[name*='cedulaTipo']",
      "select",
    ]);

    if (selectTipo) {
      // Obtener opciones disponibles para mapear el valor correcto
      const opciones = await page.evaluate(
        (sel) => {
          const el = document.querySelector(sel);
          if (!el) return [];
          return Array.from(el.options).map((o) => ({
            value: o.value,
            text: o.text,
          }));
        },
        await page
          .evaluate((el) => {
            // Devolver selector único del elemento
            return el.id ? `#${el.id}` : `select[name='${el.name}']`;
          }, selectTipo)
          .catch(() => "select"),
      );

      console.log("📋 Opciones de tipo doc:", JSON.stringify(opciones));

      // Intentar seleccionar por value
      const elId = await page.evaluate(
        (el) => (el.id ? `#${el.id}` : `select[name='${el.name}']`),
        selectTipo,
      );
      await page.select(elId, tipoValor).catch(async () => {
        // Si falla por value, intentar por texto visible
        const opcionCC = opciones.find((o) =>
          o.text?.toLowerCase().includes("ciudadan"),
        );
        if (opcionCC) await page.select(elId, opcionCC.value).catch(() => {});
      });
    }

    // ── PASO 6: Llenar cédula ──────────────────────────────────────
    console.log(`📝 Ingresando cédula: ${cedula}`);
    const inputCedula = await buscarElemento(page, [
      "input[id='formAntecedentes:cedulaInput']",
      "input[id='cedulaInput']",
      "input[name*='cedulaInput']",
      "input[id*='cedula']:not([type='hidden'])",
      "input[name*='cedula']:not([type='hidden'])",
      "input[type='text']",
    ]);

    if (!inputCedula) {
      const url = page.url();
      const html = await page.content();
      console.log("URL actual:", url);
      console.log("HTML (500):", html.substring(0, 500));
      throw new Error(`No se encontró campo de cédula. URL: ${url}`);
    }

    await inputCedula.click({ clickCount: 3 });
    await inputCedula.type(cedula, { delay: 50 });

    // ── PASO 7: reCAPTCHA ──────────────────────────────────────────
    console.log("⏳ Esperando reCAPTCHA...");
    await page
      .waitForSelector("iframe[src*='recaptcha']", { timeout: 12000 })
      .catch(() => {
        console.log("⚠️ No se detectó iframe de reCAPTCHA.");
      });

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
        await page.waitForTimeout(4000);

        const checked = await anchorFrame.evaluate(() =>
          document
            .querySelector("#recaptcha-anchor")
            ?.getAttribute("aria-checked"),
        );
        console.log(`reCAPTCHA aria-checked: ${checked}`);

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
            .catch(() =>
              console.log("⚠️ Challenge no resuelto automáticamente."),
            );
        }
      }
    } catch (e) {
      console.log("⚠️ Error en reCAPTCHA:", e.message);
    }

    // ── PASO 8: Enviar formulario ──────────────────────────────────
    console.log("🚀 Enviando formulario...");
    const btnSubmit = await buscarElemento(page, [
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
          document.querySelector("form#formAntecedentes") ||
          document.querySelector("form");
        if (form) form.submit();
      });
    }

    await page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 })
      .catch(() => {});
    await page.waitForTimeout(2000);

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

    if (captchaRechazado) {
      throw new Error(
        "El servidor rechazó la consulta por reCAPTCHA. Intenta de nuevo.",
      );
    }

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
