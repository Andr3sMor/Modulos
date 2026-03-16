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

app.post("/api/consulta-contador", jccController.consultarContador);
app.post("/api/consulta-cedula", regController.consultarCedula);
app.post("/api/consulta-antecedentes", policiaController.consultarAntecedentes);
app.post("/api/consulta-offshore", offshoreController.consultarOffshore);
app.post(
  "/api/consulta-procuraduria",
  procuraduriaController.consultarProcuraduria,
);
app.post("/api/buscar-persona-ia", geminiController.buscarPersonaConIA);
app.post(
  "/api/consulta-rama-judicial",
  ramaJudicialController.consultarRamaJudicial,
);
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

app.listen(3001, () => console.log("✅ Backend en puerto 3001"));
