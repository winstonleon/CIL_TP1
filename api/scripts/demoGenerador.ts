// Datos de demostración del tablero G08 (HU0019, D4-A): 60 expedientes ficticios en una campaña propia, con tiempos plausibles.
// - Escribe solo lo que G08 lee: grado, apoderado, consentimiento, expediente, pago, notificacion y registro_auditoria. No crea
//   citas, dictámenes, documentos ni cuentas: la campaña DEMO no aparece en las demás pantallas y n8n no tiene nada que hacer.
// - Las fechas pasadas se fijan con INSERT, por el usuario de la API. No se tocan el trigger de la bitácora ni los permisos,
//   y `insertarEvento` no cambia: el camino de producción sigue sin poder fijar fechas.
// - Es irreversible: la bitácora no se borra. Por eso corre en una transacción y `validarDemo` comprueba todo antes del COMMIT;
//   cualquier inconsistencia revierte y no queda nada.
// - Semilla y fechas fijas: da las mismas cifras en cada instalación.
// - Los barridos de n8n de hoy no la toman (lo comprueba `validarDemo`). HU0016 la excluye; HU0018 también debe hacerlo (C72).
import type pg from "pg";
import { insertarApoderado } from "../src/repositories/apoderado";
import { listarAvisosPendientes, listarRecordatoriosPendientes } from "../src/repositories/aviso";
import { listarCartasPendientes, TIPO_CARTA } from "../src/repositories/carta";
import { listarVerificacionesPendientes } from "../src/repositories/completitud";
import { insertarConsentimiento } from "../src/repositories/consentimiento";
import { listarAvisosEvaluacionPendientes } from "../src/repositories/evaluaciones";
import { listarCarpetasPendientes } from "../src/repositories/notificacion";
import { listarObservacionesPendientes } from "../src/repositories/validacion";
import { TIPO_EVENTO_CARPETA } from "../src/services/captacion";
import { TRANSICIONES_PERMITIDAS } from "../src/services/expedientes/transicionarExpediente";

export const TOTAL_DEMO = 60;
const SEMILLA = 20261105;
const INICIO = Date.parse("2026-08-03T14:00:00Z"); // 9:00 en Lima
const DIA = 86_400_000;
const MINUTO = 60_000;

// Reparto por estado final (suma 60). Los de vacante van primero al grado 0, que queda lleno.
const REPARTO: readonly (readonly [estado: string, cantidad: number])[] = [
  ["carta_emitida", 8],
  ["vacante_asignada", 8],
  ["lista_espera", 2],
  ["apto", 5],
  ["no_apto", 3],
  ["en_observacion", 2],
  ["en_evaluacion", 8],
  ["en_validacion", 8],
  ["en_postulacion", 6],
  ["portal_habilitado", 3],
  ["visita_agendada", 2],
  ["prospecto", 4],
  ["contacto_no_entregado", 1],
];

const GRADOS = [
  { nivel: "primaria", nombre: "1.° de primaria (demo)", autorizadas: 6 },
  { nivel: "inicial", nombre: "3 años (demo)", autorizadas: 14 },
  { nivel: "primaria", nombre: "3.° de primaria (demo)", autorizadas: 12 },
  { nivel: "secundaria", nombre: "1.° de secundaria (demo)", autorizadas: 10 },
] as const;
const CUPOS_GRADO_LLENO = GRADOS[0].autorizadas;

const CAMINO_BASE = ["visita_agendada", "portal_habilitado", "en_postulacion", "en_validacion", "en_evaluacion"];
const CAMINO_ADJUDICADO = [...CAMINO_BASE, "apto"];

// Quién hace cada transición en el flujo real; los demás los hace la familia o el sistema.
const ROL_DE_ESTADO: Readonly<Record<string, string>> = {
  portal_habilitado: "secretaria",
  en_observacion: "psicologa",
  no_apto: "psicologa",
  apto: "psicologa",
  vacante_asignada: "directora",
  lista_espera: "directora",
};
const ESTADOS_DE_DICTAMEN = ["apto", "en_observacion", "no_apto"];

// Días entre un hito y el siguiente.
const DIAS_HASTA: Readonly<Record<string, readonly [number, number]>> = {
  visita_agendada: [1, 5],
  portal_habilitado: [2, 6],
  en_postulacion: [1, 4],
  en_validacion: [3, 9],
  en_evaluacion: [3, 7],
  en_observacion: [6, 10],
  no_apto: [6, 11],
  apto: [6, 12],
  vacante_asignada: [1, 3],
  lista_espera: [1, 3],
  carta_emitida: [3, 7],
  contacto_no_entregado: [0.1, 0.2],
};

function caminoDe(estado: string, indice: number): string[] {
  if (estado === "prospecto") return [];
  if (estado === "contacto_no_entregado") return [estado];
  const enBase = CAMINO_BASE.indexOf(estado);
  if (enBase >= 0) return CAMINO_BASE.slice(0, enBase + 1);
  if (estado === "en_observacion" || estado === "no_apto") return [...CAMINO_BASE, estado];
  // Uno de cada cinco pasa por «En observación» antes del Apto (HU0010-2.0).
  const adjudicado = indice % 5 === 0 ? [...CAMINO_BASE, "en_observacion", "apto"] : CAMINO_ADJUDICADO;
  if (estado === "apto") return adjudicado;
  if (estado === "carta_emitida") return [...adjudicado, "vacante_asignada", estado];
  return [...adjudicado, estado];
}

// mulberry32: generador con semilla, para repetir las mismas cifras.
function crearAzar(semilla: number) {
  let s = semilla;
  const siguiente = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { entre: (min: number, max: number) => min + siguiente() * (max - min), probable: (p: number) => siguiente() < p };
}

type Actores = Readonly<Record<string, number>>;

async function actoresDemo(c: pg.PoolClient): Promise<Actores> {
  const { rows } = await c.query<{ rol: string; id_personal: number }>(
    `SELECT DISTINCT ON (rol) rol::text AS rol, id_personal FROM personal
      WHERE activo AND correo LIKE '%@ejemplo.test' ORDER BY rol, id_personal`,
  );
  const actores = Object.fromEntries(rows.map((r) => [r.rol, r.id_personal]));
  for (const rol of ["secretaria", "tesoreria", "psicologa", "directora"]) {
    if (actores[rol] === undefined) throw new Error(`Falta personal de prueba con el rol ${rol}: ejecuta npm run db:seed`);
  }
  return actores;
}

// Un expediente y su historia, en orden: cada evento se escribe con la hora del reloj de ese expediente.
class Historia {
  private t: number;

  constructor(
    private readonly c: pg.PoolClient,
    private readonly id: number,
    registro: number,
    private readonly actores: Actores,
    private readonly azar: ReturnType<typeof crearAzar>,
  ) {
    this.t = registro;
  }

  avanzar(dias: number) {
    this.t += dias * DIA;
  }

  get hora() {
    return this.t;
  }

  // Lleva el reloj hasta `hora`, si aún no llegó.
  esperarHasta(hora: number) {
    this.t = Math.max(this.t, hora);
  }

  private async evento(tipo: string, e: { idPersonal?: number | null; anterior?: string; nuevo?: string; detalle: Record<string, unknown> }) {
    const { rows } = await this.c.query<{ id_evento: string }>(
      `INSERT INTO registro_auditoria (id_expediente, id_personal, tipo_evento, estado_anterior, estado_nuevo, detalle, fecha_hora)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_evento`,
      [this.id, e.idPersonal ?? null, tipo, e.anterior ?? null, e.nuevo ?? null, JSON.stringify({ ...e.detalle, demo: true }), new Date(this.t)],
    );
    return Number(rows[0]!.id_evento);
  }

  transicion(campo: string, anterior: string, nuevo: string, idPersonal: number | null = null) {
    return this.evento("transicion_estado", { idPersonal, anterior, nuevo, detalle: { campo } });
  }

  // Un par de atención; sin `decision` el ítem queda abierto (no cuenta en el cycle time).
  async atencion(tipo: string, idItem: number, rol: string, minutos: number, decision?: string) {
    const item = { tipo, id: idItem };
    const idPersonal = this.actores[rol]!;
    const inicio = await this.evento("atencion_inicio", { idPersonal, detalle: { item } });
    if (!decision) return;
    this.t += minutos * MINUTO;
    await this.evento("atencion_fin", { idPersonal, detalle: { item, decision, id_evento_inicio: inicio } });
  }

  subsanacion(item: { tipo: string; id: number }) {
    return this.evento("subsanacion_registrada", { detalle: { item } });
  }

  rebote() {
    return this.evento("notificacion_rebotada", { detalle: {} });
  }

  cuotaRegistrada(idPago: number) {
    return this.evento("cuota_registrada", { detalle: { id_pago: idPago } });
  }

  aviso(tipo: string, estado: "pendiente" | "enviado" | "fallido") {
    return this.c.query("INSERT INTO notificacion (id_expediente, canal, tipo_evento, estado_envio, fecha_envio) VALUES ($1, 'correo', $2, $3::estado_envio, $4)", [
      this.id,
      tipo,
      estado,
      new Date(this.t),
    ]);
  }

  async pago(tipo: string, numero: string, monto: number, estado: string) {
    const { rows } = await this.c.query<{ id_pago: number }>(
      `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url, estado_validacion)
       VALUES ($1, $2::tipo_pago, 1, $3, 'Banco ficticio', $4, $5::date, $6, $7::estado_revision) RETURNING id_pago`,
      [this.id, tipo, numero, monto, new Date(this.t).toISOString().slice(0, 10), `demo/${numero}`, estado],
    );
    return rows[0]!.id_pago;
  }
}

async function etapaValidacion(h: Historia, id: number, indice: number, azar: ReturnType<typeof crearAzar>, actores: Actores, sigue: boolean, numeroPago: string) {
  h.avanzar(azar.entre(0.2, 1));
  const idPago = await h.pago("derecho_admision", numeroPago, 300, sigue ? "conforme" : "pendiente");
  if (!sigue) {
    // Sigue en validación: uno de cada dos con la rama abierta; el otro, observado y esperando a la familia.
    if (indice % 2 === 0) return h.atencion("validacion_documental", id, "secretaria", 0);
    await h.atencion("validacion_documental", id, "secretaria", azar.entre(10, 35), "observado");
    return h.transicion("estado_documental", "pendiente", "observado", actores.secretaria);
  }
  // Uno de cada cuatro tuvo una observación y la subsanó.
  if (indice % 4 === 0) {
    await h.atencion("validacion_documental", id, "secretaria", azar.entre(10, 30), "observado");
    await h.transicion("estado_documental", "pendiente", "observado", actores.secretaria);
    await h.aviso("subsanacion_solicitada", "enviado");
    h.avanzar(azar.entre(1, 2));
    await h.subsanacion({ tipo: "validacion_documental", id });
    await h.transicion("estado_documental", "observado", "pendiente");
  }
  await h.atencion("validacion_documental", id, "secretaria", azar.entre(10, 40), "conforme");
  await h.transicion("estado_documental", "pendiente", "conforme", actores.secretaria);
  await h.atencion("documentacion_financiera", id, "tesoreria", azar.entre(10, 30), "conforme");
  await h.transicion("estado_financiero", "pendiente", "conforme", actores.tesoreria);
  await h.atencion("pago", idPago, "tesoreria", azar.entre(3, 10), "conforme");
}

async function etapaEvaluacion(h: Historia, azar: ReturnType<typeof crearAzar>, base: number) {
  for (let i = 0; i < 2; i++) {
    h.avanzar(azar.entre(1, 2));
    // El ítem de la demo no es una cita real: la demo no crea filas `cita`, para que ningún barrido la tome.
    await h.atencion("cita", base + i, "psicologa", azar.entre(30, 60), "resultado");
  }
}

interface FilaDemo {
  id_expediente: number;
  id_grado: number;
  estado: string;
  estado_documental: string;
  estado_financiero: string;
  posicion_lista_espera: number | null;
  correo: string;
  fecha_registro: Date;
}

interface EventoDemo {
  id_expediente: number;
  id_personal: number | null;
  tipo_evento: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  fecha_hora: Date;
  detalle: Record<string, unknown>;
}

// Las reglas que el script debe cumplir antes del COMMIT. Cualquier fallo revierte todo: la bitácora no se puede limpiar.
export async function validarDemo(c: pg.PoolClient, campana: string): Promise<void> {
  const fallar = (motivo: string) => {
    throw new Error(`Validación de la demo: ${motivo}`);
  };
  const { rows: ids } = await c.query<FilaDemo>(
    `SELECT e.id_expediente, e.id_grado, e.estado::text AS estado, e.estado_documental::text AS estado_documental,
            e.estado_financiero::text AS estado_financiero, e.posicion_lista_espera, a.correo, e.fecha_registro
       FROM expediente e JOIN grado g ON g.id_grado = e.id_grado JOIN apoderado a ON a.id_apoderado = e.id_apoderado_titular
      WHERE g.campana_admision = $1`,
    [campana],
  );
  if (ids.length !== TOTAL_DEMO) fallar(`hay ${ids.length} expedientes y se esperaban ${TOTAL_DEMO}`);
  if (ids.some((e) => !e.correo.endsWith("@ejemplo.test"))) fallar("un correo no es @ejemplo.test");
  const demo = new Set(ids.map((e) => e.id_expediente));
  const listaIds = [...demo];

  const { rows: eventos } = await c.query<EventoDemo>(
    `SELECT id_expediente, id_personal, tipo_evento, estado_anterior, estado_nuevo, fecha_hora, detalle
       FROM registro_auditoria WHERE id_expediente = ANY($1::int[]) ORDER BY id_evento`,
    [listaIds],
  );
  const ahora = Date.now();
  const permitidas = new Set(
    [
      ...TRANSICIONES_PERMITIDAS.estado.map(([d, h]) => `estado:${d}>${h}`),
      ...TRANSICIONES_PERMITIDAS.estado_documental.map(([d, h]) => `estado_documental:${d}>${h}`),
      ...TRANSICIONES_PERMITIDAS.estado_financiero.map(([d, h]) => `estado_financiero:${d}>${h}`),
    ],
  );
  const INICIAL: Readonly<Record<string, string>> = { estado: "prospecto", estado_documental: "pendiente", estado_financiero: "pendiente" };
  const ultimoEstado = new Map<string, string>(); // por expediente y campo
  const ultimaHora = new Map<number, number>();
  const dictamenAbierto = new Map<number, string>(); // la decisión del dictamen que espera su transición
  const grado = new Map(ids.map((e) => [e.id_expediente, e.id_grado]));
  const vacantes = new Map<number, number>(); // la última vacante de cada grado
  const espera = new Map<number, { id: number; hora: number }[]>(); // las entradas a la lista de espera, en orden
  for (const ev of eventos) {
    if (ev.detalle?.demo !== true) fallar("un evento no está marcado como demo");
    const hora = ev.fecha_hora.getTime();
    if (hora >= ahora) fallar("un evento tiene fecha futura");
    if (hora < (ultimaHora.get(ev.id_expediente) ?? 0)) fallar("los eventos de un expediente no están en orden");
    ultimaHora.set(ev.id_expediente, hora);
    if (ev.tipo_evento === "atencion_fin" && (ev.detalle.item as { tipo?: string } | undefined)?.tipo === "dictamen") {
      dictamenAbierto.set(ev.id_expediente, String(ev.detalle.decision));
    }
    if (ev.tipo_evento !== "transicion_estado") continue;
    const campo = String(ev.detalle.campo);
    const clave = `${ev.id_expediente}:${campo}`;
    const actual = ultimoEstado.get(clave) ?? INICIAL[campo];
    if (ev.estado_anterior !== actual || !permitidas.has(`${campo}:${actual}>${ev.estado_nuevo}`)) fallar(`transición no permitida: ${actual} a ${ev.estado_nuevo}`);
    ultimoEstado.set(clave, ev.estado_nuevo!);
    if (campo !== "estado") continue;
    const nuevo = ev.estado_nuevo!;
    if (ROL_DE_ESTADO[nuevo] && ev.id_personal === null) fallar(`la transición a ${nuevo} no tiene actor`);
    if (ESTADOS_DE_DICTAMEN.includes(nuevo)) {
      if (dictamenAbierto.get(ev.id_expediente) !== nuevo) fallar(`el dictamen no coincide con la transición a ${nuevo}`);
      dictamenAbierto.delete(ev.id_expediente);
    }
    const idGrado = grado.get(ev.id_expediente)!;
    if (nuevo === "vacante_asignada") {
      if (espera.has(idGrado)) fallar("una vacante se adjudicó después de una lista de espera (R14)");
      vacantes.set(idGrado, hora);
    }
    if (nuevo === "lista_espera") espera.set(idGrado, [...(espera.get(idGrado) ?? []), { id: ev.id_expediente, hora }]);
  }
  for (const e of ids) {
    if (e.estado !== (ultimoEstado.get(`${e.id_expediente}:estado`) ?? "prospecto")) fallar("el estado de un expediente no coincide con su bitácora");
    if (e.estado_documental !== (ultimoEstado.get(`${e.id_expediente}:estado_documental`) ?? "pendiente")) fallar("la rama documental no coincide con su bitácora");
    if (e.estado_financiero !== (ultimoEstado.get(`${e.id_expediente}:estado_financiero`) ?? "pendiente")) fallar("la rama financiera no coincide con su bitácora");
    if (e.fecha_registro.getTime() >= ahora) fallar("un expediente tiene fecha futura");
  }
  // Posiciones 1, 2, … por orden de llegada (ADR-26: max(posición del grado) + 1).
  for (const lista of espera.values()) {
    const ordenada = [...lista].sort((a, b) => a.hora - b.hora);
    for (const [i, l] of ordenada.entries()) {
      if (ids.find((e) => e.id_expediente === l.id)?.posicion_lista_espera !== i + 1) fallar("las posiciones de la lista de espera no son consecutivas (ADR-26)");
    }
  }

  // Identidad de C25: adjudicadas = expedientes con vacante, y lista de espera solo en un grado lleno (R14).
  const { rows: grados } = await c.query<{ adjudicadas: number; con_vacante: number; en_espera: number; disponibles: number }>(
    `SELECT g.vacantes_autorizadas - g.vacantes_disponibles AS adjudicadas, g.vacantes_disponibles AS disponibles,
            count(*) FILTER (WHERE e.estado IN ('vacante_asignada', 'carta_emitida'))::int AS con_vacante,
            count(*) FILTER (WHERE e.estado = 'lista_espera')::int AS en_espera
       FROM grado g LEFT JOIN expediente e ON e.id_grado = g.id_grado
      WHERE g.campana_admision = $1 GROUP BY g.id_grado`,
    [campana],
  );
  if (grados.some((g) => g.adjudicadas !== g.con_vacante)) fallar("adjudicadas no coincide con los expedientes con vacante (C25)");
  if (grados.some((g) => g.en_espera > 0 && g.disponibles > 0)) fallar("hay lista de espera en un grado con vacantes (R14)");

  // Los barridos de n8n no filtran por campaña: ninguno debe tomar un expediente de la demo.
  const opciones = { minutosRegistro: 1, minutosReintento: 10, limite: 100_000 };
  const tomados = [
    ...(await listarCarpetasPendientes(c, { ...opciones, tipoEvento: TIPO_EVENTO_CARPETA })),
    ...(await listarVerificacionesPendientes(c, opciones)),
    ...(await listarObservacionesPendientes(c, opciones)),
    ...(await listarAvisosEvaluacionPendientes(c, opciones)).map((a) => a.id_expediente),
    // HU0016 excluye la campaña DEMO (C72): aquí se comprueba sin la exclusión, con la campaña que se valida.
    ...(await listarCartasPendientes(c, { ...opciones, campanaExcluida: "", tipoEvento: TIPO_CARTA })),
  ];
  if (tomados.some((id) => demo.has(id))) fallar("un barrido de n8n tomaría un expediente de la demo");
  const citas = [...(await listarAvisosPendientes(c, opciones)), ...(await listarRecordatoriosPendientes(c, { ...opciones, horas: 24 }))];
  const { rows: propias } = await c.query("SELECT 1 FROM cita WHERE id_cita = ANY($1::int[]) AND id_expediente = ANY($2::int[])", [citas, listaIds]);
  if (propias.length > 0) fallar("un barrido de n8n tomaría una cita de la demo");
}

// `prefijoDni` (6 dígitos): las pruebas generan varias campañas y el DNI es único.
export async function generarDemo(c: pg.PoolClient, campana: string, prefijoDni = "980000"): Promise<{ expedientes: number }> {
  const { rowCount } = await c.query("SELECT 1 FROM grado WHERE campana_admision = $1", [campana]);
  if ((rowCount ?? 0) > 0) throw new Error(`La campaña ${campana} ya existe: la demo no se repite ni se puede borrar. No se escribió nada.`);

  const actores = await actoresDemo(c);
  const azar = crearAzar(SEMILLA);
  const planes = REPARTO.flatMap(([estado, cantidad]) => Array.from({ length: cantidad }, () => estado));

  // Grado de cada expediente: los primeros con vacante llenan el grado 0; la lista de espera va a ese grado.
  let conVacante = 0;
  const gradoDe = planes.map((estado, i) => {
    if (estado === "lista_espera") return 0;
    if (estado === "vacante_asignada" || estado === "carta_emitida") return conVacante++ < CUPOS_GRADO_LLENO ? 0 : 1 + (conVacante % 3);
    return 1 + (i % 3);
  });
  const idsGrado: number[] = [];
  for (const [i, g] of GRADOS.entries()) {
    const adjudicadas = planes.filter((e, n) => gradoDe[n] === i && (e === "vacante_asignada" || e === "carta_emitida")).length;
    const { rows } = await c.query<{ id_grado: number }>(
      `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso, max_fracciones)
       VALUES ($1::nivel_educativo, $2, $3, $4, $5, 7000, 3) RETURNING id_grado`,
      [g.nivel, g.nombre, campana, g.autorizadas, g.autorizadas - adjudicadas],
    );
    idsGrado.push(rows[0]!.id_grado);
  }

  // Primero se reparten las vacantes: el orden de REPARTO deja la lista de espera para el final, y su hora se lleva después de
  // la última vacante del grado, porque R14 solo la admite con el grado lleno.
  const ultimaVacante = new Map<number, number>();
  const posiciones = new Map<number, number>();

  for (const [i, estadoFinal] of planes.entries()) {
    const n = String(i + 1).padStart(2, "0");
    const indiceGrado = gradoDe[i]!;
    const idApoderado = await insertarApoderado(c, {
      dni: `${prefijoDni}${n}`,
      nombres: "Familia",
      apellidos: `Ficticia ${n}`,
      telefono: `+519800000${n}`,
      correo: `demo-${n}@ejemplo.test`,
    });
    await insertarConsentimiento(c, { idApoderado, versionPolitica: "ficticia-demo", canalOrigen: "formulario_web", autorizaWhatsapp: false });
    const registro = INICIO + Math.floor(azar.entre(0, 21)) * DIA + Math.floor(azar.entre(0, 480)) * MINUTO;
    const { rows } = await c.query<{ id_expediente: number }>(
      `INSERT INTO expediente (id_apoderado_titular, id_grado, fecha_registro, estado, posicion_lista_espera)
       VALUES ($1, $2, $3, $4::estado_expediente, $5) RETURNING id_expediente`,
      [idApoderado, idsGrado[indiceGrado], new Date(registro), estadoFinal, null],
    );
    const id = rows[0]!.id_expediente;
    const h = new Historia(c, id, registro, actores, azar);

    await h.aviso(TIPO_EVENTO_CARPETA, estadoFinal === "contacto_no_entregado" ? "fallido" : "enviado");
    const camino = caminoDe(estadoFinal, i);
    // Uno de cada ocho no asistió a la primera visita y volvió a reservar (HU0004-2.0).
    if (camino.includes("portal_habilitado") && i % 8 === 0) {
      h.avanzar(azar.entre(1, 4));
      await h.transicion("estado", "prospecto", "visita_agendada");
      await h.aviso("visita_confirmada", "enviado");
      h.avanzar(azar.entre(1, 3));
      await h.transicion("estado", "visita_agendada", "prospecto", actores.secretaria);
      await h.aviso("visita_reprogramacion", "enviado");
    }

    let anterior = "prospecto";
    for (const [paso, estado] of camino.entries()) {
      const [minimo, maximo] = DIAS_HASTA[estado]!;
      const siguiente = camino[paso + 1];
      h.avanzar(azar.entre(minimo, maximo));
      if (estado === "lista_espera") h.esperarHasta((ultimaVacante.get(indiceGrado) ?? 0) + DIA);
      if (estado === "contacto_no_entregado") await h.rebote();
      if (ESTADOS_DE_DICTAMEN.includes(estado)) await h.atencion("dictamen", id, "psicologa", azar.entre(15, 40), estado);
      if (estado === "carta_emitida") {
        const idPago = await h.pago("cuota_ingreso", `DEMO-C-${campana}-${n}`, 7000, "conforme");
        await h.cuotaRegistrada(idPago);
        h.avanzar(azar.entre(0.5, 1));
        await h.atencion("pago", idPago, "tesoreria", azar.entre(3, 10), "conforme");
      }
      if (estado === "vacante_asignada" || estado === "lista_espera") await h.atencion("adjudicacion", id, "directora", azar.entre(3, 12), estado);
      const rol = ROL_DE_ESTADO[estado];
      await h.transicion("estado", anterior, estado, rol ? actores[rol] : null);
      if (estado === "visita_agendada") await h.aviso("visita_confirmada", "enviado");
      if (estado === "vacante_asignada") ultimaVacante.set(indiceGrado, Math.max(ultimaVacante.get(indiceGrado) ?? 0, h.hora));
      if (estado === "lista_espera") ultimaVacante.set(indiceGrado, h.hora); // la siguiente entra después de esta
      if (estado === "en_validacion") await etapaValidacion(h, id, i, azar, actores, siguiente !== undefined, `DEMO-D-${campana}-${n}`);
      if (estado === "en_evaluacion") await h.aviso("evaluaciones_confirmadas", "enviado");
      if (estado === "en_evaluacion" && siguiente !== undefined) await etapaEvaluacion(h, azar, 900_000 + i * 10);
      if (estado === "en_evaluacion" && siguiente === undefined && i % 2 === 0) await h.atencion("cita", 900_000 + i * 10, "psicologa", azar.entre(30, 60), "resultado");
      if (estado === "vacante_asignada") await h.aviso("vacante_asignada", "enviado");
      if (estado === "lista_espera") await h.aviso("lista_espera", "enviado");
      if (estado === "no_apto") await h.aviso("dictamen_no_apto", "enviado");
      if (estado === "portal_habilitado") {
        // Algunos avisos con un intento de resultado desconocido antes del cierre (ADR-07): cuentan como uno solo.
        if (i % 6 === 0) await h.aviso("credenciales_portal", "pendiente");
        await h.aviso("credenciales_portal", "enviado");
      }
      anterior = estado;
    }
    if (estadoFinal === "vacante_asignada" && i % 2 === 0) {
      h.avanzar(azar.entre(1, 4));
      await h.cuotaRegistrada(await h.pago("cuota_ingreso", `DEMO-C-${campana}-${n}`, 7000, "pendiente"));
    }
    if (estadoFinal === "lista_espera") {
      const posicion = (posiciones.get(indiceGrado) ?? 0) + 1;
      posiciones.set(indiceGrado, posicion);
      await c.query("UPDATE expediente SET posicion_lista_espera = $2 WHERE id_expediente = $1", [id, posicion]);
    }
    // Ramas de R9: el expediente queda como dice su bitácora.
    if (camino.includes("en_evaluacion")) {
      await c.query("UPDATE expediente SET estado_documental = 'conforme', estado_financiero = 'conforme' WHERE id_expediente = $1", [id]);
    } else if (estadoFinal === "en_validacion" && i % 2 !== 0) {
      await c.query("UPDATE expediente SET estado_documental = 'observado' WHERE id_expediente = $1", [id]);
    }
  }
  await validarDemo(c, campana);
  return { expedientes: TOTAL_DEMO };
}
