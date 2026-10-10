// Restricciones del esquema (DBML v1.1): cada CHECK de las notas, las unicidades y la bitácora inmutable.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { columnasDni } from "../src/crypto/columnas";
import { crearApoderado, crearExpediente, crearGrado, crearHorario, crearPersonal, unico, violacion } from "./ayudantes";

afterAll(cerrarPool);
const db = () => obtenerPool();

async function esperaRestriccion(promesa: Promise<unknown>, nombre: string, codigo: string) {
  const e = await violacion(promesa);
  expect(e.code).toBe(codigo);
  expect(e.constraint).toBe(nombre);
}
const CHECK = "23514";
const UNIQUE = "23505";

async function crearCita(idExpediente: number, idPersonal: number, fechaHora = "2027-01-15T09:00:00-05:00") {
  const idHorario = await crearHorario(db(), idPersonal);
  const { rows } = await db().query<{ id_cita: number }>(
    `INSERT INTO cita (id_expediente, id_personal, id_horario, tipo_cita, fecha_hora)
     VALUES ($1, $2, $3, 'visita', $4) RETURNING id_cita`,
    [idExpediente, idPersonal, idHorario, fechaHora],
  );
  return rows[0]!.id_cita;
}

async function insertarPago(idExpediente: number, valores: Partial<{ operacion: string; monto: number; fraccion: number; tipo: string }> = {}) {
  return db().query(
    `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url)
     VALUES ($1, $2::tipo_pago, $3, $4, 'Banco Ficticio', $5, '2027-01-10', 'local://comprobante.pdf')`,
    [idExpediente, valores.tipo ?? "derecho_admision", valores.fraccion ?? 1, valores.operacion ?? `OP-${unico()}`, valores.monto ?? 300],
  );
}

describe("S0-B7 estructura del esquema", () => {
  it("S0-B7 la base admision tiene las 19 tablas y las 28 claves foráneas del DBML v1.1", async () => {
    const { rows: tablas } = await db().query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations' ORDER BY 1`,
    );
    expect(tablas.map((t) => t.table_name)).toEqual([
      "apoderado", "carta_vacante", "cita", "consentimiento", "cuenta_acceso", "cuestionario_expectativas",
      "dictamen_admision", "documento", "expediente", "grado", "horario_disponible", "notificacion", "pago",
      "personal", "postulante", "postulante_apoderado", "registro_auditoria", "requisito_documental",
      "resultado_evaluacion",
    ]);
    const { rows: fk } = await db().query(
      "SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY'",
    );
    expect(fk[0].n).toBe(28);
  });

  it("S0-B7 los valores por defecto del expediente son prospecto y pendiente", async () => {
    const { idExpediente } = await crearExpediente(db());
    const { rows } = await db().query(
      "SELECT estado::text, estado_documental::text, estado_financiero::text FROM expediente WHERE id_expediente = $1",
      [idExpediente],
    );
    expect(rows[0]).toEqual({ estado: "prospecto", estado_documental: "pendiente", estado_financiero: "pendiente" });
  });
});

describe("S0-B7 restricciones CHECK de las notas del DBML", () => {
  it("S0-B7 apoderado: dni_cifrado y dni_hash son ambos nulos o ambos con valor", async () => {
    await esperaRestriccion(
      db().query("INSERT INTO apoderado (dni_hash, nombres, apellidos, telefono, correo) VALUES ($1, 'A', 'B', '9', 'x@ejemplo.test')", [unico()]),
      "ck_apoderado_dni_par", CHECK,
    );
    await esperaRestriccion(
      db().query("INSERT INTO apoderado (dni_cifrado, nombres, apellidos, telefono, correo) VALUES ('v1:a:b:c', 'A', 'B', '9', 'x@ejemplo.test')"),
      "ck_apoderado_dni_par", CHECK,
    );
  });

  it("S0-B7 postulante: dni_cifrado y dni_hash son ambos nulos o ambos con valor", async () => {
    await esperaRestriccion(db().query("INSERT INTO postulante (dni_hash) VALUES ($1)", [unico()]), "ck_postulante_dni_par", CHECK);
  });

  it("S0-B7 postulante: el borrador admite nulos y ficha_completa exige DNI, nombres, apellidos y fecha de nacimiento", async () => {
    await expect(db().query("INSERT INTO postulante (ficha_completa) VALUES (false)")).resolves.toBeDefined();
    await esperaRestriccion(
      db().query("INSERT INTO postulante (ficha_completa, nombres, apellido_paterno, apellido_materno, fecha_nacimiento) VALUES (true, 'N', 'P', 'M', '2021-03-01')"),
      "ck_postulante_ficha_completa", CHECK,
    );
    const { dni_cifrado, dni_hash } = columnasDni(`9${unico().replace(/\D/g, "")}`);
    await expect(
      db().query(
        `INSERT INTO postulante (ficha_completa, dni_cifrado, dni_hash, nombres, apellido_paterno, apellido_materno, fecha_nacimiento)
         VALUES (true, $1, $2, 'N', 'P', 'M', '2021-03-01')`,
        [dni_cifrado, dni_hash],
      ),
    ).resolves.toBeDefined();
  });

  it("S0-B7 grado: 0 <= vacantes_disponibles <= vacantes_autorizadas", async () => {
    await esperaRestriccion(crearGrado(db(), { autorizadas: 5, disponibles: 6 }), "ck_grado_vacantes", CHECK);
    await esperaRestriccion(crearGrado(db(), { autorizadas: 5, disponibles: -1 }), "ck_grado_vacantes", CHECK);
  });

  it("S0-B7 grado: max_fracciones >= 1", async () => {
    await esperaRestriccion(
      db().query(
        `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso, max_fracciones)
         VALUES ('inicial', $1, 'T', 1, 1, 7000, 0)`,
        [`G-${unico()}`],
      ),
      "ck_grado_max_fracciones", CHECK,
    );
  });

  it("S0-B7 requisito_documental: si_dependiente y si_independiente exigen por_apoderado", async () => {
    const idGrado = await crearGrado(db());
    for (const condicion of ["si_dependiente", "si_independiente"]) {
      await esperaRestriccion(
        db().query(
          `INSERT INTO requisito_documental (id_grado, tipo_documento, categoria, condicion_aplicacion, por_apoderado)
           VALUES ($1, $2, 'financiero', $3::condicion_aplicacion, false)`,
          [idGrado, `doc-${unico()}`, condicion],
        ),
        "ck_requisito_por_apoderado", CHECK,
      );
    }
    await expect(
      db().query(
        `INSERT INTO requisito_documental (id_grado, tipo_documento, categoria, condicion_aplicacion, por_apoderado)
         VALUES ($1, 'boleta_pago_padre', 'financiero', 'si_dependiente', true)`,
        [idGrado],
      ),
    ).resolves.toBeDefined();
  });

  it("S0-B7 horario_disponible: hora_fin > hora_inicio y cupos >= 0", async () => {
    const idPersonal = await crearPersonal(db(), "directora");
    const insertar = (inicio: string, fin: string, cupos: number) =>
      db().query(
        `INSERT INTO horario_disponible (id_personal, tipo_cita, fecha, hora_inicio, hora_fin, cupos, campana_admision)
         VALUES ($1, 'visita', '2027-01-15', $2, $3, $4, 'T')`,
        [idPersonal, inicio, fin, cupos],
      );
    await esperaRestriccion(insertar("10:00", "10:00", 1), "ck_horario_horas", CHECK);
    await esperaRestriccion(insertar("10:00", "09:00", 1), "ck_horario_horas", CHECK);
    await esperaRestriccion(insertar("09:00", "10:00", -1), "ck_horario_cupos", CHECK);
  });

  it("S0-B7 pago: monto > 0 y numero_fraccion >= 1", async () => {
    const { idExpediente } = await crearExpediente(db());
    await esperaRestriccion(insertarPago(idExpediente, { monto: 0 }), "ck_pago_monto", CHECK);
    await esperaRestriccion(insertarPago(idExpediente, { fraccion: 0 }), "ck_pago_numero_fraccion", CHECK);
  });

  it("S0-B7 registro_auditoria: tipo_evento solo admite el catálogo de la sección 4.7", async () => {
    await esperaRestriccion(
      db().query("INSERT INTO registro_auditoria (tipo_evento) VALUES ('evento_inventado')"),
      "ck_auditoria_tipo_evento", CHECK,
    );
    for (const tipo of [
      "transicion_estado", "atencion_inicio", "atencion_fin", "acceso_denegado",
      "inicio_sesion", "cambio_configuracion", "gestion_usuario", "notificacion_rebotada",
    ]) {
      await expect(db().query("INSERT INTO registro_auditoria (tipo_evento) VALUES ($1)", [tipo])).resolves.toBeDefined();
    }
  });
});

describe("S0-B7 unicidades", () => {
  it("S0-B7 dni_hash es único en apoderado y en postulante", async () => {
    const dni = `8${unico().replace(/\D/g, "")}`;
    const { dni_cifrado, dni_hash } = columnasDni(dni);
    const apoderado = () =>
      db().query("INSERT INTO apoderado (dni_cifrado, dni_hash, nombres, apellidos, telefono, correo) VALUES ($1, $2, 'A', 'B', '9', 'x@ejemplo.test')", [dni_cifrado, dni_hash]);
    await apoderado();
    await esperaRestriccion(apoderado(), "uq_apoderado_dni_hash", UNIQUE);

    const postulante = () => db().query("INSERT INTO postulante (dni_cifrado, dni_hash) VALUES ($1, $2)", [dni_cifrado, dni_hash]);
    await postulante();
    await esperaRestriccion(postulante(), "uq_postulante_dni_hash", UNIQUE);
  });

  it("S0-B7 personal: correo y keycloak_user_id son únicos", async () => {
    const correo = `p-${unico()}@ejemplo.test`;
    const kc = randomUUID();
    const insertar = (c: string, k: string) =>
      db().query("INSERT INTO personal (nombres, apellidos, rol, correo, keycloak_user_id) VALUES ('N', 'A', 'secretaria', $1, $2)", [c, k]);
    await insertar(correo, kc);
    await esperaRestriccion(insertar(correo, randomUUID()), "uq_personal_correo", UNIQUE);
    await esperaRestriccion(insertar(`p-${unico()}@ejemplo.test`, kc), "uq_personal_keycloak", UNIQUE);
  });

  it("S0-B7 cuenta_acceso: una por apoderado y keycloak_user_id único", async () => {
    const idApoderado = await crearApoderado(db());
    const kc = randomUUID();
    const insertar = (a: number, k: string) => db().query("INSERT INTO cuenta_acceso (id_apoderado, keycloak_user_id) VALUES ($1, $2)", [a, k]);
    await insertar(idApoderado, kc);
    await esperaRestriccion(insertar(idApoderado, randomUUID()), "uq_cuenta_acceso_apoderado", UNIQUE);
    await esperaRestriccion(insertar(await crearApoderado(db()), kc), "uq_cuenta_acceso_keycloak", UNIQUE);
  });

  it("S0-B7 grado: nombre_grado único por campaña", async () => {
    const nombre = `G-${unico()}`;
    const insertar = () =>
      db().query(
        `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso)
         VALUES ('inicial', $1, 'T', 1, 1, 7000)`,
        [nombre],
      );
    await insertar();
    await esperaRestriccion(insertar(), "uq_grado_nombre_campana", UNIQUE);
  });

  it("S0-B7 requisito_documental: tipo_documento único por grado", async () => {
    const idGrado = await crearGrado(db());
    const insertar = () =>
      db().query("INSERT INTO requisito_documental (id_grado, tipo_documento, categoria) VALUES ($1, 'partida_nacimiento', 'postulante_y_padres')", [idGrado]);
    await insertar();
    await esperaRestriccion(insertar(), "uq_requisito_grado_tipo", UNIQUE);
  });

  it("S0-B7 pago: numero_operacion único (R19) y un pago por expediente, tipo y fracción", async () => {
    const { idExpediente } = await crearExpediente(db());
    const operacion = `OP-${unico()}`;
    await insertarPago(idExpediente, { operacion });
    const otro = await crearExpediente(db());
    await esperaRestriccion(insertarPago(otro.idExpediente, { operacion }), "uq_pago_numero_operacion", UNIQUE);
    await esperaRestriccion(insertarPago(idExpediente), "uq_pago_expediente_tipo_fraccion", UNIQUE);
  });

  it("S0-B7 cita: el mismo responsable no tiene dos citas a la misma fecha y hora (uq_cita_personal_fecha)", async () => {
    const idPersonal = await crearPersonal(db(), "directora");
    await crearCita((await crearExpediente(db())).idExpediente, idPersonal);
    await esperaRestriccion(crearCita((await crearExpediente(db())).idExpediente, idPersonal), "uq_cita_personal_fecha", UNIQUE);
  });

  it("S0-B7 relaciones 1:0..1: un cuestionario, un resultado por cita, un dictamen y una carta por expediente", async () => {
    const { idExpediente } = await crearExpediente(db());
    const idPsicologa = await crearPersonal(db(), "psicologa");
    const idDirectora = await crearPersonal(db(), "directora");
    const idCita = await crearCita(idExpediente, idPsicologa);

    const cuestionario = () => db().query("INSERT INTO cuestionario_expectativas (id_expediente, respuestas) VALUES ($1, '{}')", [idExpediente]);
    await cuestionario();
    await esperaRestriccion(cuestionario(), "uq_cuestionario_expediente", UNIQUE);

    const resultado = () =>
      db().query("INSERT INTO resultado_evaluacion (id_cita, id_personal, tipo_evaluacion, resultado) VALUES ($1, $2, 'evaluacion_psicologica', 'r')", [idCita, idPsicologa]);
    await resultado();
    await esperaRestriccion(resultado(), "uq_resultado_cita", UNIQUE);

    const dictamen = () => db().query("INSERT INTO dictamen_admision (id_expediente, id_personal, dictamen) VALUES ($1, $2, 'apto')", [idExpediente, idPsicologa]);
    await dictamen();
    await esperaRestriccion(dictamen(), "uq_dictamen_expediente", UNIQUE);

    const carta = () =>
      db().query("INSERT INTO carta_vacante (id_expediente, id_personal_autoriza, url_documento) VALUES ($1, $2, 'local://carta.pdf')", [idExpediente, idDirectora]);
    await carta();
    await esperaRestriccion(carta(), "uq_carta_expediente", UNIQUE);
  });
});

describe("S0-B7 registro_auditoria es de solo inserción", () => {
  it("S0-B7 rechaza UPDATE, DELETE y TRUNCATE sobre registro_auditoria", async () => {
    const { rows } = await db().query<{ id_evento: string }>(
      "INSERT INTO registro_auditoria (tipo_evento, detalle) VALUES ('inicio_sesion', '{}') RETURNING id_evento",
    );
    const id = rows[0]!.id_evento;
    for (const sql of [
      ["UPDATE registro_auditoria SET detalle = '{\"x\":1}' WHERE id_evento = $1", [id]],
      ["DELETE FROM registro_auditoria WHERE id_evento = $1", [id]],
      ["TRUNCATE registro_auditoria", []],
    ] as const) {
      const e = await violacion(db().query(sql[0], [...sql[1]]));
      expect(e.code).toBe("42501");
    }
    const { rows: siguen } = await db().query("SELECT detalle FROM registro_auditoria WHERE id_evento = $1", [id]);
    expect(siguen).toEqual([{ detalle: {} }]);
  });
});
