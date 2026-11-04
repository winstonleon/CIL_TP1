// HU0006 (P06, /familia, solo el rol familia y solo su propio expediente): 1.0 carga de cada documento en PDF, JPG o PNG,
// asociado a su requisito, y «Confirmar documentos» que solicita la verificación de completitud; 2.0 rechazo de un formato
// o un tamaño no admitidos. Más la autorización (404 al ajeno, ADR-20), el tipo falsificado y el corte a los 10 MB.
// Los archivos van a un directorio temporal y se guardan cifrados (ADR-03, ADR-21). Datos ficticios @ejemplo.test.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { crearFirmante, eventosDe } from "./ayudantes";
import {
  archivosAlmacenados, exe, jpg, MiB, pdf, pdfDe, png, rutaArchivo, rutaConfirmacion, rutaDocumentos, familiaConFicha, subir, subirCrudo,
  zip,
} from "./ayudantesCarga";
import { entornoFicha, fichaCompleta, requisito } from "./ayudantesFicha";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

const MENSAJE = "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB";
const entorno = () => entornoFicha(db(), firmante);
const filas = async (idExpediente: number) =>
  (await db().query("SELECT * FROM documento WHERE id_expediente = $1 ORDER BY id_documento", [idExpediente])).rows;
const transiciones = async (idExpediente: number) => (await eventosDe(db(), idExpediente)).filter((ev) => ev.tipo_evento === "transicion_estado");

// Los requisitos que usan casi todas las pruebas: uno general, uno de colegio peruano y uno financiero por apoderado.
async function requisitosBase(idGrado: number) {
  return {
    partida: await requisito(db(), idGrado, "Partida de nacimiento", "todos"),
    dni: await requisito(db(), idGrado, "DNI del postulante", "todos"),
    certificado: await requisito(db(), idGrado, "Certificado de estudios", "solo_colegio_peruano", { categoria: "colegio_procedencia" }),
    boletas: await requisito(db(), idGrado, "Boletas de pago", "si_dependiente", { categoria: "financiero", porApoderado: true }),
  };
}

async function familiaLista(e: Awaited<ReturnType<typeof entorno>>) {
  let ids!: Awaited<ReturnType<typeof requisitosBase>>;
  const f = await familiaConFicha(db(), e, async (g) => {
    ids = await requisitosBase(g);
  });
  return { e, f, ids };
}

describe("HU0006-1.0 carga exitosa del legajo documental digital", () => {
  it("HU0006-1.0 sube un PDF, un JPG y un PNG, cada uno asociado a su requisito, cifrado y sin cambiar el estado del expediente", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const antes = (await archivosAlmacenados()).length;
    const contenidos = [
      { id: ids.partida, bytes: pdf("partida ficticia"), formato: "pdf" },
      { id: ids.dni, bytes: jpg(), formato: "jpg" },
      { id: ids.certificado, bytes: png(), formato: "png" },
    ];

    for (const c of contenidos) {
      const res = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: c.id }, c.bytes, "nombre-original.exe");
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id_documento: expect.any(Number), formato: c.formato, tamano_kb: 1, fecha_carga: expect.any(String) });
    }

    const guardados = await filas(f.idExpediente);
    expect(guardados.map((d) => d.formato)).toEqual(["pdf", "jpg", "png"]);
    for (const [i, d] of guardados.entries()) {
      expect(d).toMatchObject({ id_requisito: contenidos[i]!.id, id_apoderado: null, vigente: true, estado_verificacion: "pendiente" });
      // url_archivo guarda la clave del almacenamiento: un UUID, no el nombre original (ADR-21).
      expect(d.url_archivo).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(d.url_archivo).not.toContain("nombre-original");
    }
    // El archivo está en el almacenamiento, cifrado: no contiene el texto del documento.
    expect((await archivosAlmacenados()).length).toBe(antes + 3);
    const crudo = await readFile(join(process.env.STORAGE_LOCAL_DIR!, guardados[0]!.url_archivo));
    expect(crudo.subarray(0, 4).toString()).toBe("CILF");
    expect(crudo.includes(Buffer.from("partida ficticia"))).toBe(false);

    expect((await db().query("SELECT estado::text FROM expediente WHERE id_expediente = $1", [f.idExpediente])).rows[0].estado).toBe("en_postulacion");
    // Los archivos nunca pasan por n8n: la carga no dispara ningún evento (ADR-21).
    expect(e.eventos.disparar).not.toHaveBeenCalled();
  });

  it("HU0006-1.0 un requisito por apoderado se asocia al apoderado y admite varios archivos (tres boletas)", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const ruta = rutaDocumentos(f.idExpediente);

    // R7: solo el titular es dependiente, así que las boletas se exigen solo a él.
    const ajeno = await subir(e.app, ruta, f.token, { id_requisito: ids.boletas, id_apoderado: f.idSegundoApoderado }, pdf());
    expect(ajeno.status).toBe(400);
    const sinApoderado = await subir(e.app, ruta, f.token, { id_requisito: ids.boletas }, pdf());
    expect(sinApoderado.status).toBe(400);
    const deMas = await subir(e.app, ruta, f.token, { id_requisito: ids.partida, id_apoderado: f.idApoderado }, pdf());
    expect(deMas.status).toBe(400);

    for (const mes of ["jun", "jul", "ago"]) {
      const res = await subir(e.app, ruta, f.token, { id_requisito: ids.boletas, id_apoderado: f.idApoderado }, pdf(`boleta ${mes}`));
      expect(res.status).toBe(201);
    }
    const lista = await request(e.app).get(ruta).set("Authorization", `Bearer ${f.token}`);
    expect(lista.status).toBe(200);
    const boletas = lista.body.requisitos.find((r: { tipo_documento: string }) => r.tipo_documento === "Boletas de pago");
    expect(boletas).toMatchObject({ por_apoderado: true, id_apoderado: f.idApoderado, categoria: "financiero" });
    expect(boletas.documentos).toHaveLength(3);
    expect(lista.body).toMatchObject({ editable: true, confirmado_en: null });
    expect(lista.body.requisitos.filter((r: { documentos: unknown[] }) => r.documentos.length === 0)).toHaveLength(3);
  });

  it("HU0006-1.0 reemplazar un documento deja el anterior con vigente = false en la misma transacción y la lista solo muestra el nuevo", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const ruta = rutaDocumentos(f.idExpediente);
    const primero = await subir(e.app, ruta, f.token, { id_requisito: ids.partida }, pdf("versión 1"));
    const segundo = await subir(e.app, ruta, f.token, { id_requisito: ids.partida, reemplaza: primero.body.id_documento }, pdf("versión 2"));
    expect(segundo.status).toBe(201);

    const guardados = await filas(f.idExpediente);
    expect(guardados.map((d) => [d.id_documento, d.vigente])).toEqual([
      [primero.body.id_documento, false],
      [segundo.body.id_documento, true],
    ]);
    const lista = await request(e.app).get(ruta).set("Authorization", `Bearer ${f.token}`);
    const partida = lista.body.requisitos.find((r: { tipo_documento: string }) => r.tipo_documento === "Partida de nacimiento");
    expect(partida.documentos.map((d: { id_documento: number }) => d.id_documento)).toEqual([segundo.body.id_documento]);

    // Un documento reemplazado no se puede volver a reemplazar, ni uno de otro requisito, y la falla no deja filas ni archivos.
    const archivos = (await archivosAlmacenados()).length;
    for (const reemplaza of [primero.body.id_documento, 999_999_999]) {
      const mal = await subir(e.app, ruta, f.token, { id_requisito: ids.partida, reemplaza }, pdf());
      expect(mal.status).toBe(400);
    }
    const otroRequisito = await subir(e.app, ruta, f.token, { id_requisito: ids.dni, reemplaza: segundo.body.id_documento }, pdf());
    expect(otroRequisito.status).toBe(400);
    expect(await filas(f.idExpediente)).toHaveLength(2);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  });

  it("HU0006-1.0 «Confirmar documentos» solicita la verificación: deja el evento documentos_confirmados y no cambia el estado", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: ids.partida }, pdf());
    const transicionesAntes = (await transiciones(f.idExpediente)).length;

    const res = await request(e.app).post(rutaConfirmacion(f.idExpediente)).set("Authorization", `Bearer ${f.token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.confirmado_en).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const eventos = (await eventosDe(db(), f.idExpediente)).filter((ev) => ev.tipo_evento === "documentos_confirmados");
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ id_personal: null, detalle: { documentos_vigentes: 1 } });
    expect((await transiciones(f.idExpediente)).length).toBe(transicionesAntes);
    expect((await db().query("SELECT estado::text FROM expediente WHERE id_expediente = $1", [f.idExpediente])).rows[0].estado).toBe("en_postulacion");

    // P06 recuerda la confirmación, y HU0017 la toma de la bitácora (C44); la API no avisa a n8n en este bloque.
    const lista = await request(e.app).get(rutaDocumentos(f.idExpediente)).set("Authorization", `Bearer ${f.token}`);
    expect(lista.body.confirmado_en).toBe(res.body.confirmado_en);
    expect(e.eventos.disparar).not.toHaveBeenCalled();

    // El cuerpo no admite campos de más.
    const conCampo = await request(e.app).post(rutaConfirmacion(f.idExpediente)).set("Authorization", `Bearer ${f.token}`).send({ id_expediente: 1 });
    expect(conCampo.status).toBe(400);
  });

  it("HU0006-1.0 la descarga propia devuelve los mismos bytes con las cabeceras de un archivo no ejecutable", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const contenido = pdf("informe ficticio", 5000);
    const subida = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: ids.partida }, contenido);

    const res = await request(e.app)
      .get(rutaArchivo(f.idExpediente, subida.body.id_documento))
      .set("Authorization", `Bearer ${f.token}`)
      .buffer(true)
      .parse((r, cb) => {
        const trozos: Buffer[] = [];
        r.on("data", (t: Buffer) => trozos.push(t));
        r.on("end", () => cb(null, Buffer.concat(trozos)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).equals(contenido)).toBe(true);
    expect(res.headers).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="documento-${subida.body.id_documento}.pdf"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "no-store",
    });
  });

  it("HU0006-1.0 un archivo alterado en el almacenamiento no entrega ningún byte del contenido: 500 con solo el error", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const subida = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: ids.partida }, pdf("secreto de la familia", 3000));
    const ruta = join(process.env.STORAGE_LOCAL_DIR!, (await filas(f.idExpediente))[0]!.url_archivo);
    const original = await readFile(ruta);
    const alterado = Buffer.from(original);
    alterado[200] = alterado[200]! ^ 0x01;
    await writeFile(ruta, alterado);

    const res = await request(e.app).get(rutaArchivo(f.idExpediente, subida.body.id_documento)).set("Authorization", `Bearer ${f.token}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { codigo: "ARCHIVO_NO_DISPONIBLE", mensaje: "No se pudo leer el archivo" } });
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.text).not.toContain("secreto");
  });

  it("HU0006-1.0 (C25) un requisito creado por la ruta de G09 admite la carga", async () => {
    const e = await entorno();
    const f = await familiaConFicha(db(), e);
    const alta = await request(e.app)
      .post(`/configuracion/grados/${f.idGrado}/requisitos`)
      .set("Authorization", `Bearer ${e.tokenSecretaria}`)
      .send({ tipo_documento: "Constancia de matrícula", categoria: "colegio_procedencia", condicion_aplicacion: "solo_colegio_peruano" });
    expect(alta.status).toBe(201);

    const res = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: alta.body.id_requisito }, pdf());
    expect(res.status).toBe(201);
  });

  it("HU0006-1.0 sin la ficha completa no se listan ni se cargan documentos: 409 FICHA_INCOMPLETA", async () => {
    const e = await entorno();
    const f = await e.familia();
    const id = await requisito(db(), f.idGrado, "Partida de nacimiento", "todos");

    const lista = await request(e.app).get(rutaDocumentos(f.idExpediente)).set("Authorization", `Bearer ${f.token}`);
    const carga = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: id }, pdf());
    const confirma = await request(e.app).post(rutaConfirmacion(f.idExpediente)).set("Authorization", `Bearer ${f.token}`).send({});
    for (const res of [lista, carga, confirma]) {
      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe("FICHA_INCOMPLETA");
    }
    expect(await filas(f.idExpediente)).toHaveLength(0);
  });

  it("HU0006-1.0 fuera de en_postulacion no se carga ni se confirma: 409 DOCUMENTOS_NO_EDITABLES y sin archivo", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    await db().query("UPDATE expediente SET estado = 'en_validacion' WHERE id_expediente = $1", [f.idExpediente]);
    const archivos = (await archivosAlmacenados()).length;

    const carga = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: ids.partida }, pdf());
    const confirma = await request(e.app).post(rutaConfirmacion(f.idExpediente)).set("Authorization", `Bearer ${f.token}`).send({});
    for (const res of [carga, confirma]) {
      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe("DOCUMENTOS_NO_EDITABLES");
    }
    expect(await filas(f.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
    const lista = await request(e.app).get(rutaDocumentos(f.idExpediente)).set("Authorization", `Bearer ${f.token}`);
    expect(lista.body.editable).toBe(false);
  });

  it("HU0006-1.0 una carga mal armada se rechaza con 400: campos de más, sin archivo, archivo antes de los campos o sin multipart", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const ruta = rutaDocumentos(f.idExpediente);
    const archivos = (await archivosAlmacenados()).length;

    const campoDeMas = await subir(e.app, ruta, f.token, { id_requisito: ids.partida, id_expediente: 1 }, pdf());
    const requisitoInexistente = await subir(e.app, ruta, f.token, { id_requisito: 999_999_999 }, pdf());
    const sinRequisito = await subir(e.app, ruta, f.token, {}, pdf());
    const sinArchivo = await request(e.app).post(ruta).set("Authorization", `Bearer ${f.token}`).field("id_requisito", String(ids.partida));
    const archivoPrimero = await request(e.app)
      .post(ruta)
      .set("Authorization", `Bearer ${f.token}`)
      .attach("archivo", pdf(), { filename: "a.pdf", contentType: "application/pdf" })
      .field("id_requisito", String(ids.partida));
    const sinMultipart = await request(e.app).post(ruta).set("Authorization", `Bearer ${f.token}`).send({ id_requisito: ids.partida });

    for (const res of [campoDeMas, requisitoInexistente, sinRequisito, sinArchivo, archivoPrimero, sinMultipart]) {
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
    }
    expect(await filas(f.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  });

  it("HU0006-1.0 los requisitos condicionales (libreta del colegio de procedencia e informes de terapia) solo admiten carga si se declararon en la ficha", async () => {
    const e = await entorno();
    let libreta!: number;
    let informe!: number;
    const crear = async (g: number) => {
      libreta = await requisito(db(), g, "Libreta de notas", "solo_colegio_peruano", { categoria: "colegio_procedencia" });
      informe = await requisito(db(), g, "Informe de terapia", "solo_condicion_especial", { categoria: "condicion_especial" });
    };
    const declaro = await familiaConFicha(db(), e, crear, undefined, { postulante: { ...fichaCompleta().postulante, estudio_en_colegio_peruano: true, tiene_condicion_especial: true } });
    const noDeclaro = await familiaConFicha(db(), e, async () => undefined, declaro.idGrado, { postulante: { ...fichaCompleta().postulante, estudio_en_colegio_peruano: false, tiene_condicion_especial: false } });

    // Quien lo declaró sube la libreta y el informe, cada uno asociado a su requisito.
    for (const [id, formato] of [[libreta, "pdf"], [informe, "png"]] as const) {
      const res = await subir(e.app, rutaDocumentos(declaro.idExpediente), declaro.token, { id_requisito: id }, formato === "pdf" ? pdf() : png());
      expect(res.status).toBe(201);
    }
    expect((await filas(declaro.idExpediente)).map((d) => d.id_requisito)).toEqual([libreta, informe]);

    // Quien declaró lo contrario no los tiene en su lista (R7) y no puede subirlos.
    const archivos = (await archivosAlmacenados()).length;
    for (const id of [libreta, informe]) {
      const res = await subir(e.app, rutaDocumentos(noDeclaro.idExpediente), noDeclaro.token, { id_requisito: id }, pdf());
      expect(res.status).toBe(400);
    }
    const lista = await request(e.app).get(rutaDocumentos(noDeclaro.idExpediente)).set("Authorization", `Bearer ${noDeclaro.token}`);
    expect(lista.body.requisitos).toEqual([]);
    expect(await filas(noDeclaro.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  });

  it("HU0006-1.0 la clave del archivo la genera el servidor: un campo clave o url_archivo en la petición se rechaza con 400", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const ruta = rutaDocumentos(f.idExpediente);
    const archivos = (await archivosAlmacenados()).length;
    const impuesta = randomUUID();

    for (const campo of ["clave", "url_archivo", "ruta"]) {
      const res = await subir(e.app, ruta, f.token, { id_requisito: ids.partida, [campo]: impuesta }, pdf());
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
    }
    expect(await filas(f.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);

    const ok = await subir(e.app, ruta, f.token, { id_requisito: ids.partida }, pdf());
    expect(ok.status).toBe(201);
    expect((await filas(f.idExpediente))[0]!.url_archivo).not.toBe(impuesta);
  });

  it("HU0006-1.0 (tope técnico) un requisito admite 20 archivos vigentes: el 21.º da 409 LIMITE_DOCUMENTOS_REQUISITO, sin fila y sin archivo; reemplazar sí se puede", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const ruta = rutaDocumentos(f.idExpediente);
    let ultimo = 0;
    for (let i = 1; i <= 20; i++) {
      const res = await subir(e.app, ruta, f.token, { id_requisito: ids.partida }, pdf(`página ${i}`));
      expect(res.status).toBe(201);
      ultimo = res.body.id_documento;
    }
    const archivos = (await archivosAlmacenados()).length;

    const sobrante = await subir(e.app, ruta, f.token, { id_requisito: ids.partida }, pdf("página 21"));
    expect(sobrante.status).toBe(409);
    expect(sobrante.body.error).toEqual({
      codigo: "LIMITE_DOCUMENTOS_REQUISITO",
      mensaje: "Ya cargaste el máximo de 20 archivos para este documento. Reemplaza alguno en lugar de agregar más.",
      detalle: { maximo: 20 },
    });
    expect(await filas(f.idExpediente)).toHaveLength(20);
    expect((await archivosAlmacenados()).length).toBe(archivos);

    // Reemplazar no suma: sigue habiendo 20 vigentes. Otro requisito tiene su propio tope.
    const reemplazo = await subir(e.app, ruta, f.token, { id_requisito: ids.partida, reemplaza: ultimo }, pdf("página 20 corregida"));
    expect(reemplazo.status).toBe(201);
    expect((await filas(f.idExpediente)).filter((d) => d.vigente)).toHaveLength(20);
    const otro = await subir(e.app, ruta, f.token, { id_requisito: ids.dni }, pdf());
    expect(otro.status).toBe(201);
  }, 60_000);
});

describe("HU0006-2.0 carga de un archivo con formato o tamaño no soportado", () => {
  it("HU0006-2.0 rechaza un ZIP y un XLSX con 415, el mensaje de formatos admitidos, sin fila y sin archivo", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const archivos = (await archivosAlmacenados()).length;

    // Un XLSX es un ZIP: la firma lo delata aunque se llame .pdf y el Content-Type diga application/pdf.
    for (const nombre of ["comprimido.zip", "hoja.xlsx", "disfrazado.pdf"]) {
      const res = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: ids.partida }, zip(), nombre);
      expect(res.status).toBe(415);
      expect(res.body).toEqual({ error: { codigo: "FORMATO_NO_ADMITIDO", mensaje: MENSAJE } });
    }
    expect(await filas(f.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  });

  it("HU0006-2.0 un .exe renombrado a .pdf con Content-Type application/pdf se rechaza por su contenido, y un archivo vacío también", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const archivos = (await archivosAlmacenados()).length;

    const ejecutable = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: ids.partida }, exe(), "factura.pdf");
    const vacio = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: ids.partida }, Buffer.alloc(0), "vacio.pdf");
    for (const res of [ejecutable, vacio]) {
      expect(res.status).toBe(415);
      expect(res.body.error).toEqual({ codigo: "FORMATO_NO_ADMITIDO", mensaje: MENSAJE });
    }
    expect(await filas(f.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);

    // Lo contrario: un PDF verdadero se acepta aunque se llame .exe (el formato sale del contenido, no del nombre).
    const verdadero = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: ids.partida }, pdf(), "nombre.exe");
    expect(verdadero.status).toBe(201);
    expect(verdadero.body.formato).toBe("pdf");
  });

  it("HU0006-2.0 acepta un archivo de exactamente 10 MB y rechaza uno de 10 MB + 1 byte con 413, sin fila y sin archivo", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const ruta = rutaDocumentos(f.idExpediente);

    const justo = await subir(e.app, ruta, f.token, { id_requisito: ids.partida }, pdfDe(10 * MiB));
    expect(justo.status).toBe(201);
    expect(justo.body.tamano_kb).toBe(10 * 1024);

    const archivos = (await archivosAlmacenados()).length;
    const pasado = await subir(e.app, ruta, f.token, { id_requisito: ids.dni }, pdfDe(10 * MiB + 1));
    expect(pasado.status).toBe(413);
    expect(pasado.body).toEqual({ error: { codigo: "ARCHIVO_DEMASIADO_GRANDE", mensaje: MENSAJE } });
    expect(await filas(f.idExpediente)).toHaveLength(1);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  });

  it("HU0006-2.0 una carga sin Content-Length de más de 10 MB se corta mientras se recibe: 413, sin fila y sin archivo", async () => {
    const { e, f, ids } = await familiaLista(await entorno());
    const archivos = (await archivosAlmacenados()).length;

    const res = await subirCrudo(e.app, rutaDocumentos(f.idExpediente), f.token, { campos: { id_requisito: ids.partida }, bytesArchivo: 40 * MiB });
    expect(res.status).toBe(413);
    expect(res.cuerpo.error?.codigo).toBe("ARCHIVO_DEMASIADO_GRANDE");
    expect(await filas(f.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  }, 60_000);

  it("HU0006-2.0 un Content-Length declarado de más de 10 MB se rechaza con 413 antes de leer el cuerpo", async () => {
    const { e, f, ids } = await familiaLista(await entorno());

    // Se declaran 50 MB y solo se envían unos bytes: si la API esperara el cuerpo, la prueba no recibiría respuesta.
    const res = await subirCrudo(e.app, rutaDocumentos(f.idExpediente), f.token, {
      campos: { id_requisito: ids.partida },
      bytesArchivo: 1024,
      contentLength: 50 * MiB,
    });
    expect(res.status).toBe(413);
    expect(res.cuerpo.error?.codigo).toBe("ARCHIVO_DEMASIADO_GRANDE");
    expect(await filas(f.idExpediente)).toHaveLength(0);
  });
});

describe("HU0006-1.0 autorización: la familia solo carga y descarga sus propios documentos", () => {
  it("HU0006-1.0 (autorización) la familia A no lista, carga, confirma ni descarga en el expediente de B: 404 y auditado, sin cambios", async () => {
    const e = await entorno();
    const a = await familiaConFicha(db(), e);
    const b = await familiaConFicha(db(), e);
    const idPartida = await requisito(db(), b.idGrado, "Partida de nacimiento", "todos");
    const deB = await subir(e.app, rutaDocumentos(b.idExpediente), b.token, { id_requisito: idPartida }, pdf("de B"));
    const archivos = (await archivosAlmacenados()).length;
    const comoA = (r: request.Test) => r.set("Authorization", `Bearer ${a.token}`);

    const { rows: [{ maximo }] } = await db().query("SELECT max(id_expediente) AS maximo FROM expediente");
    const inexistente = await comoA(request(e.app).get(rutaDocumentos(maximo + 1_000_000)));
    expect(inexistente.status).toBe(404);

    const respuestas = [
      await comoA(request(e.app).get(rutaDocumentos(b.idExpediente))),
      await subir(e.app, rutaDocumentos(b.idExpediente), a.token, { id_requisito: idPartida }, pdf("intruso")),
      await comoA(request(e.app).post(rutaConfirmacion(b.idExpediente)).send({})),
      await comoA(request(e.app).get(rutaArchivo(b.idExpediente, deB.body.id_documento))),
    ];
    for (const res of respuestas) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(inexistente.body); // mismo cuerpo: no confirma que el id exista
    }
    expect(inexistente.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");

    expect(await filas(b.idExpediente)).toHaveLength(1);
    expect((await archivosAlmacenados()).length).toBe(archivos);
    expect((await eventosDe(db(), b.idExpediente)).filter((ev) => ev.tipo_evento === "documentos_confirmados")).toHaveLength(0);
    const denegados = (await eventosDe(db(), b.idExpediente)).filter((ev) => ev.tipo_evento === "acceso_denegado");
    expect(denegados.map((ev) => ev.detalle.metodo).sort()).toEqual(["GET", "GET", "POST", "POST"]);
    for (const ev of denegados) expect(ev.detalle).toMatchObject({ keycloak_user_id: a.sub, motivo: "expediente_ajeno" });
  });

  it("HU0006-1.0 (autorización) un documento de B pedido con el id del expediente de A da 404 y se audita; uno inexistente, el mismo 404 sin evento", async () => {
    const e = await entorno();
    const a = await familiaConFicha(db(), e);
    const b = await familiaConFicha(db(), e);
    const idPartida = await requisito(db(), b.idGrado, "Partida de nacimiento", "todos");
    const deB = await subir(e.app, rutaDocumentos(b.idExpediente), b.token, { id_requisito: idPartida }, pdf("de B"));
    const pedir = (id: number | string) => request(e.app).get(rutaArchivo(a.idExpediente, id)).set("Authorization", `Bearer ${a.token}`);

    const ajeno = await pedir(deB.body.id_documento);
    const inexistente = await pedir(999_999_999);
    const malFormado = await pedir("1abc");
    for (const res of [ajeno, inexistente, malFormado]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { codigo: "DOCUMENTO_NO_ENCONTRADO", mensaje: "El documento no existe" } });
    }
    const denegados = (await eventosDe(db(), a.idExpediente)).filter((ev) => ev.tipo_evento === "acceso_denegado");
    expect(denegados).toHaveLength(1);
    expect(denegados[0]!.detalle).toMatchObject({ keycloak_user_id: a.sub, motivo: "documento_ajeno", roles_requeridos: ["familia"] });
  });

  it("HU0006-1.0 (autorización) sin token 401; el personal (secretaría, tesorería) no descarga por /familia: 403 y auditado", async () => {
    const e = await entorno();
    const f = await familiaConFicha(db(), e, async (g) => {
      await requisito(db(), g, "Boletas de pago", "todos", { categoria: "financiero" });
    });
    const { rows } = await db().query("SELECT id_requisito FROM requisito_documental WHERE id_grado = $1", [f.idGrado]);
    const subida = await subir(e.app, rutaDocumentos(f.idExpediente), f.token, { id_requisito: rows[0].id_requisito }, pdf("financiero"));

    const sinToken = await request(e.app).get(rutaArchivo(f.idExpediente, subida.body.id_documento));
    expect(sinToken.status).toBe(401);

    // R2: la documentación financiera solo la ve Tesorería, y no por las rutas de la familia. HU0008 define la del personal.
    for (const rol of ["secretaria", "tesoreria"]) {
      const sub = randomUUID();
      const res = await request(e.app).get(rutaArchivo(f.idExpediente, subida.body.id_documento)).set("Authorization", `Bearer ${await firmante.token(sub, [rol])}`);
      expect(res.status).toBe(403);
      expect(res.body.error.codigo).toBe("ACCESO_DENEGADO");
      const { rowCount } = await db().query("SELECT 1 FROM registro_auditoria WHERE tipo_evento = 'acceso_denegado' AND detalle->>'keycloak_user_id' = $1", [sub]);
      expect(rowCount).toBe(1);
    }
  });
});
