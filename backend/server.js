const express = require("express");
const cors = require("cors");
const app = express();

const jccController = require("./controllers/jcc.controller");
const regController = require("./controllers/registraduria.controller"); // Cuando lo retomes
const policiaController = require("./controllers/policia.controller");

app.use(cors());
app.use(express.json());

// Definición de Rutas Claras
app.post("/api/consulta-contador", jccController.consultarContador);
app.post("/api/consulta-cedula", regController.consultarCedula);
app.post("/api/consulta-antecedentes", policiaController.consultarAntecedentes);

app.listen(3001, () => console.log("Backend modular en puerto 3001"));
