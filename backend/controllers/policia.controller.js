"use strict";
/**
 * policia.controller.js
 *
 * Flujo completo automático (sin popup, sin extensión):
 *  1. Navega y llena el formulario
 *  2. Hace clic en el checkbox del reCAPTCHA
 *  3. Espera el challenge visual (bframe) — Google siempre lo muestra en IPs de datacenter
 *  4. Dentro del bframe hace clic en el botón de audio para cambiar de modalidad
 *  5. Descarga el MP3 y lo transcribe con Wit.ai
 *  6. Ingresa la solución y verifica
 *  7. Si falla → fallback al popup manual
 *
 * Requiere variable de entorno: WIT_AI_API_KEY
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
const sesiones = new Map();
const SESION_TTL_MS = 10 * 60 * 1000;

setInterval(
  () => {
    const ahora = Date.now();
    for (const [id, s] of sesiones.entries()) {
      if (ahora - s.creadoEn > SESION_TTL_MS) {
        console.log(`[Policía] 🧹 Sesión expirada: ${id}`);
        s.browser?.close().catch(() => {});
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

// ─── Xvfb helper (solo Linux local sin display) ───────────────────────────────
let xvfbInstance = null;

async function asegurarDisplay() {
  if (process.platform !== "linux") return;
  if (process.env.DISPLAY) return;
  if (xvfbInstance) return;

  let Xvfb;
  try {
    Xvfb = require("xvfb");
  } catch (_) {
    throw new Error("Xvfb no disponible — instala el paquete 'xvfb'");
  }

  xvfbInstance = new Xvfb({
    displayNum: 99,
    silent: true,
    xvfb_args: ["-screen", "0", "1920x1080x24", "-ac"],
  });

  await new Promise((resolve, reject) => {
    xvfbInstance.start((err) => (err ? reject(err) : resolve()));
  });

  process.env.DISPLAY = ":99";
  console.log("[Policía] 🖥️  Xvfb iniciado en DISPLAY=:99");

  process.once("exit", () => xvfbInstance?.stop());
  process.once("SIGINT", () => {
    xvfbInstance?.stop();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    xvfbInstance?.stop();
    process.exit(0);
  });
}

// ─── Lanzar browser ────────────────────────────────────────────────────────────
async function lanzarBrowser() {
  if (process.env.RENDER) {
    console.log("[Policía] 🌐 Render — @sparticuz/chromium headless");
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
    await asegurarDisplay();
    console.log("[Policía] 🔌 Local + extensión rektcaptcha");
    args.push(
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    );
    ignoreDefaultArgs.push("--disable-extensions");
  } else {
    console.log("[Policía] 💻 Local sin extensión — headless");
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
  console.log("[Policía] ✅ Formulario llenado — resolviendo captcha...");
}

// ─── Esperar bframe con reintentos ────────────────────────────────────────────
// En IPs de datacenter Google siempre muestra el challenge visual primero.
// El bframe puede tardar varios segundos en aparecer tras el click en el checkbox.
async function esperarBframe(page, timeoutMs = 20000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const bFrame = page
      .frames()
      .find(
        (f) =>
          f.url().includes("recaptcha/api2/bframe") ||
          f.url().includes("recaptcha/enterprise/bframe"),
      );
    if (bFrame) return bFrame;
    await sleep(500);
  }
  throw new Error("bframe del captcha no apareció en " + timeoutMs + "ms");
}

// ─── Resolver captcha por audio con Wit.ai ────────────────────────────────────
async function resolverCaptchaAudio(page) {
  const apiKey = process.env.WIT_AI_API_KEY;
  if (!apiKey) throw new Error("WIT_AI_API_KEY no configurada");

  console.log("[Policía] 🎧 Resolviendo captcha por audio...");

  // 1. Esperar iframe anchor
  await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 15000 });
  await sleep(1000);

  // 2. Clic en el checkbox (anchor frame)
  const anchorFrame = page
    .frames()
    .find(
      (f) =>
        f.url().includes("recaptcha/api2/anchor") ||
        f.url().includes("recaptcha/enterprise/anchor"),
    );
  if (!anchorFrame) throw new Error("iframe anchor del captcha no encontrado");

  await anchorFrame.waitForSelector("#recaptcha-anchor", { timeout: 10000 });
  await anchorFrame.click("#recaptcha-anchor");
  console.log("[Policía] ☑️  Checkbox clickeado — esperando challenge...");
  await sleep(2000);

  // 3. Verificar si se resolvió sin challenge (raro en datacenter, pero posible)
  const resueltoDirecto = await anchorFrame
    .evaluate(() => {
      const el = document.querySelector("#recaptcha-anchor");
      return el && el.getAttribute("aria-checked") === "true";
    })
    .catch(() => false);

  if (resueltoDirecto) {
    console.log("[Policía] ✅ Captcha resuelto sin challenge");
    return await obtenerToken(page);
  }

  // 4. Esperar el bframe del challenge (visual de imágenes)
  console.log(
    "[Policía] 🖼️  Challenge visual detectado — cambiando a audio...",
  );
  const bFrame = await esperarBframe(page, 20000);

  // 5. Detectar bloqueo inmediato
  const bloqueado = await bFrame
    .evaluate(() => !!document.querySelector(".rc-doscaptcha-body"))
    .catch(() => false);
  if (bloqueado) throw new Error("Google bloqueó el captcha desde esta IP");

  // 6. Dentro del challenge visual, hacer clic en el botón de audio
  //    El botón está en la barra inferior del challenge (#recaptcha-audio-button)
  await bFrame.waitForSelector("#recaptcha-audio-button", { timeout: 15000 });
  await bFrame.click("#recaptcha-audio-button");
  console.log("[Policía] 🔊 Cambiado a audio challenge");
  await sleep(2000);

  // 7. Volver a verificar bloqueo (Google puede mostrar el doscaptcha tras pedir audio)
  const bloqueadoTras = await bFrame
    .evaluate(() => !!document.querySelector(".rc-doscaptcha-body"))
    .catch(() => false);
  if (bloqueadoTras)
    throw new Error("Google bloqueó el audio challenge desde esta IP");

  // 8. Esperar que aparezca el elemento de audio
  let audioUrl = null;
  for (let i = 0; i < 15; i++) {
    audioUrl = await bFrame
      .evaluate(() => {
        const audio = document.querySelector("audio#audio-source");
        return audio && audio.src ? audio.src : null;
      })
      .catch(() => null);
    if (audioUrl) break;
    await sleep(1000);
  }
  if (!audioUrl) throw new Error("URL del audio del captcha no encontrada");

  console.log("[Policía] 🎵 Audio URL obtenida — transcribiendo...");

  // 9. Descargar el audio desde el contexto del browser (evita restricciones CORS)
  const audioArray = await page.evaluate(async (url) => {
    const resp = await fetch(url, { credentials: "omit" });
    const buf = await resp.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }, audioUrl);

  const buffer = Buffer.from(audioArray);

  // 10. Enviar a Wit.ai para transcripción
  console.log("[Policía] 📤 Enviando audio a Wit.ai...");
  const witResponse = await fetch("https://api.wit.ai/speech?v=20240304", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "audio/mpeg3",
    },
    body: buffer,
  });

  if (!witResponse.ok) {
    const err = await witResponse.text().catch(() => "");
    throw new Error(`Wit.ai error ${witResponse.status}: ${err}`);
  }

  const rawText = await witResponse.text();
  // Wit.ai devuelve múltiples JSON separados por \r\n — tomar el último
  const lastLine = rawText.split("\r\n").filter(Boolean).at(-1);
  const witData = JSON.parse(lastLine);
  const solucion = witData?.text?.trim();

  if (!solucion) throw new Error("Wit.ai no pudo transcribir el audio");

  console.log(`[Policía] 💬 Solución: "${solucion}"`);

  // 11. Ingresar la solución
  await bFrame.waitForSelector("#audio-response", { timeout: 5000 });
  await bFrame.click("#audio-response");
  await bFrame.type("#audio-response", solucion, { delay: 50 });
  await sleep(300);

  // 12. Verificar
  await bFrame.click("#recaptcha-verify-button");
  console.log("[Policía] ✔️  Verify enviado — esperando validación...");
  await sleep(3000);

  // 13. Comprobar si la respuesta fue incorrecta
  const incorrecto = await bFrame
    .evaluate(() => {
      const err = document.querySelector(".rc-audiochallenge-error-message");
      return err && err.offsetParent !== null;
    })
    .catch(() => false);
  if (incorrecto) throw new Error("Solución de audio incorrecta según Google");

  // 14. Obtener el token final
  return await obtenerToken(page);
}

// ─── Obtener g-recaptcha-response ─────────────────────────────────────────────
async function obtenerToken(page) {
  let token = null;
  for (let i = 0; i < 15; i++) {
    token = await page
      .evaluate(() => {
        const el = document.querySelector('[name="g-recaptcha-response"]');
        return el && el.value && el.value.length > 20 ? el.value : null;
      })
      .catch(() => null);
    if (token) break;
    await sleep(1000);
  }
  if (!token)
    throw new Error("Token reCAPTCHA no obtenido tras la verificación");
  console.log("[Policía] 🎟️  Token reCAPTCHA obtenido");
  return token;
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

// ─── Notificar SSE ────────────────────────────────────────────────────────────
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
// CONTROLADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "CC", captchaToken, sessionId } = req.body;

  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

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

    // ── Intentar resolver automáticamente ────────────────────────────────────
    let token;
    try {
      token = await resolverCaptchaAudio(page);
    } catch (captchaErr) {
      console.error(
        "[Policía] ❌ Auto-captcha falló:",
        captchaErr.message,
        "— activando fallback manual",
      );

      const id = uuidv4();
      sesiones.set(id, {
        browser,
        page,
        cedula: identificacion,
        tipoCodigo,
        sseClients: [],
        creadoEn: Date.now(),
      });
      browser = null;
      page = null;

      const backendBase =
        process.env.BACKEND_URL || "https://modulos-backend.onrender.com";

      return res.json({
        requiereCaptcha: true,
        sessionId: id,
        popupUrl: `${backendBase}/api/policia-captcha-bridge/${id}`,
        mensaje:
          "No se pudo resolver el captcha automáticamente. Complétalo manualmente.",
        errorAuto: captchaErr.message,
      });
    }

    // ── Enviar formulario y extraer resultado ─────────────────────────────────
    await inyectarTokenYEnviar(page, token);
    const texto = await extraerResultado(page);

    const tieneAntecedentes = !texto
      .toUpperCase()
      .includes("NO TIENE ASUNTOS PENDIENTES");
    const ahora = new Date().toLocaleString("es-CO");
    const mensaje = tieneAntecedentes
      ? `Al ${ahora} se verifica que ${tipoCodigo.toUpperCase()} ${identificacion} TIENE antecedentes judiciales.`
      : `Al ${ahora} se verifica que ${tipoCodigo.toUpperCase()} ${identificacion} no tiene antecedentes judiciales.`;

    let screenshot = null;
    try {
      const buffer = await page.screenshot({
        fullPage: false,
        fromSurface: true,
      });
      screenshot = `data:image/png;base64,${buffer.toString("base64")}`;
    } catch (_) {}

    await browser.close().catch(() => {});
    console.log(`[Policía] ✅ Consulta completada para ${identificacion}`);

    return res.json({
      fuente: "Policía Nacional de Colombia",
      tieneAntecedentes,
      mensaje,
      screenshot,
    });
  } catch (error) {
    console.error("[Policía] ❌ Error general:", error.message);
    if (page && !page.isClosed()) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    return res.status(502).json({
      error: "Error consultando Policía Nacional",
      detalle: error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA BRIDGE — Fallback manual
// ═══════════════════════════════════════════════════════════════════════════════
exports.captchaBridge = (req, res) => {
  const { sessionId } = req.params;

  if (!sesiones.has(sessionId)) {
    return res
      .status(410)
      .send(
        "<h2>Sesión expirada. Cierra esta ventana e intenta de nuevo.</h2>",
      );
  }

  const backendBase =
    process.env.BACKEND_URL || "https://modulos-backend.onrender.com";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Verificación - Policía Nacional</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d1b2a; color: #fff;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #1a2744; border-radius: 16px; padding: 40px 32px;
      max-width: 480px; width: 90%; text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    h1 { font-size: 22px; font-weight: 700; margin: 16px 0 8px; }
    p { color: #aab; font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
    .status {
      background: #0d1b2a; border-radius: 10px; padding: 16px;
      margin: 16px 0; font-size: 14px; color: #7df;
      display: flex; align-items: center; gap: 12px;
    }
    .spinner {
      width: 20px; height: 20px; border: 2px solid #334;
      border-top-color: #7df; border-radius: 50%;
      animation: spin 0.8s linear infinite; flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .success { font-size: 40px; margin: 12px 0; }
    #successMsg { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px">🛡️</div>
    <h1>Verificación manual requerida</h1>
    <div id="waitingMsg">
      <p>
        El sistema no pudo resolver el captcha automáticamente.<br>
        Se abrirá la página de la Policía. <strong>La extensión rektcaptcha</strong>
        resolverá el captcha y esta ventana se cerrará sola.
      </p>
      <div class="status">
        <div class="spinner"></div>
        <span id="statusText">Preparando verificación...</span>
      </div>
    </div>
    <div id="successMsg">
      <div class="success">✅</div>
      <p style="color:#4caf50; font-size:16px; margin-top:8px">
        ¡Captcha resuelto! Cerrando ventana...
      </p>
    </div>
  </div>
  <script>
    const SESSION_ID = "${sessionId}";
    const BACKEND   = "${backendBase}";
    const POLICIA_URL = "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";

    function guardarSesion() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ policiaSessionId: SESSION_ID, policiaBackendUrl: BACKEND }, () => {
          document.getElementById("statusText").textContent = "Abriendo portal de la Policía...";
          abrirPolicia();
        });
      } else {
        document.getElementById("statusText").textContent = "Instala rektcaptcha para resolución automática.";
        abrirPolicia();
      }
    }

    function abrirPolicia() {
      const win = window.open(POLICIA_URL, "_blank");
      if (!win) {
        document.getElementById("statusText").textContent = "⚠️ Permite ventanas emergentes e intenta de nuevo.";
        return;
      }
      document.getElementById("statusText").textContent =
        "Esperando que rektcaptcha resuelva el captcha...";
      const interval = setInterval(async () => {
        try {
          const r = await fetch(BACKEND + "/api/captcha-resuelto/" + SESSION_ID);
          const data = await r.json();
          if (data.resuelto) {
            clearInterval(interval);
            if (win && !win.closed) win.close();
            document.getElementById("waitingMsg").style.display = "none";
            document.getElementById("successMsg").style.display = "block";
            setTimeout(() => window.close(), 2000);
          }
        } catch (_) {}
      }, 2000);
      setTimeout(() => { clearInterval(interval); window.close(); }, 5 * 60 * 1000);
    }

    window.onload = guardarSesion;
  </script>
</body>
</html>`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// Endpoints de soporte
// ═══════════════════════════════════════════════════════════════════════════════
exports.captchaConfirmado = async (req, res) => {
  const { sessionId } = req.params;
  const sesion = sesiones.get(sessionId);
  if (!sesion) return res.json({ ok: false, error: "Sesión expirada" });
  notificarSSE(sesion, "captcha_listo", { sessionId });
  return res.json({ ok: true });
};

exports.captchaResuelto = (req, res) => {
  const { sessionId } = req.params;
  res.json({ resuelto: !sesiones.has(sessionId) });
};

exports.captchaStatus = (req, res) => {
  const { sessionId } = req.params;
  const sesion = sesiones.get(sessionId);

  if (!sesion) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Sesión no encontrada" }));
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

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

exports.resolverConToken = async (req, res) => {
  const { sessionId, captchaToken } = req.body;

  if (!sessionId || !captchaToken)
    return res
      .status(400)
      .json({ error: "sessionId y captchaToken son requeridos." });

  const sesion = sesiones.get(sessionId);
  if (!sesion)
    return res
      .status(410)
      .json({ error: "Sesión expirada. Intenta de nuevo." });

  const { browser, page, cedula, tipoCodigo } = sesion;
  sesiones.delete(sessionId);

  try {
    console.log(`[Policía] 🔑 Resolviendo sesión manual ${sessionId}`);
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
    notificarSSE(sesion, "resultado", resultado);
    await browser.close().catch(() => {});
    console.log(`[Policía] ✅ Consulta completada para ${cedula}`);
    return res.json(resultado);
  } catch (error) {
    console.error("[Policía] ❌ Error resolviendo con token:", error.message);
    notificarSSE(sesion, "error", { error: error.message });
    await browser?.close().catch(() => {});
    return res.status(502).json({
      error: "Error al procesar el captcha",
      detalle: error.message,
    });
  }
};
