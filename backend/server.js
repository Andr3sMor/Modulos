const express = require("express");
const cors = require("cors");
const app = express();

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

const corsOptions = {
  origin: [
    "https://andr3smor.github.io",
    "http://localhost:4200",
    "http://localhost:3001",
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// ─── Semáforo de concurrencia ──────────────────────────────────────────────────
// Limita el número de instancias de Chromium/Puppeteer ejecutándose
// simultáneamente para evitar agotamiento de memoria y recursos del servidor.
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

// Solo 1 browser activo a la vez para endpoints que usan Puppeteer/Chromium
const semaforoBrowser = new Semaforo(1);

// ─── Wrappers de control ───────────────────────────────────────────────────────

/**
 * Limita la concurrencia de controladores que usan Puppeteer.
 * Requests adicionales esperan en cola hasta que el slot quede libre.
 */
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

/**
 * Agrega un timeout máximo por request.
 * Si el controlador no responde en `ms` milisegundos, devuelve 504.
 */
function conTimeout(controlador, ms = 120000) {
  return async (req, res) => {
    let respondido = false;

    const timer = setTimeout(() => {
      if (!respondido && !res.headersSent) {
        respondido = true;
        console.error(
          `[Timeout] Request tardó más de ${ms / 1000}s — abortando`,
        );
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

// ─── Rutas ─────────────────────────────────────────────────────────────────────

// Rutas sin Puppeteer — sin restricción de concurrencia
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

// Rutas con Puppeteer — serializar con semáforo + timeout
app.post(
  "/api/consulta-antecedentes",
  conTimeout(conSemaforo(policiaController.consultarAntecedentes), 150000),
);
app.post(
  "/api/consulta-procuraduria",
  conTimeout(conSemaforo(procuraduriaController.consultarProcuraduria), 120000),
);
app.post(
  "/api/consulta-rama-judicial",
  conTimeout(conSemaforo(ramaJudicialController.consultarRamaJudicial), 90000),
);

app.listen(3001, () => console.log("✅ Backend en puerto 3001"));
