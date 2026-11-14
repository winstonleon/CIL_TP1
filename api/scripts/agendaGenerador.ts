// Horarios de agenda para la demo en dev (npm run dev:agenda). No es una HU: llena G09 con turnos de lunes a viernes, de 8:00
// a 13:00 (hora de Lima), para que P02 y P08 tengan fechas. Producción no lo usa: allí Secretaría crea los horarios en G09
// (los horarios recurrentes desde G09 son un compromiso aparte, sin escenario en el backlog).
// - Cada alta pasa por crearHorario, el servicio de G09: valida el responsable (ADR-15, C25 7) y la superposición, y audita
//   cambio_configuracion. No hay INSERT directo.
// - Idempotente: un horario que choca con otro del mismo responsable (409 HORARIO_SUPERPUESTO) se salta. Si es el mismo
//   turno (misma campaña, tipo y horas) cuenta como «ya existía»; si no, es otro horario (p. ej., del E2E), que no se toca.
// - Fechas y horas son de Lima, como texto (§2 del modelo): sin conversiones de zona.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Consultable } from "../src/db/pool";
import { ErrorApi } from "../src/errores";
import { crearHorario, RESPONSABLE_POR_TIPO, type TipoCita } from "../src/services/configuracion";

export const AGENDA_HASTA = "2027-03-31";
export const RUTA_FERIADOS = resolve(import.meta.dirname, "feriados.json");

// Cuentas de prueba (infra/keycloak/usuarios-prueba.json). La secretaria es quien usa G09: queda como actor de cada alta.
export const CORREO_SECRETARIA = "secretaria.prueba@ejemplo.test";
export const CORREO_RESPONSABLE: Readonly<Record<string, string>> = {
  directora: "directora.prueba@ejemplo.test",
  psicologa: "psicologa.prueba@ejemplo.test",
  evaluador_academico: "evaluador.prueba@ejemplo.test",
};

// 1 = lunes … 5 = viernes (getUTCDay sobre la fecha de calendario).
const LUNES_A_VIERNES = [1, 2, 3, 4, 5];
const TURNOS_DE_1H: readonly (readonly [string, string])[] = [
  ["08:00", "09:00"],
  ["09:00", "10:00"],
  ["10:00", "11:00"],
  ["11:00", "12:00"],
  ["12:00", "13:00"],
];
const BLOQUE_MANANA: readonly (readonly [string, string])[] = [["08:00", "13:00"]];

interface Regla {
  tipo_cita: TipoCita;
  dias: readonly number[];
  turnos: readonly (readonly [string, string])[];
  cupos: number;
}

// Valores provisionales para la demo; los reales los confirma el colegio (duraciones, cupos y reparto de la psicóloga).
export const REGLAS: readonly Regla[] = [
  { tipo_cita: "visita", dias: LUNES_A_VIERNES, turnos: TURNOS_DE_1H, cupos: 1 },
  { tipo_cita: "evaluacion_academica", dias: LUNES_A_VIERNES, turnos: TURNOS_DE_1H, cupos: 1 },
  { tipo_cita: "jornada_observacion", dias: [1, 3], turnos: BLOQUE_MANANA, cupos: 6 },
  { tipo_cita: "evaluacion_psicologica", dias: [2, 4], turnos: TURNOS_DE_1H, cupos: 1 },
  { tipo_cita: "entrevista_padres", dias: [5], turnos: TURNOS_DE_1H, cupos: 1 },
];

export interface Turno {
  tipo_cita: TipoCita;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cupos: number;
}

const fechaIso = z.iso.date();
const esquemaFeriados = z.object({
  nota: z.string(),
  feriados: z.array(z.object({ fecha: fechaIso, nombre: z.string().min(1) }).strict()),
});

export function leerFeriados(ruta = RUTA_FERIADOS): Set<string> {
  const { feriados } = esquemaFeriados.parse(JSON.parse(readFileSync(ruta, "utf8")));
  return new Set(feriados.map((f) => f.fecha));
}

const DIA_MS = 86_400_000;
const comoUtc = (fecha: string) => Date.parse(`${fecha}T00:00:00Z`);
const aFecha = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Hoy y la hora actual en Lima ("2026-11-12", "09:30").
export function ahoraEnLima(ahora = new Date()): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const p = (t: string) => partes.find((x) => x.type === t)!.value;
  return { fecha: `${p("year")}-${p("month")}-${p("day")}`, hora: `${p("hour")}:${p("minute")}` };
}

// Turnos de [desde, hasta], sin fines de semana ni feriados. Del día de hoy solo los que aún no empiezan.
// diasFeriado cuenta los días de lunes a viernes saltados por estar en la lista de feriados.
export function planificarAgenda(desde: string, hasta: string, feriados: ReadonlySet<string>, ahora = ahoraEnLima()) {
  const turnos: Turno[] = [];
  let diasFeriado = 0;
  for (let ms = comoUtc(desde); ms <= comoUtc(hasta); ms += DIA_MS) {
    const fecha = aFecha(ms);
    const dia = new Date(ms).getUTCDay();
    if (!LUNES_A_VIERNES.includes(dia)) continue;
    if (feriados.has(fecha)) {
      diasFeriado++;
      continue;
    }
    for (const regla of REGLAS) {
      if (!regla.dias.includes(dia)) continue;
      for (const [hora_inicio, hora_fin] of regla.turnos) {
        if (fecha < ahora.fecha || (fecha === ahora.fecha && hora_inicio <= ahora.hora)) continue;
        turnos.push({ tipo_cita: regla.tipo_cita, fecha, hora_inicio, hora_fin, cupos: regla.cupos });
      }
    }
  }
  return { turnos, diasFeriado };
}

export interface Cuentas {
  keycloakSecretaria: string;
  responsable: Readonly<Record<string, number>>; // rol → id_personal
}

// Las cuentas de prueba activas. Sin alguna, no se crea nada.
export async function leerCuentas(db: Consultable): Promise<Cuentas> {
  const correos = [CORREO_SECRETARIA, ...Object.values(CORREO_RESPONSABLE)];
  const { rows } = await db.query<{ correo: string; rol: string; id_personal: number; keycloak_user_id: string }>(
    `SELECT correo, rol::text AS rol, id_personal, keycloak_user_id::text AS keycloak_user_id
       FROM personal WHERE activo AND correo = ANY($1::text[])`,
    [correos],
  );
  const de = (correo: string, rol: string) => rows.find((r) => r.correo === correo && r.rol === rol);
  const secretaria = de(CORREO_SECRETARIA, "secretaria");
  const faltan = [secretaria ? null : CORREO_SECRETARIA, ...Object.entries(CORREO_RESPONSABLE).map(([rol, c]) => (de(c, rol) ? null : c))];
  const ausentes = faltan.filter((c): c is string => c !== null);
  if (ausentes.length) {
    throw new Error(`faltan cuentas activas de prueba en personal (${ausentes.join(", ")}); corre npm run kc:usuarios-prueba y npm run db:seed`);
  }
  return {
    keycloakSecretaria: secretaria!.keycloak_user_id,
    responsable: Object.fromEntries(Object.entries(CORREO_RESPONSABLE).map(([rol, c]) => [rol, de(c, rol)!.id_personal])),
  };
}

async function esElMismoTurno(db: Consultable, campana: string, idPersonal: number, t: Turno): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM horario_disponible
      WHERE campana_admision = $1 AND id_personal = $2 AND tipo_cita = $3::tipo_cita AND fecha = $4::date
        AND hora_inicio = $5::time AND hora_fin = $6::time`,
    [campana, idPersonal, t.tipo_cita, t.fecha, t.hora_inicio, t.hora_fin],
  );
  return (rowCount ?? 0) > 0;
}

export type Conteo = Record<TipoCita, number>;
const conteoVacio = (): Conteo => ({ visita: 0, evaluacion_academica: 0, jornada_observacion: 0, evaluacion_psicologica: 0, entrevista_padres: 0 });

export interface ResultadoAgenda {
  creados: Conteo;
  yaExistian: number;
  seCruzan: number;
}

// Crea cada turno con el servicio de G09. Cualquier error que no sea HORARIO_SUPERPUESTO detiene el script: lo creado
// hasta ahí queda, y una nueva corrida lo salta.
export async function generarAgenda(db: Consultable, campana: string, cuentas: Cuentas, turnos: readonly Turno[]): Promise<ResultadoAgenda> {
  const resultado: ResultadoAgenda = { creados: conteoVacio(), yaExistian: 0, seCruzan: 0 };
  for (const t of turnos) {
    const idPersonal = cuentas.responsable[RESPONSABLE_POR_TIPO[t.tipo_cita]]!;
    try {
      await crearHorario(cuentas.keycloakSecretaria, campana, { id_personal: idPersonal, ...t });
      resultado.creados[t.tipo_cita]++;
    } catch (e) {
      if (!(e instanceof ErrorApi && e.codigo === "HORARIO_SUPERPUESTO")) throw e;
      if (await esElMismoTurno(db, campana, idPersonal, t)) resultado.yaExistian++;
      else resultado.seCruzan++;
    }
  }
  return resultado;
}
