"use strict";

/**
 * policia.controller.js — Flujo con reCAPTCHA híbrido
 *
 * FLUJO:
 *  1. POST /api/consulta-antecedentes { cedula, tipoDocumento }
 *     → Abre Puppeteer, navega a index, acepta términos, llega a antecedentes.xhtml
 *     → Rellena formulario (cédula + tipo)
 *     → Hace click en el widget reCAPTCHA
 *        a) Si reCAPTCHA entrega token solo (sin puzzle):
 *           → Envía formulario → retorna resultado final
 *        b) Si lanza puzzle (iframe de desafío):
 *           → Abre el browser con pantalla (xvfb / display) para que el usuario vea
 *           → Responde al frontend: { requiereCaptcha: true, sessionId }
 *           → Deja el browser abierto y en espera
 *
 *  2. El frontend suscribe SSE a GET /api/captcha-status/:sessionId
 *     → Recibe evento "resuelto" cuando el usuario resolvió el puzzle
 *
 *  3. Una vez detectado el token (polling interno del browser):
 *     → Envía el formulario
 *     → Emite evento SSE "resultado" con los datos
 *     → Cierra browser
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

if (!puppeteer.plugins.some((p) => p.name === "stealth")) {
  puppeteer.use(StealthPlugin());
}

const INDEX_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";
const ANTECEDENTES_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml";

// ── Mapa de sesiones pendientes (sessionId → { browser, page, sseClients[] }) ─
const sesiones = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Tipo de documento → valor del select ──────────────────────────────────────
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

// ─── Lanzar browser ────────────────────────────────────────────────────────────
async function lanzarBrowser(headless = true) {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--ignore-certificate-errors",
    "--allow-running-insecure-content",
    "--disable-blink-features=AutomationControlled",
  ];

  if (!headless) {
    // Necesita Xvfb o display real para mostrar al usuario
    args.push("--start-maximized");
  }

  return puppeteer.launch({
    headless,
    ignoreHTTPSErrors: true,
    args,
    defaultViewport: headless ? { width: 1280, height: 800 } : null,
  });
}

// ─── Paso 1: navegar a index y aceptar términos ────────────────────────────────
async function aceptarTerminos(page) {
  console.log("[Policía] 🌐 Navegando a index.xhtml...");
  await page.goto(INDEX_URL, { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(2000);

  // Verificar si ya estamos en antecedentes.xhtml (sesión activa)
  if (page.url().includes("antecedentes.xhtml")) {
    console.log("[Policía] ✅ Ya en antecedentes.xhtml");
    return;
  }

  // Aceptar términos: radio "Sí acepto"
  console.log("[Policía] 📋 Aceptando términos...");
  try {
    await page.waitForSelector("#aceptaOption\\:0", { timeout: 10000 });
    await page.click("#aceptaOption\\:0");
    await sleep(1500);
  } catch (e) {
    console.warn("[Policía] ⚠️ Radio términos no encontrado:", e.message);
  }

  // Esperar que se habilite el botón continuar
  let btnActivo = false;
  for (let i = 0; i < 5; i++) {
    btnActivo = await page.evaluate(() => {
      const btn = document.querySelector("#continuarBtn");
      return (
        btn &&
        !btn.classList.contains("ui-state-disabled") &&
        !btn.hasAttribute("disabled")
      );
    });
    if (btnActivo) break;
    await sleep(1000);
  }

  if (!btnActivo) throw new Error("El botón Continuar no se activó.");

  // Click + esperar navegación
  console.log("[Policía] ▶️ Clickando Continuar...");
  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })
      .catch(() => null),
    page.click("#continuarBtn"),
  ]);

  await sleep(1500);

  if (!page.url().includes("antecedentes.xhtml")) {
    throw new Error(
      "No se llegó a antecedentes.xhtml. URL actual: " + page.url(),
    );
  }
  console.log("[Policía] ✅ En antecedentes.xhtml");
}

// ─── Paso 2: rellenar formulario (cédula + tipo) ───────────────────────────────
async function rellenarFormulario(page, cedula, tipoCodigo) {
  console.log(`[Policía] ✏️ Rellenando formulario: ${tipoCodigo} ${cedula}`);

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
  await page.click("#cedulaInput", { clickCount: 3 });
  await page.type("#cedulaInput", String(cedula), { delay: 40 });
  await sleep(300);
}

// ─── Paso 3: interactuar con reCAPTCHA ────────────────────────────────────────
/**
 * Hace click en el checkbox de reCAPTCHA y espera hasta MAX_WAIT ms.
 * Retorna el token si se resolvió automáticamente, o null si hay puzzle.
 */
async function clickCaptchaYEsperar(page, maxWait = 8000) {
  console.log("[Policía] 🤖 Interactuando con reCAPTCHA...");

  // Esperar que el iframe del captcha cargue
  await page
    .waitForFunction(
      () => !!document.querySelector('iframe[src*="recaptcha"]'),
      { timeout: 10000 },
    )
    .catch(() => console.warn("[Policía] ⚠️ iframe reCAPTCHA no encontrado"));

  // Click en el checkbox dentro del iframe
  const frames = page.frames();
  const captchaFrame = frames.find((f) =>
    f.url().includes("recaptcha/api2/anchor"),
  );

  if (captchaFrame) {
    try {
      await captchaFrame.waitForSelector("#recaptcha-anchor", {
        timeout: 5000,
      });
      await captchaFrame.click("#recaptcha-anchor");
      console.log("[Policía] ✅ Click en checkbox reCAPTCHA");
    } catch (e) {
      console.warn("[Policía] ⚠️ No se pudo hacer click en anchor:", e.message);
    }
  }

  // Esperar token o puzzle — polling cada 300ms
  const inicio = Date.now();
  while (Date.now() - inicio < maxWait) {
    const token = await page.evaluate(() => {
      const el = document.querySelector('[name="g-recaptcha-response"]');
      return el ? el.value : "";
    });
    if (token && token.length > 20) {
      console.log("[Policía] ✅ Token automático obtenido");
      return token;
    }

    // Detectar si apareció el iframe del puzzle
    const hayPuzzle = page
      .frames()
      .some((f) => f.url().includes("recaptcha/api2/bframe"));
    if (hayPuzzle) {
      console.log(
        "[Policía] 🧩 Puzzle detectado — requiere interacción humana",
      );
      return null;
    }

    await sleep(300);
  }

  // Timeout — verificar token de último momento
  const tokenFinal = await page.evaluate(() => {
    const el = document.querySelector('[name="g-recaptcha-response"]');
    return el ? el.value : "";
  });
  return tokenFinal && tokenFinal.length > 20 ? tokenFinal : null;
}

// ─── Paso 4: enviar formulario y obtener resultado ────────────────────────────
async function enviarYObtenerResultado(page, cedula, tipoCodigo) {
  console.log("[Policía] 🚀 Enviando formulario...");

  // Buscar y hacer click en el botón de consulta
  const btnClickado = await page.evaluate(() => {
    const candidatos = [
      ...document.querySelectorAll('button, input[type="submit"], a'),
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
  console.log("[Policía] 🖱️ Botón:", btnClickado);

  // Esperar resultado — hasta 20s
  await page
    .waitForFunction(
      () => {
        const body = document.body?.innerText?.toUpperCase() || "";
        return (
          body.includes("NO TIENE ASUNTOS PENDIENTES") ||
          body.includes("TIENE ASUNTOS PENDIENTES") ||
          body.includes("ANTECEDENTES") ||
          body.includes("ERROR") ||
          body.includes("CAPTCHA")
        );
      },
      { timeout: 20000 },
    )
    .catch(() => console.warn("[Policía] ⚠️ Timeout esperando resultado"));

  await sleep(1000);

  const texto = await page.evaluate(
    () => document.body?.innerText?.toUpperCase() || "",
  );
  console.log("[Policía] 📄 Texto resultado (200):", texto.substring(0, 200));

  // Verificar si el captcha fue rechazado
  if (
    texto.includes("CAPTCHA") &&
    !texto.includes("NO TIENE ASUNTOS") &&
    !texto.includes("TIENE ASUNTOS")
  ) {
    throw new Error("CAPTCHA_INVALIDO");
  }

  const tieneAntecedentes = !texto.includes("NO TIENE ASUNTOS PENDIENTES");
  const ahora = new Date().toLocaleString("es-CO");
  const tipoLabel = tipoCodigo.toUpperCase();

  let screenshot = "";
  try {
    const buf = await page.screenshot({ fullPage: false });
    screenshot = `data:image/png;base64,${buf.toString("base64")}`;
  } catch (_) {}

  return {
    fuente: "Policía Nacional de Colombia",
    tieneAntecedentes,
    mensaje: tieneAntecedentes
      ? `Al ${ahora} se verifica que ${tipoLabel} ${cedula} TIENE antecedentes judiciales.`
      : `Al ${ahora} se verifica que ${tipoLabel} ${cedula} NO tiene antecedentes judiciales.`,
    screenshot,
  };
}

// ─── Esperar token manualmente (polling hasta 5 minutos) ─────────────────────
async function esperarTokenManual(page, sessionId) {
  console.log(
    `[Policía] ⏳ Esperando resolución manual del captcha (session: ${sessionId})...`,
  );
  const MAX = 5 * 60 * 1000; // 5 min
  const inicio = Date.now();

  while (Date.now() - inicio < MAX) {
    // Verificar si la sesión fue cancelada
    if (!sesiones.has(sessionId)) {
      throw new Error("SESION_CANCELADA");
    }

    const token = await page
      .evaluate(() => {
        const el = document.querySelector('[name="g-recaptcha-response"]');
        return el ? el.value : "";
      })
      .catch(() => "");

    if (token && token.length > 20) {
      console.log(`[Policía] ✅ Token manual obtenido (${token.length} chars)`);
      return token;
    }

    await sleep(500);
  }

  throw new Error("TIMEOUT_CAPTCHA_MANUAL");
}

// ─── Emitir evento SSE a todos los clientes de una sesión ─────────────────────
function emitirSSE(sessionId, evento, datos) {
  const sesion = sesiones.get(sessionId);
  if (!sesion) return;
  const msg = `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
  sesion.sseClients.forEach((res) => {
    try {
      res.write(msg);
    } catch (_) {}
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "CC" } = req.body;

  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const tipoCodigo = TIPO_MAP[tipoDocumento] || "cc";
  const sessionId = `policia-${cedula}-${Date.now()}`;

  console.log(
    `\n=== Policía: cedula=${cedula} tipo=${tipoCodigo} session=${sessionId} ===`,
  );

  let browser;
  try {
    // ── 1. Lanzar en headless primero ────────────────────────────────────────
    browser = await lanzarBrowser(true);
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "accept-language": "es-CO,es;q=0.9" });

    // ── 2. Términos y formulario ──────────────────────────────────────────────
    await aceptarTerminos(page);
    await rellenarFormulario(page, cedula, tipoCodigo);

    // ── 3. Intentar captcha automático ────────────────────────────────────────
    const tokenAuto = await clickCaptchaYEsperar(page, 8000);

    if (tokenAuto) {
      // ── 3a. Captcha resuelto solo → enviar y responder ──────────────────────
      const resultado = await enviarYObtenerResultado(page, cedula, tipoCodigo);
      await browser.close();
      return res.json(resultado);
    }

    // ── 3b. Puzzle detectado — necesita resolución manual ─────────────────────
    // Cerrar browser headless y reabrir con pantalla
    await browser.close();
    browser = await lanzarBrowser(false);
    const pageVisible = await browser.newPage();
    await pageVisible.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    );

    // Guardar sesión
    sesiones.set(sessionId, { browser, page: pageVisible, sseClients: [] });

    // Repetir flujo en browser visible
    await aceptarTerminos(pageVisible);
    await rellenarFormulario(pageVisible, cedula, tipoCodigo);
    await clickCaptchaYEsperar(pageVisible, 3000); // solo para abrir el puzzle

    // Responder al frontend que necesita resolución manual
    res.json({
      requiereCaptcha: true,
      sessionId,
      mensaje:
        "Se abrió el navegador. Por favor resuelve el CAPTCHA y la consulta continuará automáticamente.",
    });

    // En background: esperar token, enviar formulario, emitir SSE
    esperarTokenManual(pageVisible, sessionId)
      .then(async () => {
        console.log(
          `[Policía] 📤 Enviando formulario tras captcha manual (${sessionId})`,
        );
        const resultado = await enviarYObtenerResultado(
          pageVisible,
          cedula,
          tipoCodigo,
        );
        emitirSSE(sessionId, "resultado", resultado);
        sesiones.delete(sessionId);
        await browser.close().catch(() => {});
      })
      .catch(async (err) => {
        console.error(`[Policía] ❌ Error tras captcha manual: ${err.message}`);
        emitirSSE(sessionId, "error", { error: err.message });
        sesiones.delete(sessionId);
        await browser.close().catch(() => {});
      });
  } catch (error) {
    console.error("❌ ERROR POLICÍA:", error.message);
    if (browser) await browser.close().catch(() => {});
    sesiones.delete(sessionId);
    return res.status(502).json({
      error: "Error consultando Policía",
      detalle: error.message,
    });
  }
};

// ─── SSE: el frontend se suscribe para recibir el resultado cuando hay puzzle ──
exports.captchaStatus = (req, res) => {
  const { sessionId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Keepalive cada 15s
  const keepalive = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch (_) {
      clearInterval(keepalive);
    }
  }, 15000);

  const sesion = sesiones.get(sessionId);
  if (!sesion) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ error: "Sesión no encontrada" })}\n\n`,
    );
    clearInterval(keepalive);
    res.end();
    return;
  }

  sesion.sseClients.push(res);
  console.log(
    `[Policía] 📡 SSE conectado (${sessionId}) — clientes: ${sesion.sseClients.length}`,
  );

  req.on("close", () => {
    clearInterval(keepalive);
    const s = sesiones.get(sessionId);
    if (s) s.sseClients = s.sseClients.filter((c) => c !== res);
    console.log(`[Policía] 📡 SSE desconectado (${sessionId})`);
  });
};
