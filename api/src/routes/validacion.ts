// Piezas comunes de /bandeja (G02 y G03, Secretaría) y /tesoreria (G05): validación de la decisión, el id del personal
// de la sesión y el envío de un archivo descargado por el personal (mismas cabeceras que la familia, ADR-21).
import type { Request, Response } from "express";
import type { Readable } from "node:stream";
import { z } from "zod";
import { obtenerPool } from "../db/pool";
import { actor } from "../services/actor";
import { TIPO_CONTENIDO } from "../services/documentos";
import type { FormatoArchivo } from "../services/cargaArchivo";
import { LARGO_MAXIMO_MOTIVO, type Decision } from "../services/validaciones";
import { validar } from "../validacion";

export const idRuta = z.coerce.number().int().positive().max(2147483647);

export const esquemaDecision: z.ZodType<Decision> = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("conforme") }).strict(),
  z.object({ decision: z.literal("observado"), motivo: z.string().trim().min(1).max(LARGO_MAXIMO_MOTIVO) }).strict(),
]);

export const esquemaVacio = z.object({}).strict();

export const leerDecision = (req: Request) => validar(esquemaDecision, req.body);

// La fila en personal ya la exigió requirePersonalActivo (C22).
export async function idPersonalDe(req: Request): Promise<number> {
  return (await actor(obtenerPool(), req.usuario!.sub)).idPersonal!;
}

// Defensa contra que el navegador interprete el archivo como página: tipo fijo, sin sniffing, en sandbox y sin caché.
export function enviarArchivo(res: Response, formato: FormatoArchivo, nombre: string, contenido: Readable | Buffer) {
  res.set({
    "Content-Type": TIPO_CONTENIDO[formato],
    "Content-Disposition": `inline; filename="${nombre}.${formato}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "no-store",
  });
  if (Buffer.isBuffer(contenido)) res.send(contenido);
  else contenido.pipe(res);
}
