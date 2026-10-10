import express, { type Express } from "express";
import { manejadorErrores, noEncontrado } from "./errores";
import { rutaSalud } from "./routes/salud";

export function crearApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use(rutaSalud);
  // Las rutas de cada HU se montan aquí con crearVerificarToken(...) y requireRol(...).

  app.use(noEncontrado);
  app.use(manejadorErrores);
  return app;
}
