"use strict";

/**
 * policia.controller.js
 *
 * Usa la extensión rektcaptcha cargada en Puppeteer headless para resolver
 * el reCAPTCHA automáticamente desde el browser, sin depender del dominio
 * del frontend ni de servicios externos.
 *
 * Flujo:
 *  1. Lanzar browser con la extensión rektcaptcha (si está disponible)
 *  2. Configurar la extensión via service worker
 *  3. Navegar a index.xhtml → aceptar términos → antecedentes.xhtml
 *  4. Rellenar formulario (tipo + cédula)
 *  5. Esperar que rektcaptcha resuelva el captcha (polling g-recaptcha-response)
 *  6. Enviar formulario y extraer resultado
 *
 * CORRECCIONES APLICADAS:
 *  - Se crea un browser NUEVO en cada intento (no se reutiliza entre reintentos).
 *    Esto elimina el problema de pages huérfanas y estados inconsistentes del
 *    browser cuando un intento falla parcialmente.
 *  - Se verifica la existencia del directorio de la extensión antes de intentar
 *    cargarla. En entornos serverless (Render/Docker) donde no existe la
 *    extensión, el browser se lanza en modo normal sin ella.
 *  - El browser siempre se cierra explícitamente al final de cada intento
 *    (éxito o error), usando try/finally por intento.
 *  - Se implementa backoff exponencial entre reintentos para reducir carga
 *    sobre el servidor de la Policía.
 *  - `headless: "new"` cuando se cargan extensiones (requerido por Chrome 112+).
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

if (!puppeteer.plugins.some((p) => p.name === "stealth")) {
  puppeteer.use(StealthPlugin());
}

const INDEX_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";
const ANTECEDENTES_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml";

const EXTENSION_PATH = path.resolve(
  __dirname,
  "../browser-extensions/rektcaptcha",
);

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

// ─── Lanzar browser ────────────────────────────────────────────────────────────
// CORRECCIÓN: Se verifica si la extensión existe en disco antes de intentar
// cargarla. En producción (Render/Docker), el directorio puede no existir y
// cargar una extensión inexistente deja Chromium en estado zombie.
async function lanzarBrowser() {
  const extensionExiste = fs.existsSync(EXTENSION_PATH);

  if (extensionExiste) {
    console.log("[Policía] 🔌 Extensión rektcaptcha encontrada — cargando...");
  } else {
    console.warn(
      "[Policía] ⚠️ Extensión rektcaptcha NO encontrada en:",
      EXTENSION_PATH,
    );
    console.warn(
      "[Policía] ⚠️ El captcha deberá resolverse manualmente o con otro método.",
    );
  }

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--ignore-certificate-errors",
    "--allow-running-insecure-content",
    "--disable-blink-features=AutomationControlled",
    "--disable-software-rasterizer",
    "--font-render-hinting=none",
    "--window-size=1920,1080",
  ];

  const ignoreDefaultArgs = ["--enable-automation"];

  if (extensionExiste) {
    // --load-extension requiere que las extensiones NO estén deshabilitadas
    args.push(
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--disable-features=IsolateOrigins,site-per-process",
    );
    ignoreDefaultArgs.push("--disable-extensions");
  }

  const browser = await puppeteer.launch({
    // CORRECCIÓN: `headless: "new"` es obligatorio para cargar extensiones en
    // Chrome 112+. Con `headless: true` (modo legacy) las extensiones se ignoran.
    headless: extensionExiste ? "new" : true,
    devtools: false,
    ignoreHTTPSErrors: true,
    args,
    ignoreDefaultArgs,
  });

  if (extensionExiste) {
    // Warm-up: abrir chrome://extensions/ para que los service workers arranquen
    const warmupPage = await browser.newPage();
    try {
      await warmupPage.goto("chrome://extensions/", {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
    } catch (_) {}
    await sleep(500);
    await warmupPage.close().catch(() => {});
  }

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

  if (page.url().includes("antecedentes.xhtml")) {
    console.log("[Policía] ✅ Ya en antecedentes.xhtml — saltando términos");
    return;
  }

  const accesoDirecto = await page.evaluate(() => {
    const el = document.getElementById("cedulaInput");
    return el && el.offsetParent !== null;
  });
  if (accesoDirecto) {
    console.log("[Policía] 🚀 Acceso directo — saltando términos");
    return;
  }

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

  try {
    await page.waitForSelector("#cedulaTipo", { timeout: 5000 });
    await page.select("#cedulaTipo", tipoCodigo);
    await sleep(400);
  } catch (_) {
    console.warn("[Policía] ⚠️ Select cedulaTipo no encontrado");
  }

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

// ─── Enviar formulario ─────────────────────────────────────────────────────────
async function enviarFormulario(page) {
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

  // CORRECCIÓN: En cada intento se crea un browser completamente nuevo y se
  // cierra al terminar (con éxito o error). Esto elimina el problema de
  // reutilizar un browser en estado inconsistente entre reintentos.
  for (let intento = 1; intento <= 5; intento++) {
    let browser = null;
    let page = null;

    try {
      console.log(`[Policía] 🔄 Intento ${intento}/5`);

      browser = await lanzarBrowser();
      await configurarExtension(browser);

      page = await browser.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.text().includes("PrimeFaces")) {
          console.debug("[Browser]", msg.text());
        }
      });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      );

      // ── Flujo principal ────────────────────────────────────────────────────
      await aceptarTerminos(page);
      await verificarPaginaAntecedentes(page);
      await rellenarFormulario(page, identificacion, tipoCodigo);
      await esperarCaptcha(page);
      await enviarFormulario(page);
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

      // CORRECCIÓN: Cerrar browser inmediatamente tras capturar el resultado.
      await browser.close().catch(() => {});
      browser = null;

      console.log(`[Policía] ✅ Consulta exitosa para ${identificacion}`);
      return res.json({
        fuente: "Policía Nacional de Colombia",
        tieneAntecedentes,
        mensaje,
        screenshot,
      });
    } catch (e) {
      console.error(`[Policía] ❌ Intento ${intento}/5 falló: ${e.message}`);

      if (intento === 5) {
        // CORRECCIÓN: Asegurarse de que el browser se cierra en el último intento fallido.
        if (browser) await browser.close().catch(() => {});
        return res.status(502).json({
          error: "Error consultando Policía Nacional",
          detalle: `Falló tras 5 intentos. Último error: ${e.message}`,
        });
      }

      // CORRECCIÓN: Backoff exponencial entre reintentos (3s, 6s, 9s, 12s)
      // en lugar de un delay fijo de 3s, para dar tiempo al servidor de recuperarse.
      const delayMs = 3000 * intento;
      console.log(
        `[Policía] ⏳ Esperando ${delayMs / 1000}s antes del reintento...`,
      );

      // CORRECCIÓN: Siempre cerrar browser al final de un intento fallido,
      // usando finally para garantizar limpieza incluso si el close() mismo falla.
    } finally {
      // CORRECCIÓN: Bloque finally por intento. Garantiza que page y browser
      // se cierren siempre, evitando procesos Chromium huérfanos en memoria.
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
        browser = null;
      }
    }

    // El await del sleep va fuera del try/finally para que se ejecute
    // correctamente entre iteraciones (no aplica en el último intento).
    if (intento < 5) {
      await sleep(3000 * intento);
    }
  }
};
