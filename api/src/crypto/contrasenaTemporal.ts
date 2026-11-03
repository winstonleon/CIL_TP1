// Contraseña temporal de la familia (HU0004-1.0, ADR-02 D3). La API la genera solo al reservar el aviso de
// credenciales y la devuelve únicamente en esa respuesta: nunca se guarda ni se escribe en un log.
// 16 caracteres con mayúsculas, minúsculas, dígitos y símbolos, sin los ambiguos 0, O, 1, l ni I (A7), para que la
// familia la copie del correo sin errores. La política de contraseñas del realm es provisional (D6, C6).
import { randomInt } from "node:crypto";

const MAYUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O
const MINUSCULAS = "abcdefghijkmnopqrstuvwxyz"; // sin l
const DIGITOS = "23456789"; // sin 0 ni 1
const SIMBOLOS = "!#$%*+-=?@"; // se leen igual en un correo de texto plano

export const CLASES_CONTRASENA = [MAYUSCULAS, MINUSCULAS, DIGITOS, SIMBOLOS] as const;
export const LARGO_CONTRASENA_TEMPORAL = 16;

export function generarContrasenaTemporal(): string {
  const todos = CLASES_CONTRASENA.join("");
  // Un carácter de cada clase y el resto de cualquiera; después se mezcla (Fisher-Yates) con randomInt.
  const caracteres = CLASES_CONTRASENA.map((clase) => clase[randomInt(clase.length)]!);
  while (caracteres.length < LARGO_CONTRASENA_TEMPORAL) caracteres.push(todos[randomInt(todos.length)]!);
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j]!, caracteres[i]!];
  }
  return caracteres.join("");
}
