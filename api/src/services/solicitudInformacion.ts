// Solicitud de información y consentimiento (HU0001, pantalla P01, sin sesión).
// R1: sin consentimiento no se almacena ningún dato (lo comprueba la ruta antes de validar lo demás); con él, el
// apoderado, el consentimiento y el expediente se crean en UNA transacción. El expediente nace en `prospecto` y sin
// postulante. La creación no se audita (plan HU0001, P2): queda en expediente.fecha_registro y en
// consentimiento.fecha_hora_aceptacion. El mismo correo dos veces crea filas nuevas (P1, brecha C28).
import { enTransaccion, obtenerPool } from "../db/pool";
import { ErrorApi } from "../errores";
import { insertarApoderado } from "../repositories/apoderado";
import { insertarConsentimiento, type CanalOrigen } from "../repositories/consentimiento";
import { insertarExpediente } from "../repositories/expediente";
import { existeGrado, listarGradosPublicos, type GradoPublico } from "../repositories/grado";
import { POLITICA_PRIVACIDAD } from "./politicaPrivacidad";

// Valores de canal_origen (varchar(30) sin CHECK): los de la nota «p. ej.» del modelo de datos (ADR-10: si cambian,
// cambia también este código y el de P01).
export const CANALES_ORIGEN = ["facebook", "instagram", "formulario_web"] as const satisfies readonly CanalOrigen[];

export interface FormularioSolicitud {
  campana: string;
  politica: { version: string; texto: string };
  grados: GradoPublico[];
}

// GET /publico/solicitud-informacion: solo lo que P01 necesita mostrar (sin vacantes ni cuotas).
export async function formularioSolicitud(campana: string): Promise<FormularioSolicitud> {
  return {
    campana,
    politica: { version: POLITICA_PRIVACIDAD.version, texto: POLITICA_PRIVACIDAD.texto },
    grados: await listarGradosPublicos(obtenerPool(), campana),
  };
}

export interface DatosSolicitud {
  nombres: string;
  apellidos: string;
  telefono: string; // ya normalizado a E.164
  correo: string; // ya en minúsculas
  id_grado: number;
  autoriza_whatsapp: boolean;
  canal_origen: CanalOrigen;
}

// Devuelve el id del expediente para el evento hacia n8n; la ruta no lo envía al cliente.
export async function registrarSolicitud(campana: string, d: DatosSolicitud): Promise<number> {
  return enTransaccion(async (c) => {
    if (!(await existeGrado(c, campana, d.id_grado))) {
      // Mismo formato que validar(): el grado no existe o es de otra campaña.
      throw new ErrorApi(400, "VALIDACION", "Datos inválidos: id_grado");
    }
    const idApoderado = await insertarApoderado(c, {
      nombres: d.nombres,
      apellidos: d.apellidos,
      telefono: d.telefono,
      correo: d.correo,
    });
    await insertarConsentimiento(c, {
      idApoderado,
      versionPolitica: POLITICA_PRIVACIDAD.version, // la vigente del servidor, nunca la que envíe el cliente
      canalOrigen: d.canal_origen,
      autorizaWhatsapp: d.autoriza_whatsapp,
    });
    return insertarExpediente(c, { idApoderadoTitular: idApoderado, idGrado: d.id_grado });
  });
}
