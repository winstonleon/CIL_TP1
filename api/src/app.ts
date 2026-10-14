import express, { type Express } from "express";
import { requireRol } from "./auth/requireRol";
import { crearVerificarToken, opcionesTokenDesdeConfig, type OpcionesToken } from "./auth/verificarToken";
import { manejadorErrores, noEncontrado } from "./errores";
import { crearKeycloakAdminDesdeConfig, type IdentidadAdmin } from "./identidad/keycloakAdmin";
import { rutasInternas } from "./routes/internal";
import { rutasPersonal } from "./routes/personal";
import { rutaSalud } from "./routes/salud";

// Dependencias externas inyectables: las pruebas usan un JWKS local y un Keycloak simulado.
export interface Dependencias {
  opcionesToken?: OpcionesToken;
  identidad?: IdentidadAdmin;
}

export function crearApp(dependencias: Dependencias = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  const verificarToken = crearVerificarToken(dependencias.opcionesToken ?? opcionesTokenDesdeConfig());
  const identidad = dependencias.identidad ?? crearKeycloakAdminDesdeConfig();

  app.use(rutaSalud);
  app.use("/internal", rutasInternas);
  // Las rutas de cada HU se montan con verificarToken y el rol que exigen.
  app.use("/personal", verificarToken, requireRol("directora"), rutasPersonal(identidad));

  app.use(noEncontrado);
  app.use(manejadorErrores);
  return app;
}
