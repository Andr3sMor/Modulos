/**
 * procuraduria.controller.js
 *
 * Flujo real del formulario:
 *   URL pública:  https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx
 *   URL técnica:  https://apps.procuraduria.gov.co/webcert/Certificado.aspx
 *   PDF:          https://apps.procuraduria.gov.co/webcert/verpdf.aspx  (POST con VIEWSTATE)
 *
 * Flujo ASP.NET:
 *  1. Submit con btnExportar → UpdatePanel responde con pageRedirect a verpdf.aspx
 *  2. El iframe navega a verpdf.aspx → devuelve HTML con btnDescargar
 *  3. Click en btnDescargar → POST a verpdf.aspx → devuelve el PDF binario
 *
 * TIPOS DE CAPTCHA SOPORTADOS:
 *  1. Matemático:        "¿ CUANTO ES 5 + 3 ?"
 *  2. Geográfico:        "¿ CAPITAL DE COLOMBIA ?"
 *  3. Nombre:            "¿ ESCRIBA LAS DOS PRIMERAS LETRAS DEL PRIMER NOMBRE?"
 *  4. Últimos dígitos:   "¿ ESCRIBA LOS DOS ULTIMOS DIGITOS DEL DOCUMENTO?"
 */

const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const https = require("https");
const qs = require("querystring");

const PORTAL_URL =
  "https://www.procuraduria.gov.co/Pages/Generacion-de-antecedentes.aspx";
const FORM_URL = "https://apps.procuraduria.gov.co/webcert/Certificado.aspx";
const VERPDF_URL = "https://apps.procuraduria.gov.co/webcert/verpdf.aspx";

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
    .replace(/(.)\1+/g, "$1")
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

  console.log("⏳ Esperando respuesta AJAX del servidor...");
  await Promise.race([ajaxResolvedPromise, sleep(35000)]);
  console.log(`✅ Respuesta AJAX recibida (${Date.now() - inicio}ms)`);

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

  console.log(`✅ Spinner desapareció (${Date.now() - inicio}ms total)`);
  await sleep(800);
}

// ─── POST a verpdf.aspx para obtener el PDF binario ──────────────────────────
// El flujo real es:
//  1. pageRedirect navega el iframe a verpdf.aspx → GET → devuelve HTML con btnDescargar
//  2. Click en btnDescargar → POST a verpdf.aspx con __VIEWSTATE de esa página → PDF binario
//
// Aquí replicamos ambos pasos con http nativo usando las cookies de sesión de Puppeteer.

async function obtenerPDFConPost(cookieStr, previousPage) {
  // ── Paso 1: GET a verpdf.aspx para obtener el HTML con __VIEWSTATE ──────
  console.log(
    "📄 GET a verpdf.aspx para obtener VIEWSTATE de la página de descarga...",
  );

  const htmlVerpdf = await new Promise((resolve, reject) => {
    const options = {
      hostname: "apps.procuraduria.gov.co",
      path: "/webcert/verpdf.aspx",
      method: "GET",
      headers: {
        Cookie: cookieStr,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "es-CO,es;q=0.9",
        Referer: "https://apps.procuraduria.gov.co/webcert/Certificado.aspx",
      },
      rejectUnauthorized: false,
    };

    // Seguir redirects manualmente
    const doRequest = (opts, depth = 0) => {
      if (depth > 5) return reject(new Error("Demasiados redirects"));
      const req = https.request(opts, (res) => {
        // Redirect 302
        if (
          (res.statusCode === 301 || res.statusCode === 302) &&
          res.headers.location
        ) {
          const loc = res.headers.location;
          console.log(`↪️ Redirect (${res.statusCode}) → ${loc}`);
          // Actualizar cookies si vienen en Set-Cookie
          const newCookies = res.headers["set-cookie"];
          if (newCookies) {
            const extra = newCookies.map((c) => c.split(";")[0]).join("; ");
            opts.headers["Cookie"] = cookieStr + "; " + extra;
          }
          const newPath = loc.startsWith("http")
            ? new URL(loc).pathname + (new URL(loc).search || "")
            : loc;
          doRequest({ ...opts, path: newPath }, depth + 1);
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    };
    doRequest(options);
  });

  console.log("📄 HTML verpdf.aspx obtenido, longitud:", htmlVerpdf.length);

  // Verificar si ya es un PDF (poco probable pero posible)
  if (htmlVerpdf.startsWith("%PDF")) {
    console.log("✅ verpdf.aspx devolvió PDF directamente en GET");
    return Buffer.from(htmlVerpdf, "binary");
  }

  // ── Paso 2: extraer campos hidden del HTML ───────────────────────────────
  const extractHidden = (name) => {
    const re = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i");
    const m =
      htmlVerpdf.match(re) ||
      htmlVerpdf.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`, "i"));
    return m ? m[1] : "";
  };

  const viewstate = extractHidden("__VIEWSTATE");
  const viewstateGenerator = extractHidden("__VIEWSTATEGENERATOR");
  const eventValidation = extractHidden("__EVENTVALIDATION");
  const prevPage = extractHidden("__PREVIOUSPAGE") || previousPage || "";

  console.log(
    "🔒 VIEWSTATE len:",
    viewstate.length,
    "| EVENTVALIDATION len:",
    eventValidation.length,
  );

  if (!viewstate) {
    console.log("⚠️ No se encontró __VIEWSTATE en verpdf.aspx");
    console.log("🔍 HTML inicio:", htmlVerpdf.substring(0, 500));
    return null;
  }

  // ── Paso 3: POST a verpdf.aspx simulando click en btnDescargar ──────────
  // Según network capture: btnDescargar.x=215, btnDescargar.y=40
  const postData = qs.stringify({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: viewstate,
    __VIEWSTATEGENERATOR: viewstateGenerator,
    __PREVIOUSPAGE: prevPage,
    __EVENTVALIDATION: eventValidation,
    "btnDescargar.x": "215",
    "btnDescargar.y": "40",
  });

  console.log(
    "📤 POST a verpdf.aspx (btnDescargar), payload size:",
    postData.length,
  );

  const pdfBuffer = await new Promise((resolve, reject) => {
    const options = {
      hostname: "apps.procuraduria.gov.co",
      path: "/webcert/verpdf.aspx",
      method: "POST",
      headers: {
        Cookie: cookieStr,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/pdf,*/*",
        "Accept-Language": "es-CO,es;q=0.9",
        Referer: "https://apps.procuraduria.gov.co/webcert/verpdf.aspx",
        Origin: "https://apps.procuraduria.gov.co",
      },
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      console.log(
        `📥 POST verpdf.aspx → ${res.statusCode} content-type: ${res.headers["content-type"]}`,
      );
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });

  return pdfBuffer;
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
    }

    // ── 3. Esperar formulario listo ───────────────────────────────────────
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
      if (lineas.length > 0) textoCaptcha = lineas[0];
    }

    console.log("🔢 Captcha:", textoCaptcha || "(no detectado)");
    let respuestaCaptcha = resolverCaptcha(textoCaptcha, nombre, cedula);
    console.log("🔢 Respuesta:", respuestaCaptcha);

    if (respuestaCaptcha === "__NOMBRE_REQUERIDO__") {
      await browser.close();
      return res.status(422).json({
        error: "Captcha de nombre requerido",
        detalle: "Incluya 'nombre' en el body.",
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

    // ── 7. Submit ─────────────────────────────────────────────────────────
    console.log("🚀 Enviando formulario...");

    let ajaxBody = "";
    let ajaxResolve;
    const ajaxResolvedPromise = new Promise((r) => {
      ajaxResolve = r;
    });

    page.on("response", (response) => {
      const url = response.url();
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
    });

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

    await esperarResultadoUpdatePanel(page, workingFrame, ajaxResolvedPromise);

    // ── 8. Leer texto de resultado ────────────────────────────────────────
    const frameResultado = obtenerFrameActivo(page);
    const textoPagina = await frameResultado
      .evaluate(() => document.body.innerText.toUpperCase())
      .catch(() => "");

    const urlFinal = page.url();
    console.log("📍 URL final:", urlFinal);
    console.log("📝 Texto (400):", textoPagina.substring(0, 400));

    // Verificar que fue exitoso
    const esExitoso =
      textoPagina.includes("DESCARGUE SU CERTIFICADO") ||
      textoPagina.includes("NO REGISTRA") ||
      textoPagina.includes("SANCIONADO") ||
      textoPagina.includes("INHABILIT") ||
      textoPagina.includes("NO PRESENTA") ||
      textoPagina.includes("SIN ANTECEDENTES");

    if (!esExitoso) {
      const captchaNuevo = await extraerCaptcha(frameResultado).catch(() => ({
        texto: "(error)",
      }));
      await browser.close();
      return res.status(422).json({
        error: "Formulario rechazado",
        detalle: "Captcha incorrecto o sesión vencida.",
        captchaUsado: { pregunta: textoCaptcha, respuesta: respuestaCaptcha },
        captchaNuevo: captchaNuevo.texto || "(no detectado)",
        urlFinal,
      });
    }

    // ── 9. Obtener cookies de sesión y descargar PDF con POST ─────────────
    console.log("📄 Iniciando descarga del PDF...");
    const cookies = await page.cookies("https://apps.procuraduria.gov.co");
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    console.log("🍪 Cookies:", cookies.map((c) => c.name).join(", "));

    // Extraer __PREVIOUSPAGE del ajaxBody si viene (a veces está en la respuesta Delta)
    const prevPageMatch = ajaxBody.match(/__PREVIOUSPAGE[^|]*\|([^|]+)/);
    const previousPage = prevPageMatch ? prevPageMatch[1] : "";

    await browser.close(); // cerrar browser antes del POST (ya no lo necesitamos)
    browser = null;

    const pdfBuffer = await obtenerPDFConPost(cookieStr, previousPage).catch(
      (e) => {
        console.log("❌ Error obteniendo PDF:", e.message);
        return null;
      },
    );

    // ── 10. Validar y construir respuesta ─────────────────────────────────
    let pdfBase64 = null;
    let pdfUrl = "";

    if (pdfBuffer && pdfBuffer.length > 100) {
      const header = pdfBuffer.slice(0, 4).toString("ascii");
      if (header === "%PDF") {
        pdfBase64 = pdfBuffer.toString("base64");
        pdfUrl = VERPDF_URL;
        console.log("✅ PDF válido:", pdfBuffer.length, "bytes");
      } else {
        console.log("⚠️ Respuesta no es PDF (header:", header, ")");
        console.log("🔍 Contenido:", pdfBuffer.slice(0, 300).toString("utf8"));
      }
    }

    const sinSanciones =
      textoPagina.includes("NO REGISTRA") ||
      textoPagina.includes("SIN ANTECEDENTES") ||
      textoPagina.includes("NO SE ENCONTRARON") ||
      textoPagina.includes("NO TIENE SANCIONES") ||
      textoPagina.includes("NO PRESENTA") ||
      textoPagina.includes("DESCARGUE SU CERTIFICADO");

    const conSanciones =
      textoPagina.includes("SANCIONADO") ||
      textoPagina.includes("INHABILIT") ||
      textoPagina.includes("SUSPENDIDO") ||
      textoPagina.includes("DESTITUIDO") ||
      textoPagina.includes("MULTA");

    return res.json({
      fuente: "Procuraduría General de la Nación",
      tieneSanciones: conSanciones,
      sinSanciones: sinSanciones && !conSanciones,
      documento: cedula,
      tipoDocumento,
      mensaje: conSanciones
        ? "La persona REGISTRA sanciones en la Procuraduría."
        : "La persona NO registra sanciones en la Procuraduría.",
      certificadoUrl: pdfUrl,
      pdfBase64,
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
