---
paths:
  - "n8n/**"
---

# Reglas de los workflows de n8n

- Solo existen los 7 flujos del TI: `captacion`, `recepcion-registro`, `verificacion-completitud`, `agendamiento`, `generacion-carta`, `notificacion-multicanal`, `seguimiento-recordatorios`. Archivo: `n8n/workflows/<nombre>.json`. El nombre del workflow es igual al del archivo.
- Única excepción: el workflow técnico `registro-errores` (C2, ADR-06), que no cuenta entre los 7. No se agregan otros workflows técnicos sin aprobación.
- Usa los tipos de nodo estándar (`n8n-nodes-base.webhook`, `n8n-nodes-base.respondToWebhook`, `n8n-nodes-base.httpRequest`, `n8n-nodes-base.code`, `n8n-nodes-base.if`, `n8n-nodes-base.switch`, `n8n-nodes-base.set`, `n8n-nodes-base.noOp`, `n8n-nodes-base.stopAndError`, `n8n-nodes-base.executeWorkflow`, `n8n-nodes-base.executeWorkflowTrigger`, `n8n-nodes-base.scheduleTrigger`, `n8n-nodes-base.emailSend`). `n8n-nodes-base.errorTrigger` va solo en `registro-errores`. Verifica con el MCP `n8n-mcp` (`get_node`) los parámetros y la versión de cada nodo antes de escribirlos.
- Valida cada workflow con `validate_workflow` del MCP antes de importarlo.
- Los secretos (tokens, contraseñas, claves) van **siempre** en credenciales de n8n, referenciadas en el JSON solo por nombre (sin ID). Nunca en el JSON ni en `$env`. `$env` es solo para configuración no secreta: URLs, banderas como `WHATSAPP_ENABLED`, remitente.
- n8n no se conecta a la BD de negocio: todo pasa por `HTTP Request` a `{{$env.API_INTERNAL_URL}}/internal/...`, autenticado con la credencial Header Auth `cil-api-interna`.
- Webhooks de entrada con autenticación por header (`X-Webhook-Secret`).
- Manejo de errores: reintentos en nodos HTTP (`retryOnFail`, 3 intentos con espera) y un Error Workflow que registra el fallo en la API. Un fallo de notificación no detiene el trámite.
  - Cada flujo declara `settings.errorWorkflow: "registro-errores"` por nombre. Lo mismo vale para el flujo que llama un nodo Execute Workflow: el JSON lleva el nombre, nunca el ID. `npm run n8n:importar` los resuelve al importar y deja otra vez el nombre al exportar.
  - `registro-errores` envía a `/internal/errores-flujo` solo el flujo, el nodo y el id de la ejecución, nunca el mensaje del error.
  - Todo flujo que llama a `notificacion-multicanal` maneja sus errores con `onError` en el nodo Execute Workflow (C9).
- Cada nodo `Code` lleva un comentario inicial que dice qué hace y qué HU o escenario cubre.
- No modifiques workflows directamente en la interfaz de n8n sin exportarlos al repo en el mismo cambio.
