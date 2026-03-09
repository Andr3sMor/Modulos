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

// Respuestas a captchas de texto conocidos
const RESPUESTAS_TEXTO = {
  "capital de colombia": "BOGOTA",
  "capital colombia": "BOGOTA",
  "color del cielo": "AZUL",
  "color cielo": "AZUL",
  "color del sol": "AMARILLO",
  "color sol": "AMARILLO",
  "pais de colombia": "COLOMBIA",
  "continente colombia": "AMERICA",
  "dias semana": "7",
  "meses año": "12",
  "meses del año": "12",
};

function resolverCaptchaCompleto(pregunta) {
  if (!pregunta) return "8"; // fallback
  const p = pregunta.toUpperCase();

  // Primero intentar matemático
  if (p.match(/\d+\s*[\+\-\*xX×]\s*\d+/)) {
    return resolverCaptcha(pregunta);
  }

  // Buscar en el diccionario de respuestas de texto
  for (const [clave, respuesta] of Object.entries(RESPUESTAS_TEXTO)) {
    if (p.includes(clave.toUpperCase())) return respuesta;
  }

  // Si no reconoce, loguear para agregar al diccionario
  console.log("⚠️ Captcha de texto no reconocido:", pregunta);
  return "BOGOTA"; // respuesta más común como fallback
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

    // Esperar a que el captcha cargue dinámicamente
    await sleep(2000);

    // Captcha — puede ser matemático o de texto
    const captchaInfo = await page.evaluate(() => {
      // Buscar el label/span que contiene la pregunta del captcha
      // Está cerca del input txtRespuestaPregunta
      const inp = document.querySelector("input[name='txtRespuestaPregunta']");
      if (!inp) return { texto: "", html: "no input" };

      // Subir por el DOM hasta encontrar el contenedor
      let parent = inp.parentElement;
      for (let i = 0; i < 6; i++) {
        if (!parent) break;
        const texto = parent.innerText || "";
        if (texto.match(/\?/))
          return {
            texto: texto.trim(),
            html: parent.outerHTML.substring(0, 500),
          };
        parent = parent.parentElement;
      }

      // Fallback: buscar cualquier elemento con "?" cerca del input
      const allTexts = [
        ...document.querySelectorAll("label, span, td, div, p"),
      ];
      for (const el of allTexts) {
        const t = el.innerText?.trim();
        if (
          t &&
          t.includes("?") &&
          t.length < 200 &&
          t.match(/[Cc]uanto|[Cc]apital|[Cc]olor|[Cc]iudad|[Pp]ais/)
        ) {
          return { texto: t, html: el.outerHTML.substring(0, 300) };
        }
      }
      return { texto: "", html: "not found" };
    });

    console.log("🔢 Captcha texto:", captchaInfo.texto);
    console.log("🔍 Captcha HTML:", captchaInfo.html);

    const respuestaCaptcha = resolverCaptchaCompleto(captchaInfo.texto);
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
    return res.status(502).json({
      error: "Error consultando Procuraduría",
      detalle: error.message,
    });
  }
};
