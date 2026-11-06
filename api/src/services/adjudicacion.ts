// Adjudicación de la vacante (HU0012, G07; R14): la directora decide sobre un expediente en `apto`. Una sola acción: con el
// expediente y la fila del grado bloqueados, si hay cupo descuenta 1 y pasa a `vacante_asignada`; si no, pasa a
// `lista_espera` con su posición (HU0012-2.0). Así, dos adjudicaciones al último cupo no lo venden dos veces: la segunda
// ve 0 y termina en lista de espera, y G07 muestra lo que devuelve la API. La lista de espera no tiene salida (C61).
// Tiempo de atención (ADR-05, §4.7): atencion_inicio al abrir «Ver dictamen» y atencion_fin emparejado al decidir.
// `cuota_acreditada` en el atencion_fin de un grado con cuota 0 es solo trazabilidad: HU0016 decide con los datos (C62).
import type { Almacenamiento } from "../almacenamiento";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import {
  bloquearGradoDeExpediente,
  descontarVacante,
  fijarPosicion,
  inventarioVacantes,
  listarAptos,
  siguientePosicion,
} from "../repositories/adjudicacion";
import { insertarIntento } from "../repositories/aviso";
import { leerDictamen } from "../repositories/dictamen";
import { TIPO_LISTA_ESPERA, TIPO_VACANTE_ASIGNADA } from "../repositories/evaluaciones";
import { bloquearFichaDeExpediente } from "../repositories/expediente";
import { leerCabecera } from "../repositories/validacion";
import { registrarAtencionFin, registrarAtencionInicio, type ItemAtencion } from "./atencion";
import { abrirInforme } from "./dictamen";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";
import { codigoExpediente } from "./fichaInscripcion";

const ESTADO_APTO = "apto";

const itemAdjudicacion = (idExpediente: number): ItemAtencion => ({ tipo: "adjudicacion", id: idExpediente });
const expedienteNoEncontrado = () => new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
const noCorresponde = () => new ErrorApi(409, "ADJUDICACION_NO_CORRESPONDE", "El expediente no tiene un dictamen Apto por decidir");

// GET /direccion/adjudicacion: los aptos por decidir y el inventario por grado de la campaña activa.
export async function panelAdjudicacion(campana: string) {
  const db = obtenerPool();
  const [aptos, inventario] = await Promise.all([listarAptos(db, campana), inventarioVacantes(db, campana)]);
  return {
    pendientes: aptos.map((a) => ({
      id_expediente: a.id_expediente,
      codigo: a.codigo,
      postulante: { nombres: a.postulante_nombres, apellidos: a.postulante_apellidos },
      grado: a.nombre_grado,
      dictamen: a.dictamen,
      recibido: a.recibido?.toISOString() ?? null,
      sin_vacantes: a.vacantes_disponibles === 0,
    })),
    inventario: inventario.map((g) => ({
      id_grado: g.id_grado,
      nivel: g.nivel,
      grado: g.nombre_grado,
      autorizadas: g.vacantes_autorizadas,
      adjudicadas: g.vacantes_autorizadas - g.vacantes_disponibles,
      disponibles: g.vacantes_disponibles,
      lista_espera: g.lista_espera,
    })),
  };
}

async function cabeceraDeApto(idExpediente: number) {
  const c = await leerCabecera(obtenerPool(), idExpediente);
  if (!c) throw expedienteNoEncontrado();
  if (c.estado !== ESTADO_APTO) throw noCorresponde();
  return c;
}

// GET /direccion/expedientes/:id/dictamen: abrir «Ver dictamen» abre el ítem de atención (§4.7, postulante apto en G07).
export async function dictamenParaDireccion(idExpediente: number, idPersonal: number) {
  const c = await cabeceraDeApto(idExpediente);
  const db = obtenerPool();
  const dictamen = await leerDictamen(db, idExpediente);
  if (!dictamen) throw noCorresponde();
  await registrarAtencionInicio(db, { idPersonal, idExpediente, item: itemAdjudicacion(idExpediente) });
  return {
    id_expediente: idExpediente,
    codigo: codigoExpediente(c.campana_admision, idExpediente),
    postulante: {
      nombres: c.postulante_nombres,
      apellidos: [c.postulante_apellido_paterno, c.postulante_apellido_materno].filter(Boolean).join(" ") || null,
    },
    grado: c.nombre_grado,
    dictamen: dictamen.dictamen,
    conclusiones: dictamen.conclusiones,
    tiene_informe: dictamen.informe_url !== null,
    fecha_emision: dictamen.fecha_emision.toISOString(),
  };
}

// GET /direccion/expedientes/:id/dictamen/informe: el informe psicológico (R3), solo mientras el expediente espera su decisión.
export async function informeParaDireccion(almacenamiento: Almacenamiento, idExpediente: number) {
  await cabeceraDeApto(idExpediente);
  return abrirInforme(almacenamiento, idExpediente);
}

export type ResultadoAdjudicacion =
  | { resultado: "vacante_asignada"; id_notificacion: number }
  | { resultado: "lista_espera"; posicion: number; id_notificacion: number };

// POST /direccion/expedientes/:id/adjudicacion. Orden de bloqueo: expediente y después grado.
export async function adjudicarVacante(idExpediente: number, idPersonal: number): Promise<ResultadoAdjudicacion> {
  return enTransaccion(async (c) => {
    const bloqueo = await bloquearFichaDeExpediente(c, idExpediente);
    if (!bloqueo) throw expedienteNoEncontrado();
    if (bloqueo.estado !== ESTADO_APTO) throw noCorresponde();
    const grado = (await bloquearGradoDeExpediente(c, idExpediente))!;
    const item = itemAdjudicacion(idExpediente);

    if (grado.vacantes_disponibles > 0) {
      await descontarVacante(c, grado.id_grado);
      const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_VACANTE_ASIGNADA, estadoEnvio: "pendiente" });
      await transicionarExpediente(c, {
        idExpediente,
        campo: "estado",
        esperado: ESTADO_APTO,
        nuevo: "vacante_asignada",
        idPersonal,
        detalle: { id_notificacion: idNotificacion },
      });
      const sinCuota = Number(grado.monto_cuota_ingreso) === 0;
      await registrarAtencionFin(c, {
        idPersonal,
        idExpediente,
        item,
        decision: "vacante_asignada",
        extra: { id_notificacion: idNotificacion, ...(sinCuota ? { cuota_acreditada: true } : {}) },
      });
      return { resultado: "vacante_asignada", id_notificacion: idNotificacion };
    }

    const posicion = await siguientePosicion(c, grado.id_grado);
    const idNotificacion = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_LISTA_ESPERA, estadoEnvio: "pendiente" });
    await transicionarExpediente(c, {
      idExpediente,
      campo: "estado",
      esperado: ESTADO_APTO,
      nuevo: "lista_espera",
      idPersonal,
      detalle: { id_notificacion: idNotificacion, posicion },
    });
    await fijarPosicion(c, idExpediente, posicion);
    await registrarAtencionFin(c, { idPersonal, idExpediente, item, decision: "lista_espera", extra: { id_notificacion: idNotificacion, posicion } });
    return { resultado: "lista_espera", posicion, id_notificacion: idNotificacion };
  });
}
