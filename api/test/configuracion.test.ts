// HU0022-1.0 y 2.0: configuración de la campaña por HTTP (/configuracion, pantalla G09) contra admision_test.
// El archivo usa su propia campaña (crearApp({ campanaActiva })) para no chocar con los grados de otras pruebas.
// Cada prueba declara la parte del escenario que verifica ([parte: …]). La aplicación de la configuración en la
// completitud, el agendamiento y la adjudicación, y la 2.0 con una adjudicación real, se verifican en HU0017,
// HU0009 y HU0012 (compromiso C25). Las vacantes adjudicadas de la 2.0 son las de un grado de prueba
// (autorizadas − disponibles, R14): no se crean expedientes ni adjudicaciones.
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearApp } from "../src/app";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearExpediente, crearFirmante, crearGrado, crearHorario, crearPersonal, unico } from "./ayudantes";
import { crearIdentidadFalsa } from "./identidadFalsa";

const db = () => obtenerPool();
const CAMPANA = `C${unico()}`; // 9 caracteres: cabe en grado.campana_admision (varchar(10))

let firmante: Awaited<ReturnType<typeof crearFirmante>>;
let app: Express;
let tokenSecretaria: string;
let idSecretaria: number;

beforeAll(async () => {
  firmante = await crearFirmante();
  app = crearApp({ opcionesToken: firmante.opcionesToken, identidad: crearIdentidadFalsa().identidad, campanaActiva: CAMPANA });
  const sub = randomUUID();
  idSecretaria = await crearPersonal(db(), "secretaria", sub);
  tokenSecretaria = await firmante.token(sub, ["secretaria"]);
});

afterAll(cerrarPool);

const conToken = (r: request.Test, token = tokenSecretaria) => r.set("Authorization", `Bearer ${token}`);
const get = (ruta: string, token?: string) => conToken(request(app).get(ruta), token);
const patch = (ruta: string, cuerpo: unknown, token?: string) => conToken(request(app).patch(ruta), token).send(cuerpo as object);
const post = (ruta: string, cuerpo: unknown) => conToken(request(app).post(ruta)).send(cuerpo as object);
const quitar = (ruta: string) => conToken(request(app).delete(ruta));

const gradoDeCampana = (valores: { autorizadas?: number; disponibles?: number; nombre?: string } = {}) =>
  crearGrado(db(), { campana: CAMPANA, ...valores });

async function filaGrado(idGrado: number) {
  const { rows } = await db().query(
    `SELECT vacantes_autorizadas, vacantes_disponibles, requiere_jornada_observacion, requiere_evaluacion_psicologica,
            requiere_evaluacion_academica, monto_cuota_ingreso::text AS monto_cuota_ingreso, max_fracciones
       FROM grado WHERE id_grado = $1`,
    [idGrado],
  );
  return rows[0];
}

// Eventos cambio_configuracion de una entidad (p. ej. «grado» con id_grado = 5).
async function cambiosDe(entidad: string, campoId: string, id: number) {
  const { rows } = await db().query(
    `SELECT id_personal, id_expediente, estado_anterior, estado_nuevo, detalle FROM registro_auditoria
      WHERE tipo_evento = 'cambio_configuracion' AND detalle->>'entidad' = $1 AND (detalle->>$2)::int = $3
      ORDER BY id_evento`,
    [entidad, campoId, id],
  );
  return rows;
}

const evento = (detalle: Record<string, unknown>) => ({
  id_personal: idSecretaria,
  id_expediente: null,
  estado_anterior: null,
  estado_nuevo: null,
  detalle: { campana: CAMPANA, ...detalle },
});

const GRADO_INICIAL = {
  vacantes_autorizadas: 30,
  vacantes_disponibles: 3,
  requiere_jornada_observacion: false,
  requiere_evaluacion_psicologica: false,
  requiere_evaluacion_academica: false,
  monto_cuota_ingreso: "7000.00",
  max_fracciones: 1,
};

// ====================================================================== grados

describe("HU0022-1.0 grados, vacantes, evaluaciones, cuota y máximo de fracciones", () => {
  it("HU0022-1.0 [parte: almacenamiento] GET /configuracion lista solo los grados de la campaña activa, con sus vacantes adjudicadas y el derecho de admisión de R16", async () => {
    const id = await gradoDeCampana({ autorizadas: 30, disponibles: 3 });
    const deOtraCampana = await crearGrado(db(), { campana: "T" });

    const res = await get("/configuracion");

    expect(res.status).toBe(200);
    expect(res.body.campana).toBe(CAMPANA);
    expect(res.body.derecho_admision).toBe(300);
    expect(res.body.grados.find((g: { id_grado: number }) => g.id_grado === id)).toEqual({
      id_grado: id,
      nivel: "primaria",
      nombre_grado: expect.any(String),
      vacantes_autorizadas: 30,
      vacantes_adjudicadas: 27,
      requiere_jornada_observacion: false,
      requiere_evaluacion_psicologica: false,
      requiere_evaluacion_academica: false,
      monto_cuota_ingreso: "7000.00",
      max_fracciones: 1,
    });
    expect(res.body.grados.map((g: { id_grado: number }) => g.id_grado)).not.toContain(deOtraCampana);
  });

  it("HU0022-1.0 [parte: almacenamiento] guarda vacantes, evaluaciones, cuota y máximo de fracciones de un grado: ajusta las disponibles sin cambiar las adjudicadas y registra cambio_configuracion con el valor anterior y el nuevo", async () => {
    const id = await gradoDeCampana({ autorizadas: 30, disponibles: 3 });

    const res = await patch("/configuracion/grados", {
      grados: [
        {
          id_grado: id,
          vacantes_autorizadas: 32,
          requiere_evaluacion_psicologica: true,
          requiere_evaluacion_academica: true,
          monto_cuota_ingreso: 6500.5,
          max_fracciones: 3,
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id_grado: id,
        vacantes_autorizadas: 32,
        vacantes_adjudicadas: 27,
        requiere_jornada_observacion: false,
        requiere_evaluacion_psicologica: true,
        requiere_evaluacion_academica: true,
        monto_cuota_ingreso: "6500.50",
        max_fracciones: 3,
      }),
    ]);
    expect(await filaGrado(id)).toEqual({
      ...GRADO_INICIAL,
      vacantes_autorizadas: 32,
      vacantes_disponibles: 5,
      requiere_evaluacion_psicologica: true,
      requiere_evaluacion_academica: true,
      monto_cuota_ingreso: "6500.50",
      max_fracciones: 3,
    });
    expect(await cambiosDe("grado", "id_grado", id)).toEqual([
      evento({
        entidad: "grado",
        id_grado: id,
        accion: "modificacion",
        cambios: {
          vacantes_autorizadas: { anterior: 30, nuevo: 32 },
          vacantes_disponibles: { anterior: 3, nuevo: 5 },
          requiere_evaluacion_psicologica: { anterior: false, nuevo: true },
          requiere_evaluacion_academica: { anterior: false, nuevo: true },
          monto_cuota_ingreso: { anterior: "7000.00", nuevo: "6500.50" },
          max_fracciones: { anterior: 1, nuevo: 3 },
        },
      }),
    ]);
  });

  it("HU0022-1.0 [parte: almacenamiento] acepta una cuota de ingreso de 0 (plan HU0022, P10: colegios sin cuota)", async () => {
    const id = await gradoDeCampana();

    const res = await patch("/configuracion/grados", { grados: [{ id_grado: id, monto_cuota_ingreso: 0 }] });

    expect(res.status).toBe(200);
    expect((await filaGrado(id)).monto_cuota_ingreso).toBe("0.00");
  });

  it("HU0022-1.0 [parte: almacenamiento] un guardado sin cambios responde 200 y no registra eventos", async () => {
    const id = await gradoDeCampana({ autorizadas: 30, disponibles: 3 });

    const res = await patch("/configuracion/grados", {
      grados: [{ id_grado: id, vacantes_autorizadas: 30, requiere_evaluacion_academica: false, monto_cuota_ingreso: 7000, max_fracciones: 1 }],
    });

    expect(res.status).toBe(200);
    expect(await filaGrado(id)).toEqual(GRADO_INICIAL);
    expect(await cambiosDe("grado", "id_grado", id)).toEqual([]);
  });

  it("HU0022-1.0 [parte: almacenamiento] varios grados se guardan juntos, con un evento por grado que cambió; si uno no es de la campaña activa (404), no se guarda ninguno", async () => {
    const a = await gradoDeCampana();
    const b = await gradoDeCampana();
    const deOtraCampana = await crearGrado(db(), { campana: "T" });

    const lote = await patch("/configuracion/grados", {
      grados: [
        { id_grado: a, max_fracciones: 2 },
        { id_grado: b, requiere_jornada_observacion: true },
      ],
    });
    expect(lote.status).toBe(200);
    expect(await cambiosDe("grado", "id_grado", a)).toHaveLength(1);
    expect(await cambiosDe("grado", "id_grado", b)).toHaveLength(1);

    const conAjeno = await patch("/configuracion/grados", {
      grados: [
        { id_grado: a, max_fracciones: 4 },
        { id_grado: deOtraCampana, max_fracciones: 4 },
      ],
    });
    expect(conAjeno.status).toBe(404);
    expect(conAjeno.body.error.codigo).toBe("NO_ENCONTRADO");
    expect((await filaGrado(a)).max_fracciones).toBe(2);
    expect((await filaGrado(deOtraCampana)).max_fracciones).toBe(1);
    expect(await cambiosDe("grado", "id_grado", a)).toHaveLength(1);
  });

  describe("HU0022-1.0 validación técnica de los datos del grado", () => {
    let id: number;
    beforeAll(async () => {
      id = await gradoDeCampana({ autorizadas: 30, disponibles: 3 });
    });

    it.each<[string, (id: number) => unknown]>([
      ["lista vacía", () => ({ grados: [] })],
      ["vacantes negativas", (id) => ({ grados: [{ id_grado: id, vacantes_autorizadas: -1 }] })],
      ["vacantes no enteras", (id) => ({ grados: [{ id_grado: id, vacantes_autorizadas: 31.5 }] })],
      ["máximo de fracciones 0", (id) => ({ grados: [{ id_grado: id, max_fracciones: 0 }] })],
      ["cuota negativa", (id) => ({ grados: [{ id_grado: id, monto_cuota_ingreso: -1 }] })],
      ["cuota con 3 decimales", (id) => ({ grados: [{ id_grado: id, monto_cuota_ingreso: 1.234 }] })],
      ["cuota fuera de numeric(10,2)", (id) => ({ grados: [{ id_grado: id, monto_cuota_ingreso: 100000000 }] })],
      ["evaluación que no es booleana", (id) => ({ grados: [{ id_grado: id, requiere_evaluacion_academica: "si" }] })],
      ["vacantes disponibles (no se configuran)", (id) => ({ grados: [{ id_grado: id, vacantes_disponibles: 5 }] })],
      ["grado repetido", (id) => ({ grados: [{ id_grado: id }, { id_grado: id }] })],
    ])("HU0022-1.0 [parte: almacenamiento] rechaza con 400 un guardado con %s y no cambia el grado", async (_caso, cuerpo) => {
      const res = await patch("/configuracion/grados", cuerpo(id));

      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
      expect(await filaGrado(id)).toEqual(GRADO_INICIAL);
    });
  });
});

// ====================================================================== HU0022-2.0

describe("HU0022-2.0 intento de fijar menos vacantes que las ya adjudicadas", () => {
  it("HU0022-2.0 [parte: regla] rechaza fijar menos vacantes que las adjudicadas: 422 con el mínimo permitido, sin cambios ni auditoría", async () => {
    const id = await gradoDeCampana({ autorizadas: 30, disponibles: 3, nombre: "2.° de primaria" });

    const res = await patch("/configuracion/grados", { grados: [{ id_grado: id, vacantes_autorizadas: 25 }] });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: {
        codigo: "VACANTES_MENORES_QUE_ADJUDICADAS",
        mensaje: "No se puede fijar para 2.° de primaria un número de vacantes menor al de vacantes ya adjudicadas (27).",
        detalle: [{ id_grado: id, minimo: 27 }],
      },
    });
    expect(await filaGrado(id)).toEqual(GRADO_INICIAL);
    expect(await cambiosDe("grado", "id_grado", id)).toEqual([]);
  });

  it("HU0022-2.0 [parte: regla] acepta exactamente el mínimo: las vacantes disponibles quedan en 0", async () => {
    const id = await gradoDeCampana({ autorizadas: 30, disponibles: 3 });

    const res = await patch("/configuracion/grados", { grados: [{ id_grado: id, vacantes_autorizadas: 27 }] });

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ vacantes_autorizadas: 27, vacantes_adjudicadas: 27 });
    expect(await filaGrado(id)).toMatchObject({ vacantes_autorizadas: 27, vacantes_disponibles: 0 });
  });

  it("HU0022-2.0 [parte: regla] en un guardado de varios grados, uno por debajo del mínimo rechaza todo el lote y el mensaje nombra el primero", async () => {
    const valido = await gradoDeCampana({ autorizadas: 30, disponibles: 3 });
    const primero = await gradoDeCampana({ autorizadas: 20, disponibles: 5, nombre: `Primero ${unico()}` });
    const segundo = await gradoDeCampana({ autorizadas: 10, disponibles: 0 });

    const res = await patch("/configuracion/grados", {
      grados: [
        { id_grado: valido, vacantes_autorizadas: 35 },
        { id_grado: primero, vacantes_autorizadas: 14 },
        { id_grado: segundo, vacantes_autorizadas: 9 },
      ],
    });

    expect(res.status).toBe(422);
    expect(res.body.error.mensaje).toMatch(/^No se puede fijar para Primero .+ \(15\)\.$/);
    expect(res.body.error.detalle).toEqual([
      { id_grado: primero, minimo: 15 },
      { id_grado: segundo, minimo: 10 },
    ]);
    expect(await filaGrado(valido)).toEqual(GRADO_INICIAL);
    expect(await cambiosDe("grado", "id_grado", valido)).toEqual([]);
  });
});

// ====================================================================== requisitos documentales

describe("HU0022-1.0 requisitos documentales con su condición de aplicación", () => {
  const requisitosDe = (idGrado: number) => `/configuracion/grados/${idGrado}/requisitos`;

  async function documentoPara(idRequisito: number) {
    const { idExpediente } = await crearExpediente(db());
    await db().query(
      `INSERT INTO documento (id_expediente, id_requisito, url_archivo, formato, tamano_kb)
       VALUES ($1, $2, 'local://ficticio.pdf', 'pdf', 10)`,
      [idExpediente, idRequisito],
    );
  }

  it("HU0022-1.0 [parte: almacenamiento] registra un requisito con su condición de aplicación, con los valores por defecto del DBML, y audita el alta", async () => {
    const idGrado = await gradoDeCampana();

    const res = await post(requisitosDe(idGrado), {
      tipo_documento: "  Boletas de pago (últimos 3 meses) ",
      categoria: "financiero",
      condicion_aplicacion: "si_dependiente",
      por_apoderado: true,
    });
    const minimo = await post(requisitosDe(idGrado), { tipo_documento: "Partida de nacimiento", categoria: "postulante_y_padres" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id_requisito: expect.any(Number),
      id_grado: idGrado,
      tipo_documento: "Boletas de pago (últimos 3 meses)",
      categoria: "financiero",
      condicion_aplicacion: "si_dependiente",
      obligatorio: true,
      por_apoderado: true,
    });
    expect(minimo.status).toBe(201);
    expect(minimo.body).toMatchObject({ condicion_aplicacion: "todos", obligatorio: true, por_apoderado: false });

    const lista = await get(requisitosDe(idGrado));
    expect(lista.status).toBe(200);
    expect(lista.body.map((r: { tipo_documento: string }) => r.tipo_documento)).toEqual(["Boletas de pago (últimos 3 meses)", "Partida de nacimiento"]);

    expect(await cambiosDe("requisito_documental", "id_requisito", res.body.id_requisito)).toEqual([
      evento({
        entidad: "requisito_documental",
        id_requisito: res.body.id_requisito,
        id_grado: idGrado,
        accion: "alta",
        cambios: {
          tipo_documento: { anterior: null, nuevo: "Boletas de pago (últimos 3 meses)" },
          categoria: { anterior: null, nuevo: "financiero" },
          condicion_aplicacion: { anterior: null, nuevo: "si_dependiente" },
          obligatorio: { anterior: null, nuevo: true },
          por_apoderado: { anterior: null, nuevo: true },
        },
      }),
    ]);
  });

  it("HU0022-1.0 [parte: almacenamiento] «si es dependiente» o «si es independiente» sin por_apoderado responde 400, como el CHECK, al registrar y al editar", async () => {
    const idGrado = await gradoDeCampana();

    const alta = await post(requisitosDe(idGrado), {
      tipo_documento: "Recibos por honorarios y DJ anual",
      categoria: "financiero",
      condicion_aplicacion: "si_independiente",
      por_apoderado: false,
    });
    expect(alta.status).toBe(400);
    expect((await get(requisitosDe(idGrado))).body).toEqual([]);

    const creado = await post(requisitosDe(idGrado), { tipo_documento: "Boletas de pago", categoria: "financiero" });
    const cambio = await patch(`/configuracion/requisitos/${creado.body.id_requisito}`, { condicion_aplicacion: "si_dependiente" });
    expect(cambio.status).toBe(400);
    expect((await get(requisitosDe(idGrado))).body[0]).toMatchObject({ condicion_aplicacion: "todos", por_apoderado: false });
  });

  it("HU0022-1.0 [parte: almacenamiento] un nombre ya registrado en el grado responde 409 REQUISITO_DUPLICADO, también si solo cambian las mayúsculas (P14); en otro grado sí se acepta", async () => {
    const idGrado = await gradoDeCampana();
    const otroGrado = await gradoDeCampana();
    expect((await post(requisitosDe(idGrado), { tipo_documento: "Partida de nacimiento", categoria: "postulante_y_padres" })).status).toBe(201);

    for (const nombre of ["Partida de nacimiento", "PARTIDA DE NACIMIENTO", " partida de nacimiento "]) {
      const res = await post(requisitosDe(idGrado), { tipo_documento: nombre, categoria: "postulante_y_padres" });
      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe("REQUISITO_DUPLICADO");
    }
    expect((await get(requisitosDe(idGrado))).body).toHaveLength(1);
    expect((await post(requisitosDe(otroGrado), { tipo_documento: "Partida de nacimiento", categoria: "postulante_y_padres" })).status).toBe(201);
  });

  it("HU0022-1.0 [parte: almacenamiento] edita un requisito sin cambiar su grado y audita solo los campos que cambiaron (P4)", async () => {
    const idGrado = await gradoDeCampana();
    const otroGrado = await gradoDeCampana();
    const libreta = await post(requisitosDe(idGrado), { tipo_documento: "Libreta de notas", categoria: "postulante_y_padres" });
    await post(requisitosDe(idGrado), { tipo_documento: "DNI del postulante", categoria: "postulante_y_padres" });
    const idRequisito = libreta.body.id_requisito as number;
    const ruta = `/configuracion/requisitos/${idRequisito}`;

    const res = await patch(ruta, { categoria: "colegio_procedencia", condicion_aplicacion: "solo_colegio_peruano", obligatorio: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id_requisito: idRequisito,
      id_grado: idGrado,
      tipo_documento: "Libreta de notas",
      categoria: "colegio_procedencia",
      condicion_aplicacion: "solo_colegio_peruano",
      obligatorio: false,
      por_apoderado: false,
    });

    expect((await patch(ruta, { id_grado: otroGrado })).status).toBe(400);
    expect((await patch(ruta, {})).status).toBe(400);
    const duplicado = await patch(ruta, { tipo_documento: "dni DEL postulante" });
    expect(duplicado.status).toBe(409);
    expect(duplicado.body.error.codigo).toBe("REQUISITO_DUPLICADO");
    expect((await patch(ruta, { obligatorio: false })).status).toBe(200); // sin cambios: no se audita

    expect(await cambiosDe("requisito_documental", "id_requisito", idRequisito)).toEqual([
      expect.objectContaining({ detalle: expect.objectContaining({ accion: "alta" }) }),
      evento({
        entidad: "requisito_documental",
        id_requisito: idRequisito,
        id_grado: idGrado,
        accion: "modificacion",
        cambios: {
          categoria: { anterior: "postulante_y_padres", nuevo: "colegio_procedencia" },
          condicion_aplicacion: { anterior: "todos", nuevo: "solo_colegio_peruano" },
          obligatorio: { anterior: true, nuevo: false },
        },
      }),
    ]);
  });

  it("HU0022-1.0 [parte: almacenamiento] quita un requisito sin documentos (204 y baja auditada) y responde 409 EN_USO si ya hay documentos cargados (P4)", async () => {
    const idGrado = await gradoDeCampana();
    const libre = await post(requisitosDe(idGrado), { tipo_documento: "Constancia de no adeudo", categoria: "colegio_procedencia" });
    const usado = await post(requisitosDe(idGrado), { tipo_documento: "Partida de nacimiento", categoria: "postulante_y_padres" });
    await documentoPara(usado.body.id_requisito);

    const res = await quitar(`/configuracion/requisitos/${libre.body.id_requisito}`);
    expect(res.status).toBe(204);
    expect(await cambiosDe("requisito_documental", "id_requisito", libre.body.id_requisito)).toEqual([
      expect.objectContaining({ detalle: expect.objectContaining({ accion: "alta" }) }),
      evento({
        entidad: "requisito_documental",
        id_requisito: libre.body.id_requisito,
        id_grado: idGrado,
        accion: "baja",
        cambios: {
          tipo_documento: { anterior: "Constancia de no adeudo", nuevo: null },
          categoria: { anterior: "colegio_procedencia", nuevo: null },
          condicion_aplicacion: { anterior: "todos", nuevo: null },
          obligatorio: { anterior: true, nuevo: null },
          por_apoderado: { anterior: false, nuevo: null },
        },
      }),
    ]);

    const enUso = await quitar(`/configuracion/requisitos/${usado.body.id_requisito}`);
    expect(enUso.status).toBe(409);
    expect(enUso.body.error.codigo).toBe("EN_USO");
    expect((await get(requisitosDe(idGrado))).body.map((r: { id_requisito: number }) => r.id_requisito)).toEqual([usado.body.id_requisito]);
    expect(await cambiosDe("requisito_documental", "id_requisito", usado.body.id_requisito)).toHaveLength(1);
  });

  it("HU0022-1.0 [parte: almacenamiento] los requisitos de un grado de otra campaña o inexistente responden 404", async () => {
    const deOtraCampana = await crearGrado(db(), { campana: "T" });
    const { rows } = await db().query<{ id_requisito: number }>(
      `INSERT INTO requisito_documental (id_grado, tipo_documento, categoria) VALUES ($1, 'Partida de nacimiento', 'postulante_y_padres')
       RETURNING id_requisito`,
      [deOtraCampana],
    );
    const ajeno = rows[0]!.id_requisito;

    expect((await get(requisitosDe(deOtraCampana))).status).toBe(404);
    expect((await post(requisitosDe(deOtraCampana), { tipo_documento: "DNI del postulante", categoria: "postulante_y_padres" })).status).toBe(404);
    expect((await patch(`/configuracion/requisitos/${ajeno}`, { obligatorio: false })).status).toBe(404);
    expect((await quitar(`/configuracion/requisitos/${ajeno}`)).status).toBe(404);
    expect((await get(requisitosDe(2147483000))).status).toBe(404);
    expect(await cambiosDe("requisito_documental", "id_requisito", ajeno)).toEqual([]);
  });
});

// ====================================================================== horarios

describe("HU0022-1.0 horarios disponibles", () => {
  const horario = (idPersonal: number, valores: Record<string, unknown> = {}) => ({
    id_personal: idPersonal,
    tipo_cita: "visita",
    fecha: "2031-01-10",
    hora_inicio: "09:00",
    hora_fin: "10:00",
    cupos: 1,
    ...valores,
  });

  it.each([
    ["visita", "directora"],
    ["jornada_observacion", "psicologa"],
    ["evaluacion_psicologica", "psicologa"],
    ["entrevista_padres", "psicologa"],
    ["evaluacion_academica", "evaluador_academico"],
  ])("HU0022-1.0 [parte: almacenamiento] registra un horario de %s con un responsable de rol %s y lo audita solo con ids", async (tipo, rol) => {
    const idPersonal = await crearPersonal(db(), rol);

    const res = await post("/configuracion/horarios", horario(idPersonal, { tipo_cita: tipo, cupos: 2 }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id_horario: expect.any(Number),
      id_personal: idPersonal,
      responsable: "Personal Ficticio",
      tipo_cita: tipo,
      fecha: "2031-01-10",
      hora_inicio: "09:00",
      hora_fin: "10:00",
      cupos: 2,
    });
    const eventos = await cambiosDe("horario_disponible", "id_horario", res.body.id_horario);
    expect(eventos).toEqual([
      evento({
        entidad: "horario_disponible",
        id_horario: res.body.id_horario,
        accion: "alta",
        cambios: {
          id_personal: { anterior: null, nuevo: idPersonal },
          tipo_cita: { anterior: null, nuevo: tipo },
          fecha: { anterior: null, nuevo: "2031-01-10" },
          hora_inicio: { anterior: null, nuevo: "09:00" },
          hora_fin: { anterior: null, nuevo: "10:00" },
          cupos: { anterior: null, nuevo: 2 },
        },
      }),
    ]);
    // Sin datos personales en la bitácora: ni el nombre del responsable ni correos.
    expect(JSON.stringify(eventos)).not.toMatch(/Ficticio|@/);
  });

  it("HU0022-1.0 [parte: almacenamiento] rechaza con 422 un responsable de otro rol, desactivado o inexistente (P2), sin guardar el horario", async () => {
    const psicologa = await crearPersonal(db(), "psicologa");
    const secretaria = await crearPersonal(db(), "secretaria");
    const directoraInactiva = await crearPersonal(db(), "directora");
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [directoraInactiva]);

    for (const cuerpo of [
      horario(psicologa, { tipo_cita: "visita" }),
      horario(psicologa, { tipo_cita: "evaluacion_academica" }),
      horario(secretaria, { tipo_cita: "evaluacion_psicologica" }),
      horario(directoraInactiva, { tipo_cita: "visita" }),
      horario(2147483000, { tipo_cita: "visita" }),
    ]) {
      const res = await post("/configuracion/horarios", cuerpo);
      expect(res.status).toBe(422);
      expect(res.body.error.codigo).toBe("RESPONSABLE_NO_VALIDO");
    }
    const { rowCount } = await db().query("SELECT 1 FROM horario_disponible WHERE id_personal = ANY($1::int[])", [
      [psicologa, secretaria, directoraInactiva],
    ]);
    expect(rowCount).toBe(0);
  });

  it("HU0022-1.0 [parte: almacenamiento] rechaza con 409 HORARIO_SUPERPUESTO un horario que se cruza con otro del mismo responsable, también de otra campaña (P1); acepta uno contiguo y el mismo horario de otra persona", async () => {
    const psicologa = await crearPersonal(db(), "psicologa");
    const otraPsicologa = await crearPersonal(db(), "psicologa");
    const base = { tipo_cita: "evaluacion_psicologica", fecha: "2031-02-03" };
    expect((await post("/configuracion/horarios", horario(psicologa, base))).status).toBe(201);
    await crearHorario(db(), psicologa, { campana: "T", fecha: "2031-02-03", inicio: "14:00", fin: "15:00", tipo: "evaluacion_psicologica" });

    for (const [inicio, fin, tipo] of [
      ["09:30", "10:30", "evaluacion_psicologica"], // se cruza al final
      ["08:30", "09:15", "evaluacion_psicologica"], // se cruza al inicio
      ["09:15", "09:45", "evaluacion_psicologica"], // queda dentro
      ["08:00", "11:00", "evaluacion_psicologica"], // lo envuelve
      ["09:30", "10:30", "entrevista_padres"], // otro tipo de cita, mismo responsable
      ["14:30", "15:30", "evaluacion_psicologica"], // se cruza con un horario de otra campaña
    ]) {
      const res = await post("/configuracion/horarios", horario(psicologa, { ...base, tipo_cita: tipo, hora_inicio: inicio, hora_fin: fin }));
      expect(res.status, `${inicio}-${fin}`).toBe(409);
      expect(res.body.error.codigo).toBe("HORARIO_SUPERPUESTO");
    }

    expect((await post("/configuracion/horarios", horario(psicologa, { ...base, hora_inicio: "10:00", hora_fin: "11:00" }))).status).toBe(201);
    expect((await post("/configuracion/horarios", horario(psicologa, { ...base, fecha: "2031-02-04", hora_inicio: "09:30", hora_fin: "10:30" }))).status).toBe(201);
    expect((await post("/configuracion/horarios", horario(otraPsicologa, { ...base, hora_inicio: "09:30", hora_fin: "10:30" }))).status).toBe(201);

    const { rows } = await db().query(
      `SELECT count(*)::int AS n FROM registro_auditoria
        WHERE tipo_evento = 'cambio_configuracion' AND detalle->>'entidad' = 'horario_disponible'
          AND (detalle->'cambios'->'id_personal'->>'nuevo')::int = $1`,
      [psicologa],
    );
    expect(rows[0].n).toBe(3); // solo las altas aceptadas
  });

  it("HU0022-1.0 [parte: almacenamiento] quita un horario sin citas (204 y baja auditada) y responde 409 EN_USO si ya tiene citas (P4)", async () => {
    const directora = await crearPersonal(db(), "directora");
    const libre = await post("/configuracion/horarios", horario(directora, { fecha: "2031-03-01" }));
    const usado = await post("/configuracion/horarios", horario(directora, { fecha: "2031-03-02" }));
    const { idExpediente } = await crearExpediente(db());
    await db().query(
      `INSERT INTO cita (id_expediente, id_personal, id_horario, tipo_cita, fecha_hora)
       VALUES ($1, $2, $3, 'visita', '2031-03-02T09:00:00-05:00')`,
      [idExpediente, directora, usado.body.id_horario],
    );

    const res = await quitar(`/configuracion/horarios/${libre.body.id_horario}`);
    expect(res.status).toBe(204);
    expect(await cambiosDe("horario_disponible", "id_horario", libre.body.id_horario)).toEqual([
      expect.objectContaining({ detalle: expect.objectContaining({ accion: "alta" }) }),
      evento({
        entidad: "horario_disponible",
        id_horario: libre.body.id_horario,
        accion: "baja",
        cambios: {
          id_personal: { anterior: directora, nuevo: null },
          tipo_cita: { anterior: "visita", nuevo: null },
          fecha: { anterior: "2031-03-01", nuevo: null },
          hora_inicio: { anterior: "09:00", nuevo: null },
          hora_fin: { anterior: "10:00", nuevo: null },
          cupos: { anterior: 1, nuevo: null },
        },
      }),
    ]);

    const enUso = await quitar(`/configuracion/horarios/${usado.body.id_horario}`);
    expect(enUso.status).toBe(409);
    expect(enUso.body.error.codigo).toBe("EN_USO");
    const { rowCount } = await db().query("SELECT 1 FROM horario_disponible WHERE id_horario = $1", [usado.body.id_horario]);
    expect(rowCount).toBe(1);

    const deOtraCampana = await crearHorario(db(), directora, { campana: "T", fecha: "2031-03-03" });
    expect((await quitar(`/configuracion/horarios/${deOtraCampana}`)).status).toBe(404);
  });

  it("HU0022-1.0 [parte: almacenamiento] lista los horarios de la campaña activa (con filtro por tipo) y solo ofrece como responsables las cuentas activas de directora, psicóloga y evaluador académico", async () => {
    const directora = await crearPersonal(db(), "directora");
    const evaluador = await crearPersonal(db(), "evaluador_academico");
    const psicologaInactiva = await crearPersonal(db(), "psicologa");
    const secretaria = await crearPersonal(db(), "secretaria");
    const tesoreria = await crearPersonal(db(), "tesoreria");
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [psicologaInactiva]);
    const visita = await post("/configuracion/horarios", horario(directora, { fecha: "2031-04-01" }));
    const academica = await post("/configuracion/horarios", horario(evaluador, { tipo_cita: "evaluacion_academica", fecha: "2031-04-01" }));
    const deOtraCampana = await crearHorario(db(), directora, { campana: "T", fecha: "2031-04-02" });

    const todos = await get("/configuracion/horarios");
    expect(todos.status).toBe(200);
    const ids = todos.body.map((h: { id_horario: number }) => h.id_horario);
    expect(ids).toEqual(expect.arrayContaining([visita.body.id_horario, academica.body.id_horario]));
    expect(ids).not.toContain(deOtraCampana);

    const soloVisitas = await get("/configuracion/horarios?tipo_cita=visita");
    expect(soloVisitas.body.every((h: { tipo_cita: string }) => h.tipo_cita === "visita")).toBe(true);
    expect(soloVisitas.body.map((h: { id_horario: number }) => h.id_horario)).toContain(visita.body.id_horario);
    expect((await get("/configuracion/horarios?tipo_cita=otra")).status).toBe(400);

    const resp = await get("/configuracion/responsables");
    expect(resp.status).toBe(200);
    const responsables = resp.body.map((r: { id_personal: number }) => r.id_personal);
    expect(responsables).toEqual(expect.arrayContaining([directora, evaluador]));
    for (const excluido of [psicologaInactiva, secretaria, tesoreria]) expect(responsables).not.toContain(excluido);
    expect(resp.body.find((r: { id_personal: number }) => r.id_personal === directora)).toEqual({
      id_personal: directora,
      nombre: "Personal Ficticio",
      rol: "directora",
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ["hora de fin igual a la de inicio", { hora_fin: "09:00" }],
    ["hora de fin anterior a la de inicio", { hora_inicio: "11:00", hora_fin: "10:00" }],
    ["hora sin dos dígitos", { hora_inicio: "9:00" }],
    ["fecha inexistente", { fecha: "2031-02-30" }],
    ["cupos negativos", { cupos: -1 }],
    ["tipo de cita desconocido", { tipo_cita: "otra" }],
    ["campaña en el cuerpo (la pone el servidor)", { campana_admision: "2099" }],
  ])("HU0022-1.0 [parte: almacenamiento] rechaza con 400 un horario con %s", async (_caso, valores) => {
    const directora = await crearPersonal(db(), "directora");

    const res = await post("/configuracion/horarios", horario(directora, { fecha: "2031-05-01", ...valores }));

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe("VALIDACION");
    const { rowCount } = await db().query("SELECT 1 FROM horario_disponible WHERE id_personal = $1", [directora]);
    expect(rowCount).toBe(0);
  });
});

// ====================================================================== soporte: permisos y campaña activa

describe("G09 permisos de la configuración (§4.6 y matriz de G10)", () => {
  it.each(["tesoreria", "psicologa", "evaluador_academico", "directora"])(
    "G09 solo secretaría ve y modifica la configuración: %s recibe 403 y queda acceso_denegado",
    async (rol) => {
      const sub = randomUUID();
      const idPersonal = await crearPersonal(db(), rol, sub);
      const token = await firmante.token(sub, [rol]);
      const id = await gradoDeCampana();

      expect((await get("/configuracion", token)).status).toBe(403);
      const cambio = await patch("/configuracion/grados", { grados: [{ id_grado: id, max_fracciones: 5 }] }, token);
      expect(cambio.status).toBe(403);
      expect(cambio.body.error.codigo).toBe("ACCESO_DENEGADO");

      expect((await filaGrado(id)).max_fracciones).toBe(1);
      const { rows } = await db().query(
        "SELECT detalle->>'ruta' AS ruta FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND id_personal = $1 ORDER BY id_evento",
        [idPersonal],
      );
      expect(rows.map((r) => r.ruta)).toEqual(["/configuracion/", "/configuracion/grados"]);
    },
  );
});

describe("C23 campaña activa para las pantallas de la gestión interna", () => {
  it.each(["secretaria", "tesoreria", "psicologa", "evaluador_academico", "directora"])(
    "C23 GET /campana-activa responde la campaña activa a %s",
    async (rol) => {
      // C22 (HU0002): las rutas del personal exigen una fila activa en personal con el rol del token.
      const sub = randomUUID();
      await crearPersonal(db(), rol, sub);
      const res = await get("/campana-activa", await firmante.token(sub, [rol]));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ campana: CAMPANA });
    },
  );

  it("C23 GET /campana-activa responde 403 a una familia y 401 sin token", async () => {
    expect((await get("/campana-activa", await firmante.token(randomUUID(), ["familia"]))).status).toBe(403);
    expect((await request(app).get("/campana-activa")).status).toBe(401);
  });
});
