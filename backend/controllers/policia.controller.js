"use strict";

/**
 * policia.controller.js
 *
 * Usa la extensión rektcaptcha cargada en Puppeteer headless para resolver
 * el reCAPTCHA automáticamente desde el browser, sin depender del dominio
 * del frontend ni de servicios externos.
 *
 * Flujo:
 *  1. Lanzar browser con la extensión rektcaptcha
 *  2. Configurar la extensión via service worker
 *  3. Navegar a index.xhtml → aceptar términos → antecedentes.xhtml
 *  4. Rellenar formulario (tipo + cédula)
 *  5. Esperar que rektcaptcha resuelva el captcha (polling g-recaptcha-response)
 *  6. Enviar formulario y extraer resultado
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");

if (!puppeteer.plugins.some((p) => p.name === "stealth")) {
  puppeteer.use(StealthPlugin());
}

const INDEX_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";
const ANTECEDENTES_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml";

// Ruta a la extensión rektcaptcha — ajusta según tu estructura de proyecto
const EXTENSION_PATH = path.resolve(
  __dirname,
  "../browser-extensions/rektcaptcha",
);

// Mapa tipo documento → valor del select
const TIPO_MAP = {
  CC: "cc",
  CE: "ce",
  PA: "pa",
  "Cédula de Ciudadanía": "cc",
  "Cedula de Ciudadania": "cc",
  "Cédula de Extranjería": "ce",
  "Cedula de Extranjeria": "ce",
  Pasaporte: "pa",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Lanzar browser con extensión ─────────────────────────────────────────────
async function lanzarBrowser() {
  const browser = await puppeteer.launch({
    headless: true,
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
    ],
    ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"],
  });

  // Abrir chrome://extensions/ para asegurar que los service workers de la extensión arranquen
  const warmupPage = await browser.newPage();
  try {
    await warmupPage.goto("chrome://extensions/", {
      waitUntil: "domcontentloaded",
      timeout: 5000,
    });
  } catch (_) {}
  await sleep(500);
  await warmupPage.close().catch(() => {});

  return browser;
}

// ─── Configurar extensión rektcaptcha via service worker ──────────────────────
async function configurarExtension(browser) {
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
        console.log("[Policía] ✅ Extensión rektcaptcha configurada");
      }
    } else {
      console.warn("[Policía] ⚠️ Service worker de rektcaptcha no encontrado");
    }
  } catch (e) {
    console.warn("[Policía] ⚠️ Error configurando extensión:", e.message);
  }
}

// ─── Aceptar términos y navegar a antecedentes.xhtml ─────────────────────────
async function aceptarTerminos(page) {
  console.log("[Policía] 🌐 Navegando a index.xhtml...");
  await page.goto(INDEX_URL, { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(3000);

  // Si ya estamos en antecedentes (sesión activa), saltar
  if (page.url().includes("antecedentes.xhtml")) {
    console.log("[Policía] ✅ Ya en antecedentes.xhtml — saltando términos");
    return;
  }

  // Verificar si el input de cédula ya es visible (acceso directo)
  const accesoDirecto = await page.evaluate(() => {
    const el = document.getElementById("cedulaInput");
    return el && el.offsetParent !== null;
  });
  if (accesoDirecto) {
    console.log("[Policía] 🚀 Acceso directo — saltando términos");
    return;
  }

  // Aceptar términos con reintentos
  let exito = false;
  for (let intento = 1; intento <= 10 && !exito; intento++) {
    console.log(`[Policía] 📋 Términos — intento ${intento}/10`);
    try {
      if (intento > 1) {
        await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
        await sleep(3000);
      }

      const radioSel = "#aceptaOption\\:0";
      await page.waitForSelector(radioSel, { timeout: 10000 });
      await page.click(radioSel);
      await sleep(2000);

      let btnActivo = await checkBotonContinuar(page);
      if (!btnActivo) {
        // Intento JS directo
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        }, radioSel);
        await sleep(4000);
        btnActivo = await checkBotonContinuar(page);
      }

      if (btnActivo) {
        console.log("[Policía] ✅ Botón Continuar activado");
        exito = true;
      }
    } catch (e) {
      console.warn(`[Policía] ⚠️ Intento ${intento} términos: ${e.message}`);
    }
    if (!exito && intento < 10) await sleep(2000);
  }

  if (!exito)
    throw new Error("No se pudo activar el botón Continuar tras 10 intentos.");

  // Hacer click en Continuar y esperar navegación
  await clickContinuar(page, 3);
}

async function checkBotonContinuar(page) {
  return page.evaluate(() => {
    const btn = document.querySelector("#continuarBtn");
    return (
      btn &&
      !btn.classList.contains("ui-state-disabled") &&
      !btn.hasAttribute("disabled")
    );
  });
}

async function clickContinuar(page, maxReintentos) {
  for (let i = 1; i <= maxReintentos; i++) {
    const yaCargado = await page
      .evaluate(
        () =>
          window.location.href.includes("antecedentes.xhtml") ||
          !!document.getElementById("cedulaInput"),
      )
      .catch(() => false);
    if (yaCargado) return;

    console.log(`[Policía] ▶️ Click Continuar — intento ${i}/${maxReintentos}`);
    try {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 })
          .catch(() => null),
        page.click("#continuarBtn"),
      ]);
      if (page.url().includes("antecedentes.xhtml")) return;
    } catch (_) {}

    // Estrategia JS alternativa
    if (i > 1) {
      await page.evaluate(() => {
        const btn = document.querySelector("#continuarBtn");
        if (btn) btn.click();
      });
      await sleep(5000);
      if (page.url().includes("antecedentes.xhtml")) return;
    }
    await sleep(2000);
  }
  throw new Error("No se llegó a antecedentes.xhtml. URL: " + page.url());
}

// ─── Verificar que estamos en antecedentes.xhtml ──────────────────────────────
async function verificarPaginaAntecedentes(page) {
  for (let i = 1; i <= 3; i++) {
    try {
      await page.waitForFunction(
        () => window.location.href.includes("antecedentes.xhtml"),
        { timeout: 10000 },
      );
      await page.waitForSelector("#cedulaInput", { timeout: 10000 });
      console.log("[Policía] ✅ Página antecedentes confirmada");
      return;
    } catch (e) {
      console.warn(`[Policía] ⚠️ Validación ${i}/3: ${e.message}`);
      await sleep(2000);
    }
  }
  throw new Error("No se pudo validar la página de antecedentes.");
}

// ─── Rellenar formulario ───────────────────────────────────────────────────────
async function rellenarFormulario(page, cedula, tipoCodigo) {
  console.log(`[Policía] ✏️ Formulario: tipo=${tipoCodigo} cedula=${cedula}`);

  await page.setViewport({ width: 1280, height: 800 });
  await page.waitForSelector("#cedulaInput", { timeout: 10000 });

  // Tipo de documento
  try {
    await page.waitForSelector("#cedulaTipo", { timeout: 5000 });
    await page.select("#cedulaTipo", tipoCodigo);
    await sleep(400);
  } catch (_) {
    console.warn("[Policía] ⚠️ Select cedulaTipo no encontrado");
  }

  // Número de documento
  const inputEncontrado = await page.evaluate((num) => {
    const inputs = [...document.querySelectorAll('input[type="text"]')];
    const visible = inputs.find((i) => i.offsetParent !== null);
    if (visible) {
      visible.value = num;
      visible.dispatchEvent(new Event("input", { bubbles: true }));
      visible.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, String(cedula));

  if (!inputEncontrado) {
    await page.click("#cedulaInput", { clickCount: 3 });
    await page.type("#cedulaInput", String(cedula), { delay: 40 });
  }
  await sleep(300);
}

// ─── Esperar que rektcaptcha resuelva el captcha ──────────────────────────────
/**
 * Hace polling del campo g-recaptcha-response hasta que tenga valor.
 * rektcaptcha detecta el widget y lo resuelve automáticamente.
 * Timeout máximo: 120 segundos (60 checks × 2s).
 */
async function esperarCaptcha(page) {
  console.log("[Policía] 🤖 Esperando que rektcaptcha resuelva el captcha...");

  let desconectados = 0;

  for (let i = 1; i <= 60; i++) {
    try {
      if (page.isClosed())
        throw new Error("Página cerrada durante espera de captcha");

      const resuelto = await page.evaluate(() => {
        const el = document.getElementById("g-recaptcha-response");
        return !!(el && el.value && el.value.trim().length > 0);
      });

      if (desconectados > 0) {
        console.log(
          `[Policía] ✅ Contexto recuperado tras ${desconectados} errores`,
        );
        desconectados = 0;
      }

      if (resuelto) {
        console.log(
          `[Policía] ✅ Captcha resuelto por rektcaptcha (${i * 2}s)`,
        );
        return;
      }
    } catch (e) {
      const esDesconexion =
        e.message.includes("detached") ||
        e.message.includes("shutting down") ||
        e.message.includes("Target closed") ||
        e.message.includes("Execution context was destroyed");

      if (esDesconexion) {
        desconectados++;
        console.warn(
          `[Policía] ⚠️ Contexto desconectado #${desconectados} — esperando recuperación...`,
        );
        if (desconectados > 10) {
          throw new Error(
            "Browser atascado en estado desconectado — forzando reintento.",
          );
        }
        await sleep(2000);
        continue;
      }
      throw e;
    }

    if (i % 5 === 0)
      console.log(`[Policía] ⏳ Captcha pendiente... (${i * 2}s)`);
    await sleep(2000);
  }

  throw new Error(
    "Timeout: rektcaptcha no resolvió el captcha en 120 segundos.",
  );
}

// ─── Enviar formulario y obtener resultado ────────────────────────────────────
async function enviarFormulario(page, cedula, tipoCodigo) {
  console.log("[Policía] 🚀 Enviando formulario...");

  const btnClickado = await page.evaluate(() => {
    const candidatos = [
      ...document.querySelectorAll("button, a, input[type='submit']"),
    ];
    const btn = candidatos.find((b) => {
      const t = (b.textContent || b.value || "").toLowerCase();
      return (
        t.includes("consultar") ||
        t.includes("buscar") ||
        b.id.includes("j_idt17")
      );
    });
    if (btn) {
      btn.click();
      return btn.id || btn.textContent?.trim();
    }
    return null;
  });
  console.log("[Policía] 🖱️ Botón clickado:", btnClickado);

  await sleep(5000);
}

// ─── Extraer resultado del DOM ────────────────────────────────────────────────
async function extraerResultado(page) {
  const resultado = await page.evaluate(() => {
    const selectores = [
      "#antecedentes",
      "#form\\:j_idt8_content",
      "#form\\:j_idt8",
      "#form",
      "body",
    ];
    for (const s of selectores) {
      const el = document.querySelector(s);
      if (el && el.textContent && el.textContent.trim().length > 100) {
        return { encontrado: true, texto: el.textContent.trim() };
      }
    }
    return { encontrado: false, texto: "" };
  });

  if (!resultado.encontrado)
    throw new Error("No se encontró texto de resultados.");
  return resultado.texto;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "CC" } = req.body;

  if (!cedula) {
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });
  }

  const tipoCodigo = TIPO_MAP[tipoDocumento] || "cc";
  const identificacion = String(cedula).replace(/[.,]/g, "");

  console.log(`\n=== Policía: cedula=${identificacion} tipo=${tipoCodigo} ===`);

  let browser = null;

  // Hasta 5 reintentos (igual que el servicio NestJS original)
  for (let intento = 1; intento <= 5; intento++) {
    let page = null;
    try {
      console.log(`[Policía] 🔄 Intento ${intento}/5`);

      if (!browser || intento === 1) {
        if (browser) await browser.close().catch(() => {});
        browser = await lanzarBrowser();
        await configurarExtension(browser);
      }

      page = await browser.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.text().includes("PrimeFaces")) {
          console.debug("[Browser]", msg.text());
        }
      });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      );

      // Si es reintento, recargar en vez de reabrir browser
      if (intento > 1) {
        console.log("[Policía] 🔁 Recargando página para reintento...");
        await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
      }

      // ── Flujo principal ────────────────────────────────────────────────────
      await aceptarTerminos(page);
      await verificarPaginaAntecedentes(page);
      await rellenarFormulario(page, identificacion, tipoCodigo);
      await esperarCaptcha(page);
      await enviarFormulario(page, identificacion, tipoCodigo);
      const texto = await extraerResultado(page);

      // ── Interpretar resultado ──────────────────────────────────────────────
      const tieneAntecedentes = !texto
        .toUpperCase()
        .includes("NO TIENE ASUNTOS PENDIENTES");
      const ahora = new Date().toLocaleString("es-CO");
      const mensaje = tieneAntecedentes
        ? `Al ${ahora} se verifica que ${tipoCodigo.toUpperCase()} ${identificacion} TIENE antecedentes judiciales.`
        : `Al ${ahora} se verifica que ${tipoCodigo.toUpperCase()} ${identificacion} no tiene antecedentes judiciales.`;

      // ── Screenshot de evidencia ────────────────────────────────────────────
      let screenshot = null;
      try {
        const buffer = await page.screenshot({
          fullPage: false,
          fromSurface: true,
        });
        screenshot = `data:image/png;base64,${buffer.toString("base64")}`;
      } catch (_) {}

      await browser.close().catch(() => {});

      console.log(`[Policía] ✅ Consulta exitosa para ${identificacion}`);
      return res.json({
        fuente: "Policía Nacional de Colombia",
        tieneAntecedentes,
        mensaje,
        screenshot,
      });
    } catch (e) {
      console.error(`[Policía] ❌ Intento ${intento}/5 falló: ${e.message}`);
      if (page && !page.isClosed()) await page.close().catch(() => {});

      // Si el browser crasheó, reiniciar en el siguiente intento
      const esCrash =
        e.message.includes("Target closed") ||
        e.message.includes("Session closed") ||
        e.message.includes("Browser atascado");
      if (esCrash && browser) {
        await browser.close().catch(() => {});
        browser = null;
      }

      if (intento === 5) {
        if (browser) await browser.close().catch(() => {});
        return res.status(502).json({
          error: "Error consultando Policía Nacional",
          detalle: `Falló tras 5 intentos. Último error: ${e.message}`,
        });
      }

      await sleep(3000);
    }
  }
};
