const Groq = require("groq-sdk");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth"); // npm install mammoth

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── PROMPTS ────────────────────────────────────────────────────────────────────
const PROMPTS = {
  camara_comercio: `Eres un experto en documentos legales colombianos especializado en debida diligencia y listas restrictivas.
Analiza este documento de Cámara de Comercio y extrae TODA la información disponible en formato JSON estricto:
{
  "razon_social": "nombre completo de la empresa tal como aparece registrado",
  "nombre_comercial": "nombre comercial si es diferente a la razón social",
  "sigla": "sigla de la empresa si aparece",
  "nit": "número de NIT con dígito verificador, formato: 000000000-0",
  "tipo_sociedad": "tipo exacto de sociedad (SAS, LTDA, SA, EU, SCA, etc)",
  "numero_matricula": "número de matrícula mercantil",
  "fecha_matricula": "fecha de constitución o primera matrícula",
  "fecha_renovacion": "fecha de última renovación",
  "fecha_vigencia": "fecha hasta la cual está vigente la matrícula",
  "estado_matricula": "ACTIVA o CANCELADA o SUSPENDIDA",
  "domicilio": "ciudad y departamento del domicilio principal",
  "direccion": "dirección completa de la sede principal",
  "municipio_registro": "municipio donde está registrada la Cámara de Comercio",
  "objeto_social": "descripción completa del objeto social",
  "actividad_economica_ciiu": "código CIIU principal",
  "capital_autorizado": "valor del capital autorizado en pesos",
  "capital_suscrito": "valor del capital suscrito en pesos",
  "capital_pagado": "valor del capital pagado en pesos",
  "representantes_legales": [
    {
      "nombre": "nombre completo del representante",
      "documento": "número de cédula o NIT si aparece",
      "cargo": "cargo exacto (Representante Legal, Gerente, Presidente, etc)",
      "limitaciones": "limitaciones de representación si aplica"
    }
  ],
  "junta_directiva": [
    {
      "nombre": "nombre completo del miembro",
      "cargo": "Principal o Suplente",
      "documento": "cédula si aparece"
    }
  ],
  "revisor_fiscal": {
    "nombre": "nombre completo",
    "documento": "cédula o tarjeta profesional",
    "firma_auditora": "nombre de la firma si aplica"
  },
  "socios_o_accionistas": [
    {
      "nombre": "nombre completo o razón social",
      "documento": "cédula o NIT",
      "porcentaje": "porcentaje de participación si aparece",
      "tipo": "natural o juridica"
    }
  ],
  "reformas_estatutarias": ["descripción de reformas relevantes con fecha si aparecen"],
  "sucursales_o_establecimientos": [
    {
      "nombre": "nombre del establecimiento",
      "direccion": "dirección",
      "municipio": "municipio"
    }
  ],
  "inscripciones_especiales": ["actos inscritos relevantes (embargos, medidas cautelares, liquidaciones, etc)"],
  "fecha_documento": "fecha de expedición del certificado",
  "entidad_expide": "nombre de la Cámara de Comercio que expide",
  "inconsistencias": ["posibles inconsistencias, campos ilegibles o alertas relevantes"],
  "confianza": 85
}
Si un campo no es visible o no aplica, usa null. Para arrays vacíos usa []. El campo confianza es un número entero de 0 a 100.
Responde SOLO con el JSON, sin texto adicional, sin bloques de código markdown.`,

  dof: `Eres un experto en debida diligencia y documentos de beneficiarios finales colombianos.
Analiza este Documento de Beneficiarios Finales (DOF / Formato 160) y extrae TODA la información en formato JSON estricto:
{
  "tipo_formulario": "DOF o Formato 160 o Reporte de Beneficiarios Finales",
  "entidad_reportante": "nombre o razón social de la entidad que reporta",
  "nit_reportante": "NIT de la entidad reportante",
  "fecha_reporte": "fecha de presentación del reporte",
  "periodo_reportado": "período al que corresponde el reporte",
  "beneficiarios_finales": [
    {
      "nombre_completo": "nombre completo del beneficiario",
      "tipo_persona": "natural o juridica",
      "tipo_documento": "CC, CE, NIT, Pasaporte, etc",
      "numero_documento": "número de documento sin puntos ni espacios",
      "fecha_nacimiento": "fecha de nacimiento si aplica",
      "nacionalidad": "nacionalidad o país de origen",
      "pais_residencia": "país de residencia",
      "porcentaje_participacion": "porcentaje de participación directa o indirecta",
      "tipo_control": "directo o indirecto o por cargo",
      "cargo_o_condicion": "cargo si es por posición (Representante Legal, etc)",
      "pep": "SI o NO — si es Persona Expuesta Políticamente",
      "cargo_pep": "cargo público si es PEP",
      "cadena_control": "descripción de la cadena de control si es indirecto"
    }
  ],
  "estructura_corporativa": "descripción de la estructura de propiedad si se puede inferir",
  "vehiculos_interpuestos": ["nombre de personas jurídicas intermedias en la cadena de control"],
  "declaracion_veracidad": "SI o NO — si el documento tiene declaración firmada de veracidad",
  "firmante": {
    "nombre": "nombre del firmante de la declaración",
    "cargo": "cargo del firmante",
    "documento": "cédula del firmante"
  },
  "fecha_documento": "fecha de expedición del documento",
  "inconsistencias": ["posibles inconsistencias, campos ilegibles o alertas relevantes"],
  "confianza": 85
}
Si un campo no es visible o no aplica, usa null. Para arrays vacíos usa []. El campo confianza es un número entero de 0 a 100.
Responde SOLO con el JSON, sin texto adicional, sin bloques de código markdown.`,

  cedula: `Eres un experto en documentos de identidad colombianos y detección de documentos alterados.
Analiza esta Cédula de Ciudadanía y extrae TODA la información disponible en formato JSON estricto:
{
  "nombre_completo": "nombre completo en el orden exacto que aparece en el documento",
  "primer_apellido": "primer apellido",
  "segundo_apellido": "segundo apellido o null",
  "primer_nombre": "primer nombre",
  "segundo_nombre": "segundo nombre o null",
  "numero_cedula": "número de cédula sin puntos, comas ni espacios",
  "fecha_nacimiento": "fecha de nacimiento en formato DD/MM/AAAA",
  "lugar_nacimiento": "municipio y departamento de nacimiento",
  "fecha_expedicion": "fecha de expedición en formato DD/MM/AAAA",
  "lugar_expedicion": "municipio y departamento de expedición",
  "sexo": "M o F",
  "grupo_sanguineo": "grupo sanguíneo (A, B, O, AB) y factor RH (+ o -) si es visible",
  "estatura": "estatura en metros si aparece en documentos viejos",
  "huella_dactilar_visible": "SI o NO — si hay huella en el documento",
  "tipo_cedula": "física o digital o amarilla o nueva o laminada",
  "codigo_barras_visible": "SI o NO",
  "chip_visible": "SI o NO — si tiene chip integrado",
  "senales_alteracion": [
    "descripción de cualquier señal de posible falsificación, raspados, cambios de fuente, alineaciones incorrectas, colores anómalos, etc"
  ],
  "calidad_imagen": "buena o regular o mala",
  "cara_visible": "ambas o solo_frente o solo_reverso",
  "inconsistencias": ["posibles inconsistencias entre campos o datos sospechosos"],
  "confianza": 85
}
Si un campo no es visible o no aplica, usa null. Para arrays vacíos usa []. El campo confianza es un número entero de 0 a 100.
Responde SOLO con el JSON, sin texto adicional, sin bloques de código markdown.`,

  rut: `Eres un experto en documentos tributarios colombianos de la DIAN.
Analiza este RUT (Registro Único Tributario) y extrae TODA la información disponible en formato JSON estricto:
{
  "nit": "número de NIT con dígito verificador, formato: 000000000-0",
  "razon_social": "razón social o nombre completo del contribuyente exactamente como aparece",
  "nombre_comercial": "nombre comercial si es diferente",
  "primer_apellido": "primer apellido si es persona natural",
  "segundo_apellido": "segundo apellido si aplica",
  "primer_nombre": "primer nombre si es persona natural",
  "otros_nombres": "otros nombres si aplica",
  "tipo_contribuyente": "natural o juridica",
  "tipo_documento": "CC, NIT, CE, Pasaporte, etc",
  "numero_documento": "número de documento del contribuyente (sin dígito verificador para personas)",
  "fecha_nacimiento": "fecha de nacimiento si es persona natural",
  "pais_nacimiento": "país de nacimiento si aparece",
  "lugar_nacimiento": "municipio de nacimiento si aparece",
  "sexo": "M o F si aplica",
  "actividades_economicas": [
    {
      "codigo_ciiu": "código CIIU",
      "descripcion": "descripción de la actividad",
      "principal": "SI o NO"
    }
  ],
  "responsabilidades_tributarias": [
    {
      "codigo": "código de responsabilidad (ej: 05, 11, 42)",
      "descripcion": "descripción si es visible"
    }
  ],
  "regimen_tributario": "SIMPLE o ORDINARIO o ESPECIAL",
  "gran_contribuyente": "SI o NO",
  "autoretenedor": "SI o NO",
  "agente_retencion": "SI o NO",
  "fecha_inscripcion_rut": "fecha de inscripción en el RUT",
  "fecha_actualizacion": "fecha de última actualización",
  "direccion_fiscal": "dirección completa de la dirección fiscal",
  "municipio_fiscal": "municipio de la dirección fiscal",
  "departamento_fiscal": "departamento de la dirección fiscal",
  "codigo_postal": "código postal si aparece",
  "telefono": "número(s) de teléfono",
  "email": "correo electrónico si es visible",
  "estado_rut": "ACTIVO o SUSPENDIDO o CANCELADO",
  "numero_formulario": "número del formulario RUT si aparece",
  "inconsistencias": ["posibles inconsistencias o alertas relevantes"],
  "confianza": 85
}
Si un campo no es visible o no aplica, usa null. Para arrays vacíos usa []. El campo confianza es un número entero de 0 a 100.
Responde SOLO con el JSON, sin texto adicional, sin bloques de código markdown.`,
};

// ─── MIME types soportados ──────────────────────────────────────────────────────
const MIME_IMAGENES = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

// NUEVO: MIME types de Word
const MIME_WORD = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc legacy
];

// NUEVO: qué tipos de documento aceptan Word
const TIPOS_ACEPTA_WORD = ["dof"];

// ─── Extracción de texto de PDF ─────────────────────────────────────────────────
// FIX: reescrito con Promise explícita para evitar que se quede pegado
async function extraerTextoPdf(filePath) {
  const buffer = fs.readFileSync(filePath);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          "El PDF tardó demasiado en procesarse. Puede ser un PDF escaneado o protegido. " +
            "Por favor suba una foto/imagen del documento.",
        ),
      );
    }, 20000);

    pdfParse(buffer, { max: 10 })
      .then((data) => {
        clearTimeout(timer);
        resolve(data.text?.trim() || "");
      })
      .catch((err) => {
        clearTimeout(timer);
        // pdfParse puede lanzar errores en PDFs con password, dañados o con estructura inusual
        reject(
          new Error(
            `Error leyendo el PDF: ${err.message}. ` +
              "Intente subir una imagen o foto del documento.",
          ),
        );
      });
  });
}

// NUEVO: Extracción de texto de Word (.docx / .doc)
async function extraerTextoWord(filePath) {
  let result;
  try {
    result = await mammoth.extractRawText({ path: filePath });
  } catch (err) {
    throw new Error(`Error leyendo el archivo Word: ${err.message}`);
  }

  if (result.messages?.length > 0) {
    const warns = result.messages.map((m) => m.message).join(", ");
    console.warn(`⚠️ Advertencias al leer Word (${filePath}): ${warns}`);
  }

  const texto = result.value?.trim() || "";
  if (!texto || texto.length < 20) {
    throw new Error(
      "No se pudo extraer texto del archivo Word. " +
        "El documento puede estar vacío, protegido o en formato no compatible.",
    );
  }
  return texto;
}

// ─── Adaptación del prompt para texto (PDF o Word) ──────────────────────────────
function adaptarPromptParaTexto(prompt) {
  return prompt
    .replace(
      /Analiza esta (imagen de una?|Cédula de Ciudadanía y extrae)/g,
      (m) =>
        m.includes("Cédula")
          ? "Analiza el siguiente texto extraído de una Cédula de Ciudadanía y extrae"
          : "Analiza el siguiente texto extraído de",
    )
    .replace(
      /Analiza este (documento de|Documento de|RUT \()/g,
      (_, p1) => `Analiza el siguiente texto extraído de este ${p1}`,
    );
}

// ─── Llamada principal a Groq ────────────────────────────────────────────────────
async function analizarDocumentoConGroq(filePath, tipoDocumento, mimeType) {
  const prompt = PROMPTS[tipoDocumento];
  if (!prompt)
    throw new Error(`Tipo de documento desconocido: ${tipoDocumento}`);

  if (!fs.existsSync(filePath))
    throw new Error("No se pudo leer el archivo subido.");

  const stat = fs.statSync(filePath);
  if (stat.size === 0) throw new Error("El archivo está vacío.");

  const mime = mimeType?.toLowerCase();
  let completion;

  // ── PDF ──────────────────────────────────────────────────────────────────────
  if (mime === "application/pdf") {
    console.log(`📄 Extrayendo texto del PDF: ${tipoDocumento}`);
    const textoPdf = await extraerTextoPdf(filePath);

    if (!textoPdf || textoPdf.length < 20) {
      throw new Error(
        "No se pudo extraer texto del PDF. Puede ser un PDF escaneado. " +
          "Por favor suba una foto clara del documento.",
      );
    }

    completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: `${adaptarPromptParaTexto(prompt)}\n\nTEXTO DEL DOCUMENTO:\n${textoPdf}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    // ── WORD (.docx / .doc) — solo para tipos que lo permiten ────────────────────
  } else if (MIME_WORD.includes(mime)) {
    if (!TIPOS_ACEPTA_WORD.includes(tipoDocumento)) {
      throw new Error(
        `El tipo de documento "${tipoDocumento}" no acepta archivos Word. ` +
          "Use PDF o imagen (JPG/PNG).",
      );
    }

    console.log(`📝 Extrayendo texto del Word: ${tipoDocumento}`);
    const textoWord = await extraerTextoWord(filePath);

    completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: `${adaptarPromptParaTexto(prompt)}\n\nTEXTO DEL DOCUMENTO:\n${textoWord}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    // ── IMAGEN ───────────────────────────────────────────────────────────────────
  } else if (MIME_IMAGENES[mime]) {
    console.log(`🖼️ Analizando imagen: ${tipoDocumento}`);
    const fileBuffer = fs.readFileSync(filePath);
    const base64Image = fileBuffer.toString("base64");

    completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${MIME_IMAGENES[mime]};base64,${base64Image}`,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    // ── FORMATO NO SOPORTADO ─────────────────────────────────────────────────────
  } else {
    const formatosAceptados =
      tipoDocumento === "dof"
        ? "PDF, JPG, PNG o Word (.docx)"
        : "PDF, JPG o PNG";
    throw new Error(
      `Formato no soportado: "${mimeType}". Use ${formatosAceptados}.`,
    );
  }

  // ── Parseo de la respuesta ───────────────────────────────────────────────────
  const rawContent = completion.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error("La IA no devolvió respuesta.");

  // FIX: limpiar posibles bloques markdown antes de parsear
  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch)
    throw new Error(
      "La IA no devolvió un JSON válido. Respuesta: " +
        rawContent.slice(0, 200),
    );

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    throw new Error(`Error parseando JSON de la IA: ${parseErr.message}`);
  }
}

// ─── Handler principal ───────────────────────────────────────────────────────────
exports.analizarDocumentos = async (req, res) => {
  // FIX: envolver todo en try/catch y asegurar que res siempre recibe respuesta
  try {
    const archivos = req.files;
    if (!archivos || Object.keys(archivos).length === 0) {
      return res.status(400).json({ error: "No se recibieron documentos" });
    }

    console.log("📄 Analizando documentos:", Object.keys(archivos));

    const resultados = {};

    // FIX: usar Promise.allSettled en lugar de Promise.all para que un fallo
    // en un documento no cancele los demás ni deje el handler colgado
    const promesas = Object.entries(archivos).map(([campo, fileArray]) => {
      const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;

      return analizarDocumentoConGroq(file.path, campo, file.mimetype)
        .then((datos) => {
          resultados[campo] = { ok: true, datos };
        })
        .catch((err) => {
          console.error(`❌ Error analizando ${campo}:`, err.message);
          resultados[campo] = { ok: false, error: err.message };
        })
        .finally(() => {
          // Limpiar archivo temporal sin importar el resultado
          try {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          } catch (unlinkErr) {
            console.warn(
              `⚠️ No se pudo eliminar archivo temporal ${file.path}:`,
              unlinkErr.message,
            );
          }
        });
    });

    // FIX: allSettled garantiza que esperamos TODAS las promesas aunque fallen
    await Promise.allSettled(promesas);

    const resumen = generarResumen(resultados);

    // FIX: asegurarse de no llamar res.json() dos veces
    if (!res.headersSent) {
      res.json({ resultados, resumen });
    }
  } catch (error) {
    console.error("❌ Error general:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error al procesar los documentos",
        detalle: error.message,
      });
    }
  }
};

// ─── Resumen consolidado para listas restrictivas ────────────────────────────────
function generarResumen(resultados) {
  const cedula = resultados.cedula?.ok ? resultados.cedula.datos : null;
  const camara = resultados.camara_comercio?.ok
    ? resultados.camara_comercio.datos
    : null;
  const rut = resultados.rut?.ok ? resultados.rut.datos : null;
  const dof = resultados.dof?.ok ? resultados.dof.datos : null;

  // ── Identidad de la persona natural ──────────────────────────────────────────
  const persona_natural = (() => {
    const nombre_completo =
      cedula?.nombre_completo ||
      (rut?.tipo_contribuyente === "natural"
        ? [
            rut.primer_nombre,
            rut.otros_nombres,
            rut.primer_apellido,
            rut.segundo_apellido,
          ]
            .filter(Boolean)
            .join(" ")
        : null) ||
      dof?.beneficiarios_finales?.find((b) => b.tipo_persona === "natural")
        ?.nombre_completo ||
      null;

    const numero_cedula =
      cedula?.numero_cedula ||
      (rut?.tipo_contribuyente === "natural" ? rut.numero_documento : null) ||
      null;

    if (!nombre_completo && !numero_cedula) return null;

    return {
      nombre_completo,
      primer_apellido: cedula?.primer_apellido || rut?.primer_apellido || null,
      segundo_apellido:
        cedula?.segundo_apellido || rut?.segundo_apellido || null,
      primer_nombre: cedula?.primer_nombre || rut?.primer_nombre || null,
      segundo_nombre: cedula?.segundo_nombre || rut?.otros_nombres || null,
      numero_cedula,
      fecha_nacimiento:
        cedula?.fecha_nacimiento || rut?.fecha_nacimiento || null,
      lugar_nacimiento:
        cedula?.lugar_nacimiento || rut?.lugar_nacimiento || null,
      fecha_expedicion_cedula: cedula?.fecha_expedicion || null,
      lugar_expedicion_cedula: cedula?.lugar_expedicion || null,
      sexo: cedula?.sexo || rut?.sexo || null,
      grupo_sanguineo: cedula?.grupo_sanguineo || null,
      es_pep: dof?.beneficiarios_finales?.some((b) => b.pep === "SI") || null,
      cargo_pep:
        dof?.beneficiarios_finales?.find((b) => b.pep === "SI")?.cargo_pep ||
        null,
      es_representante_legal:
        camara?.representantes_legales?.some(
          (r) =>
            r.nombre &&
            cedula?.nombre_completo &&
            sonNombresSimilares(r.nombre, cedula.nombre_completo),
        ) || null,
      cargo_en_empresa:
        camara?.representantes_legales?.find(
          (r) =>
            r.nombre &&
            cedula?.nombre_completo &&
            sonNombresSimilares(r.nombre, cedula.nombre_completo),
        )?.cargo || null,
    };
  })();

  // ── Identidad de la empresa ───────────────────────────────────────────────────
  const empresa = (() => {
    const razon_social = camara?.razon_social || rut?.razon_social || null;
    const nit = normalizar_nit(camara?.nit || rut?.nit);

    if (!razon_social && !nit) return null;

    return {
      razon_social,
      nombre_comercial:
        camara?.nombre_comercial || rut?.nombre_comercial || null,
      sigla: camara?.sigla || null,
      nit,
      tipo_sociedad: camara?.tipo_sociedad || null,
      numero_matricula: camara?.numero_matricula || null,
      estado_matricula: camara?.estado_matricula || null,
      fecha_matricula: camara?.fecha_matricula || null,
      fecha_renovacion: camara?.fecha_renovacion || null,
      domicilio: camara?.domicilio || rut?.municipio_fiscal || null,
      direccion: camara?.direccion || rut?.direccion_fiscal || null,
      actividad_principal_ciiu:
        camara?.actividad_economica_ciiu ||
        rut?.actividades_economicas?.find((a) => a.principal === "SI")
          ?.codigo_ciiu ||
        null,
      descripcion_actividad:
        rut?.actividades_economicas?.find((a) => a.principal === "SI")
          ?.descripcion || null,
      todas_actividades_ciiu: rut?.actividades_economicas || [],
      responsabilidades_tributarias: rut?.responsabilidades_tributarias || [],
      regimen_tributario: rut?.regimen_tributario || null,
      gran_contribuyente: rut?.gran_contribuyente || null,
      estado_rut: rut?.estado_rut || null,
      capital_suscrito: camara?.capital_suscrito || null,
      capital_pagado: camara?.capital_pagado || null,
    };
  })();

  // ── Personas vinculadas a la empresa (para buscar en listas) ─────────────────
  const personas_vinculadas = (() => {
    const mapa = new Map();

    const agregar = (nombre, doc, rol, fuente) => {
      if (!nombre) return;
      const key = nombre.toLowerCase().trim();
      if (!mapa.has(key))
        mapa.set(key, {
          nombre,
          documento: doc || null,
          roles: [],
          fuentes: [],
        });
      const entry = mapa.get(key);
      if (rol && !entry.roles.includes(rol)) entry.roles.push(rol);
      if (fuente && !entry.fuentes.includes(fuente)) entry.fuentes.push(fuente);
      if (doc && !entry.documento) entry.documento = doc;
    };

    (camara?.representantes_legales || []).forEach((r) =>
      agregar(
        r.nombre,
        r.documento,
        r.cargo || "Representante Legal",
        "Cámara de Comercio",
      ),
    );
    (camara?.junta_directiva || []).forEach((j) =>
      agregar(
        j.nombre,
        j.documento,
        `Junta: ${j.cargo || "Miembro"}`,
        "Cámara de Comercio",
      ),
    );
    if (camara?.revisor_fiscal?.nombre)
      agregar(
        camara.revisor_fiscal.nombre,
        camara.revisor_fiscal.documento,
        "Revisor Fiscal",
        "Cámara de Comercio",
      );
    (camara?.socios_o_accionistas || []).forEach((s) =>
      agregar(
        s.nombre,
        s.documento,
        `Socio ${s.porcentaje ? s.porcentaje + "%" : ""}`.trim(),
        "Cámara de Comercio",
      ),
    );
    (dof?.beneficiarios_finales || []).forEach((b) => {
      const rol = b.tipo_control
        ? `Beneficiario Final (${b.porcentaje_participacion || "?"}% - ${b.tipo_control})`
        : "Beneficiario Final";
      agregar(b.nombre_completo, b.numero_documento, rol, "DOF");
      if (b.pep === "SI" && b.nombre_completo) {
        const entry = mapa.get(b.nombre_completo.toLowerCase().trim());
        if (entry) {
          entry.es_pep = true;
          entry.cargo_pep = b.cargo_pep || null;
        }
      }
    });
    if (cedula?.nombre_completo)
      agregar(
        cedula.nombre_completo,
        cedula.numero_cedula,
        "Titular Cédula",
        "Cédula",
      );

    return Array.from(mapa.values());
  })();

  // ── Datos para búsqueda en listas restrictivas ───────────────────────────────
  const datos_busqueda = {
    cedulas_a_buscar: [
      ...new Set(
        [
          cedula?.numero_cedula,
          ...personas_vinculadas.map((p) => p.documento).filter(Boolean),
        ].filter(Boolean),
      ),
    ],

    nits_a_buscar: [
      ...new Set(
        [
          normalizar_nit(camara?.nit),
          normalizar_nit(rut?.nit),
          ...(camara?.socios_o_accionistas || [])
            .filter((s) => s.tipo === "juridica")
            .map((s) => s.documento)
            .filter(Boolean),
          ...(dof?.vehiculos_interpuestos || []),
        ].filter(Boolean),
      ),
    ],

    nombres_a_buscar: [
      ...new Set(personas_vinculadas.map((p) => p.nombre).filter(Boolean)),
    ],

    razones_sociales_a_buscar: [
      ...new Set(
        [
          camara?.razon_social,
          rut?.razon_social,
          camara?.nombre_comercial,
          ...(camara?.socios_o_accionistas || [])
            .filter((s) => s.tipo === "juridica")
            .map((s) => s.nombre)
            .filter(Boolean),
        ].filter(Boolean),
      ),
    ],
  };

  // ── Alertas e inconsistencias cruzadas ────────────────────────────────────────
  const alertas = [];

  if (
    camara?.nit &&
    rut?.nit &&
    normalizar_nit(camara.nit) !== normalizar_nit(rut.nit)
  )
    alertas.push({
      nivel: "CRITICO",
      mensaje: `NIT difiere: Cámara (${camara.nit}) vs RUT (${rut.nit})`,
    });

  if (
    camara?.razon_social &&
    rut?.razon_social &&
    normalizar_texto(camara.razon_social) !== normalizar_texto(rut.razon_social)
  )
    alertas.push({
      nivel: "MEDIO",
      mensaje: `Razón social difiere: Cámara ("${camara.razon_social}") vs RUT ("${rut.razon_social}")`,
    });

  if (cedula?.nombre_completo && camara?.representantes_legales?.length > 0) {
    const estaEnCamara = camara.representantes_legales.some((r) =>
      sonNombresSimilares(r.nombre, cedula.nombre_completo),
    );
    if (!estaEnCamara)
      alertas.push({
        nivel: "MEDIO",
        mensaje: `El titular de la cédula ("${cedula.nombre_completo}") no aparece como representante legal en la Cámara de Comercio`,
      });
  }

  if (cedula?.nombre_completo && dof?.beneficiarios_finales?.length > 0) {
    const estaEnDof = dof.beneficiarios_finales.some((b) =>
      sonNombresSimilares(b.nombre_completo, cedula.nombre_completo),
    );
    if (!estaEnDof)
      alertas.push({
        nivel: "INFO",
        mensaje: `El titular de la cédula ("${cedula.nombre_completo}") no figura como beneficiario final en el DOF`,
      });
  }

  if (
    cedula?.numero_cedula &&
    rut?.tipo_contribuyente === "natural" &&
    rut?.numero_documento
  ) {
    if (
      cedula.numero_cedula.replace(/\D/g, "") !==
      rut.numero_documento.replace(/\D/g, "")
    )
      alertas.push({
        nivel: "CRITICO",
        mensaje: `Número de cédula difiere: Cédula (${cedula.numero_cedula}) vs RUT (${rut.numero_documento})`,
      });
  }

  if (camara?.estado_matricula && camara.estado_matricula !== "ACTIVA")
    alertas.push({
      nivel: "CRITICO",
      mensaje: `Matrícula mercantil en estado: ${camara.estado_matricula}`,
    });

  if (rut?.estado_rut && rut.estado_rut !== "ACTIVO")
    alertas.push({
      nivel: "CRITICO",
      mensaje: `RUT en estado: ${rut.estado_rut}`,
    });

  if (cedula?.senales_alteracion?.length > 0)
    alertas.push({
      nivel: "CRITICO",
      mensaje: `Señales de posible alteración en la cédula: ${cedula.senales_alteracion.join(" / ")}`,
    });

  const peps = personas_vinculadas.filter((p) => p.es_pep);
  if (peps.length > 0)
    alertas.push({
      nivel: "ALTO",
      mensaje: `PEP detectado(s): ${peps.map((p) => `${p.nombre} (${p.cargo_pep || "cargo no especificado"})`).join(", ")}`,
    });

  [
    { doc: cedula, fuente: "Cédula" },
    { doc: camara, fuente: "Cámara de Comercio" },
    { doc: rut, fuente: "RUT" },
    { doc: dof, fuente: "DOF" },
  ].forEach(({ doc, fuente }) => {
    (doc?.inconsistencias || []).forEach((inc) =>
      alertas.push({ nivel: "INFO", mensaje: `[${fuente}] ${inc}` }),
    );
  });

  return {
    persona_natural,
    empresa,
    personas_vinculadas,
    datos_busqueda,
    alertas,
    documentos_analizados: Object.keys(resultados).filter(
      (k) => resultados[k].ok,
    ),
    documentos_con_error: Object.keys(resultados).filter(
      (k) => !resultados[k].ok,
    ),
    confianza_promedio: (() => {
      const vals = Object.values(resultados)
        .filter((r) => r.ok && typeof r.datos?.confianza === "number")
        .map((r) => r.datos.confianza);
      return vals.length
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        : null;
    })(),
  };
}

// ─── Utilidades ──────────────────────────────────────────────────────────────────
function normalizar_nit(nit) {
  if (!nit) return null;
  return nit
    .toString()
    .replace(/[^0-9\-]/g, "")
    .trim();
}

function normalizar_texto(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function sonNombresSimilares(a, b) {
  if (!a || !b) return false;
  const na = normalizar_texto(a);
  const nb = normalizar_texto(b);
  if (na === nb) return true;
  const palabrasA = na.split(" ").filter((p) => p.length > 2);
  const palabrasB = nb.split(" ").filter((p) => p.length > 2);
  const coincidencias = palabrasA.filter((p) => palabrasB.includes(p));
  return coincidencias.length >= 2;
}
