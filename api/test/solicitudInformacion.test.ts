// HU0001: solicitud de información y consentimiento por HTTP (/publico/solicitud-informacion, pantalla P01) contra
// admision_test. La ruta es PÚBLICA (ADR-17): las pruebas no envían token. El archivo usa su propia campaña
// (crearApp({ campanaActiva })) para no chocar con los grados de otras pruebas.
// El evento hacia n8n (ADR-16) se prueba contra un n8n simulado (node:http en 127.0.0.1, rules/pruebas.md): el flujo
// captacion que lo recibe es de HU0002. Las pruebas «P01 …» y «C3 …» son de soporte (protecciones técnicas de ADR-17
// y compromiso C3): cuentan en la matriz, pero no se asignan a escenarios.
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as reglasCliente from "../../frontend/src/portal/reglasSolicitud";
import { crearApp } from "../src/app";
import { descifrar, hashDni } from "../src/crypto/columnas";
import { cerrarPool, obtenerPool } from "../src/db/pool";
import { LIMITE_PUBLICO } from "../src/limitePorIp";
import { crearDisparadorN8n, type DisparadorN8n, type OpcionesDisparador } from "../src/orquestacion/n8n";
import { existeApoderadoConDni, insertarApoderado } from "../src/repositories/apoderado";
import { CAMPO_TRAMPA } from "../src/routes/publico";
import { POLITICA_PRIVACIDAD } from "../src/services/politicaPrivacidad";
import * as reglasServidor from "../src/services/reglasSolicitud";
import { unico } from "./ayudantes";

const db = () => obtenerPool();
const RUTA = "/publico/solicitud-informacion";
const CAMPANA = `S${unico()}`; // 9 caracteres: cabe en grado.campana_admision (varchar(10))
const SECRETO = "secreto-de-prueba-hu0001-0123456789abcdef"; // solo de este archivo, nunca el de .env (C15)
// Sin límite práctico para las pruebas que no son del límite por IP (P01 límite tiene su propia app).
const SIN_LIMITE = { maximo: 100_000, ventanaMs: 60_000 };

let idGradoPrimaria: number;
let idGradoInicial: number;
let idGradoOtraCampana: number;
let app: Express;
const eventos = { disparar: vi.fn<DisparadorN8n["disparar"]>(async () => undefined) };

async function gradoDe(nivel: "inicial" | "primaria", campana: string) {
  const { rows } = await db().query<{ id_grado: number }>(
    `INSERT INTO grado (nivel, nombre_grado, campana_admision, vacantes_autorizadas, vacantes_disponibles, monto_cuota_ingreso)
     VALUES ($1::nivel_educativo, $2, $3, 20, 20, 7000) RETURNING id_grado`,
    [nivel, `G-${unico()}`, campana],
  );
  return rows[0]!.id_grado;
}

beforeAll(async () => {
  // Primaria antes que inicial: el GET debe ordenar por nivel, no por id.
  idGradoPrimaria = await gradoDe("primaria", CAMPANA);
  idGradoInicial = await gradoDe("inicial", CAMPANA);
  idGradoOtraCampana = await gradoDe("primaria", `O${unico()}`);
  app = crearApp({ campanaActiva: CAMPANA, eventos, limitePublico: SIN_LIMITE });
});

afterEach(() => {
  eventos.disparar.mockClear();
  vi.restoreAllMocks();
});

afterAll(cerrarPool);

const correoUnico = () => `hu0001-${unico()}@ejemplo.test`;

// Datos ficticios evidentes (rules/db.md). Cada llamada lleva un correo nuevo.
const solicitud = (cambios: Record<string, unknown> = {}) => ({
  nombres: "Nombre Ficticio",
  apellidos: "Apellido Prueba",
  telefono: "987 654 321",
  correo: correoUnico(),
  id_grado: idGradoPrimaria,
  autoriza_whatsapp: true,
  acepta_politica: true,
  canal_origen: "facebook",
  ...cambios,
});

const enviar = (cuerpo: unknown, aplicacion: Express = app) => request(aplicacion).post(RUTA).send(cuerpo as object);

async function conteos() {
  const { rows } = await db().query(
    `SELECT (SELECT count(*) FROM apoderado)::int AS apoderados,
            (SELECT count(*) FROM consentimiento)::int AS consentimientos,
            (SELECT count(*) FROM expediente)::int AS expedientes`,
  );
  return rows[0];
}

// Lo que quedó guardado para un correo: apoderados, consentimientos, expedientes y eventos de auditoría.
async function guardadoPara(correo: string) {
  const { rows: apoderados } = await db().query(
    "SELECT id_apoderado, nombres, apellidos, telefono, correo, dni_cifrado, dni_hash FROM apoderado WHERE correo = $1",
    [correo],
  );
  const ids = apoderados.map((a) => a.id_apoderado);
  const { rows: consentimientos } = await db().query(
    `SELECT version_politica, canal_origen, autoriza_whatsapp, fecha_hora_aceptacion FROM consentimiento
      WHERE id_apoderado = ANY($1::int[])`,
    [ids],
  );
  const { rows: expedientes } = await db().query(
    `SELECT id_expediente, id_grado, id_postulante, estado::text AS estado FROM expediente
      WHERE id_apoderado_titular = ANY($1::int[])`,
    [ids],
  );
  const { rows: auditoria } = await db().query("SELECT id_evento FROM registro_auditoria WHERE id_expediente = ANY($1::int[])", [
    expedientes.map((e) => e.id_expediente),
  ]);
  return { apoderados, consentimientos, expedientes, auditoria };
}

async function sinNadaGuardado(correo: string, antes: unknown) {
  expect(await conteos()).toEqual(antes);
  expect((await guardadoPara(correo)).apoderados).toHaveLength(0);
}

// ---------------------------------------------------------------- n8n simulado

interface Llamada {
  metodo: string;
  ruta: string;
  cabeceras: IncomingHttpHeaders;
  cuerpo: string;
  expedienteVisible: boolean; // el expediente ya se veía desde otra conexión al llegar la llamada
}

// Responde con el estado que indique `estadoDe(n)` para la llamada n (1, 2, 3…) y, si se dan, con esas cabeceras.
async function crearN8nSimulado(estadoDe: (n: number) => number = () => 200, cabecerasRespuesta: Record<string, string> = {}) {
  const llamadas: Llamada[] = [];
  const servidor = createServer(async (req, res) => {
    let cuerpo = "";
    for await (const parte of req) cuerpo += parte;
    let expedienteVisible = false;
    try {
      const { rowCount } = await db().query("SELECT 1 FROM expediente WHERE id_expediente = $1", [JSON.parse(cuerpo).id_expediente]);
      expedienteVisible = (rowCount ?? 0) > 0;
    } catch {
      // cuerpo inesperado: la prueba lo verá en `cuerpo`
    }
    llamadas.push({ metodo: req.method ?? "", ruta: req.url ?? "", cabeceras: req.headers, cuerpo, expedienteVisible });
    res.statusCode = estadoDe(llamadas.length);
    for (const [nombre, valor] of Object.entries(cabecerasRespuesta)) res.setHeader(nombre, valor);
    res.end();
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/webhook`,
    llamadas,
    cerrar: () =>
      new Promise<void>((listo) => {
        servidor.closeAllConnections();
        servidor.close(() => listo());
      }),
  };
}

// Disparador real (orquestacion/n8n.ts) con esperas cortas; `terminar` espera a que acaben los envíos en curso,
// para que ningún temporizador quede vivo al terminar la prueba. El tiempo límite por intento es holgado porque en
// Windows rechazar una conexión a un puerto cerrado de 127.0.0.1 tarda unos 2 s.
function disparadorDePrueba(urlBase: string, opciones: Partial<OpcionesDisparador> = {}) {
  const real = crearDisparadorN8n({ urlBase, secreto: SECRETO, timeoutMs: 10_000, esperasMs: [10, 10], ...opciones });
  const pendientes: Promise<void>[] = [];
  const disparador: DisparadorN8n = {
    disparar(flujo, cuerpo) {
      const envio = real.disparar(flujo, cuerpo);
      pendientes.push(envio);
      return envio;
    },
  };
  return { disparador, terminar: () => Promise.all(pendientes) };
}

// Un puerto donde no escucha nadie: n8n caído.
async function puertoCerrado() {
  const n8n = await crearN8nSimulado();
  await n8n.cerrar();
  return n8n.url;
}

// ---------------------------------------------------------------- HU0001-1.0

describe("HU0001-1.0 registro de la solicitud con consentimiento", () => {
  it("HU0001-1.0 registra el apoderado, el consentimiento y el expediente en prospecto sin postulante, y responde 201 sin identificadores", async () => {
    const datos = solicitud();
    const antes = await conteos();
    const res = await enviar(datos);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ estado: "registrada" });
    expect(await conteos()).toEqual({
      apoderados: antes.apoderados + 1,
      consentimientos: antes.consentimientos + 1,
      expedientes: antes.expedientes + 1,
    });

    const g = await guardadoPara(datos.correo);
    expect(g.apoderados).toEqual([
      expect.objectContaining({
        nombres: "Nombre Ficticio",
        apellidos: "Apellido Prueba",
        telefono: "+51987654321",
        correo: datos.correo,
        dni_cifrado: null,
        dni_hash: null,
      }),
    ]);
    expect(g.consentimientos).toHaveLength(1);
    expect(g.expedientes).toEqual([expect.objectContaining({ id_grado: idGradoPrimaria, id_postulante: null, estado: "prospecto" })]);
    // Plan HU0001, P2: la creación no se audita.
    expect(g.auditoria).toEqual([]);
    // El evento se dispara con el expediente creado (el n8n real se prueba con el simulado, más abajo).
    expect(eventos.disparar).toHaveBeenCalledTimes(1);
    expect(eventos.disparar).toHaveBeenCalledWith("captacion", { id_expediente: g.expedientes[0].id_expediente });
  });

  it("HU0001-1.0 guarda la versión vigente de la política, la hora del servidor, el canal de origen y la autorización de WhatsApp", async () => {
    const casos = [
      { cambios: { canal_origen: "facebook", autoriza_whatsapp: true }, canal: "facebook", whatsapp: true },
      { cambios: { canal_origen: "instagram", autoriza_whatsapp: false }, canal: "instagram", whatsapp: false },
      // Sin canal (enlace sin ?origen=) ni casilla de WhatsApp: formulario_web y false.
      { cambios: { canal_origen: undefined, autoriza_whatsapp: undefined }, canal: "formulario_web", whatsapp: false },
    ];
    for (const caso of casos) {
      const datos = solicitud(caso.cambios);
      const { rows: [desde] } = await db().query("SELECT clock_timestamp() AS t");
      const res = await enviar(datos);
      const { rows: [hasta] } = await db().query("SELECT clock_timestamp() AS t");
      expect(res.status, JSON.stringify(caso.cambios)).toBe(201);

      const [consentimiento] = (await guardadoPara(datos.correo)).consentimientos;
      expect(consentimiento).toMatchObject({ version_politica: POLITICA_PRIVACIDAD.version, canal_origen: caso.canal, autoriza_whatsapp: caso.whatsapp });
      expect(consentimiento.fecha_hora_aceptacion.getTime()).toBeGreaterThanOrEqual(desde.t.getTime());
      expect(consentimiento.fecha_hora_aceptacion.getTime()).toBeLessThanOrEqual(hasta.t.getTime());
    }

    // La fecha y la versión no las fija el cliente: un campo que no es del formulario se rechaza y no se guarda nada.
    for (const intruso of [{ fecha_hora_aceptacion: "2000-01-01T00:00:00Z" }, { version_politica: "otra" }]) {
      const datos = solicitud(intruso);
      const antes = await conteos();
      const res = await enviar(datos);
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("VALIDACION");
      await sinNadaGuardado(datos.correo, antes);
    }
  });

  it("HU0001-1.0 después del commit envía a /captacion solo el id_expediente, con X-Webhook-Secret (n8n simulado)", async () => {
    const n8n = await crearN8nSimulado();
    const { disparador, terminar } = disparadorDePrueba(n8n.url);
    try {
      const datos = solicitud();
      const res = await enviar(datos, crearApp({ campanaActiva: CAMPANA, eventos: disparador, limitePublico: SIN_LIMITE }));
      expect(res.status).toBe(201);
      await terminar();

      const [expediente] = (await guardadoPara(datos.correo)).expedientes;
      expect(n8n.llamadas).toHaveLength(1);
      const [llamada] = n8n.llamadas;
      expect(llamada).toMatchObject({ metodo: "POST", ruta: "/webhook/captacion", expedienteVisible: true });
      expect(llamada!.cabeceras["x-webhook-secret"]).toBe(SECRETO);
      expect(llamada!.cabeceras["content-type"]).toMatch(/^application\/json/);
      expect(JSON.parse(llamada!.cuerpo)).toEqual({ id_expediente: expediente.id_expediente });
      for (const dato of [datos.correo, datos.nombres, datos.apellidos, "987654321"]) expect(llamada!.cuerpo).not.toContain(dato);
    } finally {
      await n8n.cerrar();
    }
  });

  it("HU0001-1.0 con n8n caído, con 404 o con 503 el registro queda, la respuesta sigue siendo 201, solo se reintenta ante red o 5xx y el log no tiene datos personales", async () => {
    const casos = [
      { nombre: "404 (flujo sin importar)", estadoDe: () => 404, llamadas: 1, aviso: /1 intento, HTTP 404\)$/ },
      { nombre: "503 siempre", estadoDe: () => 503, llamadas: 3, aviso: /3 intentos, HTTP 503\)$/ },
      { nombre: "503 y luego 200", estadoDe: (n: number) => (n === 1 ? 503 : 200), llamadas: 2, aviso: null },
      { nombre: "n8n caído", estadoDe: null, llamadas: 0, aviso: /3 intentos, ECONNREFUSED\)$/ },
    ];
    for (const caso of casos) {
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const n8n = caso.estadoDe ? await crearN8nSimulado(caso.estadoDe) : null;
      const { disparador, terminar } = disparadorDePrueba(n8n?.url ?? (await puertoCerrado()));
      try {
        const datos = solicitud();
        const res = await enviar(datos, crearApp({ campanaActiva: CAMPANA, eventos: disparador, limitePublico: SIN_LIMITE }));
        expect(res.status, caso.nombre).toBe(201);
        expect(res.body).toEqual({ estado: "registrada" });
        await terminar();

        const g = await guardadoPara(datos.correo);
        expect(g.expedientes, caso.nombre).toHaveLength(1);
        if (n8n) expect(n8n.llamadas, caso.nombre).toHaveLength(caso.llamadas);

        if (caso.aviso === null) {
          expect(aviso, caso.nombre).not.toHaveBeenCalled();
        } else {
          expect(aviso, caso.nombre).toHaveBeenCalledTimes(1);
          const mensaje = String(aviso.mock.calls[0]![0]);
          expect(mensaje).toMatch(/^Evento captacion no entregado a n8n \(id_expediente=\d+, /);
          expect(mensaje).toMatch(caso.aviso);
          for (const dato of [datos.correo, datos.nombres, datos.apellidos, "987654321", SECRETO]) expect(mensaje).not.toContain(dato);
        }
      } finally {
        aviso.mockRestore();
        await n8n?.cerrar();
      }
    }
  }, 60_000);
});

// ---------------------------------------------------------------- HU0001-2.0

describe("HU0001-2.0 datos obligatorios incompletos o con formato inválido", () => {
  it("HU0001-2.0 cada campo obligatorio omitido o vacío responde 400 y no guarda nada", async () => {
    const casos: [string, Record<string, unknown>][] = [
      ["nombres", { nombres: undefined }],
      ["nombres", { nombres: "   " }],
      ["apellidos", { apellidos: undefined }],
      ["apellidos", { apellidos: "" }],
      ["telefono", { telefono: undefined }],
      ["telefono", { telefono: "" }],
      ["correo", { correo: undefined }],
      ["correo", { correo: "  " }],
      ["id_grado", { id_grado: undefined }],
      ["id_grado", { id_grado: "6" }],
    ];
    for (const [campo, cambios] of casos) {
      const datos = solicitud(cambios);
      const antes = await conteos();
      const res = await enviar(datos);
      expect(res.status, JSON.stringify(cambios)).toBe(400);
      expect(res.body.error).toEqual({ codigo: "VALIDACION", mensaje: expect.stringContaining(campo) });
      await sinNadaGuardado(String(datos.correo ?? ""), antes);
    }
    expect(eventos.disparar).not.toHaveBeenCalled();
  });

  it("HU0001-2.0 rechaza correos y celulares con formato inválido y guarda los válidos normalizados", async () => {
    const invalidos: [string, Record<string, unknown>][] = [
      ...["sin-arroba.ejemplo.test", "a@b", "a@b.c", ".a@ejemplo.test", "a..b@ejemplo.test", "a b@ejemplo.test", `${"a".repeat(140)}@ejemplo.test`].map(
        (correo): [string, Record<string, unknown>] => ["correo", { correo }],
      ),
      ...["887654321", "98765432", "34612345678", "+0123456789", "+1234567", "+1234567890123456", "+5114567890", "abc"].map(
        (telefono): [string, Record<string, unknown>] => ["telefono", { telefono }],
      ),
    ];
    for (const [campo, cambios] of invalidos) {
      const datos = solicitud(cambios);
      const antes = await conteos();
      const res = await enviar(datos);
      expect(res.status, JSON.stringify(cambios)).toBe(400);
      expect(res.body.error.mensaje).toContain(campo);
      expect(await conteos()).toEqual(antes);
    }

    // Válidos: el correo se guarda recortado y en minúsculas, y el teléfono en E.164 (plan HU0001, P3).
    const correo = correoUnico();
    const casosValidos = [
      { telefono: "+51 987-654-321", e164: "+51987654321" },
      { telefono: "51987654321", e164: "+51987654321" },
      { telefono: "+34 612 345 678", e164: "+34612345678" },
      { telefono: "+1 (415) 555-2671", e164: "+14155552671" },
    ];
    for (const [i, caso] of casosValidos.entries()) {
      const propio = correo.replace("@", `-${i}@`);
      const res = await enviar(solicitud({ telefono: caso.telefono, correo: `  ${propio.toUpperCase()} ` }));
      expect(res.status, caso.telefono).toBe(201);
      const [apoderado] = (await guardadoPara(propio)).apoderados;
      expect(apoderado).toMatchObject({ correo: propio, telefono: caso.e164 });
    }
  });

  it("HU0001-2.0 el cliente y el servidor aplican las mismas reglas", () => {
    expect(reglasCliente.CORREO.source).toBe(reglasServidor.CORREO.source);
    expect(reglasCliente.CORREO.flags).toBe(reglasServidor.CORREO.flags);
    expect(reglasCliente.LARGO_MAXIMO).toEqual(reglasServidor.LARGO_MAXIMO);

    const telefonos: [string, string | null][] = [
      ["987 654 321", "+51987654321"],
      ["+51 987-654-321", "+51987654321"],
      ["51987654321", "+51987654321"],
      ["(+51) 987 654 321", "+51987654321"],
      ["+34 612 345 678", "+34612345678"],
      ["+1 (415) 555-2671", "+14155552671"],
      ["+12345678", "+12345678"], // E.164 con 8 dígitos
      ["+123456789012345", "+123456789012345"], // E.164 con 15 dígitos
      ["887654321", null],
      ["98765432", null],
      ["9876543210", null],
      ["34612345678", null], // internacional sin +
      ["+0123456789", null],
      ["+1234567", null], // 7 dígitos
      ["+1234567890123456", null], // 16 dígitos
      ["+5114567890", null], // +51 sin celular (S8)
      ["+51 9876 54321 0", null],
      ["abc", null],
      ["", null],
      ["9".repeat(26), null], // más largo que el máximo
    ];
    for (const [entrada, esperado] of telefonos) {
      expect(reglasServidor.normalizarTelefono(entrada), `servidor: ${entrada}`).toBe(esperado);
      expect(reglasCliente.normalizarTelefono(entrada), `cliente: ${entrada}`).toBe(esperado);
    }

    const correos: [string, boolean][] = [
      ["mfquispe@ejemplo.test", true],
      ["  nombre.apellido+admision@ejemplo.test ", true],
      ["o'brien@colegio.ejemplo.test", true],
      ["NOMBRE@EJEMPLO.TEST", true],
      ["sin-arroba.ejemplo.test", false],
      ["a@b", false],
      ["a@b.c", false],
      [".a@ejemplo.test", false],
      ["a..b@ejemplo.test", false],
      ["a b@ejemplo.test", false],
      ["a@-ejemplo.test", false],
      [`${"a".repeat(137)}@ejemplo.test`, true], // 150 caracteres
      [`${"a".repeat(138)}@ejemplo.test`, false], // 151 caracteres
    ];
    for (const [entrada, esperado] of correos) {
      expect(reglasServidor.correoValido(entrada), `servidor: ${entrada}`).toBe(esperado);
      expect(reglasCliente.correoValido(entrada), `cliente: ${entrada}`).toBe(esperado);
    }
  });
});

// ---------------------------------------------------------------- HU0001-3.0

describe("HU0001-3.0 solicitud sin consentimiento", () => {
  it("HU0001-3.0 sin aceptar la política responde 422 y no guarda nada, aunque se salte el formulario y aunque los demás campos sean inválidos", async () => {
    const casos: Record<string, unknown>[] = [
      { acepta_politica: false },
      { acepta_politica: undefined },
      { acepta_politica: "true" },
      { acepta_politica: 1 },
      // Datos inválidos y sin consentimiento: el consentimiento se comprueba primero (R1).
      { acepta_politica: false, correo: "no-es-correo", telefono: "123", nombres: "" },
    ];
    for (const cambios of casos) {
      const datos = solicitud(cambios);
      const antes = await conteos();
      const res = await enviar(datos);
      expect(res.status, JSON.stringify(cambios)).toBe(422);
      expect(res.body).toEqual({ error: { codigo: "CONSENTIMIENTO_REQUERIDO", mensaje: "El consentimiento es obligatorio para continuar." } });
      await sinNadaGuardado(String(datos.correo), antes);
    }
  });

  it("HU0001-3.0 sin consentimiento no se dispara ningún evento hacia n8n", async () => {
    const n8n = await crearN8nSimulado();
    const { disparador, terminar } = disparadorDePrueba(n8n.url);
    try {
      const res = await enviar(solicitud({ acepta_politica: false }), crearApp({ campanaActiva: CAMPANA, eventos: disparador, limitePublico: SIN_LIMITE }));
      expect(res.status).toBe(422);
      await terminar();
      expect(n8n.llamadas).toHaveLength(0);
    } finally {
      await n8n.cerrar();
    }
  });
});

// ---------------------------------------------------------------- soporte: ADR-17 y P1

describe("P01 datos públicos y protecciones de la ruta (ADR-17)", () => {
  it("P01 el GET, sin token, entrega la campaña, la política y solo id, nivel y nombre de los grados de la campaña activa", async () => {
    const res = await request(app).get(RUTA);
    expect(res.status).toBe(200);
    expect(res.body.campana).toBe(CAMPANA);
    expect(res.body.politica).toEqual({ version: POLITICA_PRIVACIDAD.version, texto: POLITICA_PRIVACIDAD.texto });
    // Ordenados por nivel (inicial antes que primaria) y sin el grado de otra campaña.
    expect(res.body.grados.map((g: { id_grado: number }) => g.id_grado)).toEqual([idGradoInicial, idGradoPrimaria]);
    for (const grado of res.body.grados) {
      expect(Object.keys(grado).sort()).toEqual(["id_grado", "nivel", "nombre_grado"]);
    }
    expect(res.body.grados[0].nivel).toBe("inicial");
  });

  // Fuera del «Cuando» de HU0001-2.0 (campos omitidos o formato de correo o teléfono): es validación de la API.
  it("P01 un grado que no existe o que es de otra campaña responde 400 y no guarda nada", async () => {
    for (const idGrado of [2147483647, idGradoOtraCampana]) {
      const datos = solicitud({ id_grado: idGrado });
      const antes = await conteos();
      const res = await enviar(datos);
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({ codigo: "VALIDACION", mensaje: "Datos inválidos: id_grado" });
      await sinNadaGuardado(datos.correo, antes);
    }
    expect(eventos.disparar).not.toHaveBeenCalled();
  });

  it("P01 el aviso a n8n no sigue redirecciones: un 3xx no se reintenta y el secreto no sale hacia otro destino", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const otroDestino = await crearN8nSimulado();
    const n8n = await crearN8nSimulado(() => 302, { Location: `${otroDestino.url}/captacion` });
    const { disparador, terminar } = disparadorDePrueba(n8n.url);
    try {
      const datos = solicitud();
      const res = await enviar(datos, crearApp({ campanaActiva: CAMPANA, eventos: disparador, limitePublico: SIN_LIMITE }));
      expect(res.status).toBe(201);
      await terminar();

      expect(n8n.llamadas).toHaveLength(1);
      expect(otroDestino.llamadas).toHaveLength(0);
      expect(aviso).toHaveBeenCalledTimes(1);
      expect(String(aviso.mock.calls[0]![0])).toMatch(/1 intento, HTTP 302\)$/);
      expect((await guardadoPara(datos.correo)).expedientes).toHaveLength(1);
    } finally {
      aviso.mockRestore();
      await n8n.cerrar();
      await otroDestino.cerrar();
    }
  });

  it("P01 un canal de origen desconocido responde 400 y no guarda nada", async () => {
    const datos = solicitud({ canal_origen: "tiktok" });
    const antes = await conteos();
    const res = await enviar(datos);
    expect(res.status).toBe(400);
    expect(res.body.error.mensaje).toContain("canal_origen");
    await sinNadaGuardado(datos.correo, antes);
  });

  it("P01 el mismo correo dos veces crea filas nuevas y recibe la misma respuesta (plan HU0001, P1)", async () => {
    const correo = correoUnico();
    const primera = await enviar(solicitud({ correo }));
    const segunda = await enviar(solicitud({ correo }));
    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primera.body);
    const g = await guardadoPara(correo);
    expect(g.apoderados).toHaveLength(2);
    expect(g.expedientes).toHaveLength(2);
  });

  it("P01 limita los envíos por IP: pasado el máximo responde 429 con Retry-After, cada IP cuenta aparte y la ventana se renueva", async () => {
    expect(LIMITE_PUBLICO).toEqual({ maximo: 5, ventanaMs: 10 * 60 * 1000 }); // plan HU0001, P7
    let ahora = 1_000_000;
    const conLimite = crearApp({ campanaActiva: CAMPANA, eventos, limitePublico: { maximo: 2, ventanaMs: 60_000, ahora: () => ahora } });
    // Cuerpos sin consentimiento: cuentan para el límite y no guardan nada.
    const desde = (ip: string) => request(conLimite).post(RUTA).set("X-Forwarded-For", ip).send(solicitud({ acepta_politica: false }));

    expect((await desde("203.0.113.10")).status).toBe(422);
    expect((await desde("203.0.113.10")).status).toBe(422);
    const bloqueada = await desde("203.0.113.10");
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.headers["retry-after"]).toBe("60");
    expect(bloqueada.body).toEqual({ error: { codigo: "DEMASIADAS_SOLICITUDES", mensaje: expect.any(String) } });

    expect((await desde("198.51.100.7")).status).toBe(422); // otra IP
    expect((await request(conLimite).get(RUTA).set("X-Forwarded-For", "203.0.113.10")).status).toBe(200); // el GET no se limita

    ahora += 30_000;
    const otraVez = await desde("203.0.113.10");
    expect(otraVez.status).toBe(429);
    expect(otraVez.headers["retry-after"]).toBe("30");

    ahora += 30_000; // vence la ventana
    expect((await desde("203.0.113.10")).status).toBe(422);
  });

  it("P01 un cuerpo de más de 4 kB responde 413 y un JSON mal formado 400 JSON_INVALIDO, también fuera de /publico (antes daba 500)", async () => {
    const grande = await enviar(solicitud({ nombres: "x".repeat(5000) }));
    expect(grande.status).toBe(413);
    expect(grande.body.error.codigo).toBe("CUERPO_DEMASIADO_GRANDE");

    const malFormado = await request(app).post(RUTA).set("Content-Type", "application/json").send('{"nombres": ');
    expect(malFormado.status).toBe(400);
    expect(malFormado.body.error.codigo).toBe("JSON_INVALIDO");

    // Fuera de /publico, un JSON mal formado también es 400 (antes de HU0001 caía en el 500 genérico)…
    const interna = await request(app).post("/internal/notificaciones").set("Content-Type", "application/json").send('{"id_expediente": ');
    expect(interna.status).toBe(400);
    expect(interna.body.error.codigo).toBe("JSON_INVALIDO");
    // …y rige el límite global de 100 kB: 10 kB llegan a la ruta (aquí, 401 por falta de token), no a un 413.
    const internaGrande = await request(app).post("/internal/notificaciones").send({ relleno: "x".repeat(10_000) });
    expect(internaGrande.status).toBe(401);
  });

  it("P01 con el campo trampa lleno responde la misma 201, no guarda nada ni dispara el evento", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const datos = solicitud({ [CAMPO_TRAMPA]: "Oferta imperdible" });
    const antes = await conteos();
    const res = await enviar(datos);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ estado: "registrada" });
    await sinNadaGuardado(datos.correo, antes);
    expect(eventos.disparar).not.toHaveBeenCalled();
    expect(aviso).toHaveBeenCalledWith("Solicitud de información descartada (campo trampa)");

    // Vacío (lo normal en P01), la solicitud se registra.
    const normal = solicitud({ [CAMPO_TRAMPA]: "" });
    expect((await enviar(normal)).status).toBe(201);
    expect((await guardadoPara(normal.correo)).apoderados).toHaveLength(1);
  });

  it("P01 no envía cabeceras CORS a otro origen y un formulario de otro sitio (text/plain) no se registra", async () => {
    const preflight = await request(app)
      .options(RUTA)
      .set("Origin", "https://otro-sitio.ejemplo")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();

    const conOrigen = await request(app).post(RUTA).set("Origin", "https://otro-sitio.ejemplo").send(solicitud({ acepta_politica: false }));
    expect(conOrigen.headers["access-control-allow-origin"]).toBeUndefined();

    const antes = await conteos();
    const formulario = await request(app).post(RUTA).set("Content-Type", "text/plain").send(JSON.stringify(solicitud()));
    expect(formulario.status).toBe(400);
    expect(formulario.body.error.codigo).toBe("VALIDACION");
    expect(await conteos()).toEqual(antes);
  });
});

describe("C3 repositorio de apoderados", () => {
  it("C3 el repositorio de apoderados cifra el DNI, guarda su hash y no devuelve el DNI cifrado", async () => {
    // DNI ficticio evidente (rules/db.md): 0000 y cuatro cifras al azar, para no chocar dentro de la corrida.
    const dni = `0000${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
    const datos = { nombres: "Con", apellidos: "Dni", telefono: "+51900000000", correo: correoUnico() };

    const id = await insertarApoderado(db(), { ...datos, dni });
    expect(typeof id).toBe("number");
    const { rows: [fila] } = await db().query("SELECT dni_cifrado, dni_hash FROM apoderado WHERE id_apoderado = $1", [id]);
    expect(fila.dni_cifrado).toMatch(/^v1:/);
    expect(fila.dni_cifrado).not.toContain(dni);
    expect(descifrar(fila.dni_cifrado)).toBe(dni);
    expect(fila.dni_hash).toBe(hashDni(dni));
    expect(await existeApoderadoConDni(db(), dni)).toBe(true);
    expect(await existeApoderadoConDni(db(), `${dni}0`)).toBe(false); // 9 dígitos: ninguna prueba lo usa

    // Sin DNI (P01): las dos columnas quedan nulas (ck_apoderado_dni_par).
    const sinDni = await insertarApoderado(db(), { ...datos, correo: correoUnico() });
    const { rows: [vacia] } = await db().query("SELECT dni_cifrado, dni_hash FROM apoderado WHERE id_apoderado = $1", [sinDni]);
    expect(vacia).toEqual({ dni_cifrado: null, dni_hash: null });
  });
});
