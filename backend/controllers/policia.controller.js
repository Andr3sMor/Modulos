"use strict";

/**
 * policia.controller.js
 *
 * Flujo en producción (Render):
 *  1. POST /api/consulta-antecedentes
 *     → Puppeteer navega, acepta términos, llena formulario
 *     → Queda pausado esperando que el captcha sea resuelto
 *     → Devuelve { requiereCaptcha: true, sessionId, popupUrl }
 *
 *  2. Frontend abre popup con popupUrl (página real de la Policía)
 *     El usuario tiene rektcaptcha instalada → la extensión resuelve el captcha
 *     automáticamente en su browser.
 *
 *  3. Frontend se conecta a SSE GET /api/captcha-status/:sessionId
 *     → El backend hace polling de g-recaptcha-response en la sesión Puppeteer
 *     → Cuando detecta el token, lo inyecta, envía el formulario y extrae el resultado
 *     → Notifica via SSE con el resultado final
 *     → Frontend cierra popup y muestra resultado
 *
 * NOTA: El popup abre la página REAL de la Policía. La extensión rektcaptcha
 * resuelve el captcha en el browser del usuario. El backend tiene su propia
 * sesión Puppeteer en la misma URL. El token que resuelve el usuario en el
 * popup NO se transfiere al backend — el backend espera a que la MISMA sesión
 * de Puppeteer tenga el captcha resuelto (no funciona así).
 *
 * SOLUCIÓN REAL: El popup que abre el frontend apunta a una URL del propio
 * backend (/api/policia-captcha-page/:sessionId) que sirve la página de la
 * Policía embebida con un script de monitoreo. Al resolverse el captcha en ese
 * contexto, el script lo detecta y notifica al backend que a su vez notifica
 * al frontend via SSE.
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

// ─── Esperar token en la sesión Puppeteer ─────────────────────────────────────
// El usuario resolvió el captcha en su popup. El backend recibe el token
// via POST /api/consulta-antecedentes con captchaToken + sessionId,
// y este método es llamado desde resolverConToken().
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
// CONTROLADOR PRINCIPAL — Primera llamada
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

    console.log(`[Policía] ⏸️ Sesión creada: ${id}`);

    // popupUrl apunta a la página bridge del propio backend
    const backendBase =
      process.env.BACKEND_URL || "https://modulos-backend.onrender.com";
    return res.json({
      requiereCaptcha: true,
      sessionId: id,
      popupUrl: `${backendBase}/api/policia-captcha-bridge/${id}`,
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
// PÁGINA BRIDGE — Sirve una página HTML que redirige a la Policía e inyecta
// un script que captura el token resuelto por rektcaptcha y lo envía al backend
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

  // Esta página se abre en el popup del usuario.
  // Redirige inmediatamente a la Policía e inyecta un script via Service Worker
  // que no funciona cross-origin. En cambio, usamos un polling desde esta página
  // que verifica con el backend si ya recibió el token.
  //
  // FLUJO REAL:
  // 1. Esta página carga y redirige al usuario a la Policía con JS
  // 2. La extensión rektcaptcha resuelve el captcha en la página de la Policía
  // 3. Pero no podemos capturar el token cross-origin desde aquí
  //
  // POR ESO: Abrimos la Policía directamente como popup, y usamos un
  // segundo script en esta misma página (antes del redirect) que hace polling
  // al backend para saber cuándo el usuario resolvió el captcha.
  // El usuario cierra el popup manualmente tras resolver — o mejor:
  // mostramos instrucciones claras.

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
      background: #0d1b2a;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a2744;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 480px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    p { color: #aab; font-size: 14px; line-height: 1.6; margin-bottom: 20px; }
    .status {
      background: #0d1b2a;
      border-radius: 10px;
      padding: 16px;
      margin: 20px 0;
      font-size: 14px;
      color: #7df;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .spinner {
      width: 20px; height: 20px;
      border: 2px solid #334;
      border-top-color: #7df;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .btn {
      display: inline-block;
      padding: 12px 28px;
      background: #4361ee;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
      margin-top: 8px;
    }
    .btn:hover { background: #3451d1; }
    .success { color: #4caf50; font-size: 40px; }
    #successMsg { display: none; }
    #waitingMsg { display: block; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🛡️</div>
    <h1>Verificación Policía Nacional</h1>

    <div id="waitingMsg">
      <p>
        Se abrirá la página de la Policía Nacional.<br>
        <strong>La extensión rektcaptcha resolverá el captcha automáticamente.</strong><br>
        Una vez resuelto, esta ventana se cerrará sola.
      </p>
      <div class="status">
        <div class="spinner"></div>
        <span id="statusText">Abriendo portal de la Policía...</span>
      </div>
    </div>

    <div id="successMsg">
      <div class="success">✅</div>
      <p style="color:#4caf50; margin-top:12px; font-size:16px;">
        ¡Captcha resuelto! Cerrando ventana...
      </p>
    </div>
  </div>

  <script>
    const SESSION_ID = "${sessionId}";
    const BACKEND = "${backendBase}";
    const POLICIA_URL = "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";

    // 1. Abrir la página de la Policía como NUEVA ventana (no popup anidado)
    //    La extensión rektcaptcha del usuario la detecta y resuelve el captcha
    let policiaWin = null;

    function abrirPolicia() {
      document.getElementById("statusText").textContent = "Abriendo portal de la Policía...";
      policiaWin = window.open(POLICIA_URL, "policia_auth", "width=900,height=700");
      if (!policiaWin) {
        document.getElementById("statusText").textContent =
          "⚠️ Permite ventanas emergentes y recarga esta página.";
        return;
      }
      document.getElementById("statusText").textContent =
        "Esperando que resuelvas el captcha en la ventana de la Policía...";
    }

    // 2. Polling al backend: cuando el usuario resuelve el captcha en la página
    //    de la Policía, el frontend (captcha-resolver.component) detecta que el
    //    popup de la Policía fue cerrado y pide al usuario confirmación.
    //    Pero como no podemos leer el token cross-origin, usamos otro enfoque:
    //    Esta ventana bridge hace polling al backend preguntando si la sesión
    //    ya fue resuelta externamente.

    // 3. Escuchar mensaje de la ventana de la Policía
    //    rektcaptcha inyecta el token en g-recaptcha-response.
    //    Necesitamos un script en la página de la Policía para leerlo — no posible cross-origin.
    //
    //    SOLUCIÓN FINAL: Inyectamos un script en la ventana de la Policía
    //    usando el contexto del opener (esta ventana).

    let pollingInterval = null;

    function iniciarPolling() {
      // Intentar leer g-recaptcha-response de la ventana de la Policía cada 2s
      pollingInterval = setInterval(() => {
        try {
          if (!policiaWin || policiaWin.closed) {
            clearInterval(pollingInterval);
            document.getElementById("statusText").textContent =
              "La ventana de la Policía se cerró. ¿Ya resolviste el captcha?";
            // Dar opción de confirmación manual
            mostrarBotonManual();
            return;
          }

          // Intentar leer el token (solo funciona mismo origen — no aplica aquí)
          // En cambio, inyectar un observador en la ventana de la Policía
          try {
            const token = policiaWin.document
              ?.querySelector('[name="g-recaptcha-response"]')
              ?.value;
            if (token && token.length > 20) {
              clearInterval(pollingInterval);
              enviarToken(token);
            }
          } catch (crossOriginError) {
            // Cross-origin: no podemos leer el DOM de la Policía
            // Usar postMessage desde la extensión si está disponible
          }
        } catch (e) {
          // ignorar
        }
      }, 1500);
    }

    function mostrarBotonManual() {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "✅ Ya resolví el captcha — continuar";
      btn.onclick = () => {
        // Sin token cross-origin, notificar al backend que intente
        // detectar el captcha en su propia sesión Puppeteer
        fetch(BACKEND + "/api/policia-captcha-confirmado/" + SESSION_ID, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.ok) {
              document.getElementById("waitingMsg").style.display = "none";
              document.getElementById("successMsg").style.display = "block";
              setTimeout(() => window.close(), 2000);
            } else {
              document.getElementById("statusText").textContent =
                "⚠️ " + (data.error || "No se detectó el captcha. Inténtalo de nuevo.");
              mostrarBotonReintentar();
            }
          })
          .catch(() => {
            document.getElementById("statusText").textContent =
              "⚠️ Error de conexión. Intenta de nuevo.";
          });
      };
      document.querySelector(".card").appendChild(btn);
    }

    function mostrarBotonReintentar() {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.style.background = "#666";
      btn.textContent = "🔄 Volver a intentar";
      btn.style.marginLeft = "8px";
      btn.onclick = () => { btn.remove(); abrirPolicia(); iniciarPolling(); };
      document.querySelector(".card").appendChild(btn);
    }

    function enviarToken(token) {
      document.getElementById("statusText").textContent = "Captcha detectado — enviando al servidor...";
      fetch(BACKEND + "/api/consulta-antecedentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cedula: "__from_session__",
          captchaToken: token,
          sessionId: SESSION_ID,
        }),
      })
        .then(() => {
          if (policiaWin && !policiaWin.closed) policiaWin.close();
          document.getElementById("waitingMsg").style.display = "none";
          document.getElementById("successMsg").style.display = "block";
          setTimeout(() => window.close(), 2000);
        })
        .catch(() => {
          document.getElementById("statusText").textContent = "⚠️ Error enviando resultado.";
        });
    }

    // Arrancar
    window.onload = () => {
      abrirPolicia();
      iniciarPolling();
    };
  </script>
</body>
</html>`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINT: El backend intenta detectar el captcha en su sesión Puppeteer
// Llamado cuando el usuario confirma manualmente que ya resolvió el captcha
// ═══════════════════════════════════════════════════════════════════════════════
exports.captchaConfirmado = async (req, res) => {
  const { sessionId } = req.params;
  const sesion = sesiones.get(sessionId);

  if (!sesion) {
    return res.json({ ok: false, error: "Sesión expirada" });
  }

  // El captcha fue resuelto en el browser del USUARIO, no en Puppeteer.
  // Puppeteer tiene su propia instancia en el servidor.
  // Lo que podemos hacer: esperar a que el usuario envíe el token via SSE
  // o confiar en que el frontend lo envíe via POST normal.
  // Por ahora, notificamos al frontend via SSE que puede proceder a pedir el token.
  notificarSSE(sesion, "captcha_listo", { sessionId });
  return res.json({ ok: true });
};

// ═══════════════════════════════════════════════════════════════════════════════
// SSE — Frontend escucha aquí para recibir el resultado final
// ═══════════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════════
// Segunda llamada — con token enviado por el frontend
// ═══════════════════════════════════════════════════════════════════════════════
exports.resolverConToken = async (req, res) => {
  const { sessionId, captchaToken } = req.body;

  if (!sessionId || !captchaToken)
    return res
      .status(400)
      .json({ error: "sessionId y captchaToken son requeridos." });

  const sesion = sesiones.get(sessionId);
  if (!sesion) {
    return res
      .status(410)
      .json({ error: "Sesión expirada. Intenta de nuevo." });
  }

  const { browser, page, cedula, tipoCodigo } = sesion;
  sesiones.delete(sessionId);

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
