/**
 * rama_judicial.controller.js
 *
 * Adaptado del servicio NestJS ProcesosRamaJudicialService a Express puro.
 *
 * DOBLE VERIFICACIÓN:
 *  Paso 1 — Verificación estructural:
 *    El HTML tiene más de 4 filas <tr> y no contiene frases de "sin resultados".
 *
 *  Paso 2 — Verificación de identidad:
 *    Se parsean las filas de la tabla del HTML y se compara celda a celda
 *    contra los datos de la persona enviados en el body (nombres, apellidos, cedula).
 *    Solo se marca como alerta si al menos UNA fila coincide con la persona.
 *
 *    Reglas de coincidencia (todas normalizadas a mayúsculas sin tildes):
 *      - Si se envió 'cedula': alguna celda de la fila contiene exactamente ese número.
 *      - Si se envió 'nombres': alguna celda contiene al menos UNA de las palabras del nombre.
 *      - Si se envió 'apellidos': alguna celda contiene al menos UNA de las palabras del apellido.
 *    Para generar alerta se requiere que LA MISMA FILA satisfaga TODOS los criterios enviados.
 *
 * POST /api/consulta-rama-judicial
 * Body: {
 *   cedula?:    string,   // número de documento
 *   nombres?:   string,   // primer y/o segundo nombre
 *   apellidos?: string,   // primer y/o segundo apellido
 * }
 */

const puppeteer = require("puppeteer");

// ─── Lista de ciudades ─────────────────────────────────────────────────────────
const CITIES = [
  {
    valor: "ARMENIA-CALARCA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/armeniajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/armeniajepms/lista.asp",
  },
  {
    valor: "BARRANQUILLA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/barranquillajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/barranquillajepms/lista.asp",
  },
  {
    valor: "BOGOTA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/bogotajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/bogotajepms/lista.asp",
  },
  {
    valor: "BUCARAMANGA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/bucaramangajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/bucaramangajepms/lista.asp",
  },
  {
    valor: "BUGA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/bugajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/bugajepms/lista.asp",
  },
  {
    valor: "CALI",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/calijepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/calijepms/lista.asp",
  },
  {
    valor: "CARTAGENA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/cartagenajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/cartagenajepms/lista.asp",
  },
  {
    valor: "FLORENCIA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/florenciajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/florenciajepms/lista.asp",
  },
  {
    valor: "IBAGUE",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/ibaguejepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/ibaguejepms/lista.asp",
  },
  {
    valor: "LA DORADA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/ladoradajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/ladoradajepms/lista.asp",
  },
  {
    valor: "MANIZALES",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/manizalesjepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/manizalesjepms/lista.asp",
  },
  {
    valor: "MEDELLIN",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/medellinjepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/medellinjepms/lista.asp",
  },
  {
    valor: "MONTERIA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/monteriajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/monteriajepms/lista.asp",
  },
  {
    valor: "NEIVA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/neivajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/neivajepms/lista.asp",
  },
  {
    valor: "PALMIRA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/palmirajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/palmirajepms/lista.asp",
  },
  {
    valor: "PASTO",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/pastojepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/pastojepms/lista.asp",
  },
  {
    valor: "PEREIRA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/pereirajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/pereirajepms/lista.asp",
  },
  {
    valor: "POPAYAN",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/popayanjepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/popayanjepms/lista.asp",
  },
  {
    valor: "QUIBDO",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/quibdojepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/quibdojepms/lista.asp",
  },
  {
    valor: "SANTA MARTA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/santamartajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/santamartajepms/lista.asp",
  },
  {
    valor: "TUNJA",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/tunjajepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/tunjajepms/lista.asp",
  },
  {
    valor: "VALLEDUPAR",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/valleduparjepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/valleduparjepms/lista.asp",
  },
  {
    valor: "VILLAVICENCIO",
    referer:
      "https://procesos.ramajudicial.gov.co/jepms/villavicenciojepms/conectar.asp",
    url: "https://procesos.ramajudicial.gov.co/jepms/villavicenciojepms/lista.asp",
  },
];

// ─── Utilidades ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    protocolTimeout: 120000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=VizDisplayCompositor",
    ],
  });
}

/**
 * Normaliza un texto para comparación:
 * mayúsculas, sin tildes, sin caracteres especiales, espacios simples.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return (text || "")
    .toString()
    .toUpperCase()
    .normalize("NFD") // descomponer tildes
    .replace(/[\u0300-\u036f]/g, "") // eliminar diacríticos
    .replace(/[^A-Z0-9\s]/g, " ") // solo letras, números y espacios
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrae todas las palabras significativas (longitud >= 3) de un string.
 * @param {string} text
 * @returns {string[]}
 */
function words(text) {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length >= 3);
}

/**
 * Extrae las celdas <td> de cada fila <tr> del HTML.
 * Retorna un array de filas; cada fila es un array de strings (texto de cada celda).
 * No requiere cheerio: usa regex.
 *
 * @param {string} html
 * @returns {string[][]}
 */
function extractTableRows(html) {
  const rows = [];
  // Encontrar cada bloque <tr>...</tr>
  const trRegex = /<tr[\s>][\s\S]*?<\/tr>/gi;
  const trMatches = html.match(trRegex) || [];

  for (const tr of trMatches) {
    // Extraer texto de cada <td>
    const tdRegex = /<td[\s>][\s\S]*?<\/td>/gi;
    const tdMatches = tr.match(tdRegex) || [];
    const cells = tdMatches.map((td) =>
      // Quitar tags HTML y decodificar entidades básicas
      td
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim(),
    );
    // Solo incluir filas que tengan al menos una celda con contenido
    if (cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICACIÓN EN DOS PASOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PASO 1 — Verificación estructural.
 * Comprueba que la respuesta del servidor tiene filas de datos
 * y no contiene mensajes de "sin resultados".
 *
 * @param {string} html
 * @param {string[][]} rows  — filas ya extraídas
 * @returns {{ pass: boolean, rowCount: number, reason: string }}
 */
function step1_structuralCheck(html, rows) {
  const bodyText = html.toLowerCase();
  const noResultPhrases = [
    "no se encontr",
    "sin registros",
    "0 registros",
    "no existen procesos",
    "no hay procesos",
  ];
  const hasNoResultPhrase = noResultPhrases.some((p) => bodyText.includes(p));

  // La tabla de resultados del JEPMS usa filas de encabezado + filas de datos.
  // Con > 4 filas <tr> y sin frases de "sin resultados" asumimos que hay datos.
  const rowCount = rows.length;
  const pass = rowCount > 4 && !hasNoResultPhrase;

  return {
    pass,
    rowCount,
    reason: !pass
      ? hasNoResultPhrase
        ? "El servidor indicó explícitamente que no hay resultados."
        : `Muy pocas filas en la tabla (${rowCount}), probablemente sin datos.`
      : `Se encontraron ${rowCount} filas en la tabla.`,
  };
}

/**
 * PASO 2 — Verificación de identidad.
 * Compara cada fila de la tabla contra los datos del body.
 * Retorna las filas que coinciden con la persona buscada.
 *
 * Criterios (todos los proporcionados deben cumplirse en la misma fila):
 *  - cedula:    alguna celda contiene EXACTAMENTE ese número de documento.
 *  - nombres:   alguna celda contiene AL MENOS UNA palabra del nombre (>= 3 chars).
 *  - apellidos: alguna celda contiene AL MENOS UNA palabra del apellido (>= 3 chars).
 *
 * @param {string[][]} rows
 * @param {{ cedula?: string, nombres?: string, apellidos?: string }} criteria
 * @returns {{ matchedRows: string[][], matchDetail: string }}
 */
function step2_identityCheck(rows, criteria) {
  const { cedula, nombres, apellidos } = criteria;

  const cedulaNorm = normalize(cedula || "");
  const nombresWords = words(nombres || "");
  const apellidosWords = words(apellidos || "");

  // Si no se envió ningún criterio de identidad no podemos verificar → pasar
  const hasCriteria =
    cedulaNorm || nombresWords.length || apellidosWords.length;
  if (!hasCriteria) {
    return {
      matchedRows: [],
      matchDetail:
        "No se proporcionaron criterios de identidad para verificar.",
    };
  }

  const matchedRows = rows.filter((cells) => {
    // Texto completo de la fila normalizado
    const rowText = normalize(cells.join(" "));

    // ── Criterio 1: cédula ────────────────────────────────────────────────
    if (cedulaNorm) {
      // Debe estar exactamente como token separado (no como sub-cadena de otro número)
      const cedulaFound = cells.some((cell) => {
        const cellNorm = normalize(cell);
        // Comprobación exacta: el número aparece como palabra completa
        const regex = new RegExp(`(?<![0-9])${cedulaNorm}(?![0-9])`);
        return regex.test(cellNorm);
      });
      if (!cedulaFound) return false;
    }

    // ── Criterio 2: nombres ───────────────────────────────────────────────
    if (nombresWords.length > 0) {
      const nombresFound = nombresWords.some((word) => rowText.includes(word));
      if (!nombresFound) return false;
    }

    // ── Criterio 3: apellidos ─────────────────────────────────────────────
    if (apellidosWords.length > 0) {
      const apellidosFound = apellidosWords.some((word) =>
        rowText.includes(word),
      );
      if (!apellidosFound) return false;
    }

    return true; // Todos los criterios se cumplen en esta fila
  });

  const matchDetail =
    matchedRows.length > 0
      ? `${matchedRows.length} fila(s) coinciden con los datos de la persona.`
      : "Ninguna fila coincide exactamente con los datos de la persona.";

  return { matchedRows, matchDetail };
}

// ─────────────────────────────────────────────────────────────────────────────
// getData — POST HTTP al JEPMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} dataToSearch  — término enviado al buscador del JEPMS
 * @param {string} url           — URL lista.asp de la ciudad
 * @param {string} typeId        — "2" nombres | "3" identificación
 * @param {string} referer       — URL conectar.asp de la ciudad
 * @returns {Promise<string|null>}
 */
async function getData(dataToSearch, url, typeId, referer) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "es-419,es;q=0.9",
        "cache-control": "max-age=0",
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
      },
      referrer: referer,
      referrerPolicy: "strict-origin-when-cross-origin",
      body: `cbadju=${typeId}&norad=${encodeURIComponent(dataToSearch)}&Buscar=Buscar`,
      credentials: "include",
    });

    if (!response.ok) {
      console.warn(`  ⚠️  HTTP ${response.status} en ${url}`);
      return null;
    }

    return await response.text();
  } catch (err) {
    console.error(`  ❌ getData (${url}): ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshot con Puppeteer
// ─────────────────────────────────────────────────────────────────────────────

async function takeScreenshot(browser, html, cityLabel) {
  let page = null;
  try {
    if (!browser || !browser.isConnected()) {
      throw new Error("Navegador desconectado");
    }
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(30000);
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await sleep(800);
    const buffer = await page.screenshot({ fullPage: true });
    return Buffer.from(buffer).toString("base64");
  } catch (err) {
    console.error(`  ❌ Screenshot (${cityLabel}): ${err.message}`);
    return "";
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/consulta-rama-judicial
 *
 * Body:
 * {
 *   cedula?:    string,   // número de documento (se usa para buscar Y para verificar)
 *   nombres?:   string,   // nombres de la persona (solo para verificar)
 *   apellidos?: string,   // apellidos (se usan para buscar Y para verificar)
 * }
 *
 * Lógica de búsqueda enviada al JEPMS:
 *   - Si viene 'cedula'    → búsqueda por identificación (cbadju=3)
 *   - Si solo viene 'apellidos' → búsqueda por nombres/apellidos (cbadju=2)
 *   - Si vienen ambos → se hacen las DOS búsquedas y se unen resultados
 *
 * Respuesta 200:
 * {
 *   fuente:        string,
 *   termino:       object,
 *   totalCiudades: number,
 *   totalAlertas:  number,
 *   ciudades: Array<{
 *     ciudad:            string,
 *     alert:             boolean,   // TRUE solo si pasa los 2 pasos
 *     paso1_estructural: { pass, rowCount, reason },
 *     paso2_identidad:   { matched: boolean, matchedRows: number, detail },
 *     screenshot:        string,    // PNG en base64
 *     mensaje:           string,
 *     error?:            string,
 *   }>
 * }
 */
exports.consultarRamaJudicial = async (req, res) => {
  const { cedula = "", nombres = "", apellidos = "" } = req.body;

  const cedulaTrim = cedula.toString().trim();
  const nombresTrim = nombres.toString().trim();
  const apellidosTrim = apellidos.toString().trim();

  // Necesitamos al menos un término para buscar en el JEPMS
  if (!cedulaTrim && !apellidosTrim) {
    return res.status(400).json({
      error:
        "Debes enviar al menos 'cedula' o 'apellidos' para realizar la búsqueda.",
    });
  }

  // Construir las consultas que se van a lanzar al JEPMS:
  //   - Por cédula (typeId=3) si viene cedula
  //   - Por apellidos (typeId=2) si viene apellidos
  // Ambas se ejecutan si están disponibles y se fusionan por ciudad.
  const queries = [];
  if (cedulaTrim)
    queries.push({ term: cedulaTrim, typeId: "3", label: "identificación" });
  if (apellidosTrim)
    queries.push({ term: apellidosTrim, typeId: "2", label: "apellidos" });

  // Criterios de identidad para el paso 2
  const identityCriteria = {
    cedula: cedulaTrim,
    nombres: nombresTrim,
    apellidos: apellidosTrim,
  };

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🔍 Rama Judicial — doble verificación`);
  console.log(
    `   Cédula: "${cedulaTrim}" | Nombres: "${nombresTrim}" | Apellidos: "${apellidosTrim}"`,
  );
  console.log(`${"─".repeat(60)}`);

  const ciudadesResult = [];
  let browser = null;

  try {
    browser = await launchBrowser();

    for (const city of CITIES) {
      console.log(`\n  [${city.valor}] ─────────────────`);

      const cityResult = {
        ciudad: city.valor,
        alert: false,
        paso1_estructural: null,
        paso2_identidad: null,
        screenshot: "",
        mensaje: "",
      };

      try {
        // Auto-recuperar browser si se cayó
        if (!browser || !browser.isConnected()) {
          console.warn(`  [${city.valor}] Browser caído — relanzando...`);
          await browser?.close().catch(() => {});
          browser = await launchBrowser();
        }

        // ── Lanzar todas las consultas configuradas para esta ciudad ──────
        // Recopilamos el HTML de cada query y las filas extraídas.
        let mergedHtml = "";
        let mergedRows = [];

        for (const query of queries) {
          console.log(
            `  [${city.valor}] GET (${query.label}): "${query.term}"`,
          );

          const html = await getData(
            query.term,
            city.url,
            query.typeId,
            city.referer,
          );

          if (!html) {
            console.warn(
              `  [${city.valor}] Sin respuesta para query "${query.label}".`,
            );
            continue;
          }

          const rows = extractTableRows(html);
          console.log(
            `  [${city.valor}] (${query.label}) → ${rows.length} filas extraídas.`,
          );

          // Acumular HTML y filas de ambas búsquedas
          mergedHtml += html;
          mergedRows = mergedRows.concat(rows);
        }

        if (!mergedHtml) {
          cityResult.mensaje =
            "Sin respuesta del servidor para ninguna búsqueda.";
          ciudadesResult.push(cityResult);
          continue;
        }

        // ════════════════════════════════════════════════════
        // PASO 1 — Verificación estructural
        // ════════════════════════════════════════════════════
        const step1 = step1_structuralCheck(mergedHtml, mergedRows);
        cityResult.paso1_estructural = {
          pass: step1.pass,
          rowCount: step1.rowCount,
          reason: step1.reason,
        };
        console.log(
          `  [${city.valor}] PASO 1 → ${step1.pass ? "✅ PASA" : "❌ NO pasa"}: ${step1.reason}`,
        );

        // ════════════════════════════════════════════════════
        // PASO 2 — Verificación de identidad (solo si paso 1 pasó)
        // ════════════════════════════════════════════════════
        if (step1.pass) {
          const step2 = step2_identityCheck(mergedRows, identityCriteria);
          const matched = step2.matchedRows.length > 0;

          cityResult.paso2_identidad = {
            matched,
            matchedRows: step2.matchedRows.length,
            detail: step2.matchDetail,
          };
          console.log(
            `  [${city.valor}] PASO 2 → ${matched ? "⚠️  COINCIDE" : "✅ No coincide"}: ${step2.matchDetail}`,
          );

          // ALERTA solo si ambos pasos son positivos
          cityResult.alert = matched;
        } else {
          cityResult.paso2_identidad = {
            matched: false,
            matchedRows: 0,
            detail: "No se ejecutó: el paso 1 no encontró datos suficientes.",
          };
        }

        // ── Screenshot (siempre, como evidencia) ─────────────────────────
        // Usamos el HTML de la primera query disponible para el screenshot
        const htmlForScreenshot = mergedHtml.slice(
          0,
          mergedHtml.length / queries.length || mergedHtml.length,
        );
        cityResult.screenshot = await takeScreenshot(
          browser,
          htmlForScreenshot,
          city.valor,
        );

        // ── Mensaje descriptivo ───────────────────────────────────────────
        const now = new Date().toISOString();
        if (cityResult.alert) {
          cityResult.mensaje =
            `[${now}] ALERTA: la persona (${[cedulaTrim, nombresTrim, apellidosTrim].filter(Boolean).join(" / ")}) ` +
            `presenta ${cityResult.paso2_identidad.matchedRows} proceso(s) activo(s) confirmado(s) en ${city.valor}.`;
        } else if (step1.pass) {
          cityResult.mensaje =
            `[${now}] Se encontraron registros en ${city.valor} pero ninguno corresponde a la persona buscada ` +
            `(${[cedulaTrim, nombresTrim, apellidosTrim].filter(Boolean).join(" / ")}).`;
        } else {
          cityResult.mensaje =
            `[${now}] No se encontraron procesos activos en ${city.valor} para ` +
            `(${[cedulaTrim, nombresTrim, apellidosTrim].filter(Boolean).join(" / ")}).`;
        }

        console.log(`  [${city.valor}] ✅ Ciudad procesada.`);
      } catch (err) {
        console.error(`  ❌ [${city.valor}] ${err.message}`);
        cityResult.mensaje = `Error al consultar ${city.valor}: ${err.message}`;
        cityResult.error = err.message;
      }

      ciudadesResult.push(cityResult);
    } // fin for cities

    const totalAlertas = ciudadesResult.filter((c) => c.alert).length;
    console.log(
      `\n✅ Consulta Rama Judicial completada — ${totalAlertas} alerta(s) confirmada(s).`,
    );

    return res.json({
      fuente: "Rama Judicial de Colombia (JEPMS)",
      termino: {
        cedula: cedulaTrim || null,
        nombres: nombresTrim || null,
        apellidos: apellidosTrim || null,
      },
      totalCiudades: ciudadesResult.length,
      totalAlertas,
      ciudades: ciudadesResult,
    });
  } catch (err) {
    console.error("❌ ERROR GLOBAL Rama Judicial:", err.message);
    return res.status(502).json({
      error: "Error en consulta Rama Judicial",
      detalle: err.message,
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
};
