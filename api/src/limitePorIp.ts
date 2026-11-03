// Límite de peticiones por IP para las rutas públicas (ADR-17, HU0001): ventana fija contada en memoria. Basta porque
// hay una sola instancia de la API; con varias haría falta un almacén compartido. req.ip es la IP que informa el
// único proxy de delante (app.set("trust proxy", 1)): NGINX en prod (C19). En dev, Vite no envía X-Forwarded-For y
// todo el tráfico que pasa por él comparte un contador. El contador no guarda nada más que la IP y la cuenta.
import type { RequestHandler } from "express";
import { ErrorApi } from "./errores";

export interface OpcionesLimite {
  maximo: number; // peticiones permitidas por IP en cada ventana
  ventanaMs: number;
  ahora?: () => number; // reloj inyectable para las pruebas
}

// Plan HU0001, P7: 5 envíos por IP cada 10 minutos.
export const LIMITE_PUBLICO: OpcionesLimite = { maximo: 5, ventanaMs: 10 * 60 * 1000 };

// GET de P02 (HU0003, A6): 60 lecturas por IP cada 10 minutos. Es el único GET público limitado porque devuelve datos
// de una familia (nombre y grado) a quien tenga el enlace.
export const LIMITE_LECTURA_VISITA: OpcionesLimite = { maximo: 60, ventanaMs: 10 * 60 * 1000 };

export function limitePorIp({ maximo, ventanaMs, ahora = Date.now }: OpcionesLimite): RequestHandler {
  const ventanas = new Map<string, { inicio: number; cuenta: number }>();
  let ultimaPurga = ahora();

  return (req, res, next) => {
    const t = ahora();
    // Una vez por ventana se descartan las IP cuya ventana ya venció: la memoria no crece sin límite.
    if (t - ultimaPurga >= ventanaMs) {
      for (const [ip, v] of ventanas) if (t - v.inicio >= ventanaMs) ventanas.delete(ip);
      ultimaPurga = t;
    }
    const ip = req.ip ?? "desconocida";
    let ventana = ventanas.get(ip);
    if (!ventana || t - ventana.inicio >= ventanaMs) {
      ventana = { inicio: t, cuenta: 0 };
      ventanas.set(ip, ventana);
    }
    ventana.cuenta += 1;
    if (ventana.cuenta > maximo) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((ventana.inicio + ventanaMs - t) / 1000))));
      throw new ErrorApi(
        429,
        "DEMASIADAS_SOLICITUDES",
        "Recibimos varias solicitudes desde tu conexión. Vuelve a intentarlo en unos minutos.",
      );
    }
    next();
  };
}
