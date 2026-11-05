// Fixtures del bloque 5 (HU0008, HU0011 y HU0024): un expediente que llega a en_validacion por el camino real (ficha,
// cargas de P06, derecho de P07b, confirmación y verificación de HU0017) y el personal de Secretaría y Tesorería con su
// fila activa (C22). Datos ficticios @ejemplo.test.
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import type { Consultable } from "../src/db/pool";
import { BANCOS } from "../src/services/derechoAdmision";
import { crearFirmante, crearPersonal, unico } from "./ayudantes";
import { familiaConFicha, pdf, rutaConfirmacion, rutaDerecho, rutaDocumentos, subir } from "./ayudantesCarga";
import { entornoFicha, requisito } from "./ayudantesFicha";

export const TOKEN_INTERNO = () => process.env.INTERNAL_API_TOKEN!;

type Firmante = Awaited<ReturnType<typeof crearFirmante>>;

export async function entornoValidacion(db: Consultable, firmante: Firmante) {
  const e = await entornoFicha(db, firmante);
  // Personal con su fila activa y su token (dos por rol, para las pruebas de «dos personas del mismo rol»).
  const persona = async (rol: "secretaria" | "tesoreria") => {
    const sub = randomUUID();
    const idPersonal = await crearPersonal(db, rol, sub);
    return { sub, idPersonal, token: await firmante.token(sub, [rol]) };
  };
  const secretaria = await persona("secretaria");
  const secretaria2 = await persona("secretaria");
  const tesoreria = await persona("tesoreria");
  const tesoreria2 = await persona("tesoreria");

  // Expediente en en_validacion: partida y DNI (Secretaría), boletas de la madre titular dependiente (Tesorería) y el
  // derecho registrado. El padre es independiente: no se le exigen boletas.
  async function enValidacion(opciones: { boletasPorDocumento?: number; sinFinancieros?: boolean } = {}) {
    let ids!: { partida: number; dni: number; boletas: number };
    const f = await familiaConFicha(db, e, async (g) => {
      ids = {
        partida: await requisito(db, g, "Partida de nacimiento", "todos"),
        dni: await requisito(db, g, "DNI del postulante", "todos"),
        boletas: opciones.sinFinancieros ? 0 : await requisito(db, g, "Boletas de pago", "si_dependiente", { categoria: "financiero", porApoderado: true }),
      };
    });
    const cargar = async (idRequisito: number, idApoderado?: number) => {
      const res = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: idRequisito, ...(idApoderado ? { id_apoderado: idApoderado } : {}) }, pdf(`documento ${unico()}`));
      if (res.status !== 201) throw new Error(`Carga de prueba fallida (${res.status})`);
      return res.body.id_documento as number;
    };
    const docs = {
      partida: await cargar(ids.partida),
      dni: await cargar(ids.dni),
      boletas: [] as number[],
    };
    const boletas = opciones.sinFinancieros ? 0 : (opciones.boletasPorDocumento ?? 1);
    for (let i = 0; i < boletas; i++) docs.boletas.push(await cargar(ids.boletas, f.idApoderado));
    const operacion = `OP-${unico()}`;
    const derecho = await subir(e.app, rutaDerecho(f.idExpediente), f.token, { banco: BANCOS[0], numero_operacion: operacion, fecha_pago: "2026-10-10" }, pdf("voucher ficticio"), "voucher.pdf");
    if (derecho.status !== 201) throw new Error(`Derecho de prueba fallido (${derecho.status})`);
    if ((await request(e.app).post(rutaConfirmacion(f.idExpediente)).set("Authorization", `Bearer ${f.token}`).send({})).status !== 200) {
      throw new Error("Confirmación de prueba fallida");
    }
    const v = await request(e.app).post(`/internal/expedientes/${f.idExpediente}/verificacion-completitud`).set("Authorization", `Bearer ${TOKEN_INTERNO()}`).send();
    if (v.status !== 200) throw new Error(`Verificación de prueba fallida (${v.status})`);
    const { rows } = await db.query<{ id_pago: number }>("SELECT id_pago FROM pago WHERE id_expediente = $1", [f.idExpediente]);
    e.eventos.disparar.mockClear();
    return { f, ids, docs, idPago: rows[0]!.id_pago, operacion };
  }

  // Peticiones del personal con su token (`como` de entornoFicha sigue siendo el de la familia).
  const api = (token: string) => ({
    get: (ruta: string) => request(e.app).get(ruta).set("Authorization", `Bearer ${token}`),
    post: (ruta: string, cuerpo: object = {}) => request(e.app).post(ruta).set("Authorization", `Bearer ${token}`).send(cuerpo),
  });

  return { ...e, secretaria, secretaria2, tesoreria, tesoreria2, enValidacion, api };
}

export type EntornoValidacion = Awaited<ReturnType<typeof entornoValidacion>>;
export type ExpedienteEnValidacion = Awaited<ReturnType<EntornoValidacion["enValidacion"]>>;

// Rutas del personal.
export const rutaDetalle = (id: number) => `/bandeja/expedientes/${id}`;
export const rutaDecisionSecretaria = (id: number, doc: number) => `/bandeja/expedientes/${id}/documentos/${doc}/decision`;
export const rutaArchivoSecretaria = (id: number, doc: number) => `/bandeja/expedientes/${id}/documentos/${doc}/archivo`;
export const rutaConformidadDocumental = (id: number) => `/bandeja/expedientes/${id}/validacion-documental`;
export const rutaFinanciera = (id: number) => `/tesoreria/expedientes/${id}/documentacion-financiera`;
export const rutaDecisionTesoreria = (id: number, doc: number) => `/tesoreria/expedientes/${id}/documentos/${doc}/decision`;
export const rutaArchivoTesoreria = (id: number, doc: number) => `/tesoreria/expedientes/${id}/documentos/${doc}/archivo`;
export const rutaConformidadFinanciera = (id: number) => `/tesoreria/expedientes/${id}/validacion-financiera`;
export const rutaPago = (idPago: number) => `/tesoreria/pagos/${idPago}`;
export const rutaDecisionPago = (idPago: number) => `${rutaPago(idPago)}/decision`;

export const CONFORME = { decision: "conforme" };
export const observar = (motivo: string) => ({ decision: "observado", motivo });

// PUT multipart de la subsanación del derecho (P07b, A1).
export function subirPut(app: Express, ruta: string, token: string, campos: Record<string, string>, contenido: Buffer) {
  let r = request(app).put(ruta).set("Authorization", `Bearer ${token}`);
  for (const [k, v] of Object.entries(campos)) r = r.field(k, v);
  return r.attach("archivo", contenido, { filename: "voucher.pdf", contentType: "application/pdf" });
}
