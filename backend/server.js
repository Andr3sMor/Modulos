const express = require("express");
const cors = require("cors");
const app = express();

const jccController = require("./controllers/jcc.controller");
const regController = require("./controllers/registraduria.controller");
const policia = require("./controllers/policia.controller");

app.use(cors());
app.use(express.json());

// Registraduría y JCC
app.post("/api/consulta-contador", jccController.consultarContador);
app.post("/api/consulta-cedula", regController.consultarCedula);

// Policía — flujo en 4 pasos
app.post("/api/policia/iniciar", policia.iniciar);
app.get("/api/policia/screenshot/:id", policia.screenshot);
app.get("/api/policia/status/:id", policia.status);
app.post("/api/policia/clic/:id", policia.clic);

app.listen(3001, () => console.log("Backend en puerto 3001"));
