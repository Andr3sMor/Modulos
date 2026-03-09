const express = require("express");
const cors = require("cors");
const app = express();

const jccController = require("./controllers/jcc.controller");
const regController = require("./controllers/registraduria.controller");
const policiaController = require("./controllers/policia.controller");
const offshoreController = require("./controllers/offshore.controller");

// DEBUG - identificar cual controlador falla
console.log("jcc.consultarContador:", typeof jccController.consultarContador);
console.log("reg.consultarCedula:", typeof regController.consultarCedula);
console.log(
  "policia.consultarAntecedentes:",
  typeof policiaController.consultarAntecedentes,
);
console.log(
  "offshore.consultarOffshore:",
  typeof offshoreController.consultarOffshore,
);

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
app.post("/api/resolver-captcha", policiaController.resolverCaptcha);
app.post("/api/consulta-offshore", offshoreController.consultarOffshore);

app.listen(3001, () => console.log("Backend en puerto 3001"));
