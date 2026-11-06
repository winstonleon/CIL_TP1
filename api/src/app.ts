import express, { type Express } from "express";
import { crearAlmacenamientoDesdeConfig, type Almacenamiento } from "./almacenamiento";
import { requirePersonalActivo } from "./auth/requirePersonalActivo";
import { requireRol } from "./auth/requireRol";
import { crearVerificarToken, opcionesTokenDesdeConfig, type OpcionesToken } from "./auth/verificarToken";
import { obtenerConfig } from "./config";
import { manejadorErrores, noEncontrado } from "./errores";
import { crearKeycloakAdminDesdeConfig, ROLES_PERSONAL, type IdentidadAdmin } from "./identidad/keycloakAdmin";
import { LIMITE_LECTURA_VISITA, LIMITE_PUBLICO, type OpcionesLimite } from "./limitePorIp";
import { crearDisparadorN8nDesdeConfig, type DisparadorN8n } from "./orquestacion/n8n";
import { requireAccesoRestringido } from "./auth/accesoRestringido";
import { rutasBandeja } from "./routes/bandeja";
import { rutasEvaluacionAcademica } from "./routes/evaluacionAcademica";
import { rutasPsicologia } from "./routes/psicologia";
import { rutaCampanaActiva } from "./routes/campana";
import { rutasConfiguracion } from "./routes/configuracion";
import { rutasDireccion } from "./routes/direccion";
import { rutasFamilia } from "./routes/familia";
import { rutasInternas } from "./routes/internal";
import { rutasPersonal } from "./routes/personal";
import { rutasProspectos } from "./routes/prospectos";
import { rutasPublicas } from "./routes/publico";
import { rutaSalud } from "./routes/salud";
import { rutasTesoreria } from "./routes/tesoreria";
import { rutasVisitas } from "./routes/visitas";

// Dependencias externas inyectables: las pruebas usan un JWKS local, un Keycloak simulado, su propia campaña,
// un n8n simulado y sus propios límites de las rutas públicas.
export interface Dependencias {
  opcionesToken?: OpcionesToken;
  identidad?: IdentidadAdmin;
  campanaActiva?: string;
  eventos?: DisparadorN8n;
  limitePublico?: OpcionesLimite;
  limiteLecturaVisita?: OpcionesLimite;
  // Almacenamiento de los archivos (HU0006 y HU0007): las pruebas usan un directorio temporal.
  almacenamiento?: Almacenamiento;
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
  const almacenamiento = dependencias.almacenamiento ?? crearAlmacenamientoDesdeConfig();

  app.use(rutaSalud);
  app.use("/internal", rutasInternas(identidad));
  // PÚBLICAS a propósito (ADR-17): P01 y P02 no tienen sesión. Sin verificarToken ni rol.
  app.use(
    "/publico",
    rutasPublicas({
      campana: campanaActiva,
      eventos,
      limite: dependencias.limitePublico ?? LIMITE_PUBLICO,
      limiteLecturaVisita: dependencias.limiteLecturaVisita ?? LIMITE_LECTURA_VISITA,
    }),
  );
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
  // Portal de la familia (HU0005): solo el rol familia, y solo su propio expediente (ADR-20).
  app.use("/familia", verificarToken, requireRol("familia"), rutasFamilia(almacenamiento, eventos, campanaActiva));
  app.use("/configuracion", verificarToken, requireRol("secretaria"), requirePersonalActivo("secretaria"), rutasConfiguracion(campanaActiva));
  app.use("/prospectos", verificarToken, requireRol("secretaria"), requirePersonalActivo("secretaria"), rutasProspectos(campanaActiva));
  app.use(
    "/visitas",
    verificarToken,
    requireRol("secretaria"),
    requirePersonalActivo("secretaria"),
    rutasVisitas(campanaActiva, identidad, eventos),
  );
  // Validaciones en paralelo (HU0008, HU0011 y HU0024): G02 y G03 de Secretaría, G05 de Tesorería.
  app.use(
    "/bandeja",
    verificarToken,
    requireRol("secretaria"),
    requirePersonalActivo("secretaria"),
    rutasBandeja(campanaActiva, almacenamiento, eventos),
  );
  app.use(
    "/tesoreria",
    verificarToken,
    requireRol("tesoreria"),
    requirePersonalActivo("tesoreria"),
    rutasTesoreria(campanaActiva, almacenamiento, eventos),
  );
  // Resultados de las evaluaciones y dictamen (HU0010 y HU0025, ADR-25). Todo G06 expone información del informe
  // psicológico (resultados, conclusiones e informe): la política de R3 va antes del rol, así cualquier otro rol recibe
  // 403 auditado con `detalle.recurso` (HU0021-2.0, C17); después, solo la psicóloga activa (la directora ve el informe en
  // G07, por /direccion).
  app.use(
    "/psicologia",
    verificarToken,
    requireAccesoRestringido("informe_psicologico", { obtenerIdExpediente: (req) => /^\/expedientes\/(\d+)(?:\/|$)/.exec(req.path)?.[1] }),
    requireRol("psicologa"),
    requirePersonalActivo("psicologa"),
    rutasPsicologia(almacenamiento, eventos),
  );
  app.use(
    "/evaluacion-academica",
    verificarToken,
    requireRol("evaluador_academico"),
    requirePersonalActivo("evaluador_academico"),
    rutasEvaluacionAcademica(eventos),
  );
  // Adjudicación de vacantes (HU0012, G07). El dictamen expone el informe psicológico (R3, C58): su política va antes del rol,
  // como en G06, así otro rol recibe 403 auditado con `detalle.recurso` y el expediente (HU0021-2.0, C17).
  app.use(
    "/direccion/expedientes/:id/dictamen",
    verificarToken,
    requireAccesoRestringido("informe_psicologico", { obtenerIdExpediente: (req) => req.params.id }),
  );
  app.use(
    "/direccion",
    verificarToken,
    requireRol("directora"),
    requirePersonalActivo("directora"),
    rutasDireccion(campanaActiva, almacenamiento, eventos),
  );

  app.use(noEncontrado);
  app.use(manejadorErrores);
  return app;
}
