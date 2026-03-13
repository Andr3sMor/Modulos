"use strict";

const axios = require("axios");

const BASE_URL =
  "https://sucursal-digital-ext.supersociedades.gov.co/micro-consulta-sociedades";
const TOKEN_URL = `${BASE_URL}/oauth/token`;
const RAZON_SOCIAL_URL = `${BASE_URL}/consultaGeneralSociedades/consultarSociedadPorRazonSocial`;
const DETALLE_NIT_URL = `${BASE_URL}/consultaGeneralSociedades/consultaDatosBasicosNit`;

const BASIC_AUTH =
  "ZnJvbnRDb25zdWx0YVNvY2llZGFkZXM6RnIwbnQuYzBuc3VsdDQuZzNuM3I0bC5zMGMxM2Q0ZDNz";

const HEADERS_COMUNES = {
  aplicacion: "consultaGeneralSociedades2.0",
  usuario: "frontConsultaSociedades",
  ipUsuario: "127.0.0.1",
};

// ─── Palabras clave para detectar insolvencia ─────────────────────────────────
const PALABRAS_LIQUIDACION = ["LIQUIDAC", "LIQUIDACIÓN"];
const PALABRAS_REORGANIZACION = [
  "REORGANIZAC",
  "REORGANIZACIÓN",
  "CONCORDATO",
  "ACUERDO DE REESTRUCTURAC",
  "NEAR",
  "NEGOCIACION DE EMERGENCIA",
];

function detectarInsolvencia(d) {
  const campos = [
    d.grupo_tramita || "",
    d.causal || "",
    d.estado || "",
    d.etapa_situacion || "",
    d.situacion || "",
  ].map((c) => c.toUpperCase());

  const textoCompleto = campos.join(" ");

  const enReorganizacion = PALABRAS_REORGANIZACION.some((p) =>
    textoCompleto.includes(p),
  );
  const enLiquidacion = PALABRAS_LIQUIDACION.some((p) =>
    textoCompleto.includes(p),
  );
  const activo = !["CANCELADA", "DISUELTO"].includes(
    (d.estado || "").toUpperCase(),
  );

  let tipoInsolvencia = null;
  if (enReorganizacion) tipoInsolvencia = "REORGANIZACIÓN";
  else if (enLiquidacion) tipoInsolvencia = "LIQUIDACIÓN";

  return {
    tieneProcesoInsolvencia: enReorganizacion || enLiquidacion,
    tipoInsolvencia,
    procesoActivo: (enReorganizacion || enLiquidacion) && activo,
    grupoProceso: d.grupo_tramita || null,
  };
}

function formatearFecha(timestamp) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString("es-CO");
}

// ─── Caché del token en memoria ───────────────────────────────────────────────
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

async function obtenerToken() {
  const ahora = Date.now();
  const margenSeguridad = 5 * 60 * 1000;

  if (
    tokenCache.accessToken &&
    ahora < tokenCache.expiresAt - margenSeguridad
  ) {
    return tokenCache.accessToken;
  }

  console.log("[Supersociedades] 🔑 Obteniendo nuevo token...");

  const response = await axios.post(
    TOKEN_URL,
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${BASIC_AUTH}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...HEADERS_COMUNES,
      },
    },
  );

  const { access_token, expires_in } = response.data;
  tokenCache = {
    accessToken: access_token,
    expiresAt: ahora + expires_in * 1000,
  };

  console.log(
    `[Supersociedades] ✅ Token obtenido, expira en ${expires_in / 60} min.`,
  );
  return access_token;
}

function limpiarTokenSiExpiro(status) {
  if (status === 401) {
    tokenCache = { accessToken: null, expiresAt: 0 };
    console.warn("[Supersociedades] ⚠️ Token rechazado, caché limpiado.");
  }
}

// ─── Buscar por razón social ──────────────────────────────────────────────────

exports.consultarSociedades = async (req, res) => {
  const { razonSocial, pagina = 1 } = req.body;

  if (!razonSocial || !razonSocial.trim()) {
    return res
      .status(400)
      .json({ error: "El campo 'razonSocial' es requerido." });
  }

  console.log(
    `[Supersociedades] 🔍 Buscando: "${razonSocial}" (página ${pagina})`,
  );

  try {
    const token = await obtenerToken();

    const response = await axios.post(
      `${RAZON_SOCIAL_URL}?pagina=${pagina}`,
      { razonSocial: razonSocial.trim() },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...HEADERS_COMUNES,
        },
        timeout: 15000,
      },
    );

    const obj = response.data?.objeto;
    if (!obj || !obj.Estado) {
      return res
        .status(502)
        .json({ error: "Respuesta inesperada de Supersociedades." });
    }

    const elementos = (obj.Elementos || []).map((e) => ({
      nit: e.NIT,
      razonSocial: e.RazonSocial,
      estado: e.Estado,
      etapa: e.Etapa,
      dependencia: e.NombreDependencia,
      fechaInicial: formatearFecha(e.FechaInicial),
    }));

    console.log(
      `[Supersociedades] ✅ ${elementos.length} resultado(s) para "${razonSocial}"`,
    );

    return res.json({
      fuente: "Superintendencia de Sociedades",
      status: "success",
      totalRegistros: obj.TotalRegistros,
      totalPaginas: obj.TotalPaginas,
      paginaActual: pagina,
      data: elementos,
    });
  } catch (error) {
    limpiarTokenSiExpiro(error.response?.status);
    console.error("[Supersociedades] ❌ Error búsqueda:", error.message);
    return res.status(502).json({
      error: "Error al consultar Supersociedades",
      detalle: error.message,
    });
  }
};

// ─── Consultar detalle por NIT ────────────────────────────────────────────────

exports.consultarDetallePorNit = async (req, res) => {
  const { nit } = req.body;

  if (!nit) {
    return res.status(400).json({ error: "El campo 'nit' es requerido." });
  }

  console.log(`[Supersociedades] 🔍 Detalle NIT: ${nit}`);

  try {
    const token = await obtenerToken();

    const response = await axios.post(`${DETALLE_NIT_URL}/${nit}`, null, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": "0",
        Accept: "application/json",
        ...HEADERS_COMUNES,
      },
      timeout: 15000,
    });

    const d = response.data?.objeto?.datosBasicos;
    if (!d) {
      return res
        .status(404)
        .json({ error: "No se encontró información para ese NIT." });
    }

    const insolvencia = detectarInsolvencia(d);

    console.log(
      `[Supersociedades] ✅ NIT ${nit} — insolvencia: ${insolvencia.tieneProcesoInsolvencia}`,
    );

    return res.json({
      fuente: "Superintendencia de Sociedades",
      status: "success",
      data: {
        nit: d.numero_documento,
        digitoVerificacion: d.dv,
        razonSocial: d.razon_social,
        sigla: d.sigla,
        tipoSocietario: d.tipo_societario,
        estado: d.estado,
        etapa: d.etapa_situacion,
        causal: d.causal,
        expediente: d.expediente,
        actividadEconomica: {
          cciiu: d.cciiu,
          descripcion: d.descripcion_cciiu,
        },
        direccion: {
          domicilio: d.direc_domicilio,
          ciudad: d.ciudad_domicilio,
          departamento: d.depto_domicilio,
        },
        contacto: {
          telefono1: d.telefono_1,
          telefono2: d.telefono_2,
          email: d.email,
          paginaWeb: d.pagina_web,
        },
        fechas: {
          constitucion: formatearFecha(d.fecha_constitucion),
          estado: formatearFecha(d.fecha_estado),
          vencimiento: formatearFecha(d.fecha_vencimiento),
        },
        insolvencia,
        grupoProceso: d.grupo_tramita,
        entidadIVC: d.entidad_ejerce_ivc,
        representanteLegal: d.representante_legal || null,
        tieneRevisorFiscal: d.tiene_revisor_fiscal === "S",
      },
    });
  } catch (error) {
    limpiarTokenSiExpiro(error.response?.status);
    console.error("[Supersociedades] ❌ Error detalle NIT:", error.message);
    return res.status(502).json({
      error: "Error al consultar detalle por NIT",
      detalle: error.message,
    });
  }
};
