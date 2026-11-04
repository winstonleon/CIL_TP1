// HU0007 (P07b, /familia): 1.0 registro del comprobante del derecho de admisión (S/ 300, R16) con su constancia en pantalla
// y el pago pendiente de Tesorería; 2.0 un número de operación ya registrado para el mismo banco se bloquea (R19 por banco,
// P1 a). Más la autorización y el tipo y tamaño del comprobante. Datos ficticios @ejemplo.test.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { BANCOS } from "../src/services/derechoAdmision";
import { crearFirmante, eventosDe, unico } from "./ayudantes";
import { archivosAlmacenados, exe, familiaConFicha, MiB, pdf, pdfDe, rutaDerecho, subir, subirCrudo, zip } from "./ayudantesCarga";
import { entornoFicha } from "./ayudantesFicha";

const db = () => obtenerPool();
let firmante: Awaited<ReturnType<typeof crearFirmante>>;

beforeAll(async () => {
  firmante = await crearFirmante();
});
afterAll(cerrarPool);

const MENSAJE = "Solo se aceptan archivos PDF, JPG o PNG de hasta 10 MB";
const [BANCO_1, BANCO_2] = BANCOS;
const entorno = () => entornoFicha(db(), firmante);
const pagosDe = async (idExpediente: number) => (await db().query("SELECT * FROM pago WHERE id_expediente = $1", [idExpediente])).rows;
const operacion = () => `OP-${unico()}`;
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const datos = (cambios: Record<string, string> = {}) => ({ banco: BANCO_1, numero_operacion: operacion(), fecha_pago: "2026-10-10", ...cambios });

describe("HU0007-1.0 registro conforme del comprobante de pago de postulación", () => {
  it("HU0007-1.0 registra el comprobante: Pago de S/ 300 pendiente de Tesorería, archivo cifrado y constancia con el código del modelo", async () => {
    const e = await entorno();
    const f = await familiaConFicha(db(), e);
    const campos = datos({ numero_operacion: ` ${operacion()} ` });
    const archivos = (await archivosAlmacenados()).length;

    const res = await subir(e.app, rutaDerecho(f.idExpediente), f.token, campos, pdf("voucher ficticio"), "voucher.pdf");

    expect(res.status).toBe(201);
    const [pago] = await pagosDe(f.idExpediente);
    expect(pago).toMatchObject({
      tipo_pago: "derecho_admision", numero_fraccion: 1, monto: "300.00", banco: BANCO_1, estado_validacion: "pendiente",
      numero_operacion: campos.numero_operacion.trim(), id_personal_validador: null, motivo_observacion: null,
    });
    const codigo = `ADM-${e.campana}-${String(f.idExpediente).padStart(4, "0")}`;
    expect(res.body).toEqual({
      codigo: `CONST-${codigo}-${pago.id_pago}`,
      expediente: codigo,
      postulante: "Sofía Valentina Quispe Rojas",
      concepto: "Derecho de admisión",
      monto: 300,
      banco: BANCO_1,
      numero_operacion: campos.numero_operacion.trim(),
      fecha_pago: "2026-10-10",
      registrado_en: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      estado: "pendiente",
    });

    // El comprobante está en el almacenamiento, cifrado, y el pago guarda solo su clave.
    expect(pago.comprobante_url).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect((await archivosAlmacenados()).length).toBe(archivos + 1);
    const crudo = await readFile(join(process.env.STORAGE_LOCAL_DIR!, pago.comprobante_url));
    expect(crudo.subarray(0, 4).toString()).toBe("CILF");
    expect(crudo.includes(Buffer.from("voucher ficticio"))).toBe(false);

    // Las validaciones siguen pendientes y el expediente no cambia de estado (R9: las valida Tesorería, HU0008).
    expect((await db().query("SELECT estado::text, estado_financiero::text AS fin, estado_documental::text AS doc FROM expediente WHERE id_expediente = $1", [f.idExpediente])).rows[0])
      .toEqual({ estado: "en_postulacion", fin: "pendiente", doc: "pendiente" });
    expect(e.eventos.disparar).not.toHaveBeenCalled();
  });

  it("HU0007-1.0 antes del registro P07b recibe el monto, los bancos y la cuenta; después recibe la constancia sin la hora de registro", async () => {
    const e = await entorno();
    const f = await familiaConFicha(db(), e);
    const ver = () => request(e.app).get(rutaDerecho(f.idExpediente)).set("Authorization", `Bearer ${f.token}`);

    const antes = await ver();
    expect(antes.status).toBe(200);
    expect(antes.body).toEqual({
      version: "borrador-1", monto: 300, bancos: [...BANCOS], cuenta_colegio: "[Banco y N.º de cuenta del colegio]", registrable: true, pago: null,
    });

    const registro = await subir(e.app, rutaDerecho(f.idExpediente), f.token, datos(), pdf());
    const despues = await ver();
    expect(despues.body).toMatchObject({ registrable: false, pago: { ...registro.body, registrado_en: null } });
  });

  it("HU0007-1.0 valida los campos con 400: banco fuera de la lista, fecha inválida o futura, número vacío, campos de más", async () => {
    const e = await entorno();
    const f = await familiaConFicha(db(), e);
    const manana = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
    const archivos = (await archivosAlmacenados()).length;

    const invalidos = [
      datos({ banco: "BCP" }),
      datos({ banco: "" }),
      datos({ fecha_pago: "2026-02-30" }),
      datos({ fecha_pago: "10/10/2026" }),
      datos({ fecha_pago: manana > hoy() ? manana : "2999-01-01" }),
      datos({ numero_operacion: "   " }),
      datos({ numero_operacion: "9".repeat(41) }),
      { ...datos(), monto: "1" },
    ];
    for (const campos of invalidos) {
      const res = await subir(e.app, rutaDerecho(f.idExpediente), f.token, campos, pdf());
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
    }
    const sinArchivo = await request(e.app).post(rutaDerecho(f.idExpediente)).set("Authorization", `Bearer ${f.token}`).field("banco", BANCO_1);
    expect(sinArchivo.status).toBe(400);
    expect(await pagosDe(f.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  });

  it("HU0007-1.0 un segundo comprobante en el mismo expediente da 409 DERECHO_YA_REGISTRADO y no deja archivo", async () => {
    const e = await entorno();
    const f = await familiaConFicha(db(), e);
    await subir(e.app, rutaDerecho(f.idExpediente), f.token, datos(), pdf());
    const archivos = (await archivosAlmacenados()).length;

    const otro = await subir(e.app, rutaDerecho(f.idExpediente), f.token, datos(), pdf());
    expect(otro.status).toBe(409);
    expect(otro.body.error.codigo).toBe("DERECHO_YA_REGISTRADO");
    expect(await pagosDe(f.idExpediente)).toHaveLength(1);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  });

  it("HU0007-1.0 solo se registra en en_postulacion: antes de la ficha da 409 DERECHO_NO_REGISTRABLE", async () => {
    const e = await entorno();
    const f = await e.familia(); // portal_habilitado
    const res = await subir(e.app, rutaDerecho(f.idExpediente), f.token, datos(), pdf());
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("DERECHO_NO_REGISTRABLE");
    expect(await pagosDe(f.idExpediente)).toHaveLength(0);
  });

  it("HU0007-1.0 rechaza un comprobante que no es PDF, JPG ni PNG (415) o pasa de 10 MB (413), sin pago y sin archivo", async () => {
    const e = await entorno();
    const f = await familiaConFicha(db(), e);
    const archivos = (await archivosAlmacenados()).length;

    for (const contenido of [zip(), exe()]) {
      const res = await subir(e.app, rutaDerecho(f.idExpediente), f.token, datos(), contenido, "voucher.pdf");
      expect(res.status).toBe(415);
      expect(res.body).toEqual({ error: { codigo: "FORMATO_NO_ADMITIDO", mensaje: MENSAJE } });
    }
    const grande = await subir(e.app, rutaDerecho(f.idExpediente), f.token, datos(), pdfDe(10 * MiB + 1));
    expect(grande.status).toBe(413);
    const cortado = await subirCrudo(e.app, rutaDerecho(f.idExpediente), f.token, { campos: datos(), bytesArchivo: 30 * MiB });
    expect(cortado.status).toBe(413);
    expect(cortado.cuerpo.error?.codigo).toBe("ARCHIVO_DEMASIADO_GRANDE");
    expect(await pagosDe(f.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
  }, 60_000);

  it("HU0007-1.0 (autorización) la familia A no ve ni registra el derecho de admisión del expediente de B: 404 y auditado", async () => {
    const e = await entorno();
    const a = await familiaConFicha(db(), e);
    const b = await familiaConFicha(db(), e);
    const archivos = (await archivosAlmacenados()).length;

    const lectura = await request(e.app).get(rutaDerecho(b.idExpediente)).set("Authorization", `Bearer ${a.token}`);
    const escritura = await subir(e.app, rutaDerecho(b.idExpediente), a.token, datos(), pdf());
    for (const res of [lectura, escritura]) {
      expect(res.status).toBe(404);
      expect(res.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");
    }
    expect(await pagosDe(b.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
    const denegados = (await eventosDe(db(), b.idExpediente)).filter((ev) => ev.tipo_evento === "acceso_denegado");
    expect(denegados.map((ev) => ev.detalle.metodo).sort()).toEqual(["GET", "POST"]);
  });
});

describe("HU0007-2.0 registro con número de operación duplicado", () => {
  it("HU0007-2.0 bloquea el mismo número en el mismo banco de otro expediente: 409 COMPROBANTE_DUPLICADO, sin pago, sin archivo y sin datos del otro", async () => {
    const e = await entorno();
    const a = await familiaConFicha(db(), e);
    const b = await familiaConFicha(db(), e);
    const campos = datos();
    expect((await subir(e.app, rutaDerecho(a.idExpediente), a.token, campos, pdf("de A"))).status).toBe(201);
    const archivos = (await archivosAlmacenados()).length;

    // También con espacios en los extremos: el número se compara recortado.
    const res = await subir(e.app, rutaDerecho(b.idExpediente), b.token, { ...campos, numero_operacion: ` ${campos.numero_operacion} ` }, pdf("de B"));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        codigo: "COMPROBANTE_DUPLICADO",
        mensaje: "Este comprobante ya fue registrado. Revisa el N.° de operación.",
        detalle: { campo: "numero_operacion" },
      },
    });
    expect(await pagosDe(b.idExpediente)).toHaveLength(0);
    expect((await archivosAlmacenados()).length).toBe(archivos);
    // No revela el otro expediente.
    expect(res.text).not.toContain(`ADM-${e.campana}-${String(a.idExpediente).padStart(4, "0")}`);
    // B puede corregir el número y registrar.
    const corregido = await subir(e.app, rutaDerecho(b.idExpediente), b.token, { ...campos, numero_operacion: operacion() }, pdf("de B"));
    expect(corregido.status).toBe(201);
  });

  it("HU0007-2.0 el mismo número en otro banco es otro comprobante y se registra (R19 por banco)", async () => {
    const e = await entorno();
    const a = await familiaConFicha(db(), e);
    const b = await familiaConFicha(db(), e);
    const numero = operacion();

    expect((await subir(e.app, rutaDerecho(a.idExpediente), a.token, datos({ banco: BANCO_1, numero_operacion: numero }), pdf())).status).toBe(201);
    expect((await subir(e.app, rutaDerecho(b.idExpediente), b.token, datos({ banco: BANCO_2, numero_operacion: numero }), pdf())).status).toBe(201);
  });

  it("HU0007-2.0 dos registros simultáneos del mismo comprobante: uno se registra, el otro recibe 409 y no deja archivo", async () => {
    const e = await entorno();
    const a = await familiaConFicha(db(), e);
    const b = await familiaConFicha(db(), e);
    const campos = datos();
    const archivos = (await archivosAlmacenados()).length;

    const [ra, rb] = await Promise.all([
      subir(e.app, rutaDerecho(a.idExpediente), a.token, campos, pdf("de A")),
      subir(e.app, rutaDerecho(b.idExpediente), b.token, campos, pdf("de B")),
    ]);

    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const perdedor = ra.status === 409 ? ra : rb;
    expect(perdedor.body.error.codigo).toBe("COMPROBANTE_DUPLICADO");
    expect((await pagosDe(a.idExpediente)).length + (await pagosDe(b.idExpediente)).length).toBe(1);
    expect((await archivosAlmacenados()).length).toBe(archivos + 1);
  });
});
