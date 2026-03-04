const axios = require('axios');
const https = require('https');

// Agente para manejar el certificado SSL del puerto 8443 que suele ser problemático
const agent = new https.Agent({
  rejectUnauthorized: false,
});

exports.consultarCedula = async (req, res) => {
  const { cedula } = req.body;
  const urlRegistraduria =
    'https://defunciones.registraduria.gov.co:8443/VigenciaCedula/consulta';

  console.log(`--- Iniciando consulta Registraduría para: ${cedula} ---`);

  try {
    const response = await axios.post(
      urlRegistraduria,
      {
        nuip: cedula,
      },
      {
        httpsAgent: agent,
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'es-ES,es;q=0.9',
          Origin: 'https://defunciones.registraduria.gov.co:8443',
          Referer:
            'https://defunciones.registraduria.gov.co:8443/VigenciaCedula/consulta',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
      }
    );

    console.log('✅ Respuesta recibida de Registraduría');

    // Retornamos la data tal cual la entrega la Registraduría
    res.json({
      fuente: 'Registraduría Nacional',
      status: 'success',
      data: response.data,
    });
  } catch (error) {
    console.error('❌ ERROR REGISTRADURÍA:');

    if (error.code === 'ECONNRESET') {
      console.error(
        'MOTIVO: La conexión fue reseteada (Bloqueo de IP en StackBlitz).'
      );
    } else {
      console.error('MENSAJE:', error.message);
    }

    res.status(502).json({
      error: 'Error en la conexión con la Registraduría',
      detalle: error.code || error.message,
      nota: 'Si ves ECONNRESET en StackBlitz, es debido al firewall gubernamental.',
    });
  }
};
