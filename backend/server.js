const express = require("express");
const cors = require("cors");
const app = express();

const jccController = require("./controllers/jcc.controller");
const regController = require("./controllers/registraduria.controller");
const policiaController = require("./controllers/policia.controller");
const offshoreController = require("./controllers/offshore.controller");
const procuraduriaController = require("./controllers/procuraduria.controller");
const geminiController = require("./controllers/gemini.controller");

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

app.listen(3001, () => console.log("✅ Backend en puerto 3001"));
