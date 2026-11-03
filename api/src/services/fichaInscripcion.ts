// Ficha de inscripción y cuestionario de expectativas (P05 y P05b, HU0005). El guardado es del estado completo del
// formulario, en una transacción con el expediente bloqueado (con dos pestañas gana el último guardado, ADR-20).
// - «Guardar borrador» / abandono (HU0005-2.0): guarda solo lo que ya es válido y devuelve lo que falta (`pendientes`).
// - «Guardar y continuar» (HU0005-1.0): exige la ficha completa, la marca `ficha_completa` y devuelve la lista de
//   documentos que corresponde (R7) para habilitar la carga.
// El primer guardado pasa el expediente de `portal_habilitado` a `en_postulacion` (transicionarExpediente).
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import {
  actualizarApoderadoFicha,
  actualizarDatosFichaTitular,
  dniDeApoderadoRepetido,
  eliminarApoderadoSinDocumentos,
  insertarApoderado,
  leerApoderadoFicha,
} from "../repositories/apoderado";
import { guardarCuestionario, leerCuestionario } from "../repositories/cuestionario";
import {
  bloquearFichaDeExpediente,
  listarExpedientesDeFamilia,
  vincularPostulante,
  type ExpedienteDeFamilia,
} from "../repositories/expediente";
import {
  actualizarPostulante,
  dniDePostulanteRepetido,
  fijarVinculo,
  insertarPostulante,
  leerPostulante,
  quitarVinculo,
  vinculosDePostulante,
} from "../repositories/postulante";
import { requisitosExigidos, type RequisitoExigido } from "../repositories/requisito";
import { UUID } from "../uuid";
import { PREGUNTAS, VERSION_CUESTIONARIO } from "./cuestionarioExpectativas";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";
import { normalizarFicha, type EntradaFicha, type Problema } from "./reglasFicha";

export type ModoGuardado = "borrador" | "completa";

const ESTADOS_EDITABLES = ["portal_habilitado", "en_postulacion"];

// Código visible al usuario: ADM-<campaña>-<id con 4 dígitos> (modelo de datos, nota de Expediente).
export const codigoExpediente = (campana: string, idExpediente: number) => `ADM-${campana}-${String(idExpediente).padStart(4, "0")}`;

export async function listarExpedientes(keycloakUserId: string) {
  const db = obtenerPool();
  const filas = UUID.test(keycloakUserId) ? await listarExpedientesDeFamilia(db, keycloakUserId) : [];
  return Promise.all(
    filas.map(async (e) => {
      const p = e.id_postulante ? await leerPostulante(db, e.id_postulante) : null;
      const nombre = [p?.nombres, p?.apellido_paterno, p?.apellido_materno].filter(Boolean).join(" ");
      return {
        id_expediente: e.id_expediente,
        codigo: codigoExpediente(e.campana_admision, e.id_expediente),
        estado: e.estado,
        grado: e.nombre_grado,
        postulante: nombre || null,
        ficha_completa: p?.ficha_completa ?? false,
      };
    }),
  );
}

export async function leerFicha(e: ExpedienteDeFamilia) {
  const db = obtenerPool();
  const postulante = e.id_postulante ? await leerPostulante(db, e.id_postulante) : null;
  const vinculos = postulante ? await vinculosDePostulante(db, postulante.id_postulante) : [];
  const parentescoTitular = vinculos.find((v) => v.id_apoderado === e.id_apoderado_titular)?.parentesco ?? null;
  const vinculoSegundo = vinculos.find((v) => v.id_apoderado !== e.id_apoderado_titular) ?? null;
  const titular = (await leerApoderadoFicha(db, e.id_apoderado_titular))!;
  const segundo = vinculoSegundo ? await leerApoderadoFicha(db, vinculoSegundo.id_apoderado) : null;
  const cuestionario = await leerCuestionario(db, e.id_expediente);
  return {
    id_expediente: e.id_expediente,
    codigo: codigoExpediente(e.campana_admision, e.id_expediente),
    estado: e.estado,
    ficha_completa: postulante?.ficha_completa ?? false,
    guardado_en: cuestionario?.guardado_en ?? null,
    grado: { nombre_grado: e.nombre_grado, nivel: e.nivel },
    postulante: {
      nombres: postulante?.nombres ?? null,
      apellido_paterno: postulante?.apellido_paterno ?? null,
      apellido_materno: postulante?.apellido_materno ?? null,
      dni: postulante?.dni ?? null,
      fecha_nacimiento: postulante?.fecha_nacimiento ?? null,
      // null = sin responder: P05 no marca ninguna opción (HU0005-2.0).
      estudio_en_colegio_peruano: postulante?.estudio_en_colegio_peruano ?? null,
      colegio_procedencia: postulante?.colegio_procedencia ?? null,
      tiene_condicion_especial: postulante?.tiene_condicion_especial ?? null,
    },
    // Nombres, apellidos, teléfono y correo del titular vienen de P01 y son de solo lectura (ADR-20).
    titular: {
      nombres: titular.nombres,
      apellidos: titular.apellidos,
      telefono: titular.telefono,
      correo: titular.correo,
      parentesco: parentescoTitular,
      dni: titular.dni,
      condicion_laboral: titular.condicion_laboral,
    },
    segundo_apoderado: segundo
      ? {
          parentesco: vinculoSegundo!.parentesco,
          nombres: segundo.nombres,
          apellidos: segundo.apellidos,
          dni: segundo.dni,
          telefono: segundo.telefono,
          correo: segundo.correo,
          condicion_laboral: segundo.condicion_laboral,
        }
      : null,
    cuestionario: { version: VERSION_CUESTIONARIO, preguntas: PREGUNTAS, respuestas: cuestionario?.respuestas ?? {} },
  };
}

// Lista de documentos que corresponde a la ficha (R7). Contrato que consume HU0006.
export async function listaRequisitos(e: ExpedienteDeFamilia): Promise<{ requisitos: RequisitoExigido[] }> {
  const db = obtenerPool();
  const postulante = e.id_postulante ? await leerPostulante(db, e.id_postulante) : null;
  if (!postulante?.ficha_completa) {
    throw new ErrorApi(409, "FICHA_INCOMPLETA", "Completa la ficha para ver los documentos que debes cargar");
  }
  return { requisitos: await requisitosExigidos(db, e.id_expediente) };
}

type RespuestaGuardado =
  | { ficha_completa: false; guardado_en: string; pendientes: Problema[] }
  | { ficha_completa: true; guardado_en: string; requisitos: RequisitoExigido[] };

export async function guardarFicha(e: ExpedienteDeFamilia, modo: ModoGuardado, entrada: EntradaFicha): Promise<RespuestaGuardado> {
  const completa = modo === "completa";
  const { ficha, problemas } = normalizarFicha(entrada);
  if (completa && problemas.length > 0) {
    throw new ErrorApi(400, "VALIDACION", "La ficha tiene campos por completar o corregir", problemas);
  }

  return enTransaccion(async (db) => {
    const bloqueo = await bloquearFichaDeExpediente(db, e.id_expediente);
    if (!bloqueo || !ESTADOS_EDITABLES.includes(bloqueo.estado)) {
      throw new ErrorApi(409, "FICHA_NO_EDITABLE", "La ficha no se puede editar en el estado actual del expediente");
    }
    const actual = bloqueo.id_postulante ? await leerPostulante(db, bloqueo.id_postulante) : null;
    if (actual?.ficha_completa) {
      throw new ErrorApi(409, "FICHA_YA_COMPLETA", "La ficha ya está completa");
    }
    const vinculos = actual ? await vinculosDePostulante(db, actual.id_postulante) : [];
    const idSegundoActual = vinculos.find((v) => v.id_apoderado !== e.id_apoderado_titular)?.id_apoderado ?? null;

    // DNI ya registrado en otra postulación (C28 c y d). Se excluyen las filas de esta misma ficha. No se revela de quién es.
    const propios = [e.id_apoderado_titular, ...(idSegundoActual ? [idSegundoActual] : [])];
    const dnis: Array<[campo: string, dni: string | null, anular: () => void]> = [
      ["postulante.dni", ficha.postulante.dni, () => (ficha.postulante.dni = null)],
      ["titular.dni", ficha.titular.dni, () => (ficha.titular.dni = null)],
      ["segundo_apoderado.dni", ficha.segundo?.dni ?? null, () => ficha.segundo && (ficha.segundo.dni = null)],
    ];
    const repetidos: Problema[] = [];
    for (const [campo, dni, anular] of dnis) {
      if (!dni) continue;
      const ocupado = (await dniDeApoderadoRepetido(db, dni, propios)) || (await dniDePostulanteRepetido(db, dni, actual?.id_postulante ?? null));
      if (!ocupado) continue;
      repetidos.push({ campo, codigo: "DNI_YA_REGISTRADO" });
      anular();
    }
    if (completa && repetidos.length > 0) {
      throw new ErrorApi(409, "DNI_YA_REGISTRADO", "Ese DNI ya figura en otra postulación", repetidos);
    }

    if (bloqueo.estado === "portal_habilitado") {
      await transicionarExpediente(db, {
        idExpediente: e.id_expediente,
        campo: "estado",
        esperado: "portal_habilitado",
        nuevo: "en_postulacion",
        idPersonal: null,
        detalle: { origen: "familia", escenario: "HU0005-2.0", modo },
      });
    }

    try {
      let idPostulante: number;
      if (actual) {
        idPostulante = actual.id_postulante;
        await actualizarPostulante(db, idPostulante, ficha.postulante, completa);
      } else {
        idPostulante = await insertarPostulante(db, ficha.postulante, completa);
        await vincularPostulante(db, e.id_expediente, idPostulante);
      }

      await actualizarDatosFichaTitular(db, e.id_apoderado_titular, ficha.titular);
      if (ficha.titular.parentesco) await fijarVinculo(db, idPostulante, e.id_apoderado_titular, ficha.titular.parentesco);
      else await quitarVinculo(db, idPostulante, e.id_apoderado_titular);

      const s = ficha.segundo;
      if (s?.guardable) {
        const datos = {
          nombres: s.nombres!,
          apellidos: s.apellidos!,
          telefono: s.telefono!,
          correo: s.correo!,
          ...(s.dni ? { dni: s.dni } : {}),
          condicion_laboral: s.condicion_laboral,
        };
        let idSegundo = idSegundoActual;
        if (idSegundo) await actualizarApoderadoFicha(db, idSegundo, datos);
        else idSegundo = await insertarApoderado(db, datos);
        await fijarVinculo(db, idPostulante, idSegundo, s.parentesco!);
      } else if (!s && idSegundoActual) {
        // La familia lo quitó de P05b. Un bloque a medias (no guardable) no borra el que ya estaba guardado.
        await quitarVinculo(db, idPostulante, idSegundoActual);
        await eliminarApoderadoSinDocumentos(db, idSegundoActual);
      }

      const guardadoEn = await guardarCuestionario(db, e.id_expediente, ficha.respuestas, !completa);
      if (completa) {
        return { ficha_completa: true as const, guardado_en: guardadoEn, requisitos: await requisitosExigidos(db, e.id_expediente) };
      }
      return { ficha_completa: false as const, guardado_en: guardadoEn, pendientes: [...problemas, ...repetidos] };
    } catch (err) {
      // Carrera con otra postulación que registró el mismo DNI entre la comprobación y la escritura.
      const pg = err as { code?: string; constraint?: string };
      if (pg.code === "23505" && pg.constraint?.includes("dni_hash")) {
        throw new ErrorApi(409, "DNI_YA_REGISTRADO", "Ese DNI ya figura en otra postulación");
      }
      throw err;
    }
  });
}
