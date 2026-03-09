/**
 * jcc.controller.js - CORREGIDO v3
 *
 * Problemas resueltos:
 * 1. JCC_WORKER_URL tenía "/" al final → doble barra en la URL (/apex → //apex)
 * 2. El Worker de Cloudflare reenviaba HTTP en vez de HTTPS al origen
 * 3. axios seguía redirecciones cambiando https:// por http://
 */

const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

// ✅ FIX 1: Limpiar slash final de la variable de entorno
const JCC_BASE = (
  process.env.JCC_WORKER_URL || "https://sgr.jcc.gov.co:8181"
).replace(/\/+$/, ""); // elimina cualquier "/" al final

const JCC_URL = `${JCC_BASE}/apex/f?p=138:1:::NO:::`;

console.log("🔧 JCC_BASE configurado como:", JCC_BASE);

// ✅ FIX 2: Función robusta para garantizar HTTPS y rutas correctas
function resolverUrl(url, base) {
  if (!url) return base;
  // Ruta relativa → agregar base sin slash doble
  if (url.startsWith("/")) return `${base}${url}`;
  // http:// → https://
  if (url.startsWith("http://")) return url.replace(/^http:\/\//, "https://");
  return url;
}

const HEADERS_BASE = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
};

// ✅ FIX 3: Instancia con maxRedirects:0 para controlar redirecciones manualmente
const axiosJCC = axios.create({
  httpsAgent,
  timeout: 30000,
  maxRedirects: 0,
  validateStatus: (s) => s < 600, // nunca lanzar excepción por status
});

// Seguir redirecciones manualmente forzando HTTPS en cada paso
async function getSeguro(url, extraHeaders = {}) {
  let currentUrl = resolverUrl(url, JCC_BASE);
  let cookies = "";
  let response;

  for (let i = 0; i < 6; i++) {
    console.log(`  → GET ${currentUrl}`);
    response = await axiosJCC.get(currentUrl, {
      headers: { ...HEADERS_BASE, ...extraHeaders, Cookie: cookies },
    });

    // Acumular cookies de cada respuesta
    const setCookie = response.headers["set-cookie"] || [];
    setCookie.forEach((c) => {
      const par = c.split(";")[0];
      cookies = cookies
        ? cookies.includes(par.split("=")[0])
          ? cookies
          : `${cookies}; ${par}`
        : par;
    });

    const { status } = response;
    if (status === 301 || status === 302 || status === 303) {
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
  console.log("URL base:", JCC_BASE);
  console.log("URL inicial:", JCC_URL);

  try {
    // ── Paso 1: GET formulario ──────────────────────────────────────────────
    const { response: r1, cookies, finalUrl } = await getSeguro(JCC_URL);

    console.log(
      `✅ GET completado — Status: ${r1.status} | URL final: ${finalUrl}`,
    );

    if (r1.status >= 400) {
      return res.status(502).json({
        error: "Error en consulta JCC",
        detalle: `No se pudo cargar el formulario JCC (HTTP ${r1.status}). URL: ${finalUrl}`,
      });
    }

    const html = r1.data.toString();

    // Extraer campos ocultos del formulario Oracle APEX
    const campos = {};
    (html.match(/<input[^>]+type=["']?hidden["']?[^>]*>/gi) || []).forEach(
      (tag) => {
        const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
        const value = tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
        if (name) campos[name] = value;
      },
    );

    console.log(
      "📋 Campos ocultos:",
      Object.keys(campos).join(", ") || "NINGUNO",
    );

    if (!campos["p_instance"]) {
      console.warn(
        "⚠️  p_instance no encontrado — el formulario puede haber cambiado",
      );
    }

    // Obtener la URL de acción del formulario
    const formAction = html.match(
      /action=["']([^"']*wwv_flow[^"']*)["']/i,
    )?.[1];
    const postUrl = resolverUrl(
      formAction || "/apex/wwv_flow.accept",
      JCC_BASE,
    );
    console.log("🎯 POST URL:", postUrl);

    // ── Paso 2: POST búsqueda ───────────────────────────────────────────────
    const postData = new URLSearchParams({
      ...campos,
      p_request: "CONSULTAR",
      p_reload_on_submit: "S",
      p_widget_name: "wwv_flow",
      p_widget_action: "DEFAULT",
      p_t01: cedula,
      p_t02: "CC",
    });

    console.log("🔍 Enviando POST...");
    const r2 = await axiosJCC.post(postUrl, postData.toString(), {
      headers: {
        ...HEADERS_BASE,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: finalUrl,
        Origin: JCC_BASE,
        Cookie: cookies,
      },
    });

    console.log("✅ Status POST:", r2.status);

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

    const texto = r2.data
      .toString()
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    console.log("📝 Texto resultado:", texto.substring(0, 600));

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
