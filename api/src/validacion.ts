// Validación de entrada con zod (ADR-01). El error nombra los campos inválidos, nunca sus valores.
import type { z } from "zod";
import { ErrorApi } from "./errores";

export function validar<T>(esquema: z.ZodType<T>, valor: unknown): T {
  const r = esquema.safeParse(valor);
  if (!r.success) {
    const campos = [...new Set(r.error.issues.map((i) => i.path.join(".") || "cuerpo"))].join(", ");
    throw new ErrorApi(400, "VALIDACION", `Datos inválidos: ${campos}`);
  }
  return r.data;
}
