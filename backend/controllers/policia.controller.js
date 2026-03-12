"use strict";

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

const POLICIA_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml";

const isStealthLoaded = puppeteer.plugins.some((p) => p.name === "stealth");
if (!isStealthLoaded) puppeteer.use(StealthPlugin());

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * Primera llamada (sin captchaToken):
 *   → responde { requiereCaptcha: true, sessionId }
 *   → el frontend muestra el widget reCAPTCHA al usuario
 *
 * Segunda llamada (con captchaToken):
 *   → inyecta el token en Puppeteer y ejecuta el scraping
 */
exports.consultarAntecedentes = async (req, res) => {
  const { cedula, id_type = "CC", captchaToken } = req.body;

  if (!cedula) {
    return res.status(400).json({ error: "El campo cedula es requerido" });
  }

  // Primera llamada — pedir captcha al usuario
  if (!captchaToken) {
    console.log(`[Policía] Solicitando captcha para: ${cedula}`);
    return res.json({
      requiereCaptcha: true,
      sessionId: `${cedula}-${Date.now()}`,
    });
  }

  // Segunda llamada — ejecutar scraping con el token
  console.log(`--- Iniciando consulta Policía para: ${cedula} ---`);

  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    );

    const { message, alert, evidenceUrl } = await executeScrapingFlow(
      page,
      {
        identificator: cedula,
        identification: String(cedula).replace(/[.,]/g, ""),
        id_type,
      },
      captchaToken,
    );

    console.log(`✅ Consulta Policía exitosa para: ${cedula}`);
    return res.json({
      fuente: "Policía Nacional de Colombia",
      status: "success",
      data: {
        cedula,
        tieneAntecedentes: alert,
        mensaje: message,
        evidenceUrl,
      },
    });
  } catch (error) {
    console.error("❌ ERROR POLICÍA:", error.message);
    return res.status(502).json({
      error: "Error al consultar antecedentes policiales",
      detalle: error.message,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};

// ─── Browser ──────────────────────────────────────────────────────────────────

async function launchBrowser() {
  return puppeteer.launch({
    headless: true, // ✅ headless puro — sin extensiones ni Xvfb
    ignoreHTTPSErrors: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--ignore-certificate-errors",
      "--allow-running-insecure-content",
      "--disable-blink-features=AutomationControlled",
    ],
  });
}

// ─── Scraping Flow ────────────────────────────────────────────────────────────

async function executeScrapingFlow(page, client, captchaToken) {
  const { identification, id_type } = client;

  console.log("[Policía] 🌐 Navegando...");
  await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 45000 });
  await delay(3000);

  const directAccess = await page.evaluate(() => {
    const el = document.getElementById("cedulaInput");
    return el && el.offsetParent !== null;
  });

  if (directAccess) {
    console.log("[Policía] 🚀 Acceso directo. Saltando términos.");
  } else {
    console.log("[Policía] 🔒 Aceptando términos...");
    await ensureTermsAcceptedLoop(page);
    await clickContinueWithRetries(page, 3);
  }

  await verifyAntecedentesPage(page);

  // Inyectar el token que el usuario resolvió en el frontend
  console.log("[Policía] 💉 Inyectando token captcha...");
  await page.evaluate((token) => {
    // Campo principal que lee el servidor
    const field = document.getElementById("g-recaptcha-response");
    if (field) {
      field.value = token;
      field.style.display = "block";
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // Por si hay múltiples campos
    document.querySelectorAll('[name="g-recaptcha-response"]').forEach((el) => {
      el.value = token;
    });
  }, captchaToken);
  await delay(1000);
  console.log("[Policía] ✅ Token inyectado.");

  await performSearch(page, identification);
  const { text } = await validateResultsLoaded(page);

  const nowStr = new Date().toLocaleString();
  const alert = !text.toUpperCase().includes("NO TIENE ASUNTOS PENDIENTES");
  const message = alert
    ? `El día ${nowStr} se verifica que ${id_type} ${identification} TIENE antecedentes judiciales.`
    : `El día ${nowStr} se verifica que ${id_type} ${identification} no tiene antecedentes judiciales.`;

  let evidenceUrl = "";
  try {
    const buffer = await page.screenshot({
      fullPage: false,
      fromSurface: true,
    });
    evidenceUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (_) {}

  return { message, alert, evidenceUrl };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureTermsAcceptedLoop(page) {
  let attempts = 0;
  let success = false;

  while (attempts < 10 && !success) {
    attempts++;
    try {
      const navOptions = { waitUntil: "networkidle2", timeout: 45000 };
      attempts === 1
        ? await page.goto(POLICIA_URL, navOptions)
        : await page.reload(navOptions);

      await delay(3000);

      const radioSelector = "#aceptaOption\\:0";
      try {
        await page.waitForSelector(radioSelector, { timeout: 10000 });
      } catch {
        continue;
      }

      await page.click(radioSelector);
      let isEnabled = await checkContinueButton(page);

      if (!isEnabled) {
        await delay(2000);
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        }, radioSelector);
        await delay(4000);
        isEnabled = await checkContinueButton(page);
      }

      if (isEnabled) {
        console.log("[Policía] ✅ Botón Continuar activado.");
        success = true;
      }
    } catch (e) {
      console.warn(
        `[Policía] Error términos intento ${attempts}: ${e.message}`,
      );
    }

    if (!success && attempts < 10) await delay(2000);
  }

  if (!success) throw new Error("No se pudo activar el botón Continuar.");
}

async function checkContinueButton(page) {
  return page.evaluate(() => {
    const btn = document.querySelector("#continuarBtn");
    return (
      btn &&
      !btn.classList.contains("ui-state-disabled") &&
      !btn.hasAttribute("disabled")
    );
  });
}

async function clickContinueWithRetries(page, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const alreadyThere = await page
      .evaluate(
        () =>
          window.location.href.includes("antecedentes.xhtml") ||
          !!document.getElementById("cedulaInput"),
      )
      .catch(() => false);

    if (alreadyThere) return;

    await page
      .waitForSelector("#continuarBtn", { timeout: 5000 })
      .catch(() => {});

    try {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 })
          .catch(() => null),
        page.click("#continuarBtn"),
      ]);
      if (page.url().includes("antecedentes.xhtml")) return;
    } catch (_) {}

    if (attempt > 1) {
      await page.evaluate(() => {
        const btn = document.querySelector("#continuarBtn");
        if (btn) btn.click();
      });
      await delay(5000);
      if (page.url().includes("antecedentes.xhtml")) return;
    }

    await delay(2000);
  }
  throw new Error("No se pudo navegar a antecedentes. URL: " + page.url());
}

async function verifyAntecedentesPage(page) {
  for (let i = 1; i <= 3; i++) {
    try {
      await page.waitForFunction(
        () => window.location.href.includes("antecedentes.xhtml"),
        { timeout: 10000 },
      );
      await page.waitForSelector("#cedulaInput", { timeout: 10000 });
      console.log("[Policía] ✅ Página de antecedentes confirmada.");
      return;
    } catch (e) {
      console.warn(`[Policía] Validación ${i} falló: ${e.message}`);
      await delay(2000);
    }
  }
  throw new Error("No se pudo validar la página de antecedentes.");
}

async function performSearch(page, identification) {
  console.log(`[Policía] Ingresando ID: ${identification}`);
  await page.waitForSelector("input[type='text']", { timeout: 15000 });

  const inputFound = await page.evaluate((idNum) => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
    const visible = inputs.find((i) => i.offsetParent !== null);
    if (visible) {
      visible.value = idNum;
      visible.dispatchEvent(new Event("input", { bubbles: true }));
      visible.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, identification);

  if (!inputFound) await page.type('input[type="text"]', identification);

  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('button, a, input[type="submit"]'),
    );
    const btn = buttons.find(
      (b) =>
        b.textContent?.toLowerCase().includes("consultar") ||
        b.textContent?.toLowerCase().includes("buscar") ||
        b.id.includes("j_idt17"),
    );
    if (btn) btn.click();
  });

  await delay(5000);
}

async function validateResultsLoaded(page) {
  const result = await page.evaluate(() => {
    const selectors = [
      "#antecedentes",
      "#form\\:j_idt8_content",
      "#form\\:j_idt8",
      "#form",
      "body",
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.textContent && el.textContent.trim().length > 100)
        return { found: true, text: el.textContent.trim() };
    }
    return { found: false, text: "" };
  });

  if (!result.found) throw new Error("No se encontró texto de resultados.");
  return result;
}

function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}
