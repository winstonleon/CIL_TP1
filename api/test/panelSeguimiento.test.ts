// Panel de seguimiento de la familia (HU0020, P04) por la ruta real: avance, validaciones, acciones pendientes e historial. El
// historial es una lista blanca (ADR-29): se prueba con eventos reales que lo que no debe ver la familia no sale.
// Datos ficticios @ejemplo.test; n8n se simula.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { insertarEvento } from "../src/repositories/auditoria";
import { crearFirmante, eventosDe } from "./ayudantes";
import { familiaConFicha } from "./ayudantesCarga";
import { fichaCompleta } from "./ayudantesFicha";
import { entornoCarta, rutaCartaFamilia } from "./ayudantesCarta";
import { CONFORME, observar, rutaDecisionPago, rutaDecisionSecretaria, rutaDecisionTesoreria } from "./ayudantesValidacion";

const db = () => obtenerPool();
let e: Awaited<ReturnType<typeof entornoCarta>>;

beforeAll(async () => {
  e = await entornoCarta(db(), await crearFirmante());
});
afterAll(cerrarPool);

const rutaPanel = (id: number) => `/familia/expedientes/${id}/panel`;
const panel = async (f: { idExpediente: number; token: string }) => {
  const res = await request(e.app).get(rutaPanel(f.idExpediente)).set("Authorization", `Bearer ${f.token}`);
  expect(res.status).toBe(200);
  return res.body as {
    etapas: { clave: string; titulo: string; estado: string }[];
    validaciones: Record<string, string>;
    acciones: { tipo: string; titulo: string; motivo?: string; destino?: string }[];
    historial: { fecha: string; texto: string }[];
    carta: { disponible: boolean; fecha_emision: string | null };
  };
};
const estadosDe = (p: Awaited<ReturnType<typeof panel>>) => Object.fromEntries(p.etapas.map((x) => [x.clave, x.estado]));
const fijarEstado = (id: number, estado: string) => db().query("UPDATE expediente SET estado = $2::estado_expediente WHERE id_expediente = $1", [id, estado]);

describe("HU0020-1.0 consulta del avance de la postulación", () => {
  it("HU0020-1.0 muestra las seis etapas del proceso, en el orden del mockup", async () => {
    const p = await panel(await e.familia("portal_habilitado"));

    expect(p.etapas.map((x) => x.titulo)).toEqual(["Ficha y cuestionario", "Documentos", "Pagos y doc. financiera", "Evaluaciones", "Resultado", "Cuota y carta"]);
    expect(estadosDe(p)).toEqual({ ficha: "pendiente", documentos: "pendiente", pagos: "pendiente", evaluaciones: "pendiente", resultado: "pendiente", carta: "pendiente" });
    expect(p.validaciones).toEqual({ documental: "pendiente", financiera: "pendiente", derecho: "pendiente" });
    expect(p.carta).toEqual({ disponible: false, fecha_emision: null });
  });

  it("HU0020-1.0 en validación muestra el estado de cada validación: conforme, en revisión u observado, y la etapa toma la peor", async () => {
    const x = await e.enValidacion();
    await e.api(e.tesoreria.token).post(rutaDecisionPago(x.idPago), CONFORME);

    const p = await panel(x.f);

    expect(p.validaciones).toEqual({ documental: "en_revision", financiera: "en_revision", derecho: "conforme" });
    expect(estadosDe(p)).toMatchObject({ documentos: "en_revision", pagos: "en_revision", evaluaciones: "pendiente" });

    await e.api(e.tesoreria.token).post(rutaDecisionTesoreria(x.f.idExpediente, x.docs.boletas[0]!), observar("Falta la boleta de agosto"));
    const observado = await panel(x.f);
    expect(observado.validaciones).toMatchObject({ financiera: "observado", derecho: "conforme" });
    expect(estadosDe(observado)).toMatchObject({ pagos: "observado", documentos: "en_revision" });
  });

  it.each([
    ["en_evaluacion", "en_revision", "pendiente"],
    ["en_observacion", "completado", "en_revision"],
    ["apto", "completado", "en_revision"],
    ["no_apto", "completado", "completado"],
    ["lista_espera", "completado", "completado"],
  ])("HU0020-1.0 con el expediente en %s, evaluaciones = %s y resultado = %s", async (estado, evaluaciones, resultado) => {
    const f = await e.familia(estado === "no_apto" || estado === "en_observacion" || estado === "apto" ? "en_evaluacion" : "portal_habilitado");
    await fijarEstado(f.idExpediente, estado);

    expect(estadosDe(await panel(f))).toMatchObject({ documentos: "completado", pagos: "completado", evaluaciones, resultado });
  });

  it("HU0020-1.0 la cuota en conciliación deja «Cuota y carta» en revisión; la carta emitida la completa y queda disponible", async () => {
    const x = await e.porConciliar();
    expect(estadosDe(await panel(x.f))).toMatchObject({ resultado: "completado", carta: "en_revision" });
    expect((await panel(x.f)).acciones).toEqual([{ tipo: "informacion", titulo: "Tesorería está conciliando tu comprobante. La Carta de Vacante se emite al conciliarlo." }]);

    await e.api(e.tesoreria.token).post(rutaDecisionPago(x.idPago), CONFORME);
    await e.cartaN8n.emitir(x.f.idExpediente);

    const p = await panel(x.f);
    expect(estadosDe(p)).toMatchObject({ carta: "completado" });
    expect(p.carta.disponible).toBe(true);
    expect(p.carta.fecha_emision).not.toBeNull();
    expect((await request(e.app).get(rutaCartaFamilia(x.f.idExpediente)).set("Authorization", `Bearer ${x.f.token}`)).status).toBe(200);
  });

  it("HU0020-1.0 (historial) muestra los cambios del expediente con su fecha, lo más reciente primero y por área", async () => {
    const x = await e.conciliada();
    await e.cartaN8n.emitir(x.f.idExpediente);

    const { historial } = await panel(x.f);

    expect(historial.map((h) => h.texto)).toEqual([
      "Se emitió la Carta de Vacante",
      "Tesorería concilió la cuota de ingreso",
      "Registraste el comprobante de la cuota de ingreso",
      "Se otorgó la vacante",
    ]);
    for (const h of historial) expect(Number.isNaN(Date.parse(h.fecha))).toBe(false);
  });

  it("HU0020-1.0 (historial) nombra la observación de Tesorería sin el motivo, que va solo en las acciones", async () => {
    const x = await e.enValidacion();
    await e.api(e.tesoreria.token).post(rutaDecisionPago(x.idPago), observar("Número de operación ilegible"));

    const textos = (await panel(x.f)).historial.map((h) => h.texto);

    expect(textos).toContain("Tesorería observó el derecho de admisión (S/ 300)");
    expect(textos.join(" ")).not.toContain("ilegible");
  });

  it("HU0020-1.0 (historial) traduce cada evento de la lista blanca a su texto", async () => {
    const f = await e.familia("en_postulacion");
    const id = f.idExpediente;
    await insertarEvento(db(), { tipoEvento: "transicion_estado", idExpediente: id, estadoAnterior: "portal_habilitado", estadoNuevo: "en_postulacion", detalle: { campo: "estado" } });
    await insertarEvento(db(), { tipoEvento: "documentos_confirmados", idExpediente: id, detalle: { documentos_vigentes: 11 } });
    await insertarEvento(db(), { tipoEvento: "completitud_verificada", idExpediente: id, detalle: { resultado: "incompleto", faltantes: [] } });
    await insertarEvento(db(), { tipoEvento: "completitud_verificada", idExpediente: id, detalle: { resultado: "completo", faltantes: [] } });
    await insertarEvento(db(), { tipoEvento: "subsanacion_registrada", idExpediente: id, detalle: { item: { tipo: "validacion_documental", id } } });
    await insertarEvento(db(), { tipoEvento: "subsanacion_registrada", idExpediente: id, detalle: { item: { tipo: "pago", id: 1 } } });
    await insertarEvento(db(), { tipoEvento: "cita_reprogramada", idExpediente: id, detalle: { id_cita_anterior: 1 } });
    await insertarEvento(db(), { tipoEvento: "transicion_estado", idExpediente: id, estadoAnterior: "pendiente", estadoNuevo: "conforme", detalle: { campo: "estado_documental" } });

    const textos = (await panel(f)).historial.map((h) => h.texto);

    expect(textos).toEqual([
      "Reprogramaste una cita",
      "Subsanaste un comprobante",
      "Subsanaste un documento",
      "Tu expediente aún está incompleto",
      "Cargaste 11 documentos",
      "Iniciaste la ficha de inscripción",
    ]);
  });

  it("HU0020-1.0 (privacidad) no muestra conclusiones, observaciones de evaluaciones, nombres del personal, el dictamen Apto ni datos de otra familia", async () => {
    const x = await e.enConciliacion();
    await e.conPostulante(x.f);
    const otra = await e.conPostulante(await e.conVacante());
    await db().query("UPDATE apoderado SET nombres = 'Hermelinda', apellidos = 'Ajena Otrafamilia' WHERE id_apoderado = $1", [otra.idApoderado]);
    const id = x.f.idExpediente;
    const secretos = {
      conclusiones: "Conclusiones ficticias reservadas",
      observaciones: "Observaciones ficticias de la evaluación",
      personal: "Personal Ficticio",
    };
    await db().query("UPDATE personal SET nombres = 'Personal', apellidos = 'Ficticio' WHERE id_personal = $1", [e.directora]);
    // Eventos que la familia no debe ver, con detalle sensible: solo salen si la lista blanca falla.
    const directora = e.directora;
    await insertarEvento(db(), { tipoEvento: "atencion_inicio", idExpediente: id, idPersonal: directora, detalle: { item: { tipo: "dictamen", id } } });
    await insertarEvento(db(), { tipoEvento: "atencion_fin", idExpediente: id, idPersonal: directora, detalle: { item: { tipo: "dictamen", id }, decision: "apto", conclusiones: secretos.conclusiones } });
    await insertarEvento(db(), { tipoEvento: "atencion_fin", idExpediente: id, idPersonal: directora, detalle: { item: { tipo: "cita", id: 1 }, decision: "resultado", observaciones: secretos.observaciones } });
    await insertarEvento(db(), { tipoEvento: "atencion_fin", idExpediente: id, idPersonal: directora, detalle: { item: { tipo: "adjudicacion", id }, decision: "vacante_asignada" } });
    await insertarEvento(db(), { tipoEvento: "acceso_denegado", idExpediente: id, idPersonal: directora, detalle: { recurso: "informe_psicologico" } });
    await insertarEvento(db(), { tipoEvento: "transicion_estado", idExpediente: id, idPersonal: directora, estadoAnterior: "en_evaluacion", estadoNuevo: "apto", detalle: { campo: "estado" } });
    await insertarEvento(db(), { tipoEvento: "transicion_estado", idExpediente: id, estadoAnterior: "en_evaluacion", estadoNuevo: "en_observacion", detalle: { campo: "estado" } });

    const res = await request(e.app).get(rutaPanel(id)).set("Authorization", `Bearer ${x.f.token}`);

    const texto = JSON.stringify(res.body);
    for (const prohibido of [secretos.conclusiones, secretos.observaciones, secretos.personal, "Hermelinda", "Otrafamilia", "id_personal", "detalle", "Apto", "apto", "observación"]) {
      expect(texto).not.toContain(prohibido);
    }
    expect((await eventosDe(db(), id)).length).toBeGreaterThan(res.body.historial.length);
  });

  it("HU0020-1.0 (D4-A) con el dictamen Apto o En observación, la familia ve «En revisión» y ningún rastro del dictamen", async () => {
    const f = await e.apto();
    expect(estadosDe(await panel(f)).resultado).toBe("en_revision");
    await fijarEstado(f.idExpediente, "en_observacion");

    const p = await panel(f);

    expect(estadosDe(p).resultado).toBe("en_revision");
    expect(JSON.stringify(p)).not.toMatch(/apto|observaci[oó]n|Conclusiones ficticias/i);
  });

  it.each(["apto", "en_observacion"])("HU0020-1.0 (D4-A) con el expediente en %s, ninguna respuesta de /familia/* lo revela", async (estado) => {
    const f = await familiaConFicha(db(), e);
    await fijarEstado(f.idExpediente, estado);
    const base = `/familia/expedientes/${f.idExpediente}`;
    const familia = () => ({ Authorization: `Bearer ${f.token}` });
    const prohibido = /(?<!no_)apto|en.observaci[oó]n/i;

    const lecturas = await Promise.all(
      ["/familia/expedientes", `${base}/ficha`, `${base}/requisitos`, `${base}/documentos`, `${base}/derecho-admision`, `${base}/cuota-ingreso`, `${base}/evaluaciones`, `${base}/panel`, `${base}/carta`].map((ruta) =>
        request(e.app).get(ruta).set(familia()),
      ),
    );
    const escrituras = await Promise.all([
      request(e.app).put(`${base}/ficha`).set(familia()).send(fichaCompleta()),
      request(e.app).post(`${base}/documentos/confirmacion`).set(familia()).send({}),
      request(e.app).post(`${base}/cuota-ingreso/modalidad`).set(familia()).send({ modalidad: "unico" }),
      request(e.app).post(`${base}/evaluaciones`).set(familia()).send({ horarios: [{ tipo_cita: "entrevista_padres", id_horario: 1 }] }),
    ]);

    expect(lecturas.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 404]);
    for (const r of [...lecturas, ...escrituras]) expect(r.text).not.toMatch(prohibido);
    expect(lecturas[0]!.body[0].estado).toBe("resultado_en_revision");
    expect(lecturas[1]!.body.estado).toBe("resultado_en_revision");
  });

  it("HU0020-1.0 (D4-A) el No apto sí se ve, porque ya se notificó a la familia", async () => {
    const f = await e.familia("no_apto");

    const res = await request(e.app).get("/familia/expedientes").set("Authorization", `Bearer ${f.token}`);

    expect(res.body[0].estado).toBe("no_apto");
  });

  it("HU0020-1.0 (acceso) un expediente ajeno responde 404, como uno inexistente, y el intento se audita", async () => {
    const f = await e.familia("portal_habilitado");
    const ajena = await e.familia("portal_habilitado");

    const res = await request(e.app).get(rutaPanel(f.idExpediente)).set("Authorization", `Bearer ${ajena.token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");
    expect((await eventosDe(db(), f.idExpediente)).some((ev) => ev.tipo_evento === "acceso_denegado")).toBe(true);
    expect((await request(e.app).get(rutaPanel(f.idExpediente))).status).toBe(401);
  });
});

describe("HU0020-2.0 atención de una acción pendiente", () => {
  it("HU0020-2.0 un documento observado muestra el motivo y lleva a P06; el de Tesorería se nombra por su área", async () => {
    const x = await e.enValidacion();
    await e.api(e.secretaria.token).post(rutaDecisionSecretaria(x.f.idExpediente, x.docs.partida), observar("Partida ilegible"));
    await e.api(e.tesoreria.token).post(rutaDecisionTesoreria(x.f.idExpediente, x.docs.boletas[0]!), observar("Falta la boleta de agosto"));

    const { acciones } = await panel(x.f);

    const subsanar = acciones.filter((a) => a.tipo === "subsanar");
    expect(subsanar).toHaveLength(2);
    expect(subsanar[0]).toMatchObject({ motivo: "Partida ilegible", destino: "/portal/documentos" });
    expect(subsanar[0]!.titulo).toContain("Secretaría observó un documento");
    expect(subsanar[1]).toMatchObject({ motivo: "Falta la boleta de agosto", destino: "/portal/documentos" });
    expect(subsanar[1]!.titulo).toContain("Tesorería observó tu documentación financiera");
  });

  it("HU0020-2.0 un comprobante observado del derecho lleva a P07b, y uno de la cuota a P07, con su motivo", async () => {
    const x = await e.enValidacion();
    await e.api(e.tesoreria.token).post(rutaDecisionPago(x.idPago), observar("Monto incompleto"));
    expect((await panel(x.f)).acciones).toContainEqual({
      tipo: "subsanar",
      titulo: "Tesorería observó tu comprobante del derecho de admisión",
      motivo: "Monto incompleto",
      destino: "/portal/pagos/derecho-admision",
    });

    const c = await e.porConciliar();
    await e.api(e.tesoreria.token).post(rutaDecisionPago(c.idPago), observar("El número de operación no coincide"));
    expect((await panel(c.f)).acciones).toEqual([
      { tipo: "subsanar", titulo: "Tesorería observó el comprobante de tu cuota de ingreso", motivo: "El número de operación no coincide", destino: "/portal/pagos" },
    ]);
  });

  it("HU0020-2.0 subsanada la observación, la acción desaparece", async () => {
    const x = await e.enValidacion();
    await db().query("UPDATE pago SET estado_validacion = 'observado', motivo_observacion = 'Ilegible' WHERE id_pago = $1", [x.idPago]);
    expect((await panel(x.f)).acciones.some((a) => a.tipo === "subsanar")).toBe(true);

    await db().query("UPDATE pago SET estado_validacion = 'pendiente' WHERE id_pago = $1", [x.idPago]);

    expect((await panel(x.f)).acciones.some((a) => a.tipo === "subsanar")).toBe(false);
  });

  it("HU0020-2.0 cada acción pendiente lleva a su pantalla: ficha, documentos, derecho, evaluaciones y cuota", async () => {
    const nueva = await panel(await e.familia("portal_habilitado"));
    expect(nueva.acciones).toEqual([{ tipo: "completar", titulo: "Completa la ficha y el cuestionario", destino: "/portal/ficha" }]);

    const habilitada = await e.habilitada({});
    expect((await panel(habilitada)).acciones).toEqual([{ tipo: "completar", titulo: "Agenda tus evaluaciones", destino: "/portal/evaluaciones" }]);

    const f = await e.conPostulante(await e.conVacante());
    expect((await panel(f)).acciones).toEqual([{ tipo: "completar", titulo: "Elige la modalidad de pago de la cuota de ingreso", destino: "/portal/pagos" }]);
    await e.familiaApi(f.token).post(`/familia/expedientes/${f.idExpediente}/cuota-ingreso/modalidad`, { modalidad: "unico" });
    expect((await panel(f)).acciones).toEqual([{ tipo: "completar", titulo: "Registra el comprobante de la cuota de ingreso", destino: "/portal/pagos" }]);
  });

  it("HU0020-2.0 si la última verificación solo encontró que falta el derecho, la acción lleva a P07b y no a documentos", async () => {
    const f = await familiaConFicha(db(), e);
    await db().query("UPDATE expediente SET estado = 'en_postulacion' WHERE id_expediente = $1", [f.idExpediente]);
    await insertarEvento(db(), { tipoEvento: "documentos_confirmados", idExpediente: f.idExpediente, detalle: { documentos_vigentes: 1 } });
    await insertarEvento(db(), { tipoEvento: "completitud_verificada", idExpediente: f.idExpediente, detalle: { resultado: "incompleto", faltantes: [], derecho_registrado: false } });

    expect((await panel(f)).acciones).toEqual([{ tipo: "completar", titulo: "Registra el comprobante del derecho de admisión", destino: "/portal/pagos/derecho-admision" }]);
  });

  it("HU0020-2.0 mientras las validaciones siguen abiertas, avisa cuándo se podrán agendar las evaluaciones, sin enlace", async () => {
    const x = await e.enValidacion();

    expect((await panel(x.f)).acciones).toContainEqual({
      tipo: "informacion",
      titulo: "Tus evaluaciones se podrán agendar cuando se validen los documentos, el derecho de admisión y la documentación financiera.",
    });
  });
});
