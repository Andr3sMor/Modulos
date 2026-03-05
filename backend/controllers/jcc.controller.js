const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const JCC_URL = "https://sgr.jcc.gov.co:8181/apex/f?p=138:1:::NO:::";

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  console.log(`--- Consultando JCC para: ${cedula} ---`);
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

    console.log("📄 Cargando JCC...");
    await page.goto(JCC_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await new Promise((r) => setTimeout(r, 3000));
    console.log("URL actual:", page.url());

    // Listar inputs y selects disponibles
    const elementos = await page.evaluate(() => {
      return {
        inputs: Array.from(document.querySelectorAll("input")).map((i) => ({
          name: i.name,
          id: i.id,
          type: i.type,
          placeholder: i.placeholder,
        })),
        selects: Array.from(document.querySelectorAll("select")).map((s) => ({
          name: s.name,
          id: s.id,
          options: Array.from(s.options).map((o) => ({
            value: o.value,
            text: o.text,
          })),
        })),
        buttons: Array.from(
          document.querySelectorAll("button, input[type='submit']"),
        ).map((b) => ({
          type: b.type,
          text: b.textContent?.trim(),
          id: b.id,
        })),
      };
    });
    console.log("Elementos encontrados:", JSON.stringify(elementos, null, 2));

    // Seleccionar "Cédula de Ciudadanía" en el select
    const selectEl = await page.$("select");
    if (selectEl) {
      const opciones = await page.evaluate(
        (s) => Array.from(s.options).map((o) => o.text),
        selectEl,
      );
      console.log("Opciones del select:", opciones);

      // Buscar opción que contenga "Ciudadanía" o "CC"
      const opcionCC = await page.evaluate((s) => {
        const opt = Array.from(s.options).find(
          (o) =>
            o.text.includes("Ciudadan") ||
            o.text.includes("CC") ||
            o.value === "CC",
        );
        return opt ? opt.value : null;
      }, selectEl);

      if (opcionCC) {
        await page.select("select", opcionCC);
        console.log("✅ Tipo documento seleccionado:", opcionCC);
      }
    }

    // Ingresar número de documento
    const inputDoc =
      (await page.$(`input[name="P1_NUMERO_DOCUMENTO"]`)) ||
      (await page.$('input[type="text"]'));

    if (!inputDoc) throw new Error("No se encontró el campo de documento");

    await inputDoc.click({ clickCount: 3 });
    await inputDoc.type(cedula, { delay: 50 });
    console.log("✅ Cédula ingresada");

    // Click en Consultar
    const boton =
      (await page.$('button[type="submit"]')) ||
      (await page.$('input[type="submit"]')) ||
      (await page.$(".t-Button"));

    if (!boton) throw new Error("No se encontró el botón Consultar");

    await boton.click();
    console.log("🔍 Consulta enviada, esperando resultado...");

    await new Promise((r) => setTimeout(r, 5000));

    const html = await page.content();
    const texto = html.replace(/<[^>]+>/g, " ").toUpperCase();
    console.log(
      "Respuesta (500 chars):",
      texto.replace(/\s+/g, " ").trim().substring(0, 500),
    );

    const esContador =
      texto.includes("CONTADOR PÚBLICO") ||
      texto.includes("HABILITADO") ||
      texto.includes("CONTADOR PUBLICO");

    const noEsContador =
      texto.includes("NO REGISTRA") ||
      texto.includes("NO SE ENCUENTRA") ||
      texto.includes("NO REGISTRA INFORMACION");

    return res.json({
      fuente: "Junta Central de Contadores",
      esContador,
      documento: cedula,
      mensaje: esContador
        ? "La persona ES Contador Público registrado."
        : noEsContador
          ? "La persona NO está registrada como Contador Público."
          : "Sin resultado claro.",
      detalle: texto.replace(/\s+/g, " ").trim().substring(0, 600),
    });
  } catch (error) {
    console.error("❌ ERROR JCC:", error.message);
    return res.status(502).json({
      error: "Error en consulta JCC",
      detalle: error.message,
    });
  } finally {
    if (browser) await browser.close();
  }
};
