<#--
  P03 · Acceso al portal de postulación y P03c · Cuenta bloqueada (HU0023). login.ftl lo incluye solo para portal-familias.
  Conserva los ids que esperan Keycloak y las pruebas: kc-form-login (con id antes de action, S0-A4), username, password y
  kc-login (S0-C6).
  P03c (HU0023-2.0, D6-A): Keycloak responde a la cuenta bloqueada con la clave accountTemporarilyDisabledMessage, a la que
  messages_es.properties da un texto propio. Aparece en el intento siguiente al quinto fallo: hasta entonces Keycloak no sabe
  que la cuenta quedó bloqueada.
  Desvíos de los mockups: sin logo hasta que el colegio entregue el archivo (P5 de HU0021); el aviso de P03 dice «Si es tu
  primer ingreso…», porque el tema no puede saber si lo es; «Aún no visito el colegio» lleva a P01, porque P02 exige el
  enlace de la carpeta; los corchetes son textos que entrega el colegio (C6, C42) y los textos sin mockup se confirman con él (C81).
-->
<#assign errorDeCampos = messagesPerField.existsError('username','password')>
<#assign errorCampos = errorDeCampos?then(messagesPerField.getFirstError('username','password'), '')>
<#assign bloqueada = errorDeCampos && errorCampos == msg('accountTemporarilyDisabledMessage')>
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title><#if bloqueada>Cuenta bloqueada · Portal de Postulación<#else>Portal de Postulación · Acceso</#if></title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/g01.css">
  <link rel="stylesheet" href="${url.resourcesPath}/css/p03.css">
</head>
<body>
<div class="g01">
  <#include "p03-panel.ftl">

  <main class="g01-principal">
    <#if bloqueada>
    <section class="g01-tarjeta" aria-labelledby="p03c-titulo" data-pantalla="P03c">
      <div class="g01-cabecera">
        <span class="p03-candado" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        </span>
        <h1 id="p03c-titulo">Cuenta bloqueada temporalmente</h1>
        <p class="p03-detalle">Por tu seguridad bloqueamos el acceso de <strong>${(login.username!'')}</strong> después de <strong>5 intentos fallidos consecutivos</strong>.</p>
      </div>
      <div class="p03-alerta" role="alert" id="kc-mensaje">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5"/><path d="M12 16.5v.5"/><path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
        <p>Podrás volver a intentarlo en [tiempo de bloqueo por definir]. <#if realm.resetPasswordAllowed>Si no recuerdas tu contraseña, recupérala ahora: te enviaremos un enlace a tu correo.<#else>Si no recuerdas tu contraseña, comunícate con Secretaría de Admisión.</#if></p>
      </div>
      <#if realm.resetPasswordAllowed>
        <a class="g01-boton" id="p03c-recuperar" href="${url.loginResetCredentialsUrl}">Recuperar contraseña</a>
      </#if>
      <a class="g01-boton p03-boton-secundario" id="p03c-volver" href="${url.loginRestartFlowUrl}">Volver al inicio de sesión</a>
      <span class="p03-ayuda">¿Necesitas ayuda? Secretaría de Admisión · [Teléfono y correo de admisión]</span>
    </section>
    <#else>
    <section class="g01-tarjeta" aria-labelledby="p03-titulo" data-pantalla="P03">
      <div class="g01-cabecera">
        <h1 id="p03-titulo">Portal de Postulación</h1>
        <p>Ingresa con las credenciales que te enviamos después de tu visita guiada.</p>
      </div>

      <#-- Mensajes globales de Keycloak (p. ej. sesión vencida o el correo de recuperación enviado). Los de usuario o
           contraseña incorrectos van junto a los campos. -->
      <#if !errorDeCampos && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
        <div class="g01-mensaje g01-mensaje-${message.type}" role="alert" id="kc-mensaje">${message.summary}</div>
      </#if>

      <#if realm.password>
      <form id="kc-form-login" action="${url.loginAction}" method="post" novalidate="novalidate"
            onsubmit="document.getElementById('kc-login').disabled = true; return true;">
        <#if !usernameHidden??>
        <div class="g01-campo">
          <label for="username">Correo electrónico <span class="g01-obligatorio" aria-hidden="true">*</span></label>
          <input id="username" name="username" type="email" value="${(login.username!'')}" autocomplete="username"
                 autofocus aria-invalid="<#if errorDeCampos>true<#else>false</#if>"
                 <#if errorDeCampos>aria-describedby="input-error"</#if>>
        </div>
        </#if>
        <div class="g01-campo">
          <label for="password">Contraseña <span class="g01-obligatorio" aria-hidden="true">*</span></label>
          <input id="password" name="password" type="password" autocomplete="current-password"
                 <#if usernameHidden??>autofocus</#if> aria-invalid="<#if errorDeCampos>true<#else>false</#if>"
                 <#if errorDeCampos>aria-describedby="input-error"</#if>>
        </div>
        <#if errorDeCampos>
          <p class="g01-error" id="input-error" aria-live="polite">${errorCampos}</p>
        </#if>
        <div class="g01-aviso">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.5"/></svg>
          <p>Si es tu primer ingreso, al continuar te pediremos crear una contraseña nueva.</p>
        </div>
        <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
        <button id="kc-login" name="login" type="submit" class="g01-boton">Ingresar</button>
      </form>
      </#if>

      <div class="p03-enlaces">
        <#if realm.resetPasswordAllowed>
          <a href="${url.loginResetCredentialsUrl}">¿Olvidaste tu contraseña?</a>
        </#if>
        <#if properties.portalPublico?has_content>
          <a href="${properties.portalPublico?remove_ending('/')}/solicitud-informacion">Aún no visito el colegio</a>
        </#if>
      </div>
    </section>
    </#if>
  </main>
</div>
</body>
</html>
