"use strict";

/**
 * PoliciaService — JavaScript
 *
 * Scraper de antecedentes judiciales — Policía Nacional de Colombia.
 * Usa Puppeteer + Stealth + extensión rektcaptcha + Xvfb en servidores Linux.
 *
 * REQUISITOS:
 *   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
 *   apt-get install -y xvfb          (solo en servidores Linux)
 *
 * USO:
 *   const svc = new PoliciaService(mysqlService, imagesUpload, configService);
 *   await svc.onModuleInit();
 *   const results = await svc.search(clients);
 *   await svc.onModuleDestroy();
 */

const path = require("path");
const child_process = require("child_process");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

class PoliciaService {
  /**
   * @param {object} mysqlService   — instancia con método query(sql, params)
   * @param {object} imagesUpload   — instancia con método imageServerLoad(buffer, prefix)
   * @param {object} configService  — instancia con método get(key) (puede ser null)
   */
  constructor(mysqlService, imagesUpload, configService) {
    this.mysqlService = mysqlService;
    this.imagesUpload = imagesUpload;
    this.configService = configService;

    this.logger = {
      log: (m) => console.log(`[PoliciaService] ${m}`),
      warn: (m) => console.warn(`[PoliciaService] ⚠️  ${m}`),
      error: (m, e) => console.error(`[PoliciaService] ❌ ${m}`, e ?? ""),
      debug: (m) => console.debug(`[PoliciaService] ${m}`),
    };

    this.url =
      "https://antecedentes.policia.gov.co:7005/WebJudicial/antecedentes.xhtml";

    this.extensionPath = path.resolve(
      __dirname,
      "../browser-extensions/rektcaptcha", // ajusta esta ruta si es necesario
    );

    this.xvfbDisplay = ":99";
    this.xvfbProcess = null;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit() {
    const isStealthLoaded = puppeteer.plugins.some((p) => p.name === "stealth");
    if (!isStealthLoaded) {
      puppeteer.use(StealthPlugin());
    }
    this.startXvfb();
  }

  async onModuleDestroy() {
    this.stopXvfb();
  }

  // ─── Xvfb ──────────────────────────────────────────────────────────────────

  /**
   * Inicia Xvfb (pantalla virtual) para que las extensiones de Chrome funcionen
   * correctamente en servidores Linux sin monitor físico.
   *
   * Equivale a:
   *   Xvfb :99 -screen 0 1920x1080x24 &
   *   export DISPLAY=:99
   */
  startXvfb() {
    if (process.platform !== "linux") {
      this.logger.warn(
        "No es Linux — omitiendo Xvfb. Se usará el display del sistema.",
      );
      return;
    }

    try {
      child_process.execSync("which Xvfb", { stdio: "ignore" });
    } catch {
      this.logger.error(
        "Xvfb no encontrado. Instálalo con: apt-get install -y xvfb\n" +
          "Las extensiones pueden no funcionar en modo headless sin él.",
      );
      return;
    }

    // Limpiar proceso previo en este display
    try {
      child_process.execSync(`pkill -f "Xvfb ${this.xvfbDisplay}"`, {
        stdio: "ignore",
      });
      this.logger.log("Proceso Xvfb anterior limpiado.");
    } catch {
      // No había proceso previo — está bien
    }

    this.logger.log(`Iniciando Xvfb en display ${this.xvfbDisplay}...`);

    this.xvfbProcess = child_process.spawn(
      "Xvfb",
      [this.xvfbDisplay, "-screen", "0", "1920x1080x24", "-ac"],
      { detached: false, stdio: "ignore" },
    );

    this.xvfbProcess.on("error", (err) => {
      this.logger.error("Error en proceso Xvfb:", err.message);
    });

    this.xvfbProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        this.logger.warn(`Xvfb terminó con código ${code}`);
      }
    });

    // Apuntar DISPLAY al servidor virtual para este proceso y sus hijos
    process.env.DISPLAY = this.xvfbDisplay;
    this.logger.log(`✅ Xvfb iniciado. DISPLAY=${this.xvfbDisplay}`);
  }

  stopXvfb() {
    if (this.xvfbProcess) {
      this.logger.log("Deteniendo Xvfb...");
      this.xvfbProcess.kill("SIGTERM");
      this.xvfbProcess = null;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Transforma los params genéricos al formato que usa este servicio.
   * @param {Array} params
   */
  params(params) {
    return params
      .filter((e) => e.is_full_params || e.is_identification)
      .map((e) => ({
        identificator: e.identificator,
        identification: Number(e.id_number.replace(/[.,]/g, "")).toString(),
        id_type: e.id_type,
        client_type: e.client_type,
      }));
  }

  /**
   * Punto de entrada principal. Procesa una lista de clientes.
   * @param {Array<{identificator, identification, id_type, client_type}>} clients
   * @returns {Promise<Array>}
   */
  async search(clients) {
    if (clients.length === 0) return [];

    const results = [];

    try {
      for (const client of clients) {
        const result = await this.processClientWithRetry(client);
        if (result) results.push(result);
      }
      return results;
    } catch (e) {
      this.logger.error("Error crítico global en search()", e);
      return [];
    }
  }

  // ─── Browser ───────────────────────────────────────────────────────────────

  /**
   * Lanza Chrome con headless:false apuntando al display virtual de Xvfb.
   * Esto es necesario para que las extensiones (rektcaptcha) carguen correctamente.
   */
  async launchBrowser() {
    const browser = await puppeteer.launch({
      // headless: false es OBLIGATORIO para extensiones.
      // En servidor, Xvfb actúa como pantalla virtual — no se abre ninguna ventana real.
      headless: false,
      devtools: false,
      ignoreHTTPSErrors: true, // El portal de la policía tiene cert autofirmado
      args: [
        `--disable-extensions-except=${this.extensionPath}`,
        `--load-extension=${this.extensionPath}`,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-features=IsolateOrigins,site-per-process",
        "--ignore-certificate-errors",
        "--allow-running-insecure-content",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage", // Usar /tmp en lugar de /dev/shm (estabilidad en Docker)
        "--disable-gpu", // Obligatorio en servidores sin GPU
        "--no-zygote",
        "--disable-software-rasterizer",
        "--font-render-hinting=none",
        "--window-size=1920,1080",
        `--display=${process.env.DISPLAY ?? this.xvfbDisplay}`,
      ],
      ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY ?? this.xvfbDisplay,
      },
    });

    // Cargar la página de extensiones para asegurar que el service worker se inicializa
    const page = await browser.newPage();
    try {
      await page.goto("chrome://extensions/", {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
    } catch (_) {
      /* ignorar timeout */
    }
    await this.delay(500);
    await page.close().catch(() => {});

    return browser;
  }

  async configureExtension(browser) {
    try {
      const targets = await browser.targets();
      const extensionTarget = targets.find(
        (t) => t.type() === "service_worker" || t.url().includes("rektcaptcha"),
      );

      if (extensionTarget) {
        const worker = await extensionTarget.worker();
        if (worker) {
          await worker.evaluate(() => {
            const chrome = self.chrome;
            if (chrome?.storage?.local) {
              chrome.storage.local.set({
                recaptcha_auto_open: true,
                recaptcha_auto_solve: true,
                recaptcha_click_delay_time: 300,
                recaptcha_solve_delay_time: 1000,
              });
            }
          });
          this.logger.log("✅ rektCaptcha configurado correctamente.");
        }
      } else {
        this.logger.warn(
          "Target de rektCaptcha no encontrado. " +
            "Verifica la ruta de la extensión y que Xvfb esté corriendo.",
        );
      }
    } catch (error) {
      this.logger.warn(`No se pudo configurar la extensión: ${error.message}`);
    }
  }

  // ─── Retry Logic ───────────────────────────────────────────────────────────

  async processClientWithRetry(client) {
    let attempt = 0;
    let success = false;
    let result = null;
    const { identificator, identification } = client;
    const start_time = Date.now();

    let browser = null;
    let page = null;

    try {
      browser = await this.launchBrowser();
      await this.configureExtension(browser);
      page = await browser.newPage();

      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.text().includes("PrimeFaces")) {
          this.logger.debug(`[BROWSER] ${msg.text()}`);
        }
      });

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      );

      while (attempt < 5 && !success) {
        attempt++;
        let screenshotUrl = "";

        try {
          this.logger.log(
            `Procesando ${identification} (intento ${attempt}/5)...`,
          );

          if (attempt > 1) {
            this.logger.log("Recargando página para reintento...");
            await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
          }

          const { message, alert, evidenceUrl } =
            await this.executeScrapingFlow(page, client);

          screenshotUrl = evidenceUrl;
          const duration = (Date.now() - start_time) / 1000;

          await this.registerResult(
            identificator,
            screenshotUrl,
            message,
            duration,
            false,
            alert,
          );

          result = {
            identificator,
            screenshotUrl,
            alert,
            duration,
            client: `${identification}`,
            message,
            status: "Processed",
          };
          success = true;
        } catch (err) {
          this.logger.error(
            `Intento ${attempt} falló para ${identification}: ${err.message}`,
          );

          if (err.message.includes("Error de navegación")) {
            await this.insertRecordDB(
              "INSERT INTO logger_web_page_tbl (message, web_page) VALUES (?, ?)",
              [
                `No se pudo acceder a ${this.url}. Intento ${attempt}.`,
                "Antecedentes Policiales",
              ],
            );
          }

          if (attempt >= 5) {
            const duration = (Date.now() - start_time) / 1000;
            if (page && !page.isClosed()) {
              try {
                const buffer = await page.screenshot({ fullPage: true });
                screenshotUrl = await this.imagesUpload.imageServerLoad(
                  Buffer.from(buffer),
                  "policia_error",
                );
              } catch (_) {
                /* ignorar error de screenshot */
              }
            }

            const failureMessage = `Falló tras 5 intentos. Último error: ${err.message}`;
            await this.registerResult(
              identificator,
              screenshotUrl,
              failureMessage,
              (Date.now() - start_time) / 1000,
              true,
              false,
            );

            result = {
              identificator,
              screenshotUrl,
              alert: true,
              duration: (Date.now() - start_time) / 1000,
              client: `${identification}`,
              error: failureMessage,
            };
          } else {
            if (
              err.message.includes("Target closed") ||
              err.message.includes("Session closed")
            ) {
              this.logger.warn("Browser crasheado — reiniciando instancia...");
              if (browser) await browser.close().catch(() => {});
              browser = await this.launchBrowser();
              await this.configureExtension(browser);
              page = await browser.newPage();
            }
            await this.delay(3000);
          }
        }
      }
    } catch (criticalErr) {
      this.logger.error(
        "Error crítico en ciclo de vida del browser:",
        criticalErr,
      );
    } finally {
      if (browser) await browser.close().catch(() => {});
    }

    return result;
  }

  // ─── Scraping Flow ─────────────────────────────────────────────────────────

  async executeScrapingFlow(page, client) {
    const { identification, id_type } = client;

    this.logger.log("🌐 Navegando a URL inicial...");
    await page.goto(this.url, { waitUntil: "networkidle2", timeout: 45000 });
    await this.delay(3000);

    const directAccess = await page.evaluate(() => {
      const el = document.getElementById("cedulaInput");
      return el && el.offsetParent !== null;
    });

    if (directAccess) {
      this.logger.log("🚀 Acceso directo detectado. Saltando términos.");
    } else {
      this.logger.warn("🔒 Ejecutando flujo de aceptación de términos...");
      await this.ensureTermsAcceptedLoop(page);
      await this.clickContinueWithRetries(page, 3);
    }

    await this.verifyAntecedentesPage(page);
    await this.handleCaptcha(page);
    await this.performSearch(page, identification);

    const { text } = await this.validateResultsLoaded(page);

    const nowStr = new Date().toLocaleString();
    let alert;
    let message;

    if (text.toUpperCase().includes("NO TIENE ASUNTOS PENDIENTES")) {
      alert = false;
      message =
        `El día ${nowStr} se verifica en el sistema de antecedentes policiales ` +
        `que el registro identificado con ${id_type} ${identification} no tiene antecedentes judiciales.`;
    } else {
      alert = true;
      message =
        `El día ${nowStr} se verifica en el sistema de antecedentes policiales ` +
        `que el registro identificado con ${id_type} ${identification} TIENE antecedentes judiciales.`;
    }

    let evidenceUrl = "";
    try {
      const buffer = await page.screenshot({
        fullPage: false,
        fromSurface: true,
      });
      evidenceUrl = await this.imagesUpload.imageServerLoad(
        Buffer.from(buffer),
        "policia",
      );
    } catch (imgError) {
      this.logger.warn("Error subiendo screenshot: " + imgError.message);
    }

    return { message, alert, evidenceUrl };
  }

  // ─── Step Helpers ──────────────────────────────────────────────────────────

  async ensureTermsAcceptedLoop(page) {
    let attempts = 0;
    const maxAttempts = 10;
    let success = false;

    while (attempts < maxAttempts && !success) {
      attempts++;
      this.logger.log(`🔄 Términos — intento ${attempts}/${maxAttempts}...`);

      try {
        const navOptions = { waitUntil: "networkidle2", timeout: 45000 };

        if (attempts === 1) {
          await page.goto(this.url, navOptions);
        } else {
          await page.reload(navOptions);
        }

        await this.delay(3000);

        const radioSelector = "#aceptaOption\\:0";
        try {
          await page.waitForSelector(radioSelector, { timeout: 10000 });
        } catch {
          this.logger.warn("   > Radio button no apareció. Recargando...");
          continue;
        }

        await page.click(radioSelector);
        let isEnabled = await this.checkContinueButton(page);

        if (!isEnabled) {
          this.logger.warn(
            "   > Primer click no activó el botón. Reintentando con JS...",
          );
          await this.delay(2000);
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.click();
          }, radioSelector);
          await this.delay(4000);
          isEnabled = await this.checkContinueButton(page);
        }

        if (isEnabled) {
          this.logger.log("✅ Botón Continuar activado.");
          success = true;
        } else {
          this.logger.warn("⚠️  Botón no activado. Reiniciando ciclo...");
        }
      } catch (e) {
        this.logger.warn(`   > Error en intento ${attempts}: ${e.message}`);
      }

      if (!success && attempts < maxAttempts) {
        await this.delay(2000);
      }
    }

    if (!success) {
      throw new Error(
        "No se pudo activar el botón de continuar tras 10 intentos.",
      );
    }
  }

  async checkContinueButton(page) {
    return await page.evaluate(() => {
      const btn = document.querySelector("#continuarBtn");
      return (
        btn &&
        !btn.classList.contains("ui-state-disabled") &&
        !btn.hasAttribute("disabled")
      );
    });
  }

  async clickContinueWithRetries(page, maxRetries) {
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;

      const alreadyThere = await page
        .evaluate(
          () =>
            window.location.href.includes("antecedentes.xhtml") ||
            !!document.getElementById("cedulaInput"),
        )
        .catch(() => false);

      if (alreadyThere) {
        this.logger.log("✅ Ya estamos en la página de antecedentes.");
        return;
      }

      this.logger.log(`🔵 Intento ${attempt}: Click en Continuar...`);
      const btnSelector = "#continuarBtn";
      await page
        .waitForSelector(btnSelector, { timeout: 5000 })
        .catch(() => {});

      try {
        await Promise.all([
          page
            .waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 })
            .catch(() => null),
          page.click(btnSelector),
        ]);

        if (page.url().includes("antecedentes.xhtml")) {
          this.logger.log("✅ Navegación exitosa.");
          return;
        }
      } catch (e) {
        this.logger.warn(`⚠️  Click falló: ${e.message}`);
      }

      if (attempt > 1) {
        await page.evaluate((sel) => {
          const btn = document.querySelector(sel);
          if (btn) btn.click();
        }, btnSelector);
        await this.delay(5000);
        if (page.url().includes("antecedentes.xhtml")) {
          this.logger.log("✅ Navegación exitosa tras JS click.");
          return;
        }
      }

      await this.delay(2000);
    }

    throw new Error(
      "No se pudo navegar a la página de antecedentes. URL final: " +
        page.url(),
    );
  }

  async verifyAntecedentesPage(page) {
    this.logger.log("🔍 Verificando página de antecedentes...");
    let validated = false;
    let validatorAttempts = 0;

    while (validatorAttempts < 3 && !validated) {
      validatorAttempts++;
      try {
        await page.waitForFunction(
          () => window.location.href.includes("antecedentes.xhtml"),
          { timeout: 10000 },
        );
        await page.waitForSelector("#cedulaInput", { timeout: 10000 });
        validated = true;
        this.logger.log("✅ Página de antecedentes confirmada.");
      } catch (e) {
        this.logger.warn(
          `⚠️  Validación intento ${validatorAttempts} falló: ${e.message}`,
        );
        await this.delay(2000);
      }
    }

    if (!validated) {
      throw new Error("No se pudo validar la página de antecedentes.");
    }
  }

  async handleCaptcha(page) {
    this.logger.log("Esperando rektCaptcha...");
    await page.setViewport({ width: 1280, height: 800 });

    let solved = false;
    let detachedCount = 0;

    for (let i = 1; i <= 60; i++) {
      try {
        if (page.isClosed()) throw new Error("Page cerrada (crash detectado)");

        solved = await page.evaluate(() => {
          try {
            const el = document.getElementById("g-recaptcha-response");
            return !!(el && el.value && el.value.trim().length > 0);
          } catch (_) {
            return false;
          }
        });

        if (detachedCount > 0) {
          this.logger.log(
            `✅ Contexto recuperado tras ${detachedCount} errores.`,
          );
          detachedCount = 0;
        }
      } catch (e) {
        const isDetached =
          e.message.includes("detached") ||
          e.message.includes("shutting down") ||
          e.message.includes("Target closed") ||
          e.message.includes("Execution context was destroyed");

        if (isDetached) {
          detachedCount++;
          this.logger.warn(
            `⚠️  Detached #${detachedCount}. Esperando recuperación...`,
          );
          if (detachedCount > 10) {
            throw new Error(
              "Browser atascado en estado detached. Forzando reintento.",
            );
          }
          solved = false;
          await this.delay(2000);
        } else {
          throw e;
        }
      }

      if (solved) {
        this.logger.log("✅ Captcha resuelto.");
        break;
      }

      if (i % 5 === 0) this.logger.log(`⏳ Resolviendo captcha... (${i * 2}s)`);
      await this.delay(2000);
    }

    if (!solved)
      throw new Error("Tiempo de espera del captcha agotado (120s).");
  }

  async performSearch(page, identification) {
    this.logger.log(`Ingresando ID: ${identification}`);
    await page.waitForSelector("input[type='text']", { timeout: 15000 });

    const inputFound = await page.evaluate((idNum) => {
      const inputs = Array.from(
        document.querySelectorAll('input[type="text"]'),
      );
      const visibleInput = inputs.find((i) => i.offsetParent !== null);
      if (visibleInput) {
        visibleInput.value = idNum;
        visibleInput.dispatchEvent(new Event("input", { bubbles: true }));
        visibleInput.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }, identification);

    if (!inputFound) {
      await page.type('input[type="text"]', identification);
    }

    this.logger.log("Consultando...");
    await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('button, a, input[type="submit"]'),
      );
      const searchBtn = buttons.find(
        (b) =>
          b.textContent?.toLowerCase().includes("consultar") ||
          b.textContent?.toLowerCase().includes("buscar") ||
          b.id.includes("j_idt17"),
      );
      if (searchBtn) searchBtn.click();
    });

    await this.delay(5000);
  }

  async validateResultsLoaded(page) {
    this.logger.log("Validando resultados...");
    const result = await page.evaluate(() => {
      const selectors = [
        "#antecedentes",
        "#form\\:j_idt8_content",
        "#form\\:j_idt8",
        "#form",
        "body",
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.textContent && el.textContent.trim().length > 100)
          return { found: true, text: el.textContent.trim() };
      }
      return { found: false, text: "" };
    });

    if (!result.found)
      throw new Error("No se encontró texto de resultados tras la búsqueda.");
    return result;
  }

  // ─── Database ──────────────────────────────────────────────────────────────

  async registerResult(
    identificator,
    screenshotUrl,
    message,
    duration,
    error,
    validation,
  ) {
    await this.insertRecordDB(
      "INSERT INTO policia_antecendetes_tbl (id, client_id, evidence, message, duration, error, validation) VALUES (UUID(),?,?,?,?,?,?)",
      [identificator, screenshotUrl, message, duration, error, validation],
    );

    await this.insertRecordDB(
      "UPDATE client_tbl SET policia_antecendetes = 1 WHERE id = ?",
      [identificator],
    );

    if (validation) {
      try {
        await this.mysqlService.query(
          "INSERT INTO alert_tbl (type, level, client_id) VALUES (?, ?, ?)",
          ["Consulta antecedentes policiales Colombia", "1", identificator],
        );
      } catch (_) {
        /* ignorar error de alerta */
      }
    }
  }

  async insertRecordDB(query, values) {
    try {
      await this.mysqlService.query(query, values);
    } catch (e) {
      this.logger.error("Error al insertar en base de datos", e);
    }
  }

  delay(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }
}

module.exports = { PoliciaService };
