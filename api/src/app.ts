import express, { type Express } from "express";
import { requireRol } from "./auth/requireRol";
import { crearVerificarToken, opcionesTokenDesdeConfig, type OpcionesToken } from "./auth/verificarToken";
import { obtenerConfig } from "./config";
import { manejadorErrores, noEncontrado } from "./errores";
import { crearKeycloakAdminDesdeConfig, ROLES_PERSONAL, type IdentidadAdmin } from "./identidad/keycloakAdmin";
import { rutaCampanaActiva } from "./routes/campana";
import { rutasConfiguracion } from "./routes/configuracion";
import { rutasInternas } from "./routes/internal";
import { rutasPersonal } from "./routes/personal";
import { rutaSalud } from "./routes/salud";

// Dependencias externas inyectables: las pruebas usan un JWKS local, un Keycloak simulado y su propia campaña.
export interface Dependencias {
  opcionesToken?: OpcionesToken;
  identidad?: IdentidadAdmin;
  campanaActiva?: string;
}

export function crearApp(dependencias: Dependencias = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  const verificarToken = crearVerificarToken(dependencias.opcionesToken ?? opcionesTokenDesdeConfig());
  const identidad = dependencias.identidad ?? crearKeycloakAdminDesdeConfig();
  const campanaActiva = dependencias.campanaActiva ?? obtenerConfig().CAMPANA_ACTIVA;

  app.use(rutaSalud);
  app.use("/internal", rutasInternas);
  // Las rutas de cada HU se montan con verificarToken y el rol que exigen.
  app.use("/personal", verificarToken, requireRol("directora"), rutasPersonal(identidad));
  app.use("/campana-activa", verificarToken, requireRol(...ROLES_PERSONAL), rutaCampanaActiva(campanaActiva));
  app.use("/configuracion", verificarToken, requireRol("secretaria"), rutasConfiguracion(campanaActiva));

  app.use(noEncontrado);
  app.use(manejadorErrores);
  return app;
}
