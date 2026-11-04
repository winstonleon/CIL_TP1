// Migraciones del bloque 3 (HU0006 y HU0007): R19 por banco (20261103120000) y el evento documentos_confirmados
// (20261103120100). Las dos rutas reales de HU0006 y HU0007 se prueban en documentos.test.ts y derechoAdmision.test.ts.
import { afterAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearExpediente, unico, violacion } from "./ayudantes";

const db = () => obtenerPool();
afterAll(cerrarPool);

const insertarPago = (idExpediente: number, banco: string, operacion: string) =>
  db().query(
    `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url)
     VALUES ($1, 'derecho_admision', 1, $2, $3, 300, '2027-01-10', 'clave-ficticia')`,
    [idExpediente, operacion, banco],
  );

describe("HU0007-2.0 R19: la BD impide el mismo número de operación en el mismo banco", () => {
  it("HU0007-2.0 la BD rechaza (banco, numero_operacion) repetido (uq_pago_banco_numero_operacion) y admite el mismo número en otro banco", async () => {
    const a = await crearExpediente(db());
    const b = await crearExpediente(db());
    const c = await crearExpediente(db());
    const operacion = `OP-${unico()}`;
    await insertarPago(a.idExpediente, "[Banco 1]", operacion);

    const repetido = await violacion(insertarPago(b.idExpediente, "[Banco 1]", operacion));
    expect(repetido).toMatchObject({ code: "23505", constraint: "uq_pago_banco_numero_operacion" });
    await expect(insertarPago(c.idExpediente, "[Banco 2]", operacion)).resolves.toBeDefined();
  });
});

describe("HU0006-1.0 el catálogo de eventos incluye documentos_confirmados", () => {
  it("HU0006-1.0 registro_auditoria admite documentos_confirmados y sigue rechazando valores fuera del catálogo (sección 4.7)", async () => {
    await expect(db().query("INSERT INTO registro_auditoria (tipo_evento) VALUES ('documentos_confirmados')")).resolves.toBeDefined();
    const fuera = await violacion(db().query("INSERT INTO registro_auditoria (tipo_evento) VALUES ('documentos_enviados')"));
    expect(fuera).toMatchObject({ code: "23514", constraint: "ck_auditoria_tipo_evento" });
  });
});
