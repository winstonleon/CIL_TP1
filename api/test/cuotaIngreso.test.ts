// Cuota de ingreso (HU0013, HU0014 y HU0015; R17) por las rutas reales de la familia (P07), Tesorería (G05) y n8n (/internal).
// Reutiliza la carga de HU0007 y la decisión de HU0024: se prueba lo propio de la cuota y que el derecho siga igual.
// Datos ficticios @ejemplo.test; n8n se simula.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { montosDeFracciones } from "../src/services/montosCuota";
import { crearFirmante, eventosDe, unico } from "./ayudantes";
import { entornoAdjudicacion, rutaCuota, rutaModalidad } from "./ayudantesAdjudicacion";
import { archivosAlmacenados, exe, MiB, pdf, pdfDe, zip } from "./ayudantesCarga";
import { CONFORME, observar, rutaDecisionPago, rutaPago, subirPut, TOKEN_INTERNO } from "./ayudantesValidacion";
import { estadoDe, intentadaHace, intentosDe } from "./ayudantesVisita";

const db = () => obtenerPool();
let e: Awaited<ReturnType<typeof entornoAdjudicacion>>;

beforeAll(async () => {
  e = await entornoAdjudicacion(db(), await crearFirmante());
});
afterAll(cerrarPool);

const tesoreria = () => e.api(e.tesoreria.token);
const eventosTipo = async (id: number, tipo: string) => (await eventosDe(db(), id)).filter((ev) => ev.tipo_evento === tipo);
const pagoDe = async (idExpediente: number) =>
  (
    await db().query<{ id_pago: number; monto: string; numero_fraccion: number; banco: string; numero_operacion: string; comprobante_url: string; estado_validacion: string; motivo_observacion: string | null; id_personal_validador: number | null }>(
      `SELECT id_pago, monto::text AS monto, numero_fraccion, banco, numero_operacion, comprobante_url, estado_validacion::text AS estado_validacion,
              motivo_observacion, id_personal_validador FROM pago WHERE id_expediente = $1 AND tipo_pago = 'cuota_ingreso'`,
      [idExpediente],
    )
  ).rows;
const lista = async (vista: string) => (await tesoreria().get(`/tesoreria/validaciones?vista=${vista}`)).body;

describe("HU0013-1.0 elección de la modalidad de pago", () => {
  it("HU0013-1.0 con la vacante otorgada la familia revisa el monto de su nivel, elige pago único y confirma: se registra la modalidad, se muestra el monto y se habilita la carga", async () => {
    const f = await e.conVacante({ monto: 4000, nivel: "secundaria", maxFracciones: 3 });
    const familia = e.familiaApi(f.token);

    const antes = await familia.get(rutaCuota(f.idExpediente));
    expect(antes.status).toBe(200);
    expect(antes.body).toMatchObject({ disponible: true, aplica: true, nivel: "secundaria", monto: 4000, max_fracciones: 3, modalidad: null, registrable: false, modalidad_editable: true, pago: null });

    const res = await familia.post(rutaModalidad(f.idExpediente), { modalidad: "unico" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ modalidad: "unico", numero_fracciones: 1, montos: [4000], registrable: true });
    const { rows } = await db().query("SELECT modalidad_pago_cuota::text AS m, numero_fracciones AS n FROM expediente WHERE id_expediente = $1", [f.idExpediente]);
    expect(rows[0]).toEqual({ m: "unico", n: 1 });
  });

  it("HU0013-1.0 elige pago fraccionado dentro del máximo: muestra el monto de cada pago y la última fracción absorbe los céntimos", async () => {
    const f = await e.conVacante({ monto: 7000, maxFracciones: 3 });

    const res = await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "fraccionado", numero_fracciones: 3 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ modalidad: "fraccionado", numero_fracciones: 3, montos: [2333.33, 2333.33, 2333.34], registrable: true });
    expect(montosDeFracciones(7000, 3).reduce((a, b) => a + b * 100, 0)).toBeCloseTo(700000);
  });

  it("HU0013-1.0 (cambio de modalidad) la familia la cambia mientras no registró un pago de cuota; con un pago registrado responde 409 MODALIDAD_YA_ELEGIDA y no la cambia", async () => {
    const f = await e.conVacante({ maxFracciones: 2 });
    const familia = e.familiaApi(f.token);
    await familia.post(rutaModalidad(f.idExpediente), { modalidad: "unico" });

    const cambio = await familia.post(rutaModalidad(f.idExpediente), { modalidad: "fraccionado", numero_fracciones: 2 });
    expect(cambio.status).toBe(200);
    expect(cambio.body).toMatchObject({ modalidad: "fraccionado", numero_fracciones: 2, montos: [3500, 3500], modalidad_editable: true });

    expect((await e.comprobante(f, { monto: "3500" })).status).toBe(201);

    const tarde = await familia.post(rutaModalidad(f.idExpediente), { modalidad: "unico" });
    expect(tarde.status).toBe(409);
    expect(tarde.body.error.codigo).toBe("MODALIDAD_YA_ELEGIDA");
    expect((await familia.get(rutaCuota(f.idExpediente))).body).toMatchObject({ modalidad: "fraccionado", numero_fracciones: 2, modalidad_editable: false });
  });

  it("HU0013-1.0 (estado) sin la vacante otorgada responde 409 MODALIDAD_NO_CORRESPONDE, y un expediente ajeno 404", async () => {
    const f = await e.apto();
    const res = await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "unico" });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("MODALIDAD_NO_CORRESPONDE");
    const otra = await e.conVacante();
    expect((await e.familiaApi(f.token).post(rutaModalidad(otra.idExpediente), { modalidad: "unico" })).status).toBe(404);
  });
});

describe("HU0013-2.0 número de fracciones no permitido", () => {
  it("HU0013-2.0 con un número de fracciones mayor que el máximo del grado el sistema rechaza la elección e informa el máximo", async () => {
    const f = await e.conVacante({ maxFracciones: 3 });

    const res = await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "fraccionado", numero_fracciones: 4 });

    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({ codigo: "FRACCIONES_NO_PERMITIDAS", mensaje: "El número máximo de fracciones permitido es 3", detalle: { maximo: 3 } });
    expect((await e.familiaApi(f.token).get(rutaCuota(f.idExpediente))).body.modalidad).toBeNull();
  });

  it("HU0013-2.0 (máximo 1) un grado con máximo 1 rechaza el fraccionado, y menos de 2 fracciones es una entrada inválida", async () => {
    const f = await e.conVacante({ maxFracciones: 1 });
    const familia = e.familiaApi(f.token);
    const res = await familia.post(rutaModalidad(f.idExpediente), { modalidad: "fraccionado", numero_fracciones: 2 });
    expect(res.status).toBe(422);
    expect(res.body.error.detalle).toEqual({ maximo: 1 });
    expect((await familia.post(rutaModalidad(f.idExpediente), { modalidad: "fraccionado", numero_fracciones: 1 })).status).toBe(400);
  });
});

describe("HU0014-1.0 carga del comprobante de la cuota", () => {
  it("HU0014-1.0 la familia completa los datos, adjunta el comprobante y confirma: se almacena, queda «en conciliación» y se avisa a Tesorería solo con el código y el enlace", async () => {
    const f = await e.conVacante();
    await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "unico" });

    const res = await e.comprobante(f);

    expect(res.status).toBe(201);
    expect(res.body.pago).toMatchObject({ numero_fraccion: 1, monto: 7000, estado: "pendiente" });
    expect(res.body).toMatchObject({ registrable: false, modalidad_editable: false });
    const [pago] = await pagoDe(f.idExpediente);
    expect(pago).toMatchObject({ estado_validacion: "pendiente", numero_fraccion: 1, monto: "7000.00" });
    expect(await archivosAlmacenados()).toContain(pago!.comprobante_url);
    expect(await estadoDe(db(), f.idExpediente)).toBe("vacante_asignada");

    const [intento] = await intentosDe(db(), f.idExpediente, "cuota_por_conciliar");
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: f.idExpediente, id_notificacion: intento!.id_notificacion });
    expect((await eventosTipo(f.idExpediente, "cuota_registrada")).at(-1)!.detalle).toEqual({ id_pago: pago!.id_pago, id_notificacion: intento!.id_notificacion });

    const aviso = await e.interno.aviso(f.idExpediente, { id_notificacion: intento!.id_notificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body.asunto).toContain("Cuota de ingreso por conciliar");
    expect(aviso.body.cuerpo).toContain("/gestion/tesoreria");
    expect(aviso.body.cuerpo).not.toContain("Quispe");
    const contacto = await e.interno.contacto(f.idExpediente, intento!.id_notificacion);
    expect(contacto.body).toEqual({ id_expediente: f.idExpediente, correo: process.env.CORREO_TESORERIA, autoriza_whatsapp: false });
  });

  it("HU0014-1.0 (aviso) un aviso a Tesorería sin cerrar se retoma a los 10 min con una fila nueva, al mismo buzón", async () => {
    const { f } = await e.enConciliacion();
    const [primero] = await intentosDe(db(), f.idExpediente, "cuota_por_conciliar");
    await intentadaHace(db(), primero!.id_notificacion, 11);

    expect(await e.interno.pendientes()).toContainEqual({ id_expediente: f.idExpediente, tipo_evento: "cuota_por_conciliar" });
    const retoma = await e.interno.aviso(f.idExpediente, { tipo_evento: "cuota_por_conciliar" });
    expect(retoma.status).toBe(201);
    expect(retoma.body.id_notificacion).toBeGreaterThan(primero!.id_notificacion);
    expect((await e.interno.contacto(f.idExpediente, retoma.body.id_notificacion)).body.correo).toBe(process.env.CORREO_TESORERIA);
  });

  it("HU0014-1.0 (duplicado) el mismo número de operación en el mismo banco responde 409 COMPROBANTE_DUPLICADO sin revelar el otro expediente y no deja archivo", async () => {
    const { operacion } = await e.enConciliacion();
    const f = await e.conVacante();
    await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "unico" });
    const antes = (await archivosAlmacenados()).length;

    const res = await e.comprobante(f, { numero_operacion: operacion });

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("COMPROBANTE_DUPLICADO");
    expect(JSON.stringify(res.body)).not.toContain("ADM-");
    expect(await pagoDe(f.idExpediente)).toEqual([]);
    expect((await archivosAlmacenados()).length).toBe(antes);
  });

  it("HU0014-1.0 (precondiciones) sin modalidad responde 409 CUOTA_NO_REGISTRABLE, un segundo comprobante 409 CUOTA_YA_REGISTRADA y un dato inválido 400", async () => {
    const sinModalidad = await e.conVacante();
    const r = await e.comprobante(sinModalidad);
    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe("CUOTA_NO_REGISTRABLE");

    const { f } = await e.enConciliacion();
    const segundo = await e.comprobante(f);
    expect(segundo.status).toBe(409);
    expect(segundo.body.error.codigo).toBe("CUOTA_YA_REGISTRADA");

    const otra = await e.conVacante();
    await e.familiaApi(otra.token).post(rutaModalidad(otra.idExpediente), { modalidad: "unico" });
    const malos: Record<string, string>[] = [{ monto: "0" }, { monto: "abc" }, { fecha_pago: "2999-01-01" }, { banco: "Banco inventado" }];
    for (const malo of malos) {
      expect((await e.comprobante(otra, malo)).status).toBe(400);
    }
    expect(await pagoDe(otra.idExpediente)).toEqual([]);
  });

  it("HU0014-1.0 (fracción) en pago fraccionado se registra la primera fracción con su número 1", async () => {
    const f = await e.conVacante({ maxFracciones: 2 });
    await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "fraccionado", numero_fracciones: 2 });
    const res = await e.comprobante(f, { monto: "3500" });
    expect(res.status).toBe(201);
    expect((await pagoDe(f.idExpediente))[0]).toMatchObject({ numero_fraccion: 1, monto: "3500.00" });
  });
});

describe("HU0014-2.0 archivo no válido", () => {
  async function lista_para_cargar() {
    const f = await e.conVacante();
    await e.familiaApi(f.token).post(rutaModalidad(f.idExpediente), { modalidad: "unico" });
    return f;
  }

  it("HU0014-2.0 [parte: formato] un archivo con extensión o formato no autorizado se rechaza con 415 por su firma de bytes, sin fila ni archivo", async () => {
    const f = await lista_para_cargar();
    const antes = (await archivosAlmacenados()).length;
    for (const contenido of [exe(), zip()]) {
      const res = await e.comprobante(f, {}, contenido);
      expect(res.status).toBe(415);
      expect(res.body.error.codigo).toBe("FORMATO_NO_ADMITIDO");
    }
    expect(await pagoDe(f.idExpediente)).toEqual([]);
    expect((await archivosAlmacenados()).length).toBe(antes);
  });

  it("HU0014-2.0 [parte: formato] un archivo de más de 10 MB se corta con 413, sin fila ni archivo", async () => {
    const f = await lista_para_cargar();
    const antes = (await archivosAlmacenados()).length;
    const res = await e.comprobante(f, {}, pdfDe(10 * MiB + 1));
    expect(res.status).toBe(413);
    expect(res.body.error.codigo).toBe("ARCHIVO_DEMASIADO_GRANDE");
    expect(await pagoDe(f.idExpediente)).toEqual([]);
    expect((await archivosAlmacenados()).length).toBe(antes);
  });
});

describe("HU0015-1.0 conciliación de la cuota", () => {
  it("HU0015-1.0 [parte: conciliación] Tesorería ve el abono junto al monto que corresponde y concilia: el pago queda conforme, «Cuota acreditada», con la marca de trazabilidad y sin webhook de la carta", async () => {
    const { f, idPago } = await e.enConciliacion();

    const pendientes = await lista("cuota");
    expect(pendientes.conteos.cuota).toBeGreaterThan(0);
    expect(pendientes.items).toContainEqual(
      expect.objectContaining({ concepto: "cuota_ingreso", id_pago: idPago, id_expediente: f.idExpediente, numero_fraccion: 1, modalidad: "unico", estado: "pendiente", recibido: expect.any(String) }),
    );

    const detalle = await tesoreria().get(rutaPago(idPago));
    expect(detalle.status).toBe(200);
    expect(detalle.body).toMatchObject({ concepto: "cuota_ingreso", numero_fraccion: 1, monto: 7000, monto_corresponde: 7000, modalidad: "unico" });
    expect((await tesoreria().get(`${rutaPago(idPago)}/comprobante`)).status).toBe(200);

    const res = await tesoreria().post(rutaDecisionPago(idPago), CONFORME);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id_pago: idPago, estado_validacion: "conforme", id_notificacion: null, agendamiento_habilitado: false });
    expect((await pagoDe(f.idExpediente))[0]).toMatchObject({ estado_validacion: "conforme", id_personal_validador: e.tesoreria.idPersonal });
    const inicio = (await eventosTipo(f.idExpediente, "atencion_inicio")).at(-1)!;
    const fin = (await eventosTipo(f.idExpediente, "atencion_fin")).at(-1)!;
    expect(fin.detalle).toMatchObject({ item: { tipo: "pago", id: idPago }, decision: "conforme", id_evento_inicio: Number(inicio.id_evento), cuota_acreditada: true });
    // HU0016 toma la carta desde los datos (C62): el estado no cambia y no se dispara ningún flujo.
    expect(await estadoDe(db(), f.idExpediente)).toBe("vacante_asignada");
    expect(e.eventos.disparar).not.toHaveBeenCalled();
    expect((await lista("cuota")).items.map((i: { id_pago: number }) => i.id_pago)).not.toContain(idPago);

    const familia = await e.familiaApi(f.token).get(rutaCuota(f.idExpediente));
    expect(familia.body.pago).toMatchObject({ estado: "conforme", fecha_validacion: expect.any(String) });
  });

  it("HU0015-1.0 [parte: conciliación] una fracción posterior conforme no lleva la marca, porque solo la primera acredita la cuota", async () => {
    const { f } = await e.enConciliacion();
    const { rows } = await db().query<{ id_pago: number }>(
      `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url)
       VALUES ($1, 'cuota_ingreso', 2, $2, '[Banco 1]', 3500, '2026-10-20', $3) RETURNING id_pago`,
      [f.idExpediente, `OP-${unico()}`, `clave-${unico()}`],
    );
    const res = await tesoreria().post(rutaDecisionPago(rows[0]!.id_pago), CONFORME);
    expect(res.status).toBe(200);
    expect((await eventosTipo(f.idExpediente, "atencion_fin")).at(-1)!.detalle).not.toHaveProperty("cuota_acreditada");
  });

  it("HU0015-1.0 [parte: conciliación] (dos personas) una segunda decisión responde 409 PAGO_YA_VALIDADO, y otro rol recibe 403 auditado", async () => {
    const { idPago } = await e.enConciliacion();
    expect((await e.api(e.secretaria.token).post(rutaDecisionPago(idPago), CONFORME)).status).toBe(403);
    expect((await tesoreria().post(rutaDecisionPago(idPago), CONFORME)).status).toBe(200);
    const res = await e.api(e.tesoreria2.token).post(rutaDecisionPago(idPago), observar("Tarde"));
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("PAGO_YA_VALIDADO");
  });

  it("HU0015-1.0 [parte: conciliación] (derecho) el comprobante del derecho sigue exigiendo en_validacion: en otro estado responde 409 y G05 no lo abre", async () => {
    const f = await e.habilitada();
    const { rows } = await db().query<{ id_pago: number }>("SELECT id_pago FROM pago WHERE id_expediente = $1 AND tipo_pago = 'derecho_admision'", [f.idExpediente]);
    await db().query("UPDATE pago SET estado_validacion = 'pendiente' WHERE id_pago = $1", [rows[0]!.id_pago]);
    await db().query("UPDATE expediente SET estado = 'vacante_asignada' WHERE id_expediente = $1", [f.idExpediente]);
    const res = await tesoreria().get(rutaPago(rows[0]!.id_pago));
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("VALIDACION_NO_CORRESPONDE");
  });
});

describe("HU0015-2.0 rechazo por inconsistencia", () => {
  it("HU0015-2.0 Tesorería rechaza el comprobante con el motivo: queda «Cuota observada», la familia recibe el detalle y el enlace, y regulariza en la misma fila", async () => {
    const { f, idPago, operacion } = await e.enConciliacion();
    const [original] = await pagoDe(f.idExpediente);

    const res = await tesoreria().post(rutaDecisionPago(idPago), observar("El abono es menor al monto que corresponde"));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado_validacion: "observado", id_notificacion: expect.any(Number) });
    expect(e.eventos.disparar).toHaveBeenCalledWith("verificacion-completitud", { id_expediente: f.idExpediente, id_notificacion: res.body.id_notificacion });

    const aviso = await request(e.app)
      .post(`/internal/expedientes/${f.idExpediente}/aviso-observacion`)
      .set("Authorization", `Bearer ${TOKEN_INTERNO()}`)
      .send({ id_notificacion: res.body.id_notificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body.tipo_evento).toBe("subsanacion_solicitada");
    expect(aviso.body.cuerpo).toContain("Comprobante de la cuota de ingreso: El abono es menor al monto que corresponde");
    expect(aviso.body.cuerpo).toContain("/portal/pagos");

    const familia = e.familiaApi(f.token);
    const vista = await familia.get(rutaCuota(f.idExpediente));
    expect(vista.body.pago).toMatchObject({ estado: "observado", subsanable: true, motivo_observacion: "El abono es menor al monto que corresponde" });

    const nueva = await subirPut(e.app, rutaCuota(f.idExpediente), f.token, e.campos({ numero_operacion: operacion, monto: "7000.50" }), pdf("voucher nuevo"));
    expect(nueva.status).toBe(200);
    expect(nueva.body.pago).toMatchObject({ estado: "pendiente", subsanable: false, motivo_observacion: null, motivo_anterior: "El abono es menor al monto que corresponde", monto: 7000.5 });

    expect(await pagoDe(f.idExpediente)).toHaveLength(1);
    const evento = (await eventosTipo(f.idExpediente, "subsanacion_registrada")).at(-1)!;
    expect(evento.detalle).toMatchObject({ item: { tipo: "pago", id: idPago }, id_pago: idPago, anterior: { clave: original!.comprobante_url, motivo: "El abono es menor al monto que corresponde", monto: 7000 } });
    expect(await archivosAlmacenados()).toContain(original!.comprobante_url);

    // Reaparece en G05 como subsanado, sin un aviso nuevo a Tesorería (supuesto 7).
    const fila = (await lista("cuota")).items.find((i: { id_pago: number }) => i.id_pago === idPago);
    expect(fila).toMatchObject({ estado: "pendiente", subsanado: true, motivos_anteriores: ["El abono es menor al monto que corresponde"] });
    expect(await intentosDe(db(), f.idExpediente, "cuota_por_conciliar")).toHaveLength(1);
    expect((await tesoreria().post(rutaDecisionPago(idPago), CONFORME)).status).toBe(200);
  });

  it("HU0015-2.0 (aviso) un aviso sin cerrar se retoma por el barrido de observaciones a los 10 min", async () => {
    const { f, idPago } = await e.enConciliacion();
    const res = await tesoreria().post(rutaDecisionPago(idPago), observar("El número de operación no coincide"));
    await intentadaHace(db(), res.body.id_notificacion, 11);

    const pendientes = await request(e.app).get("/internal/observaciones/pendientes").set("Authorization", `Bearer ${TOKEN_INTERNO()}`);

    expect(pendientes.body.expedientes).toContainEqual({ id_expediente: f.idExpediente });
  });

  it("HU0015-2.0 (subsanación) solo se reemplaza un comprobante observado: en conciliación responde 409 CUOTA_NO_SUBSANABLE", async () => {
    const { f } = await e.enConciliacion();
    const res = await subirPut(e.app, rutaCuota(f.idExpediente), f.token, e.campos(), pdf("voucher nuevo"));
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("CUOTA_NO_SUBSANABLE");
  });

  it("HU0015-2.0 (validación) el motivo es obligatorio", async () => {
    const { idPago } = await e.enConciliacion();
    expect((await tesoreria().post(rutaDecisionPago(idPago), { decision: "observado" })).status).toBe(400);
  });
});

describe("HU0014 tarjeta del derecho de admisión en P07", () => {
  it("HU0014-1.0 (P07) la familia ve el derecho validado con su fecha, tomada de la bitácora, y la cuota aún no disponible", async () => {
    const f = await e.habilitadaReal();
    const vista = await e.familiaApi(f.token).get(rutaCuota(f.idExpediente));
    expect(vista.status).toBe(200);
    expect(vista.body).toMatchObject({ disponible: false, registrable: false, modalidad_editable: false, pago: null });
    expect(vista.body.derecho).toMatchObject({ estado: "conforme", fecha_validacion: expect.any(String) });
    expect(vista.body.bancos.length).toBeGreaterThan(0);
  });
});
