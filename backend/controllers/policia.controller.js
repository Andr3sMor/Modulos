"use strict";

/**
 * policia.controller.js
 *
 * Flujo en Render (producción):
 *  1. POST /api/consulta-antecedentes (sin captchaToken)
 *     → Puppeteer navega hasta antecedentes.xhtml y llena el formulario
 *     → Detecta el reCAPTCHA
 *     → Devuelve { requiereCaptcha: true, sessionId }
 *
 *  2. Frontend abre popup → usuario tiene rektcaptcha instalada en su browser
 *     → La extensión resuelve el captcha automáticamente
 *     → El frontend obtiene el token desde el popup (postMessage)
 *
 *  3. POST /api/consulta-antecedentes (con captchaToken + sessionId)
 *     → Backend recupera sesión Puppeteer
 *     → Inyecta el token, envía formulario, extrae resultado
 *     → Devuelve resultado final
 *
 * En Render: puppeteer-core + @sparticuz/chromium
 * En local:  puppeteer-extra (con extensión rektcaptcha si existe)
 */

const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteerCore = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

if (!puppeteerExtra.plugins.some((p) => p.name === "stealth")) {
  puppeteerExtra.use(StealthPlugin());
}

const INDEX_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";

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

// ─── Sesiones en memoria ──────────────────────────────────────────────────────
// sessionId → { browser, page, cedula, tipoCodigo, sseClients, creadoEn }
const sesiones = new Map();
const SESION_TTL_MS = 10 * 60 * 1000; // 10 minutos

setInterval(
  () => {
    const ahora = Date.now();
    for (const [id, s] of sesiones.entries()) {
      if (ahora - s.creadoEn > SESION_TTL_MS) {
        console.log(`[Policía] 🧹 Sesión expirada: ${id}`);
        s.browser?.close().catch(() => {});
        // Notificar clientes SSE que la sesión expiró
        for (const res of s.sseClients || []) {
          try {
            res.write(
              `event: error\ndata: ${JSON.stringify({ error: "Sesión expirada" })}\n\n`,
            );
            res.end();
          } catch (_) {}
        }
        sesiones.delete(id);
      }
    }
  },
  5 * 60 * 1000,
);

// ─── Lanzar browser ────────────────────────────────────────────────────────────
async function lanzarBrowser() {
  if (process.env.RENDER) {
    console.log("[Policía] 🌐 Render — usando @sparticuz/chromium");
    return puppeteerCore.launch({
      args: [
        ...chromium.args,
        "--ignore-certificate-errors",
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--disable-blink-features=AutomationControlled",
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  // Local
  const extensionExiste = fs.existsSync(EXTENSION_PATH);
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--ignore-certificate-errors",
    "--allow-running-insecure-content",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1920,1080",
  ];
  const ignoreDefaultArgs = ["--enable-automation"];

  if (extensionExiste) {
    console.log("[Policía] 🔌 Local + extensión rektcaptcha");
    args.push(
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    );
    ignoreDefaultArgs.push("--disable-extensions");
  } else {
    console.log("[Policía] 💻 Local sin extensión");
  }

  const browser = await puppeteerExtra.launch({
    headless: extensionExiste ? false : true,
    ignoreHTTPSErrors: true,
    args,
    ignoreDefaultArgs,
  });

  if (extensionExiste) {
    const warmup = await browser.newPage();
    try {
      await warmup.goto("chrome://extensions/", {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
    } catch (_) {}
    await sleep(500);
    await warmup.close().catch(() => {});
  }

  return browser;
}

// ─── Aceptar términos ─────────────────────────────────────────────────────────
async function aceptarTerminos(page) {
  console.log("[Policía] 🌐 Navegando a index.xhtml...");
  await page.goto(INDEX_URL, { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(3000);

  if (page.url().includes("antecedentes.xhtml")) return;

  const accesoDirecto = await page.evaluate(() => {
    const el = document.getElementById("cedulaInput");
    return el && el.offsetParent !== null;
  });
  if (accesoDirecto) return;

  let exito = false;
  for (let i = 1; i <= 10 && !exito; i++) {
    try {
      if (i > 1) {
        await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
        await sleep(3000);
      }
      const radioSel = "#aceptaOption\\:0";
      await page.waitForSelector(radioSel, { timeout: 10000 });
      await page.click(radioSel);
      await sleep(2000);

      let activo = await page.evaluate(() => {
        const btn = document.querySelector("#continuarBtn");
        return (
          btn &&
          !btn.classList.contains("ui-state-disabled") &&
          !btn.hasAttribute("disabled")
        );
      });
      if (!activo) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        }, radioSel);
        await sleep(4000);
        activo = await page.evaluate(() => {
          const btn = document.querySelector("#continuarBtn");
          return (
            btn &&
            !btn.classList.contains("ui-state-disabled") &&
            !btn.hasAttribute("disabled")
          );
        });
      }
      if (activo) exito = true;
    } catch (e) {
      console.warn(`[Policía] ⚠️ Términos intento ${i}: ${e.message}`);
    }
    if (!exito && i < 10) await sleep(2000);
  }

  if (!exito) throw new Error("No se pudo activar el botón Continuar.");

  for (let i = 1; i <= 3; i++) {
    const ok = await page
      .evaluate(
        () =>
          window.location.href.includes("antecedentes.xhtml") ||
          !!document.getElementById("cedulaInput"),
      )
      .catch(() => false);
    if (ok) return;

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

// ─── Rellenar formulario ───────────────────────────────────────────────────────
async function rellenarFormulario(page, cedula, tipoCodigo) {
  await page.waitForFunction(
    () => window.location.href.includes("antecedentes.xhtml"),
    { timeout: 10000 },
  );
  await page.waitForSelector("#cedulaInput", { timeout: 10000 });
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.waitForSelector("#cedulaTipo", { timeout: 5000 });
    await page.select("#cedulaTipo", tipoCodigo);
    await sleep(400);
  } catch (_) {}

  const ok = await page.evaluate((num) => {
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

  if (!ok) {
    await page.click("#cedulaInput", { clickCount: 3 });
    await page.type("#cedulaInput", String(cedula), { delay: 40 });
  }
  await sleep(500);
  console.log("[Policía] ✅ Formulario llenado — esperando token del captcha");
}

// ─── Inyectar token y enviar formulario ───────────────────────────────────────
async function inyectarTokenYEnviar(page, token) {
  console.log("[Policía] 💉 Inyectando token...");
  await page.evaluate((t) => {
    document.querySelectorAll('[name="g-recaptcha-response"]').forEach((el) => {
      el.value = t;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }, token);
  await sleep(300);

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

// ─── Extraer resultado ────────────────────────────────────────────────────────
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

// ─── Notificar via SSE a todos los clientes esperando ─────────────────────────
function notificarSSE(sesion, evento, datos) {
  const payload = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const res of sesion.sseClients || []) {
    try {
      res.write(payload);
      res.end();
    } catch (_) {}
  }
  sesion.sseClients = [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR PRINCIPAL — Primera llamada (sin token)
// ═══════════════════════════════════════════════════════════════════════════════
exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "CC", captchaToken, sessionId } = req.body;

  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  // ── Segunda llamada: frontend envía el token resuelto por la extensión ──────
  if (captchaToken && sessionId) {
    return exports.resolverConToken(req, res);
  }

  const tipoCodigo = TIPO_MAP[tipoDocumento] || "cc";
  const identificacion = String(cedula).replace(/[.,]/g, "");
  console.log(`\n=== Policía: cedula=${identificacion} tipo=${tipoCodigo} ===`);

  let browser = null;
  let page = null;

  try {
    browser = await lanzarBrowser();
    page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    );

    await aceptarTerminos(page);
    await rellenarFormulario(page, identificacion, tipoCodigo);

    // Guardar sesión — browser y page permanecen abiertos esperando el token
    const id = uuidv4();
    sesiones.set(id, {
      browser,
      page,
      cedula: identificacion,
      tipoCodigo,
      sseClients: [],
      creadoEn: Date.now(),
    });

    // No cerrar browser ni page — la sesión los mantiene vivos
    browser = null;
    page = null;

    console.log(`[Policía] ⏸️ Sesión creada: ${id}`);
    return res.json({
      requiereCaptcha: true,
      sessionId: id,
      // URL que el frontend abre en un popup para que rektcaptcha actúe
      popupUrl:
        "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml",
      mensaje: "Completa el captcha en la ventana que se abrirá.",
    });
  } catch (error) {
    console.error("[Policía] ❌ Error preparando sesión:", error.message);
    return res
      .status(502)
      .json({
        error: "Error consultando Policía Nacional",
        detalle: error.message,
      });
  } finally {
    if (page && !page.isClosed()) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR SSE — El frontend escucha aquí mientras espera el resultado
// ═══════════════════════════════════════════════════════════════════════════════
exports.captchaStatus = (req, res) => {
  const { sessionId } = req.params;
  const sesion = sesiones.get(sessionId);

  if (!sesion) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Sesión no encontrada" }));
  }

  // Configurar SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Keepalive cada 20s para que el cliente no cierre la conexión
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch (_) {
      clearInterval(keepalive);
    }
  }, 20000);

  res.on("close", () => {
    clearInterval(keepalive);
    const s = sesiones.get(sessionId);
    if (s) s.sseClients = (s.sseClients || []).filter((c) => c !== res);
  });

  sesion.sseClients.push(res);
  console.log(`[Policía] 📡 SSE conectado para sesión: ${sessionId}`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR — Segunda llamada (con token del usuario)
// ═══════════════════════════════════════════════════════════════════════════════
exports.resolverConToken = async (req, res) => {
  const { sessionId, captchaToken } = req.body;

  if (!sessionId || !captchaToken)
    return res
      .status(400)
      .json({ error: "sessionId y captchaToken son requeridos." });

  const sesion = sesiones.get(sessionId);
  if (!sesion) {
    return res.status(410).json({
      error: "Sesión expirada o no encontrada.",
      detalle: "Intenta de nuevo.",
    });
  }

  const { browser, page, cedula, tipoCodigo } = sesion;
  sesiones.delete(sessionId); // Usar sesión una sola vez

  try {
    console.log(`[Policía] 🔑 Resolviendo sesión ${sessionId}`);
    await inyectarTokenYEnviar(page, captchaToken);
    const texto = await extraerResultado(page);

    const tieneAntecedentes = !texto
      .toUpperCase()
      .includes("NO TIENE ASUNTOS PENDIENTES");
    const ahora = new Date().toLocaleString("es-CO");
    const mensaje = tieneAntecedentes
      ? `Al ${ahora} se verifica que ${tipoCodigo.toUpperCase()} ${cedula} TIENE antecedentes judiciales.`
      : `Al ${ahora} se verifica que ${tipoCodigo.toUpperCase()} ${cedula} no tiene antecedentes judiciales.`;

    let screenshot = null;
    try {
      const buffer = await page.screenshot({
        fullPage: false,
        fromSurface: true,
      });
      screenshot = `data:image/png;base64,${buffer.toString("base64")}`;
    } catch (_) {}

    const resultado = {
      fuente: "Policía Nacional de Colombia",
      tieneAntecedentes,
      mensaje,
      screenshot,
    };

    // Notificar a clientes SSE que puedan estar escuchando
    notificarSSE(sesion, "resultado", resultado);

    await browser.close().catch(() => {});
    console.log(`[Policía] ✅ Consulta completada para ${cedula}`);
    return res.json(resultado);
  } catch (error) {
    console.error("[Policía] ❌ Error resolviendo con token:", error.message);
    notificarSSE(sesion, "error", { error: error.message });
    await browser?.close().catch(() => {});
    return res
      .status(502)
      .json({ error: "Error al procesar el captcha", detalle: error.message });
  }
};
