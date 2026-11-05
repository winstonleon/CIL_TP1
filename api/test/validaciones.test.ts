// Validaciones en paralelo (HU0008, HU0011 y HU0024; R9; plan del bloque 5) por las rutas reales del personal (/bandeja,
// /tesoreria), de la familia (subsanación A1) y de n8n (/internal, aviso de observaciones). Cubre las tres ramas, la unión
// (también con dos decisiones a la vez), la independencia de las ramas, el tiempo de atención (§4.7), dos personas del
// mismo rol, R2 en la ruta real (HU0021-2.0, C17), las descargas del personal, C22, la bandeja (C51) y el aviso (ADR-07).
// Datos ficticios @ejemplo.test; n8n se simula con el disparador falso de entornoFicha.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { BANCOS } from "../src/services/derechoAdmision";
import { crearFirmante, eventosDe, unico } from "./ayudantes";
import { archivosAlmacenados, familiaConFicha, pdf, rutaDerecho, rutaDocumentos, subir } from "./ayudantesCarga";
import { requisito } from "./ayudantesFicha";
import { estadoDe, intentadaHace, intentosDe } from "./ayudantesVisita";
import {
  CONFORME,
  entornoValidacion,
  observar,
  rutaArchivoSecretaria,
  rutaArchivoTesoreria,
  rutaConformidadDocumental,
  rutaConformidadFinanciera,
  rutaDecisionPago,
  rutaDecisionSecretaria,
  rutaDecisionTesoreria,
  rutaDetalle,
  rutaFinanciera,
  rutaPago,
  subirPut,
  TOKEN_INTERNO,
  type EntornoValidacion,
  type ExpedienteEnValidacion,
} from "./ayudantesValidacion";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let e: EntornoValidacion;

beforeAll(async () => {
  firmante = await crearFirmante();
  e = await entornoValidacion(db(), firmante);
});
afterAll(cerrarPool);

const FRONT = () => process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "");
const sec = () => e.api(e.secretaria.token);
const tes = () => e.api(e.tesoreria.token);
const eventosTipo = async (idExpediente: number, tipo: string) => (await eventosDe(db(), idExpediente)).filter((ev) => ev.tipo_evento === tipo);
const ramas = async (idExpediente: number) =>
  (
    await db().query(
      `SELECT e.estado::text AS estado, e.estado_documental::text AS documental, e.estado_financiero::text AS financiera,
              p.estado_validacion::text AS derecho
         FROM expediente e LEFT JOIN pago p ON p.id_expediente = e.id_expediente AND p.tipo_pago = 'derecho_admision'
        WHERE e.id_expediente = $1`,
      [idExpediente],
    )
  ).rows[0];
const documento = async (id: number) =>
  (await db().query("SELECT estado_verificacion::text AS estado, motivo_observacion, id_personal_revisor, vigente FROM documento WHERE id_documento = $1", [id])).rows[0];
const pagoDe = async (idPago: number) => (await db().query("SELECT *, estado_validacion::text AS estado FROM pago WHERE id_pago = $1", [idPago])).rows[0];
const avisosDe = (idExpediente: number) => intentosDe(db(), idExpediente, "subsanacion_solicitada");
const reservarAviso = (idExpediente: number, cuerpo?: object) =>
  request(e.app).post(`/internal/expedientes/${idExpediente}/aviso-observacion`).set("Authorization", `Bearer ${TOKEN_INTERNO()}`).send(cuerpo ?? {});
const pendientesAviso = async () =>
  ((await request(e.app).get("/internal/observaciones/pendientes").set("Authorization", `Bearer ${TOKEN_INTERNO()}`)).body.expedientes as { id_expediente: number }[]).map(
    (x) => x.id_expediente,
  );
const reemplazar = (x: ExpedienteEnValidacion, idRequisito: number, reemplaza: number, idApoderado?: number) =>
  subir(e.app, rutaDocumentos(x.f.idExpediente), x.f.token, { id_requisito: idRequisito, reemplaza, ...(idApoderado ? { id_apoderado: idApoderado } : {}) }, pdf(`nítido ${unico()}`));
const unionesDe = async (idExpediente: number) =>
  (await eventosTipo(idExpediente, "atencion_fin")).filter((ev) => ev.detalle.habilita_agendamiento === true);

// Deja conformes los documentos de las dos ramas (sin confirmar ninguna) y el comprobante.
async function todoConformeSalvoConfirmar(x: ExpedienteEnValidacion, { pago = true } = {}) {
  for (const doc of [x.docs.partida, x.docs.dni]) expect((await sec().post(rutaDecisionSecretaria(x.f.idExpediente, doc), CONFORME)).status).toBe(200);
  for (const doc of x.docs.boletas) expect((await tes().post(rutaDecisionTesoreria(x.f.idExpediente, doc), CONFORME)).status).toBe(200);
  if (pago) expect((await tes().post(rutaDecisionPago(x.idPago), CONFORME)).status).toBe(200);
}

describe("HU0008-1.0 conformidad documental del expediente", () => {
  it("HU0008-1.0 Secretaría marca cada documento conforme y da la conformidad: la rama documental queda conforme con auditoría y las ramas de Tesorería siguen pendientes", async () => {
    const x = await e.enValidacion();
    for (const doc of [x.docs.partida, x.docs.dni]) {
      const res = await sec().post(rutaDecisionSecretaria(x.f.idExpediente, doc), CONFORME);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ documento: { id_documento: doc, estado_verificacion: "conforme" }, rama: "pendiente", id_notificacion: null });
      expect(await documento(doc)).toMatchObject({ estado: "conforme", motivo_observacion: null, id_personal_revisor: e.secretaria.idPersonal });
    }

    const res = await sec().post(rutaConformidadDocumental(x.f.idExpediente));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rama: "conforme", agendamiento_habilitado: false });
    expect(await ramas(x.f.idExpediente)).toEqual({ estado: "en_validacion", documental: "conforme", financiera: "pendiente", derecho: "pendiente" });
    const transicion = (await eventosTipo(x.f.idExpediente, "transicion_estado")).filter((t) => t.detalle.campo === "estado_documental");
    expect(transicion).toEqual([
      expect.objectContaining({ id_personal: e.secretaria.idPersonal, estado_anterior: "pendiente", estado_nuevo: "conforme", detalle: { campo: "estado_documental" } }),
    ]);
    expect(await unionesDe(x.f.idExpediente)).toEqual([]);
    expect(e.eventos.disparar).not.toHaveBeenCalled();
  });

  it("HU0008-1.0 «Dar conformidad» con un documento sin revisar responde 409 DOCUMENTOS_SIN_REVISAR y la rama sigue pendiente", async () => {
    const x = await e.enValidacion();
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), CONFORME);

    const res = await sec().post(rutaConformidadDocumental(x.f.idExpediente));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ codigo: "DOCUMENTOS_SIN_REVISAR", detalle: { pendientes: 1 } });
    expect((await ramas(x.f.idExpediente)).documental).toBe("pendiente");
  });

  it("HU0008-1.0 con las tres ramas conformes, la última decisión habilita el agendamiento una sola vez y el expediente sigue en en_validacion", async () => {
    const x = await e.enValidacion();
    await todoConformeSalvoConfirmar(x);
    const financiera = await tes().post(rutaConformidadFinanciera(x.f.idExpediente));
    expect(financiera.body).toEqual({ rama: "conforme", agendamiento_habilitado: false });

    const documental = await sec().post(rutaConformidadDocumental(x.f.idExpediente));

    expect(documental.body).toEqual({ rama: "conforme", agendamiento_habilitado: true });
    expect(await ramas(x.f.idExpediente)).toEqual({ estado: "en_validacion", documental: "conforme", financiera: "conforme", derecho: "conforme" });
    const uniones = await unionesDe(x.f.idExpediente);
    expect(uniones).toHaveLength(1);
    expect(uniones[0]).toMatchObject({ id_personal: e.secretaria.idPersonal, detalle: { item: { tipo: "validacion_documental", id: x.f.idExpediente }, decision: "conforme" } });
    // B1: sin transición del expediente ni evento a n8n; G03 lo muestra habilitado.
    expect((await eventosTipo(x.f.idExpediente, "transicion_estado")).filter((t) => t.detalle.campo === "estado" && t.estado_anterior === "en_validacion")).toEqual([]);
    expect(e.eventos.disparar).not.toHaveBeenCalled();
    expect((await sec().get(rutaDetalle(x.f.idExpediente))).body.agendamiento_habilitado).toBe(true);
    // Ya no hay nada que decidir: otra conformidad es 409.
    expect((await sec().post(rutaConformidadDocumental(x.f.idExpediente))).body.error.codigo).toBe("VALIDACION_YA_REGISTRADA");
  });

  it("HU0008-1.0 (concurrencia) Secretaría y Tesorería dan a la vez la conformidad de las dos últimas ramas: el agendamiento se habilita exactamente una vez", async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const x = await e.enValidacion();
      await todoConformeSalvoConfirmar(x);

      const [documental, financiera] = await Promise.all([
        sec().post(rutaConformidadDocumental(x.f.idExpediente)),
        tes().post(rutaConformidadFinanciera(x.f.idExpediente)),
      ]);

      expect([documental.status, financiera.status]).toEqual([200, 200]);
      expect([documental.body.agendamiento_habilitado, financiera.body.agendamiento_habilitado].filter(Boolean)).toHaveLength(1);
      expect(await unionesDe(x.f.idExpediente)).toHaveLength(1);
      expect(await ramas(x.f.idExpediente)).toEqual({ estado: "en_validacion", documental: "conforme", financiera: "conforme", derecho: "conforme" });
    }
  });

  it("HU0008-1.0 (concurrencia) el comprobante y la documentación financiera conformes a la vez, con la rama documental ya conforme, también registran la unión una sola vez", async () => {
    const x = await e.enValidacion();
    await todoConformeSalvoConfirmar(x, { pago: false });
    await sec().post(rutaConformidadDocumental(x.f.idExpediente));

    const [pago, financiera] = await Promise.all([
      e.api(e.tesoreria2.token).post(rutaDecisionPago(x.idPago), CONFORME),
      tes().post(rutaConformidadFinanciera(x.f.idExpediente)),
    ]);

    expect([pago.status, financiera.status]).toEqual([200, 200]);
    expect([pago.body.agendamiento_habilitado, financiera.body.agendamiento_habilitado].filter(Boolean)).toHaveLength(1);
    expect(await unionesDe(x.f.idExpediente)).toHaveLength(1);
  });

  it("HU0008-1.0 (atención) abrir G03 registra atencion_inicio y la decisión registra atencion_fin emparejado con el ítem, la decisión e id_evento_inicio", async () => {
    const x = await e.enValidacion();
    const item = { tipo: "validacion_documental", id: x.f.idExpediente };

    const detalle = await sec().get(rutaDetalle(x.f.idExpediente));
    expect(detalle.status).toBe(200);
    const [inicio] = await eventosTipo(x.f.idExpediente, "atencion_inicio");
    expect(inicio).toMatchObject({ id_personal: e.secretaria.idPersonal, detalle: { item } });

    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), CONFORME);
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.dni), CONFORME);
    // Las marcas por documento no cierran la atención: es parte del mismo ítem.
    expect(await eventosTipo(x.f.idExpediente, "atencion_fin")).toEqual([]);
    await sec().post(rutaConformidadDocumental(x.f.idExpediente));

    const fines = await eventosTipo(x.f.idExpediente, "atencion_fin");
    expect(fines).toEqual([
      expect.objectContaining({ id_personal: e.secretaria.idPersonal, detalle: { item, decision: "conforme", id_evento_inicio: Number(inicio.id_evento) } }),
    ]);
    expect(new Date(fines[0].fecha_hora).getTime()).toBeGreaterThanOrEqual(new Date(inicio.fecha_hora).getTime());
    // Con la rama conforme, abrirla otra vez ya no abre un ítem de atención.
    await sec().get(rutaDetalle(x.f.idExpediente));
    expect(await eventosTipo(x.f.idExpediente, "atencion_inicio")).toHaveLength(1);
  });

  it("HU0024-1.0 (atención) en G05 el comprobante y la documentación financiera son ítems distintos, cada uno con su par inicio/fin", async () => {
    const x = await e.enValidacion();
    await tes().get(rutaPago(x.idPago));
    await tes().get(rutaFinanciera(x.f.idExpediente));
    const inicios = await eventosTipo(x.f.idExpediente, "atencion_inicio");
    const idInicio = (tipo: string) => Number(inicios.find((i) => i.detalle.item.tipo === tipo)!.id_evento);

    await tes().post(rutaDecisionPago(x.idPago), CONFORME);
    await tes().post(rutaDecisionTesoreria(x.f.idExpediente, x.docs.boletas[0]!), observar("Falta la boleta de agosto de 2026."));

    const fines = await eventosTipo(x.f.idExpediente, "atencion_fin");
    expect(fines.map((f) => f.detalle)).toEqual([
      { item: { tipo: "pago", id: x.idPago }, decision: "conforme", id_evento_inicio: idInicio("pago"), id_pago: x.idPago },
      {
        item: { tipo: "documentacion_financiera", id: x.f.idExpediente },
        decision: "observado",
        id_evento_inicio: idInicio("documentacion_financiera"),
        id_documento: x.docs.boletas[0],
        id_notificacion: expect.any(Number),
      },
    ]);
  });

  it("HU0008-1.0 (dos personas) la segunda decisión sobre un documento ya revisado responde 409 DOCUMENTO_YA_REVISADO y no pisa la primera; su atencion_inicio queda sin fin", async () => {
    const x = await e.enValidacion();
    const otra = e.api(e.secretaria2.token);
    await sec().get(rutaDetalle(x.f.idExpediente));
    await otra.get(rutaDetalle(x.f.idExpediente));
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar("La imagen está borrosa."));

    const segunda = await otra.post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), CONFORME);

    expect(segunda.status).toBe(409);
    expect(segunda.body.error).toMatchObject({ codigo: "DOCUMENTO_YA_REVISADO", detalle: { estado_verificacion: "observado" } });
    expect(await documento(x.docs.partida)).toMatchObject({ estado: "observado", motivo_observacion: "La imagen está borrosa.", id_personal_revisor: e.secretaria.idPersonal });
    const inicioOtra = (await eventosTipo(x.f.idExpediente, "atencion_inicio")).find((i) => i.id_personal === e.secretaria2.idPersonal)!;
    const fines = await eventosTipo(x.f.idExpediente, "atencion_fin");
    expect(fines.some((f) => Number(f.detalle.id_evento_inicio) === Number(inicioOtra.id_evento))).toBe(false);
    expect(fines.every((f) => f.id_personal === e.secretaria.idPersonal)).toBe(true);
  });

  it("HU0008-2.0 [parte: correo] (atención) abrir G03 con la rama observada y sin documentos por revisar no abre un ítem: espera a la familia", async () => {
    const x = await e.enValidacion();
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar("Borrosa."));
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.dni), CONFORME);
    const antes = (await eventosTipo(x.f.idExpediente, "atencion_inicio")).length;

    expect((await sec().get(rutaDetalle(x.f.idExpediente))).status).toBe(200);

    expect(await eventosTipo(x.f.idExpediente, "atencion_inicio")).toHaveLength(antes);
    // Tras la subsanación hay un documento por revisar: abrirlo sí abre el ítem.
    await reemplazar(x, x.ids.partida, x.docs.partida);
    await sec().get(rutaDetalle(x.f.idExpediente));
    expect(await eventosTipo(x.f.idExpediente, "atencion_inicio")).toHaveLength(antes + 1);
  });

  it("HU0008-1.0 fuera de en_validacion no se valida: 409 VALIDACION_NO_CORRESPONDE", async () => {
    const f = await familiaConFicha(db(), e);
    for (const res of [await sec().get(rutaDetalle(f.idExpediente)), await sec().post(rutaConformidadDocumental(f.idExpediente))]) {
      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe("VALIDACION_NO_CORRESPONDE");
    }
    expect((await sec().get(rutaDetalle(2147483000))).status).toBe(404);
  });
});

describe("HU0008-2.0 observación de un documento ilegible o incorrecto", () => {
  it("HU0008-2.0 [parte: correo] «Solicitar subsanación» marca el documento y la validación documental como observados, sin detener las validaciones de Tesorería, y despacha el aviso con el motivo y el enlace", async () => {
    const x = await e.enValidacion();
    const motivo = "La imagen está borrosa y no se lee el número. Sube una foto nítida.";

    const res = await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar(motivo));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ documento: { id_documento: x.docs.partida, estado_verificacion: "observado" }, rama: "observado", id_notificacion: expect.any(Number) });
    expect(await documento(x.docs.partida)).toMatchObject({ estado: "observado", motivo_observacion: motivo, vigente: true });
    expect(await ramas(x.f.idExpediente)).toEqual({ estado: "en_validacion", documental: "observado", financiera: "pendiente", derecho: "pendiente" });
    expect((await eventosTipo(x.f.idExpediente, "transicion_estado")).filter((t) => t.detalle.campo === "estado_documental")).toEqual([
      expect.objectContaining({ id_personal: e.secretaria.idPersonal, estado_anterior: "pendiente", estado_nuevo: "observado", detalle: { campo: "estado_documental", id_documento: x.docs.partida } }),
    ]);
    // ADR-16: solo ids, después de responder.
    expect(await avisosDe(x.f.idExpediente)).toEqual([{ id_notificacion: res.body.id_notificacion, tipo_evento: "subsanacion_solicitada", estado_envio: "pendiente" }]);
    expect(e.eventos.disparar).toHaveBeenCalledWith("verificacion-completitud", { id_expediente: x.f.idExpediente, id_notificacion: res.body.id_notificacion });

    // Las validaciones de Tesorería siguen (R9).
    await tes().post(rutaDecisionTesoreria(x.f.idExpediente, x.docs.boletas[0]!), CONFORME);
    expect((await tes().post(rutaConformidadFinanciera(x.f.idExpediente))).status).toBe(200);
    expect((await tes().post(rutaDecisionPago(x.idPago), CONFORME)).status).toBe(200);
    // El otro documento se sigue revisando, pero sin todos conformes no hay conformidad.
    expect((await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.dni), CONFORME)).status).toBe(200);
    expect((await sec().post(rutaConformidadDocumental(x.f.idExpediente))).body.error.codigo).toBe("DOCUMENTOS_SIN_REVISAR");

    // n8n arma el correo con el primer intento: el motivo y el enlace para reemplazar solo lo observado.
    const aviso = await reservarAviso(x.f.idExpediente, { id_notificacion: res.body.id_notificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body).toMatchObject({ id_expediente: x.f.idExpediente, id_notificacion: res.body.id_notificacion, tipo_evento: "subsanacion_solicitada" });
    expect(aviso.body.asunto).toMatch(/^Observaciones en tu expediente · Admisión /);
    expect((aviso.body.cuerpo as string).split("\n")).toEqual([
      "Hola, María Fernanda:",
      "",
      "[Aviso de observaciones del expediente: por definir con el colegio]",
      "",
      "Revisamos tu expediente y encontramos estas observaciones:",
      `- Partida de nacimiento: ${motivo}`,
      "",
      `Reemplaza solo los documentos observados en el portal: ${FRONT()}/portal/documentos`,
      "",
      "[Datos de contacto de Admisión: por definir con el colegio]",
    ]);
    // El mismo intento ya no se vuelve a armar por el webhook mientras no venza (lo retoma el barrido).
    expect(await avisosDe(x.f.idExpediente)).toHaveLength(1);
  });

  it("HU0008-2.0 [parte: correo] el motivo es obligatorio: sin motivo o vacío, 400 y nada cambia", async () => {
    const x = await e.enValidacion();
    for (const cuerpo of [{ decision: "observado" }, observar("   "), { decision: "observado", motivo: "x".repeat(501) }, { decision: "otra" }, { ...CONFORME, motivo: "de más" }]) {
      const res = await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), cuerpo);
      expect(res.status).toBe(400);
    }
    expect(await documento(x.docs.partida)).toMatchObject({ estado: "pendiente", motivo_observacion: null });
    expect(await avisosDe(x.f.idExpediente)).toEqual([]);
  });

  it("HU0008-2.0 [parte: correo] (subsanación) la familia reemplaza solo el documento observado: la rama vuelve a pendiente, queda subsanacion_registrada y el motivo se muestra como anterior", async () => {
    const x = await e.enValidacion();
    const motivo = "No corresponde al requisito.";
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar(motivo));
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.dni), CONFORME);
    const archivos = (await archivosAlmacenados()).length;

    // Solo lo observado: ni un documento conforme ni una carga nueva.
    const conforme = await reemplazar(x, x.ids.dni, x.docs.dni);
    expect([conforme.status, conforme.body.error.codigo]).toEqual([409, "DOCUMENTO_NO_OBSERVADO"]);
    const nueva = await subir(e.app, rutaDocumentos(x.f.idExpediente), x.f.token, { id_requisito: x.ids.partida }, pdf());
    expect([nueva.status, nueva.body.error.codigo]).toEqual([409, "DOCUMENTOS_NO_EDITABLES"]);
    expect((await archivosAlmacenados()).length).toBe(archivos);
    // P06 muestra el motivo vigente del observado.
    const antes = await request(e.app).get(rutaDocumentos(x.f.idExpediente)).set("Authorization", `Bearer ${x.f.token}`);
    expect(antes.body).toMatchObject({ editable: false, subsanacion: true });
    const partidaAntes = antes.body.requisitos.find((r: { id_requisito: number }) => r.id_requisito === x.ids.partida).documentos[0];
    expect(partidaAntes).toMatchObject({ id_documento: x.docs.partida, estado_verificacion: "observado", motivo_observacion: motivo, motivo_anterior: null });

    const res = await reemplazar(x, x.ids.partida, x.docs.partida);

    expect(res.status).toBe(201);
    const idNuevo = res.body.id_documento as number;
    expect(await documento(x.docs.partida)).toMatchObject({ estado: "observado", motivo_observacion: motivo, vigente: false });
    expect(await documento(idNuevo)).toMatchObject({ estado: "pendiente", motivo_observacion: null, vigente: true });
    expect((await ramas(x.f.idExpediente)).documental).toBe("pendiente");
    const [subsanacion] = await eventosTipo(x.f.idExpediente, "subsanacion_registrada");
    expect(subsanacion).toMatchObject({
      id_personal: null,
      detalle: { item: { tipo: "validacion_documental", id: x.f.idExpediente }, id_documento_nuevo: idNuevo, id_documento_anterior: x.docs.partida },
    });
    expect((await eventosTipo(x.f.idExpediente, "transicion_estado")).filter((t) => t.detalle.campo === "estado_documental").at(-1)).toMatchObject({
      id_personal: null,
      estado_anterior: "observado",
      estado_nuevo: "pendiente",
      detalle: { campo: "estado_documental", origen: "subsanacion", id_documento: idNuevo },
    });

    // G03, G02 y P06: el ítem pendiente muestra su motivo como anterior, no como observación vigente.
    const detalle = await sec().get(rutaDetalle(x.f.idExpediente));
    expect(detalle.body.documentos.find((d: { id_documento: number }) => d.id_documento === idNuevo)).toMatchObject({
      estado_verificacion: "pendiente",
      motivo_observacion: null,
      motivo_anterior: motivo,
    });
    expect(detalle.body.documentos.some((d: { id_documento: number }) => d.id_documento === x.docs.partida)).toBe(false);
    const bandeja = await sec().get("/bandeja/expedientes?vista=por_revisar");
    expect(bandeja.body.expedientes.find((b: { id_expediente: number }) => b.id_expediente === x.f.idExpediente)).toMatchObject({
      estado_documental: "pendiente",
      subsanado: true,
      motivos_anteriores: [motivo],
    });
    const despues = await request(e.app).get(rutaDocumentos(x.f.idExpediente)).set("Authorization", `Bearer ${x.f.token}`);
    expect(despues.body.requisitos.find((r: { id_requisito: number }) => r.id_requisito === x.ids.partida).documentos).toEqual([
      expect.objectContaining({ id_documento: idNuevo, estado_verificacion: "pendiente", motivo_observacion: null, motivo_anterior: motivo }),
    ]);

    // Con el reemplazo revisado, la rama se puede dar conforme.
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, idNuevo), CONFORME);
    expect((await sec().post(rutaConformidadDocumental(x.f.idExpediente))).body.rama).toBe("conforme");
  });

  it("HU0008-2.0 [parte: correo] (subsanación) con dos documentos observados, la rama sigue observada hasta reemplazar el último", async () => {
    const x = await e.enValidacion();
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar("Borrosa."));
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.dni), observar("Falta el reverso."));
    // La segunda observación no repite la transición de la rama.
    expect((await eventosTipo(x.f.idExpediente, "transicion_estado")).filter((t) => t.detalle.campo === "estado_documental")).toHaveLength(1);

    expect((await reemplazar(x, x.ids.partida, x.docs.partida)).status).toBe(201);
    expect((await ramas(x.f.idExpediente)).documental).toBe("observado");
    expect((await reemplazar(x, x.ids.dni, x.docs.dni)).status).toBe(201);
    expect((await ramas(x.f.idExpediente)).documental).toBe("pendiente");
    expect(await eventosTipo(x.f.idExpediente, "subsanacion_registrada")).toHaveLength(2);
  });

  it("HU0008-2.0 [parte: correo] (aviso) el barrido retoma el aviso pendiente a los 10 min con un intento nuevo, hasta 6, y lo cierra con una fila fallido", async () => {
    const x = await e.enValidacion();
    const primero = (await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar("Borrosa."))).body.id_notificacion as number;
    // Recién reservado: el barrido no lo toma (lo envía el webhook).
    expect(await pendientesAviso()).not.toContain(x.f.idExpediente);
    expect((await reservarAviso(x.f.idExpediente)).body.error.codigo).toBe("AVISO_YA_REGISTRADO");

    for (let intento = 2; intento <= 6; intento++) {
      const ultimo = (await avisosDe(x.f.idExpediente)).at(-1)!.id_notificacion;
      await intentadaHace(db(), ultimo, 11);
      expect(await pendientesAviso()).toContain(x.f.idExpediente);
      // El webhook de un intento vencido ya no arma el correo: lo hace el barrido.
      expect((await reservarAviso(x.f.idExpediente, { id_notificacion: ultimo })).body.error.codigo).toBe("AVISO_YA_REGISTRADO");
      const r = await reservarAviso(x.f.idExpediente);
      expect(r.status).toBe(201);
      expect(r.body.id_notificacion).toBeGreaterThan(ultimo);
    }
    await intentadaHace(db(), (await avisosDe(x.f.idExpediente)).at(-1)!.id_notificacion, 11);

    const agotado = await reservarAviso(x.f.idExpediente);

    expect(agotado.status).toBe(409);
    expect(agotado.body.error.codigo).toBe("AVISO_AGOTADO");
    expect((await avisosDe(x.f.idExpediente)).map((a) => a.estado_envio)).toEqual([...Array(6).fill("pendiente"), "fallido"]);
    expect((await avisosDe(x.f.idExpediente))[0]!.id_notificacion).toBe(primero);
    expect(await pendientesAviso()).not.toContain(x.f.idExpediente);
  });

  it("HU0008-2.0 [parte: correo] (aviso) una observación nueva reemplaza el aviso pendiente de la anterior y lista todas las observaciones vigentes", async () => {
    const x = await e.enValidacion();
    const primero = (await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar("Borrosa."))).body.id_notificacion;
    const segundo = (await tes().post(rutaDecisionPago(x.idPago), observar("El monto abonado no coincide."))).body.id_notificacion;

    expect((await reservarAviso(x.f.idExpediente, { id_notificacion: primero })).body.error.codigo).toBe("AVISO_NO_CORRESPONDE");
    const aviso = await reservarAviso(x.f.idExpediente, { id_notificacion: segundo });

    expect(aviso.status).toBe(201);
    const cuerpo = aviso.body.cuerpo as string;
    expect(cuerpo).toContain("- Partida de nacimiento: Borrosa.\n");
    expect(cuerpo).toContain("- Comprobante del derecho de admisión: El monto abonado no coincide.\n");
    expect(cuerpo).toContain(`${FRONT()}/portal/documentos`);
    expect(cuerpo).toContain(`${FRONT()}/portal/pagos/derecho-admision`);
  });

  it("HU0008-2.0 [parte: correo] (aviso) si la familia ya subsanó todo antes del envío, el aviso no corresponde y el barrido no lo retoma", async () => {
    const x = await e.enValidacion();
    const id = (await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar("Borrosa."))).body.id_notificacion;
    await reemplazar(x, x.ids.partida, x.docs.partida);
    await intentadaHace(db(), id, 11);

    expect((await reservarAviso(x.f.idExpediente, { id_notificacion: id })).body.error.codigo).toBe("AVISO_NO_CORRESPONDE");
    expect(await pendientesAviso()).not.toContain(x.f.idExpediente);
  });
});

describe("HU0011-1.0 documentación financiera conforme", () => {
  it("HU0011-1.0 Tesorería verifica cada documento financiero, lo marca conforme y confirma: registra la validación con la fecha y el usuario responsable", async () => {
    const x = await e.enValidacion({ boletasPorDocumento: 3 });
    const detalle = await tes().get(rutaFinanciera(x.f.idExpediente));
    expect(detalle.status).toBe(200);
    expect(detalle.body.condiciones_laborales).toEqual([
      { parentesco: "madre", condicion_laboral: "dependiente" },
      { parentesco: "padre", condicion_laboral: "independiente" },
    ]);
    expect(detalle.body.documentos.map((d: { id_documento: number; parentesco: string }) => [d.id_documento, d.parentesco])).toEqual(x.docs.boletas.map((b) => [b, "madre"]));
    // Sin consulta a centrales de riesgo: «Marcar conforme» solo con todos los documentos conformes.
    expect((await tes().post(rutaConformidadFinanciera(x.f.idExpediente))).body.error.codigo).toBe("DOCUMENTOS_SIN_REVISAR");
    for (const b of x.docs.boletas) expect((await tes().post(rutaDecisionTesoreria(x.f.idExpediente, b), CONFORME)).status).toBe(200);

    const res = await tes().post(rutaConformidadFinanciera(x.f.idExpediente));

    expect(res.body).toEqual({ rama: "conforme", agendamiento_habilitado: false });
    expect(await ramas(x.f.idExpediente)).toEqual({ estado: "en_validacion", documental: "pendiente", financiera: "conforme", derecho: "pendiente" });
    const [transicion] = (await eventosTipo(x.f.idExpediente, "transicion_estado")).filter((t) => t.detalle.campo === "estado_financiero");
    expect(transicion).toMatchObject({ id_personal: e.tesoreria.idPersonal, estado_anterior: "pendiente", estado_nuevo: "conforme" });
    expect(transicion.fecha_hora).toBeInstanceOf(Date);
    for (const b of x.docs.boletas) expect((await documento(b)).id_personal_revisor).toBe(e.tesoreria.idPersonal);
  });

  it("HU0011-1.0 sin requisitos financieros en el grado, «Marcar conforme» registra la conformidad sin documentos (supuesto 3)", async () => {
    const x = await e.enValidacion({ sinFinancieros: true });
    const detalle = await tes().get(rutaFinanciera(x.f.idExpediente));
    expect(detalle.body.documentos).toEqual([]);

    const res = await tes().post(rutaConformidadFinanciera(x.f.idExpediente));

    expect(res.body).toEqual({ rama: "conforme", agendamiento_habilitado: false });
    expect((await ramas(x.f.idExpediente)).financiera).toBe("conforme");
  });

  it("HU0011-1.0 con las demás validaciones conformes, la conformidad financiera habilita el agendamiento", async () => {
    const x = await e.enValidacion();
    await todoConformeSalvoConfirmar(x);
    await sec().post(rutaConformidadDocumental(x.f.idExpediente));

    const res = await tes().post(rutaConformidadFinanciera(x.f.idExpediente));

    expect(res.body.agendamiento_habilitado).toBe(true);
    expect(await unionesDe(x.f.idExpediente)).toEqual([
      expect.objectContaining({ id_personal: e.tesoreria.idPersonal, detalle: expect.objectContaining({ item: { tipo: "documentacion_financiera", id: x.f.idExpediente } }) }),
    ]);
  });
});

describe("HU0011-2.0 documentación financiera observada", () => {
  it("HU0011-2.0 Tesorería selecciona el documento, redacta el motivo y solicita la subsanación: la validación financiera queda observada sin detener las demás y se notifica el motivo con el enlace", async () => {
    const x = await e.enValidacion();
    const motivo = "Falta la boleta de pago de agosto de 2026.";

    const res = await tes().post(rutaDecisionTesoreria(x.f.idExpediente, x.docs.boletas[0]!), observar(motivo));

    expect(res.status).toBe(200);
    expect(res.body.rama).toBe("observado");
    expect(await ramas(x.f.idExpediente)).toEqual({ estado: "en_validacion", documental: "pendiente", financiera: "observado", derecho: "pendiente" });
    expect(e.eventos.disparar).toHaveBeenCalledWith("verificacion-completitud", { id_expediente: x.f.idExpediente, id_notificacion: res.body.id_notificacion });
    // Las demás validaciones siguen.
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), CONFORME);
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.dni), CONFORME);
    expect((await sec().post(rutaConformidadDocumental(x.f.idExpediente))).status).toBe(200);
    expect((await tes().post(rutaDecisionPago(x.idPago), CONFORME)).status).toBe(200);

    const aviso = await reservarAviso(x.f.idExpediente, { id_notificacion: res.body.id_notificacion });
    expect(aviso.status).toBe(201);
    // El apoderado por su parentesco, nunca por su nombre (C11).
    expect(aviso.body.cuerpo).toContain(`- Boletas de pago (madre): ${motivo}\n`);
    expect(aviso.body.cuerpo).toContain(`${FRONT()}/portal/documentos`);
    expect(aviso.body.cuerpo).not.toContain("María Fernanda Quispe");
  });

  it("HU0011-2.0 (subsanación) la familia reemplaza el documento financiero observado: la rama financiera vuelve a pendiente y G05 la muestra como subsanada con el motivo anterior", async () => {
    const x = await e.enValidacion();
    const motivo = "Boleta ilegible.";
    await tes().post(rutaDecisionTesoreria(x.f.idExpediente, x.docs.boletas[0]!), observar(motivo));

    const res = await reemplazar(x, x.ids.boletas, x.docs.boletas[0]!, x.f.idApoderado);

    expect(res.status).toBe(201);
    expect((await ramas(x.f.idExpediente)).financiera).toBe("pendiente");
    expect((await eventosTipo(x.f.idExpediente, "subsanacion_registrada"))[0].detalle).toEqual({
      item: { tipo: "documentacion_financiera", id: x.f.idExpediente },
      id_documento_nuevo: res.body.id_documento,
      id_documento_anterior: x.docs.boletas[0],
    });
    const lista = await tes().get("/tesoreria/validaciones?vista=financiera");
    expect(lista.body.items.find((i: { id_expediente: number }) => i.id_expediente === x.f.idExpediente)).toMatchObject({
      concepto: "documentacion_financiera",
      estado: "pendiente",
      subsanado: true,
      motivos_anteriores: [motivo],
    });
    const detalle = await tes().get(rutaFinanciera(x.f.idExpediente));
    expect(detalle.body.documentos).toEqual([expect.objectContaining({ id_documento: res.body.id_documento, motivo_observacion: null, motivo_anterior: motivo })]);
  });
});

describe("HU0024-1.0 validación conforme del derecho de admisión", () => {
  it("HU0024-1.0 Tesorería verifica el abono y marca el comprobante conforme: la validación del derecho queda conforme con su validador", async () => {
    const x = await e.enValidacion();
    const detalle = await tes().get(rutaPago(x.idPago));
    expect(detalle.status).toBe(200);
    expect(detalle.body).toMatchObject({ id_pago: x.idPago, concepto: "derecho_admision", monto: 300, banco: BANCOS[0], numero_operacion: x.operacion, fecha_pago: "2026-10-10", estado_validacion: "pendiente" });

    const res = await tes().post(rutaDecisionPago(x.idPago), CONFORME);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id_pago: x.idPago, id_expediente: x.f.idExpediente, estado_validacion: "conforme", id_notificacion: null, agendamiento_habilitado: false });
    expect(await pagoDe(x.idPago)).toMatchObject({ estado: "conforme", id_personal_validador: e.tesoreria.idPersonal, motivo_observacion: null });
    expect(await ramas(x.f.idExpediente)).toEqual({ estado: "en_validacion", documental: "pendiente", financiera: "pendiente", derecho: "conforme" });
    // La fecha de validación del pago sale de la bitácora (modelo §7).
    expect((await eventosTipo(x.f.idExpediente, "atencion_fin"))[0]).toMatchObject({ id_personal: e.tesoreria.idPersonal, detalle: { item: { tipo: "pago", id: x.idPago }, decision: "conforme" } });
  });

  it("HU0024-1.0 con las demás validaciones conformes, el comprobante conforme habilita el agendamiento", async () => {
    const x = await e.enValidacion();
    await todoConformeSalvoConfirmar(x, { pago: false });
    await sec().post(rutaConformidadDocumental(x.f.idExpediente));
    await tes().post(rutaConformidadFinanciera(x.f.idExpediente));

    const res = await tes().post(rutaDecisionPago(x.idPago), CONFORME);

    expect(res.body.agendamiento_habilitado).toBe(true);
    expect(await unionesDe(x.f.idExpediente)).toHaveLength(1);
  });

  it("HU0024-1.0 (dos personas) la segunda decisión sobre el comprobante responde 409 PAGO_YA_VALIDADO y no pisa la primera", async () => {
    const x = await e.enValidacion();
    const [a, b] = await Promise.all([
      tes().post(rutaDecisionPago(x.idPago), CONFORME),
      e.api(e.tesoreria2.token).post(rutaDecisionPago(x.idPago), observar("No figura en el estado de cuenta.")),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ganador = a.status === 200 ? e.tesoreria : e.tesoreria2;
    expect([a, b].find((r) => r.status === 409)!.body.error.codigo).toBe("PAGO_YA_VALIDADO");
    expect((await pagoDe(x.idPago)).id_personal_validador).toBe(ganador.idPersonal);
    expect(await eventosTipo(x.f.idExpediente, "atencion_fin")).toHaveLength(1);
  });
});

describe("HU0024-2.0 observación del comprobante del derecho de admisión", () => {
  it("HU0024-2.0 «Observar comprobante» con el motivo marca el derecho observado sin detener las demás validaciones y notifica el motivo con el enlace para regularizar el pago", async () => {
    const x = await e.enValidacion();
    const motivo = "El número de operación no figura en el estado de cuenta.";

    const res = await tes().post(rutaDecisionPago(x.idPago), observar(motivo));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado_validacion: "observado", id_notificacion: expect.any(Number) });
    expect(await pagoDe(x.idPago)).toMatchObject({ estado: "observado", motivo_observacion: motivo, id_personal_validador: e.tesoreria.idPersonal });
    expect(await ramas(x.f.idExpediente)).toEqual({ estado: "en_validacion", documental: "pendiente", financiera: "pendiente", derecho: "observado" });
    expect(e.eventos.disparar).toHaveBeenCalledWith("verificacion-completitud", { id_expediente: x.f.idExpediente, id_notificacion: res.body.id_notificacion });
    // Las demás siguen.
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), CONFORME);
    await tes().post(rutaDecisionTesoreria(x.f.idExpediente, x.docs.boletas[0]!), CONFORME);
    expect((await tes().post(rutaConformidadFinanciera(x.f.idExpediente))).status).toBe(200);

    const aviso = await reservarAviso(x.f.idExpediente, { id_notificacion: res.body.id_notificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body.cuerpo).toContain(`- Comprobante del derecho de admisión: ${motivo}\n`);
    expect(aviso.body.cuerpo).toContain(`Regulariza el pago del derecho de admisión: ${FRONT()}/portal/pagos/derecho-admision`);
    expect(aviso.body.cuerpo).not.toContain("/portal/documentos");
  });

  it("HU0024-2.0 abrir un comprobante observado no abre un ítem de atención: espera a la familia", async () => {
    const x = await e.enValidacion();
    await tes().post(rutaDecisionPago(x.idPago), observar("El monto no coincide."));
    const antes = (await eventosTipo(x.f.idExpediente, "atencion_inicio")).length;

    const detalle = await tes().get(rutaPago(x.idPago));

    expect(detalle.body).toMatchObject({ estado_validacion: "observado", motivo_observacion: "El monto no coincide." });
    expect(await eventosTipo(x.f.idExpediente, "atencion_inicio")).toHaveLength(antes);
  });

  it("HU0024-2.0 (subsanación) la familia registra el comprobante nuevo en la misma fila: vuelve a pendiente, el anterior queda en subsanacion_registrada y su archivo no se borra", async () => {
    const x = await e.enValidacion();
    const motivo = "El monto abonado no coincide.";
    const previo = await pagoDe(x.idPago);
    const ruta = rutaDerecho(x.f.idExpediente);
    // Antes de la observación no se puede reemplazar.
    const temprano = await subirPut(e.app, ruta, x.f.token, { banco: BANCOS[1], numero_operacion: `OP-${unico()}`, fecha_pago: "2026-10-11" }, pdf());
    expect([temprano.status, temprano.body.error.codigo]).toEqual([409, "DERECHO_NO_SUBSANABLE"]);
    await tes().post(rutaDecisionPago(x.idPago), observar(motivo));
    const ver = await request(e.app).get(ruta).set("Authorization", `Bearer ${x.f.token}`);
    expect(ver.body.pago).toMatchObject({ estado: "observado", subsanable: true, motivo_observacion: motivo, motivo_anterior: null });

    // R19 sin contar el propio pago: el número de otro expediente se rechaza.
    const otra = await e.enValidacion();
    const ajeno = await subirPut(e.app, ruta, x.f.token, { banco: BANCOS[0], numero_operacion: otra.operacion, fecha_pago: "2026-10-11" }, pdf());
    expect([ajeno.status, ajeno.body.error.codigo]).toEqual([409, "COMPROBANTE_DUPLICADO"]);

    const nuevaOperacion = `OP-${unico()}`;
    const res = await subirPut(e.app, ruta, x.f.token, { banco: BANCOS[1], numero_operacion: nuevaOperacion, fecha_pago: "2026-10-11" }, pdf("voucher corregido"));

    expect(res.status).toBe(200);
    expect(res.body.pago).toMatchObject({ estado: "pendiente", subsanable: false, motivo_observacion: null, motivo_anterior: motivo, banco: BANCOS[1], numero_operacion: nuevaOperacion });
    const ahora = await pagoDe(x.idPago);
    expect(ahora).toMatchObject({ estado: "pendiente", banco: BANCOS[1], numero_operacion: nuevaOperacion, id_personal_validador: null, motivo_observacion: motivo });
    expect(ahora.comprobante_url).not.toBe(previo.comprobante_url);
    const [subsanacion] = await eventosTipo(x.f.idExpediente, "subsanacion_registrada");
    expect(subsanacion).toMatchObject({
      id_personal: null,
      detalle: {
        item: { tipo: "pago", id: x.idPago },
        id_pago: x.idPago,
        anterior: { banco: BANCOS[0], numero_operacion: x.operacion, clave: previo.comprobante_url, motivo },
      },
    });
    // El comprobante anterior se conserva en el almacenamiento (ajuste 1 de John).
    expect(await archivosAlmacenados()).toContain(previo.comprobante_url);
    expect((await readFile(join(process.env.STORAGE_LOCAL_DIR!, previo.comprobante_url))).subarray(0, 4).toString()).toBe("CILF");
    // G05: vuelve a «Por validar» como subsanado, con el motivo como anterior.
    const detalle = await tes().get(rutaPago(x.idPago));
    expect(detalle.body).toMatchObject({ estado_validacion: "pendiente", motivo_observacion: null, motivo_anterior: motivo });
    const lista = await tes().get("/tesoreria/validaciones?vista=derecho");
    expect(lista.body.items.find((i: { id_pago: number }) => i.id_pago === x.idPago)).toMatchObject({ estado: "pendiente", subsanado: true, motivos_anteriores: [motivo] });
    // Ya no es subsanable hasta otra observación.
    const otraVez = await subirPut(e.app, ruta, x.f.token, { banco: BANCOS[2], numero_operacion: `OP-${unico()}`, fecha_pago: "2026-10-11" }, pdf());
    expect(otraVez.body.error.codigo).toBe("DERECHO_NO_SUBSANABLE");
    // Si Tesorería da la conformidad, el Pago queda sin motivo, pero el motivo sigue en subsanacion_registrada.
    expect((await tes().post(rutaDecisionPago(x.idPago), CONFORME)).status).toBe(200);
    expect((await pagoDe(x.idPago)).motivo_observacion).toBeNull();
    expect((await eventosTipo(x.f.idExpediente, "subsanacion_registrada"))[0].detalle.anterior.motivo).toBe(motivo);
  });
});

describe("HU0021-2.0 acceso denegado a información restringida (ruta real, C17)", () => {
  it("HU0021-2.0 [ruta real] G03 no devuelve los documentos financieros a Secretaría; abrirlos o validarlos responde 403 sin contenido y queda acceso_denegado", async () => {
    const x = await e.enValidacion();
    const boleta = x.docs.boletas[0]!;

    const detalle = await sec().get(rutaDetalle(x.f.idExpediente));
    expect(detalle.body.documentos.map((d: { id_documento: number }) => d.id_documento).sort()).toEqual([x.docs.partida, x.docs.dni].sort());
    expect(JSON.stringify(detalle.body)).not.toContain("Boletas de pago");

    const archivo = await sec().get(rutaArchivoSecretaria(x.f.idExpediente, boleta));
    const decision = await sec().post(rutaDecisionSecretaria(x.f.idExpediente, boleta), CONFORME);
    const malArmada = await sec().post(rutaDecisionSecretaria(x.f.idExpediente, boleta), { decision: "otra" });
    const ajena = await sec().get(rutaFinanciera(x.f.idExpediente));
    for (const res of [archivo, decision, malArmada, ajena]) {
      expect(res.status).toBe(403);
      expect(res.body.error.codigo).toBe("ACCESO_DENEGADO");
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    }
    expect(await documento(boleta)).toMatchObject({ estado: "pendiente", id_personal_revisor: null });
    const denegados = await eventosTipo(x.f.idExpediente, "acceso_denegado");
    expect(denegados).toHaveLength(3);
    for (const d of denegados) {
      expect(d).toMatchObject({ id_personal: e.secretaria.idPersonal, detalle: { recurso: "documentacion_financiera", id_documento: boleta } });
    }
    // El intento por la ruta de Tesorería lo bloquea requireRol, también auditado.
    const porRol = (await db().query("SELECT detalle FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1 AND detalle->>'ruta' = $2", [
      e.secretaria.idPersonal,
      rutaFinanciera(x.f.idExpediente),
    ])).rows;
    expect(porRol).toHaveLength(1);
  });

  it("HU0021-2.0 [ruta real] solo Tesorería ve y descarga la documentación financiera, con las cabeceras de ADR-21", async () => {
    const x = await e.enValidacion();
    const res = await tes().get(rutaArchivoTesoreria(x.f.idExpediente, x.docs.boletas[0]!));
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({
      "content-type": "application/pdf",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "no-store",
    });
    expect(res.headers["content-disposition"]).toMatch(/^inline; filename="documento-\d+\.pdf"$/);
    expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    // Un documento no financiero no es de Tesorería.
    expect((await tes().get(rutaArchivoTesoreria(x.f.idExpediente, x.docs.partida))).status).toBe(404);
  });
});

describe("HU0008-1.0 descargas del personal solo por la API", () => {
  it("HU0008-1.0 Secretaría descarga un documento no financiero y Tesorería el comprobante, descifrados y con nosniff, sandbox y no-store", async () => {
    const x = await e.enValidacion();
    const doc = await sec().get(rutaArchivoSecretaria(x.f.idExpediente, x.docs.partida));
    const comprobante = await tes().get(`${rutaPago(x.idPago)}/comprobante`);
    for (const res of [doc, comprobante]) {
      expect(res.status).toBe(200);
      expect(res.headers).toMatchObject({ "content-type": "application/pdf", "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "cache-control": "no-store" });
      expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
    }
    expect(comprobante.body.includes(Buffer.from("voucher ficticio"))).toBe(true);
    // Un documento de otro expediente no se resuelve, ni uno reemplazado (historial).
    const otro = await e.enValidacion();
    expect((await sec().get(rutaArchivoSecretaria(x.f.idExpediente, otro.docs.partida))).status).toBe(404);
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.dni), observar("Borrosa."));
    await reemplazar(x, x.ids.dni, x.docs.dni);
    expect((await sec().get(rutaArchivoSecretaria(x.f.idExpediente, x.docs.dni))).status).toBe(404);
  });
});

describe("C22 cuenta activa del personal en las rutas de validación", () => {
  it("C22 /bandeja y /tesoreria exigen una fila activa en personal con el rol del token", async () => {
    const x = await e.enValidacion();
    const sinFila = await firmante.token(crypto.randomUUID(), ["secretaria"]);
    expect((await e.api(sinFila).get("/bandeja/expedientes")).status).toBe(403);
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [e.tesoreria2.idPersonal]);
    try {
      expect((await e.api(e.tesoreria2.token).get(rutaPago(x.idPago))).status).toBe(403);
      expect((await e.api(e.tesoreria2.token).post(rutaDecisionPago(x.idPago), CONFORME)).status).toBe(403);
    } finally {
      await db().query("UPDATE personal SET activo = true WHERE id_personal = $1", [e.tesoreria2.idPersonal]);
    }
    expect((await pagoDe(x.idPago)).estado).toBe("pendiente");
    // La familia no entra a las rutas del personal.
    expect((await e.api(x.f.token).get("/bandeja/expedientes")).status).toBe(403);
  });
});

describe("HU0017-1.0 bandeja de revisión (C51)", () => {
  it("HU0017-1.0 [parte: bandeja] el expediente que la verificación encontró completo aparece en «Por revisar» de G02; uno incompleto no", async () => {
    const x = await e.enValidacion();
    // Incompleto: sin el derecho, se queda en en_postulacion.
    const incompleto = await familiaConFicha(db(), e, async (g) => {
      await requisito(db(), g, "Partida de nacimiento", "todos");
    });
    await request(e.app).post(`${rutaDocumentos(incompleto.idExpediente)}/confirmacion`).set("Authorization", `Bearer ${incompleto.token}`).send({});
    await request(e.app).post(`/internal/expedientes/${incompleto.idExpediente}/verificacion-completitud`).set("Authorization", `Bearer ${TOKEN_INTERNO()}`).send();
    expect(await estadoDe(db(), incompleto.idExpediente)).toBe("en_postulacion");

    const res = await sec().get("/bandeja/expedientes?vista=por_revisar");

    expect(res.status).toBe(200);
    const fila = res.body.expedientes.find((b: { id_expediente: number }) => b.id_expediente === x.f.idExpediente);
    expect(fila).toEqual({
      id_expediente: x.f.idExpediente,
      codigo: `ADM-${e.campana}-${String(x.f.idExpediente).padStart(4, "0")}`,
      postulante: { nombres: "Sofía Valentina", apellidos: "Quispe Rojas" },
      apoderado: { nombres: "María Fernanda", apellidos: "Quispe Rojas" },
      grado: { id_grado: x.f.idGrado, nombre_grado: expect.stringMatching(/^3\.° de primaria /) },
      estado_documental: "pendiente",
      subsanado: false,
      motivos_anteriores: [],
      ultima_actividad: expect.stringMatching(/^\d{4}-/),
      en_validacion_desde: expect.stringMatching(/^\d{4}-/),
    });
    expect(res.body.expedientes.some((b: { id_expediente: number }) => b.id_expediente === incompleto.idExpediente)).toBe(false);
    expect(res.body.conteos.por_revisar).toBeGreaterThanOrEqual(1);
    // Búsqueda por código y filtro de vista.
    const porCodigo = await sec().get(`/bandeja/expedientes?vista=todos&q=${encodeURIComponent(fila.codigo)}`);
    expect(porCodigo.body.expedientes.map((b: { id_expediente: number }) => b.id_expediente)).toEqual([x.f.idExpediente]);
    await sec().post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar("Borrosa."));
    const observados = await sec().get("/bandeja/expedientes?vista=observados");
    expect(observados.body.expedientes.map((b: { id_expediente: number }) => b.id_expediente)).toContain(x.f.idExpediente);
    expect((await sec().get("/bandeja/expedientes?vista=por_revisar")).body.expedientes.some((b: { id_expediente: number }) => b.id_expediente === x.f.idExpediente)).toBe(false);
    expect((await sec().get("/bandeja/expedientes?vista=otra")).status).toBe(400);
  });
});
