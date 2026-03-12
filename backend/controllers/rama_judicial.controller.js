/**
 * rama_judicial.controller.js
 *
 * Consulta el sistema JEPMS de la Rama Judicial de Colombia.
 * Sin dependencia de Puppeteer ni Chrome — funciona en cualquier entorno
 * (Render, Railway, local) usando solo fetch nativo de Node.js 18+.
 *
 * DOBLE VERIFICACIÓN:
 *  Paso 1 — Estructural: el HTML tiene filas de datos y no hay mensaje de "sin resultados".
 *  Paso 2 — Identidad:   al menos una fila de la tabla contiene los datos de la persona
 *                        (cédula exacta, palabras del nombre y/o apellido).
 *
 * POST /api/consulta-rama-judicial
 * Body: {
 *   cedula?:    string,   // número de documento
 *   nombres?:   string,   // primer y/o segundo nombre
 *   apellidos?: string,   // primer y/o segundo apellido
 * }
 */

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

// ─── Helpers de texto ──────────────────────────────────────────────────────────

/**
 * Normaliza texto: mayúsculas, sin tildes, sin caracteres especiales.
 */
function normalize(text) {
  return (text || "")
    .toString()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrae palabras de >= 3 caracteres de un texto normalizado.
 */
function words(text) {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length >= 3);
}

// ─── Parseo de HTML ────────────────────────────────────────────────────────────

/**
 * Extrae el texto de cada celda <td> de cada fila <tr> del HTML.
 * Retorna array de filas; cada fila es array de strings.
 * Sin dependencias externas — usa solo regex.
 */
function extractTableRows(html) {
  const rows = [];
  const trMatches = html.match(/<tr[\s>][\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const tdMatches = tr.match(/<td[\s>][\s\S]*?<\/td>/gi) || [];
    const cells = tdMatches.map((td) =>
      td
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }

  return rows;
}

// ─── Verificación en dos pasos ─────────────────────────────────────────────────

/**
 * PASO 1 — Verificación estructural.
 * Pasa si hay > 4 filas de tabla y ningún mensaje explícito de "sin resultados".
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
  const rowCount = rows.length;
  const pass = rowCount > 4 && !hasNoResultPhrase;

  return {
    pass,
    rowCount,
    reason: !pass
      ? hasNoResultPhrase
        ? "El servidor indicó explícitamente que no hay resultados."
        : `Muy pocas filas en la tabla (${rowCount}).`
      : `Se encontraron ${rowCount} filas en la tabla.`,
  };
}

/**
 * PASO 2 — Verificación de identidad.
 * Busca filas que contengan los datos de la persona buscada.
 * Todos los criterios enviados deben cumplirse en la MISMA fila.
 *
 * Criterios:
 *  - cedula:    aparece como número exacto (sin dígitos adyacentes) en alguna celda
 *  - nombres:   al menos UNA palabra del nombre aparece en el texto de la fila
 *  - apellidos: al menos UNA palabra del apellido aparece en el texto de la fila
 */
function step2_identityCheck(rows, criteria) {
  const { cedula, nombres, apellidos } = criteria;

  const cedulaNorm = normalize(cedula || "");
  const nombresWords = words(nombres || "");
  const apellidosWords = words(apellidos || "");

  if (!cedulaNorm && !nombresWords.length && !apellidosWords.length) {
    return {
      matchedRows: [],
      matchDetail: "No se proporcionaron criterios de identidad.",
    };
  }

  const matchedRows = rows.filter((cells) => {
    const rowText = normalize(cells.join(" "));

    // Criterio cédula: número exacto en alguna celda
    if (cedulaNorm) {
      const regex = new RegExp(`(?<![0-9])${cedulaNorm}(?![0-9])`);
      const found = cells.some((cell) => regex.test(normalize(cell)));
      if (!found) return false;
    }

    // Criterio nombres: al menos una palabra del nombre en la fila
    if (nombresWords.length > 0) {
      if (!nombresWords.some((w) => rowText.includes(w))) return false;
    }

    // Criterio apellidos: al menos una palabra del apellido en la fila
    if (apellidosWords.length > 0) {
      if (!apellidosWords.some((w) => rowText.includes(w))) return false;
    }

    return true;
  });

  return {
    matchedRows,
    matchDetail:
      matchedRows.length > 0
        ? `${matchedRows.length} fila(s) coinciden con los datos de la persona.`
        : "Ninguna fila coincide con los datos de la persona.",
  };
}

// ─── Petición HTTP al JEPMS ────────────────────────────────────────────────────

/**
 * POST al endpoint lista.asp de una ciudad.
 * Usa fetch nativo (Node 18+). Sin Puppeteer, sin Chrome.
 *
 * @param {string} term     Cédula o apellidos a buscar
 * @param {string} url      URL lista.asp
 * @param {string} typeId   "2" = apellidos | "3" = identificación
 * @param {string} referer  URL conectar.asp (misma ciudad)
 * @returns {Promise<string|null>}
 */
async function getData(term, url, typeId, referer) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15 s por ciudad

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "es-419,es;q=0.9",
        "cache-control": "max-age=0",
        "content-type": "application/x-www-form-urlencoded",
        "upgrade-insecure-requests": "1",
        referer,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body: `cbadju=${typeId}&norad=${encodeURIComponent(term)}&Buscar=Buscar`,
    });

    if (!response.ok) {
      console.warn(`  ⚠️  HTTP ${response.status} — ${url}`);
      return null;
    }

    // El servidor JEPMS suele responder en latin-1 / windows-1252
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString("latin1");
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn(`  ⏱️  Timeout en ${url}`);
    } else {
      console.error(`  ❌ getData: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Handler Express ───────────────────────────────────────────────────────────

exports.consultarRamaJudicial = async (req, res) => {
  const { cedula = "", nombres = "", apellidos = "" } = req.body;

  const cedulaTrim = cedula.toString().trim();
  const nombresTrim = nombres.toString().trim();
  const apellidosTrim = apellidos.toString().trim();

  if (!cedulaTrim && !apellidosTrim) {
    return res.status(400).json({
      error:
        "Debes enviar al menos 'cedula' o 'apellidos' para realizar la búsqueda.",
    });
  }

  // Determinar qué búsquedas lanzar al JEPMS por ciudad
  const queries = [];
  if (cedulaTrim)
    queries.push({ term: cedulaTrim, typeId: "3", label: "identificación" });
  if (apellidosTrim)
    queries.push({ term: apellidosTrim, typeId: "2", label: "apellidos" });

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

  for (const city of CITIES) {
    console.log(`\n  [${city.valor}] ─────────────────`);

    const cityResult = {
      ciudad: city.valor,
      alert: false,
      paso1_estructural: null,
      paso2_identidad: null,
      mensaje: "",
    };

    try {
      // ── Lanzar todas las queries para esta ciudad ─────────────────────
      let mergedHtml = "";
      let mergedRows = [];

      for (const query of queries) {
        console.log(`  [${city.valor}] POST (${query.label}): "${query.term}"`);
        const html = await getData(
          query.term,
          city.url,
          query.typeId,
          city.referer,
        );

        if (!html) {
          console.warn(
            `  [${city.valor}] Sin respuesta para "${query.label}".`,
          );
          continue;
        }

        const rows = extractTableRows(html);
        console.log(
          `  [${city.valor}] (${query.label}) → ${rows.length} filas.`,
        );

        mergedHtml += html;
        mergedRows = mergedRows.concat(rows);
      }

      if (!mergedHtml) {
        cityResult.mensaje = "Sin respuesta del servidor.";
        ciudadesResult.push(cityResult);
        continue;
      }

      console.log(["Merge HTML: ", mergedHtml, "Merge Rows: ", mergedRows]);

      // ── PASO 1 ─────────────────────────────────────────────────────────
      const step1 = step1_structuralCheck(mergedHtml, mergedRows);
      cityResult.paso1_estructural = {
        pass: step1.pass,
        rowCount: step1.rowCount,
        reason: step1.reason,
      };
      console.log(
        `  [${city.valor}] PASO 1 → ${step1.pass ? "✅ PASA" : "❌ NO pasa"}: ${step1.reason}`,
      );

      console.log(["Merge Rows: ", mergedRows]);

      // ── PASO 2 (solo si paso 1 pasó) ───────────────────────────────────
      if (step1.pass) {
        const step2 = step2_identityCheck(mergedRows, identityCriteria);
        const matched = step2.matchedRows.length > 0;

        cityResult.paso2_identidad = {
          matched,
          matchedRows: step2.matchedRows.length,
          // Exponer las filas coincidentes (sin datos sensibles extra, solo el texto de celda)
          filas: step2.matchedRows.map((cells) => cells.join(" | ")),
          detail: step2.matchDetail,
        };
        console.log(
          `  [${city.valor}] PASO 2 → ${matched ? "⚠️  COINCIDE" : "✅ No coincide"}: ${step2.matchDetail}`,
        );

        cityResult.alert = matched;
      } else {
        cityResult.paso2_identidad = {
          matched: false,
          matchedRows: 0,
          filas: [],
          detail: "No ejecutado: paso 1 sin datos suficientes.",
        };
      }

      // ── Mensaje descriptivo ────────────────────────────────────────────
      const now = new Date().toLocaleString("es-CO", {
        timeZone: "America/Bogota",
      });
      const quien = [cedulaTrim, nombresTrim, apellidosTrim]
        .filter(Boolean)
        .join(" / ");

      if (cityResult.alert) {
        cityResult.mensaje =
          `[${now}] ALERTA: ${quien} presenta ` +
          `${cityResult.paso2_identidad.matchedRows} proceso(s) activo(s) confirmado(s) en ${city.valor}.`;
      } else if (step1.pass) {
        cityResult.mensaje = `[${now}] Hay registros en ${city.valor} pero ninguno corresponde a ${quien}.`;
      } else {
        cityResult.mensaje = `[${now}] Sin procesos activos en ${city.valor} para ${quien}.`;
      }

      console.log(`  [${city.valor}] ✅ Listo.`);
    } catch (err) {
      console.error(`  ❌ [${city.valor}] ${err.message}`);
      cityResult.mensaje = `Error al consultar ${city.valor}: ${err.message}`;
      cityResult.error = err.message;
    }

    ciudadesResult.push(cityResult);
  }

  const totalAlertas = ciudadesResult.filter((c) => c.alert).length;
  console.log(
    `\n✅ Rama Judicial finalizada — ${totalAlertas} alerta(s) en ${ciudadesResult.length} ciudades.\n`,
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
};
