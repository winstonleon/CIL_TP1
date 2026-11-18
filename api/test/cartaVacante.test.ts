// Carta de Vacante (HU0016; R18 y C62) por las rutas reales de Tesorería (G05), n8n (/internal), la directora (G07) y la
// familia (P04). El PDF se lee con pdfjs-dist: se prueba lo que ve quien abre la carta. Datos ficticios @ejemplo.test; n8n se simula.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Almacenamiento } from "../src/almacenamiento";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { cargarFirma, emitirCarta, MAXIMO_BYTES_FIRMA } from "../src/services/cartaVacante";
import { crearFirmante, crearPersonal, eventosDe, unico } from "./ayudantes";
import { rutaCuota } from "./ayudantesAdjudicacion";
import { archivosAlmacenados, MiB, pdf, png } from "./ayudantesCarga";
import { correoDe, entornoCarta, leerPdf, pngFirma, POSTULANTE, rutaCartaDireccion, rutaCartaFamilia } from "./ayudantesCarta";
import { CONFORME, observar, rutaDecisionPago } from "./ayudantesValidacion";
import { estadoDe, intentadaHace, intentosDe } from "./ayudantesVisita";

const db = () => obtenerPool();
let e: Awaited<ReturnType<typeof entornoCarta>>;

beforeAll(async () => {
  e = await entornoCarta(db(), await crearFirmante());
});
afterAll(cerrarPool);

const cartas = async (id: number) =>
  (await db().query<{ id_carta: number; id_personal_autoriza: number; url_documento: string }>("SELECT * FROM carta_vacante WHERE id_expediente = $1", [id])).rows;
const transicionesACarta = async (id: number) => (await eventosDe(db(), id)).filter((ev) => ev.tipo_evento === "transicion_estado" && ev.estado_nuevo === "carta_emitida");
const descargar = async (f: { idExpediente: number; token: string }) => {
  const res = await request(e.app)
    .get(rutaCartaFamilia(f.idExpediente))
    .set("Authorization", `Bearer ${f.token}`)
    .buffer(true)
    .parse((r, listo) => {
      const partes: Buffer[] = [];
      r.on("data", (p: Buffer) => partes.push(p));
      r.on("end", () => listo(null, Buffer.concat(partes)));
    });
  return res;
};
const sinEfectos = async (id: number, archivosAntes: number) => {
  expect(await cartas(id)).toEqual([]);
  expect(await estadoDe(db(), id)).toBe("vacante_asignada");
  expect(await transicionesACarta(id)).toEqual([]);
  expect(await intentosDe(db(), id, "carta_emitida")).toEqual([]);
  expect((await archivosAlmacenados()).length).toBe(archivosAntes);
};

describe("HU0016-1.0 generación y despacho de la Carta de Vacante", () => {
  it("HU0016-1.0 con la cuota conciliada genera la carta con los datos del menor, el grado y la firma, y el expediente queda en carta_emitida en la misma operación", async () => {
    const { f } = await e.conciliada({ monto: 4000, nivel: "secundaria" });

    const res = await e.cartaN8n.emitir(f.idExpediente);

    expect(res.status).toBe(201);
    expect(await estadoDe(db(), f.idExpediente)).toBe("carta_emitida");
    const [carta] = await cartas(f.idExpediente);
    expect(carta).toMatchObject({ id_personal_autoriza: e.directora });
    const [transicion] = await transicionesACarta(f.idExpediente);
    expect(transicion).toMatchObject({ estado_anterior: "vacante_asignada", id_personal: null, detalle: { campo: "estado", id_carta: carta!.id_carta } });

    const pdfCarta = await leerPdf((await descargar(f)).body as Buffer);
    expect(pdfCarta.texto).toContain(`${POSTULANTE.nombres} ${POSTULANTE.paterno} ${POSTULANTE.materno}`);
    expect(pdfCarta.texto).toContain("Secundaria");
    expect(pdfCarta.texto).toContain("3.° de primaria"); // el nombre del grado de la fixture
    expect(pdfCarta.texto).toContain("CARTA-ADM-");
    expect(pdfCarta.texto).toContain("Personal Ficticio");
    expect(pdfCarta.texto).toContain("[Texto institucional: por definir con el colegio]");
    expect(pdfCarta.imagenes).toBe(1); // la firma
  });

  it("HU0016-1.0 (D3-A) la carta no lleva el DNI, montos, datos de pago, dictamen ni datos de los apoderados", async () => {
    const { f, operacion } = await e.conciliada();
    await e.cartaN8n.emitir(f.idExpediente);

    const { texto } = await leerPdf((await descargar(f)).body as Buffer);

    for (const prohibido of ["7000", "7,000", operacion, "DNI", "María Fernanda", "Conclusiones ficticias", "Apto"]) expect(texto).not.toContain(prohibido);
  });

  it("HU0016-1.0 (ADR-21) la carta se guarda cifrada: en reposo no es un PDF ni contiene el nombre del menor", async () => {
    const { f } = await e.conciliada();
    await e.cartaN8n.emitir(f.idExpediente);

    const [carta] = await cartas(f.idExpediente);
    const enDisco = await readFile(join(process.env.STORAGE_LOCAL_DIR!, carta!.url_documento));

    expect(enDisco.subarray(0, 4).toString("latin1")).toBe("CILF");
    expect(enDisco.includes(Buffer.from("%PDF"))).toBe(false);
    expect(enDisco.includes(Buffer.from(POSTULANTE.paterno))).toBe(false);
  });

  it("HU0016-1.0 (D1-A) n8n recibe solo el aviso: el correo lleva el enlace al portal y ningún dato del menor, y el PDF no viaja", async () => {
    const { f } = await e.conciliada();

    const res = await e.cartaN8n.emitir(f.idExpediente);

    expect(res.body).toMatchObject({ id_expediente: f.idExpediente, tipo_evento: "carta_emitida" });
    expect(Object.keys(res.body).sort()).toEqual(["asunto", "cuerpo", "id_expediente", "id_notificacion", "tipo_evento"]);
    expect(res.body.cuerpo).toContain(`${process.env.FRONTEND_PUBLIC_URL!.replace(/\/+$/, "")}/portal/panel`);
    expect(res.body.cuerpo).toContain("[Aviso de Carta de Vacante emitida: por definir con el colegio]");
    for (const dato of [POSTULANTE.nombres, POSTULANTE.paterno, "%PDF", "3.° de primaria"]) expect(JSON.stringify(res.body)).not.toContain(dato);
    expect((await e.interno.contacto(f.idExpediente, res.body.id_notificacion)).body.correo).toBe(f.correo);
    expect(await intentosDe(db(), f.idExpediente, "carta_emitida")).toEqual([expect.objectContaining({ id_notificacion: res.body.id_notificacion, estado_envio: "pendiente" })]);
  });

  it("HU0016-1.0 (idempotencia) dos pedidos a la vez dejan una carta, una transición, un archivo y un aviso", async () => {
    const { f } = await e.conciliada();
    const antes = (await archivosAlmacenados()).length;

    const respuestas = await Promise.all([e.cartaN8n.emitir(f.idExpediente), e.cartaN8n.emitir(f.idExpediente)]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(respuestas.find((r) => r.status === 409)!.body.error.codigo).toBe("AVISO_YA_REGISTRADO");
    expect(await cartas(f.idExpediente)).toHaveLength(1);
    expect(await transicionesACarta(f.idExpediente)).toHaveLength(1);
    expect((await archivosAlmacenados()).length).toBe(antes + 1);
    expect(await intentosDe(db(), f.idExpediente, "carta_emitida")).toHaveLength(1);
  });

  it("HU0016-1.0 (idempotencia) la retoma del aviso no repite la carta: una fila por intento, tope de 6 y fila de cierre", async () => {
    const { f } = await e.conciliada();
    const primero = await e.cartaN8n.emitir(f.idExpediente);
    const clave = (await cartas(f.idExpediente))[0]!.url_documento;
    const ids = [primero.body.id_notificacion as number];

    for (let i = 0; i < 5; i++) {
      await intentadaHace(db(), ids.at(-1)!, 11);
      const retoma = await e.cartaN8n.emitir(f.idExpediente);
      expect(retoma.status).toBe(201);
      ids.push(retoma.body.id_notificacion);
    }
    await intentadaHace(db(), ids.at(-1)!, 11);
    const agotado = await e.cartaN8n.emitir(f.idExpediente);

    expect(agotado.status).toBe(409);
    expect(agotado.body.error.codigo).toBe("AVISO_AGOTADO");
    const filas = await intentosDe(db(), f.idExpediente, "carta_emitida");
    expect(filas).toHaveLength(7);
    expect(filas.at(-1)!.estado_envio).toBe("fallido");
    expect(await cartas(f.idExpediente)).toEqual([expect.objectContaining({ url_documento: clave })]);
    expect(await transicionesACarta(f.idExpediente)).toHaveLength(1);
    expect(await e.cartaN8n.pendientes()).not.toContain(f.idExpediente); // cerrado: el barrido no vuelve
  });

  it("HU0016-1.0 (fallo) si el almacenamiento falla no queda carta, ni transición, ni aviso", async () => {
    const { f } = await e.conciliada();
    const antes = (await archivosAlmacenados()).length;
    const roto: Almacenamiento = {
      abrir: (c) => e.almacenamiento.abrir(c),
      eliminar: (c) => e.almacenamiento.eliminar(c),
      guardar: async () => {
        throw new Error("disco lleno");
      },
    };

    await expect(emitirCarta(roto, f.idExpediente, null)).rejects.toThrow("disco lleno");

    await sinEfectos(f.idExpediente, antes);
    expect(await e.cartaN8n.pendientes()).toContain(f.idExpediente); // el barrido lo vuelve a intentar
  });

  it("HU0016-1.0 (fallo) si la BD falla después de guardar el PDF, el archivo se elimina y la transición se revierte", async () => {
    const { f } = await e.conciliada();
    const eliminadas: string[] = [];
    const claveLarga = "x".repeat(501); // no cabe en url_documento: falla el INSERT, dentro de la transacción
    const conClaveLarga: Almacenamiento = {
      abrir: (c) => e.almacenamiento.abrir(c),
      eliminar: async (c) => void eliminadas.push(c),
      guardar: async (contenido: Readable) => {
        contenido.resume();
        return { clave: claveLarga, bytes: 0 };
      },
    };

    await expect(emitirCarta(conClaveLarga, f.idExpediente, null)).rejects.toThrow();

    expect(eliminadas).toEqual([claveLarga]);
    await sinEfectos(f.idExpediente, (await archivosAlmacenados()).length);
  });

  it("HU0016-1.0 (barrido) entrega las cartas por emitir y, emitida la carta, solo el aviso sin intentos o vencido", async () => {
    const { f } = await e.conciliada();
    expect(await e.cartaN8n.pendientes()).toContain(f.idExpediente);

    const manual = await e.direccion().post(rutaCartaDireccion(f.idExpediente));
    expect(manual.status).toBe(201);
    expect(await e.cartaN8n.pendientes()).toContain(f.idExpediente); // carta sin aviso: la API cayó o n8n no respondió

    const { body } = await e.cartaN8n.emitir(f.idExpediente);
    expect(await e.cartaN8n.pendientes()).not.toContain(f.idExpediente); // intento en curso
    await intentadaHace(db(), body.id_notificacion, 11);
    expect(await e.cartaN8n.pendientes()).toContain(f.idExpediente);
  });

  it("HU0015-1.0 [parte: carta] conciliar el pago único dispara generacion-carta solo con el id, y con esa señal la API emite la carta", async () => {
    const { f, idPago } = await e.porConciliar();

    await e.api(e.tesoreria.token).post(rutaDecisionPago(idPago), CONFORME);

    expect(e.eventos.disparar).toHaveBeenCalledWith("generacion-carta", { id_expediente: f.idExpediente });
    expect((await e.cartaN8n.emitir(f.idExpediente)).status).toBe(201);
    expect(await estadoDe(db(), f.idExpediente)).toBe("carta_emitida");
  });

  it("HU0015-1.0 [parte: carta] la primera fracción de un pago fraccionado también emite la carta", async () => {
    const f = await e.conPostulante(await e.conVacante({ maxFracciones: 2 }));
    await e.familiaApi(f.token).post(`${rutaCuota(f.idExpediente)}/modalidad`, { modalidad: "fraccionado", numero_fracciones: 2 });
    const r = await e.comprobante(f, { monto: "3500" });
    await e.api(e.tesoreria.token).post(rutaDecisionPago(r.body.pago.id_pago), CONFORME);

    expect((await e.cartaN8n.emitir(f.idExpediente)).status).toBe(201);
  });

  it("C62 (b) con la carta emitida, P07 sigue mostrando la cuota acreditada y no permite cambiarla", async () => {
    const { f } = await e.conciliada();
    await e.cartaN8n.emitir(f.idExpediente);

    const res = await e.familiaApi(f.token).get(rutaCuota(f.idExpediente));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ disponible: true, modalidad_editable: false, registrable: false, pago: { estado: "conforme", subsanable: false } });
  });
});

describe("HU0016-2.0 bloqueo de la emisión ante pagos pendientes", () => {
  const casos: [string, (x: Awaited<ReturnType<typeof e.porConciliar>>) => Promise<unknown>, string][] = [
    ["pendiente de conciliación", async () => undefined, "pendiente"],
    ["observada por Tesorería", (x) => e.api(e.tesoreria.token).post(rutaDecisionPago(x.idPago), observar("Monto incompleto")), "observado"],
  ];

  it.each(casos)("HU0016-2.0 con la cuota %s no se crea el documento: 409 CUOTA_NO_CONCILIADA para n8n y para la directora, y G07 no la ofrece", async (_nombre, preparar, cuota) => {
    const x = await e.porConciliar();
    await preparar(x);
    const id = x.f.idExpediente;
    const antes = (await archivosAlmacenados()).length;

    const interno = await e.cartaN8n.emitir(id);
    const manual = await e.direccion().post(rutaCartaDireccion(id));

    expect(interno.status).toBe(409);
    expect(interno.body.error).toMatchObject({ codigo: "CUOTA_NO_CONCILIADA", mensaje: "La cuota de ingreso no está conciliada" });
    expect(manual.status).toBe(409);
    expect(manual.body.error.codigo).toBe("CUOTA_NO_CONCILIADA");
    await sinEfectos(id, antes);
    expect(await e.cartaN8n.pendientes()).not.toContain(id);
    const fila = (await e.direccion().get("/direccion/cartas")).body.items.find((i: { id_expediente: number }) => i.id_expediente === id);
    expect(fila).toMatchObject({ cuota, emitible: false });
    expect((await request(e.app).get(rutaCartaFamilia(id)).set("Authorization", `Bearer ${x.f.token}`)).status).toBe(404);
  });

  it("HU0016-2.0 sin comprobante registrado tampoco se emite", async () => {
    const f = await e.conPostulante(await e.conVacante());
    const antes = (await archivosAlmacenados()).length;

    expect((await e.cartaN8n.emitir(f.idExpediente)).body.error.codigo).toBe("CUOTA_NO_CONCILIADA");

    await sinEfectos(f.idExpediente, antes);
    const fila = (await e.direccion().get("/direccion/cartas")).body.items.find((i: { id_expediente: number }) => i.id_expediente === f.idExpediente);
    expect(fila).toMatchObject({ cuota: "sin_registrar", emitible: false });
  });

  it("HU0016-2.0 (R18) una fracción posterior conforme no reemplaza a la primera", async () => {
    const x = await e.porConciliar();
    await db().query(
      `INSERT INTO pago (id_expediente, tipo_pago, numero_fraccion, numero_operacion, banco, monto, fecha_pago, comprobante_url, estado_validacion)
       VALUES ($1, 'cuota_ingreso', 2, $2, 'Banco ficticio', 100, '2026-10-20', 'clave', 'conforme')`,
      [x.f.idExpediente, `OP-${unico()}`],
    );

    expect((await e.cartaN8n.emitir(x.f.idExpediente)).body.error.codigo).toBe("CUOTA_NO_CONCILIADA");
  });

  it("HU0016-2.0 (estado) sin vacante otorgada responde 409 CARTA_NO_CORRESPONDE, y un expediente inexistente 404", async () => {
    const f = await e.conPostulante(await e.apto());

    expect((await e.cartaN8n.emitir(f.idExpediente)).body.error.codigo).toBe("CARTA_NO_CORRESPONDE");
    expect((await e.cartaN8n.emitir(2147483646)).status).toBe(404);
  });

  it("HU0016-2.0 (botón) con la cuota conciliada, la directora la emite desde G07: autoriza la firma vigente, se registra quién la pidió y no se emite dos veces", async () => {
    const { f } = await e.conciliada();
    const fila = (await e.direccion().get("/direccion/cartas")).body.items.find((i: { id_expediente: number }) => i.id_expediente === f.idExpediente);
    expect(fila).toMatchObject({ cuota: "conforme", emitible: true });
    e.eventos.disparar.mockClear();

    const res = await e.direccion().post(rutaCartaDireccion(f.idExpediente));

    expect(res.status).toBe(201);
    expect(await estadoDe(db(), f.idExpediente)).toBe("carta_emitida");
    expect((await transicionesACarta(f.idExpediente))[0]).toMatchObject({ id_personal: e.directora });
    expect(e.eventos.disparar).toHaveBeenCalledWith("generacion-carta", { id_expediente: f.idExpediente });
    const otra = await e.direccion().post(rutaCartaDireccion(f.idExpediente));
    expect(otra.status).toBe(409);
    expect(otra.body.error.codigo).toBe("CARTA_YA_EMITIDA");
    expect(await cartas(f.idExpediente)).toHaveLength(1);
  });

  it("HU0016-2.0 (rol) las rutas de la carta en G07 son solo de la directora", async () => {
    const x = await e.porConciliar();
    expect((await e.api(e.tesoreria.token).get("/direccion/cartas")).status).toBe(403);
    expect((await e.api(e.tesoreria.token).post(rutaCartaDireccion(x.f.idExpediente))).status).toBe(403);
  });
});

describe("C25 (5) y C72: cuota 0 y campaña DEMO", () => {
  it("C25 (5) un grado con cuota 0 emite la carta sin pago, desde el barrido", async () => {
    const f = await e.conPostulante(await e.conVacante({ monto: 0 }));

    expect(await e.cartaN8n.pendientes()).toContain(f.idExpediente);
    expect((await e.direccion().get("/direccion/cartas")).body.items.find((i: { id_expediente: number }) => i.id_expediente === f.idExpediente)).toMatchObject({ cuota: "no_aplica", emitible: true });
    expect((await e.cartaN8n.emitir(f.idExpediente)).status).toBe(201);
    expect(await estadoDe(db(), f.idExpediente)).toBe("carta_emitida");
  });

  it("C25 (5) (C25 7) si el grado pasó a cuota 0 con un Pago sin conciliar, decide Tesorería: no se emite", async () => {
    const x = await e.porConciliar();
    await db().query("UPDATE grado SET monto_cuota_ingreso = 0 WHERE id_grado = $1", [x.f.idGrado]);

    expect(await e.cartaN8n.pendientes()).not.toContain(x.f.idExpediente);
    expect((await e.cartaN8n.emitir(x.f.idExpediente)).body.error.codigo).toBe("CUOTA_NO_CONCILIADA");
    const fila = (await e.direccion().get("/direccion/cartas")).body.items.find((i: { id_expediente: number }) => i.id_expediente === x.f.idExpediente);
    expect(fila).toMatchObject({ cuota: "pendiente", emitible: false }); // no «Sin cuota de ingreso»
  });

  it("C25 (2) las adjudicadas siguen coincidiendo con los expedientes en vacante_asignada o carta_emitida después de la carta", async () => {
    const idGrado = await e.grado({ autorizadas: 5 });
    const f = await e.conPostulante(await e.apto(idGrado));
    await e.direccion().post(`/direccion/expedientes/${f.idExpediente}/adjudicacion`);
    await db().query("UPDATE grado SET monto_cuota_ingreso = 0 WHERE id_grado = $1", [idGrado]);
    await e.cartaN8n.emitir(f.idExpediente);

    const { rows } = await db().query<{ adjudicadas: number; con_vacante: number }>(
      `SELECT g.vacantes_autorizadas - g.vacantes_disponibles AS adjudicadas,
              (SELECT count(*)::int FROM expediente x WHERE x.id_grado = g.id_grado AND x.estado IN ('vacante_asignada', 'carta_emitida')) AS con_vacante
         FROM grado g WHERE g.id_grado = $1`,
      [idGrado],
    );
    expect(rows[0]).toEqual({ adjudicadas: 1, con_vacante: 1 });
  });

  it("C72 un expediente de la campaña DEMO que cumple la condición no se lista ni se emite", async () => {
    const { rows } = await db().query<{ id_grado: number }>(
      `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso)
       VALUES ('primaria', $1, 'DEMO', 10, 9, 0) RETURNING id_grado`,
      [`Demo ${unico()}`],
    );
    const f = await e.conPostulante(await e.familia("vacante_asignada", rows[0]!.id_grado));
    const antes = (await archivosAlmacenados()).length;

    expect(await e.cartaN8n.pendientes()).not.toContain(f.idExpediente);
    expect((await e.cartaN8n.emitir(f.idExpediente)).body.error.codigo).toBe("CARTA_NO_CORRESPONDE");
    await sinEfectos(f.idExpediente, antes);
  });
});

describe("C67 lead time con cartas reales", () => {
  it("C67 con la transición real a carta_emitida, G08 muestra el lead time oficial, las cartas y el tramo «Cuota → carta»", async () => {
    const otra = await entornoCarta(db(), await crearFirmante());
    const { f } = await otra.conciliada();
    const antes = (await otra.direccion().get("/direccion/indicadores")).body;
    expect(antes.tarjetas).toMatchObject({ lead_time_dias: null, cartas: 0 });
    await otra.firmar();

    expect((await otra.cartaN8n.emitir(f.idExpediente)).status).toBe(201);

    const res = await otra.direccion().get("/direccion/indicadores");
    expect(res.status).toBe(200);
    expect(res.body.tarjetas.cartas).toBe(1);
    expect(res.body.tarjetas.lead_time_dias).not.toBeNull();
    expect(res.body.embudo.find((x: { etapa: string }) => x.etapa === "cartas")).toMatchObject({ total: 1 });
    expect(res.body.etapas.find((x: { etapa: string }) => x.etapa === "cuota_carta").tramo_dias).not.toBeNull();
    expect(res.body.expedientes[0]).toMatchObject({ final: true, etapa: "Carta emitida" });
  });
});

describe("D2 firma de la Directora", () => {
  it("D2 sin una firma cargada la carta no se emite: 409 FIRMA_NO_DISPONIBLE, sin cambios, y al cargarla se emite", async () => {
    const { f } = await e.conciliada();
    await db().query("UPDATE personal SET firma_url = NULL");
    const antes = (await archivosAlmacenados()).length;

    const res = await e.cartaN8n.emitir(f.idExpediente);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe("FIRMA_NO_DISPONIBLE");
    await sinEfectos(f.idExpediente, antes);
    await e.firmar();
    expect((await e.cartaN8n.emitir(f.idExpediente)).status).toBe(201);
  });

  it("D2 con varias firmas autoriza la directora que adjudicó; si ya no está activa, la directora activa con firma", async () => {
    const otra = await crearPersonal(db(), "directora");
    await e.firmar(otra);
    const uno = await e.conciliada();
    await e.cartaN8n.emitir(uno.f.idExpediente);
    expect((await cartas(uno.f.idExpediente))[0]).toMatchObject({ id_personal_autoriza: e.directora });

    const dos = await e.conciliada();
    await db().query("UPDATE personal SET activo = false WHERE id_personal = $1", [e.directora]);
    await e.cartaN8n.emitir(dos.f.idExpediente);
    await db().query("UPDATE personal SET activo = true WHERE id_personal = $1", [e.directora]);
    await db().query("UPDATE personal SET firma_url = NULL WHERE id_personal = $1", [otra]);

    expect((await cartas(dos.f.idExpediente))[0]).toMatchObject({ id_personal_autoriza: otra });
  });

  it("D2 la firma se guarda cifrada, deja gestion_usuario y reemplazarla borra la anterior; ninguna respuesta del personal la expone", async () => {
    const leer = async () => (await db().query<{ firma_url: string }>("SELECT firma_url FROM personal WHERE id_personal = $1", [e.directora])).rows[0]!.firma_url;
    const anterior = await leer();

    await e.firmar();

    const nueva = await leer();
    expect(nueva).not.toBe(anterior);
    const archivos = await archivosAlmacenados();
    expect(archivos).toContain(nueva);
    expect(archivos).not.toContain(anterior);
    expect((await readFile(join(process.env.STORAGE_LOCAL_DIR!, nueva))).includes(pngFirma().subarray(0, 8))).toBe(false);
    const { rows } = await db().query("SELECT 1 FROM registro_auditoria WHERE tipo_evento = 'gestion_usuario' AND detalle @> $1::jsonb", [
      JSON.stringify({ accion: "firma_cargada", id_personal_afectado: e.directora }),
    ]);
    expect(rows.length).toBeGreaterThan(0);
    const personal = await e.direccion().get("/personal");
    expect(personal.status).toBe(200);
    expect(JSON.stringify(personal.body)).not.toContain("firma");
    expect(JSON.stringify(personal.body)).not.toContain(nueva);
  });

  it("D2 rechaza un archivo que no es una imagen PNG o JPG legible, uno de más de 1 MB y un correo que no es de una directora activa", async () => {
    const correo = await correoDe(db(), e.directora);
    const antes = (await archivosAlmacenados()).length;

    await expect(cargarFirma(e.almacenamiento, correo, pdf())).rejects.toMatchObject({ codigo: "FORMATO_NO_ADMITIDO" });
    await expect(cargarFirma(e.almacenamiento, correo, png())).rejects.toMatchObject({ codigo: "FORMATO_NO_ADMITIDO" }); // solo la firma de bytes
    await expect(cargarFirma(e.almacenamiento, correo, Buffer.concat([pngFirma(), Buffer.alloc(MAXIMO_BYTES_FIRMA)]))).rejects.toMatchObject({ codigo: "ARCHIVO_DEMASIADO_GRANDE" });
    await expect(cargarFirma(e.almacenamiento, "nadie@ejemplo.test", pngFirma())).rejects.toMatchObject({ codigo: "DIRECTORA_NO_ENCONTRADA" });

    expect((await archivosAlmacenados()).length).toBe(antes);
    expect(MAXIMO_BYTES_FIRMA).toBe(MiB);
  });

  it("D2 (responsable) la firma que carga un técnico deja su nombre, sin espacios de más, en el detalle de gestion_usuario y sin id_personal", async () => {
    const correo = await correoDe(db(), e.directora);

    await cargarFirma(e.almacenamiento, correo, pngFirma(), "  Técnico de Prueba  ");

    const { rows } = await db().query(
      "SELECT id_personal, detalle FROM registro_auditoria WHERE tipo_evento = 'gestion_usuario' AND detalle @> $1::jsonb ORDER BY id_evento DESC LIMIT 1",
      [JSON.stringify({ accion: "firma_cargada", id_personal_afectado: e.directora })],
    );
    expect(rows[0]).toMatchObject({ id_personal: null, detalle: { accion: "firma_cargada", responsable: "Técnico de Prueba" } });
  });

  it("D2 (responsable) un responsable inválido responde 400 RESPONSABLE_INVALIDO antes de guardar la imagen, y sin responsable la bitácora no lleva la clave", async () => {
    const correo = await correoDe(db(), e.directora);
    const antes = (await archivosAlmacenados()).length;

    for (const invalido of ["ab", "x".repeat(101), "Técnico\nde Prueba"]) {
      await expect(cargarFirma(e.almacenamiento, correo, pngFirma(), invalido)).rejects.toMatchObject({ status: 400, codigo: "RESPONSABLE_INVALIDO" });
    }
    expect((await archivosAlmacenados()).length).toBe(antes);

    await cargarFirma(e.almacenamiento, correo, pngFirma());
    const { rows } = await db().query(
      "SELECT detalle FROM registro_auditoria WHERE tipo_evento = 'gestion_usuario' AND detalle @> $1::jsonb ORDER BY id_evento DESC LIMIT 1",
      [JSON.stringify({ accion: "firma_cargada", id_personal_afectado: e.directora })],
    );
    expect(rows[0].detalle).not.toHaveProperty("responsable");
  });
});

describe("HU0016 descarga de la carta desde el portal", () => {
  it("HU0016-1.0 (descarga) la familia descarga su carta ya descifrada, con cabeceras seguras y sin caché", async () => {
    const { f } = await e.conciliada();
    await e.cartaN8n.emitir(f.idExpediente);

    const res = await descargar(f);

    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(res.headers).toMatchObject({
      "content-type": "application/pdf",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "no-store",
    });
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="carta-vacante-ADM-.+\.pdf"$/);
  });

  it("HU0016-1.0 (descarga) la carta de otra familia responde 404, como un expediente inexistente, y el intento se audita", async () => {
    const { f } = await e.conciliada();
    await e.cartaN8n.emitir(f.idExpediente);
    const ajena = await e.conPostulante(await e.conVacante());

    const res = await request(e.app).get(rutaCartaFamilia(f.idExpediente)).set("Authorization", `Bearer ${ajena.token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe("EXPEDIENTE_NO_ENCONTRADO");
    expect((await eventosDe(db(), f.idExpediente)).some((ev) => ev.tipo_evento === "acceso_denegado")).toBe(true);
  });

  it("HU0016-1.0 (descarga) sin token responde 401 y sin carta emitida 404 CARTA_NO_ENCONTRADA", async () => {
    const f = await e.conPostulante(await e.conVacante());

    expect((await request(e.app).get(rutaCartaFamilia(f.idExpediente))).status).toBe(401);
    const res = await request(e.app).get(rutaCartaFamilia(f.idExpediente)).set("Authorization", `Bearer ${f.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe("CARTA_NO_ENCONTRADA");
  });
});
