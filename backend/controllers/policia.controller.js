/**
 * policia.controller.js
 *
 * Flujo:
 * 1. /api/policia/iniciar  — Puppeteer llena el formulario, llega al captcha,
 *                            toma screenshot y lo guarda en memoria con un sessionId
 * 2. /api/policia/screenshot/:id — devuelve el screenshot actual como imagen
 * 3. /api/policia/clic/:id — recibe {x, y} y hace clic en esa coordenada del browser
 * 4. /api/policia/resultado/:id — devuelve el resultado cuando ya está listo
 */

const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const POLICIA_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";
const POLICIA_FORM =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml";

// Sesiones activas en memoria { sessionId: { browser, page, status, resultado, xvfb } }
const sesiones = new Map();

function getChromiumPath() {
  const candidates = [
    ...(() => {
      try {
        const base = path.join(
          require("os").homedir(),
          ".cache/puppeteer/chrome",
        );
        if (!fs.existsSync(base)) return [];
        return fs
          .readdirSync(base)
          .map((v) => path.join(base, v, "chrome-linux64", "chrome"))
          .filter((p) => fs.existsSync(p));
      } catch {
        return [];
      }
    })(),
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/nix/store/khk7xpgsm5insk81azy9d560yq4npf77-chromium-131.0.6778.204/bin/chromium-browser",
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error("No se encontró Chromium.");
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

// Lanzar Xvfb en un display virtual y devolver el proceso + display number
function iniciarXvfb() {
  return new Promise((resolve, reject) => {
    const display = `:${Math.floor(Math.random() * 100) + 10}`;
    const xvfb = spawn(
      "Xvfb",
      [display, "-screen", "0", "1280x900x24", "-ac"],
      {
        detached: false,
        stdio: "ignore",
      },
    );
    xvfb.on("error", reject);
    // Dar tiempo a que Xvfb arranque
    setTimeout(() => resolve({ xvfb, display }), 800);
  });
}

async function waitForNetworkIdle(page, idleMs = 1000, timeout = 15000) {
  await page.waitForNetworkIdle({ idleTime: idleMs, timeout }).catch(() => {});
}

// ── POST /api/policia/iniciar ─────────────────────────────────────────────────
exports.iniciar = async (req, res) => {
  const { cedula, tipoDocumento = "cc" } = req.body;
  if (!cedula) return res.status(400).json({ error: "cedula requerida" });

  const tipoMap = {
    "Cédula de Ciudadanía": "Cédula de Ciudadanía",
    "Cédula de Extranjería": "Cédula de Extranjería",
    Pasaporte: "Pasaporte",
    cc: "Cédula de Ciudadanía",
    cx: "Cédula de Extranjería",
    pa: "Pasaporte",
  };
  const tipoValor = tipoMap[tipoDocumento] || "Cédula de Ciudadanía";

  const sessionId = randomId();
  console.log(`[${sessionId}] Iniciando consulta para: ${cedula}`);

  // Responder inmediatamente con el sessionId
  res.json({ sessionId, mensaje: "Cargando formulario..." });

  // Proceso en background
  (async () => {
    let xvfbProc = null;
    let display = null;
    let browser = null;

    try {
      // Iniciar pantalla virtual
      const xvfbResult = await iniciarXvfb();
      xvfbProc = xvfbResult.xvfb;
      display = xvfbResult.display;
      console.log(`[${sessionId}] Xvfb en display ${display}`);

      const executablePath = getChromiumPath();
      browser = await puppeteer.launch({
        executablePath,
        headless: false,
        env: { ...process.env, DISPLAY: display },
        ignoreHTTPSErrors: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--ignore-certificate-errors",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1280,900",
        ],
        defaultViewport: { width: 1280, height: 900 },
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      );
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });

      sesiones.set(sessionId, {
        browser,
        page,
        xvfb: xvfbProc,
        display,
        status: "cargando",
        resultado: null,
        cedula,
      });

      // PASO 1: Términos
      console.log(`[${sessionId}] Cargando términos...`);
      await page.goto(POLICIA_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForSelector('input[type="radio"]', { timeout: 15000 });

      await page.evaluate(() => {
        const radios = Array.from(
          document.querySelectorAll('input[type="radio"]'),
        );
        const acepto =
          radios.find((r) => {
            const lbl = r.labels?.[0]?.textContent?.toLowerCase() || "";
            return lbl.includes("acepto") || r.value === "true";
          }) || radios[0];
        if (acepto) acepto.click();
      });
      await new Promise((r) => setTimeout(r, 400));

      await page.evaluate(() => {
        const btn = Array.from(
          document.querySelectorAll("button, input[type='submit']"),
        ).find((b) =>
          (b.textContent || b.value || "").toLowerCase().includes("enviar"),
        );
        if (btn) btn.click();
      });

      await waitForNetworkIdle(page);
      await page.waitForSelector("#cedulaTipo, select", { timeout: 10000 });
      console.log(`[${sessionId}] Formulario listo. URL: ${page.url()}`);

      // PASO 2: Llenar formulario
      await page.evaluate((tipo) => {
        const sel = document.querySelector("#cedulaTipo, select");
        if (!sel) return;
        const opt = Array.from(sel.options).find((o) => o.text.trim() === tipo);
        if (opt) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, tipoValor);

      await new Promise((r) => setTimeout(r, 500));

      const inputDoc = await page.$(
        "#cedulaInput, input[type='text'], input[type='number']",
      );
      if (inputDoc) {
        await inputDoc.click({ clickCount: 3 });
        await inputDoc.type(cedula, { delay: 50 });
      }

      await new Promise((r) => setTimeout(r, 1000));

      // PASO 3: Scroll hasta el captcha y tomar screenshot
      await page.evaluate(() => {
        const captcha = document.querySelector(
          ".g-recaptcha, iframe[src*='recaptcha']",
        );
        if (captcha)
          captcha.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      await new Promise((r) => setTimeout(r, 1500));

      const sesion = sesiones.get(sessionId);
      if (sesion) {
        sesion.status = "captcha";
        console.log(`[${sessionId}] Esperando resolución del captcha...`);
      }
    } catch (err) {
      console.error(`[${sessionId}] ERROR:`, err.message);
      const sesion = sesiones.get(sessionId);
      if (sesion) {
        sesion.status = "error";
        sesion.resultado = { error: err.message };
      }
    }
  })();
};

// ── GET /api/policia/screenshot/:id ──────────────────────────────────────────
exports.screenshot = async (req, res) => {
  const { id } = req.params;
  const sesion = sesiones.get(id);

  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });
  if (!sesion.page) return res.status(400).json({ error: "Browser no listo" });

  try {
    const img = await sesion.page.screenshot({
      type: "jpeg",
      quality: 85,
      fullPage: false,
    });
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "no-cache");
    res.send(img);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /api/policia/status/:id ───────────────────────────────────────────────
exports.status = async (req, res) => {
  const { id } = req.params;
  const sesion = sesiones.get(id);
  if (!sesion) return res.status(404).json({ error: "Sesión no encontrada" });
  res.json({ status: sesion.status, resultado: sesion.resultado });
};

// ── POST /api/policia/clic/:id ────────────────────────────────────────────────
exports.clic = async (req, res) => {
  const { id } = req.params;
  const { x, y } = req.body;
  const sesion = sesiones.get(id);

  if (!sesion?.page)
    return res.status(404).json({ error: "Sesión no encontrada" });

  try {
    await sesion.page.mouse.click(x, y);
    console.log(`[${id}] Clic en (${x}, ${y})`);

    // Esperar un momento y verificar si el captcha se resolvió
    await new Promise((r) => setTimeout(r, 2000));

    const tokenObtenido = await sesion.page.evaluate(() => {
      const el = document.getElementById("g-recaptcha-response");
      return !!(el && el.value && el.value.length > 0);
    });

    if (tokenObtenido) {
      console.log(`[${id}] Token obtenido tras clic. Enviando consulta...`);
      sesion.status = "consultando";

      // Hacer clic en Consultar
      await sesion.page.evaluate(() => {
        const btn = Array.from(
          document.querySelectorAll("button, input[type='submit']"),
        ).find((b) =>
          (b.textContent || b.value || "").toLowerCase().includes("consultar"),
        );
        if (btn) btn.click();
      });

      await waitForNetworkIdle(sesion.page, 1500, 20000);

      // Extraer resultado
      const resultado = await sesion.page.evaluate(() => {
        const texto = document.body.innerText.toUpperCase();
        const noRegistra =
          texto.includes("NO REGISTRA") || texto.includes("SIN ANTECEDENTES");
        const registra =
          texto.includes("REGISTRA ANTECEDENTES") || texto.includes("CONDENA");
        return {
          tieneAntecedentes: registra && !noRegistra,
          mensaje: noRegistra
            ? "NO registra antecedentes."
            : registra
              ? "REGISTRA antecedentes."
              : "Sin resultado claro.",
          texto: document.body.innerText.substring(0, 1000),
        };
      });

      sesion.status = "listo";
      sesion.resultado = resultado;
      console.log(`[${id}] Resultado: ${resultado.mensaje}`);
      await cerrarSesion(id);
    }

    res.json({ tokenObtenido, status: sesion.status });
  } catch (err) {
    console.error(`[${id}] Error en clic:`, err.message);
    res.status(500).json({ error: err.message });
  }
};

// ── Cerrar sesión y liberar recursos ─────────────────────────────────────────
async function cerrarSesion(id) {
  const sesion = sesiones.get(id);
  if (!sesion) return;
  try {
    await sesion.browser?.close();
  } catch {}
  try {
    sesion.xvfb?.kill();
  } catch {}
  // Mantener el resultado 2 minutos antes de borrar
  setTimeout(() => sesiones.delete(id), 2 * 60 * 1000);
}
