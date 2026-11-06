// Adjudicación de la vacante (HU0012, R14 y R15; G07) por las rutas reales de la directora y de n8n (/internal). Cubre la
// asignación, la lista de espera, la concurrencia sobre el último cupo, la definición de adjudicadas (C25 punto 2), la
// derivación desde el dictamen (C58), el uso de la configuración (C25), la cuota 0 (C25 punto 5), el tiempo de atención y
// el acceso por rol. Datos ficticios @ejemplo.test; n8n se simula.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, crearGrado, crearPersonal, eventosDe, unico } from "./ayudantes";
import { entornoAdjudicacion, rutaAdjudicacion, rutaCuota, rutaDictamenDireccion, rutaModalidad } from "./ayudantesAdjudicacion";
import { pdf } from "./ayudantesCarga";
import { estadoDe, intentadaHace, intentosDe } from "./ayudantesVisita";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let e: Awaited<ReturnType<typeof entornoAdjudicacion>>;

beforeAll(async () => {
  firmante = await crearFirmante();
  e = await entornoAdjudicacion(db(), firmante);
});
afterAll(cerrarPool);

const grado = async (id: number) =>
  (await db().query<{ vacantes_autorizadas: number; vacantes_disponibles: number }>("SELECT vacantes_autorizadas, vacantes_disponibles FROM grado WHERE id_grado = $1", [id])).rows[0]!;
const posicion = async (id: number) =>
  (await db().query<{ p: number | null }>("SELECT posicion_lista_espera AS p FROM expediente WHERE id_expediente = $1", [id])).rows[0]!.p;
const eventosTipo = async (id: number, tipo: string) => (await eventosDe(db(), id)).filter((ev) => ev.tipo_evento === tipo);
const ultimoDenegado = async (idPersonal: number) =>
  (
    await db().query<{ id_expediente: number | null; detalle: Record<string, unknown> }>(
      "SELECT id_expediente, detalle FROM registro_auditoria WHERE id_personal = $1 AND tipo_evento = 'acceso_denegado' ORDER BY id_evento DESC LIMIT 1",
      [idPersonal],
    )
  ).rows[0];

describe("HU0012-1.0 asignación exitosa de la vacante", () => {
  it("HU0012-1.0 la directora asigna la vacante a un postulante apto: descuenta una vacante, deja el expediente en vacante_asignada y avisa a la familia el monto de la cuota y las opciones de pago", async () => {
    const id = await e.grado({ autorizadas: 5, disponibles: 2, monto: 7000, maxFracciones: 3 });
    const f = await e.apto(id);

    const res = await e.direccion().post(rutaAdjudicacion(f.idExpediente));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resultado: "vacante_asignada" });
    expect(await estadoDe(db(), f.idExpediente)).toBe("vacante_asignada");
    expect((await grado(id)).vacantes_disponibles).toBe(1);

    const intentos = await intentosDe(db(), f.idExpediente, "vacante_asignada");
    expect(intentos).toHaveLength(1);
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: f.idExpediente, id_notificacion: intentos[0]!.id_notificacion });

    const aviso = await e.interno.aviso(f.idExpediente, { id_notificacion: intentos[0]!.id_notificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body).toMatchObject({ tipo_evento: "vacante_asignada", asunto: expect.stringContaining("Vacante otorgada") });
    expect(aviso.body.cuerpo).toContain("Cuota de ingreso de Primaria: S/ 7,000.00");
    expect(aviso.body.cuerpo).toContain("Pago único");
    expect(aviso.body.cuerpo).toContain("Pago fraccionado, hasta 3 fracciones");
    expect(aviso.body.cuerpo).toContain("/portal/pagos");
    expect(aviso.body.cuerpo).not.toContain("Conclusiones");
  });

  it("HU0012-1.0 (concurrencia) dos adjudicaciones al último cupo: una sola gana, la otra queda en lista de espera y las disponibles terminan en 0", async () => {
    const id = await e.grado({ autorizadas: 1, disponibles: 1 });
    const [a, b] = [await e.apto(id), await e.apto(id)];

    const respuestas = await Promise.all([e.direccion().post(rutaAdjudicacion(a.idExpediente)), e.direccion().post(rutaAdjudicacion(b.idExpediente))]);

    expect(respuestas.map((r) => r.status)).toEqual([200, 200]);
    expect(respuestas.map((r) => r.body.resultado).sort()).toEqual(["lista_espera", "vacante_asignada"]);
    expect(respuestas.find((r) => r.body.resultado === "lista_espera")!.body.posicion).toBe(1);
    expect((await grado(id)).vacantes_disponibles).toBe(0);
    expect([await estadoDe(db(), a.idExpediente), await estadoDe(db(), b.idExpediente)].sort()).toEqual(["lista_espera", "vacante_asignada"]);
  });

  it("HU0012-1.0 (C25) autorizadas − disponibles es igual a los expedientes del grado en vacante_asignada o carta_emitida", async () => {
    const id = await e.grado({ autorizadas: 4, disponibles: 4 });
    const f = [await e.apto(id), await e.apto(id), await e.apto(id)];
    for (const x of f) expect((await e.direccion().post(rutaAdjudicacion(x.idExpediente))).status).toBe(200);
    // HU0016 todavía no existe: el estado final cuenta como adjudicado (definición de ADR-14).
    await db().query("UPDATE expediente SET estado = 'carta_emitida' WHERE id_expediente = $1", [f[0]!.idExpediente]);

    const g = await grado(id);
    const { rows } = await db().query<{ n: number }>(
      "SELECT count(*)::int AS n FROM expediente WHERE id_grado = $1 AND estado IN ('vacante_asignada', 'carta_emitida')",
      [id],
    );
    expect(g.vacantes_autorizadas - g.vacantes_disponibles).toBe(3);
    expect(rows[0]!.n).toBe(3);
  });

  it("HU0012-1.0 (atención) abrir «Ver dictamen» registra atencion_inicio y asignar, atencion_fin con su id_evento_inicio; sin abrirlo, el inicio queda nulo", async () => {
    const f = await e.apto();
    const abierto = await e.direccion().get(rutaDictamenDireccion(f.idExpediente));
    expect(abierto.status).toBe(200);
    await e.direccion().post(rutaAdjudicacion(f.idExpediente));

    const inicio = (await eventosTipo(f.idExpediente, "atencion_inicio")).at(-1)!;
    expect(inicio.detalle).toMatchObject({ item: { tipo: "adjudicacion", id: f.idExpediente } });
    const fin = (await eventosTipo(f.idExpediente, "atencion_fin")).at(-1)!;
    expect(fin.detalle).toMatchObject({ item: { tipo: "adjudicacion", id: f.idExpediente }, decision: "vacante_asignada", id_evento_inicio: Number(inicio.id_evento) });

    const directo = await e.apto();
    await e.direccion().post(rutaAdjudicacion(directo.idExpediente));
    expect((await eventosTipo(directo.idExpediente, "atencion_fin")).at(-1)!.detalle).toMatchObject({ id_evento_inicio: null });
  });

  it("HU0012-1.0 (acceso) otro rol recibe 403 auditado, una cuenta desactivada también (C22), y un expediente que no está apto responde 409 sin descontar", async () => {
    const f = await e.apto();
    const idGrado = f.idGrado;
    const antes = await grado(idGrado);

    expect((await e.api(e.secretaria.token).post(rutaAdjudicacion(f.idExpediente))).status).toBe(403);
    expect(await ultimoDenegado(e.secretaria.idPersonal)).toBeDefined();
    expect(await estadoDe(db(), f.idExpediente)).toBe("apto");

    const sub = randomUUID();
    const inactiva = await crearPersonal(db(), "directora", sub);
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [inactiva]);
    expect((await e.api(await firmante.token(sub, ["directora"])).post(rutaAdjudicacion(f.idExpediente))).status).toBe(403);

    const otro = await e.familia("en_evaluacion", idGrado);
    const res = await e.direccion().post(rutaAdjudicacion(otro.idExpediente));
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("ADJUDICACION_NO_CORRESPONDE");
    expect(await grado(idGrado)).toEqual(antes);
  });

  it("HU0012-1.0 (aviso) un aviso de vacante sin cerrar se retoma a los 10 min con una fila nueva, como ADR-07", async () => {
    const f = await e.apto();
    await e.direccion().post(rutaAdjudicacion(f.idExpediente));
    const [primero] = await intentosDe(db(), f.idExpediente, "vacante_asignada");
    await intentadaHace(db(), primero!.id_notificacion, 11);

    expect(await e.interno.pendientes()).toContainEqual({ id_expediente: f.idExpediente, tipo_evento: "vacante_asignada" });
    const retoma = await e.interno.aviso(f.idExpediente, { tipo_evento: "vacante_asignada" });
    expect(retoma.status).toBe(201);
    expect(retoma.body.id_notificacion).toBeGreaterThan(primero!.id_notificacion);
    const contacto = await e.interno.contacto(f.idExpediente, retoma.body.id_notificacion);
    expect(contacto.body.correo).toBe(f.correo);
  });
});

describe("HU0012-2.0 intento de asignación en un grado sin vacantes", () => {
  it("HU0012-2.0 con las vacantes en cero el sistema bloquea la asignación, registra al postulante en la lista de espera del grado con su posición y le avisa", async () => {
    const id = await e.grado({ autorizadas: 1, disponibles: 0 });
    const [a, b] = [await e.apto(id), await e.apto(id)];

    const primero = await e.direccion().post(rutaAdjudicacion(a.idExpediente));
    const segundo = await e.direccion().post(rutaAdjudicacion(b.idExpediente));

    expect(primero.body).toEqual({ resultado: "lista_espera", posicion: 1 });
    expect(segundo.body).toEqual({ resultado: "lista_espera", posicion: 2 });
    expect(await estadoDe(db(), a.idExpediente)).toBe("lista_espera");
    expect(await posicion(b.idExpediente)).toBe(2);
    expect((await grado(id)).vacantes_disponibles).toBe(0);

    const [intento] = await intentosDe(db(), b.idExpediente, "lista_espera");
    expect(e.eventos.disparar).toHaveBeenCalledWith("agendamiento", { id_expediente: b.idExpediente, id_notificacion: intento!.id_notificacion });
    const aviso = await e.interno.aviso(b.idExpediente, { id_notificacion: intento!.id_notificacion });
    expect(aviso.status).toBe(201);
    expect(aviso.body.cuerpo).toContain("lista de espera del grado, en la posición 2");

    const fin = (await eventosTipo(b.idExpediente, "atencion_fin")).at(-1)!;
    expect(fin.detalle).toMatchObject({ decision: "lista_espera", posicion: 2 });
  });

  it("HU0012-2.0 (aviso) un aviso de lista de espera sin cerrar se retoma a los 10 min con una fila nueva y la misma posición", async () => {
    const id = await e.grado({ autorizadas: 1, disponibles: 0 });
    const f = await e.apto(id);
    await e.direccion().post(rutaAdjudicacion(f.idExpediente));
    const [primero] = await intentosDe(db(), f.idExpediente, "lista_espera");
    await intentadaHace(db(), primero!.id_notificacion, 11);

    expect(await e.interno.pendientes()).toContainEqual({ id_expediente: f.idExpediente, tipo_evento: "lista_espera" });
    const retoma = await e.interno.aviso(f.idExpediente, { tipo_evento: "lista_espera" });
    expect(retoma.status).toBe(201);
    expect(retoma.body.id_notificacion).toBeGreaterThan(primero!.id_notificacion);
    expect(retoma.body.cuerpo).toContain("en la posición 1");
  });

  it("HU0012-2.0 (por grado) cada grado numera su propia lista de espera, y G07 marca el grado sin vacantes y cuenta la lista", async () => {
    const id = await e.grado({ autorizadas: 1, disponibles: 0 });
    const a = await e.apto(id);
    await e.apto(id);
    const otro = await e.apto(await e.grado({ autorizadas: 1, disponibles: 0 }));

    expect((await e.direccion().post(rutaAdjudicacion(a.idExpediente))).body.posicion).toBe(1);
    expect((await e.direccion().post(rutaAdjudicacion(otro.idExpediente))).body.posicion).toBe(1);

    const panel = await e.direccion().get("/direccion/adjudicacion");
    expect(panel.body.inventario.find((g: { id_grado: number }) => g.id_grado === id)).toMatchObject({ autorizadas: 1, adjudicadas: 1, disponibles: 0, lista_espera: 1 });
    expect(panel.body.pendientes.filter((p: { sin_vacantes: boolean; grado: string }) => p.sin_vacantes).length).toBeGreaterThan(0);
  });
});

describe("HU0010-1.0 derivación a la Dirección y acceso al dictamen en G07", () => {
  const psicologa = () => e.api(e.tokenPsicologa);

  it("HU0010-1.0 [parte: derivación] un dictamen Apto emitido en G06 aparece en G07, y la directora abre las conclusiones y el informe; otro rol recibe 403 auditado con el recurso", async () => {
    const a = await e.agendada();
    let minutos = 5;
    for (const c of a.citas) await db().query("UPDATE cita SET fecha_hora = now() - make_interval(mins => $2) WHERE id_cita = $1", [c.id_cita, (minutos += 2)]);
    for (const tipo of ["evaluacion_psicologica", "entrevista_padres"]) {
      expect((await psicologa().post(`/psicologia/citas/${a.cita(tipo)}/resultado`, { resultado: "Logrado", observaciones: "Observación ficticia" })).status).toBe(201);
    }
    const academica = await e.api(e.tokenEvaluador).post(`/evaluacion-academica/citas/${a.cita("evaluacion_academica")}/resultado`, { resultado: "Logrado", observaciones: "Observación ficticia" });
    expect(academica.status).toBe(201);
    const id = a.f.idExpediente;
    const dictamen = await request(e.app)
      .post(`/psicologia/expedientes/${id}/dictamen`)
      .set("Authorization", `Bearer ${e.tokenPsicologa}`)
      .field("dictamen", "apto")
      .field("conclusiones", "Conclusiones ficticias para Dirección")
      .attach("archivo", pdf("informe ficticio"), { filename: "informe.pdf", contentType: "application/pdf" });
    expect(dictamen.status).toBe(201);

    const panel = await e.direccion().get("/direccion/adjudicacion");
    expect(panel.status).toBe(200);
    expect(panel.body.pendientes).toContainEqual(expect.objectContaining({ id_expediente: id, dictamen: "apto", sin_vacantes: false, recibido: expect.any(String) }));

    const detalle = await e.direccion().get(rutaDictamenDireccion(id));
    expect(detalle.status).toBe(200);
    expect(detalle.body).toMatchObject({ id_expediente: id, dictamen: "apto", conclusiones: "Conclusiones ficticias para Dirección", tiene_informe: true });
    const informe = await e.direccion().get(`${rutaDictamenDireccion(id)}/informe`);
    expect(informe.status).toBe(200);
    expect(informe.headers["content-type"]).toContain("application/pdf");

    expect((await e.api(e.tesoreria.token).get(rutaDictamenDireccion(id))).status).toBe(403);
    expect(await ultimoDenegado(e.tesoreria.idPersonal)).toMatchObject({ id_expediente: id, detalle: { recurso: "informe_psicologico" } });
    expect((await e.api(e.secretaria.token).get(`${rutaDictamenDireccion(id)}/informe`)).status).toBe(403);
    expect(await ultimoDenegado(e.secretaria.idPersonal)).toMatchObject({ id_expediente: id, detalle: { recurso: "informe_psicologico" } });
  });

  it("HU0010-1.0 [parte: derivación] G07 no lista un expediente que ya se decidió ni uno de otra campaña", async () => {
    const f = await e.apto();
    await e.direccion().post(rutaAdjudicacion(f.idExpediente));
    const panel = await e.direccion().get("/direccion/adjudicacion");
    expect(panel.body.pendientes.map((p: { id_expediente: number }) => p.id_expediente)).not.toContain(f.idExpediente);
    expect((await e.direccion().get(rutaDictamenDireccion(f.idExpediente))).status).toBe(409);

    const ajena = await e.apto(await crearGrado(db(), { campana: `O${unico()}` }));
    const otraVez = await e.direccion().get("/direccion/adjudicacion");
    expect(otraVez.body.pendientes.map((p: { id_expediente: number }) => p.id_expediente)).not.toContain(ajena.idExpediente);
  });
});

describe("HU0022 la configuración de G09 se aplica en la adjudicación (C25)", () => {
  const secretaria = () => request(e.app).patch("/configuracion/grados").set("Authorization", `Bearer ${e.tokenSecretaria}`);

  it("HU0022-1.0 [parte: adjudicación] las vacantes, la cuota y el máximo de fracciones guardados en G09 son los que usa la adjudicación y ve la familia", async () => {
    const id = await e.grado({ autorizadas: 1, disponibles: 1, monto: 7000, maxFracciones: 1 });
    const guardado = await secretaria().send({ grados: [{ id_grado: id, vacantes_autorizadas: 2, monto_cuota_ingreso: 4000, max_fracciones: 4 }] });
    expect(guardado.status).toBe(200);

    const [a, b] = [await e.apto(id), await e.apto(id)];
    expect((await e.direccion().post(rutaAdjudicacion(a.idExpediente))).body.resultado).toBe("vacante_asignada");
    expect((await e.direccion().post(rutaAdjudicacion(b.idExpediente))).body.resultado).toBe("vacante_asignada");
    expect((await grado(id)).vacantes_disponibles).toBe(0);

    const [intento] = await intentosDe(db(), a.idExpediente, "vacante_asignada");
    const aviso = await e.interno.aviso(a.idExpediente, { id_notificacion: intento!.id_notificacion });
    expect(aviso.body.cuerpo).toContain("S/ 4,000.00");
    expect(aviso.body.cuerpo).toContain("hasta 4 fracciones");
    const cuota = await e.familiaApi(a.token).get(rutaCuota(a.idExpediente));
    expect(cuota.body).toMatchObject({ monto: 4000, max_fracciones: 4 });
  });

  it("HU0022-2.0 [parte: adjudicación real] con vacantes adjudicadas por G07, G09 rechaza fijar menos autorizadas e informa el mínimo", async () => {
    const id = await e.grado({ autorizadas: 3, disponibles: 3 });
    const [a, b] = [await e.apto(id), await e.apto(id)];
    await e.direccion().post(rutaAdjudicacion(a.idExpediente));
    await e.direccion().post(rutaAdjudicacion(b.idExpediente));

    const res = await secretaria().send({ grados: [{ id_grado: id, vacantes_autorizadas: 1 }] });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ codigo: "VACANTES_MENORES_QUE_ADJUDICADAS", detalle: [{ id_grado: id, minimo: 2 }] });
    expect(await grado(id)).toMatchObject({ vacantes_autorizadas: 3, vacantes_disponibles: 1 });
  });
});

describe("C25 (5) grado con cuota 0", () => {
  it("C25 (5) un grado con cuota 0 adjudica sin pago: queda en vacante_asignada, el aviso no pide pagar, P07 no aplica y el POST de la modalidad y el del comprobante responden 409 CUOTA_NO_APLICA", async () => {
    const f = await e.apto(await e.grado({ monto: 0 }));

    expect((await e.direccion().post(rutaAdjudicacion(f.idExpediente))).body).toEqual({ resultado: "vacante_asignada" });

    expect(await estadoDe(db(), f.idExpediente)).toBe("vacante_asignada");
    const fin = (await eventosTipo(f.idExpediente, "atencion_fin")).at(-1)!;
    expect(fin.detalle).toMatchObject({ decision: "vacante_asignada", cuota_acreditada: true });

    const [intento] = await intentosDe(db(), f.idExpediente, "vacante_asignada");
    const aviso = await e.interno.aviso(f.idExpediente, { id_notificacion: intento!.id_notificacion });
    expect(aviso.body.cuerpo).toContain("Este grado no tiene cuota de ingreso.");
    expect(aviso.body.cuerpo).not.toContain("S/");

    const familia = e.familiaApi(f.token);
    expect((await familia.get(rutaCuota(f.idExpediente))).body).toMatchObject({ aplica: false, modalidad_editable: false, registrable: false });
    const modalidad = await familia.post(rutaModalidad(f.idExpediente), { modalidad: "unico" });
    expect(modalidad.status).toBe(409);
    expect(modalidad.body.error.codigo).toBe("CUOTA_NO_APLICA");
    const pago = await e.comprobante(f);
    expect(pago.status).toBe(409);
    expect(pago.body.error.codigo).toBe("CUOTA_NO_APLICA");
  });

  it("C25 (5) con cuota mayor que 0, el atencion_fin de la adjudicación no lleva cuota_acreditada", async () => {
    const f = await e.apto();
    await e.direccion().post(rutaAdjudicacion(f.idExpediente));
    expect((await eventosTipo(f.idExpediente, "atencion_fin")).at(-1)!.detalle).not.toHaveProperty("cuota_acreditada");
  });
});
