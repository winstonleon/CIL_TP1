// Carta de Vacante (HU0016; R18 y C62). La API decide con los datos: Pago de la cuota, fracción 1, conforme; o grado con
// cuota 0. Con el expediente bloqueado genera el PDF, lo guarda cifrado (ADR-21) y, en la misma transacción, crea
// Carta_Vacante y hace vacante_asignada → carta_emitida. Nunca dos cartas: el bloqueo y uq_carta_expediente.
// El aviso se reserva después, en otra transacción: si la API cae entre las dos, el barrido lo retoma sin tocar la carta.
// La carta lleva el nombre de un menor y la firma de la Directora: no viaja por correo ni por n8n. La familia la descarga
// solo desde el portal, con sesión y autorización por expediente (D1-A).
import { Readable } from "node:stream";
import type { Almacenamiento } from "../almacenamiento";
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { insertarEvento } from "../repositories/auditoria";
import { insertarIntento } from "../repositories/aviso";
import {
  bloquearDirectora,
  fijarFirma,
  insertarCarta,
  leerCarta,
  leerDatosDeCarta,
  leerFirmaVigente,
  listarCartasPendientes,
  listarVacantesOtorgadas,
  TIPO_CARTA,
  type FilaCarta,
} from "../repositories/carta";
import { bloquearFichaDeExpediente, leerDatosFamilia } from "../repositories/expediente";
import { avisoAgotado, avisoYaRegistrado, decidirIntento, MAXIMO_PENDIENTES, MINUTOS_REINTENTO } from "./agendamiento";
import { componerCartaEmitida } from "./avisosCarta";
import { formatoPorFirma } from "./cargaArchivo";
import { abrirArchivo, quitarArchivo } from "./documentos";
import { transicionarExpediente } from "./expedientes/transicionarExpediente";
import { codigoExpediente } from "./fichaInscripcion";
import { CAMPANA_DEMO } from "./indicadores";
import { generarPdfCarta } from "./plantillaCarta";

const ESTADO_CARTA = "vacante_asignada";
export const MAXIMO_BYTES_FIRMA = 1024 * 1024;

const expedienteNoEncontrado = () => new ErrorApi(404, "EXPEDIENTE_NO_ENCONTRADO", "El expediente no existe");
const noCorresponde = () => new ErrorApi(409, "CARTA_NO_CORRESPONDE", "El expediente no tiene una vacante otorgada por formalizar");
const noConciliada = () => new ErrorApi(409, "CUOTA_NO_CONCILIADA", "La cuota de ingreso no está conciliada");
const sinFirma = () => new ErrorApi(409, "FIRMA_NO_DISPONIBLE", "Falta cargar la firma de la Directora");
const yaEmitida = () => new ErrorApi(409, "CARTA_YA_EMITIDA", "La Carta de Vacante de este expediente ya está emitida");
const cartaNoEncontrada = () => new ErrorApi(404, "CARTA_NO_ENCONTRADA", "La carta no existe");

async function contenidoDe(flujo: Readable): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of flujo) partes.push(parte as Buffer);
  return Buffer.concat(partes);
}

const nombreCompleto = (...partes: (string | null)[]) => partes.filter(Boolean).join(" ");

export interface EmisionCarta {
  carta: FilaCarta;
  nueva: boolean;
}

// Idempotente: si la carta ya existe, la devuelve sin generar nada. El PDF se guarda dentro de la transacción para que quien
// pierde la carrera no deje ningún archivo; si algo falla después de guardarlo, se elimina. `idPersonal`: null si el actor es
// el sistema (n8n); la directora si lo pidió desde G07. Quien firma es siempre la de leerFirmaVigente.
export async function emitirCarta(almacenamiento: Almacenamiento, idExpediente: number, idPersonal: number | null): Promise<EmisionCarta> {
  let clave: string | null = null;
  try {
    return await enTransaccion(async (c) => {
      if (!(await bloquearFichaDeExpediente(c, idExpediente))) throw expedienteNoEncontrado();
      const existente = await leerCarta(c, idExpediente);
      if (existente) return { carta: existente, nueva: false };

      const d = (await leerDatosDeCarta(c, idExpediente))!;
      if (d.estado !== ESTADO_CARTA || d.campana_admision === CAMPANA_DEMO || !d.nombres) throw noCorresponde();
      if (!d.acreditada) throw noConciliada();
      const firma = await leerFirmaVigente(c, idExpediente);
      if (!firma) {
        // n8n solo registra el flujo y el nodo: sin esta línea, el motivo no quedaría en ningún log. Solo el id.
        console.error(`Carta no emitida: falta la firma de la Directora (expediente ${idExpediente})`);
        throw sinFirma();
      }

      const fechaEmision = new Date();
      const pdf = await generarPdfCarta({
        codigo: codigoExpediente(d.campana_admision, idExpediente),
        fechaEmision,
        postulante: nombreCompleto(d.nombres, d.apellido_paterno, d.apellido_materno),
        nivel: d.nivel,
        grado: d.nombre_grado,
        campana: d.campana_admision,
        directora: nombreCompleto(firma.nombres, firma.apellidos),
        firma: await contenidoDe(await abrirArchivo(almacenamiento, idExpediente, firma.firma_url)),
      });
      clave = (await almacenamiento.guardar(Readable.from(pdf))).clave;
      const carta = await insertarCarta(c, { idExpediente, idPersonalAutoriza: firma.id_personal, fechaEmision, clave });
      await transicionarExpediente(c, {
        idExpediente,
        campo: "estado",
        esperado: ESTADO_CARTA,
        nuevo: "carta_emitida",
        idPersonal,
        detalle: { id_carta: carta.id_carta },
      });
      return { carta, nueva: true };
    });
  } catch (error) {
    if (clave) await quitarArchivo(almacenamiento, clave);
    throw error;
  }
}

export interface AvisoCarta {
  id_expediente: number;
  id_notificacion: number;
  tipo_evento: string;
  asunto: string;
  cuerpo: string;
}

type ResultadoAviso = { aviso: AvisoCarta } | { conflicto: ErrorApi };
const SIN_ANCLA = new Date(0);

// ADR-07: una fila por intento, retoma a los 10 min y tope de 6 con fila de cierre. Hay una sola carta por expediente: todas
// las filas del tipo son de este aviso (SIN_ANCLA). Los conflictos se lanzan después del COMMIT: la fila de cierre debe quedar.
export async function reservarAvisoCarta(idExpediente: number): Promise<AvisoCarta> {
  const r = await enTransaccion<ResultadoAviso>(async (c) => {
    if (!(await bloquearFichaDeExpediente(c, idExpediente))) throw expedienteNoEncontrado();
    const carta = await leerCarta(c, idExpediente);
    if (!carta) return { conflicto: noCorresponde() };
    const decision = await decidirIntento(c, { idExpediente, tipoEvento: TIPO_CARTA, ancla: SIN_ANCLA });
    if (decision.accion === "cerrado" || decision.accion === "en_curso") return { conflicto: avisoYaRegistrado() };
    if (decision.accion === "agotar") {
      await insertarIntento(c, { idExpediente, tipoEvento: TIPO_CARTA, estadoEnvio: "fallido" });
      return { conflicto: avisoAgotado() };
    }
    const id = await insertarIntento(c, { idExpediente, tipoEvento: TIPO_CARTA, estadoEnvio: "pendiente" });
    const familia = (await leerDatosFamilia(c, idExpediente))!;
    return {
      aviso: {
        id_expediente: idExpediente,
        id_notificacion: id,
        tipo_evento: TIPO_CARTA,
        ...componerCartaEmitida({ nombres: familia.nombres, campana: familia.campana_admision }),
      },
    };
  });
  if ("conflicto" in r) throw r.conflicto;
  return r.aviso;
}

// POST /internal/expedientes/:id/carta-vacante: la emite si hace falta y reserva el aviso.
export async function generarCartaConAviso(almacenamiento: Almacenamiento, idExpediente: number): Promise<AvisoCarta> {
  await emitirCarta(almacenamiento, idExpediente, null);
  return reservarAvisoCarta(idExpediente);
}

// POST /direccion/expedientes/:id/carta (HU0016-2.0, D5-A): la misma emisión, a pedido de la directora.
export async function emitirCartaManual(almacenamiento: Almacenamiento, idExpediente: number, idPersonal: number) {
  const { carta, nueva } = await emitirCarta(almacenamiento, idExpediente, idPersonal);
  if (!nueva) throw yaEmitida();
  return { id_carta: carta.id_carta };
}

export async function cartasPendientes(): Promise<{ expedientes: { id_expediente: number }[] }> {
  const ids = await listarCartasPendientes(obtenerPool(), {
    campanaExcluida: CAMPANA_DEMO,
    tipoEvento: TIPO_CARTA,
    minutosReintento: MINUTOS_REINTENTO,
    limite: MAXIMO_PENDIENTES,
  });
  return { expedientes: ids.map((id_expediente) => ({ id_expediente })) };
}

// GET /direccion/cartas (G07, HU0016-2.0): `emitible` es la misma condición de R18.
export async function vacantesOtorgadas(campana: string) {
  const filas = await listarVacantesOtorgadas(obtenerPool(), campana);
  return {
    items: filas.map((f) => ({
      id_expediente: f.id_expediente,
      codigo: codigoExpediente(campana, f.id_expediente),
      postulante: { nombres: f.nombres, apellidos: f.apellidos || null },
      grado: f.nombre_grado,
      // Un Pago existente manda: si el grado pasó a cuota 0 después de registrarlo, decide Tesorería (C25 7).
      cuota: f.estado_pago ?? (Number(f.monto_cuota_ingreso) === 0 ? "no_aplica" : "sin_registrar"),
      emitible: f.acreditada,
    })),
  };
}

// GET /familia/expedientes/:id/carta: el PDF ya descifrado y verificado. La autorización por expediente es de la ruta.
export async function abrirCarta(almacenamiento: Almacenamiento, idExpediente: number, campana: string): Promise<{ codigo: string; contenido: Buffer }> {
  const carta = await leerCarta(obtenerPool(), idExpediente);
  if (!carta) throw cartaNoEncontrada();
  const contenido = await contenidoDe(await abrirArchivo(almacenamiento, idExpediente, carta.url_documento));
  return { codigo: codigoExpediente(campana, idExpediente), contenido };
}

// npm run firma:cargar (D2-A): solo PNG o JPG, por sus bytes, hasta 1 MB, y una imagen que el PDF pueda incrustar. Sin ruta
// HTTP: la firma nunca sale de la API. La anterior se borra después del COMMIT, porque las cartas emitidas ya la llevan.
export async function cargarFirma(almacenamiento: Almacenamiento, correo: string, imagen: Buffer): Promise<{ id_personal: number }> {
  const formato = formatoPorFirma(imagen);
  if (formato !== "png" && formato !== "jpg") throw new ErrorApi(415, "FORMATO_NO_ADMITIDO", "La firma debe ser una imagen PNG o JPG");
  if (imagen.length > MAXIMO_BYTES_FIRMA) throw new ErrorApi(413, "ARCHIVO_DEMASIADO_GRANDE", "La firma pesa más de 1 MB");
  await generarPdfCarta({ codigo: "PRUEBA", fechaEmision: new Date(), postulante: "", nivel: "", grado: "", campana: "", directora: "", firma: imagen }).catch(() => {
    throw new ErrorApi(415, "FORMATO_NO_ADMITIDO", "La imagen de la firma no se puede leer");
  });

  const { clave } = await almacenamiento.guardar(Readable.from(imagen));
  let anterior: string | null = null;
  try {
    const idPersonal = await enTransaccion(async (c) => {
      const directora = await bloquearDirectora(c, correo);
      if (!directora) throw new ErrorApi(404, "DIRECTORA_NO_ENCONTRADA", "No hay una cuenta de directora activa con ese correo");
      anterior = directora.firma_url;
      await fijarFirma(c, directora.id_personal, clave);
      await insertarEvento(c, { tipoEvento: "gestion_usuario", detalle: { accion: "firma_cargada", id_personal_afectado: directora.id_personal } });
      return directora.id_personal;
    });
    if (anterior) await quitarArchivo(almacenamiento, anterior);
    return { id_personal: idPersonal };
  } catch (error) {
    await quitarArchivo(almacenamiento, clave);
    throw error;
  }
}
