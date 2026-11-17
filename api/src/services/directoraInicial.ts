// C18: cuenta inicial de la Directora en producción. La crea `npm run directora:crear`, que corre dentro del contenedor `api`:
// reutiliza el alta de G10 (HU0021: usuario en Keycloak con su rol y el enlace de 72 h para definir la contraseña, fila activa en
// `personal` y evento gestion_usuario), pero sin una directora que actúe: la bitácora deja el origen del comando.
// Solo corre mientras no haya una directora activa: las demás cuentas se crean en G10, y con una activa este comando sería una
// puerta lateral sin su bitácora de quién la usó.
import { z } from "zod";
import { obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import type { IdentidadAdmin } from "../identidad/keycloakAdmin";
import { existeDirectoraActiva, type FilaPersonal } from "../repositories/personal";
import { validar } from "../validacion";
import { crearPersonalInicial } from "./personal";

const texto = (max: number) => z.string().trim().min(1).max(max);

// Los mismos límites que el alta de G10 (routes/personal.ts): varchar(100), varchar(100) y varchar(150).
const datosDirectora = z
  .object({
    nombres: texto(100),
    apellidos: texto(100),
    correo: z.string().trim().toLowerCase().pipe(z.email().max(150)),
  })
  .strict();

export async function crearDirectoraInicial(identidad: IdentidadAdmin, entrada: unknown): Promise<FilaPersonal> {
  const datos = validar(datosDirectora, entrada);
  if (await existeDirectoraActiva(obtenerPool())) {
    throw new ErrorApi(409, "DIRECTORA_YA_EXISTE", "Ya hay una directora activa: las demás cuentas se crean en G10");
  }
  return crearPersonalInicial(identidad, { ...datos, rol: "directora" });
}
