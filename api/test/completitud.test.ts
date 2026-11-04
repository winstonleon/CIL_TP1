// HU0017 (verificación automática de completitud, ADR-22) por /internal/*, como la piden los flujos recepcion-registro y
// verificacion-completitud: 1.0 expediente completo → en_validacion con las tres ramas abiertas en `pendiente`; 2.0
// incompleto → se mantiene en en_postulacion y se reserva el aviso de faltantes (ADR-07). Más la idempotencia, el bloqueo,
// la reconfirmación, la confirmación sin cambios (ajuste 2), el cambio de G09, el barrido y C25. Datos ficticios
// @ejemplo.test; n8n se simula con el disparador falso de entornoFicha.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { insertarDocumento } from "../src/repositories/documento";
import { BANCOS } from "../src/services/derechoAdmision";
import { crearFirmante, eventosDe, unico } from "./ayudantes";
import { pdf, rutaConfirmacion, rutaDerecho, rutaDocumentos, familiaConFicha, subir } from "./ayudantesCarga";
import { dniNuevo, entornoFicha, fichaCompleta, requisito } from "./ayudantesFicha";
import { estadoDe, intentadaHace, intentosDe } from "./ayudantesVisita";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

const TOKEN = () => process.env.INTERNAL_API_TOKEN!;
const FRONT = () => process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "");
const entorno = () => entornoFicha(db(), firmante);
type Entorno = Awaited<ReturnType<typeof entorno>>;
type Familia = Awaited<ReturnType<typeof familiaConFicha>>;

const verificar = (e: Entorno, idExpediente: number) =>
  request(e.app).post(`/internal/expedientes/${idExpediente}/verificacion-completitud`).set("Authorization", `Bearer ${TOKEN()}`).send();
const pendientes = async (e: Entorno) =>
  ((await request(e.app).get("/internal/completitud/pendientes").set("Authorization", `Bearer ${TOKEN()}`)).body.expedientes as { id_expediente: number }[]).map(
    (x) => x.id_expediente,
  );
const confirmar = (e: Entorno, f: Familia) => request(e.app).post(rutaConfirmacion(f.idExpediente)).set("Authorization", `Bearer ${f.token}`).send({});
const documentos = (e: Entorno, f: Familia) => request(e.app).get(rutaDocumentos(f.idExpediente)).set("Authorization", `Bearer ${f.token}`);
const cargar = (e: Entorno, f: Familia, idRequisito: number, idApoderado?: number) =>
  subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: idRequisito, ...(idApoderado ? { id_apoderado: idApoderado } : {}) }, pdf());
const registrarDerecho = (e: Entorno, f: Familia) =>
  subir(e.app, rutaDerecho(f.idExpediente), f.token, { banco: BANCOS[0], numero_operacion: `OP-${unico()}`, fecha_pago: "2026-10-10" }, pdf("voucher ficticio"), "voucher.pdf");
const eventosTipo = async (idExpediente: number, tipo: string) => (await eventosDe(db(), idExpediente)).filter((ev) => ev.tipo_evento === tipo);
const faltantesDe = (idExpediente: number) => intentosDe(db(), idExpediente, "documentos_faltantes");
const ramas = async (idExpediente: number) =>
  (await db().query("SELECT estado_documental::text, estado_financiero::text FROM expediente WHERE id_expediente = $1", [idExpediente])).rows[0];

// Requisitos de un grado de 3.° de primaria: dos generales, uno de colegio peruano, uno de condición especial, uno
// financiero solo para el apoderado dependiente (el titular, «madre») y uno opcional. La ficha de prueba declara colegio
// peruano y sin condición especial.
async function requisitosBase(idGrado: number) {
  return {
    partida: await requisito(db(), idGrado, "Partida de nacimiento", "todos"),
    dni: await requisito(db(), idGrado, "DNI del postulante", "todos"),
    certificado: await requisito(db(), idGrado, "Certificado de estudios", "solo_colegio_peruano", { categoria: "colegio_procedencia" }),
    terapia: await requisito(db(), idGrado, "Informe de terapia", "solo_condicion_especial", { categoria: "condicion_especial" }),
    boletas: await requisito(db(), idGrado, "Boletas de pago", "si_dependiente", { categoria: "financiero", porApoderado: true }),
    opcional: await requisito(db(), idGrado, "Carta de recomendación", "todos", { obligatorio: false }),
  };
}

async function familiaLista(e: Entorno, cambiosFicha: Parameters<typeof fichaCompleta>[0] = {}) {
  let ids!: Awaited<ReturnType<typeof requisitosBase>>;
  const f = await familiaConFicha(db(), e, async (g) => {
    ids = await requisitosBase(g);
  }, undefined, cambiosFicha);
  return { f, ids };
}

// Todo lo obligatorio de la ficha de prueba, menos lo que se indique.
async function cargarTodo(e: Entorno, f: Familia, ids: Awaited<ReturnType<typeof requisitosBase>>, salvo: string[] = []) {
  for (const [nombre, id] of [["partida", ids.partida], ["dni", ids.dni], ["certificado", ids.certificado]] as const) {
    if (!salvo.includes(nombre)) expect((await cargar(e, f, id)).status).toBe(201);
  }
  if (!salvo.includes("boletas")) expect((await cargar(e, f, ids.boletas, f.idApoderado)).status).toBe(201);
  if (!salvo.includes("derecho")) expect((await registrarDerecho(e, f)).status).toBe(201);
}

describe("HU0017-1.0 verificación de expediente completo", () => {
  it("HU0017-1.0 [parte: estado y ramas] con cada requisito obligatorio cargado (también el de colegio de procedencia) y el derecho registrado, pasa a en_validacion con las tres ramas en pendiente", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids);

    const confirmacion = await confirmar(e, f);
    expect(confirmacion.status).toBe(200);
    // ADR-16: el evento lleva solo el id y sale después de responder.
    expect(e.eventos.disparar).toHaveBeenCalledWith("recepcion-registro", { id_expediente: f.idExpediente });

    const res = await verificar(e, f.idExpediente);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id_expediente: f.idExpediente, resultado: "completo" });
    expect(await estadoDe(db(), f.idExpediente)).toBe("en_validacion");
    // D4-X: las ramas documental y financiera, y el derecho de admisión, quedan abiertas en pendiente.
    expect(await ramas(f.idExpediente)).toEqual({ estado_documental: "pendiente", estado_financiero: "pendiente" });
    const pago = (await db().query("SELECT estado_validacion::text FROM pago WHERE id_expediente = $1", [f.idExpediente])).rows;
    expect(pago).toEqual([{ estado_validacion: "pendiente" }]);
    const transiciones = (await eventosTipo(f.idExpediente, "transicion_estado")).filter((t) => t.estado_nuevo === "en_validacion");
    expect(transiciones).toEqual([
      expect.objectContaining({ id_personal: null, estado_anterior: "en_postulacion", estado_nuevo: "en_validacion", detalle: { campo: "estado", origen: "verificacion_completitud" } }),
    ]);
    expect((await eventosTipo(f.idExpediente, "completitud_verificada")).map((v) => v.detalle)).toEqual([
      { resultado: "completo", faltantes: [], derecho_registrado: true },
    ]);
    // Completo no se notifica, el opcional y el de condición especial (no declarada) no se exigen.
    expect(await faltantesDe(f.idExpediente)).toEqual([]);

    // P06 queda en solo lectura con el resultado; la carga ya no se admite.
    const lista = await documentos(e, f);
    expect(lista.body).toMatchObject({ editable: false, verificacion: { resultado: "completo", faltantes: [], falta_derecho: false } });
    expect((await cargar(e, f, ids.opcional)).body.error.codigo).toBe("DOCUMENTOS_NO_EDITABLES");
  });

  it("HU0017-1.0 [parte: estado y ramas] con condición especial declarada se exige el informe de terapia", async () => {
    const e = await entorno();
    const postulante = { ...fichaCompleta().postulante, dni: dniNuevo(), tiene_condicion_especial: true };
    const { f, ids } = await familiaLista(e, { postulante });
    await cargarTodo(e, f, ids);
    await confirmar(e, f);
    const incompleto = await verificar(e, f.idExpediente);
    expect(incompleto.status).toBe(201);
    expect(incompleto.body.cuerpo).toContain("- Informe de terapia\n");

    await cargar(e, f, ids.terapia);
    expect((await confirmar(e, f)).status).toBe(200);
    expect((await verificar(e, f.idExpediente)).body.resultado).toBe("completo");
    expect(await estadoDe(db(), f.idExpediente)).toBe("en_validacion");
  });

  it("HU0017-1.0 [parte: estado y ramas] (idempotencia) dos verificaciones a la vez de la misma confirmación dejan una sola transición", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids);
    await confirmar(e, f);

    const respuestas = await Promise.all([verificar(e, f.idExpediente), verificar(e, f.idExpediente)]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(respuestas.find((r) => r.status === 409)!.body.error.codigo).toBe("VERIFICACION_NO_CORRESPONDE");
    expect((await eventosTipo(f.idExpediente, "transicion_estado")).filter((t) => t.estado_nuevo === "en_validacion")).toHaveLength(1);
    expect(await eventosTipo(f.idExpediente, "completitud_verificada")).toHaveLength(1);
    expect((await verificar(e, f.idExpediente)).body.error.codigo).toBe("VERIFICACION_NO_CORRESPONDE");
  });

  it("HU0017-1.0 [parte: estado y ramas] (bloqueo) la verificación espera a que termine una carga del mismo expediente y ve el documento", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["partida"]);
    await confirmar(e, f);

    // Una carga en curso: tiene bloqueado el expediente, como cargarDocumento.
    const carga = await db().connect();
    try {
      await carga.query("BEGIN");
      await carga.query("SELECT 1 FROM expediente WHERE id_expediente = $1 FOR UPDATE", [f.idExpediente]);
      let terminada = false;
      const verificacion = verificar(e, f.idExpediente).then((r) => {
        terminada = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(terminada).toBe(false);
      await carga.query(
        `INSERT INTO documento (id_expediente, id_requisito, url_archivo, formato, tamano_kb) VALUES ($1, $2, $3, 'pdf', 1)`,
        [f.idExpediente, ids.partida, `prueba-${unico()}`],
      );
      await carga.query("COMMIT");
      const res = await verificacion;
      expect(res.status).toBe(200);
      expect(res.body.resultado).toBe("completo");
    } finally {
      carga.release();
    }
  });
});

describe("HU0017-2.0 detección de expediente incompleto", () => {
  it("HU0017-2.0 falta un documento obligatorio: el expediente se mantiene en en_postulacion y el aviso trae los faltantes por tipo y parentesco, el derecho y los enlaces", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["partida", "boletas", "derecho"]);
    await confirmar(e, f);

    const res = await verificar(e, f.idExpediente);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id_expediente: f.idExpediente, resultado: "incompleto", tipo_evento: "documentos_faltantes" });
    expect(res.body.asunto).toBe(`Documentos pendientes · Admisión ${e.campana}`);
    expect((res.body.cuerpo as string).split("\n")).toEqual([
      "Hola, María Fernanda:",
      "",
      "[Aviso de documentos pendientes: por definir con el colegio]",
      "",
      "Para continuar con la postulación falta:",
      "- Partida de nacimiento",
      "- Boletas de pago (madre)",
      "- Comprobante del derecho de admisión",
      "",
      `Carga los documentos en el portal: ${FRONT()}/portal/documentos`,
      `Registra el derecho de admisión: ${FRONT()}/portal/pagos/derecho-admision`,
      "",
      "Cuando termines, vuelve a presionar «Confirmar documentos».",
      "",
      "[Datos de contacto de Admisión: por definir con el colegio]",
    ]);
    // El cuerpo no lleva el nombre de ningún apoderado distinto del saludo al titular (C11).
    expect(res.body.cuerpo).not.toContain("José Luis");
    expect(await estadoDe(db(), f.idExpediente)).toBe("en_postulacion");
    expect((await eventosTipo(f.idExpediente, "transicion_estado")).filter((t) => t.estado_anterior === "en_postulacion")).toEqual([]);
    expect(await faltantesDe(f.idExpediente)).toEqual([{ id_notificacion: res.body.id_notificacion, tipo_evento: "documentos_faltantes", estado_envio: "pendiente" }]);
    expect((await eventosTipo(f.idExpediente, "completitud_verificada")).map((v) => v.detalle)).toEqual([
      {
        resultado: "incompleto",
        faltantes: [
          { id_requisito: ids.partida, id_apoderado: null },
          { id_requisito: ids.boletas, id_apoderado: f.idApoderado },
        ],
        derecho_registrado: false,
        id_notificacion: res.body.id_notificacion,
      },
    ]);

    // P06 (ajuste 3): los faltantes de la última verificación, por tipo y parentesco.
    const lista = await documentos(e, f);
    expect(lista.body.editable).toBe(true);
    expect(lista.body.verificacion).toEqual({
      resultado: "incompleto",
      verificado_en: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      faltantes: [
        { tipo_documento: "Partida de nacimiento", parentesco: null },
        { tipo_documento: "Boletas de pago", parentesco: "madre" },
      ],
      falta_derecho: true,
    });
  });

  it("HU0017-2.0 (idempotencia) dos verificaciones a la vez de la misma confirmación dejan un solo aviso, y el barrido no la vuelve a tomar", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["partida"]);
    await confirmar(e, f);

    const respuestas = await Promise.all([verificar(e, f.idExpediente), verificar(e, f.idExpediente)]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(respuestas.find((r) => r.status === 409)!.body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    expect(await faltantesDe(f.idExpediente)).toHaveLength(1);
    expect(await eventosTipo(f.idExpediente, "completitud_verificada")).toHaveLength(1);
    expect(await pendientes(e)).not.toContain(f.idExpediente);
  });

  it("HU0017-2.0 la familia carga lo que faltaba y vuelve a confirmar: la nueva verificación da completo y el expediente pasa a en_validacion", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["partida"]);
    await confirmar(e, f);
    expect((await verificar(e, f.idExpediente)).status).toBe(201);

    await cargar(e, f, ids.partida);
    expect((await confirmar(e, f)).status).toBe(200);
    // La confirmación nueva aún no se verificó: P06 no muestra los faltantes viejos.
    expect((await documentos(e, f)).body.verificacion).toBeNull();
    const res = await verificar(e, f.idExpediente);

    expect(res.status).toBe(200);
    expect(res.body.resultado).toBe("completo");
    expect(await estadoDe(db(), f.idExpediente)).toBe("en_validacion");
    expect((await eventosTipo(f.idExpediente, "completitud_verificada")).map((v) => v.detalle.resultado)).toEqual(["incompleto", "completo"]);
    expect(await faltantesDe(f.idExpediente)).toHaveLength(1);
  });

  it("HU0017-2.0 (sin cambios) después de una verificación incompleta, confirmar sin cargar nada responde 409 SIN_CAMBIOS sin evento ni aviso; un documento o el pago del derecho la habilitan", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["partida", "derecho"]);
    await confirmar(e, f);
    await verificar(e, f.idExpediente);
    e.eventos.disparar.mockClear();

    const repetida = await confirmar(e, f);

    expect(repetida.status).toBe(409);
    expect(repetida.body.error).toEqual({
      codigo: "SIN_CAMBIOS",
      mensaje: "No hay cambios desde la última verificación: carga los documentos que faltan antes de confirmar",
    });
    expect(await eventosTipo(f.idExpediente, "documentos_confirmados")).toHaveLength(1);
    expect(e.eventos.disparar).not.toHaveBeenCalled();

    // Registrar el derecho que faltaba es un cambio.
    expect((await registrarDerecho(e, f)).status).toBe(201);
    expect((await confirmar(e, f)).status).toBe(200);
    expect((await verificar(e, f.idExpediente)).status).toBe(201); // sigue faltando la partida
    expect((await confirmar(e, f)).body.error.codigo).toBe("SIN_CAMBIOS");

    // Un documento nuevo también (aunque no sea el faltante).
    await cargar(e, f, ids.opcional);
    expect((await confirmar(e, f)).status).toBe(200);
    expect(e.eventos.disparar).toHaveBeenCalledTimes(2);
  });

  it("HU0017-2.0 (carrera) un documento de una carga que empezó antes de la verificación y se insertó después cuenta como cambio: la reconfirmación no recibe un SIN_CAMBIOS falso", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["partida", "derecho"]);
    await registrarDerecho(e, f);
    await confirmar(e, f);

    // Una carga cuya transacción empezó antes de la verificación (su now() es anterior) y que inserta después de ella.
    const carga = await db().connect();
    try {
      await carga.query("BEGIN");
      await carga.query("SELECT now()");
      expect((await verificar(e, f.idExpediente)).status).toBe(201); // aún falta la partida
      await insertarDocumento(carga, { idExpediente: f.idExpediente, idRequisito: ids.partida, idApoderado: null, clave: `prueba-${unico()}`, formato: "pdf", tamanoKb: 1 });
      await carga.query("COMMIT");
    } finally {
      carga.release();
    }

    expect((await confirmar(e, f)).status).toBe(200);
    expect((await verificar(e, f.idExpediente)).body.resultado).toBe("completo");
  });

  it("HU0017-2.0 (G09) incompleto → Secretaría quita en G09 el requisito faltante → la confirmación sin cargas nuevas se acepta y la verificación da completo", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["certificado"]);
    await confirmar(e, f);
    expect((await verificar(e, f.idExpediente)).status).toBe(201);

    const quitar = await request(e.app).delete(`/configuracion/requisitos/${ids.certificado}`).set("Authorization", `Bearer ${e.tokenSecretaria}`);
    expect(quitar.status).toBe(204);
    // P06 ya no muestra el requisito quitado entre los faltantes.
    expect((await documentos(e, f)).body.verificacion.faltantes).toEqual([]);

    expect((await confirmar(e, f)).status).toBe(200);
    const res = await verificar(e, f.idExpediente);

    expect(res.status).toBe(200);
    expect(res.body.resultado).toBe("completo");
    expect(await estadoDe(db(), f.idExpediente)).toBe("en_validacion");
  });

  it("HU0017-2.0 (ADR-07) un aviso de resultado desconocido se retoma a los 10 min con una fila nueva y los mismos faltantes; a los 6 intentos se cierra fallido", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["partida"]);
    await confirmar(e, f);
    const primero = await verificar(e, f.idExpediente);
    expect(primero.status).toBe(201);
    await intentadaHace(db(), primero.body.id_notificacion, 9);
    expect((await verificar(e, f.idExpediente)).body.error.codigo).toBe("AVISO_YA_REGISTRADO"); // en curso
    expect(await pendientes(e)).not.toContain(f.idExpediente);

    let ultimo = primero.body.id_notificacion as number;
    for (let i = 2; i <= 6; i++) {
      await intentadaHace(db(), ultimo, 11);
      expect(await pendientes(e)).toContain(f.idExpediente);
      const retoma = await verificar(e, f.idExpediente);
      expect(retoma.status).toBe(201);
      expect(retoma.body.id_notificacion).not.toBe(ultimo);
      expect(retoma.body.cuerpo).toBe(primero.body.cuerpo);
      ultimo = retoma.body.id_notificacion;
    }
    await intentadaHace(db(), ultimo, 11);
    const agotado = await verificar(e, f.idExpediente);

    expect(agotado.status).toBe(409);
    expect(agotado.body.error.codigo).toBe("AVISO_AGOTADO");
    expect((await faltantesDe(f.idExpediente)).map((x) => x.estado_envio)).toEqual([...Array(6).fill("pendiente"), "fallido"]);
    expect(await pendientes(e)).not.toContain(f.idExpediente);
    expect((await verificar(e, f.idExpediente)).body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    // La verificación es una sola: los intentos no la repiten.
    expect(await eventosTipo(f.idExpediente, "completitud_verificada")).toHaveLength(1);
    expect(await estadoDe(db(), f.idExpediente)).toBe("en_postulacion");
  });

  it("HU0017-2.0 (barrido) toma la confirmación sin verificar de hace más de 1 min y suelta el aviso cerrado; no toma un expediente en en_validacion", async () => {
    const e = await entorno();
    const { f, ids } = await familiaLista(e);
    await cargarTodo(e, f, ids, ["partida"]);
    // Una confirmación de hace 2 min cuyo webhook no llegó (la bitácora es de solo inserción: se inserta con su hora).
    await db().query(
      "INSERT INTO registro_auditoria (id_expediente, tipo_evento, detalle, fecha_hora) VALUES ($1, 'documentos_confirmados', '{\"documentos_vigentes\": 4}', now() - interval '2 minutes')",
      [f.idExpediente],
    );
    expect(await pendientes(e)).toContain(f.idExpediente);
    const res = await verificar(e, f.idExpediente);
    expect(res.status).toBe(201);

    // notificacion-multicanal cierra el envío: el aviso ya no se retoma aunque pasen los 10 min.
    const cierre = await request(e.app)
      .patch(`/internal/notificaciones/${res.body.id_notificacion}`)
      .set("Authorization", `Bearer ${TOKEN()}`)
      .send({ estado_envio: "enviado" });
    expect(cierre.status).toBe(200);
    await intentadaHace(db(), res.body.id_notificacion, 30);
    expect(await pendientes(e)).not.toContain(f.idExpediente);

    // Una confirmación reciente (menos de 1 min) espera al webhook.
    const otra = await familiaLista(e);
    await cargarTodo(e, otra.f, otra.ids);
    await confirmar(e, otra.f);
    expect(await pendientes(e)).not.toContain(otra.f.idExpediente);
    await verificar(e, otra.f.idExpediente);
    expect(await estadoDe(db(), otra.f.idExpediente)).toBe("en_validacion");
    expect(await pendientes(e)).not.toContain(otra.f.idExpediente);
  });

  it("HU0017-2.0 (autorización) las rutas internas de completitud exigen el token de servicio; la familia no las alcanza", async () => {
    const e = await entorno();
    const { f } = await familiaLista(e);
    for (const r of [
      request(e.app).post(`/internal/expedientes/${f.idExpediente}/verificacion-completitud`),
      request(e.app).get("/internal/completitud/pendientes"),
      request(e.app).post(`/internal/expedientes/${f.idExpediente}/verificacion-completitud`).set("Authorization", `Bearer ${f.token}`),
    ]) {
      expect([401, 403]).toContain((await r).status);
    }
    expect((await verificar(e, 2147483647)).status).toBe(404);
  });
});

describe("HU0022-1.0 la configuración de G09 rige la completitud (C25)", () => {
  it("HU0022-1.0 [parte: completitud] un requisito creado por la ruta de G09 con condición de colegio peruano se exige solo a quien lo declaró en la ficha", async () => {
    const e = await entorno();
    const { f: peruano, ids } = await familiaLista(e);
    const extranjero = await familiaConFicha(db(), e, async () => undefined, peruano.idGrado, {
      postulante: { ...fichaCompleta().postulante, dni: dniNuevo(), estudio_en_colegio_peruano: false, colegio_procedencia: null },
    });
    const alta = await request(e.app)
      .post(`/configuracion/grados/${peruano.idGrado}/requisitos`)
      .set("Authorization", `Bearer ${e.tokenSecretaria}`)
      .send({ tipo_documento: "Constancia de matrícula", categoria: "colegio_procedencia", condicion_aplicacion: "solo_colegio_peruano" });
    expect(alta.status).toBe(201);
    await cargarTodo(e, peruano, ids);
    for (const id of [ids.partida, ids.dni]) await cargar(e, extranjero, id);
    await cargar(e, extranjero, ids.boletas, extranjero.idApoderado);
    await registrarDerecho(e, extranjero);
    await confirmar(e, peruano);
    await confirmar(e, extranjero);

    const rPeruano = await verificar(e, peruano.idExpediente);
    const rExtranjero = await verificar(e, extranjero.idExpediente);

    expect(rPeruano.status).toBe(201);
    expect((await eventosTipo(peruano.idExpediente, "completitud_verificada"))[0]!.detalle.faltantes).toEqual([
      { id_requisito: alta.body.id_requisito, id_apoderado: null },
    ]);
    expect(rPeruano.body.cuerpo).toContain("- Constancia de matrícula\n");
    expect(rExtranjero.status).toBe(200);
    expect(await estadoDe(db(), extranjero.idExpediente)).toBe("en_validacion");
  });
});
