const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const POLICIA_URL =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/index.xhtml";
const POLICIA_FORM =
  "https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml";

exports.consultarAntecedentes = async (req, res) => {
  const { cedula, tipoDocumento = "cc" } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const tipoMap = {
    "Cédula de Ciudadanía": "Cédula de Ciudadanía",
    "Cédula de Extranjería": "Cédula de Extranjería",
    Pasaporte: "Pasaporte",
    cc: "Cédula de Ciudadanía",
    cx: "Cédula de Extranjería",
    pa: "Pasaporte",
  };
  const tipoValor = tipoMap[tipoDocumento] || "Cédula de Ciudadanía";

  console.log(`--- Consultando antecedentes para: ${cedula} ---`);
  let browser;

  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--ignore-certificate-errors",
        "--ignore-certificate-errors-spki-list",
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Ignorar errores de SSL del sitio de la policía
    await page.setBypassCSP(true);

    console.log("📄 Cargando página de términos...");
    await page.goto(POLICIA_URL, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Aceptar términos
    console.log("✅ Aceptando términos...");
    await page.evaluate(() => {
      const radios = document.querySelectorAll('input[type="radio"]');
      radios.forEach((r) => {
        if (
          r.value === "true" ||
          r.nextSibling?.textContent?.includes("Acepto")
        ) {
          r.click();
        }
      });
    });

    // Buscar y clickear botón de continuar
    await page.click('input[type="submit"], button[type="submit"], .ui-button');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });

    console.log("📋 En formulario, llenando datos...");
    await page.waitForSelector("select", { timeout: 10000 });

    // Seleccionar tipo de documento
    await page.select("select", tipoValor);

    // Ingresar cédula
    const inputCedula = await page.$('input[type="text"], input:not([type])');
    if (inputCedula) {
      await inputCedula.click({ clickCount: 3 });
      await inputCedula.type(cedula);
    }

    // Esperar que el reCAPTCHA se resuelva automáticamente o intentar resolverlo
    console.log("⏳ Esperando reCAPTCHA...");
    await new Promise((r) => setTimeout(r, 5000));

    // Intentar submit
    await page.click('input[type="submit"], button[type="submit"], .ui-button');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 });

    const html = await page.content();
    const texto = html.replace(/<[^>]+>/g, " ").toUpperCase();

    console.log(
      "Respuesta (400 chars):",
      texto.replace(/\s+/g, " ").trim().substring(0, 400),
    );

    const noRegistra =
      texto.includes("NO REGISTRA") ||
      texto.includes("SIN ANTECEDENTES") ||
      texto.includes("NO PRESENTA") ||
      texto.includes("NO TIENE ASUNTOS PENDIENTES");

    const registra =
      texto.includes("REGISTRA ANTECEDENTES") ||
      texto.includes("PRESENTA ANTECEDENTES") ||
      texto.includes("CONDENA");

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
      detalle: texto.replace(/\s+/g, " ").trim().substring(0, 800),
    });
  } catch (error) {
    console.error("❌ ERROR:", error.message);
    return res.status(502).json({
      error: "Error en consulta Policía Nacional",
      detalle: error.message,
    });
  } finally {
    if (browser) await browser.close();
  }
};
