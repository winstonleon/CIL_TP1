// Alta manual de cuentas de familia (comando `npm run familias:crear`, solo lo corre un técnico dentro del contenedor `api`).
// Sirve para dar acceso al portal a familias que el colegio ya conoce, sin pasar por P01, P02 y G04. Por cada familia, en una
// transacción: apoderado, consentimiento (canal `alta_manual`), expediente `prospecto` → `portal_habilitado` (con la bitácora),
// usuario de Keycloak con el rol `familia` y una contraseña temporal con UPDATE_PASSWORD (ADR-02, D3).
// La contraseña solo se devuelve a quien corre el comando: no se guarda, no se audita y no se registra en ningún log.
// Una familia que falla no deshace a las demás; cada una se compensa como el alta de G04 (compensarAlta).
import { z } from "zod";
import { enTransaccion } from "../db/pool";
import { ErrorApi } from "../errores";
import { generarContrasenaTemporal } from "../crypto/contrasenaTemporal";
import { ORIGEN_FAMILIA, type IdentidadAdmin } from "../identidad/keycloakAdmin";
import { existeApoderadoConCorreo, insertarApoderado } from "../repositories/apoderado";
import { insertarConsentimiento } from "../repositories/consentimiento";
import { insertarCuentaAcceso } from "../repositories/cuentaAcceso";
import { insertarExpediente } from "../repositories/expediente";
import { existeGrado } from "../repositories/grado";
import { validar } from "../validacion";
import { compensarAlta } from "./altaIdentidad";
import { transicionarExpediente, TRANSICIONES_PERMITIDAS } from "./expedientes/transicionarExpediente";
import { POLITICA_PRIVACIDAD } from "./politicaPrivacidad";
import { LARGO_MAXIMO, correoValido, normalizarTelefono } from "./reglasSolicitud";
import { validarResponsable } from "./responsable";

const texto = (max: number) => z.string().trim().min(1).max(max);

const datosFamilia = z
  .object({
    correo: z
      .string()
      .trim()
      .toLowerCase()
      .refine(correoValido),
    nombres: texto(LARGO_MAXIMO.nombres),
    apellidos: texto(LARGO_MAXIMO.apellidos),
    telefono: z
      .string()
      .trim()
      .transform((t, ctx) => {
        const e164 = normalizarTelefono(t);
        if (e164 === null) ctx.addIssue({ code: "custom", message: "telefono" });
        return e164 as string;
      }),
    id_grado: z.number().int().positive(),
  })
  .strict();

const entradaFamilias = z.object({ familias: z.array(datosFamilia).min(1).max(20) }).strict();

// Solo para esta alta: la matriz global no admite `prospecto → portal_habilitado` (la familia pasa por la visita).
const PERMITIDAS_ALTA_MANUAL = { ...TRANSICIONES_PERMITIDAS, estado: [["prospecto", "portal_habilitado"]] as const };

export interface ResultadoAlta {
  correo: string;
  id_expediente?: number;
  contrasena_temporal?: string;
  error?: string;
}

async function crearFamilia(identidad: IdentidadAdmin, campana: string, f: z.infer<typeof datosFamilia>, responsable: string) {
  let idIdentidad: string | null = null;
  let paso = "crear_usuario";
  try {
    return await enTransaccion(async (c) => {
      if (!(await existeGrado(c, campana, f.id_grado))) throw new ErrorApi(400, "VALIDACION", "El grado no existe en la campaña activa");
      if (await existeApoderadoConCorreo(c, f.correo)) {
        throw new ErrorApi(409, "CORREO_CON_CUENTA", "Ya hay un apoderado con ese correo; no se creó la cuenta");
      }
      const idApoderado = await insertarApoderado(c, { nombres: f.nombres, apellidos: f.apellidos, telefono: f.telefono, correo: f.correo });
      await insertarConsentimiento(c, {
        idApoderado,
        versionPolitica: POLITICA_PRIVACIDAD.version,
        canalOrigen: "alta_manual",
        autorizaWhatsapp: false,
      });
      const idExpediente = await insertarExpediente(c, { idApoderadoTitular: idApoderado, idGrado: f.id_grado });

      const creado = await identidad.crearUsuario({ correo: f.correo, nombres: f.nombres, apellidos: f.apellidos }, ORIGEN_FAMILIA);
      if (creado === null) throw new ErrorApi(409, "CORREO_CON_CUENTA", "El correo ya tiene una cuenta en Keycloak; no se creó la cuenta");
      idIdentidad = creado;
      paso = "asignar_rol";
      await identidad.establecerRolUnico(idIdentidad, "familia");
      paso = "registrar";
      await insertarCuentaAcceso(c, idApoderado, idIdentidad);
      await transicionarExpediente(
        c,
        {
          idExpediente,
          campo: "estado",
          esperado: "prospecto",
          nuevo: "portal_habilitado",
          idPersonal: null,
          detalle: { origen: "comando_familias_crear", responsable },
        },
        PERMITIDAS_ALTA_MANUAL,
      );
      paso = "contrasena";
      const contrasena = generarContrasenaTemporal();
      await identidad.establecerContrasenaTemporal(idIdentidad, contrasena);
      paso = "habilitar";
      await identidad.habilitar(idIdentidad);
      paso = "confirmar";
      return { id_expediente: idExpediente, contrasena_temporal: contrasena };
    });
  } catch (e) {
    if (idIdentidad) await compensarAlta(identidad, idIdentidad, paso, "familia");
    throw e;
  }
}

export async function crearFamiliasIniciales(
  identidad: IdentidadAdmin,
  campana: string,
  entrada: unknown,
  responsable: string | undefined,
  consentimientoConfirmado: boolean,
): Promise<ResultadoAlta[]> {
  const quien = validarResponsable(responsable, true)!;
  if (!consentimientoConfirmado) {
    throw new ErrorApi(400, "CONSENTIMIENTO_NO_CONFIRMADO", "Confirma con --consentimiento-confirmado que cada familia aceptó la política de privacidad");
  }
  const { familias } = validar(entradaFamilias, entrada);
  const repetidos = familias.filter((f, i) => familias.findIndex((g) => g.correo === f.correo) !== i);
  if (repetidos.length) throw new ErrorApi(400, "VALIDACION", "Datos inválidos: correo repetido");

  const resultados: ResultadoAlta[] = [];
  for (const f of familias) {
    try {
      resultados.push({ correo: f.correo, ...(await crearFamilia(identidad, campana, f, quien)) });
    } catch (e) {
      resultados.push({ correo: f.correo, error: e instanceof ErrorApi ? `${e.codigo}: ${e.message}` : "No se pudo crear la cuenta" });
    }
  }
  return resultados;
}
