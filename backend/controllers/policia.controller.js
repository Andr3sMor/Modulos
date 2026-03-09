/**
 * policia.controller.js
 * El botón "Continuar" en términos usa AJAX parcial de PrimeFaces,
 * no genera una navegación completa. Hay que esperar la URL o el DOM.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lanzarBrowser() {
  if (!process.env.RENDER) {
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

async function buscar(page, selectores) {
  for (const sel of selectores) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

/** Espera a que la URL cambie O a que aparezca el formulario en el DOM */
async function esperarFormulario(page, timeoutMs = 20000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const url = page.url();
    console.log("  ⏳ URL actual:", url);

    // Caso 1: el servidor redirigió a antecedentes.xhtml
    if (url.includes("antecedentes")) {
      console.log("  ✅ Redirigido a antecedentes.xhtml");
      return true;
    }

    // Caso 2: AJAX actualizó el DOM y el formulario ya está visible en la misma URL
    const tieneFormulario = await page.evaluate(
      () =>
        !!(
          document.querySelector("select[id*='cedulaTipo']") ||
          document.querySelector("input[id*='cedulaInput']") ||
          document.querySelector("form[id*='formAntecedentes']")
        ),
    );
    if (tieneFormulario) {
      console.log("  ✅ Formulario detectado via AJAX en DOM");
      return true;
    }

    await sleep(800);
  }
  return false;
}

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "cc" } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const tipoValor = TIPO_MAP[tipoDocumento] || "cc";
  console.log(`--- Consultando: ${cedula} ---`);

  let browser;
  try {
    browser = await lanzarBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });
    await page.setBypassCSP(true);

    // ── PASO 1: Cargar términos ────────────────────────────────────
    console.log("📄 Cargando index.xhtml...");
    await page.goto(POLICIA_URL, { waitUntil: "networkidle2", timeout: 30000 });
    console.log("URL inicial:", page.url());

    // Log elementos de la página de términos
    const elsTerminos = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll("input, button, select, a[onclick]"),
      ).map((el) => ({
        tag: el.tagName,
        id: el.id,
        name: el.name,
        type: el.type,
        value: (el.value || "").substring(0, 40),
        text: (el.innerText || "").substring(0, 40),
        onclick: (el.getAttribute("onclick") || "").substring(0, 80),
      })),
    );
    console.log("🔍 Elementos términos:", JSON.stringify(elsTerminos));

    // ── PASO 2: Marcar checkbox ────────────────────────────────────
    const checkbox = await buscar(page, [
      "#aceptaOption",
      "input[id$='aceptaOption']",
      "input[type='checkbox']",
    ]);
    if (checkbox) {
      await checkbox.click();
      await sleep(300);
      console.log("☑️  Checkbox marcado");
    }

    // ── PASO 3: Click en continuar (puede ser AJAX, no esperar navegación) ──
    const btnContinuar = await buscar(page, [
      "#continuarBtn",
      "input[id$='continuarBtn']",
      "button[id$='continuarBtn']",
      "input[value*='ontinuar']",
      "button[value*='ontinuar']",
      "a[id*='continuar' i]",
    ]);

    if (!btnContinuar)
      throw new Error("No se encontró botón continuar en términos.");

    console.log("🖱️  Haciendo click en Continuar...");
    await btnContinuar.click();

    // ── PASO 4: Esperar formulario (AJAX o redirección) ────────────
    const formularioCargado = await esperarFormulario(page, 20000);
    if (!formularioCargado) {
      console.log("URL al timeout:", page.url());
      console.log("HTML (600):", (await page.content()).substring(0, 600));
      throw new Error("Timeout esperando formulario tras aceptar términos.");
    }

    // Si sigue en index.xhtml pero con el formulario en DOM, navegar explícitamente
    if (!page.url().includes("antecedentes")) {
      console.log(
        "🔄 Navegando explícitamente a antecedentes.xhtml con cookies activas...",
      );
      await page.goto(POLICIA_FORM, {
        waitUntil: "networkidle2",
        timeout: 20000,
      });
    }

    console.log("URL en formulario:", page.url());

    // ── PASO 5: Log elementos del formulario ───────────────────────
    const elsForm = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll("input, select, textarea, button"),
      ).map((el) => ({
        tag: el.tagName,
        id: el.id,
        name: el.name,
        type: el.type,
        value: (el.value || "").substring(0, 40),
      })),
    );
    console.log("🔍 Elementos formulario:", JSON.stringify(elsForm));

    // ── PASO 6: Seleccionar tipo de documento ──────────────────────
    const selectTipo = await buscar(page, [
      "select[id='formAntecedentes:cedulaTipo']",
      "select[id='cedulaTipo']",
      "select[name*='cedulaTipo']",
      "select",
    ]);

    if (selectTipo) {
      const selId = await page.evaluate(
        (el) => (el.id ? `[id='${el.id}']` : `[name='${el.name}']`),
        selectTipo,
      );
      const opciones = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el
          ? Array.from(el.options).map((o) => ({ v: o.value, t: o.text }))
          : [];
      }, selId);
      console.log("Opciones tipo:", JSON.stringify(opciones));

      await page.select(selId, tipoValor).catch(async () => {
        const op = opciones.find((o) =>
          o.t?.toLowerCase().includes("ciudadan"),
        );
        if (op) await page.select(selId, op.v).catch(() => {});
      });
    }

    // ── PASO 7: Ingresar cédula ────────────────────────────────────
    const inputCedula = await buscar(page, [
      "input[id='formAntecedentes:cedulaInput']",
      "input[id='cedulaInput']",
      "input[name*='cedulaInput']",
      "input[id*='cedula' i]:not([type='hidden'])",
      "input[name*='cedula' i]:not([type='hidden'])",
    ]);

    if (!inputCedula) {
      console.log(
        "HTML antecedentes (800):",
        (await page.content()).substring(0, 800),
      );
      throw new Error("No se encontró campo de cédula.");
    }

    await inputCedula.click({ clickCount: 3 });
    await inputCedula.type(cedula, { delay: 50 });
    console.log(`📝 Cédula ingresada: ${cedula}`);

    // ── PASO 8: reCAPTCHA ──────────────────────────────────────────
    console.log("⏳ Esperando reCAPTCHA...");
    await page
      .waitForSelector("iframe[src*='recaptcha']", { timeout: 12000 })
      .catch(() => console.log("⚠️ No se detectó iframe reCAPTCHA."));

    try {
      const anchorFrame = page
        .frames()
        .find(
          (f) => f.url().includes("recaptcha") && f.url().includes("anchor"),
        );
      if (anchorFrame) {
        await anchorFrame.waitForSelector("#recaptcha-anchor", {
          timeout: 8000,
        });
        await anchorFrame.click("#recaptcha-anchor");
        console.log("🖱️ Click checkbox reCAPTCHA...");
        await sleep(4000);

        const checked = await anchorFrame.evaluate(() =>
          document
            .querySelector("#recaptcha-anchor")
            ?.getAttribute("aria-checked"),
        );
        console.log("reCAPTCHA checked:", checked);

        if (checked !== "true") {
          console.log("🖼️ Esperando challenge (máx 30s)...");
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
            .catch(() => console.log("⚠️ Challenge no resuelto."));
        }
      }
    } catch (e) {
      console.log("⚠️ reCAPTCHA:", e.message);
    }

    // ── PASO 9: Enviar ─────────────────────────────────────────────
    console.log("🚀 Enviando...");
    const btnSubmit = await buscar(page, [
      "input[id$='consultarBtn']",
      "button[id$='consultarBtn']",
      "input[value*='Consultar']",
      "button[value*='Consultar']",
      "input[type='submit']",
      "button[type='submit']",
    ]);

    if (btnSubmit) {
      await btnSubmit.click();
    } else {
      await page.evaluate(() => {
        const form =
          document.querySelector("form[id*='formAntecedentes']") ||
          document.querySelector("form");
        if (form) form.submit();
      });
    }

    await page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: 25000 })
      .catch(() => {});
    await sleep(2000);

    // ── PASO 10: Resultado ─────────────────────────────────────────
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

    if (captchaRechazado)
      throw new Error(
        "El servidor rechazó la consulta por reCAPTCHA. Intenta de nuevo.",
      );

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
