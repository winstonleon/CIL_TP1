// /direccion — adjudicación de vacantes (G07, HU0012). El router se monta en app.ts detrás de verificarToken,
// requireRol("directora") y requirePersonalActivo (C22). Las rutas del dictamen pasan antes por la política de información
// restringida (R3, C58, montada en app.ts): la directora ve el informe psicológico con esta pantalla.
import { Router } from "express";
import type { Almacenamiento } from "../almacenamiento";
import type { DisparadorN8n } from "../orquestacion/n8n";
import { z } from "zod";
import type { FiltrosIndicadores } from "../repositories/indicadores";
import { adjudicarVacante, dictamenParaDireccion, informeParaDireccion, panelAdjudicacion } from "../services/adjudicacion";
import { fechaValida } from "../services/derechoAdmision";
import { calcularIndicadores, filtrosDeIndicadores } from "../services/indicadores";
import type { LineaBase } from "../services/lineaBase";
import { generarReporte, nombreReporte, TIPO_XLSX } from "../services/reporteIndicadores";
import { validar } from "../validacion";
import { enviarArchivo, esquemaVacio, idPersonalDe, idRuta } from "./validacion";

const camposFiltro = {
  campana: z.string().regex(/^[0-9A-Za-z-]{1,10}$/).optional(),
  id_grado: idRuta.optional(),
  desde: z.string().refine(fechaValida).optional(),
  hasta: z.string().refine(fechaValida).optional(),
};
const rangoOrdenado = (f: { desde?: string | undefined; hasta?: string | undefined }) => !f.desde || !f.hasta || f.desde <= f.hasta;
const esquemaFiltros = z.object(camposFiltro).strict().refine(rangoOrdenado, { path: ["desde"] });
const esquemaExportacion = z
  .object({ ...camposFiltro, formato: z.literal("xlsx") })
  .strict()
  .refine(rangoOrdenado, { path: ["desde"] });

function leerFiltros(q: z.infer<typeof esquemaFiltros>, campanaActiva: string): FiltrosIndicadores {
  return {
    campana: q.campana ?? campanaActiva,
    ...(q.id_grado === undefined ? {} : { idGrado: q.id_grado }),
    ...(q.desde === undefined ? {} : { desde: q.desde }),
    ...(q.hasta === undefined ? {} : { hasta: q.hasta }),
  };
}

export function rutasDireccion(campana: string, almacenamiento: Almacenamiento, eventos: DisparadorN8n, lineaBase: LineaBase): Router {
  const rutas = Router();

  // GET /direccion/adjudicacion → 200 { pendientes: [{ id_expediente, codigo, postulante, grado, dictamen, recibido,
  // sin_vacantes }], inventario: [{ id_grado, nivel, grado, autorizadas, adjudicadas, disponibles, lista_espera }] }
  rutas.get("/adjudicacion", async (_req, res) => {
    res.json(await panelAdjudicacion(campana));
  });

  // GET /direccion/expedientes/:id/dictamen («Ver dictamen») → 200 { …, dictamen, conclusiones, tiene_informe,
  // fecha_emision } y registra atencion_inicio · 404 · 409 ADJUDICACION_NO_CORRESPONDE
  rutas.get("/expedientes/:id/dictamen", async (req, res) => {
    res.json(await dictamenParaDireccion(validar(idRuta, req.params.id), await idPersonalDe(req)));
  });

  // GET /direccion/expedientes/:id/dictamen/informe → 200 archivo (R3, cabeceras de ADR-21) · 404 · 409
  rutas.get("/expedientes/:id/dictamen/informe", async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    const { formato, contenido } = await informeParaDireccion(almacenamiento, idExpediente);
    enviarArchivo(res, formato, `informe-${idExpediente}`, contenido);
  });

  // POST /direccion/expedientes/:id/adjudicacion {} → 200 { resultado: "vacante_asignada" } (HU0012-1.0) o
  // { resultado: "lista_espera", posicion } (HU0012-2.0) · 400 · 404 · 409 ADJUDICACION_NO_CORRESPONDE
  rutas.post("/expedientes/:id/adjudicacion", async (req, res) => {
    const idExpediente = validar(idRuta, req.params.id);
    validar(esquemaVacio, req.body ?? {});
    const { id_notificacion, ...cuerpo } = await adjudicarVacante(idExpediente, await idPersonalDe(req));
    res.json(cuerpo);
    // ADR-16: después del COMMIT y de responder; solo ids (C11). disparar() nunca rechaza.
    void eventos.disparar("agendamiento", { id_expediente: idExpediente, id_notificacion });
  });

  // Tablero de indicadores (HU0019, G08). Solo lectura: agregados y códigos de expediente.
  // GET /direccion/indicadores/filtros → 200 { campana_activa, campanas, grados: [{ id_grado, nivel, grado, campana }] }
  rutas.get("/indicadores/filtros", async (_req, res) => {
    res.json(await filtrosDeIndicadores(campana));
  });

  // GET /direccion/indicadores?campana=&id_grado=&desde=&hasta= → 200 { filtros, es_demo, tarjetas, embudo, etapas, vacantes,
  // avisos, expedientes, linea_base } · 400
  rutas.get("/indicadores", async (req, res) => {
    res.json(await calcularIndicadores(leerFiltros(validar(esquemaFiltros, req.query), campana), lineaBase));
  });

  // GET /direccion/indicadores/exportacion?…&formato=xlsx → 200 archivo adjunto (HU0019-2.0) · 400
  rutas.get("/indicadores/exportacion", async (req, res) => {
    const filtros = leerFiltros(validar(esquemaExportacion, req.query), campana);
    const contenido = await generarReporte(await calcularIndicadores(filtros, lineaBase));
    res.set({
      "Content-Type": TIPO_XLSX,
      "Content-Disposition": `attachment; filename="${nombreReporte(filtros.campana)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    res.send(contenido);
  });

  return rutas;
}
