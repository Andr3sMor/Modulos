/**
 * policia.controller.js
 * Usa Puppeteer + @sparticuz/chromium para evadir reCAPTCHA v2
 * navegando como un browser real.
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
  const isLocal = !process.env.RENDER;

  if (isLocal) {
    // Entorno local: usa el Chromium descargado por puppeteer
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

  // Entorno Render/producción: usa @sparticuz/chromium
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

    // ── PASO 1: Página de términos ─────────────────────────────────
    console.log("📄 Cargando términos...");
    await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // ── PASO 2: Aceptar términos ───────────────────────────────────
    const btnContinuar = await page.$("#continuarBtn");
    if (btnContinuar) {
      console.log("✅ Aceptando términos...");
      const checkbox = await page.$("#aceptaOption");
      if (checkbox) await checkbox.click();
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

    // Si redirigió de vuelta a términos, aceptar de nuevo
    const btnContinuar2 = await page.$("#continuarBtn");
    if (btnContinuar2) {
      const checkbox2 = await page.$("#aceptaOption");
      if (checkbox2) await checkbox2.click();
      await btnContinuar2.click();
      await page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })
        .catch(() => {});
      await page.goto(POLICIA_FORM, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
    }

    // ── PASO 4: Llenar formulario ──────────────────────────────────
    console.log(`📝 Completando: ${tipoValor} - ${cedula}`);

    await page
      .select("select[id='cedulaTipo']", tipoValor)
      .catch(() =>
        page.select("select[name*='cedulaTipo']", tipoValor).catch(() => {}),
      );

    const inputCedula =
      (await page.$("input[id='cedulaInput']")) ||
      (await page.$("input[name*='cedulaInput']"));
    if (!inputCedula) throw new Error("No se encontró campo de cédula.");
    await inputCedula.click({ clickCount: 3 });
    await inputCedula.type(cedula, { delay: 50 });

    // ── PASO 5: reCAPTCHA ──────────────────────────────────────────
    console.log("⏳ Esperando reCAPTCHA...");
    await page
      .waitForSelector("iframe[src*='recaptcha']", { timeout: 12000 })
      .catch(() => {});

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

        if (checked === "true") {
          console.log("✅ reCAPTCHA resuelto (solo checkbox).");
        } else {
          // Esperar hasta 30s por si el challenge se resuelve solo
          console.log("🖼️ Esperando resolución de challenge...");
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
      console.log("⚠️ reCAPTCHA:", e.message);
    }

    // ── PASO 6: Enviar formulario ──────────────────────────────────
    console.log("🚀 Enviando...");
    const btnSubmit = await page.$(
      "input[id*='consultarBtn'], button[id*='consultarBtn'], " +
        "input[value*='Consultar'], input[type='submit'], button[type='submit']",
    );

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

    // ── PASO 7: Leer resultado ─────────────────────────────────────
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
