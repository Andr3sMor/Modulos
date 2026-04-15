const Groq = require('groq-sdk');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PROMPTS = {
  camara_comercio: `Eres un experto en documentos legales colombianos. Analiza esta imagen de una Cámara de Comercio y extrae EXACTAMENTE la siguiente información en formato JSON:
{
  "razon_social": "nombre completo de la empresa",
  "nit": "número de NIT con dígito verificador",
  "tipo_sociedad": "tipo de sociedad (SAS, LTDA, etc)",
  "representantes_legales": ["nombre completo del representante 1", "nombre completo del representante 2"],
  "fecha_matricula": "fecha de matrícula",
  "fecha_renovacion": "fecha de última renovación",
  "domicilio": "ciudad/municipio",
  "objeto_social": "descripción breve del objeto social",
  "capital_suscrito": "valor del capital suscrito",
  "estado": "estado de la matrícula (activa/cancelada)",
  "inconsistencias": ["lista de posibles inconsistencias o campos ilegibles"],
  "confianza": "porcentaje de confianza en la extracción (0-100)"
}
Si un campo no es visible o no aplica, usa null. Responde SOLO con el JSON, sin explicaciones adicionales.`,

  dof: `Eres un experto en documentos legales colombianos. Analiza esta imagen de un Documento de Origen/DOF y extrae EXACTAMENTE la siguiente información en formato JSON:
{
  "nombre_titular": "nombre completo del titular",
  "documento_identidad": "número de documento",
  "tipo_documento": "tipo de documento",
  "cargo": "cargo o función",
  "entidad": "entidad que expide",
  "fecha_expedicion": "fecha de expedición del documento",
  "fecha_vencimiento": "fecha de vencimiento si aplica",
  "beneficiarios_finales": ["nombre y % participación de beneficiario 1", "nombre y % participación de beneficiario 2"],
  "inconsistencias": ["lista de posibles inconsistencias o campos ilegibles"],
  "confianza": "porcentaje de confianza en la extracción (0-100)"
}
Si un campo no es visible o no aplica, usa null. Responde SOLO con el JSON, sin explicaciones adicionales.`,

  cedula: `Eres un experto en documentos de identidad colombianos. Analiza esta imagen de una Cédula de Ciudadanía y extrae EXACTAMENTE la siguiente información en formato JSON:
{
  "nombre_completo": "nombre completo tal como aparece en el documento",
  "primer_apellido": "primer apellido",
  "segundo_apellido": "segundo apellido o null",
  "primer_nombre": "primer nombre",
  "segundo_nombre": "segundo nombre o null",
  "numero_cedula": "número de cédula sin puntos ni espacios",
  "fecha_nacimiento": "fecha de nacimiento",
  "lugar_nacimiento": "ciudad y departamento de nacimiento",
  "fecha_expedicion": "fecha de expedición",
  "lugar_expedicion": "lugar de expedición",
  "sexo": "M o F",
  "grupo_sanguineo": "grupo sanguíneo y RH si visible",
  "inconsistencias": ["lista de posibles inconsistencias, campos ilegibles o señales de alteración"],
  "confianza": "porcentaje de confianza en la extracción (0-100)"
}
Si un campo no es visible o no aplica, usa null. Responde SOLO con el JSON, sin explicaciones adicionales.`,

  rut: `Eres un experto en documentos tributarios colombianos. Analiza esta imagen de un RUT (Registro Único Tributario) y extrae EXACTAMENTE la siguiente información en formato JSON:
{
  "nit": "número de NIT con dígito verificador",
  "razon_social": "razón social o nombre del contribuyente",
  "nombre_comercial": "nombre comercial si aplica",
  "tipo_contribuyente": "natural o jurídica",
  "codigo_actividad_economica": "código CIIU principal",
  "descripcion_actividad": "descripción de la actividad económica principal",
  "responsabilidades": ["lista de responsabilidades tributarias (códigos)"],
  "fecha_inscripcion": "fecha de inscripción en el RUT",
  "fecha_actualizacion": "fecha de última actualización",
  "direccion": "dirección fiscal completa",
  "municipio": "municipio",
  "departamento": "departamento",
  "telefono": "teléfono de contacto",
  "email": "correo electrónico si visible",
  "estado": "estado del RUT (activo/suspendido/cancelado)",
  "inconsistencias": ["lista de posibles inconsistencias o campos ilegibles"],
  "confianza": "porcentaje de confianza en la extracción (0-100)"
}
Si un campo no es visible o no aplica, usa null. Responde SOLO con el JSON, sin explicaciones adicionales.`
};

const MIME_IMAGENES = {
  'image/jpeg': 'image/jpeg',
  'image/jpg':  'image/jpeg',
  'image/png':  'image/png',
  'image/webp': 'image/webp',
  'image/gif':  'image/gif',
};

async function extraerTextoPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text?.trim() || '';
}

async function analizarDocumentoConGroq(filePath, tipoDocumento, mimeType) {
  const prompt = PROMPTS[tipoDocumento];
  if (!prompt) throw new Error(`Tipo de documento desconocido: ${tipoDocumento}`);

  if (!fs.existsSync(filePath)) {
    throw new Error('No se pudo leer el archivo subido.');
  }

  const fileBuffer = fs.readFileSync(filePath);
  if (fileBuffer.length === 0) {
    throw new Error('El archivo está vacío.');
  }

  const mime = mimeType?.toLowerCase();
  let completion;

  if (mime === 'application/pdf') {
    console.log(`📄 Extrayendo texto del PDF: ${tipoDocumento}`);
    const textoPdf = await extraerTextoPdf(filePath);

    if (!textoPdf || textoPdf.length < 20) {
      throw new Error('No se pudo extraer texto del PDF. Puede ser un PDF escaneado (imagen). Por favor suba una foto clara del documento.');
    }

    const promptTexto = prompt.replace(
      'Analiza esta imagen de',
      'Analiza el siguiente texto extraído de'
    ).replace(
      'Eres un experto en documentos legales colombianos. Analiza esta imagen de',
      'Eres un experto en documentos legales colombianos. Analiza el siguiente texto de'
    ).replace(
      'Eres un experto en documentos de identidad colombianos. Analiza esta imagen de',
      'Eres un experto en documentos de identidad colombianos. Analiza el siguiente texto de'
    ).replace(
      'Eres un experto en documentos tributarios colombianos. Analiza esta imagen de',
      'Eres un experto en documentos tributarios colombianos. Analiza el siguiente texto de'
    );

    completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'user',
          content: `${promptTexto}\n\nTEXTO DEL DOCUMENTO:\n${textoPdf}`
        }
      ],
      temperature: 0.1,
      max_tokens: 2048
    });

  } else if (MIME_IMAGENES[mime]) {
    console.log(`🖼️ Analizando imagen: ${tipoDocumento}`);
    const base64Image = fileBuffer.toString('base64');
    const mimeParaGroq = MIME_IMAGENES[mime];

    completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeParaGroq};base64,${base64Image}` }
            },
            { type: 'text', text: prompt }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 2048
    });

  } else {
    throw new Error(`Formato no soportado: ${mimeType}. Use PDF, JPG o PNG.`);
  }

  const rawContent = completion.choices[0]?.message?.content || '{}';
  
  // Extraer JSON de la respuesta
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('La IA no devolvió un JSON válido');
  
  return JSON.parse(jsonMatch[0]);
}

exports.analizarDocumentos = async (req, res) => {
  try {
    const archivos = req.files;
    if (!archivos || Object.keys(archivos).length === 0) {
      return res.status(400).json({ error: 'No se recibieron documentos' });
    }

    console.log('📄 Analizando documentos:', Object.keys(archivos));

    const resultados = {};
    const promesas = [];

    for (const [campo, fileArray] of Object.entries(archivos)) {
      const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;
      const tipoDocumento = campo; // camara_comercio, dof, cedula, rut

      promesas.push(
        (async () => {
          try {
            const datos = await analizarDocumentoConGroq(file.path, tipoDocumento, file.mimetype);
            resultados[campo] = { ok: true, datos };
          } catch (err) {
            console.error(`❌ Error analizando ${campo}:`, err.message);
            resultados[campo] = { ok: false, error: err.message };
          } finally {
            // Eliminar archivo temporal
            try { fs.unlinkSync(file.path); } catch {}
          }
        })()
      );
    }

    await Promise.all(promesas);

    // Generar resumen consolidado
    const resumen = generarResumen(resultados);

    res.json({ resultados, resumen });
  } catch (error) {
    console.error('❌ Error general en análisis de documentos:', error.message);
    res.status(500).json({ error: 'Error al procesar los documentos', detalle: error.message });
  }
};

function generarResumen(resultados) {
  const cedula = resultados.cedula?.datos;
  const camara = resultados.camara_comercio?.datos;
  const rut = resultados.rut?.datos;
  const dof = resultados.dof?.datos;

  // Nombre: preferir cédula
  let nombre = null;
  if (cedula?.nombre_completo) nombre = cedula.nombre_completo;
  else if (dof?.nombre_titular) nombre = dof.nombre_titular;

  // Razón social: cámara o RUT
  let razon_social = camara?.razon_social || rut?.razon_social || null;

  // Representantes legales: cámara de comercio
  let representantes_legales = camara?.representantes_legales || [];

  // Beneficiario final: DOF
  let beneficiarios_finales = dof?.beneficiarios_finales || [];

  // Código RUT
  let codigo_rut = rut?.codigo_actividad_economica || null;
  let descripcion_actividad = rut?.descripcion_actividad || null;
  let nit = rut?.nit || camara?.nit || null;

  // Inconsistencias cruzadas entre documentos
  const inconsistencias_cruzadas = [];

  // Verificar que NIT de cámara y RUT coincidan
  if (camara?.nit && rut?.nit && camara.nit !== rut.nit) {
    inconsistencias_cruzadas.push(`⚠️ El NIT en la Cámara de Comercio (${camara.nit}) no coincide con el del RUT (${rut.nit})`);
  }

  // Verificar que razón social sea consistente
  if (camara?.razon_social && rut?.razon_social) {
    const norm = (s) => s?.toLowerCase().trim().replace(/\s+/g, ' ');
    if (norm(camara.razon_social) !== norm(rut.razon_social)) {
      inconsistencias_cruzadas.push(`⚠️ La razón social difiere entre Cámara de Comercio ("${camara.razon_social}") y RUT ("${rut.razon_social}")`);
    }
  }

  // Verificar representante vs cédula
  if (cedula?.nombre_completo && camara?.representantes_legales?.length > 0) {
    const nombreCedula = cedula.nombre_completo.toLowerCase().trim();
    const coincide = camara.representantes_legales.some(r =>
      r.toLowerCase().includes(nombreCedula.split(' ')[0]) ||
      nombreCedula.includes(r.toLowerCase().split(' ')[0])
    );
    if (!coincide) {
      inconsistencias_cruzadas.push(`⚠️ El titular de la cédula ("${cedula.nombre_completo}") no aparece como representante legal en la Cámara de Comercio`);
    }
  }

  return {
    nombre,
    razon_social,
    representantes_legales,
    beneficiarios_finales,
    codigo_rut,
    descripcion_actividad,
    nit,
    inconsistencias_cruzadas,
    documentos_analizados: Object.keys(resultados).filter(k => resultados[k].ok)
  };
}
