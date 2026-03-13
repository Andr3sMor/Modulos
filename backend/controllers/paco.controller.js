"use strict";

/**
 * paco.controller.js
 *
 * Consulta la API de PACO (portal.paco.gov.co) — contratos SECOP II
 * por cédula o NIT.
 *
 * ⚠️  Solo responde desde IPs colombianas (geobloqueo).
 *
 * POST /api/consulta-paco
 * Body: {
 *   identificacion: string,   // cédula o NIT
 *   tipo?:          number,   // 1 = persona natural | 2 = jurídica  (default 1)
 *   start_year?:    number,   // default 2017
 *   end_year?:      number,   // default año actual
 *   limit?:         number,   // default 100
 *   sort?:          string,   // "value" | "date"  (default "value")
 *   order?:         string,   // "desc" | "asc"    (default "desc")
 * }
 */

const axios = require("axios");

const PACO_API =
  "https://paco-api-v2-prod.azure-api.net/paco-v2/secop/contract/contractors";
const PACO_PORTAL = "https://portal.paco.gov.co";

exports.consultarPACO = async (req, res) => {
  const {
    identificacion,
    tipo = 1,
    start_year = 2017,
    end_year = new Date().getFullYear(),
    limit = 100,
    sort = "value",
    order = "desc",
  } = req.body;

  if (!identificacion) {
    return res
      .status(400)
      .json({ error: "El campo 'identificacion' es requerido." });
  }

  const id = String(identificacion).trim();
  console.log(
    `[PACO] Consultando: ${id} | tipo=${tipo} | años ${start_year}-${end_year}`,
  );

  try {
    const response = await axios.get(`${PACO_API}/${id}`, {
      params: { start_year, end_year, limit, sort, order },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "es-CO,es;q=0.9",
        Referer: `${PACO_PORTAL}/index.php?pagina=contratista&identificacion=${id}&tipo=${tipo}`,
        Origin: PACO_PORTAL,
      },
      timeout: 20000,
    });

    const contratos = Array.isArray(response.data) ? response.data : [];

    const totalValor = contratos.reduce((sum, c) => sum + (c.value || 0), 0);

    const entidades = [
      ...new Map(contratos.map((c) => [c.entity_id, c.entity])).entries(),
    ]
      .map(([, nombre]) => nombre)
      .filter(Boolean);

    const departamentos = [
      ...new Set(contratos.map((c) => c.department).filter(Boolean)),
    ];

    const contratoPorAno = contratos.reduce((acc, c) => {
      const year = c.contract_start_date?.slice(0, 4);
      if (year) acc[year] = (acc[year] || 0) + 1;
      return acc;
    }, {});

    console.log(
      `[PACO] ✅ ${contratos.length} contratos | Total: $${totalValor.toLocaleString("es-CO")}`,
    );

    return res.json({
      fuente: "PACO – Portal Anticorrupción Colombia (SECOP II)",
      status: "success",
      identificacion: id,
      tipo,
      resumen: {
        totalContratos: contratos.length,
        totalValor,
        totalEntidades: entidades.length,
        departamentos,
        contratoPorAno,
      },
      entidades,
      contratos,
      portalUrl: `${PACO_PORTAL}/index.php?pagina=contratista&identificacion=${id}&tipo=${tipo}`,
    });
  } catch (error) {
    const esGeoblock =
      error.code === "ECONNRESET" ||
      error.code === "ECONNREFUSED" ||
      (error.message || "").includes("56");

    console.error(`[PACO] ❌ Error: ${error.message}`);

    if (esGeoblock) {
      return res.status(502).json({
        error: "La API de PACO bloqueó la conexión (geobloqueo).",
        detalle:
          "Esta API solo responde desde IPs colombianas. " +
          "El backend debe estar desplegado en Colombia.",
        code: error.code,
      });
    }

    return res.status(error.response?.status || 502).json({
      error: "Error al consultar PACO",
      detalle: error.message,
    });
  }
};
