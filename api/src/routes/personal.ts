// /personal — cuentas del personal (HU0021, pantalla G10). Solo la directora: el router se monta en
// app.ts detrás de verificarToken y requireRol("directora").
import { Router } from "express";
import { z } from "zod";
import { RECURSOS_RESTRINGIDOS } from "../auth/accesoRestringido";
import { ROLES_PERSONAL, type IdentidadAdmin } from "../identidad/keycloakAdmin";
import { crearPersonal, desactivarPersonal, listarPersonal, modificarPersonal } from "../services/personal";
import { validar } from "../validacion";

const texto = (max: number) => z.string().trim().min(1).max(max);
const rol = z.enum(ROLES_PERSONAL);
const idPersonal = z.coerce.number().int().positive();

const cuerpoAlta = z
  .object({
    nombres: texto(100),
    apellidos: texto(100),
    correo: z.string().trim().toLowerCase().pipe(z.email().max(150)),
    rol,
  })
  .strict();

// El correo no se modifica (plan HU0021, Q1): un campo desconocido, como `correo`, es un 400.
const cuerpoCambio = z
  .object({ nombres: texto(100).optional(), apellidos: texto(100).optional(), rol: rol.optional() })
  .strict()
  .refine((c) => Object.values(c).some((v) => v !== undefined), { message: "sin cambios" });

export function rutasPersonal(identidad: IdentidadAdmin): Router {
  const rutas = Router();

  // GET /personal → [{ id_personal, nombres, apellidos, correo, rol, activo }]
  rutas.get("/", async (_req, res) => {
    res.json(await listarPersonal());
  });

  // GET /personal/permisos → roles con acceso a la información restringida (matriz «Permisos por rol» de G10)
  rutas.get("/permisos", (_req, res) => {
    res.json(RECURSOS_RESTRINGIDOS);
  });

  // POST /personal { nombres, apellidos, correo, rol } → 201 (HU0021-1.0)
  rutas.post("/", async (req, res) => {
    const datos = validar(cuerpoAlta, req.body);
    res.status(201).json(await crearPersonal(identidad, req.usuario!.sub, datos));
  });

  // PATCH /personal/:id { nombres?, apellidos?, rol? } → 200 (HU0021-3.0)
  rutas.patch("/:id", async (req, res) => {
    const id = validar(idPersonal, req.params.id);
    res.json(await modificarPersonal(identidad, req.usuario!.sub, id, validar(cuerpoCambio, req.body)));
  });

  // POST /personal/:id/desactivacion → 200 (HU0021-4.0)
  rutas.post("/:id/desactivacion", async (req, res) => {
    const id = validar(idPersonal, req.params.id);
    res.json(await desactivarPersonal(identidad, req.usuario!.sub, id));
  });

  return rutas;
}
