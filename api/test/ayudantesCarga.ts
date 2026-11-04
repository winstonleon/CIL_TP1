// Fixtures de la carga de documentos y del derecho de admisión (HU0006 y HU0007): archivos ficticios con la firma de cada
// formato, subidas multipart con supertest, subidas crudas por http (para el corte a los 10 MB) y lectura del directorio
// de almacenamiento de la corrida (STORAGE_LOCAL_DIR, ver vitest.config.ts). Datos ficticios @ejemplo.test.
import { readdir } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { Express } from "express";
import type { Consultable } from "../src/db/pool";
import { entornoFicha, fichaCompleta, rutaFicha } from "./ayudantesFicha";

export const MiB = 1024 * 1024;
const relleno = (n: number) => Buffer.alloc(n, 0x20);

// Contenido ficticio con la firma de cada formato admitido (HU0006-1.0) y de los que no lo son (HU0006-2.0).
export const pdf = (marca = "documento ficticio", n = 200) => Buffer.concat([Buffer.from(`%PDF-1.4\n% ${marca}\n`), relleno(n)]);
export const jpg = (n = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), relleno(n)]);
export const png = (n = 200) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), relleno(n)]);
export const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), Buffer.from("[Content_Types].xml"), relleno(100)]);
export const exe = () => Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00"), Buffer.from("This program cannot be run in DOS mode."), relleno(100)]);
// Un PDF de exactamente `bytes` bytes.
export const pdfDe = (bytes: number) => Buffer.concat([Buffer.from("%PDF-1.4\n"), relleno(bytes - 9)]);

export const rutaDocumentos = (idExpediente: number) => `/familia/expedientes/${idExpediente}/documentos`;
export const rutaConfirmacion = (idExpediente: number) => `${rutaDocumentos(idExpediente)}/confirmacion`;
export const rutaArchivo = (idExpediente: number, idDocumento: number | string) => `${rutaDocumentos(idExpediente)}/${idDocumento}/archivo`;
export const rutaDerecho = (idExpediente: number) => `/familia/expedientes/${idExpediente}/derecho-admision`;

export async function archivosAlmacenados(): Promise<string[]> {
  try {
    return await readdir(process.env.STORAGE_LOCAL_DIR!);
  } catch {
    return [];
  }
}

type Campos = Record<string, string | number>;

// POST multipart: los campos primero y el archivo al final, como exige la API.
export function subir(app: Express, ruta: string, token: string, campos: Campos, contenido: Buffer, nombre = "archivo.pdf") {
  let r = request(app).post(ruta).set("Authorization", `Bearer ${token}`);
  for (const [k, v] of Object.entries(campos)) r = r.field(k, String(v));
  return r.attach("archivo", contenido, { filename: nombre, contentType: "application/pdf" });
}

// Una familia con su ficha ya completa (en_postulacion), con los requisitos que `requisitos` cree antes de completarla.
export async function familiaConFicha(
  db: Consultable,
  e: Awaited<ReturnType<typeof entornoFicha>>,
  requisitos: (idGrado: number) => Promise<void> = async () => undefined,
  idGrado?: number,
  cambiosFicha: Parameters<typeof fichaCompleta>[0] = {},
) {
  const f = await e.familia("portal_habilitado", idGrado);
  await requisitos(f.idGrado);
  const res = await e.como(f.token).guardar(rutaFicha(f.idExpediente), fichaCompleta(cambiosFicha));
  if (res.status !== 200) throw new Error(`No se pudo completar la ficha de prueba (${res.status})`);
  const { rows } = await db.query<{ id_apoderado: number }>(
    `SELECT pa.id_apoderado FROM expediente e JOIN postulante_apoderado pa ON pa.id_postulante = e.id_postulante
      WHERE e.id_expediente = $1 AND pa.id_apoderado <> e.id_apoderado_titular`,
    [f.idExpediente],
  );
  return { ...f, idSegundoApoderado: rows[0]!.id_apoderado };
}

interface RespuestaCruda {
  status: number;
  cuerpo: { error?: { codigo?: string } };
}

// POST multipart armado a mano por http para cargas que supertest no permite: sin Content-Length (chunked) o con un
// Content-Length declarado mayor que lo que se envía. Escribe `bytesArchivo` bytes en trozos de 1 MiB y termina cuando
// la API responde (la API responde sin esperar el final del cuerpo).
export async function subirCrudo(
  app: Express,
  ruta: string,
  token: string,
  opciones: { campos: Campos; bytesArchivo: number; contentLength?: number },
): Promise<RespuestaCruda> {
  const servidor = http.createServer(app);
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const puerto = (servidor.address() as AddressInfo).port;
  const limite = "----cil-prueba-limite";
  const cabeza = Buffer.from(
    Object.entries(opciones.campos)
      .map(([k, v]) => `--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
      .join("") +
      `--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="grande.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const cola = Buffer.from(`\r\n--${limite}--\r\n`);
  try {
    return await new Promise<RespuestaCruda>((resolver, rechazar) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: puerto,
          method: "POST",
          path: ruta,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/form-data; boundary=${limite}`,
            ...(opciones.contentLength !== undefined ? { "Content-Length": opciones.contentLength } : { "Transfer-Encoding": "chunked" }),
          },
        },
        (res) => {
          const trozos: Buffer[] = [];
          res.on("data", (t: Buffer) => trozos.push(t));
          res.on("end", () => {
            const texto = Buffer.concat(trozos).toString();
            resolver({ status: res.statusCode!, cuerpo: texto ? JSON.parse(texto) : {} });
            req.destroy();
          });
        },
      );
      // La API puede cortar la conexión tras responder: un error de escritura posterior no es un fallo de la prueba.
      req.on("error", () => undefined);
      setTimeout(() => rechazar(new Error("La API no respondió a tiempo")), 20_000).unref();

      void (async () => {
        const escribir = (b: Buffer) => (req.destroyed || req.write(b) ? Promise.resolve() : new Promise<void>((r) => req.once("drain", r)));
        await escribir(cabeza);
        let enviados = 0;
        const total = opciones.contentLength === undefined ? opciones.bytesArchivo : Math.min(opciones.bytesArchivo, 1024);
        while (enviados < total && !req.destroyed) {
          const n = Math.min(MiB, total - enviados);
          await escribir(enviados === 0 ? Buffer.concat([Buffer.from("%PDF-1.4\n"), relleno(n - 9)]) : relleno(n));
          enviados += n;
        }
        if (!req.destroyed && opciones.contentLength === undefined) req.end(cola);
      })();
    });
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((resolver) => servidor.close(() => resolver()));
  }
}
