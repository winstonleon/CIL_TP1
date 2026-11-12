<#--
  P03b · Crear contraseña nueva (HU0023-1.0). login-update-password.ftl lo incluye solo para portal-familias. Keycloak lo
  muestra en el primer ingreso con la contraseña temporal (UPDATE_PASSWORD, ADR-02 y D3) y también al recuperar la
  contraseña con el enlace del correo: en ese caso la acción va a /login-actions/reset-credentials y el texto no dice que es
  el primer ingreso.
  Conserva los nombres e ids que espera Keycloak y las pruebas: kc-passwd-update-form, password-new y password-confirm.
  La política de contraseñas sigue provisional y vacía (C6, ADR-02 PENDIENTE): los requisitos van entre corchetes, como en
  el mockup, hasta que el colegio los defina. Sin logo (P5 de HU0021).
-->
<#assign errorDeCampos = messagesPerField.existsError('password','password-confirm')>
<#assign recuperacion = url.loginAction?contains("/reset-credentials")>
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Crea tu contraseña nueva · Portal de Postulación</title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/g01.css">
  <link rel="stylesheet" href="${url.resourcesPath}/css/p03.css">
</head>
<body>
<div class="g01">
  <#include "p03-panel.ftl">

  <main class="g01-principal">
    <section class="g01-tarjeta" aria-labelledby="p03b-titulo" data-pantalla="P03b">
      <div class="g01-cabecera">
        <h1 id="p03b-titulo">Crea tu contraseña nueva</h1>
        <#if recuperacion>
          <p>Elige una contraseña nueva para tu cuenta.</p>
        <#else>
          <p>Es tu primer ingreso. Reemplaza la contraseña temporal que te enviamos por una propia.</p>
        </#if>
      </div>

      <#-- El aviso de Keycloak «debe cambiar su contraseña» (warning) ya lo dice el texto de arriba: solo se muestran errores. -->
      <#if !errorDeCampos && message?has_content && message.type == 'error'>
        <div class="g01-mensaje g01-mensaje-error" role="alert" id="kc-mensaje">${message.summary}</div>
      </#if>

      <form id="kc-passwd-update-form" action="${url.loginAction}" method="post" novalidate="novalidate"
            onsubmit="document.getElementById('kc-submit').disabled = true; return true;">
        <div class="g01-campo">
          <label for="password-new">Contraseña nueva <span class="g01-obligatorio" aria-hidden="true">*</span></label>
          <input id="password-new" name="password-new" type="password" autocomplete="new-password" autofocus
                 aria-invalid="<#if messagesPerField.existsError('password')>true<#else>false</#if>"
                 <#if messagesPerField.existsError('password')>aria-describedby="error-password"</#if>>
          <#if messagesPerField.existsError('password')>
            <p class="g01-error p03-error-campo" id="error-password" aria-live="polite">${messagesPerField.get('password')}</p>
          </#if>
        </div>
        <div class="g01-campo">
          <label for="password-confirm">Confirma la contraseña nueva <span class="g01-obligatorio" aria-hidden="true">*</span></label>
          <input id="password-confirm" name="password-confirm" type="password" autocomplete="new-password"
                 aria-invalid="<#if messagesPerField.existsError('password-confirm')>true<#else>false</#if>"
                 <#if messagesPerField.existsError('password-confirm')>aria-describedby="error-password-confirm"</#if>>
          <#if messagesPerField.existsError('password-confirm')>
            <p class="g01-error p03-error-campo" id="error-password-confirm" aria-live="polite">${messagesPerField.get('password-confirm')}</p>
          </#if>
        </div>

        <div class="p03-politica">
          <span class="p03-politica-titulo">Tu contraseña debe cumplir con:</span>
          <ul>
            <li><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>[Requisito 1 de la política por definir]</li>
            <li><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>[Requisito 2 de la política por definir]</li>
            <li><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>[Requisito 3 de la política por definir]</li>
          </ul>
          <span class="p03-politica-nota">[Política de seguridad de la contraseña por definir]</span>
        </div>

        <button id="kc-submit" name="login" type="submit" class="g01-boton">Guardar contraseña e ingresar</button>
      </form>
    </section>
  </main>
</div>
</body>
</html>
