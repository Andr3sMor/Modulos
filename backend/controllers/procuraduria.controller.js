/**
 * procuraduria.controller.js
 *
 * Flujo real del formulario:
 *   URL pública:  https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx
 *   URL técnica:  https://apps.procuraduria.gov.co/webcert/Certificado.aspx
 *   PDF:          https://apps.procuraduria.gov.co/webcert/verpdf.aspx  (POST redirect)
 *
 * El formulario es ASP.NET WebForms con UpdatePanel (AJAX parcial).
 * El submit usa btnExportar con __ASYNCPOST=true.
 * La respuesta AJAX contiene "pageRedirect||%2fwebcert%2fverpdf.aspx" lo que
 * significa que ScriptManager ejecuta window.location = "/webcert/verpdf.aspx"
 * automáticamente — no hay botón de descarga que clickar, el iframe navega solo.
 *
 * TIPOS DE CAPTCHA SOPORTADOS:
 *  1. Matemático:        "¿ CUANTO ES 5 + 3 ?"
 *  2. Geográfico:        "¿ CAPITAL DE COLOMBIA ?"
 *  3. Nombre:            "¿ ESCRIBA LAS DOS PRIMERAS LETRAS DEL PRIMER NOMBRE?"
 *  4. Últimos dígitos:   "¿ ESCRIBA LOS DOS ULTIMOS DIGITOS DEL DOCUMENTO?"
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const PORTAL_URL =
  "https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx";
const FORM_URL = "https://apps.procuraduria.gov.co/webcert/Certificado.aspx";
const PDF_HOST = "apps.procuraduria.gov.co";
const PDF_PATH = "verpdf.aspx";

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

// ─── Normalización ────────────────────────────────────────────────────────────

function norm(t) {
  return t
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!()]/g, "")
    .replace(/(.)\1+/g, "$1") // colapsar letras repetidas: "Vallle" → "Valle"
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Diccionario geográfico / general ─────────────────────────────────────────

const RESPUESTAS_GEO = {
  "CAPITAL DE COLOMBIA": "BOGOTA",
  "CAPITAL COLOMBIA": "BOGOTA",
  "CUAL ES LA CAPITAL DE COLOMBIA": "BOGOTA",
  "CAPITAL DE CUNDINAMARCA": "BOGOTA",
  "CAPITAL CUNDINAMARCA": "BOGOTA",
  "CAPITAL DE ANTIOQUIA": "MEDELLIN",
  "CAPITAL ANTIOQUIA": "MEDELLIN",
  "CUAL ES LA CAPITAL DE ANTIOQUIA": "MEDELLIN",
  "CAPITAL DEL VALE DEL CAUCA": "CALI",
  "CAPITAL DEL VALLE DEL CAUCA": "CALI",
  "CAPITAL VALLE DEL CAUCA": "CALI",
  "CAPITAL VALE DEL CAUCA": "CALI",
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
  "CAPITAL DEL HUILA": "NEIVA",
  "CAPITAL HUILA": "NEIVA",
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
  "COLOR DEL CIELO": "AZUL",
  "COLOR CIELO": "AZUL",
  "COLOR DEL SOL": "AMARILLO",
  "COLOR SOL": "AMARILLO",
  "DIAS DE LA SEMANA": "7",
  "DIAS SEMANA": "7",
  "MESES DEL ANO": "12",
  "MESES ANO": "12",
};

// ─── Resolver captcha ─────────────────────────────────────────────────────────

function resolverCaptcha(textoCrudo, nombre = "", cedula = "") {
  if (!textoCrudo) return null;
  const texto = norm(textoCrudo);
  console.log("🔍 Captcha normalizado:", texto);

  // 1. Matemático
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
  const digitosRe = /ULTIMOS?\s*(\d+|DOS|TRES|CUATRO|CINCO|UN|UNO)\s*DIGITOS?/i;
  const digitosMatch = texto.match(digitosRe);
  if (
    digitosMatch ||
    texto.includes("ULTIMOS DIGITOS") ||
    texto.includes("ULTIMO DIGITO")
  ) {
    const MAP_N = { UN: 1, UNO: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5 };
    let n = 2;
    if (digitosMatch) {
      const raw = digitosMatch[1].toUpperCase();
      n = MAP_N[raw] !== undefined ? MAP_N[raw] : parseInt(raw) || 2;
    }
    if (cedula && String(cedula).length >= n) {
      const r = String(cedula).slice(-n);
      console.log(`✅ Captcha dígitos: últimos ${n} de "${cedula}" → "${r}"`);
      return r;
    }
    return "__CEDULA_REQUERIDA__";
  }

  // 3. Primeras letras del nombre
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

  // 4. Geográfico / diccionario
  for (const [clave, resp] of Object.entries(RESPUESTAS_GEO)) {
    if (texto.includes(clave)) {
      console.log(`✅ Geo: "${clave}" → "${resp}"`);
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

    const lbl = document.querySelector("label[for='txtRespuestaPregunta']");
    if (lbl) {
      const t = lbl.innerText.trim();
      if (esCaptchaValido(t)) return { texto: t, via: "label[for]" };
    }

    const prev = inp.previousElementSibling;
    if (prev && !IGNORAR.has(prev.tagName)) {
      const t = prev.innerText?.trim() || "";
      if (esCaptchaValido(t)) return { texto: t, via: "previousSibling" };
    }

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
      if (esCaptchaValido(t)) return { texto: t, via: "TreeWalker" };
    }

    let cont = inp.parentElement;
    for (let i = 0; i < 5 && cont; i++) cont = cont.parentElement;
    return {
      texto: "",
      via: "no encontrado",
      htmlDebug: cont ? cont.outerHTML.substring(0, 2000) : "N/A",
    };
  });
}

// ─── Obtener frame activo de apps.procuraduria ───────────────────────────────

function obtenerFrameActivo(page) {
  for (const f of page.frames()) {
    if (f.url().includes("apps.procuraduria.gov.co")) return f;
  }
  return page.mainFrame();
}

// ─── Esperar resultado del UpdatePanel ───────────────────────────────────────

async function esperarResultadoUpdatePanel(page, frame, ajaxResolvedPromise) {
  const inicio = Date.now();

  // Paso 1: esperar que llegue la respuesta AJAX de red
  console.log("⏳ Esperando respuesta AJAX del servidor...");
  await Promise.race([ajaxResolvedPromise, sleep(35000)]);
  console.log(`✅ Respuesta AJAX recibida (${Date.now() - inicio}ms)`);

  // Paso 2: esperar que aparezca el spinner (máx 5s, puede que ya pasó)
  console.log("⏳ Esperando fin del spinner en el DOM...");
  await frame
    .waitForFunction(
      () =>
        document.body.innerText
          .toUpperCase()
          .includes("CONSULTANDO POR FAVOR ESPERE"),
      { timeout: 5000 },
    )
    .catch(() =>
      console.log("ℹ️ Spinner no detectado (ya pasó o no apareció)"),
    );

  // Paso 3: esperar que desaparezca el spinner (máx 30s)
  await frame
    .waitForFunction(
      () =>
        !document.body.innerText
          .toUpperCase()
          .includes("CONSULTANDO POR FAVOR ESPERE"),
      { timeout: 30000 },
    )
    .catch(() =>
      console.log("⚠️ Timeout esperando que el spinner desaparezca"),
    );

  console.log(
    `✅ Spinner desapareció del DOM (${Date.now() - inicio}ms total)`,
  );
  await sleep(800);
}

// ─── Capturar PDF desde verpdf.aspx ──────────────────────────────────────────
// El ScriptManager de ASP.NET ejecuta un pageRedirect automático al iframe.
// La respuesta AJAX contiene: "pageRedirect||%2fwebcert%2fverpdf.aspx"
// Esto hace que el iframe navegue a verpdf.aspx via GET con las cookies de sesión.
// Puppeteer intercepta esa respuesta y extrae los bytes del PDF.

async function capturarPDF(page, ajaxBody) {
  // Extraer la URL de redirect del cuerpo AJAX
  // Formato: "pageRedirect||%2fwebcert%2fverpdf.aspx"
  const redirectMatch = ajaxBody.match(/pageRedirect\|\|([^|]+)/);
  let pdfRelUrl = redirectMatch
    ? decodeURIComponent(redirectMatch[1].trim())
    : "/webcert/verpdf.aspx";

  const pdfAbsUrl = `https://${PDF_HOST}${pdfRelUrl}`;
  console.log("📄 URL del PDF detectada:", pdfAbsUrl);

  // Estrategia 1: interceptar la respuesta de verpdf.aspx que ya puede estar
  // siendo navegada por el iframe tras el redirect automático de ASP.NET
  const pdfPromise = new Promise((resolve, reject) => {
    const tid = setTimeout(
      () => reject(new Error("Timeout capturando PDF")),
      15000,
    );
    const handler = async (resp) => {
      if (resp.url().includes(PDF_PATH)) {
        clearTimeout(tid);
        page.off("response", handler);
        const ct = resp.headers()["content-type"] || "";
        console.log(
          `📥 Respuesta verpdf.aspx (${resp.status()}) content-type: ${ct}`,
        );
        const buf = await resp.buffer().catch(() => null);
        resolve({ url: resp.url(), buffer: buf, contentType: ct });
      }
    };
    page.on("response", handler);
  });

  // Si el redirect automático ya navegó el iframe, la promesa se resuelve sola.
  // Si no, hacer GET explícito al PDF usando las cookies de sesión actuales.
  const result = await pdfPromise.catch(async (e) => {
    console.log("⚠️ Redirect automático no interceptado:", e.message);
    console.log("🔄 Intentando GET explícito a verpdf.aspx...");

    // Obtener cookies de sesión actuales
    const cookies = await page.cookies();
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    try {
      const https = require("https");
      const buf = await new Promise((resolve, reject) => {
        const options = {
          hostname: PDF_HOST,
          path: pdfRelUrl,
          method: "GET",
          headers: {
            Cookie: cookieStr,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
            Accept: "application/pdf,*/*",
            "Accept-Language": "es-CO,es;q=0.9",
            Referer: `https://${PDF_HOST}/webcert/Certificado.aspx`,
          },
          rejectUnauthorized: false,
        };
        const req = https.request(options, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      });
      console.log("✅ PDF obtenido vía GET explícito:", buf.length, "bytes");
      return { url: pdfAbsUrl, buffer: buf, contentType: "application/pdf" };
    } catch (err) {
      console.log("❌ GET explícito falló:", err.message);
      return null;
    }
  });

  if (!result?.buffer || result.buffer.length < 100) {
    console.log("⚠️ Buffer del PDF vacío o muy pequeño");
    return { pdfBase64: null, pdfUrl: "" };
  }

  // Verificar que realmente sea un PDF (empieza con %PDF)
  const header = result.buffer.slice(0, 4).toString("ascii");
  if (header !== "%PDF") {
    console.log("⚠️ El archivo no parece un PDF (header:", header, ")");
    // Puede ser HTML de error — loguear inicio para diagnóstico
    console.log(
      "🔍 Inicio del buffer:",
      result.buffer.slice(0, 200).toString("utf8"),
    );
    return { pdfBase64: null, pdfUrl: result.url };
  }

  console.log("✅ PDF válido capturado:", result.buffer.length, "bytes");
  return {
    pdfBase64: result.buffer.toString("base64"),
    pdfUrl: result.url,
  };
}

// ─── Controlador principal ───────────────────────────────────────────────────

exports.consultarProcuraduria = async (req, res) => {
  const {
    cedula,
    tipoDocumento = "CC",
    tipoCertificado = "1",
    nombre = "",
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
    const iframeFormSrc = iframeSrcs.find((src) =>
      src.includes("apps.procuraduria.gov.co"),
    );

    if (iframeFormSrc) {
      console.log("🖼️ Formulario en iframe:", iframeFormSrc);
      try {
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("iframe")].some((f) =>
              f.src.includes("apps.procuraduria.gov.co"),
            ),
          { timeout: 10000 },
        );
        workingFrame = obtenerFrameActivo(page);
        if (workingFrame !== page.mainFrame()) {
          console.log("✅ Frame activo:", workingFrame.url());
        } else {
          const handle = await page.$("iframe[src*='apps.procuraduria']");
          if (handle) {
            const cf = await handle.contentFrame();
            if (cf) {
              workingFrame = cf;
              console.log("✅ Frame (contentFrame):", cf.url());
            }
          }
        }
      } catch (e) {
        console.log("⚠️ Error obteniendo frame:", e.message);
      }
    }

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

    // ── 3. Esperar que el formulario esté listo ───────────────────────────
    try {
      await workingFrame.waitForSelector("select[name='ddlTipoID']", {
        timeout: 10000,
      });
    } catch (_) {
      throw new Error("No se encontró 'ddlTipoID'. El formulario no cargó.");
    }

    const inputsLog = await workingFrame.evaluate(() =>
      [...document.querySelectorAll("input,select")]
        .map((el) => `${el.tagName}[name=${el.name}]`)
        .join(" | "),
    );
    console.log("📋 Inputs:", inputsLog.substring(0, 600));

    // ── 4. Seleccionar tipo de documento ─────────────────────────────────
    console.log("🔽 Seleccionando tipo documento:", ddlTipoID);
    await workingFrame.select("select[name='ddlTipoID']", ddlTipoID);
    try {
      await workingFrame.waitForFunction(
        () => !!document.querySelector("input[name='txtRespuestaPregunta']"),
        { timeout: 8000 },
      );
    } catch (_) {
      console.log("⚠️ txtRespuestaPregunta no apareció");
    }
    await sleep(1200);

    // ── 5. Leer y resolver captcha ────────────────────────────────────────
    const captchaInfo = await extraerCaptcha(workingFrame);
    console.log(
      "🔢 Captcha DOM:",
      captchaInfo.texto || "(vacío)",
      "| vía:",
      captchaInfo.via,
    );
    if (captchaInfo.htmlDebug)
      console.log("🔍 HTML debug:", captchaInfo.htmlDebug.substring(0, 800));

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

    if (respuestaCaptcha === "__NOMBRE_REQUERIDO__") {
      await browser.close();
      return res.status(422).json({
        error: "Captcha de nombre requerido",
        detalle:
          "El formulario pide las 2 primeras letras del nombre. Incluya 'nombre' en el body.",
        captchaPregunta: textoCaptcha,
      });
    }
    if (respuestaCaptcha === "__CEDULA_REQUERIDA__") {
      await browser.close();
      return res.status(422).json({
        error: "Captcha de dígitos requerido pero cédula vacía",
        captchaPregunta: textoCaptcha,
      });
    }
    if (!respuestaCaptcha) {
      console.log("⚠️ Captcha irreconocible — fallback '8'");
      respuestaCaptcha = "8";
    }

    // ── 6. Rellenar formulario ────────────────────────────────────────────
    console.log("✏️ Ingresando cédula:", cedula);
    await workingFrame.click("input[name='txtNumID']", { clickCount: 3 });
    await workingFrame.type("input[name='txtNumID']", String(cedula));

    try {
      await workingFrame.click(
        `input[name='rblTipoCert'][value='${tipoCertificado}']`,
      );
      await sleep(300);
    } catch (_) {
      console.log("ℹ️ rblTipoCert no encontrado");
    }

    await workingFrame.click("input[name='txtRespuestaPregunta']", {
      clickCount: 3,
    });
    await workingFrame.type(
      "input[name='txtRespuestaPregunta']",
      respuestaCaptcha,
    );
    console.log("✅ Captcha ingresado:", respuestaCaptcha);

    // ── 7. Submit y captura simultánea del PDF ────────────────────────────
    // IMPORTANTE: registrar el listener del PDF ANTES del click para no perder
    // la respuesta de verpdf.aspx que llega automáticamente tras el pageRedirect.
    console.log("🚀 Enviando formulario (UpdatePanel / btnExportar)...");

    let ajaxBody = "";
    let ajaxResolve;
    const ajaxResolvedPromise = new Promise((res) => {
      ajaxResolve = res;
    });

    // Promise que se resuelve cuando recibimos la respuesta de verpdf.aspx
    let pdfResolve, pdfReject;
    const pdfInterceptPromise = new Promise((res, rej) => {
      pdfResolve = res;
      pdfReject = rej;
    });
    const pdfTid = setTimeout(
      () => pdfReject(new Error("Timeout verpdf")),
      40000,
    );

    const responseHandler = async (response) => {
      const url = response.url();

      // Respuesta del submit del formulario
      if (
        url.includes("Certificado.aspx") &&
        response.request().method() === "POST"
      ) {
        response
          .text()
          .then((t) => {
            ajaxBody = t;
            console.log(
              `📥 AJAX Certificado (${response.status()}):`,
              t.substring(0, 150),
            );
            ajaxResolve(t);
          })
          .catch(() => ajaxResolve(""));
      }

      // Respuesta del PDF (puede llegar automáticamente por el pageRedirect)
      if (url.includes(PDF_PATH)) {
        clearTimeout(pdfTid);
        page.off("response", responseHandler);
        const ct = response.headers()["content-type"] || "";
        const buf = await response.buffer().catch(() => null);
        console.log(
          `📥 PDF interceptado (${response.status()}) ct:${ct} bytes:${buf?.length}`,
        );
        pdfResolve({ url, buffer: buf, contentType: ct });
      }
    };
    page.on("response", responseHandler);

    // Click en btnExportar
    const btnClickado = await workingFrame.evaluate(() => {
      const btn =
        document.querySelector("input[name='btnExportar']") ||
        document.querySelector("input[name='ImageButton1']");
      if (btn) {
        btn.click();
        return btn.name;
      }
      return null;
    });
    console.log("🖱️ Botón clickado:", btnClickado);

    // Esperar ciclo completo del UpdatePanel
    await esperarResultadoUpdatePanel(page, workingFrame, ajaxResolvedPromise);

    const urlFinal = page.url();

    // ── 8. Obtener el PDF ─────────────────────────────────────────────────
    // Puede que ya lo interceptamos, o puede que necesitemos GET explícito
    console.log("📄 Procesando PDF...");
    let pdfResult = { pdfBase64: null, pdfUrl: "" };

    // Verificar si el pageRedirect ya disparó la respuesta
    const pdfIntercepted = await Promise.race([
      pdfInterceptPromise,
      sleep(2000).then(() => null), // si no llegó en 2s extra, usar fallback
    ]).catch(() => null);

    if (pdfIntercepted?.buffer) {
      const header = pdfIntercepted.buffer.slice(0, 4).toString("ascii");
      if (header === "%PDF") {
        console.log(
          "✅ PDF interceptado automáticamente:",
          pdfIntercepted.buffer.length,
          "bytes",
        );
        pdfResult = {
          pdfBase64: pdfIntercepted.buffer.toString("base64"),
          pdfUrl: pdfIntercepted.url,
        };
      } else {
        console.log("⚠️ Respuesta de verpdf no es PDF (header:", header, ")");
        console.log(
          "🔍 Inicio:",
          pdfIntercepted.buffer.slice(0, 200).toString("utf8"),
        );
      }
    }

    // Si no se interceptó automáticamente, usar GET explícito con cookies de sesión
    if (!pdfResult.pdfBase64) {
      console.log(
        "🔄 PDF no interceptado — GET explícito con cookies de sesión...",
      );
      pdfResult = await capturarPDF(page, ajaxBody);
    }

    page.off("response", responseHandler);

    // ── 9. Leer texto del resultado para interpretación ───────────────────
    const frameResultado = obtenerFrameActivo(page);
    const textoPagina = await frameResultado
      .evaluate(() => document.body.innerText.toUpperCase())
      .catch(() => "");

    console.log("📍 URL final:", urlFinal);
    console.log("📝 Texto (400):", textoPagina.substring(0, 400));

    // ── 10. Interpretar resultado ─────────────────────────────────────────
    const sinSanciones =
      textoPagina.includes("NO REGISTRA") ||
      textoPagina.includes("SIN ANTECEDENTES") ||
      textoPagina.includes("NO SE ENCONTRARON") ||
      textoPagina.includes("NO TIENE SANCIONES") ||
      textoPagina.includes("NO PRESENTA") ||
      textoPagina.includes("DESCARGUE SU CERTIFICADO"); // página de éxito sin sanciones

    const conSanciones =
      textoPagina.includes("SANCIONADO") ||
      textoPagina.includes("INHABILIT") ||
      textoPagina.includes("SUSPENDIDO") ||
      textoPagina.includes("DESTITUIDO") ||
      textoPagina.includes("MULTA");

    // Si no tenemos resultado en texto pero sí PDF, fue exitoso
    const exitoso = sinSanciones || conSanciones || !!pdfResult.pdfBase64;

    if (!exitoso) {
      const captchaNuevo = await extraerCaptcha(frameResultado).catch(() => ({
        texto: "(error)",
      }));
      await browser.close();
      return res.status(422).json({
        error: "Formulario rechazado",
        detalle: "No se obtuvo resultado. Captcha incorrecto o sesión vencida.",
        captchaUsado: { pregunta: textoCaptcha, respuesta: respuestaCaptcha },
        captchaNuevo: captchaNuevo.texto || "(no detectado)",
        urlFinal,
      });
    }

    await browser.close();
    return res.json({
      fuente: "Procuraduría General de la Nación",
      tieneSanciones: conSanciones,
      sinSanciones: sinSanciones && !conSanciones,
      documento: cedula,
      tipoDocumento,
      mensaje: conSanciones
        ? "La persona REGISTRA sanciones en la Procuraduría."
        : "La persona NO registra sanciones en la Procuraduría.",
      certificadoUrl: pdfResult.pdfUrl || "",
      // Guardar en cliente: Buffer.from(pdfBase64,"base64") → archivo .pdf
      pdfBase64: pdfResult.pdfBase64,
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
