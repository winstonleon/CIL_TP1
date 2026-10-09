---
paths:
  - "n8n/**"
---

# Reglas de los workflows de n8n

- Solo existen los 7 flujos del TI: `captacion`, `recepcion-registro`, `verificacion-completitud`, `agendamiento`, `generacion-carta`, `notificacion-multicanal`, `seguimiento-recordatorios`. Archivo: `n8n/workflows/<nombre>.json`. El nombre del workflow es igual al del archivo.
- Usa los tipos de nodo estándar (`n8n-nodes-base.webhook`, `n8n-nodes-base.httpRequest`, `n8n-nodes-base.code`, `n8n-nodes-base.if`, `n8n-nodes-base.switch`, `n8n-nodes-base.executeWorkflow`, `n8n-nodes-base.scheduleTrigger`, `n8n-nodes-base.emailSend`). Verifica con el MCP `n8n-mcp` (`get_node`) los parámetros y la versión de cada nodo antes de escribirlos.
- Valida cada workflow con `validate_workflow` del MCP antes de importarlo.
- Nunca pongas secretos, tokens ni credenciales en el JSON. Referencia las credenciales por nombre y usa `$env` para URLs y secretos de servicio.
- n8n no se conecta a la BD de negocio: todo pasa por `HTTP Request` a `{{$env.API_INTERNAL_URL}}/internal/...`.
- Webhooks de entrada con autenticación por header (`X-Webhook-Secret`).
- Manejo de errores: reintentos en nodos HTTP (`retryOnFail`, 3 intentos con espera) y un Error Workflow que registra el fallo en la API. Un fallo de notificación no detiene el trámite.
- Cada nodo `Code` lleva un comentario inicial que dice qué hace y qué HU o escenario cubre.
- No modifiques workflows directamente en la interfaz de n8n sin exportarlos al repo en el mismo cambio.
