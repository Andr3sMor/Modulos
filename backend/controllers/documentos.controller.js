const Groq = require("groq-sdk");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

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
  "observaciones_clave": ["observación importante para el analista 1", "observación importante 2"],
  "confianza": 85
}
Si un campo no es visible o no aplica, usa null. Para arrays vacíos usa []. El campo confianza es un número entero de 0 a 100. En observaciones_clave incluye 2-4 puntos relevantes para debida diligencia (vencimientos, estados, señales de alerta, datos relevantes del objeto social, etc).
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
  "observaciones_clave": ["observación importante para el analista 1", "observación importante 2"],
  "confianza": 85
}
Si un campo no es visible o no aplica, usa null. Para arrays vacíos usa []. El campo confianza es un número entero de 0 a 100. En observaciones_clave incluye 2-4 puntos clave para debida diligencia (PEPs, estructuras complejas de control, porcentajes relevantes, señales de alerta, etc).
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
  "observaciones_clave": ["observación importante para el analista 1", "observación importante 2"],
  "confianza": 85
}
Si un campo no es visible o no aplica, usa null. Para arrays vacíos usa []. El campo confianza es un número entero de 0 a 100. En observaciones_clave incluye 2-4 puntos clave (señales de alteración, calidad del documento, coherencia entre campos, etc).
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
  "observaciones_clave": ["observación importante para el analista 1", "observación importante 2"],
  "confianza": 85
}
Si un campo no es visible o no aplica, usa null. Para arrays vacíos usa []. El campo confianza es un número entero de 0 a 100. En observaciones_clave incluye 2-4 puntos clave (estado del RUT, régimen tributario, responsabilidades relevantes, fechas de actualización, etc).
Responde SOLO con el JSON, sin texto adicional, sin bloques de código markdown.`,
};

// ─── MIME types ─────────────────────────────────────────────────────────────────
const MIME_IMAGENES = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

const MIME_WORD = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

const TIPOS_ACEPTA_WORD = ["dof"];

// ─── FIX 1: Extracción de texto de PDF con timeout real ─────────────────────────
// pdf-parse internamente no respeta el abort, pero si ponemos { max: 0 } en lugar
// de { max: 10 } y capturamos el buffer, podemos al menos cortar después.
// La solución más robusta es correr pdfParse en una Promise race contra un timeout.
async function extraerTextoPdf(filePath) {
  const buffer = fs.readFileSync(filePath);

  const parsePromise = pdfParse(buffer, { max: 10 })
    .then((data) => data.text?.trim() || "")
    .catch((err) => {
      throw new Error(
        `Error leyendo el PDF: ${err.message}. Intente subir una imagen del documento.`,
      );
    });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            "El PDF tardó demasiado en procesarse. Puede ser un PDF escaneado o protegido. " +
              "Por favor suba una foto/imagen del documento.",
          ),
        ),
      // FIX: reducido a 15 s; si el proceso hijo de pdf-parse no termina,
      // Node.js igual seguirá corriendo hasta que el proceso hijo muera, pero
      // la respuesta HTTP ya se habrá enviado con el error — no queda colgado.
      8000,
    ),
  );

  return Promise.race([parsePromise, timeoutPromise]);
}

// ─── Extracción de texto de Word ─────────────────────────────────────────────────
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

// ─── Adaptación del prompt para texto ────────────────────────────────────────────
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

// ─── Llamada a Groq ───────────────────────────────────────────────────────────────
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
  } else {
    const formatosAceptados =
      tipoDocumento === "dof"
        ? "PDF, JPG, PNG o Word (.docx)"
        : "PDF, JPG o PNG";
    throw new Error(
      `Formato no soportado: "${mimeType}". Use ${formatosAceptados}.`,
    );
  }

  const rawContent = completion.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error("La IA no devolvió respuesta.");

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
  try {
    const archivos = req.files;
    if (!archivos || Object.keys(archivos).length === 0) {
      return res.status(400).json({ error: "No se recibieron documentos" });
    }

    console.log("📄 Analizando documentos:", Object.keys(archivos));

    const resultados = {};

    // Procesar documentos de forma secuencial para no sobrecargar la API de Groq
    for (const [campo, fileArray] of Object.entries(archivos)) {
      const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;
      console.log(`🔍 Procesando: ${campo} (${file.mimetype})`);
      try {
        const datos = await analizarDocumentoConGroq(file.path, campo, file.mimetype);
        resultados[campo] = { ok: true, datos };
      } catch (err) {
        console.error(`❌ Error analizando ${campo}:`, err.message);
        resultados[campo] = { ok: false, error: err.message };
      } finally {
        try {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (unlinkErr) {
          console.warn(`⚠️ No se pudo eliminar archivo temporal ${file.path}:`, unlinkErr.message);
        }
      }
    }

    const resumen = generarResumen(resultados);

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

// ─── FIX 2: Coerción segura de valores ──────────────────────────────────────────
// Convierte cualquier valor a string legible. Si el LLM devuelve un objeto
// donde se esperaba un string (ej: { "codigo": "4711", "descripcion": "..." })
// esto lo serializa en lugar de producir "[object Object]".
function coerceString(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  // Objeto o array inesperado → serializar compacto para que sea inspeccionable
  return JSON.stringify(val);
}

// Versión para campos que deben ser específicamente strings de texto simple.
// Si el LLM devuelve un objeto con un campo canónico conocido, lo extrae.
function extraerCampoString(val, ...claves) {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object" && !Array.isArray(val)) {
    // Intentar extraer por clave conocida (ej: "descripcion", "nombre", "valor")
    for (const k of claves) {
      if (val[k] !== undefined) return coerceString(val[k]);
    }
    // Ninguna clave conocida: serializar compacto
    return JSON.stringify(val);
  }
  return coerceString(val);
}

// ─── Resumen consolidado ─────────────────────────────────────────────────────────
function generarResumen(resultados) {
  const cedula = resultados.cedula?.ok ? resultados.cedula.datos : null;
  const camara = resultados.camara_comercio?.ok
    ? resultados.camara_comercio.datos
    : null;
  const rut = resultados.rut?.ok ? resultados.rut.datos : null;
  const dof = resultados.dof?.ok ? resultados.dof.datos : null;

  // ── Nombre completo desde RUT (persona natural) ───────────────────────────────
  // FIX: cada campo del RUT se pasa por coerceString antes de concatenar
  const nombreDesdeRut =
    rut?.tipo_contribuyente === "natural"
      ? [
          coerceString(rut.primer_nombre),
          coerceString(rut.otros_nombres),
          coerceString(rut.primer_apellido),
          coerceString(rut.segundo_apellido),
        ]
          .filter(Boolean)
          .join(" ") || null
      : null;

  // ── Persona natural ────────────────────────────────────────────────────────────
  const persona_natural = (() => {
    const nombre_completo =
      coerceString(cedula?.nombre_completo) ||
      nombreDesdeRut ||
      coerceString(
        dof?.beneficiarios_finales?.find((b) => b.tipo_persona === "natural")
          ?.nombre_completo,
      ) ||
      null;

    const numero_cedula =
      coerceString(cedula?.numero_cedula) ||
      (rut?.tipo_contribuyente === "natural"
        ? coerceString(rut.numero_documento)
        : null) ||
      null;

    if (!nombre_completo && !numero_cedula) return null;

    return {
      nombre_completo,
      primer_apellido:
        coerceString(cedula?.primer_apellido) ||
        coerceString(rut?.primer_apellido) ||
        null,
      segundo_apellido:
        coerceString(cedula?.segundo_apellido) ||
        coerceString(rut?.segundo_apellido) ||
        null,
      primer_nombre:
        coerceString(cedula?.primer_nombre) ||
        coerceString(rut?.primer_nombre) ||
        null,
      segundo_nombre:
        coerceString(cedula?.segundo_nombre) ||
        coerceString(rut?.otros_nombres) ||
        null,
      numero_cedula,
      fecha_nacimiento:
        coerceString(cedula?.fecha_nacimiento) ||
        coerceString(rut?.fecha_nacimiento) ||
        null,
      lugar_nacimiento:
        coerceString(cedula?.lugar_nacimiento) ||
        coerceString(rut?.lugar_nacimiento) ||
        null,
      fecha_expedicion_cedula: coerceString(cedula?.fecha_expedicion) || null,
      lugar_expedicion_cedula: coerceString(cedula?.lugar_expedicion) || null,
      sexo: coerceString(cedula?.sexo) || coerceString(rut?.sexo) || null,
      grupo_sanguineo: coerceString(cedula?.grupo_sanguineo) || null,
      es_pep: dof?.beneficiarios_finales?.some((b) => b.pep === "SI") || null,
      cargo_pep:
        coerceString(
          dof?.beneficiarios_finales?.find((b) => b.pep === "SI")?.cargo_pep,
        ) || null,
      es_representante_legal:
        camara?.representantes_legales?.some(
          (r) =>
            r.nombre &&
            cedula?.nombre_completo &&
            sonNombresSimilares(
              coerceString(r.nombre),
              coerceString(cedula.nombre_completo),
            ),
        ) || null,
      cargo_en_empresa:
        coerceString(
          camara?.representantes_legales?.find(
            (r) =>
              r.nombre &&
              cedula?.nombre_completo &&
              sonNombresSimilares(
                coerceString(r.nombre),
                coerceString(cedula.nombre_completo),
              ),
          )?.cargo,
        ) || null,
    };
  })();

  // ── Empresa ────────────────────────────────────────────────────────────────────
  const empresa = (() => {
    const razon_social =
      coerceString(camara?.razon_social) ||
      coerceString(rut?.razon_social) ||
      null;
    const nit = normalizar_nit(camara?.nit || rut?.nit);

    if (!razon_social && !nit) return null;

    // FIX: actividades_economicas — el LLM a veces devuelve el array entero
    // como valor de un campo string. Nos aseguramos de que sea array.
    const actividades = Array.isArray(rut?.actividades_economicas)
      ? rut.actividades_economicas
      : [];

    const actividadPrincipal = actividades.find((a) => a.principal === "SI") || actividades[0] || null;

    return {
      razon_social,
      nombre_comercial:
        coerceString(camara?.nombre_comercial) ||
        coerceString(rut?.nombre_comercial) ||
        null,
      sigla: coerceString(camara?.sigla) || null,
      nit,
      tipo_sociedad: coerceString(camara?.tipo_sociedad) || null,
      numero_matricula: coerceString(camara?.numero_matricula) || null,
      estado_matricula: coerceString(camara?.estado_matricula) || null,
      fecha_matricula: coerceString(camara?.fecha_matricula) || null,
      fecha_renovacion: coerceString(camara?.fecha_renovacion) || null,
      domicilio:
        coerceString(camara?.domicilio) ||
        coerceString(rut?.municipio_fiscal) ||
        null,
      direccion:
        coerceString(camara?.direccion) ||
        coerceString(rut?.direccion_fiscal) ||
        null,
      actividad_principal_ciiu:
        coerceString(camara?.actividad_economica_ciiu) ||
        // FIX: codigo_ciiu puede ser objeto si el modelo anidó datos
        extraerCampoString(actividadPrincipal?.codigo_ciiu, "codigo", "code") ||
        null,
      descripcion_actividad:
        // FIX: descripcion puede ser objeto
        extraerCampoString(
          actividadPrincipal?.descripcion,
          "descripcion",
          "description",
          "texto",
        ) || null,
      // FIX: normalizar cada elemento del array de actividades
      todas_actividades_ciiu: actividades.map((a) => ({
        codigo_ciiu: extraerCampoString(a.codigo_ciiu, "codigo", "code"),
        descripcion: extraerCampoString(
          a.descripcion,
          "descripcion",
          "description",
          "texto",
        ),
        principal: coerceString(a.principal),
      })),
      // FIX: normalizar responsabilidades
      responsabilidades_tributarias: (Array.isArray(
        rut?.responsabilidades_tributarias,
      )
        ? rut.responsabilidades_tributarias
        : []
      ).map((r) => ({
        codigo: extraerCampoString(r.codigo, "codigo", "code"),
        descripcion: extraerCampoString(
          r.descripcion,
          "descripcion",
          "description",
          "texto",
        ),
      })),
      regimen_tributario: coerceString(rut?.regimen_tributario) || null,
      gran_contribuyente: coerceString(rut?.gran_contribuyente) || null,
      estado_rut: coerceString(rut?.estado_rut) || null,
      capital_suscrito: coerceString(camara?.capital_suscrito) || null,
      capital_pagado: coerceString(camara?.capital_pagado) || null,
    };
  })();

  // ── Personas vinculadas ────────────────────────────────────────────────────────
  const personas_vinculadas = (() => {
    const mapa = new Map();

    const agregar = (nombre, doc, rol, fuente) => {
      // FIX: coerce antes de usar como clave o comparar
      const nombreStr = coerceString(nombre);
      const docStr = coerceString(doc);
      if (!nombreStr) return;
      const key = nombreStr.toLowerCase().trim();
      if (!mapa.has(key))
        mapa.set(key, {
          nombre: nombreStr,
          documento: docStr || null,
          roles: [],
          fuentes: [],
        });
      const entry = mapa.get(key);
      if (rol && !entry.roles.includes(rol)) entry.roles.push(rol);
      if (fuente && !entry.fuentes.includes(fuente)) entry.fuentes.push(fuente);
      if (docStr && !entry.documento) entry.documento = docStr;
    };

    (camara?.representantes_legales || []).forEach((r) =>
      agregar(
        r.nombre,
        r.documento,
        coerceString(r.cargo) || "Representante Legal",
        "Cámara de Comercio",
      ),
    );
    (camara?.junta_directiva || []).forEach((j) =>
      agregar(
        j.nombre,
        j.documento,
        `Junta: ${coerceString(j.cargo) || "Miembro"}`,
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
    (camara?.socios_o_accionistas || []).forEach((s) => {
      const porcentaje = coerceString(s.porcentaje);
      agregar(
        s.nombre,
        s.documento,
        `Socio ${porcentaje ? porcentaje + "%" : ""}`.trim(),
        "Cámara de Comercio",
      );
    });
    (dof?.beneficiarios_finales || []).forEach((b) => {
      const porcentaje = coerceString(b.porcentaje_participacion);
      const tipoControl = coerceString(b.tipo_control);
      const rol = tipoControl
        ? `Beneficiario Final (${porcentaje || "?"}% - ${tipoControl})`
        : "Beneficiario Final";
      agregar(b.nombre_completo, b.numero_documento, rol, "DOF");
      if (b.pep === "SI" && b.nombre_completo) {
        const entry = mapa.get(
          coerceString(b.nombre_completo)?.toLowerCase().trim(),
        );
        if (entry) {
          entry.es_pep = true;
          entry.cargo_pep = coerceString(b.cargo_pep) || null;
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

  // ── Datos para búsqueda en listas ─────────────────────────────────────────────
  const datos_busqueda = {
    cedulas_a_buscar: [
      ...new Set(
        [
          coerceString(cedula?.numero_cedula),
          ...personas_vinculadas
            .map((p) => coerceString(p.documento))
            .filter(Boolean),
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
            .map((s) => coerceString(s.documento))
            .filter(Boolean),
          ...(dof?.vehiculos_interpuestos || [])
            .map(coerceString)
            .filter(Boolean),
        ].filter(Boolean),
      ),
    ],

    nombres_a_buscar: [
      ...new Set(
        personas_vinculadas.map((p) => coerceString(p.nombre)).filter(Boolean),
      ),
    ],

    razones_sociales_a_buscar: [
      ...new Set(
        [
          coerceString(camara?.razon_social),
          coerceString(rut?.razon_social),
          coerceString(camara?.nombre_comercial),
          ...(camara?.socios_o_accionistas || [])
            .filter((s) => s.tipo === "juridica")
            .map((s) => coerceString(s.nombre))
            .filter(Boolean),
        ].filter(Boolean),
      ),
    ],
  };

  // ── Alertas ────────────────────────────────────────────────────────────────────
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
    normalizar_texto(coerceString(camara.razon_social)) !==
      normalizar_texto(coerceString(rut.razon_social))
  )
    alertas.push({
      nivel: "MEDIO",
      mensaje: `Razón social difiere: Cámara ("${coerceString(camara.razon_social)}") vs RUT ("${coerceString(rut.razon_social)}")`,
    });

  if (cedula?.nombre_completo && camara?.representantes_legales?.length > 0) {
    const estaEnCamara = camara.representantes_legales.some((r) =>
      sonNombresSimilares(
        coerceString(r.nombre),
        coerceString(cedula.nombre_completo),
      ),
    );
    if (!estaEnCamara)
      alertas.push({
        nivel: "MEDIO",
        mensaje: `El titular de la cédula ("${coerceString(cedula.nombre_completo)}") no aparece como representante legal en la Cámara de Comercio`,
      });
  }

  if (cedula?.nombre_completo && dof?.beneficiarios_finales?.length > 0) {
    const estaEnDof = dof.beneficiarios_finales.some((b) =>
      sonNombresSimilares(
        coerceString(b.nombre_completo),
        coerceString(cedula.nombre_completo),
      ),
    );
    if (!estaEnDof)
      alertas.push({
        nivel: "INFO",
        mensaje: `El titular de la cédula ("${coerceString(cedula.nombre_completo)}") no figura como beneficiario final en el DOF`,
      });
  }

  if (
    cedula?.numero_cedula &&
    rut?.tipo_contribuyente === "natural" &&
    rut?.numero_documento
  ) {
    const cedulaNum = coerceString(cedula.numero_cedula).replace(/\D/g, "");
    const rutNum = coerceString(rut.numero_documento).replace(/\D/g, "");
    if (cedulaNum !== rutNum)
      alertas.push({
        nivel: "CRITICO",
        mensaje: `Número de cédula difiere: Cédula (${cedula.numero_cedula}) vs RUT (${rut.numero_documento})`,
      });
  }

  if (camara?.estado_matricula && camara.estado_matricula !== "ACTIVA")
    alertas.push({
      nivel: "CRITICO",
      mensaje: `Matrícula mercantil en estado: ${coerceString(camara.estado_matricula)}`,
    });

  if (rut?.estado_rut && rut.estado_rut !== "ACTIVO")
    alertas.push({
      nivel: "CRITICO",
      mensaje: `RUT en estado: ${coerceString(rut.estado_rut)}`,
    });

  if (cedula?.senales_alteracion?.length > 0)
    alertas.push({
      nivel: "CRITICO",
      mensaje: `Señales de posible alteración en la cédula: ${cedula.senales_alteracion.map(coerceString).join(" / ")}`,
    });

  const peps = personas_vinculadas.filter((p) => p.es_pep);
  if (peps.length > 0)
    alertas.push({
      nivel: "ALTO",
      mensaje: `PEP detectado(s): ${peps
        .map(
          (p) =>
            `${coerceString(p.nombre)} (${coerceString(p.cargo_pep) || "cargo no especificado"})`,
        )
        .join(", ")}`,
    });

  [
    { doc: cedula, fuente: "Cédula" },
    { doc: camara, fuente: "Cámara de Comercio" },
    { doc: rut, fuente: "RUT" },
    { doc: dof, fuente: "DOF" },
  ].forEach(({ doc, fuente }) => {
    (doc?.inconsistencias || []).forEach((inc) =>
      alertas.push({
        nivel: "INFO",
        mensaje: `[${fuente}] ${coerceString(inc)}`,
      }),
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

// ─── Endpoints individuales ───────────────────────────────────────────────────────
exports.analizarUnDocumento = async (req, res) => {
  const archivo = req.file;
  const tipo = req.body?.tipo;

  if (!archivo) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });
  if (!tipo || !PROMPTS[tipo]) return res.status(400).json({ ok: false, error: `Tipo de documento inválido: ${tipo}` });

  try {
    const datos = await analizarDocumentoConGroq(archivo.path, tipo, archivo.mimetype);
    if (!res.headersSent) res.json({ ok: true, campo: tipo, datos });
  } catch (err) {
    console.error(`❌ Error analizando ${tipo}:`, err.message);
    if (!res.headersSent) res.json({ ok: false, campo: tipo, error: err.message });
  } finally {
    try { if (fs.existsSync(archivo.path)) fs.unlinkSync(archivo.path); } catch {}
  }
};

exports.generarResumenEndpoint = (req, res) => {
  try {
    const { resultados } = req.body;
    if (!resultados) return res.status(400).json({ error: 'Falta el campo resultados' });
    const resumen = generarResumen(resultados);
    res.json(resumen);
  } catch (error) {
    console.error('❌ Error generando resumen:', error.message);
    res.status(500).json({ error: error.message });
  }
};

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
  const na = normalizar_texto(String(a));
  const nb = normalizar_texto(String(b));
  if (na === nb) return true;
  const palabrasA = na.split(" ").filter((p) => p.length > 2);
  const palabrasB = nb.split(" ").filter((p) => p.length > 2);
  const coincidencias = palabrasA.filter((p) => palabrasB.includes(p));
  return coincidencias.length >= 2;
}
