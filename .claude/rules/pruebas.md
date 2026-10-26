# Reglas de pruebas

- Cada escenario de aceptación tiene al menos una prueba, y el nombre de la prueba empieza con el ID exacto del escenario: `it('HU0017-2.0 mantiene el expediente en postulación si falta un documento', ...)`.
- Prueba el comportamiento observable por la interfaz pública (HTTP, pantalla). No pruebes detalles internos.
- Las pruebas de autorización por rol (403 y auditoría del intento) son obligatorias cuando la HU toca datos restringidos.
- Las pruebas no dependen de servicios externos reales: el correo va a Mailpit y n8n se simula o se usa la instancia de pruebas.
- No marques una prueba como `skip` ni la modifiques para que la suite pase (tampoco los scripts de verificación, como `scripts/verificar-infra.mjs`). Si falla, se reporta, y la corrección va en la configuración (compose, realm, init de Postgres) o en el código de producción. Si la prueba parece mal planteada, me detengo y le explico a John por qué, y espero su decisión antes de cambiarla.
- La salida de las suites se muestra completa, sin `grep` ni otros filtros que oculten líneas. También vale redirigirla a un log y mostrar el log entero.
- Si una suite falla entera sin ejecutar ninguna prueba (p. ej. «10 failed, no tests»), guardo el log completo en el scratchpad, investigo la causa y se la reporto a John **antes** de reintentar.

**Por qué:** las pruebas son evidencia académica (ABET). Ajustarlas para que pasen invalida la evidencia, y un fallo sin explicar no vale. En el tramo C1 del Sprint 0 (10/10/2026), una corrida de `test:api` falló entera, el filtro ocultó el mensaje y, al reintentar, pasó sin que se supiera la causa.
