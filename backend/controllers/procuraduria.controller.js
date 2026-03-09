/**
 * procuraduria.controller.js
 * Usa Puppeteer para navegar el formulario de la Procuraduría,
 * resolver el captcha matemático y obtener el resultado.
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const FORM_URL =
  "https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TIPO_MAP = {
  CC: "1",
  CE: "2",
  PA: "3",
  "Cédula de Ciudadanía": "1",
  "Cédula de Extranjería": "2",
  Pasaporte: "3",
};

async function lanzarBrowser() {
  if (!process.env.RENDER) {
    const pf = require("puppeteer");
    return pf.launch({
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

function resolverCaptcha(pregunta) {
  const match = pregunta.match(/(\d+)\s*([\+\-\*xX×])\s*(\d+)/);
  if (!match) return "0";
  const [, a, op, b] = match;
  if (op === "+") return String(+a + +b);
  if (op === "-") return String(+a - +b);
  return String(+a * +b);
}

exports.consultarProcuraduria = async (req, res) => {
  const { cedula, tipoDocumento = "CC", tipoCertificado = "1" } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const ddlTipoID = TIPO_MAP[tipoDocumento] || "1";
  console.log(`\n=== Consulta Procuraduría: ${cedula} ===`);

  let browser;
  try {
    browser = await lanzarBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });

    // ── Navegar al formulario ──────────────────────────────────────────────
    console.log("📄 Navegando al formulario...");
    await page.goto(FORM_URL, { waitUntil: "networkidle2", timeout: 40000 });
    console.log("✅ Página cargada:", page.url());

    // Screenshot para debug
    const ss1 = await page.screenshot({ encoding: "base64" });
    console.log("📸 Screenshot inicial (base64 length):", ss1.length);

    // Log de inputs visibles
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll("input, select")]
        .map(
          (el) => `${el.tagName} name=${el.name} id=${el.id} type=${el.type}`,
        )
        .join(" | "),
    );
    console.log("📋 Inputs en página:", inputs.substring(0, 800));

    // Captcha
    const textoCaptcha = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("label, span, td, div")];
      for (const el of labels) {
        if (el.textContent.match(/[Cc]uanto\s+es/))
          return el.textContent.trim();
      }
      return "";
    });
    console.log("🔢 Captcha encontrado:", textoCaptcha);
    const respuestaCaptcha = resolverCaptcha(textoCaptcha);
    console.log("🔢 Respuesta captcha:", respuestaCaptcha);

    // ── Seleccionar tipo de ID ─────────────────────────────────────────────
    console.log("🔽 Seleccionando tipo documento:", ddlTipoID);
    const selectores = ["select[name='ddlTipoID']", "#ddlTipoID", "select"];
    for (const sel of selectores) {
      try {
        await page.select(sel, ddlTipoID);
        console.log("✅ Select tipo ID con:", sel);
        break;
      } catch (_) {}
    }
    await sleep(1000);

    // ── Ingresar cédula ────────────────────────────────────────────────────
    console.log("✏️ Ingresando cédula:", cedula);
    const inputSels = [
      "input[name='txtNumID']",
      "#txtNumID",
      "input[type='text']:not([name*='captcha']):not([name*='email'])",
    ];
    for (const sel of inputSels) {
      try {
        await page.click(sel, { clickCount: 3 });
        await page.type(sel, cedula);
        console.log("✅ Cédula ingresada con:", sel);
        break;
      } catch (_) {}
    }

    // ── Tipo certificado ───────────────────────────────────────────────────
    try {
      await page.click(`input[name='rblTipoCert'][value='${tipoCertificado}']`);
    } catch (_) {
      console.log("⚠️ No se pudo seleccionar tipo certificado");
    }

    // ── Respuesta captcha ──────────────────────────────────────────────────
    const captchaSels = [
      "input[name='txtRespuestaPregunta']",
      "#txtRespuestaPregunta",
      "input[type='text'][name*='Respuesta']",
      "input[type='text'][name*='captcha']",
    ];
    for (const sel of captchaSels) {
      try {
        await page.click(sel, { clickCount: 3 });
        await page.type(sel, respuestaCaptcha);
        console.log("✅ Captcha ingresado con:", sel);
        break;
      } catch (_) {}
    }

    // Screenshot antes de submit
    const ss2 = await page.screenshot({ encoding: "base64" });
    console.log("📸 Screenshot pre-submit (length):", ss2.length);

    // ── Click Generar ──────────────────────────────────────────────────────
    console.log("🚀 Clickeando Generar...");
    const btnSels = [
      "input[name='btnExportar']",
      "#btnExportar",
      "input[type='submit'][value*='Generar']",
      "input[type='submit']",
      "button[type='submit']",
    ];
    let clicked = false;
    for (const sel of btnSels) {
      try {
        await Promise.all([
          page
            .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
            .catch(() => {}),
          page.click(sel),
        ]);
        console.log("✅ Click con:", sel);
        clicked = true;
        break;
      } catch (_) {}
    }

    if (!clicked) console.log("⚠️ No se pudo clickear el botón");

    await sleep(2000);
    const urlFinal = page.url();
    console.log("📍 URL final:", urlFinal);

    // Screenshot del resultado
    const ss3 = await page.screenshot({ encoding: "base64" });
    console.log("📸 Screenshot resultado (length):", ss3.length);

    // ── Leer resultado ─────────────────────────────────────────────────────
    const textoPagina = await page.evaluate(() =>
      document.body.innerText.toUpperCase(),
    );
    console.log("📝 Texto resultado (500):", textoPagina.substring(0, 500));

    const sinSanciones =
      textoPagina.includes("NO REGISTRA") ||
      textoPagina.includes("SIN ANTECEDENTES") ||
      textoPagina.includes("NO SE ENCONTRARON") ||
      textoPagina.includes("NO TIENE SANCIONES");
    const conSanciones =
      textoPagina.includes("SANCIONADO") ||
      textoPagina.includes("INHABILIT") ||
      textoPagina.includes("SUSPENDIDO") ||
      textoPagina.includes("DESTITUIDO");

    await browser.close();

    return res.json({
      fuente: "Procuraduría General de la Nación",
      tieneSanciones: conSanciones,
      sinSanciones,
      documento: cedula,
      mensaje: conSanciones
        ? "La persona REGISTRA sanciones en la Procuraduría."
        : sinSanciones
          ? "La persona NO registra sanciones en la Procuraduría."
          : "No se pudo determinar el resultado con claridad.",
      certificadoUrl: urlFinal !== FORM_URL ? urlFinal : "",
      detalle: textoPagina.substring(0, 500),
    });
  } catch (error) {
    console.error("❌ ERROR Procuraduría:", error.message);
    if (browser) await browser.close().catch(() => {});
    return res.status(502).json({
      error: "Error consultando Procuraduría",
      detalle: error.message,
    });
  }
};
