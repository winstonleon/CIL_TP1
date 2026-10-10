import { afterAll, describe, expect, it } from "vitest";
import { cerrarPool, enTransaccion, obtenerPool } from "../src/db/pool";
import { registrarAtencionFin, registrarAtencionInicio } from "../src/services/atencion";
import { transicionarExpediente, type TransicionesPermitidas } from "../src/services/expedientes/transicionarExpediente";
import { crearExpediente, crearPersonal, eventosDe } from "./ayudantes";

afterAll(cerrarPool);

const DE_PRUEBA: TransicionesPermitidas = {
  estado: [],
  estado_documental: [["pendiente", "conforme"]],
  estado_financiero: [],
};

describe("S0-B6 eventos atencion_inicio y atencion_fin", () => {
  it("S0-B6 registra atencion_inicio con el personal, el expediente y el ítem en detalle", async () => {
    const pool = obtenerPool();
    const { idExpediente } = await crearExpediente(pool);
    const idPersonal = await crearPersonal(pool);

    await registrarAtencionInicio(pool, { idPersonal, idExpediente, item: { tipo: "expediente", id: idExpediente } });

    const eventos = await eventosDe(pool, idExpediente);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo_evento: "atencion_inicio",
      id_personal: idPersonal,
      detalle: { item: { tipo: "expediente", id: idExpediente } },
    });
  });

  it("S0-B6 registra atencion_fin con la decisión en la misma transacción que la transición", async () => {
    const pool = obtenerPool();
    const { idExpediente } = await crearExpediente(pool);
    const idPersonal = await crearPersonal(pool);
    const item = { tipo: "expediente", id: idExpediente };

    await registrarAtencionInicio(pool, { idPersonal, idExpediente, item });
    await enTransaccion(async (c) => {
      await transicionarExpediente(c, { idExpediente, campo: "estado_documental", esperado: "pendiente", nuevo: "conforme", idPersonal }, DE_PRUEBA);
      await registrarAtencionFin(c, { idPersonal, idExpediente, item, decision: "conforme" });
    });

    const eventos = await eventosDe(pool, idExpediente);
    expect(eventos.map((e) => e.tipo_evento)).toEqual(["atencion_inicio", "transicion_estado", "atencion_fin"]);
    expect(eventos[2].detalle).toEqual({ item, decision: "conforme" });
  });

  it("S0-B6 si la decisión falla, atencion_fin y la transición no quedan registrados", async () => {
    const pool = obtenerPool();
    const { idExpediente } = await crearExpediente(pool);
    const idPersonal = await crearPersonal(pool);
    const item = { tipo: "expediente", id: idExpediente };

    await expect(
      enTransaccion(async (c) => {
        await transicionarExpediente(c, { idExpediente, campo: "estado_documental", esperado: "pendiente", nuevo: "conforme", idPersonal }, DE_PRUEBA);
        await registrarAtencionFin(c, { idPersonal, idExpediente, item, decision: "conforme" });
        throw new Error("falla posterior de la decisión");
      }),
    ).rejects.toThrow("falla posterior de la decisión");

    expect(await eventosDe(pool, idExpediente)).toHaveLength(0);
  });
});
