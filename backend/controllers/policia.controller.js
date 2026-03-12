"use strict";

const path = require("path");
const child_process = require("child_process");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

// ─── Setup ────────────────────────────────────────────────────────────────────

const POLICIA_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml";

const EXTENSION_PATH = path.resolve(
  __dirname,
  "../browser-extensions/rektcaptcha",
);

const XVFB_DISPLAY = ":99";

// Registrar Stealth una sola vez al cargar el módulo
const isStealthLoaded = puppeteer.plugins.some((p) => p.name === "stealth");
if (!isStealthLoaded) {
  puppeteer.use(StealthPlugin());
}

// Iniciar Xvfb una sola vez al cargar el módulo (solo en Linux)
startXvfb();

// ─── Controller ───────────────────────────────────────────────────────────────

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, id_type = "CC" } = req.body;

  if (!cedula) {
    return res.status(400).json({ error: "El campo cedula es requerido" });
  }

  console.log(`--- Iniciando consulta Policía para: ${cedula} ---`);

  const client = {
    identificator: cedula,
    identification: String(cedula).replace(/[.,]/g, ""),
    id_type,
    client_type: "natural",
  };

  let browser = null;

  try {
    browser = await launchBrowser();
    await configureExtension(browser);

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    );

    const { message, alert, evidenceUrl } = await executeScrapingFlow(
      page,
      client,
    );

    console.log(`✅ Consulta Policía exitosa para: ${cedula}`);

    return res.json({
      fuente: "Policía Nacional de Colombia",
      status: "success",
      data: {
        cedula,
        alert,
        message,
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

// ─── Xvfb ─────────────────────────────────────────────────────────────────────

function startXvfb() {
  if (process.platform !== "linux") {
    console.warn("[Policía] No es Linux — omitiendo Xvfb.");
    return;
  }

  try {
    child_process.execSync("which Xvfb", { stdio: "ignore" });
  } catch {
    console.error(
      "[Policía] Xvfb no encontrado. Instala con: apt-get install -y xvfb",
    );
    return;
  }

  // Limpiar proceso previo si existe
  try {
    child_process.execSync(`pkill -f "Xvfb ${XVFB_DISPLAY}"`, {
      stdio: "ignore",
    });
  } catch {
    /* no había proceso previo */
  }

  const xvfb = child_process.spawn(
    "Xvfb",
    [XVFB_DISPLAY, "-screen", "0", "1920x1080x24", "-ac"],
    { detached: false, stdio: "ignore" },
  );

  xvfb.on("error", (err) =>
    console.error("[Policía] Error Xvfb:", err.message),
  );
  xvfb.on("exit", (code) => {
    if (code !== 0 && code !== null)
      console.warn(`[Policía] Xvfb terminó con código ${code}`);
  });

  process.env.DISPLAY = XVFB_DISPLAY;
  console.log(`[Policía] ✅ Xvfb iniciado en DISPLAY=${XVFB_DISPLAY}`);
}

// ─── Browser ──────────────────────────────────────────────────────────────────

async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: false, // OBLIGATORIO para que la extensión rektcaptcha funcione
    devtools: false,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-features=IsolateOrigins,site-per-process",
      "--ignore-certificate-errors",
      "--allow-running-insecure-content",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-software-rasterizer",
      "--font-render-hinting=none",
      "--window-size=1920,1080",
      `--display=${process.env.DISPLAY ?? XVFB_DISPLAY}`,
    ],
    ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"],
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? XVFB_DISPLAY },
  });

  // Warm-up: visitar extensions para inicializar el service worker
  const page = await browser.newPage();
  try {
    await page.goto("chrome://extensions/", {
      waitUntil: "domcontentloaded",
      timeout: 5000,
    });
  } catch (_) {
    /* ignorar timeout */
  }
  await delay(500);
  await page.close().catch(() => {});

  return browser;
}

async function configureExtension(browser) {
  try {
    const targets = await browser.targets();
    const extensionTarget = targets.find(
      (t) => t.type() === "service_worker" || t.url().includes("rektcaptcha"),
    );

    if (extensionTarget) {
      const worker = await extensionTarget.worker();
      if (worker) {
        await worker.evaluate(() => {
          const chrome = self.chrome;
          if (chrome?.storage?.local) {
            chrome.storage.local.set({
              recaptcha_auto_open: true,
              recaptcha_auto_solve: true,
              recaptcha_click_delay_time: 300,
              recaptcha_solve_delay_time: 1000,
            });
          }
        });
        console.log("[Policía] ✅ rektCaptcha configurado.");
      }
    } else {
      console.warn("[Policía] ⚠️  Target de rektCaptcha no encontrado.");
    }
  } catch (error) {
    console.warn(
      "[Policía] No se pudo configurar la extensión:",
      error.message,
    );
  }
}

// ─── Scraping Flow ────────────────────────────────────────────────────────────

async function executeScrapingFlow(page, client) {
  const { identification, id_type } = client;

  console.log("[Policía] 🌐 Navegando a URL inicial...");
  await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 45000 });
  await delay(3000);

  // Detectar si ya estamos en la página de búsqueda o hay que aceptar términos
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
  await handleCaptcha(page);
  await performSearch(page, identification);

  const { text } = await validateResultsLoaded(page);

  const nowStr = new Date().toLocaleString();
  let alert, message;

  if (text.toUpperCase().includes("NO TIENE ASUNTOS PENDIENTES")) {
    alert = false;
    message =
      `El día ${nowStr} se verifica en el sistema de antecedentes policiales ` +
      `que el registro identificado con ${id_type} ${identification} no tiene antecedentes judiciales.`;
  } else {
    alert = true;
    message =
      `El día ${nowStr} se verifica en el sistema de antecedentes policiales ` +
      `que el registro identificado con ${id_type} ${identification} TIENE antecedentes judiciales.`;
  }

  // Screenshot como evidencia (base64, no requiere servicio externo)
  let evidenceUrl = "";
  try {
    const buffer = await page.screenshot({
      fullPage: false,
      fromSurface: true,
    });
    evidenceUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (imgError) {
    console.warn("[Policía] Error capturando screenshot:", imgError.message);
  }

  return { message, alert, evidenceUrl };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureTermsAcceptedLoop(page) {
  let attempts = 0;
  let success = false;

  while (attempts < 10 && !success) {
    attempts++;
    console.log(`[Policía] 🔄 Términos — intento ${attempts}/10...`);

    try {
      const navOptions = { waitUntil: "networkidle2", timeout: 45000 };
      if (attempts === 1) {
        await page.goto(POLICIA_URL, navOptions);
      } else {
        await page.reload(navOptions);
      }

      await delay(3000);

      const radioSelector = "#aceptaOption\\:0";
      try {
        await page.waitForSelector(radioSelector, { timeout: 10000 });
      } catch {
        console.warn("[Policía] Radio button no apareció. Recargando...");
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
        `[Policía] Error en términos intento ${attempts}: ${e.message}`,
      );
    }

    if (!success && attempts < 10) await delay(2000);
  }

  if (!success) {
    throw new Error(
      "No se pudo activar el botón de continuar tras 10 intentos.",
    );
  }
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

    const btnSelector = "#continuarBtn";
    await page.waitForSelector(btnSelector, { timeout: 5000 }).catch(() => {});

    try {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 })
          .catch(() => null),
        page.click(btnSelector),
      ]);
      if (page.url().includes("antecedentes.xhtml")) return;
    } catch (_) {
      /* continuar */
    }

    if (attempt > 1) {
      await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (btn) btn.click();
      }, btnSelector);
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
      console.warn(`[Policía] Validación intento ${i} falló: ${e.message}`);
      await delay(2000);
    }
  }
  throw new Error("No se pudo validar la página de antecedentes.");
}

async function handleCaptcha(page) {
  console.log("[Policía] Esperando rektCaptcha...");
  await page.setViewport({ width: 1280, height: 800 });

  let solved = false;
  let detachedCount = 0;

  for (let i = 1; i <= 60; i++) {
    try {
      if (page.isClosed()) throw new Error("Page cerrada.");

      solved = await page.evaluate(() => {
        const el = document.getElementById("g-recaptcha-response");
        return !!(el && el.value && el.value.trim().length > 0);
      });

      detachedCount = 0;
    } catch (e) {
      const isDetached =
        e.message.includes("detached") ||
        e.message.includes("shutting down") ||
        e.message.includes("Target closed") ||
        e.message.includes("Execution context was destroyed");

      if (isDetached) {
        detachedCount++;
        if (detachedCount > 10)
          throw new Error("Browser atascado en estado detached.");
        await delay(2000);
        continue;
      }
      throw e;
    }

    if (solved) {
      console.log("[Policía] ✅ Captcha resuelto.");
      break;
    }

    if (i % 5 === 0) console.log(`[Policía] ⏳ Captcha... (${i * 2}s)`);
    await delay(2000);
  }

  if (!solved) throw new Error("Captcha no resuelto tras 120s.");
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
