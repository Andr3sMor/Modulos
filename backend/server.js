const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const os = require("os");
const app = express();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`Formato no soportado: ${file.mimetype}. Use PDF, JPG o PNG.`));
    }
  }
});

const jccController = require("./controllers/jcc.controller");
const regController = require("./controllers/registraduria.controller");
const policiaController = require("./controllers/policia.controller");
const offshoreController = require("./controllers/offshore.controller");
const procuraduriaController = require("./controllers/procuraduria.controller");
const geminiController = require("./controllers/gemini.controller");
const ramaJudicialController = require("./controllers/rama_judicial.controller");
const contraloriaController = require("./controllers/contraloria.controller");
const supersociedadesController = require("./controllers/supersociedades.controller");
const pacoController = require("./controllers/paco.controller");
const infobaeController = require("./controllers/infobae.controller");
const documentosController = require("./controllers/documentos.controller");

const corsOptions = {
  origin: [
    "https://andr3smor.github.io",
    "http://localhost:4200",
    "http://localhost:3000",
    "http://localhost:3001",
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// ─── Semáforo de concurrencia ──────────────────────────────────────────────────
class Semaforo {
  constructor(limite) {
    this.limite = limite;
    this.cola = [];
    this.activos = 0;
  }
  adquirir() {
    if (this.activos < this.limite) {
      this.activos++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.cola.push(resolve));
  }
  liberar() {
    this.activos = Math.max(0, this.activos - 1);
    if (this.cola.length > 0) {
      const siguiente = this.cola.shift();
      this.activos++;
      siguiente();
    }
  }
}

const semaforoBrowser = new Semaforo(1);

function conSemaforo(controlador) {
  return async (req, res) => {
    console.log(
      `[Semáforo] Cola: ${semaforoBrowser.cola.length} | Activos: ${semaforoBrowser.activos}`,
    );
    await semaforoBrowser.adquirir();
    try {
      await controlador(req, res);
    } finally {
      semaforoBrowser.liberar();
    }
  };
}

function conTimeout(controlador, ms = 120000) {
  return async (req, res) => {
    let respondido = false;
    const timer = setTimeout(() => {
      if (!respondido && !res.headersSent) {
        respondido = true;
        console.error(`[Timeout] Request tardó más de ${ms / 1000}s`);
        res.status(504).json({
          error: "Timeout",
          detalle: `La consulta tardó más de ${ms / 1000} segundos y fue cancelada.`,
        });
      }
    }, ms);

    const resOriginal = res.json.bind(res);
    res.json = (...args) => {
      respondido = true;
      clearTimeout(timer);
      return resOriginal(...args);
    };

    try {
      await controlador(req, res);
    } catch (e) {
      if (!respondido && !res.headersSent) {
        res.status(500).json({ error: "Error inesperado", detalle: e.message });
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

// ─── Rutas sin Puppeteer ───────────────────────────────────────────────────────
app.post("/api/consulta-contador", jccController.consultarContador);
app.post("/api/consulta-cedula", regController.consultarCedula);
app.post("/api/consulta-offshore", offshoreController.consultarOffshore);
app.post("/api/buscar-persona-ia", geminiController.buscarPersonaConIA);
app.post(
  "/api/consulta-contraloria",
  contraloriaController.consultarContraloria,
);
app.post(
  "/api/consulta-supersociedades",
  supersociedadesController.consultarSociedades,
);
app.post(
  "/api/consulta-supersociedades-nit",
  supersociedadesController.consultarDetallePorNit,
);
app.post("/api/consulta-paco", pacoController.consultarPACO);

// ─── Rutas Policía ─────────────────────────────────────────────────────────────
// Primera llamada y segunda llamada (con token) — con semáforo
app.post(
  "/api/consulta-antecedentes",
  conTimeout(conSemaforo(policiaController.consultarAntecedentes), 150000),
);
// SSE — SIN semáforo ni timeout (es una conexión larga de escucha)
app.get("/api/captcha-status/:sessionId", policiaController.captchaStatus);
// Página bridge: popup que abre el usuario para resolver el captcha
app.get(
  "/api/policia-captcha-bridge/:sessionId",
  policiaController.captchaBridge,
);
// Confirmación manual del captcha
app.post(
  "/api/policia-captcha-confirmado/:sessionId",
  policiaController.captchaConfirmado,
);
// Bridge page pregunta si la sesión ya fue resuelta
app.get("/api/captcha-resuelto/:sessionId", policiaController.captchaResuelto);

// ─── Rutas con Puppeteer ───────────────────────────────────────────────────────
app.post(
  "/api/consulta-procuraduria",
  conTimeout(conSemaforo(procuraduriaController.consultarProcuraduria), 120000),
);
app.post(
  "/api/consulta-rama-judicial",
  conTimeout(conSemaforo(ramaJudicialController.consultarRamaJudicial), 90000),
);
app.post("/api/consulta-infobae", infobaeController.consultarInfobae);
app.post(
  "/api/analizar-documentos",
  upload.fields([
    { name: 'camara_comercio', maxCount: 1 },
    { name: 'dof', maxCount: 1 },
    { name: 'cedula', maxCount: 1 },
    { name: 'rut', maxCount: 1 },
  ]),
  documentosController.analizarDocumentos
);

app.listen(3001, () => console.log("✅ Backend en puerto 3001"));
