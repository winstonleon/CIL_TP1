// HU0005 (P05 y P05b, /familia, solo el rol familia y solo su propio expediente): 1.0 guardado completo de la ficha y del
// cuestionario, con la lista de documentos que corresponde (R7, C25); 2.0 borrador y retomar sin pérdida; y las partes
// de autorización (404 al expediente ajeno, ADR-20) y de DNI duplicado (C28). Datos ficticios @ejemplo.test.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashDni } from "../src/crypto/columnas";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, eventosDe } from "./ayudantes";
import { dniNuevo, entornoFicha, fichaCompleta, filaPostulante, requisito, rutaFicha, rutaRequisitos } from "./ayudantesFicha";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

const entorno = () => entornoFicha(db(), firmante);
const transiciones = async (idExpediente: number) => (await eventosDe(db(), idExpediente)).filter((e) => e.tipo_evento === "transicion_estado");
const borrador = (cambios: Record<string, unknown> = {}) => ({ modo: "borrador", postulante: {}, titular: {}, ...cambios });

describe("HU0005-1.0 guardado completo de la ficha de inscripción y del cuestionario", () => {
  it("HU0005-1.0 guarda la ficha completa, cifra los DNI, marca la ficha completa y devuelve la lista de documentos", async () => {
    const e = await entorno();
    const f = await e.familia();
    await requisito(db(), f.idGrado, "Partida de nacimiento", "todos");
    const cuerpo = fichaCompleta();

    const res = await e.como(f.token).guardar(rutaFicha(f.idExpediente), cuerpo);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ficha_completa: true,
      guardado_en: expect.any(String),
      requisitos: [{ tipo_documento: "Partida de nacimiento", categoria: "postulante_y_padres", obligatorio: true, por_apoderado: false, id_apoderado: null, apoderado: null }],
    });
    const p = await filaPostulante(db(), f.idExpediente);
    expect(p).toMatchObject({ ficha_completa: true, estado_expediente: "en_postulacion", nombres: "Sofía Valentina", estudio_en_colegio_peruano: true, tiene_condicion_especial: false });
    // ADR-03: el DNI está cifrado (v1:…) y solo se busca por su hash; el texto plano no está en la fila.
    expect(p.dni_cifrado).toMatch(/^v1:/);
    expect(p.dni_cifrado).not.toContain(cuerpo.postulante.dni);
    expect(p.dni_hash).toMatch(/^[0-9a-f]{64}$/);
    const { rows: apoderados } = await db().query(
      `SELECT a.dni_cifrado, a.dni_hash, a.telefono, a.condicion_laboral::text AS condicion, pa.parentesco, a.id_apoderado
         FROM postulante_apoderado pa JOIN apoderado a ON a.id_apoderado = pa.id_apoderado
        WHERE pa.id_postulante = $1 ORDER BY a.id_apoderado`,
      [p.id_postulante],
    );
    expect(apoderados).toHaveLength(2);
    expect(apoderados[0]).toMatchObject({ id_apoderado: f.idApoderado, parentesco: "madre", condicion: "dependiente" });
    expect(apoderados[1]).toMatchObject({ parentesco: "padre", condicion: "independiente", telefono: "+51986432175" });
    for (const a of apoderados) {
      expect(a.dni_cifrado).toMatch(/^v1:/);
      expect(a.dni_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    const { rows: [c] } = await db().query("SELECT es_borrador, respuestas FROM cuestionario_expectativas WHERE id_expediente = $1", [f.idExpediente]);
    expect(c).toMatchObject({ es_borrador: false, respuestas: cuerpo.respuestas });

    // La familia dueña lee su DNI en claro; el hash y el valor cifrado nunca salen de la API.
    const lectura = await e.como(f.token).ver(rutaFicha(f.idExpediente));
    expect(lectura.status).toBe(200);
    expect(lectura.body).toMatchObject({ ficha_completa: true, postulante: { dni: cuerpo.postulante.dni }, titular: { dni: cuerpo.titular.dni, parentesco: "madre" } });
    const texto = JSON.stringify([res.body, lectura.body]);
    expect(texto).not.toContain(p.dni_hash);
    expect(texto).not.toContain("v1:");
  });

  it("HU0005-1.0 la lista de documentos sale del grado y de lo declarado sobre colegio, condición especial y condición laboral de cada padre", async () => {
    const e = await entorno();
    const f1 = await e.familia();
    const f2 = await e.familia("portal_habilitado", f1.idGrado);
    const f3 = await e.familia("portal_habilitado", f1.idGrado);
    const g = f1.idGrado;
    await requisito(db(), g, "Partida de nacimiento", "todos");
    await requisito(db(), g, "Certificado de estudios", "solo_colegio_peruano", { categoria: "colegio_procedencia" });
    await requisito(db(), g, "Informe de terapia", "solo_condicion_especial", { categoria: "condicion_especial", obligatorio: false });
    await requisito(db(), g, "Boletas de pago", "si_dependiente", { categoria: "financiero", porApoderado: true });
    await requisito(db(), g, "Recibos por honorarios", "si_independiente", { categoria: "financiero", porApoderado: true });
    const MADRE = "María Fernanda Quispe Rojas";
    const PADRE = "José Luis Quispe Huamán";
    const lista = async (f: Awaited<ReturnType<typeof e.familia>>) =>
      (await e.como(f.token).ver(rutaRequisitos(f.idExpediente))).body.requisitos.map((r: { tipo_documento: string; apoderado: string | null }) => [r.tipo_documento, r.apoderado]);

    // Colegio peruano, sin condición especial, madre dependiente y padre independiente.
    await e.como(f1.token).guardar(rutaFicha(f1.idExpediente), fichaCompleta());
    expect(await lista(f1)).toEqual([["Partida de nacimiento", null], ["Certificado de estudios", null], ["Boletas de pago", MADRE], ["Recibos por honorarios", PADRE]]);

    // Sin colegio peruano, con condición especial, madre independiente y padre dependiente.
    const cuerpo2 = fichaCompleta();
    await e.como(f2.token).guardar(rutaFicha(f2.idExpediente), {
      ...cuerpo2,
      postulante: { ...cuerpo2.postulante, estudio_en_colegio_peruano: false, colegio_procedencia: "no aplica", tiene_condicion_especial: true },
      titular: { ...cuerpo2.titular, condicion_laboral: "independiente" },
      segundo_apoderado: { ...cuerpo2.segundo_apoderado, condicion_laboral: "dependiente" },
    });
    expect(await filaPostulante(db(), f2.idExpediente)).toMatchObject({ estudio_en_colegio_peruano: false, colegio_procedencia: null }); // «No»: el colegio no aplica
    expect(await lista(f2)).toEqual([["Partida de nacimiento", null], ["Informe de terapia", null], ["Boletas de pago", PADRE], ["Recibos por honorarios", MADRE]]);

    // Un solo padre dependiente: los requisitos por apoderado salen solo para él.
    await e.como(f3.token).guardar(rutaFicha(f3.idExpediente), fichaCompleta({ segundo_apoderado: null }));
    expect(await lista(f3)).toEqual([["Partida de nacimiento", null], ["Certificado de estudios", null], ["Boletas de pago", MADRE]]);
  });

  it("HU0005-1.0 (C25) un requisito creado por la ruta de G09 aparece en la lista, que no se entrega hasta completar la ficha", async () => {
    const e = await entorno();
    const f = await e.familia();
    const alta = await request(e.app)
      .post(`/configuracion/grados/${f.idGrado}/requisitos`)
      .set("Authorization", `Bearer ${e.tokenSecretaria}`)
      .send({ tipo_documento: "Constancia de matrícula", categoria: "colegio_procedencia", condicion_aplicacion: "solo_colegio_peruano" });
    expect(alta.status).toBe(201);

    const antes = await e.como(f.token).ver(rutaRequisitos(f.idExpediente));
    expect(antes.status).toBe(409);
    expect(antes.body.error.codigo).toBe("FICHA_INCOMPLETA");

    await e.como(f.token).guardar(rutaFicha(f.idExpediente), fichaCompleta());
    const despues = await e.como(f.token).ver(rutaRequisitos(f.idExpediente));
    expect(despues.status).toBe(200);
    expect(despues.body.requisitos.map((r: { tipo_documento: string }) => r.tipo_documento)).toEqual(["Constancia de matrícula"]);
  });

  it("HU0005-1.0 una ficha incompleta no se guarda: 400 con lo que falta y sin cambios en el expediente", async () => {
    const e = await entorno();
    const f = await e.familia();
    const cuerpo = fichaCompleta();

    const res = await e.como(f.token).guardar(rutaFicha(f.idExpediente), {
      ...cuerpo,
      postulante: { ...cuerpo.postulante, nombres: "  ", fecha_nacimiento: "14/03/2018" },
      respuestas: { p1: "Algo" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe("VALIDACION");
    expect(res.body.error.detalle).toEqual(
      expect.arrayContaining([
        { campo: "postulante.nombres", codigo: "OBLIGATORIO" },
        { campo: "postulante.fecha_nacimiento", codigo: "FORMATO" },
        { campo: "respuestas.p2", codigo: "OBLIGATORIO" },
        { campo: "respuestas.p3", codigo: "OBLIGATORIO" },
      ]),
    );
    expect(await filaPostulante(db(), f.idExpediente)).toMatchObject({ id_postulante: null, estado_expediente: "portal_habilitado" });
    expect(await transiciones(f.idExpediente)).toHaveLength(0);
    expect((await db().query("SELECT 1 FROM cuestionario_expectativas WHERE id_expediente = $1", [f.idExpediente])).rowCount).toBe(0);
  });

  it("HU0005-1.0 con la ficha ya completa, otro guardado responde 409 FICHA_YA_COMPLETA y no cambia nada", async () => {
    const e = await entorno();
    const f = await e.familia();
    expect((await e.como(f.token).guardar(rutaFicha(f.idExpediente), fichaCompleta())).status).toBe(200);
    const antes = await filaPostulante(db(), f.idExpediente);

    const otra = await e.como(f.token).guardar(rutaFicha(f.idExpediente), borrador({ postulante: { nombres: "Otro nombre" } }));

    expect(otra.status).toBe(409);
    expect(otra.body.error.codigo).toBe("FICHA_YA_COMPLETA");
    expect(await filaPostulante(db(), f.idExpediente)).toEqual(antes);
  });

  it("HU0005-1.0 con el expediente fuera de postulación, guardar responde 409 FICHA_NO_EDITABLE y no cambia nada", async () => {
    const e = await entorno();
    const g = await e.familia("en_validacion");

    const fuera = await e.como(g.token).guardar(rutaFicha(g.idExpediente), borrador());

    expect(fuera.status).toBe(409);
    expect(fuera.body.error.codigo).toBe("FICHA_NO_EDITABLE");
    expect(await transiciones(g.idExpediente)).toHaveLength(0);
    expect(await filaPostulante(db(), g.idExpediente)).toMatchObject({ id_postulante: null, estado_expediente: "en_validacion" });
  });

  const largo = (n: number) => "x".repeat(n);
  const CASOS_VALIDACION: [string, (c: ReturnType<typeof fichaCompleta>) => unknown, { campo: string; codigo?: string }][] = [
    ["un nombre de 101 caracteres", (c) => ({ ...c, postulante: { ...c.postulante, nombres: largo(101) } }), { campo: "postulante.nombres" }],
    ["un colegio de procedencia de 151 caracteres", (c) => ({ ...c, postulante: { ...c.postulante, colegio_procedencia: largo(151) } }), { campo: "postulante.colegio_procedencia" }],
    ["una respuesta de más de 2000 caracteres", (c) => ({ ...c, respuestas: { ...c.respuestas, p1: largo(2001) } }), { campo: "respuestas.p1" }],
    ["un teléfono +51 que no es un celular de 9 dígitos", (c) => ({ ...c, segundo_apoderado: { ...c.segundo_apoderado, telefono: "+51123456789" } }), { campo: "segundo_apoderado.telefono", codigo: "FORMATO" }],
    ["un correo inválido", (c) => ({ ...c, segundo_apoderado: { ...c.segundo_apoderado, correo: "no-es-un-correo" } }), { campo: "segundo_apoderado.correo", codigo: "FORMATO" }],
    ["una fecha de nacimiento futura", (c) => ({ ...c, postulante: { ...c.postulante, fecha_nacimiento: "2999-01-01" } }), { campo: "postulante.fecha_nacimiento", codigo: "FORMATO" }],
    ["un parentesco fuera de la lista", (c) => ({ ...c, titular: { ...c.titular, parentesco: "tío" } }), { campo: "titular.parentesco", codigo: "FORMATO" }],
  ];
  it.each(CASOS_VALIDACION)("HU0005-1.0 longitud y formato: %s responde 400 y no guarda nada", async (_descripcion, alterar, esperado) => {
    const e = await entorno();
    const f = await e.familia();

    const res = await e.como(f.token).guardar(rutaFicha(f.idExpediente), alterar(fichaCompleta()));

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe("VALIDACION");
    if (esperado.codigo) expect(res.body.error.detalle).toContainEqual({ campo: esperado.campo, codigo: esperado.codigo });
    else expect(res.body.error.mensaje).toContain(esperado.campo); // los límites de longitud los rechaza la validación del cuerpo
    expect(await filaPostulante(db(), f.idExpediente)).toMatchObject({ id_postulante: null, estado_expediente: "portal_habilitado" });
    expect(await transiciones(f.idExpediente)).toHaveLength(0);
  });
});

describe("HU0005-2.0 guardado parcial de borrador de ficha", () => {
  it("HU0005-2.0 [parte: borrador] guarda un borrador parcial, lo devuelve al retomar y la transición a en_postulacion ocurre solo en el primer guardado", async () => {
    const e = await entorno();
    const f = await e.familia();
    const dniP = dniNuevo();
    const dniT = dniNuevo();

    const r1 = await e.como(f.token).guardar(
      rutaFicha(f.idExpediente),
      borrador({
        postulante: { nombres: "Sofía Valentina", dni: dniP, estudio_en_colegio_peruano: true },
        titular: { parentesco: "madre", dni: dniT },
        respuestas: { p1: "Buscamos una formación integral." },
      }),
    );

    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ ficha_completa: false, guardado_en: expect.any(String) });
    expect(r1.body.pendientes).toEqual(
      expect.arrayContaining([
        { campo: "postulante.apellido_paterno", codigo: "OBLIGATORIO" },
        { campo: "postulante.colegio_procedencia", codigo: "OBLIGATORIO" },
        { campo: "titular.condicion_laboral", codigo: "OBLIGATORIO" },
        { campo: "respuestas.p2", codigo: "OBLIGATORIO" },
      ]),
    );
    const lectura = await e.como(f.token).ver(rutaFicha(f.idExpediente));
    expect(lectura.body).toMatchObject({
      estado: "en_postulacion",
      ficha_completa: false,
      guardado_en: r1.body.guardado_en,
      postulante: { nombres: "Sofía Valentina", dni: dniP, estudio_en_colegio_peruano: true, apellido_paterno: null },
      titular: { parentesco: "madre", dni: dniT, nombres: "María Fernanda", correo: f.correo },
      segundo_apoderado: null,
      cuestionario: { version: "borrador-1", respuestas: { p1: "Buscamos una formación integral." } },
    });
    expect(lectura.body.cuestionario.preguntas).toHaveLength(3);
    expect(await transiciones(f.idExpediente)).toEqual([
      expect.objectContaining({ estado_anterior: "portal_habilitado", estado_nuevo: "en_postulacion", id_personal: null, detalle: expect.objectContaining({ campo: "estado", origen: "familia" }) }),
    ]);
    const { id_postulante } = await filaPostulante(db(), f.idExpediente);

    // Segundo guardado con el mismo DNI: no choca con su propia fila ni repite la transición ni crea otro postulante.
    const r2 = await e.como(f.token).guardar(
      rutaFicha(f.idExpediente),
      borrador({ postulante: { nombres: "Sofía Valentina", apellido_paterno: "Quispe", dni: dniP }, titular: { parentesco: "madre", dni: dniT } }),
    );
    expect(r2.status).toBe(200);
    expect(r2.body.pendientes).not.toContainEqual(expect.objectContaining({ codigo: "DNI_YA_REGISTRADO" }));
    expect(await filaPostulante(db(), f.idExpediente)).toMatchObject({ id_postulante, apellido_paterno: "Quispe", ficha_completa: false });
    expect(await transiciones(f.idExpediente)).toHaveLength(1);

    // Al completarla, la transición sigue siendo una sola.
    const fin = await e.como(f.token).guardar(rutaFicha(f.idExpediente), fichaCompleta({ postulante: { ...fichaCompleta().postulante, dni: dniP }, titular: { parentesco: "madre", dni: dniT, condicion_laboral: "dependiente" } }));
    expect(fin.status).toBe(200);
    expect(await transiciones(f.idExpediente)).toHaveLength(1);
  });

  it("HU0005-2.0 [parte: borrador] las preguntas sin responder vuelven como null (no como «No») y la ficha no se puede completar sin responderlas", async () => {
    const e = await entorno();
    const f = await e.familia();

    const res = await e.como(f.token).guardar(rutaFicha(f.idExpediente), borrador({ postulante: { nombres: "Sofía Valentina" } }));

    expect(res.status).toBe(200);
    expect(res.body.pendientes).toEqual(
      expect.arrayContaining([
        { campo: "postulante.estudio_en_colegio_peruano", codigo: "OBLIGATORIO" },
        { campo: "postulante.tiene_condicion_especial", codigo: "OBLIGATORIO" },
      ]),
    );
    // NULL explícito en la base: el DEFAULT false de la columna no se usa (HU0005-2.0).
    const { rows: [fila] } = await db().query(
      `SELECT estudio_en_colegio_peruano IS NULL AS sin_colegio, tiene_condicion_especial IS NULL AS sin_condicion
         FROM expediente e JOIN postulante p ON p.id_postulante = e.id_postulante WHERE e.id_expediente = $1`,
      [f.idExpediente],
    );
    expect(fila).toEqual({ sin_colegio: true, sin_condicion: true });
    const lectura = await e.como(f.token).ver(rutaFicha(f.idExpediente));
    expect(lectura.body.postulante).toMatchObject({ estudio_en_colegio_peruano: null, tiene_condicion_especial: null });

    const cuerpo = fichaCompleta();
    const sinResponder = await e.como(f.token).guardar(rutaFicha(f.idExpediente), {
      ...cuerpo,
      postulante: { ...cuerpo.postulante, estudio_en_colegio_peruano: null, tiene_condicion_especial: undefined },
    });
    expect(sinResponder.status).toBe(400);
    expect(sinResponder.body.error.detalle).toEqual(
      expect.arrayContaining([
        { campo: "postulante.estudio_en_colegio_peruano", codigo: "OBLIGATORIO" },
        { campo: "postulante.tiene_condicion_especial", codigo: "OBLIGATORIO" },
      ]),
    );
    expect(await filaPostulante(db(), f.idExpediente)).toMatchObject({ ficha_completa: false });
  });

  it("HU0005-2.0 [parte: segundo apoderado parcial] el bloque a medias vuelve en pendientes sin perder el resto del borrador, y se completa o se quita después", async () => {
    const e = await entorno();
    const f = await e.familia();
    const ruta = rutaFicha(f.idExpediente);
    const dniP = dniNuevo();

    const aMedias = await e.como(f.token).guardar(ruta, borrador({ postulante: { nombres: "Sofía Valentina", dni: dniP }, segundo_apoderado: { nombres: "José Luis" } }));
    expect(aMedias.status).toBe(200);
    expect(aMedias.body.pendientes).toEqual(
      expect.arrayContaining([
        { campo: "segundo_apoderado.apellidos", codigo: "OBLIGATORIO" },
        { campo: "segundo_apoderado.parentesco", codigo: "OBLIGATORIO" },
        { campo: "segundo_apoderado.telefono", codigo: "OBLIGATORIO" },
        { campo: "segundo_apoderado.correo", codigo: "OBLIGATORIO" },
      ]),
    );
    let lectura = (await e.como(f.token).ver(ruta)).body;
    // C43: hoy el bloque a medias no se guarda. Cuando el compromiso se cumpla, aquí vuelve el bloque parcial y esta aserción cambia.
    expect(lectura.segundo_apoderado).toBeNull();
    expect(lectura.postulante).toMatchObject({ nombres: "Sofía Valentina", dni: dniP });

    const correo = `padre-${randomUUID().slice(0, 8)}@ejemplo.test`;
    const completo = { parentesco: "padre", nombres: "José Luis", apellidos: "Quispe Huamán", telefono: "986 432 175", correo };
    const conBloque = await e.como(f.token).guardar(ruta, borrador({ postulante: { nombres: "Sofía Valentina", dni: dniP }, segundo_apoderado: completo }));
    expect(conBloque.body.pendientes).toEqual(expect.arrayContaining([{ campo: "segundo_apoderado.dni", codigo: "OBLIGATORIO" }]));
    lectura = (await e.como(f.token).ver(ruta)).body;
    expect(lectura.segundo_apoderado).toMatchObject({ parentesco: "padre", nombres: "José Luis", telefono: "+51986432175", correo, dni: null });
    const { rows: [{ id_apoderado }] } = await db().query("SELECT id_apoderado FROM apoderado WHERE correo = $1", [correo]);

    // Quitar el bloque borra al segundo padre (todavía no tiene documentos).
    await e.como(f.token).guardar(ruta, borrador({ postulante: { nombres: "Sofía Valentina", dni: dniP }, segundo_apoderado: null }));
    expect((await e.como(f.token).ver(ruta)).body.segundo_apoderado).toBeNull();
    expect((await db().query("SELECT 1 FROM apoderado WHERE id_apoderado = $1", [id_apoderado])).rowCount).toBe(0);
  });

  it("HU0005-2.0 [parte: borrador] un DNI parcial no llega a la base y no produce DNI_YA_REGISTRADO", async () => {
    const e = await entorno();
    const f = await e.familia();

    const res = await e.como(f.token).guardar(
      rutaFicha(f.idExpediente),
      borrador({ postulante: { nombres: "Sofía Valentina", dni: "1234" }, titular: { dni: "78 45" } }),
    );

    expect(res.status).toBe(200);
    expect(res.body.pendientes).toEqual(
      expect.arrayContaining([
        { campo: "postulante.dni", codigo: "DNI_FORMATO" },
        { campo: "titular.dni", codigo: "DNI_FORMATO" },
      ]),
    );
    expect(res.body.pendientes).not.toContainEqual(expect.objectContaining({ codigo: "DNI_YA_REGISTRADO" }));
    const p = await filaPostulante(db(), f.idExpediente);
    expect(p).toMatchObject({ nombres: "Sofía Valentina", dni_cifrado: null, dni_hash: null });
    const { rows: [t] } = await db().query("SELECT dni_cifrado, dni_hash FROM apoderado WHERE id_apoderado = $1", [f.idApoderado]);
    expect(t).toEqual({ dni_cifrado: null, dni_hash: null });
  });
});

describe("HU0005-1.0 autorización: la familia solo accede a su propio expediente", () => {
  it("HU0005-1.0 (autorización) la familia A no lee ni escribe el expediente de la familia B: 404 igual que uno inexistente, sin cambios y auditado", async () => {
    const e = await entorno();
    const a = await e.familia();
    const b = await e.familia();
    const comoA = e.como(a.token);
    const { rows: [{ maximo }] } = await db().query("SELECT max(id_expediente) AS maximo FROM expediente");
    const inexistente = await comoA.ver(rutaFicha(maximo + 1_000_000));
    expect(inexistente.status).toBe(404);

    const lecturas = [await comoA.ver(rutaFicha(b.idExpediente)), await comoA.ver(rutaRequisitos(b.idExpediente))];
    const escritura = await comoA.guardar(rutaFicha(b.idExpediente), fichaCompleta());
    const borradorAjeno = await comoA.guardar(rutaFicha(b.idExpediente), borrador({ postulante: { nombres: "Intruso" } }));

    for (const res of [...lecturas, escritura, borradorAjeno]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(inexistente.body); // mismo cuerpo: no confirma que el id exista
    }
    expect(inexistente.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");
    expect(await filaPostulante(db(), b.idExpediente)).toMatchObject({ id_postulante: null, estado_expediente: "portal_habilitado" });
    expect(await transiciones(b.idExpediente)).toHaveLength(0);
    const denegados = (await eventosDe(db(), b.idExpediente)).filter((ev) => ev.tipo_evento === "acceso_denegado");
    expect(denegados.map((ev) => ev.detalle.metodo).sort()).toEqual(["GET", "GET", "PUT", "PUT"]);
    for (const ev of denegados) {
      expect(ev.detalle).toMatchObject({ keycloak_user_id: a.sub, roles_requeridos: ["familia"], motivo: "expediente_ajeno" });
    }
    // Un id inexistente no deja evento: no hay expediente al que referenciar (ADR-20).
    expect((await db().query("SELECT 1 FROM registro_auditoria WHERE detalle->>'keycloak_user_id' = $1 AND id_expediente IS NULL", [a.sub])).rowCount).toBe(0);

    // La lista de A solo trae su expediente.
    const lista = await comoA.ver("/familia/expedientes");
    expect(lista.status).toBe(200);
    expect(lista.body).toEqual([{ id_expediente: a.idExpediente, codigo: expect.stringMatching(new RegExp(`^ADM-${e.campana}-\\d{4}$`)), estado: "portal_habilitado", grado: expect.any(String), postulante: null, ficha_completa: false }]);
  });

  it("HU0005-1.0 (autorización) un id de expediente, postulante o apoderado en el cuerpo se rechaza con 400 y no cambia nada", async () => {
    const e = await entorno();
    const a = await e.familia();
    const b = await e.familia();
    const cuerpo = fichaCompleta();

    const intentos = ["completa", "borrador"].flatMap((modo) => [
      { ...cuerpo, modo, id_expediente: b.idExpediente },
      { ...cuerpo, modo, postulante: { ...cuerpo.postulante, id_postulante: 1 } },
      { ...cuerpo, modo, titular: { ...cuerpo.titular, id_apoderado: b.idApoderado } },
    ]);
    for (const intento of intentos) {
      const res = await e.como(a.token).guardar(rutaFicha(a.idExpediente), intento);
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
    }
    for (const f of [a, b]) {
      expect(await filaPostulante(db(), f.idExpediente)).toMatchObject({ id_postulante: null, estado_expediente: "portal_habilitado" });
    }
  });

  const RUTAS_FAMILIA: [string, "get" | "put", (idExpediente: number) => string][] = [
    ["GET /familia/expedientes", "get", () => "/familia/expedientes"],
    ["GET /familia/expedientes/:id/ficha", "get", rutaFicha],
    ["PUT /familia/expedientes/:id/ficha", "put", rutaFicha],
    ["GET /familia/expedientes/:id/requisitos", "get", rutaRequisitos],
  ];
  it.each(RUTAS_FAMILIA)("HU0005-1.0 (autorización) %s: sin sesión responde 401 y con el rol secretaria 403", async (_ruta, metodo, rutaDe) => {
    const e = await entorno();
    const a = await e.familia();
    const url = rutaDe(a.idExpediente);

    const sinSesion = metodo === "get" ? request(e.app).get(url) : request(e.app).put(url).send(fichaCompleta());
    expect((await sinSesion).status).toBe(401);
    const personal = metodo === "get" ? e.como(e.tokenSecretaria).ver(url) : e.como(e.tokenSecretaria).guardar(url, fichaCompleta());
    expect((await personal).status).toBe(403);
    expect(await filaPostulante(db(), a.idExpediente)).toMatchObject({ id_postulante: null, estado_expediente: "portal_habilitado" });
  });

  it("HU0005-1.0 (autorización) una cuenta familia sin expediente no ve ninguno y recibe 404 en el de otra familia", async () => {
    const e = await entorno();
    const a = await e.familia();

    const sinCuenta = e.como(await firmante.token(randomUUID(), ["familia"]));
    expect((await sinCuenta.ver("/familia/expedientes")).body).toEqual([]);
    expect((await sinCuenta.ver(rutaFicha(a.idExpediente))).status).toBe(404);
    expect((await sinCuenta.guardar(rutaFicha(a.idExpediente), fichaCompleta())).status).toBe(404);
    expect((await sinCuenta.ver("/familia/expedientes/abc/ficha")).status).toBe(404);
    expect(await filaPostulante(db(), a.idExpediente)).toMatchObject({ id_postulante: null });
  });
});

describe("HU0005-1.0 DNI duplicado: un DNI ya registrado no se guarda ni revela datos del otro expediente", () => {
  it("HU0005-1.0 (DNI duplicado) «Guardar y continuar» con el DNI de otro postulante responde 409 sin datos ajenos y sin guardar nada", async () => {
    const e = await entorno();
    const b = await e.familia();
    const a = await e.familia();
    const cuerpoB = fichaCompleta();
    expect((await e.como(b.token).guardar(rutaFicha(b.idExpediente), cuerpoB)).status).toBe(200);
    const cuerpoA = fichaCompleta();

    const mismoPostulante = await e.como(a.token).guardar(rutaFicha(a.idExpediente), {
      ...cuerpoA,
      postulante: { ...cuerpoA.postulante, dni: cuerpoB.postulante.dni },
    });

    expect(mismoPostulante.status).toBe(409);
    expect(mismoPostulante.body.error).toMatchObject({ codigo: "DNI_YA_REGISTRADO", detalle: [{ campo: "postulante.dni", codigo: "DNI_YA_REGISTRADO" }] });
    // No dice de quién es: ni expediente, ni correo, ni nombre del otro.
    const texto = JSON.stringify(mismoPostulante.body);
    expect(texto).not.toContain(b.correo);
    expect(texto).not.toContain("ADM-");
    expect(texto).not.toMatch(new RegExp(`\\b${b.idExpediente}\\b`));
    expect(await filaPostulante(db(), a.idExpediente)).toMatchObject({ id_postulante: null, estado_expediente: "portal_habilitado" });
    expect(await transiciones(a.idExpediente)).toHaveLength(0);

    // El DNI de un padre ya registrado (apoderado) y el de un padre que coincide con un postulante (entre tablas).
    const mismoTitular = await e.como(a.token).guardar(rutaFicha(a.idExpediente), {
      ...cuerpoA,
      titular: { ...cuerpoA.titular, dni: cuerpoB.titular.dni },
    });
    expect(mismoTitular.status).toBe(409);
    expect(mismoTitular.body.error.detalle).toEqual([{ campo: "titular.dni", codigo: "DNI_YA_REGISTRADO" }]);
    const entreTablas = await e.como(a.token).guardar(rutaFicha(a.idExpediente), {
      ...cuerpoA,
      segundo_apoderado: { ...cuerpoA.segundo_apoderado, dni: cuerpoB.postulante.dni },
    });
    expect(entreTablas.status).toBe(409);
    expect(entreTablas.body.error.detalle).toEqual([{ campo: "segundo_apoderado.dni", codigo: "DNI_YA_REGISTRADO" }]);
    expect(await transiciones(a.idExpediente)).toHaveLength(0);
  });

  it("HU0005-2.0 [parte: borrador] (DNI duplicado) en un borrador el DNI repetido no se escribe, vuelve como pendiente y el resto se guarda", async () => {
    const e = await entorno();
    const b = await e.familia();
    const a = await e.familia();
    const cuerpoB = fichaCompleta();
    await e.como(b.token).guardar(rutaFicha(b.idExpediente), cuerpoB);

    const res = await e.como(a.token).guardar(
      rutaFicha(a.idExpediente),
      borrador({ postulante: { nombres: "Mateo", dni: cuerpoB.postulante.dni }, titular: { parentesco: "padre" } }),
    );

    expect(res.status).toBe(200);
    expect(res.body.pendientes).toContainEqual({ campo: "postulante.dni", codigo: "DNI_YA_REGISTRADO" });
    expect(await filaPostulante(db(), a.idExpediente)).toMatchObject({ nombres: "Mateo", dni_cifrado: null, dni_hash: null, estado_expediente: "en_postulacion" });

    // El DNI del titular que ya figura en otra ficha tampoco se escribe.
    const titular = await e.como(a.token).guardar(
      rutaFicha(a.idExpediente),
      borrador({ postulante: { nombres: "Mateo" }, titular: { parentesco: "padre", dni: cuerpoB.titular.dni } }),
    );
    expect(titular.status).toBe(200);
    expect(titular.body.pendientes).toContainEqual({ campo: "titular.dni", codigo: "DNI_YA_REGISTRADO" });
    const { rows: [t] } = await db().query("SELECT dni_cifrado, dni_hash, id_apoderado FROM apoderado WHERE id_apoderado = $1", [a.idApoderado]);
    expect(t).toMatchObject({ dni_cifrado: null, dni_hash: null });
  });

  it("HU0005-1.0 (DNI duplicado) el mismo DNI en dos campos de la misma ficha se rechaza con 400", async () => {
    const e = await entorno();
    const f = await e.familia();
    const cuerpo = fichaCompleta();

    const res = await e.como(f.token).guardar(rutaFicha(f.idExpediente), { ...cuerpo, titular: { ...cuerpo.titular, dni: cuerpo.postulante.dni } });

    expect(res.status).toBe(400);
    expect(res.body.error.detalle).toEqual([{ campo: "titular.dni", codigo: "DNI_REPETIDO_EN_FICHA" }]);
  });

  it("HU0005-1.0 (DNI duplicado) dos familias que completan la ficha con el mismo DNI a la vez: una se guarda y la otra recibe 409, sin error 500", async () => {
    const e = await entorno();
    for (let intento = 0; intento < 5; intento++) {
      const familias = [await e.familia(), await e.familia()];
      const dni = dniNuevo();

      const respuestas = await Promise.all(
        familias.map((f) => {
          const c = fichaCompleta();
          return e.como(f.token).guardar(rutaFicha(f.idExpediente), { ...c, postulante: { ...c.postulante, dni } });
        }),
      );

      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
      const perdedora = respuestas.findIndex((r) => r.status === 409);
      expect(respuestas[perdedora]!.body.error.codigo).toBe("DNI_YA_REGISTRADO");
      expect((await db().query("SELECT count(*)::int AS n FROM postulante WHERE dni_hash = $1", [hashDni(dni)])).rows[0].n).toBe(1);
      // La que perdió queda como estaba: ni postulante ni transición (la transacción se revierte entera).
      expect(await filaPostulante(db(), familias[perdedora]!.idExpediente)).toMatchObject({ id_postulante: null, estado_expediente: "portal_habilitado" });
      expect(await transiciones(familias[perdedora]!.idExpediente)).toHaveLength(0);
    }
  });

  it("HU0005-2.0 [parte: borrador] (DNI duplicado) dos borradores con el mismo DNI a la vez no producen error 500 y el DNI queda en una sola ficha", async () => {
    const e = await entorno();
    for (let intento = 0; intento < 5; intento++) {
      const familias = [await e.familia(), await e.familia()];
      const dni = dniNuevo();

      const respuestas = await Promise.all(
        familias.map((f) => e.como(f.token).guardar(rutaFicha(f.idExpediente), borrador({ postulante: { nombres: "Mateo", dni } }))),
      );

      for (const r of respuestas) expect([200, 409]).toContain(r.status); // 200 con el DNI pendiente, o 409 si chocaron al escribir
      expect(respuestas.some((r) => r.status === 200)).toBe(true);
      expect((await db().query("SELECT count(*)::int AS n FROM postulante WHERE dni_hash = $1", [hashDni(dni)])).rows[0].n).toBe(1);
    }
  });
});

describe("HU0005-2.0 guardados simultáneos del mismo expediente", () => {
  it("HU0005-2.0 [parte: borrador] dos guardados simultáneos del mismo expediente: ninguno falla y queda uno de los dos completo", async () => {
    const e = await entorno();
    const f = await e.familia();
    const ruta = rutaFicha(f.idExpediente);
    const variante = (n: string, parentesco: string) => ({
      modo: "borrador",
      postulante: { nombres: `Nombre${n}`, apellido_paterno: `Apellido${n}`, dni: dniNuevo() },
      titular: { parentesco, dni: dniNuevo() },
      respuestas: { p1: `respuesta ${n}` },
    });
    const huella = (c: ReturnType<typeof variante>) => ({
      nombres: c.postulante.nombres,
      apellido: c.postulante.apellido_paterno,
      dni: c.postulante.dni,
      parentesco: c.titular.parentesco,
      dniTitular: c.titular.dni,
      p1: c.respuestas.p1,
    });

    for (let i = 0; i < 5; i++) {
      const x = variante(`X${i}`, "madre");
      const y = variante(`Y${i}`, "padre");

      const [rx, ry] = await Promise.all([e.como(f.token).guardar(ruta, x), e.como(f.token).guardar(ruta, y)]);

      expect([rx.status, ry.status]).toEqual([200, 200]);
      const l = (await e.como(f.token).ver(ruta)).body;
      const guardado = {
        nombres: l.postulante.nombres,
        apellido: l.postulante.apellido_paterno,
        dni: l.postulante.dni,
        parentesco: l.titular.parentesco,
        dniTitular: l.titular.dni,
        p1: l.cuestionario.respuestas.p1,
      };
      expect([huella(x), huella(y)]).toContainEqual(guardado); // nunca una mezcla de los dos
    }
    expect(await transiciones(f.idExpediente)).toHaveLength(1);
  });
});
