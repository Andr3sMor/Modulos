const axios = require('axios');
const https = require('https');

const agent = new https.Agent({ rejectUnauthorized: false });

exports.consultarContador = async (req, res) => {
  const { cedula } = req.body;
  console.log(`--- Iniciando consulta JCC para: ${cedula} ---`);

  try {
    console.log('1. Intentando conectar con JCC (GET)...');
    const initialPage = await axios.get(
      'https://sgr.jcc.gov.co:8181/apex/f?p=138:1:::NO:::',
      {
        httpsAgent: agent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        }
      }
    );
    console.log('✅ Conexión inicial exitosa. Status:', initialPage.status);

    // Extraer cookies manualmente
    const cookies = initialPage.headers['set-cookie'];
    const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';

    const html = initialPage.data;
    const instanceMatch = html.match(/name="p_instance" value="([^"]+)"/);
    const pInstance = instanceMatch ? instanceMatch[1] : null;

    if (!pInstance) {
      console.error('❌ ERROR: No se encontró el token p_instance.');
      return res.status(500).json({ error: 'No se pudo obtener el token de sesión' });
    }
    console.log('✅ Token p_instance encontrado:', pInstance);

    console.log('3. Enviando formulario POST...');
    const params = new URLSearchParams();
    params.append('p_flow_id', '138');
    params.append('p_flow_step_id', '1');
    params.append('p_instance', pInstance);
    params.append('p_request', 'CONSULTAR');
    params.append('P1_NUMERO_DOCUMENTO', cedula);

    const response = await axios.post(
      'https://sgr.jcc.gov.co:8181/apex/wwv_flow.accept',
      params.toString(),
      {
        httpsAgent: agent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://sgr.jcc.gov.co:8181/apex/f?p=138:1:::NO:::',
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
      }
    );

    console.log('✅ Respuesta del POST recibida.');
    const esContador = response.data.includes('CONTADOR PÚBLICO');
    res.json({ esContador, documento: cedula });

  } catch (error) {
    console.error('❌ ERROR DETECTADO:');
    console.error('MENSAJE:', error.message);
    res.status(502).json({ error: 'Fallo en la comunicación', detalle: error.message });
  }
};
