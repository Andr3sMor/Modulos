/**
 * jcc.controller.js - CORREGIDO v4
 *
 * El formulario JCC usa Oracle APEX con endpoint AJAX moderno:
 * POST /apex/wwv_flow.ajax
 * con payload p_json que contiene los campos del formulario.
 *
 * Flujo:
 * 1. GET /apex/f?p=138:1:::NO::: → extraer p_instance y salt del HTML
 * 2. POST /apex/wwv_flow.ajax → con p_json construido correctamente
 */

const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// JCC_WORKER_URL debe ser la URL del Worker SIN slash final
const JCC_BASE = (
  process.env.JCC_WORKER_URL || "https://sgr.jcc.gov.co:8181"
).replace(/\/+$/, "");

console.log("🔧 JCC_BASE:", JCC_BASE);

function resolverUrl(url, base) {
  if (!url) return base;
  if (url.startsWith("/")) return `${base}${url}`;
  if (url.startsWith("http://")) return url.replace(/^http:\/\//, "https://");
  return url;
}

const HEADERS_BASE = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

const axiosJCC = axios.create({
  httpsAgent,
  timeout: 30000,
  maxRedirects: 0,
  validateStatus: (s) => s < 600,
});

async function getSeguro(url) {
  let currentUrl = resolverUrl(url, JCC_BASE);
  let cookies = "";
  let response;

  for (let i = 0; i < 6; i++) {
    console.log(`  → GET ${currentUrl}`);
    response = await axiosJCC.get(currentUrl, {
      headers: { ...HEADERS_BASE, Cookie: cookies },
    });

    const setCookie = response.headers["set-cookie"] || [];
    setCookie.forEach((c) => {
      const par = c.split(";")[0];
      const key = par.split("=")[0];
      if (!cookies.includes(key)) {
        cookies = cookies ? `${cookies}; ${par}` : par;
      }
    });

    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303
    ) {
      const location = response.headers["location"];
      if (!location) break;
      currentUrl = resolverUrl(location, JCC_BASE);
      continue;
    }
    break;
  }

  return { response, cookies, finalUrl: currentUrl };
}

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  if (!cedula)
    return res.status(400).json({ error: "El campo 'cedula' es requerido." });

  console.log(`\n=== Consulta JCC: ${cedula} ===`);

  try {
    // ── Paso 1: GET para obtener p_instance y salt ─────────────────────────
    const JCC_URL = `${JCC_BASE}/apex/f?p=138:1:::NO:::`;
    const { response: r1, cookies, finalUrl } = await getSeguro(JCC_URL);

    console.log(`✅ GET — Status: ${r1.status} | URL: ${finalUrl}`);

    if (r1.status >= 400) {
      return res.status(502).json({
        error: "Error en consulta JCC",
        detalle: `No se pudo cargar el formulario JCC (HTTP ${r1.status})`,
      });
    }

    const html = r1.data.toString();

    // Extraer p_instance
    const pInstance =
      html.match(/name="p_instance"\s+value="([^"]+)"/i)?.[1] ||
      html.match(/"p_instance"\s*:\s*"([^"]+)"/i)?.[1] ||
      html.match(/p_instance[=,:"'\s]+([0-9]+)/i)?.[1];

    // Extraer salt (p_page_submission_id) — aparece como dato en el HTML de APEX
    const salt =
      html.match(/\"salt\"\s*:\s*\"([^"]+)\"/i)?.[1] ||
      html.match(/apex\.server\.pluginUrl[^;]*salt[^"]*"([0-9]+)"/i)?.[1] ||
      html.match(/name="p_page_submission_id"\s+value="([^"]+)"/i)?.[1];

    // Extraer protected
    const protectedVal =
      html.match(/\"protected\"\s*:\s*\"([^"]+)\"/i)?.[1] || "";

    console.log("📋 p_instance:", pInstance || "NO ENCONTRADO");
    console.log("📋 salt:", salt || "NO ENCONTRADO");
    console.log("📋 protected:", protectedVal || "vacío");

    if (!pInstance) {
      return res.status(502).json({
        error: "Error en consulta JCC",
        detalle:
          "No se pudo extraer p_instance del formulario JCC. El sitio puede haber cambiado.",
      });
    }

    // Usar salt encontrado o generar uno numérico aleatorio de 42 dígitos
    const saltValue =
      salt ||
      Array.from({ length: 42 }, () => Math.floor(Math.random() * 10)).join("");

    // ── Paso 2: POST con payload APEX AJAX correcto ────────────────────────
    const pJson = JSON.stringify({
      salt: saltValue,
      pageItems: {
        itemsToSubmit: [
          { n: "P1_CRITERIO", v: "CC" },
          { n: "P1_TIPO_DE_TARJETA", v: "A" },
          { n: "P1_VALOR", v: cedula },
        ],
        protected: protectedVal,
        rowVersion: "",
      },
    });

    const postData = new URLSearchParams({
      p_json: pJson,
      p_flow_id: "138",
      p_flow_step_id: "1",
      p_instance: pInstance,
      p_page_submission_id: saltValue,
      p_request: "P1_CONSULTAR",
      p_reload_on_submit: "A",
    });

    const postUrl = `${JCC_BASE}/apex/wwv_flow.ajax`;
    console.log("🔍 POST →", postUrl);

    const r2 = await axiosJCC.post(postUrl, postData.toString(), {
      headers: {
        ...HEADERS_BASE,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Referer: finalUrl,
        Origin: JCC_BASE,
        Cookie: cookies,
      },
    });

    console.log("✅ POST Status:", r2.status);

    if (r2.status >= 400) {
      const detalle = r2.data
        ?.toString()
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 400);
      console.error("❌ POST fallido:", detalle);
      return res.status(502).json({
        error: "Error en consulta JCC",
        detalle: `Servidor respondió ${r2.status}: ${detalle}`,
      });
    }

    // La respuesta puede ser JSON (APEX AJAX) o HTML
    let texto = "";
    try {
      const json = typeof r2.data === "string" ? JSON.parse(r2.data) : r2.data;
      console.log("📦 Respuesta JSON:", JSON.stringify(json).substring(0, 600));
      texto = JSON.stringify(json).toUpperCase();
    } catch {
      texto = r2.data
        .toString()
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      console.log("📝 Respuesta texto:", texto.substring(0, 600));
    }

    const up = texto.toUpperCase();
    const esContador =
      up.includes("CONTADOR PÚBLICO") ||
      up.includes("CONTADOR PUBLICO") ||
      up.includes("HABILITADO") ||
      up.includes("TARJETA PROFESIONAL");
    const noEsContador =
      up.includes("NO REGISTRA") ||
      up.includes("NO SE ENCUENTRA") ||
      up.includes("NO EXISTE");

    return res.json({
      fuente: "Junta Central de Contadores",
      esContador,
      documento: cedula,
      mensaje: esContador
        ? "La persona ES Contador Público registrado."
        : noEsContador
          ? "La persona NO está registrada como Contador Público."
          : "Sin resultado claro.",
      detalle: texto.substring(0, 600),
    });
  } catch (error) {
    console.error("❌ ERROR JCC:", error.message);
    if (error.response) {
      console.error("  Status:", error.response.status);
      console.error(
        "  Body:",
        error.response.data
          ?.toString()
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .substring(0, 300),
      );
    }
    return res.status(502).json({
      error: "Error en consulta JCC",
      detalle: error.message,
    });
  }
};
