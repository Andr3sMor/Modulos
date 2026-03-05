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
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setBypassCSP(true);

    // ── PASO 1: Ir directo al formulario (saltar términos) ──────────────
    console.log("📋 Intentando ir directo al formulario...");
    await page.goto(POLICIA_FORM, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await new Promise((r) => setTimeout(r, 3000));

    const urlActual = page.url();
    console.log("URL actual:", urlActual);

    // Si redirigió a términos, aceptarlos
    if (
      urlActual.includes("index.xhtml") ||
      urlActual.includes("WebJudicial/")
    ) {
      console.log("✅ Aceptando términos...");

      // Seleccionar radio "Acepto"
      await page.evaluate(() => {
        const radios = document.querySelectorAll('input[type="radio"]');
        radios.forEach((r) => {
          const label = r.closest("label") || r.parentElement;
          const texto = label?.textContent || r.value || "";
          if (
            texto.toLowerCase().includes("acepto") ||
            r.value === "true" ||
            r.value === "1" ||
            r.value === "Acepto"
          ) {
            r.click();
          }
        });
      });

      await new Promise((r) => setTimeout(r, 1000));

      // Click en Enviar
      const boton =
        (await page.$('input[type="submit"]')) ||
        (await page.$('button[type="submit"]')) ||
        (await page.$(".ui-button"));

      if (boton) {
        await boton.click();
      }

      // Esperar navegación con timeout alto
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await new Promise((r) => setTimeout(r, 3000));
      console.log("URL después de términos:", page.url());
    }

    // ── PASO 2: Llenar formulario ───────────────────────────────────────
    console.log("📝 Llenando formulario...");

    // Esperar select de tipo documento
    await page.waitForSelector("select", { timeout: 15000 });

    // Listar selects disponibles
    const selects = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("select")).map((s) => ({
        name: s.name,
        id: s.id,
        options: Array.from(s.options).map((o) => o.text),
      }));
    });
    console.log("Selects:", JSON.stringify(selects));

    // Seleccionar tipo de documento
    const selectEl = await page.$("select");
    if (selectEl) {
      await page.select("select", tipoValor);
    }

    // Ingresar número de cédula
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map((i) => ({
        name: i.name,
        id: i.id,
        type: i.type,
        placeholder: i.placeholder,
      }));
    });
    console.log("Inputs:", JSON.stringify(inputs));

    const inputCedula =
      (await page.$('input[id*="cedula"]')) ||
      (await page.$('input[name*="cedula"]')) ||
      (await page.$('input[type="text"]'));

    if (inputCedula) {
      await inputCedula.click({ clickCount: 3 });
      await inputCedula.type(cedula, { delay: 50 });
      console.log("✅ Cédula ingresada");
    } else {
      throw new Error("No se encontró el campo de cédula");
    }

    // ── PASO 3: Resolver reCAPTCHA esperando ────────────────────────────
    console.log("⏳ Esperando 8 segundos para reCAPTCHA...");
    await new Promise((r) => setTimeout(r, 8000));

    // ── PASO 4: Submit ──────────────────────────────────────────────────
    console.log("🔍 Enviando consulta...");
    const botonConsultar =
      (await page.$('input[type="submit"]')) ||
      (await page.$('button[type="submit"]')) ||
      (await page.$(".ui-button"));

    if (botonConsultar) {
      await botonConsultar.click();
    }

    await page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await new Promise((r) => setTimeout(r, 3000));

    const html = await page.content();
    const texto = html.replace(/<[^>]+>/g, " ").toUpperCase();
    console.log(
      "Respuesta:",
      texto.replace(/\s+/g, " ").trim().substring(0, 500),
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
