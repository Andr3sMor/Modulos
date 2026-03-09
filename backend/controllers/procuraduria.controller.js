/**
 * procuraduria.controller.js
 *
 * Flujo real del formulario:
 *   URL pública:  https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx
 *   URL técnica:  https://apps.procuraduria.gov.co/webcert/Certificado.aspx
 *
 * El formulario es ASP.NET WebForms. Al seleccionar el tipo de documento dispara
 * un __doPostBack que recarga el estado. El captcha es un campo de texto con una
 * pregunta que aparece en un label cercano al input "txtRespuestaPregunta".
 * IMPORTANTE: el <h1> decorativo de la página también tiene "?" y se debe ignorar.
 *
 * TIPOS DE CAPTCHA OBSERVADOS:
 *  1. Matemático:   "¿ CUANTO ES 5 + 3 ?"
 *  2. Geográfico:   "¿ CAPITAL DE COLOMBIA ?"
 *  3. Nombre:       "¿ ESCRIBA LAS DOS PRIMERAS LETRAS DEL PRIMER NOMBRE ...?"
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
  "Cedula de Ciudadania": "1",
  "Cédula de Ciudadanía": "1",
  "Cedula de Extranjeria": "2",
  "Cédula de Extranjería": "2",
  Pasaporte: "3",
};

// ─── Browser ──────────────────────────────────────────────────────────────────

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

// ─── Resolver captcha ─────────────────────────────────────────────────────────

const RESPUESTAS_GEO = {
  "CAPITAL DE COLOMBIA": "BOGOTA",
  "CAPITAL COLOMBIA": "BOGOTA",
  "CAPITAL DEL VALLE DEL CAUCA": "CALI",
  "CAPITAL VALLE DEL CAUCA": "CALI",
  "CAPITAL VALLE": "CALI",
  "CAPITAL DE ANTIOQUIA": "MEDELLIN",
  "CAPITAL ANTIOQUIA": "MEDELLIN",
  "CAPITAL DE CUNDINAMARCA": "BOGOTA",
  "CAPITAL CUNDINAMARCA": "BOGOTA",
  "CAPITAL DE ATLANTICO": "BARRANQUILLA",
  "CAPITAL ATLANTICO": "BARRANQUILLA",
  "CAPITAL DE BOLIVAR": "CARTAGENA",
  "CAPITAL BOLIVAR": "CARTAGENA",
  "CAPITAL DE SANTANDER": "BUCARAMANGA",
  "CAPITAL SANTANDER": "BUCARAMANGA",
  "CAPITAL DE NARINO": "PASTO",
  "CAPITAL NARINO": "PASTO",
  "COLOR DEL CIELO": "AZUL",
  "COLOR CIELO": "AZUL",
  "COLOR DEL SOL": "AMARILLO",
  "COLOR SOL": "AMARILLO",
  "DIAS DE LA SEMANA": "7",
  "DIAS SEMANA": "7",
  "MESES DEL ANO": "12",
  "MESES ANO": "12",
};

function norm(t) {
  return t
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolverCaptcha(textoCrudo, nombre) {
  if (!textoCrudo) return null;
  const texto = norm(textoCrudo);

  // 1. Matemático
  const mat = texto.match(/(\d+)\s*([\+\-\*xX×])\s*(\d+)/);
  if (mat) {
    const [, a, op, b] = mat;
    if (op === "+") return String(+a + +b);
    if (op === "-") return String(+a - +b);
    return String(+a * +b);
  }

  // 2. Primeras letras del nombre
  if (
    texto.includes("PRIMERAS LETRAS") ||
    texto.includes("PRIMER NOMBRE") ||
    texto.includes("NOMBRE DE LA PERSONA")
  ) {
    if (nombre && nombre.trim().length >= 2) {
      const pn = norm(nombre.trim().split(/\s+/)[0]);
      const r = pn.substring(0, 2);
      console.log(`✅ Captcha nombre: "${pn}" → "${r}"`);
      return r;
    }
    return "__NOMBRE_REQUERIDO__";
  }

  // 3. Geográfico / diccionario
  for (const [clave, resp] of Object.entries(RESPUESTAS_GEO)) {
    if (texto.includes(clave)) return resp;
  }

  console.log("⚠️ Captcha no reconocido:", textoCrudo);
  return null;
}

// ─── Extraer texto del captcha del DOM ───────────────────────────────────────
// El captcha matemático/texto está en un elemento junto al input txtRespuestaPregunta.
// Se deben ignorar los H1-H6 que son el texto decorativo FAQ de la página.

async function extraerCaptcha(page) {
  return page.evaluate(() => {
    const IGNORAR = new Set([
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "HEADER",
      "FOOTER",
      "NAV",
      "ASIDE",
    ]);
    const esCaptchaValido = (t) =>
      t &&
      t.includes("?") &&
      t.length > 4 &&
      t.length < 350 &&
      /[Cc]uanto|[Cc]apital|[Cc]olor|[Dd]ias|[Mm]eses|[Ll]etras|[Nn]ombre|\d+\s*[\+\-\*xX]/i.test(
        t,
      );

    const inp = document.querySelector("input[name='txtRespuestaPregunta']");
    if (!inp) return { texto: "", via: "input no encontrado" };

    // A: label[for]
    const lbl = document.querySelector("label[for='txtRespuestaPregunta']");
    if (lbl) {
      const t = lbl.innerText.trim();
      if (esCaptchaValido(t)) return { texto: t, via: "label[for]" };
    }

    // B: hermano previo
    const prev = inp.previousElementSibling;
    if (prev && !IGNORAR.has(prev.tagName)) {
      const t = prev.innerText?.trim() || "";
      if (esCaptchaValido(t)) return { texto: t, via: "previousSibling" };
    }

    // C: subir por el DOM buscando hijos hoja con captcha válido
    let parent = inp.parentElement;
    for (let n = 0; n < 10; n++) {
      if (!parent) break;
      const hijos = [
        ...parent.querySelectorAll("label,span,td,b,strong,p,div,li,font"),
      ];
      for (const el of hijos) {
        if (IGNORAR.has(el.tagName)) continue;
        if (el.contains(inp)) continue;
        if (el.children.length > 5) continue;
        const t = (el.innerText || "").trim();
        if (esCaptchaValido(t))
          return { texto: t, via: `DOM nivel ${n} <${el.tagName}>` };
      }
      parent = parent.parentElement;
    }

    // D: TreeWalker sobre nodos de texto (captura texto suelto sin etiqueta)
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
    );
    let node;
    while ((node = walker.nextNode())) {
      let anc = node.parentElement;
      let decorativo = false;
      while (anc) {
        if (IGNORAR.has(anc.tagName)) {
          decorativo = true;
          break;
        }
        anc = anc.parentElement;
      }
      if (decorativo) continue;
      const t = node.textContent.trim();
      if (esCaptchaValido(t)) return { texto: t, via: "TreeWalker textNode" };
    }

    // E: fallback — volcar HTML del contenedor del input para diagnóstico
    let cont = inp.parentElement;
    for (let i = 0; i < 5 && cont; i++) cont = cont.parentElement;
    return {
      texto: "",
      via: "no encontrado",
      htmlDebug: cont ? cont.outerHTML.substring(0, 2000) : "N/A",
    };
  });
}

// ─── Controlador principal ───────────────────────────────────────────────────

exports.consultarProcuraduria = async (req, res) => {
  const {
    cedula,
    tipoDocumento = "CC",
    tipoCertificado = "1",
    nombre = "", // primer nombre, necesario si el captcha pide las 2 primeras letras
  } = req.body;

  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  const ddlTipoID = TIPO_MAP[tipoDocumento] || "1";
  console.log(
    `\n=== Procuraduría: cedula=${cedula} tipo=${tipoDocumento}(${ddlTipoID}) nombre="${nombre}" ===`,
  );

  let browser;
  try {
    browser = await lanzarBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CO,es;q=0.9" });

    // ── 1. Cargar formulario ──────────────────────────────────────────────
    console.log("📄 Cargando formulario...");
    await page.goto(FORM_URL, { waitUntil: "networkidle2", timeout: 45000 });
    console.log("✅ URL:", page.url());
    await sleep(2000);

    // ── 2. Log de inputs (diagnóstico) ───────────────────────────────────
    const inputsLog = await page.evaluate(() =>
      [...document.querySelectorAll("input,select")]
        .map((el) => `${el.tagName}[name=${el.name} type=${el.type}]`)
        .join(" | "),
    );
    console.log("📋 Inputs:", inputsLog.substring(0, 800));

    // ── 3. Seleccionar tipo de documento → dispara postback ASP.NET ──────
    console.log("🔽 Tipo documento:", ddlTipoID);
    await page.select("select[name='ddlTipoID']", ddlTipoID);

    // Esperar que el postback regenere la página con el captcha actualizado
    try {
      await page.waitForFunction(
        () => !!document.querySelector("input[name='txtRespuestaPregunta']"),
        { timeout: 8000 },
      );
    } catch (_) {}
    await sleep(2000); // margen para que el label del captcha se renderice

    // ── 4. Leer captcha ──────────────────────────────────────────────────
    const captchaInfo = await extraerCaptcha(page);
    console.log(
      "🔢 Captcha:",
      captchaInfo.texto || "(vacío)",
      "| vía:",
      captchaInfo.via,
    );
    if (captchaInfo.htmlDebug) {
      console.log("🔍 HTML debug:", captchaInfo.htmlDebug.substring(0, 1000));
    }

    // Si el captcha sigue vacío, buscar en el innerText completo
    let textoCaptcha = captchaInfo.texto;
    if (!textoCaptcha) {
      const innerText = await page.evaluate(() => document.body.innerText);
      const lineas = innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.includes("?") &&
            l.length > 4 &&
            l.length < 350 &&
            /[Cc]uanto|[Cc]apital|[Cc]olor|[Dd]ias|[Mm]eses|[Ll]etras|[Nn]ombre|\d+\s*[\+\-\*xX]/i.test(
              l,
            ),
        );
      console.log("🔎 Candidatos en innerText:", lineas);
      if (lineas.length > 0) textoCaptcha = lineas[0];
    }

    let respuestaCaptcha = resolverCaptcha(textoCaptcha, nombre);
    console.log("🔢 Respuesta:", respuestaCaptcha);

    // Captcha de nombre sin parámetro → abortar
    if (respuestaCaptcha === "__NOMBRE_REQUERIDO__") {
      await browser.close();
      return res.status(422).json({
        error: "Captcha de nombre requerido",
        detalle:
          "El formulario pide las 2 primeras letras del nombre. Incluya el campo 'nombre' en el body.",
        captchaPregunta: textoCaptcha,
      });
    }

    // Fallback si no se pudo resolver
    if (!respuestaCaptcha) {
      console.log("⚠️ Captcha irreconocible, usando fallback '8'");
      respuestaCaptcha = "8";
    }

    // ── 5. Número de documento ───────────────────────────────────────────
    console.log("✏️ Cédula:", cedula);
    await page.click("input[name='txtNumID']", { clickCount: 3 });
    await page.type("input[name='txtNumID']", cedula);

    // ── 6. Tipo de certificado ───────────────────────────────────────────
    try {
      await page.click(`input[name='rblTipoCert'][value='${tipoCertificado}']`);
      await sleep(400);
    } catch (_) {}

    // ── 7. Ingresar captcha ──────────────────────────────────────────────
    await page.click("input[name='txtRespuestaPregunta']", { clickCount: 3 });
    await page.type("input[name='txtRespuestaPregunta']", respuestaCaptcha);
    console.log("✅ Captcha ingresado:", respuestaCaptcha);

    // ── 8. Submit ────────────────────────────────────────────────────────
    console.log("🚀 Enviando...");
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 35000 })
        .catch(() => {}),
      page.click("input[name='ImageButton1']"),
    ]);
    await sleep(2000);

    const urlFinal = page.url();
    const textoPagina = await page.evaluate(() =>
      document.body.innerText.toUpperCase(),
    );
    console.log("📍 URL final:", urlFinal);
    console.log("📝 Resultado (700):", textoPagina.substring(0, 700));

    // ── 9. ¿Volvió al formulario? ────────────────────────────────────────
    const PALABRAS_RESULTADO = [
      "NO REGISTRA",
      "SANCIONADO",
      "INHABILIT",
      "NO PRESENTA",
      "SIN ANTECEDENTES",
    ];
    const tieneResultado = PALABRAS_RESULTADO.some((p) =>
      textoPagina.includes(p),
    );

    if (urlFinal === FORM_URL && !tieneResultado) {
      const captchaNuevo = await extraerCaptcha(page);
      await browser.close();
      return res.status(422).json({
        error: "Formulario rechazado",
        detalle:
          "El servidor volvió al formulario inicial. Captcha incorrecto o sesión vencida.",
        captchaUsado: { pregunta: textoCaptcha, respuesta: respuestaCaptcha },
        captchaNuevo: captchaNuevo.texto || "(no detectado)",
        urlFinal,
      });
    }

    // ── 10. Interpretar resultado ────────────────────────────────────────
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
    return res
      .status(502)
      .json({
        error: "Error consultando Procuraduría",
        detalle: error.message,
      });
  }
};
