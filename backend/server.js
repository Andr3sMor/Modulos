const express = require("express");
const cors = require("cors");
const app = express();

const jccController = require("./controllers/jcc.controller");
const regController = require("./controllers/registraduria.controller");
const policiaController = require("./controllers/policia.controller");

// CORS - permitir GitHub Pages y desarrollo local
app.use(
  cors({
    origin: [
      "https://andr3smor.github.io",
      "http://localhost:4200",
      "http://localhost:3001",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Responder preflight OPTIONS
app.options("*", cors());

app.use(express.json());

app.post("/api/consulta-contador", jccController.consultarContador);
app.post("/api/consulta-cedula", regController.consultarCedula);
app.post("/api/consulta-antecedentes", policiaController.consultarAntecedentes);

app.listen(3001, () => console.log("Backend en puerto 3001"));
