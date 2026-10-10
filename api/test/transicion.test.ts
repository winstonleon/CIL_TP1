import { afterAll, describe, expect, it } from "vitest";
import { cerrarPool, enTransaccion, obtenerPool } from "../src/db/pool";
import { ErrorApi } from "../src/errores";
import {
  TRANSICIONES_PERMITIDAS,
  transicionarExpediente,
  type TransicionesPermitidas,
} from "../src/services/expedientes/transicionarExpediente";
import { crearExpediente, crearPersonal, eventosDe } from "./ayudantes";

afterAll(cerrarPool);

// Lista de prueba: el Sprint 0 no define transiciones de negocio (cada HU agrega las suyas).
const DE_PRUEBA: TransicionesPermitidas = {
  estado: [["prospecto", "visita_agendada"]],
  estado_documental: [["pendiente", "en_revision"]],
  estado_financiero: [["pendiente", "observado"]],
};

const estadoDe = async (id: number, campo = "estado") =>
  (await obtenerPool().query(`SELECT ${campo}::text AS v FROM expediente WHERE id_expediente = $1`, [id])).rows[0].v;

const errorDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("Se esperaba un error");
};

describe("S0-B5 transicionarExpediente", () => {
  it("S0-B5 la lista de transiciones permitidas por defecto está vacía", () => {
    expect(TRANSICIONES_PERMITIDAS).toEqual({ estado: [], estado_documental: [], estado_financiero: [] });
  });

  it("S0-B5 cambia el estado y registra transicion_estado con anterior y nuevo en la misma transacción", async () => {
    const pool = obtenerPool();
    const { idExpediente } = await crearExpediente(pool);
    const idPersonal = await crearPersonal(pool);

    await enTransaccion((c) =>
      transicionarExpediente(
        c,
        { idExpediente, campo: "estado", esperado: "prospecto", nuevo: "visita_agendada", idPersonal, detalle: { origen: "prueba" } },
        DE_PRUEBA,
      ),
    );

    expect(await estadoDe(idExpediente)).toBe("visita_agendada");
    const eventos = await eventosDe(pool, idExpediente);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo_evento: "transicion_estado",
      id_personal: idPersonal,
      estado_anterior: "prospecto",
      estado_nuevo: "visita_agendada",
      detalle: { campo: "estado", origen: "prueba" },
    });
  });

  it("S0-B5 cambia estado_documental y estado_financiero e indica el campo en detalle", async () => {
    const pool = obtenerPool();
    const { idExpediente } = await crearExpediente(pool);
    await enTransaccion(async (c) => {
      await transicionarExpediente(c, { idExpediente, campo: "estado_documental", esperado: "pendiente", nuevo: "en_revision", idPersonal: null }, DE_PRUEBA);
      await transicionarExpediente(c, { idExpediente, campo: "estado_financiero", esperado: "pendiente", nuevo: "observado", idPersonal: null }, DE_PRUEBA);
    });
    expect(await estadoDe(idExpediente, "estado_documental")).toBe("en_revision");
    expect(await estadoDe(idExpediente, "estado_financiero")).toBe("observado");
    expect(await estadoDe(idExpediente)).toBe("prospecto");
    const eventos = await eventosDe(pool, idExpediente);
    expect(eventos.map((e) => [e.detalle.campo, e.estado_anterior, e.estado_nuevo])).toEqual([
      ["estado_documental", "pendiente", "en_revision"],
      ["estado_financiero", "pendiente", "observado"],
    ]);
  });

  it("S0-B5 rechaza con 409 ESTADO_DESACTUALIZADO si el estado actual no es el esperado y no audita", async () => {
    const pool = obtenerPool();
    const { idExpediente } = await crearExpediente(pool);
    const e = await errorDe(
      enTransaccion((c) =>
        transicionarExpediente(c, { idExpediente, campo: "estado", esperado: "en_postulacion", nuevo: "visita_agendada", idPersonal: null }, DE_PRUEBA),
      ),
    );
    expect(e).toBeInstanceOf(ErrorApi);
    expect(e).toMatchObject({ status: 409, codigo: "ESTADO_DESACTUALIZADO" });
    expect(await estadoDe(idExpediente)).toBe("prospecto");
    expect(await eventosDe(pool, idExpediente)).toHaveLength(0);
  });

  it("S0-B5 rechaza con 409 TRANSICION_NO_PERMITIDA lo que no está en la lista (incluida la lista vacía por defecto)", async () => {
    const pool = obtenerPool();
    const { idExpediente } = await crearExpediente(pool);
    const conDefecto = await errorDe(
      enTransaccion((c) => transicionarExpediente(c, { idExpediente, campo: "estado", esperado: "prospecto", nuevo: "visita_agendada", idPersonal: null })),
    );
    expect(conDefecto).toMatchObject({ status: 409, codigo: "TRANSICION_NO_PERMITIDA" });
    const fueraDeLista = await errorDe(
      enTransaccion((c) =>
        transicionarExpediente(c, { idExpediente, campo: "estado", esperado: "prospecto", nuevo: "carta_emitida", idPersonal: null }, DE_PRUEBA),
      ),
    );
    expect(fueraDeLista).toMatchObject({ status: 409, codigo: "TRANSICION_NO_PERMITIDA" });
    expect(await estadoDe(idExpediente)).toBe("prospecto");
    expect(await eventosDe(pool, idExpediente)).toHaveLength(0);
  });

  it("S0-B5 rechaza con 400 ESTADO_INVALIDO un estado que no existe en el enum", async () => {
    const { idExpediente } = await crearExpediente(obtenerPool());
    const e = await errorDe(
      enTransaccion((c) => transicionarExpediente(c, { idExpediente, campo: "estado", esperado: "prospecto", nuevo: "inventado", idPersonal: null }, DE_PRUEBA)),
    );
    expect(e).toMatchObject({ status: 400, codigo: "ESTADO_INVALIDO" });
  });

  it("S0-B5 rechaza con 400 un campo de estado no reconocido", async () => {
    const { idExpediente } = await crearExpediente(obtenerPool());
    const e = await errorDe(
      enTransaccion((c) =>
        // @ts-expect-error campo fuera de la lista cerrada
        transicionarExpediente(c, { idExpediente, campo: "id_grado", esperado: "1", nuevo: "2", idPersonal: null }, DE_PRUEBA),
      ),
    );
    expect(e).toMatchObject({ status: 400, codigo: "CAMPO_ESTADO_INVALIDO" });
  });

  it("S0-B5 responde 404 si el expediente no existe", async () => {
    const e = await errorDe(
      enTransaccion((c) => transicionarExpediente(c, { idExpediente: 999999, campo: "estado", esperado: "prospecto", nuevo: "visita_agendada", idPersonal: null }, DE_PRUEBA)),
    );
    expect(e).toMatchObject({ status: 404, codigo: "EXPEDIENTE_NO_ENCONTRADO" });
  });

  it("S0-B5 si falla la escritura de la auditoría, el cambio de estado se revierte", async () => {
    const pool = obtenerPool();
    const { idExpediente } = await crearExpediente(pool);
    // id_personal inexistente: la FK de registro_auditoria hace fallar el INSERT después del UPDATE.
    const e = await errorDe(
      enTransaccion((c) =>
        transicionarExpediente(c, { idExpediente, campo: "estado", esperado: "prospecto", nuevo: "visita_agendada", idPersonal: 999999 }, DE_PRUEBA),
      ),
    );
    expect(e).toMatchObject({ code: "23503" });
    expect(await estadoDe(idExpediente)).toBe("prospecto");
    expect(await eventosDe(pool, idExpediente)).toHaveLength(0);
  });
});
