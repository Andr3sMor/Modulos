/**
 * procuraduria.controller.js
 * Usa Puppeteer para navegar el formulario de la Procuraduría,
 * resolver el captcha (matemático, de texto o de nombre) y obtener el resultado.
 *
 * CAPTCHA TIPOS DETECTADOS:
 *  1. Matemático:        "¿Cuánto es 3 + 5?"          → calculamos
 *  2. Texto/geografía:   "¿Capital de Colombia?"       → diccionario
 *  3. Nombre (NUEVO):    "¿Escriba las dos primeras    → extraemos del DOM el
 *                         letras del primer nombre      label/span que contiene
 *                         de la persona...?"            el nombre oculto, O
 *                                                       recibimos el nombre
 *                                                       como parámetro del body
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const FORM_URL = "https://apps.procuraduria.gov.co/webcert/Certificado.aspx";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TIPO_MAP = {
  CC: "1",
  CE: "2",
  PA: "3",
  PEP: "4",
  NIT: "5",
  PPT: "6",
  "Cédula de Ciudadanía": "1",
  "Cédula de Extranjería": "2",
  Pasaporte: "3",
};

// ─── Browser ────────────────────────────────────────────────────────────────

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

// ─── Resolución de captcha ───────────────────────────────────────────────────

function resolverCaptchaMatematico(pregunta) {
  const match = pregunta.match(/(\d+)\s*([\+\-\*xX×])\s*(\d+)/);
  if (!match) return null;
  const [, a, op, b] = match;
  if (op === "+") return String(+a + +b);
  if (op === "-") return String(+a - +b);
  return String(+a * +b);
}

const RESPUESTAS_TEXTO = {
  "capital de colombia": "BOGOTA",
  "capital colombia": "BOGOTA",
  "capital del valle del cauca": "CALI",
  "capital valle del cauca": "CALI",
  "capital valle": "CALI",
  "capital de antioquia": "MEDELLIN",
  "capital antioquia": "MEDELLIN",
  "capital de cundinamarca": "BOGOTA",
  "capital cundinamarca": "BOGOTA",
  "capital de atlantico": "BARRANQUILLA",
  "capital atlantico": "BARRANQUILLA",
  "capital de bolivar": "CARTAGENA",
  "capital bolivar": "CARTAGENA",
  "capital de santander": "BUCARAMANGA",
  "capital santander": "BUCARAMANGA",
  "capital de narino": "PASTO",
  "capital narino": "PASTO",
  "color del cielo": "AZUL",
  "color cielo": "AZUL",
  "color del sol": "AMARILLO",
  "color sol": "AMARILLO",
  "dias semana": "7",
  "dias de la semana": "7",
  "meses año": "12",
  "meses del año": "12",
};

/**
 * Resuelve el captcha según su tipo.
 * @param {string} pregunta  - texto completo del captcha
 * @param {string} [nombre]  - primer nombre de la persona (para captcha de nombre)
 */
function resolverCaptchaCompleto(pregunta, nombre = "") {
  if (!pregunta) return "8"; // fallback de emergencia

  const p = pregunta
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // 1. Captcha matemático
  const matematico = resolverCaptchaMatematico(pregunta);
  if (matematico) return matematico;

  // 2. Captcha de nombre:
  //    "¿Escriba las dos primeras letras del primer nombre de la persona...?"
  //    "¿Cuáles son las 2 primeras letras del nombre...?"
  if (
    p.includes("PRIMERAS LETRAS") ||
    p.includes("PRIMER NOMBRE") ||
    p.includes("NOMBRE DE LA PERSONA")
  ) {
    if (nombre && nombre.trim().length >= 2) {
      // Extraer el PRIMER nombre (antes del primer espacio)
      const primerNombre = nombre.trim().split(/\s+/)[0].toUpperCase();
      const respuesta = primerNombre.substring(0, 2);
      console.log(
        `✅ Captcha de nombre → primeras 2 letras de "${primerNombre}": ${respuesta}`,
      );
      return respuesta;
    }
    // Si no tenemos el nombre, no podemos responder
    console.log(
      "⚠️ Captcha de nombre detectado pero no se proporcionó 'nombre' en el body.",
    );
    return ""; // vacío → el caller manejará el error
  }

  // 3. Diccionario de texto / geografía
  for (const [clave, respuesta] of Object.entries(RESPUESTAS_TEXTO)) {
    const claveNorm = clave
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (p.includes(claveNorm)) return respuesta;
  }

  console.log("⚠️ Captcha no reconocido:", pregunta);
  return "BOGOTA"; // fallback geográfico más frecuente
}

// ─── Leer captcha desde el DOM ───────────────────────────────────────────────

async function leerCaptchaDom(page) {
  return page.evaluate(() => {
    const inp = document.querySelector("input[name='txtRespuestaPregunta']");
    if (!inp) return { texto: "", html: "no input" };

    // Sube por el árbol DOM buscando un contenedor que tenga "?"
    let parent = inp.parentElement;
    for (let i = 0; i < 10; i++) {
      if (!parent) break;
      const texto = (parent.innerText || "").trim();
      if (texto.includes("?")) {
        return { texto, html: parent.outerHTML.substring(0, 600) };
      }
      parent = parent.parentElement;
    }

    // Búsqueda global: cualquier elemento con "?" y palabras clave
    const candidatos = [
      ...document.querySelectorAll("label, span, td, div, p, li, b, strong"),
    ];
    for (const el of candidatos) {
      const t = (el.innerText || "").trim();
      if (
        t &&
        t.includes("?") &&
        t.length < 300 &&
        !t.includes("<") &&
        t.match(
          /[Cc]apital|[Cc]uanto|[Cc]olor|[Dd]ias|[Mm]eses|[Ll]etras|[Nn]ombre/i,
        )
      ) {
        return { texto: t, html: el.outerHTML.substring(0, 400) };
      }
    }

    // Último recurso: el innerText completo de la página cerca del input
    // Buscar todas las preguntas con "?"
    const todas = [...document.querySelectorAll("*")];
    for (const el of todas) {
      if (el.children.length > 5) continue; // saltar contenedores grandes
      const t = (el.innerText || "").trim();
      if (t && t.includes("?") && t.length < 200) {
        return { texto: t, html: el.outerHTML.substring(0, 300) };
      }
    }

    return { texto: "", html: "not found" };
  });
}

// ─── Controlador principal ───────────────────────────────────────────────────

exports.consultarProcuraduria = async (req, res) => {
  const {
    cedula,
    tipoDocumento = "CC",
    tipoCertificado = "1",
    nombre = "", // ← NUEVO: primer nombre de la persona (para captcha de nombre)
  } = req.body;

  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const ddlTipoID = TIPO_MAP[tipoDocumento] || "1";
  console.log(
    `\n=== Consulta Procuraduría: ${cedula} (nombre: "${nombre}") ===`,
  );

  let browser;
  try {
    browser = await lanzarBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });

    // ── 1. Navegar ─────────────────────────────────────────────────────────
    console.log("📄 Navegando al formulario...");
    await page.goto(FORM_URL, { waitUntil: "networkidle2", timeout: 45000 });
    console.log("✅ Página cargada:", page.url());

    // Esperar a que cargue dinámicamente (captcha, select, etc.)
    await sleep(2500);

    // ── 2. Debug: loguear inputs disponibles ─────────────────────────────
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll("input, select")]
        .map(
          (el) => `${el.tagName} name=${el.name} id=${el.id} type=${el.type}`,
        )
        .join(" | "),
    );
    console.log("📋 Inputs:", inputs.substring(0, 1000));

    // ── 3. Leer token foo y IdPregunta ────────────────────────────────────
    const { fooVal, idPregunta } = await page.evaluate(() => ({
      fooVal: document.querySelector("input[name='foo']")?.value || "",
      idPregunta:
        document.querySelector("input[name='IdPregunta']")?.value || "20",
    }));
    console.log("🔑 foo:", fooVal, "| IdPregunta:", idPregunta);

    // ── 4. Leer captcha inicial ───────────────────────────────────────────
    const captchaInicial = await leerCaptchaDom(page);
    console.log("🔢 Captcha inicial:", captchaInicial.texto || "(vacío)");
    console.log("🔍 HTML captcha:", captchaInicial.html.substring(0, 200));

    // ── 5. Seleccionar tipo de documento (dispara postback ASP.NET) ───────
    console.log("🔽 Seleccionando tipo documento:", ddlTipoID);
    await page.select("select[name='ddlTipoID']", ddlTipoID);

    // Esperar el postback completo
    await sleep(3000);

    const selectedVal = await page.evaluate(() => {
      return (
        document.querySelector("select[name='ddlTipoID']")?.value || "NO SELECT"
      );
    });
    console.log("✅ ddlTipoID seleccionado:", selectedVal);

    // ── 6. Ingresar número de documento ──────────────────────────────────
    console.log("✏️ Ingresando cédula:", cedula);
    await page.click("input[name='txtNumID']", { clickCount: 3 });
    await page.type("input[name='txtNumID']", cedula);

    // ── 7. Tipo de certificado ────────────────────────────────────────────
    try {
      await page.click(`input[name='rblTipoCert'][value='${tipoCertificado}']`);
      await sleep(500);
    } catch (_) {
      console.log(
        "ℹ️ No se pudo seleccionar tipoCertificado:",
        tipoCertificado,
      );
    }

    // ── 8. Leer captcha DESPUÉS del postback ─────────────────────────────
    await sleep(1000);
    const captchaFinal = await leerCaptchaDom(page);
    console.log("🔢 Captcha post-select:", captchaFinal.texto || "(vacío)");

    // Usar el captcha que tenga contenido; el postback puede haberlo cambiado
    const textoCaptcha = captchaFinal.texto || captchaInicial.texto || "";
    const respuestaCaptcha = resolverCaptchaCompleto(textoCaptcha, nombre);
    console.log("🔢 Respuesta captcha:", respuestaCaptcha);

    // Si el captcha de nombre no pudo resolverse, abortar limpiamente
    if (respuestaCaptcha === "") {
      await browser.close();
      return res.status(422).json({
        error: "Captcha de nombre no resuelto",
        detalle:
          "El formulario solicita las primeras 2 letras del nombre de la persona. " +
          "Por favor incluya el campo 'nombre' en el body de la solicitud.",
        captchaPregunta: textoCaptcha,
      });
    }

    // ── 9. Completar campo captcha ────────────────────────────────────────
    await page.click("input[name='txtRespuestaPregunta']", { clickCount: 3 });
    await page.type("input[name='txtRespuestaPregunta']", respuestaCaptcha);
    console.log("✅ Captcha ingresado:", respuestaCaptcha);

    // ── 10. Verificar ddlCargo (no siempre aplica) ────────────────────────
    const cargoOptions = await page.evaluate(() => {
      const sel = document.querySelector("select[name='ddlCargo']");
      if (!sel) return [];
      return [...sel.options].map((o) => `${o.value}:${o.text}`);
    });
    console.log(
      "📋 ddlCargo opciones:",
      cargoOptions.join(" | ").substring(0, 200),
    );

    // ── 11. Screenshot pre-submit ─────────────────────────────────────────
    if (process.env.DEBUG_SCREENSHOTS) {
      const ss2 = await page.screenshot({ encoding: "base64" });
      console.log("📸 Screenshot pre-submit (length):", ss2.length);
    }

    // ── 12. Submit ────────────────────────────────────────────────────────
    console.log("🚀 Enviando formulario...");
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 35000 })
        .catch(() => {}),
      page.click("input[name='ImageButton1']"),
    ]);

    await sleep(2000);
    const urlFinal = page.url();
    console.log("📍 URL final:", urlFinal);

    // ── 13. Leer resultado ────────────────────────────────────────────────
    const textoPagina = await page.evaluate(() =>
      document.body.innerText.toUpperCase(),
    );
    console.log("📝 Texto resultado (600):", textoPagina.substring(0, 600));

    // Detectar si el captcha fue rechazado (volvió al formulario sin resultado)
    const captchaRechazado =
      urlFinal === FORM_URL &&
      !textoPagina.includes("NO REGISTRA") &&
      !textoPagina.includes("SANCIONADO") &&
      !textoPagina.includes("INHABILIT");

    if (captchaRechazado) {
      await browser.close();
      return res.status(422).json({
        error: "Captcha incorrecto o formulario no procesado",
        detalle:
          "El servidor volvió al formulario inicial. El captcha puede haber sido incorrecto " +
          "o el token de sesión expiró.",
        captchaPregunta: textoCaptcha,
        captchaRespuestaIntentada: respuestaCaptcha,
        urlFinal,
      });
    }

    const sinSanciones =
      textoPagina.includes("NO REGISTRA") ||
      textoPagina.includes("SIN ANTECEDENTES") ||
      textoPagina.includes("NO SE ENCONTRARON") ||
      textoPagina.includes("NO TIENE SANCIONES") ||
      textoPagina.includes("NO PRESENTA");

    const conSanciones =
      textoPagina.includes("SANCIONADO") ||
      textoPagina.includes("INHABILIT") ||
      textoPagina.includes("SUSPENDIDO") ||
      textoPagina.includes("DESTITUIDO") ||
      textoPagina.includes("MULTA");

    await browser.close();

    return res.json({
      fuente: "Procuraduría General de la Nación",
      tieneSanciones: conSanciones,
      sinSanciones,
      documento: cedula,
      tipoDocumento,
      mensaje: conSanciones
        ? "La persona REGISTRA sanciones en la Procuraduría."
        : sinSanciones
          ? "La persona NO registra sanciones en la Procuraduría."
          : "No se pudo determinar el resultado con claridad.",
      certificadoUrl: urlFinal !== FORM_URL ? urlFinal : "",
      detalle: textoPagina.substring(0, 800),
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
