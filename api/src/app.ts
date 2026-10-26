import express, { type Express } from "express";
import { requirePersonalActivo } from "./auth/requirePersonalActivo";
import { requireRol } from "./auth/requireRol";
import { crearVerificarToken, opcionesTokenDesdeConfig, type OpcionesToken } from "./auth/verificarToken";
import { obtenerConfig } from "./config";
import { manejadorErrores, noEncontrado } from "./errores";
import { crearKeycloakAdminDesdeConfig, ROLES_PERSONAL, type IdentidadAdmin } from "./identidad/keycloakAdmin";
import { LIMITE_PUBLICO, type OpcionesLimite } from "./limitePorIp";
import { crearDisparadorN8nDesdeConfig, type DisparadorN8n } from "./orquestacion/n8n";
import { rutaCampanaActiva } from "./routes/campana";
import { rutasConfiguracion } from "./routes/configuracion";
import { rutasInternas } from "./routes/internal";
import { rutasPersonal } from "./routes/personal";
import { rutasProspectos } from "./routes/prospectos";
import { rutasPublicas } from "./routes/publico";
import { rutaSalud } from "./routes/salud";

// Dependencias externas inyectables: las pruebas usan un JWKS local, un Keycloak simulado, su propia campaña,
// un n8n simulado y sus propios límites de las rutas públicas.
export interface Dependencias {
  opcionesToken?: OpcionesToken;
  identidad?: IdentidadAdmin;
  campanaActiva?: string;
  eventos?: DisparadorN8n;
  limitePublico?: OpcionesLimite;
}

export function crearApp(dependencias: Dependencias = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  // Hay un solo proxy delante de la API (NGINX en prod, Vite en dev): req.ip es la IP que ese proxy informa en
  // X-Forwarded-For. La usa el límite por IP de las rutas públicas (ADR-17).
  app.set("trust proxy", 1);
  // Las rutas públicas aceptan como máximo 4 kB (ADR-17). Este parser va antes del global, que ya no relee el cuerpo.
  app.use("/publico", express.json({ limit: "4kb" }));
  app.use(express.json({ limit: "100kb" }));

  const verificarToken = crearVerificarToken(dependencias.opcionesToken ?? opcionesTokenDesdeConfig());
  const identidad = dependencias.identidad ?? crearKeycloakAdminDesdeConfig();
  const campanaActiva = dependencias.campanaActiva ?? obtenerConfig().CAMPANA_ACTIVA;
  const eventos = dependencias.eventos ?? crearDisparadorN8nDesdeConfig();

  app.use(rutaSalud);
  app.use("/internal", rutasInternas);
  // PÚBLICAS a propósito (ADR-17): P01 no tiene sesión. Sin verificarToken ni rol.
  app.use("/publico", rutasPublicas({ campana: campanaActiva, eventos, limite: dependencias.limitePublico ?? LIMITE_PUBLICO }));
  // Las rutas de cada HU se montan con verificarToken y el rol que exigen. Las del personal llevan además
  // requirePersonalActivo con los mismos roles: fila activa en personal con el rol del token (C22).
  app.use("/personal", verificarToken, requireRol("directora"), requirePersonalActivo("directora"), rutasPersonal(identidad));
  app.use(
    "/campana-activa",
    verificarToken,
    requireRol(...ROLES_PERSONAL),
    requirePersonalActivo(...ROLES_PERSONAL),
    rutaCampanaActiva(campanaActiva),
  );
  app.use("/configuracion", verificarToken, requireRol("secretaria"), requirePersonalActivo("secretaria"), rutasConfiguracion(campanaActiva));
  app.use("/prospectos", verificarToken, requireRol("secretaria"), requirePersonalActivo("secretaria"), rutasProspectos(campanaActiva));

  app.use(noEncontrado);
  app.use(manejadorErrores);
  return app;
}
