/**
 * procuraduria.controller.js
 * Usa Puppeteer para navegar el formulario de la Procuraduría,
 * resolver el captcha matemático y obtener el resultado.
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const FORM_URL = "https://apps.procuraduria.gov.co/webcert/Certificado.aspx";
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

    // Captcha — buscar el texto que contiene la pregunta matemática
    const textoCaptcha = await page.evaluate(() => {
      // Buscar en todo el body el patrón del captcha
      const all = document.body.innerHTML;
      const m =
        all.match(/¿\s*[Cc]uanto\s+es\s+([^?<"]+)\?/i) ||
        all.match(/[Cc]uanto\s+es\s+([0-9\s\+\-\*xX×]+)/i);
      if (m) return m[1].trim();
      // Buscar la imagen del captcha o el span con la pregunta
      const spans = [...document.querySelectorAll("span, label, td")];
      for (const el of spans) {
        if (el.innerText && el.innerText.match(/\d+\s*[\+\-\*xX×]\s*\d+/)) {
          return el.innerText.trim();
        }
      }
      return "";
    });

    // Si no encontró captcha, loguear el HTML del área del captcha para diagnóstico
    if (!textoCaptcha) {
      const captchaAreaHtml = await page.evaluate(() => {
        // Buscar el input de respuesta y ver su contexto
        const inp = document.querySelector(
          "input[name='txtRespuestaPregunta']",
        );
        if (inp) {
          // Subir al tr o div padre para ver la pregunta
          let parent = inp.parentElement;
          for (let i = 0; i < 5; i++) {
            if (parent && parent.tagName === "TABLE") break;
            parent = parent?.parentElement;
          }
          return parent ? parent.outerHTML.substring(0, 1000) : "no parent";
        }
        // También buscar cualquier texto con números y operadores
        const body = document.body.innerHTML;
        const idx = body.search(/\d+\s*[xX×\+\-\*]\s*\d+/);
        return idx >= 0
          ? body.substring(Math.max(0, idx - 200), idx + 200)
          : "NOT FOUND";
      });
      console.log("🔍 HTML área captcha:", captchaAreaHtml);
    }

    console.log("🔢 Captcha encontrado:", textoCaptcha || "NO DETECTADO");
    const respuestaCaptcha = resolverCaptcha(textoCaptcha || "6+2");
    console.log("🔢 Respuesta captcha:", respuestaCaptcha);

    // Leer el valor del campo foo (token anti-CSRF)
    const fooVal = await page.evaluate(() => {
      const el = document.querySelector("input[name='foo']");
      return el ? el.value : "";
    });
    console.log("🔑 foo token:", fooVal);

    // Leer IdPregunta
    const idPregunta = await page.evaluate(() => {
      const el = document.querySelector("input[name='IdPregunta']");
      return el ? el.value : "20";
    });
    console.log("🔑 IdPregunta:", idPregunta);

    // ── Seleccionar tipo de ID ─────────────────────────────────────────────
    console.log("🔽 Seleccionando tipo documento:", ddlTipoID);
    await page.select("select[name='ddlTipoID']", ddlTipoID);
    await sleep(800);

    // ── Ingresar cédula ────────────────────────────────────────────────────
    console.log("✏️ Ingresando cédula:", cedula);
    await page.click("input[name='txtNumID']", { clickCount: 3 });
    await page.type("input[name='txtNumID']", cedula);

    // ── Tipo certificado ───────────────────────────────────────────────────
    try {
      await page.click(`input[name='rblTipoCert'][value='${tipoCertificado}']`);
    } catch (_) {}

    // ── ddlCargo (dejar vacío / primer valor) ──────────────────────────────
    try {
      const cargoOptions = await page.evaluate(() => {
        const sel = document.querySelector("select[name='ddlCargo']");
        return sel ? [...sel.options].map((o) => `${o.value}:${o.text}`) : [];
      });
      console.log(
        "📋 ddlCargo opciones:",
        cargoOptions.join(" | ").substring(0, 200),
      );
    } catch (_) {}

    // ── Respuesta captcha ──────────────────────────────────────────────────
    await page.click("input[name='txtRespuestaPregunta']", { clickCount: 3 });
    await page.type("input[name='txtRespuestaPregunta']", respuestaCaptcha);
    console.log("✅ Captcha ingresado:", respuestaCaptcha);

    // Screenshot antes de submit
    const ss2 = await page.screenshot({ encoding: "base64" });
    console.log("📸 Screenshot pre-submit (length):", ss2.length);

    // ── Click ImageButton1 (el botón Generar real) ─────────────────────────
    console.log("🚀 Clickeando ImageButton1...");
    try {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
          .catch(() => {}),
        page.click("input[name='ImageButton1']"),
      ]);
      console.log("✅ Click ImageButton1 OK");
    } catch (e) {
      console.log("⚠️ Error click ImageButton1:", e.message);
    }

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
    return res
      .status(502)
      .json({
        error: "Error consultando Procuraduría",
        detalle: error.message,
      });
  }
};
