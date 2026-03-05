const puppeteer = require("puppeteer-core");

const PROXIES = [
  "http://203.24.108.161:80",
  "http://185.162.231.106:80",
  "http://103.149.162.194:80",
  "http://91.108.4.179:3128",
  "http://190.61.88.147:8080",
];

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  console.log(`--- Iniciando consulta JCC para: ${cedula} ---`);

  let browser;
  let ultimoError;

  for (const proxy of PROXIES) {
    try {
      console.log(`🔄 Intentando con proxy: ${proxy}`);

      browser = await puppeteer.launch({
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          `--proxy-server=${proxy}`,
        ],
        executablePath:
          "/nix/store/khk7xpgsm5insk81azy9d560yq4npf77-chromium-131.0.6778.204/bin/chromium-browser",
        headless: true,
      });

      const page = await browser.newPage();

      await page.goto("https://sgr.jcc.gov.co:8181/apex/f?p=138:1:::NO:::", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });

      await new Promise((r) => setTimeout(r, 3000));

      const pageContent = await page.content();
      console.log("HTML primeros 200 chars:", pageContent.substring(0, 200));

      if (pageContent.includes("403") || pageContent.includes("Forbidden")) {
        console.log(`❌ Proxy ${proxy} bloqueado, intentando siguiente...`);
        await browser.close();
        browser = null;
        continue;
      }

      // Aceptar términos si aparecen
      if (pageContent.includes("Acepto") || pageContent.includes("acepto")) {
        console.log("📋 Aceptando términos...");
        await page.evaluate(() => {
          const radios = document.querySelectorAll('input[type="radio"]');
          radios.forEach((r) => {
            if (
              r.value === "Acepto" ||
              r.value === "acepto" ||
              r.value === "1"
            ) {
              r.click();
            }
          });
        });
        await page.click('input[type="submit"], button[type="submit"]');
        await page.waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 20000,
        });
        await new Promise((r) => setTimeout(r, 3000));
      }

      const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("input")).map((i) => ({
          name: i.name,
          id: i.id,
          type: i.type,
        }));
      });
      console.log("Inputs encontrados:", JSON.stringify(inputs));

      await page.type('input[name="P1_NUMERO_DOCUMENTO"]', cedula);
      await page.click('button[type="submit"], input[type="submit"]');
      await page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 20000,
      });

      const html = await page.content();
      const esContador = html.includes("CONTADOR PÚBLICO");

      console.log("✅ Consulta exitosa. Es contador:", esContador);
      return res.json({ esContador, documento: cedula });
    } catch (error) {
      console.error(`❌ Error con proxy ${proxy}:`, error.message);
      ultimoError = error;
      if (browser) {
        await browser.close();
        browser = null;
      }
    }
  }

  // Si todos los proxies fallaron
  res.status(502).json({
    error: "Todos los proxies fallaron",
    detalle: ultimoError?.message,
    nota: "Los proxies públicos son inestables. Considera usar ScraperAPI.",
  });
};
