// S0-B9: reglas de una sola fila implementadas como CHECK (migración reglas_fila_y_permisos).
import { afterAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearApoderado, crearExpediente, crearGrado, crearHorario, crearPersonal, unico, violacion } from "./ayudantes";

afterAll(cerrarPool);
const db = () => obtenerPool();

async function esperaCheck(promesa: Promise<unknown>, nombre: string) {
  const e = await violacion(promesa);
  expect(e.code).toBe("23514");
  expect(e.constraint).toBe(nombre);
}

describe("S0-B9 motivo de observación obligatorio", () => {
  it("S0-B9 documento observado exige motivo_observacion no vacío; pendiente no lo exige", async () => {
    const { idExpediente, idGrado } = await crearExpediente(db());
    const { rows } = await db().query<{ id_requisito: number }>(
      "INSERT INTO requisito_documental (id_grado, tipo_documento, categoria) VALUES ($1, $2, 'postulante_y_padres') RETURNING id_requisito",
      [idGrado, `doc-${unico()}`],
    );
    const idRequisito = rows[0]!.id_requisito;
    const insertar = (estado: string, motivo: string | null) =>
      db().query(
        `INSERT INTO documento (id_expediente, id_requisito, url_archivo, formato, tamano_kb, estado_verificacion, motivo_observacion)
         VALUES ($1, $2, 'local://doc.pdf', 'pdf', 100, $3::estado_revision, $4)`,
        [idExpediente, idRequisito, estado, motivo],
      );
    await esperaCheck(insertar("observado", null), "ck_documento_motivo_observacion");
    await esperaCheck(insertar("observado", "   "), "ck_documento_motivo_observacion");
    await expect(insertar("observado", "La imagen está borrosa")).resolves.toBeDefined();
    await expect(insertar("pendiente", null)).resolves.toBeDefined();
  });

  it("S0-B9 pago observado exige motivo_observacion no vacío; pendiente no lo exige", async () => {
    const { idExpediente } = await crearExpediente(db());
    const insertar = (fraccion: number, estado: string, motivo: string | null) =>
      db().query(
        `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url,
                           estado_validacion, motivo_observacion)
         VALUES ($1, 'cuota_ingreso', $2, $3, 'Banco Ficticio', 1000, '2027-01-10', 'local://c.pdf', $4::estado_revision, $5)`,
        [idExpediente, fraccion, `OP-${unico()}`, estado, motivo],
      );
    await esperaCheck(insertar(1, "observado", null), "ck_pago_motivo_observacion");
    await esperaCheck(insertar(1, "observado", ""), "ck_pago_motivo_observacion");
    await expect(insertar(1, "observado", "El monto no coincide con el abono")).resolves.toBeDefined();
    await expect(insertar(2, "pendiente", null)).resolves.toBeDefined();
  });
});

describe("S0-B9 posición en lista de espera", () => {
  it("S0-B9 posicion_lista_espera solo se admite con estado lista_espera", async () => {
    const idGrado = await crearGrado(db());
    const idApoderado = await crearApoderado(db());
    const insertar = (estado: string, posicion: number | null) =>
      db().query(
        `INSERT INTO expediente (id_apoderado_titular, id_grado, estado, posicion_lista_espera)
         VALUES ($1, $2, $3::estado_expediente, $4)`,
        [idApoderado, idGrado, estado, posicion],
      );
    await esperaCheck(insertar("apto", 1), "ck_expediente_posicion_lista_espera");
    await esperaCheck(insertar("prospecto", 3), "ck_expediente_posicion_lista_espera");
    await expect(insertar("lista_espera", 1)).resolves.toBeDefined();
    await expect(insertar("apto", null)).resolves.toBeDefined();
  });

  it("S0-B9 no se puede salir de lista_espera sin limpiar la posición (compromiso C4, HU0012)", async () => {
    const idGrado = await crearGrado(db());
    const idApoderado = await crearApoderado(db());
    const { rows } = await db().query<{ id_expediente: number }>(
      `INSERT INTO expediente (id_apoderado_titular, id_grado, estado, posicion_lista_espera)
       VALUES ($1, $2, 'lista_espera', 2) RETURNING id_expediente`,
      [idApoderado, idGrado],
    );
    const id = rows[0]!.id_expediente;
    await esperaCheck(
      db().query("UPDATE expediente SET estado = 'vacante_asignada' WHERE id_expediente = $1", [id]),
      "ck_expediente_posicion_lista_espera",
    );
    await expect(
      db().query("UPDATE expediente SET estado = 'vacante_asignada', posicion_lista_espera = NULL WHERE id_expediente = $1", [id]),
    ).resolves.toBeDefined();
  });
});

describe("S0-B9 tipo de evaluación", () => {
  it("S0-B9 resultado_evaluacion no admite tipo_evaluacion visita", async () => {
    const { idExpediente } = await crearExpediente(db());
    const idPsicologa = await crearPersonal(db(), "psicologa");
    const idHorario = await crearHorario(db(), idPsicologa);
    const crearCita = async (hora: string) =>
      (
        await db().query<{ id_cita: number }>(
          `INSERT INTO cita (id_expediente, id_personal, id_horario, tipo_cita, fecha_hora)
           VALUES ($1, $2, $3, 'evaluacion_psicologica', $4) RETURNING id_cita`,
          [idExpediente, idPsicologa, idHorario, `2027-02-01T${hora}:00-05:00`],
        )
      ).rows[0]!.id_cita;
    const insertar = (idCita: number, tipo: string) =>
      db().query(
        "INSERT INTO resultado_evaluacion (id_cita, id_personal, tipo_evaluacion, resultado) VALUES ($1, $2, $3::tipo_cita, 'r')",
        [idCita, idPsicologa, tipo],
      );
    await esperaCheck(insertar(await crearCita("09:00"), "visita"), "ck_resultado_tipo_evaluacion");
    await expect(insertar(await crearCita("10:00"), "evaluacion_psicologica")).resolves.toBeDefined();
  });
});
