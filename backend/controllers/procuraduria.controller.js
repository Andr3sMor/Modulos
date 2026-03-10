/**
 * procuraduria.controller.js
 *
 * Flujo real del formulario:
 *   URL pública:  https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx
 *   URL técnica:  https://apps.procuraduria.gov.co/webcert/Certificado.aspx
 *
 * El formulario es ASP.NET WebForms con UpdatePanel (AJAX parcial).
 * Al seleccionar el tipo de documento dispara un __doPostBack que recarga el estado.
 * El captcha es un campo de texto con una pregunta en un label cercano al input
 * "txtRespuestaPregunta". El <h1> decorativo también tiene "?" y se debe ignorar.
 *
 * TIPOS DE CAPTCHA SOPORTADOS:
 *  1. Matemático:        "¿ CUANTO ES 5 + 3 ?"
 *  2. Geográfico:        "¿ CAPITAL DE COLOMBIA ?"
 *  3. Nombre:            "¿ ESCRIBA LAS DOS PRIMERAS LETRAS DEL PRIMER NOMBRE ...?"
 *  4. Últimos dígitos:   "¿ ESCRIBA LOS DOS ULTIMOS DIGITOS DEL DOCUMENTO A CONSULTAR?"
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const PORTAL_URL =
  "https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx";
const FORM_URL = "https://apps.procuraduria.gov.co/webcert/Certificado.aspx";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Mapa de tipos de documento ───────────────────────────────────────────────

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

// ─── Diccionario geográfico / general ─────────────────────────────────────────

const RESPUESTAS_GEO = {
  // Colombia general
  "CAPITAL DE COLOMBIA": "BOGOTA",
  "CAPITAL COLOMBIA": "BOGOTA",
  "CUAL ES LA CAPITAL DE COLOMBIA": "BOGOTA",
  // Departamentos
  "CAPITAL DE CUNDINAMARCA": "BOGOTA",
  "CAPITAL CUNDINAMARCA": "BOGOTA",
  "CAPITAL DE ANTIOQUIA": "MEDELLIN",
  "CAPITAL ANTIOQUIA": "MEDELLIN",
  "CAPITAL DE ANTIOQUIA SIN TILDE": "MEDELLIN",
  "CUAL ES LA CAPITAL DE ANTIOQUIA": "MEDELLIN",
  "CAPITAL DEL VALLE DEL CAUCA": "CALI",
  "CAPITAL VALLE DEL CAUCA": "CALI",
  "CAPITAL VALLE": "CALI",
  "CAPITAL DE ATLANTICO": "BARRANQUILLA",
  "CAPITAL ATLANTICO": "BARRANQUILLA",
  "CAPITAL DE BOLIVAR": "CARTAGENA",
  "CAPITAL BOLIVAR": "CARTAGENA",
  "CAPITAL DE SANTANDER": "BUCARAMANGA",
  "CAPITAL SANTANDER": "BUCARAMANGA",
  "CAPITAL DE NARINO": "PASTO",
  "CAPITAL NARINO": "PASTO",
  "CAPITAL DE TOLIMA": "IBAGUE",
  "CAPITAL TOLIMA": "IBAGUE",
  "CAPITAL DE HUILA": "NEIVA",
  "CAPITAL HUILA": "NEIVA",
  "CAPITAL DEL HUILA": "NEIVA",
  "CAPITAL DE BOYACA": "TUNJA",
  "CAPITAL BOYACA": "TUNJA",
  "CAPITAL DE CALDAS": "MANIZALES",
  "CAPITAL CALDAS": "MANIZALES",
  "CAPITAL DE RISARALDA": "PEREIRA",
  "CAPITAL RISARALDA": "PEREIRA",
  "CAPITAL DE QUINDIO": "ARMENIA",
  "CAPITAL QUINDIO": "ARMENIA",
  "CAPITAL DE CORDOBA": "MONTERIA",
  "CAPITAL CORDOBA": "MONTERIA",
  "CAPITAL DE SUCRE": "SINCELEJO",
  "CAPITAL SUCRE": "SINCELEJO",
  "CAPITAL DE CESAR": "VALLEDUPAR",
  "CAPITAL CESAR": "VALLEDUPAR",
  "CAPITAL DE MAGDALENA": "SANTA MARTA",
  "CAPITAL MAGDALENA": "SANTA MARTA",
  "CAPITAL DE LA GUAJIRA": "RIOHACHA",
  "CAPITAL GUAJIRA": "RIOHACHA",
  "CAPITAL DE NORTE DE SANTANDER": "CUCUTA",
  "CAPITAL NORTE DE SANTANDER": "CUCUTA",
  "CAPITAL DEL META": "VILLAVICENCIO",
  "CAPITAL META": "VILLAVICENCIO",
  "CAPITAL DE CASANARE": "YOPAL",
  "CAPITAL CASANARE": "YOPAL",
  "CAPITAL DE NARIÑO": "PASTO",
  // Colores / datos generales
  "COLOR DEL CIELO": "AZUL",
  "COLOR CIELO": "AZUL",
  "COLOR DEL SOL": "AMARILLO",
  "COLOR SOL": "AMARILLO",
  "DIAS DE LA SEMANA": "7",
  "DIAS SEMANA": "7",
  "MESES DEL ANO": "12",
  "MESES ANO": "12",
  "MESES DEL AÑO": "12",
};

// ─── Normalización de texto ────────────────────────────────────────────────────

function norm(t) {
  return t
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Resolver captcha ─────────────────────────────────────────────────────────
// Recibe el texto crudo del captcha, el primer nombre y la cédula completa.

function resolverCaptcha(textoCrudo, nombre = "", cedula = "") {
  if (!textoCrudo) return null;
  const texto = norm(textoCrudo);
  console.log("🔍 Captcha normalizado:", texto);

  // 1. Matemático:  "CUANTO ES 5 + 3"
  const mat = texto.match(/(\d+)\s*([\+\-\*xX×])\s*(\d+)/);
  if (mat) {
    const [, a, op, b] = mat;
    let r;
    if (op === "+") r = +a + +b;
    else if (op === "-") r = +a - +b;
    else r = +a * +b;
    console.log(`✅ Captcha matemático: ${a} ${op} ${b} = ${r}`);
    return String(r);
  }

  // 2. Últimos N dígitos del documento
  //    "ESCRIBA LOS DOS ULTIMOS DIGITOS DEL DOCUMENTO A CONSULTAR"
  //    "ESCRIBA LOS 2 ULTIMOS DIGITOS..."
  //    "ULTIMOS 3 DIGITOS"
  const digitosRe =
    /(?:ULTIMOS?|ÚLTIMOS?)\s*(\d+|DOS|TRES|CUATRO|CINCO|UN|UNO)\s*D[IÍ]GITOS?/i;
  const digitosMatch = texto.match(digitosRe);
  if (
    digitosMatch ||
    texto.includes("ULTIMOS DIGITOS") ||
    texto.includes("ULTIMO DIGITO")
  ) {
    let n = 2; // por defecto 2
    if (digitosMatch) {
      const raw = digitosMatch[1].toUpperCase();
      const MAP_N = {
        UN: 1,
        UNO: 1,
        DOS: 2,
        TRES: 3,
        CUATRO: 4,
        CINCO: 5,
      };
      n = MAP_N[raw] !== undefined ? MAP_N[raw] : parseInt(raw) || 2;
    }
    if (cedula && cedula.length >= n) {
      const r = cedula.slice(-n);
      console.log(`✅ Captcha dígitos: últimos ${n} de "${cedula}" → "${r}"`);
      return r;
    }
    console.log("⚠️ Captcha dígitos sin cédula disponible");
    return "__CEDULA_REQUERIDA__";
  }

  // 3. Primeras letras del primer nombre
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
    console.log("⚠️ Captcha nombre sin parámetro 'nombre'");
    return "__NOMBRE_REQUERIDO__";
  }

  // 4. Geográfico / diccionario — buscar cualquier clave contenida en el texto
  for (const [clave, resp] of Object.entries(RESPUESTAS_GEO)) {
    if (texto.includes(clave)) {
      console.log(`✅ Geo: "${clave}"→"${resp}"`);
      return resp;
    }
  }

  console.log("⚠️ Captcha no reconocido:", textoCrudo);
  return null;
}

// ─── Extraer texto del captcha del DOM ───────────────────────────────────────

async function extraerCaptcha(frame) {
  return frame.evaluate(() => {
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
      t.length < 400 &&
      /[Cc]uanto|[Cc]apital|[Cc]olor|[Dd]ias|[Mm]eses|[Ll]etras|[Nn]ombre|[Dd][ií]gito|\d+\s*[\+\-\*xX]/i.test(
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

    // C: subir por el DOM
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

    // D: TreeWalker sobre nodos de texto
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

    // E: fallback diagnóstico
    let cont = inp.parentElement;
    for (let i = 0; i < 5 && cont; i++) cont = cont.parentElement;
    return {
      texto: "",
      via: "no encontrado",
      htmlDebug: cont ? cont.outerHTML.substring(0, 2000) : "N/A",
    };
  });
}

// ─── Verificar campos hidden de ASP.NET ──────────────────────────────────────

async function verificarHiddenFields(frame) {
  const fields = await frame.evaluate(() =>
    ["__VIEWSTATE", "__EVENTVALIDATION", "__VIEWSTATEGENERATOR"].map((name) => {
      const el = document.querySelector(`input[name="${name}"]`);
      return { name, exists: !!el, len: el?.value?.length || 0 };
    }),
  );
  console.log("🔒 Hidden fields ASP.NET:", fields);
  return fields;
}

// ─── Esperar resultado del UpdatePanel ────────────────────────────────────────

const PALABRAS_RESULTADO = [
  "NO REGISTRA",
  "SANCIONADO",
  "INHABILIT",
  "NO PRESENTA",
  "SIN ANTECEDENTES",
  "NO SE ENCONTRARON",
  "NO TIENE SANCIONES",
  "SUSPENDIDO",
  "DESTITUIDO",
  "MULTA",
];

async function esperarResultadoUpdatePanel(frame, timeoutMs = 30000) {
  try {
    await frame.waitForFunction(
      (palabras) => {
        const body = document.body.innerText.toUpperCase();
        // Resultado positivo
        if (palabras.some((p) => body.includes(p))) return true;
        // Volvió al formulario con nuevo captcha (postback completó, aunque con error)
        const tieneFormNuevo =
          !!document.querySelector("input[name='ImageButton1']") &&
          body.includes("?") &&
          (body.includes("DIGITO") ||
            body.includes("CAPITAL") ||
            body.includes("CUANTO") ||
            body.includes("NOMBRE") ||
            body.includes("LETRAS"));
        return tieneFormNuevo;
      },
      { timeout: timeoutMs },
      PALABRAS_RESULTADO,
    );
    console.log("✅ UpdatePanel respondió");
  } catch (_) {
    console.log("⚠️ Timeout esperando UpdatePanel");
  }
}

// ─── Controlador principal ───────────────────────────────────────────────────

exports.consultarProcuraduria = async (req, res) => {
  const {
    cedula,
    tipoDocumento = "CC",
    tipoCertificado = "1",
    nombre = "", // primer nombre (necesario si captcha lo pide)
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

    // ── 1. Navegar al portal público ──────────────────────────────────────
    console.log("📄 Navegando al portal público...");
    await page.goto(PORTAL_URL, { waitUntil: "networkidle2", timeout: 45000 });
    console.log("✅ URL portal:", page.url());
    await sleep(2000);

    // ── 2. Detectar iframe y obtener frame de trabajo ─────────────────────
    const iframeSrcs = await page.evaluate(() =>
      [...document.querySelectorAll("iframe")].map((f) => f.src),
    );
    console.log("🖼️ Iframes:", iframeSrcs);

    let workingFrame = page.mainFrame();

    // Buscar iframe que apunte al formulario técnico
    const iframeFormSrc = iframeSrcs.find(
      (src) =>
        src.includes("apps.procuraduria.gov.co") &&
        (src.includes("Certificado") || src.includes("inicio")),
    );

    if (iframeFormSrc) {
      console.log("🖼️ Formulario en iframe:", iframeFormSrc);
      try {
        // Esperar a que Puppeteer registre el frame
        await page.waitForFunction(
          (url) =>
            [...document.querySelectorAll("iframe")].some((f) =>
              f.src.includes(url),
            ),
          { timeout: 10000 },
          "apps.procuraduria.gov.co",
        );

        // Buscar en page.frames() — puede tener URL diferente a iframeSrc (redirect)
        for (const f of page.frames()) {
          if (f.url().includes("apps.procuraduria.gov.co")) {
            workingFrame = f;
            console.log("✅ Frame activo:", f.url());
            break;
          }
        }

        // Si no lo encontramos en frames(), usar contentFrame del elemento
        if (workingFrame === page.mainFrame()) {
          const handle =
            (await page.$("iframe[src*='Certificado']")) ||
            (await page.$("iframe[src*='apps.procuraduria']"));
          if (handle) {
            const cf = await handle.contentFrame();
            if (cf) {
              workingFrame = cf;
              console.log("✅ Frame activo (contentFrame):", cf.url());
            }
          }
        }
      } catch (e) {
        console.log("⚠️ Error obteniendo frame:", e.message);
      }
    }

    // Si seguimos en mainFrame y no es el formulario, ir directo
    if (
      workingFrame === page.mainFrame() &&
      !page.url().includes("Certificado.aspx")
    ) {
      console.log("⚠️ Sin iframe útil — navegando directo al formulario...");
      await page.goto(FORM_URL, { waitUntil: "networkidle2", timeout: 45000 });
      await sleep(1500);
      workingFrame = page.mainFrame();
      console.log("✅ URL formulario:", page.url());
    }

    // ── 3. Verificar que el formulario esté listo ─────────────────────────
    try {
      await workingFrame.waitForSelector("select[name='ddlTipoID']", {
        timeout: 10000,
      });
    } catch (_) {
      throw new Error(
        "No se encontró el selector 'ddlTipoID' en el frame. El formulario no cargó.",
      );
    }

    // Diagnóstico de inputs
    const inputsLog = await workingFrame.evaluate(() =>
      [...document.querySelectorAll("input,select")]
        .map((el) => `${el.tagName}[name=${el.name} type=${el.type}]`)
        .join(" | "),
    );
    console.log("📋 Inputs:", inputsLog.substring(0, 800));

    // Verificar campos hidden ASP.NET (diagnóstico, no bloquea)
    await verificarHiddenFields(workingFrame);

    // ── 4. Seleccionar tipo de documento → dispara postback ASP.NET ───────
    console.log("🔽 Seleccionando tipo documento:", ddlTipoID);
    await workingFrame.select("select[name='ddlTipoID']", ddlTipoID);

    // Esperar a que el postback regenere el captcha
    try {
      await workingFrame.waitForFunction(
        () => !!document.querySelector("input[name='txtRespuestaPregunta']"),
        { timeout: 8000 },
      );
    } catch (_) {
      console.log("⚠️ txtRespuestaPregunta no apareció tras postback");
    }
    await sleep(1500); // margen para que el label del captcha se renderice

    // ── 5. Leer y resolver captcha ────────────────────────────────────────
    const captchaInfo = await extraerCaptcha(workingFrame);
    console.log(
      "🔢 Captcha DOM:",
      captchaInfo.texto || "(vacío)",
      "| vía:",
      captchaInfo.via,
    );
    if (captchaInfo.htmlDebug) {
      console.log("🔍 HTML debug:", captchaInfo.htmlDebug.substring(0, 1000));
    }

    // Fallback: buscar en innerText completo
    let textoCaptcha = captchaInfo.texto;
    if (!textoCaptcha) {
      const innerText = await workingFrame.evaluate(
        () => document.body.innerText,
      );
      const lineas = innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) =>
            l.includes("?") &&
            l.length > 4 &&
            l.length < 400 &&
            /[Cc]uanto|[Cc]apital|[Cc]olor|[Dd]ias|[Mm]eses|[Ll]etras|[Nn]ombre|[Dd][ií]gito|\d+\s*[\+\-\*xX]/i.test(
              l,
            ),
        );
      console.log("🔎 Candidatos en innerText:", lineas);
      if (lineas.length > 0) textoCaptcha = lineas[0];
    }

    console.log("🔢 Captcha:", textoCaptcha || "(no detectado)");
    let respuestaCaptcha = resolverCaptcha(textoCaptcha, nombre, cedula);
    console.log("🔢 Respuesta:", respuestaCaptcha);

    // Captcha requiere nombre → abortar con instrucción al llamante
    if (respuestaCaptcha === "__NOMBRE_REQUERIDO__") {
      await browser.close();
      return res.status(422).json({
        error: "Captcha de nombre requerido",
        detalle:
          "El formulario pide las 2 primeras letras del primer nombre. Incluya 'nombre' en el body.",
        captchaPregunta: textoCaptcha,
      });
    }

    // Captcha requiere cédula (no debería ocurrir, ya viene en el body)
    if (respuestaCaptcha === "__CEDULA_REQUERIDA__") {
      await browser.close();
      return res.status(422).json({
        error: "Captcha de dígitos requerido pero cédula vacía",
        detalle:
          "El formulario pide los últimos dígitos del documento. Incluya 'cedula' en el body.",
        captchaPregunta: textoCaptcha,
      });
    }

    // Fallback si no se pudo resolver
    if (!respuestaCaptcha) {
      console.log("⚠️ Captcha irreconocible — usando fallback '8'");
      respuestaCaptcha = "8";
    }

    // ── 6. Número de documento ────────────────────────────────────────────
    console.log("✏️ Ingresando cédula:", cedula);
    await workingFrame.click("input[name='txtNumID']", { clickCount: 3 });
    await workingFrame.type("input[name='txtNumID']", String(cedula));

    // ── 7. Tipo de certificado ────────────────────────────────────────────
    try {
      await workingFrame.click(
        `input[name='rblTipoCert'][value='${tipoCertificado}']`,
      );
      await sleep(300);
    } catch (_) {
      console.log("ℹ️ rblTipoCert no encontrado o ya seleccionado");
    }

    // ── 8. Ingresar captcha ───────────────────────────────────────────────
    await workingFrame.click("input[name='txtRespuestaPregunta']", {
      clickCount: 3,
    });
    await workingFrame.type(
      "input[name='txtRespuestaPregunta']",
      respuestaCaptcha,
    );
    console.log("✅ Captcha ingresado:", respuestaCaptcha);

    // ── 9. Submit ─────────────────────────────────────────────────────────
    console.log("🚀 Enviando formulario...");
    await workingFrame.click("input[name='ImageButton1']");

    // Esperar respuesta del UpdatePanel (o navegación completa)
    await Promise.race([
      esperarResultadoUpdatePanel(workingFrame, 30000),
      page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
        .catch(() => {}),
    ]);
    await sleep(1500);

    const urlFinal = page.url();
    const textoPagina = await workingFrame
      .evaluate(() => document.body.innerText.toUpperCase())
      .catch(async () => {
        // El frame puede haber cambiado si hubo navegación
        return page.evaluate(() => document.body.innerText.toUpperCase());
      });

    console.log("📍 URL final:", urlFinal);
    console.log("📝 Resultado (800):", textoPagina.substring(0, 800));

    // ── 10. ¿Volvió al formulario sin resultado? ──────────────────────────
    const tieneResultado = PALABRAS_RESULTADO.some((p) =>
      textoPagina.includes(p),
    );

    if (!tieneResultado) {
      // Leer nuevo captcha para diagnóstico
      const captchaNuevo = await extraerCaptcha(workingFrame).catch(() => ({
        texto: "(error leyendo captcha)",
        via: "catch",
      }));
      await browser.close();
      return res.status(422).json({
        error: "Formulario rechazado",
        detalle:
          "El servidor devolvió el formulario. Posibles causas: captcha incorrecto, sesión vencida o documento no encontrado.",
        captchaUsado: {
          pregunta: textoCaptcha,
          respuesta: respuestaCaptcha,
        },
        captchaNuevo: captchaNuevo.texto || "(no detectado)",
        urlFinal,
        fragmentoRespuesta: textoPagina.substring(0, 400),
      });
    }

    // ── 11. Interpretar resultado ─────────────────────────────────────────
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
