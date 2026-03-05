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
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    // Esperar que el JS renderice la página
    await new Promise((r) => setTimeout(r, 8000));

    // Imprimir HTML para debuggear qué cargó
    const htmlDebug = await page.content();
    console.log(
      "HTML (800 chars):",
      htmlDebug
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 800),
    );

    // Listar todos los elementos interactivos
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
          class: b.className,
        })),
        iframes: Array.from(document.querySelectorAll("iframe")).map((f) => ({
          src: f.src,
          id: f.id,
          name: f.name,
        })),
      };
    });
    console.log("Elementos:", JSON.stringify(elementos, null, 2));

    return res.json({
      fuente: "Junta Central de Contadores",
      esContador: false,
      documento: cedula,
      mensaje: "Debug: revisando estructura de página",
      detalle: JSON.stringify(elementos),
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
