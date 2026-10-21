Empezar algo solía venir con tres condiciones que nadie dejaba por escrito.

Necesitabas una **cuenta**, porque lo primero que hacía la página era llamar a un servidor, y el servidor quería saber quién preguntaba. Necesitabas una **GPU**, porque ejecutar un modelo en tu propia máquina significaba WebGPU, y a un portátil sin una tarjeta capaz se le decía, con educación, que usara la nube. Y necesitabas **red**, porque entraras por donde entraras, las palabras que escribías se iban a alguna parte.

Ninguna de esas es una razón para que alguien deje de pensar. Una idea a las once de la noche, en un portátil de trabajo con gráficos integrados, en un tren, sigue siendo una idea. Esta versión elimina las tres condiciones y añade lo que debería haber venido con ellas desde el principio: una elección clara sobre adónde pueden ir tus palabras.

```bf-figure
{
  "kind": "compare",
  "title": "Lo que hacía falta para hacer la primera pregunta",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Crear una cuenta", "Esperar a que el espacio de trabajo llamara al servidor", "Tener una GPU con WebGPU, o usar la nube", "Estar en línea", "Confiar en el valor por defecto sobre adónde van tus palabras"] },
    { "title": "Ahora", "hue": "idea", "items": ["Abre Studio o Rovr", "Responde un modelo en este dispositivo", "En la GPU si la tienes, en la CPU si no", "Sin conexión una vez descargado", "Elige Solo local, Híbrido o Específico, y ve cuándo cambia"] }
  ],
  "caption": "Iniciar sesión sigue mereciendo la pena —Híbrido por defecto, sincronización, cuentas conectadas y memoria—, pero ahora es algo que eliges, no una barrera delante de la primera palabra."
}
```

## Una pregunta, la misma en cada superficie

Abre el menú `/` en el compositor, elige **Model (Modelo)** y lo primero que verás es **Ejecutar modelos**. Tiene tres respuestas, y significan lo mismo en builderforce.ai, en la extensión de VS Code y en el panel lateral de Rovr en Chrome.

```bf-figure
{
  "kind": "screen",
  "frame": "Menú / · Modelo · Ejecutar modelos",
  "ratio": 1.7,
  "regions": [
    { "label": "Solo local", "note": "Solo modelos en este dispositivo. Nada se envía a la nube: ni un prompt, ni una conexión en vivo", "x": 3, "y": 8, "w": 94, "h": 22, "hue": "good" },
    { "label": "Híbrido · Recomendado", "note": "Primero este dispositivo, luego la nube cuando hace falta, y un aviso cuando ocurre", "x": 3, "y": 36, "w": 94, "h": 22, "hue": "idea" },
    { "label": "Modelo específico", "note": "El modelo que eliges siempre se ejecuta: un modelo en la nube, una de tus cuentas conectadas o un modelo local", "x": 3, "y": 64, "w": 94, "h": 22, "hue": "make" },
    { "label": "Cámbialo cuando quieras", "x": 3, "y": 90, "w": 40, "h": 7, "hue": "accent" }
  ],
  "caption": "Tres respuestas, no una página de ajustes. Las mismas tres en la web, en tu editor y en el panel lateral del navegador, así que una elección que haces una vez significa lo mismo dondequiera que trabajes."
}
```

**Solo local** es una promesa, no una preferencia. En ese modo, las solicitudes con contenido se bloquean antes de salir, y también las conexiones en vivo: los canales que de otro modo sincronizarían un lienzo o transmitirían una ejecución a un servidor. Si ningún modelo de este dispositivo puede responder, se te dice y se te ofrecen dos salidas: descargar uno o cambiar a Híbrido. Nada se va a la nube en silencio en tu nombre.

**Híbrido** es el modo por defecto en cuanto inicias sesión. Un modelo de tu dispositivo toma el turno primero; cuando no puede, lo toma el nivel gratuito de la nube; y cuando se produce ese cambio ves un aviso, así que siempre sabes de qué lado de la línea vino cada respuesta.

**Modelo específico** es estricto. Eliges un modelo y se ejecuta ese modelo: sin sustituciones, sin un plan B disfrazado de lo que pediste. Es el modo para una comparación, una prueba de rendimiento o una tarea en la que simplemente sabes qué modelo quieres.

```bf-figure
{
  "kind": "compare",
  "title": "Adónde pueden ir tus palabras, según el modo",
  "columns": [
    { "title": "Solo local", "hue": "good", "items": ["Este dispositivo", "Bloqueadas: solicitudes con contenido", "Bloqueadas: conexiones en vivo", "Funciona sin conexión"] },
    { "title": "Híbrido", "hue": "idea", "items": ["Primero este dispositivo", "Después el nivel gratuito de la nube", "Un aviso cuando cambia", "Aprende qué turnos mantener en local"] },
    { "title": "Específico", "hue": "make", "items": ["Exactamente el modelo que elegiste", "Nube, tu propia cuenta o un modelo local", "Sin sustituciones silenciosas"] }
  ],
  "caption": "El modo es el límite. Todo lo demás —qué modelo local, qué modelo en la nube— ocurre dentro de él."
}
```

## Sin cuenta, sin llamada a la API

Studio y Rovr ahora arrancan de forma **anónima**. No hay registro ni llamada a nuestros servidores para empezar: la página carga, un modelo local se carga en tu navegador y ya estás trabajando. Todo lo que haces en ese estado se queda en tu dispositivo, porque no tiene otro sitio adonde ir.

Iniciar sesión añade lo que de verdad necesita una cuenta: Híbrido por defecto, sincronización entre dispositivos, cuentas de proveedores conectadas y la memoria de lo que has hecho antes. Si quieres la nube sin cuenta, elegir **Híbrido** como invitado te da acceso a una pequeña asignación para invitados; ese es el único momento en que las palabras de un invitado salen del dispositivo, y es uno que tú elegiste.

Esto se apoya en [crear antes de registrarte](/blog/create-before-you-sign-up) en el lienzo. La diferencia es que el modelo que te responde ya no tiene que vivir en otro sitio.

## Sin GPU

La [versión anterior](/blog/models-that-run-on-your-machine) trajo modelos que descargas una vez y ejecutas en la GPU de tu navegador, y fue honesta al decir que necesitaba WebGPU. Ese límite ha desaparecido. Los modelos **Bonsai** de 1 bit ahora también se ejecutan en la **CPU**, repartidos en varios hilos cuando el navegador lo permite, dentro de un worker en segundo plano para que la página siga respondiendo mientras el modelo piensa.

```bf-figure
{
  "kind": "flow",
  "title": "Dónde se ejecuta un modelo local, según la superficie",
  "steps": [
    { "label": "builderforce.ai", "note": "Studio y el lienzo: la GPU cuando hay WebGPU, si no la CPU, siempre en un worker en segundo plano.", "hue": "idea" },
    { "label": "Rovr", "note": "El panel lateral de Chrome ejecuta los mismos modelos de la misma forma: primero la GPU, la CPU cuando no la hay.", "hue": "run" },
    { "label": "VS Code", "note": "La extensión usa la GPU del panel del editor cuando la tiene, y se ejecuta en la CPU dentro de la propia extensión cuando no.", "hue": "make", "tag": "ambas vías" }
  ],
  "caption": "El mismo modelo y el mismo selector en los tres. Un portátil con gráficos integrados, un equipo de trabajo bloqueado y un escritorio virtual pueden ejecutar un modelo ahora."
}
```

Una CPU es más lenta que una buena GPU; nadie debería fingir lo contrario. Pero un modelo que responde en unos segundos en la máquina que tienes es mejor que uno que se niega a cargar en la máquina que no tienes. Para reescribir, resumir, preguntar sobre una página o hacer un primer borrador de un plan, es más que suficiente, y es privado por diseño.

Para saber cómo están construidos los motores del navegador, lee [IA local primero en el navegador, bien hecha](/blog/local-first-ai-webgpu-in-the-browser).

## Un Híbrido que aprende qué turnos mantener

Un "local primero" ingenuo tiene un coste evidente: cada turno que el modelo local no puede resolver es un turno en el que esperas a que falle antes de que la nube tenga su oportunidad. Si pasa a menudo, Híbrido parece más lento que usar directamente la nube.

Así que Híbrido aprende. Un pequeño predictor en tu dispositivo observa cómo terminan tus propios turnos —cuáles resolvió el modelo local y cuáles pasó a otro— y, con el tiempo, envía **directamente a la nube** los turnos que ya espera que el modelo local no resuelva, sin el desvío.

```bf-figure
{
  "kind": "flow",
  "title": "Un turno en Híbrido",
  "steps": [
    { "label": "Predecir", "note": "Aprendido de tus propios resultados, en tu dispositivo: ¿lo resolverá el modelo local?", "hue": "prove" },
    { "label": "Local", "note": "Si sí, responde este dispositivo. Nada sale.", "hue": "good" },
    { "label": "Nube gratuita", "note": "Si no —o si el intento local no lo logra—, el nivel gratuito toma el turno.", "hue": "run" },
    { "label": "Aviso", "note": "Ves que cambió, cada vez.", "hue": "accent", "tag": "nunca en silencio" }
  ],
  "caption": "El predictor aprende de lo que les pasó a tus turnos y se queda en tu dispositivo. Cuanto más usas Híbrido, menos turnos esperan un intento local que nunca iba a funcionar."
}
```

Detrás hay dos cambios más pequeños. Cuando un turno sí va a la nube, **los modelos gratuitos van primero siempre que sean equivalentes a uno de pago**: una preferencia de la cuenta, deducida de si has conectado tus propias claves de proveedor, que puedes cambiar. E **Insights** ahora señala **anomalías de ejecución**: ejecuciones que costaron mucho más, tardaron mucho más o fallaron muchas más herramientas que las anteriores, para que un valor atípico sea algo que ves y no algo que descubres en una factura.

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco, **Idea → Hacer → Ejecutar → Medir → Alcanzar**, y el bucle que cruza de Idea a Hacer es [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop). Leer y Probar son los dos actos que no deberían gastar nada, para que la decisión de construir sea una decisión de verdad.

Esta versión es lo que lo hace literalmente cierto, y vive al principio del arco: **Idea**.

```bf-figure
{
  "kind": "flow",
  "title": "Los dos primeros actos, sin nada delante",
  "steps": [
    { "label": "Leer", "note": "Piensa la idea a fondo con un modelo en tu propia máquina: sin cuenta, sin GPU, sin red, sin registros en ningún sitio.", "hue": "read", "tag": "Idea" },
    { "label": "Probar", "note": "Haz las comprobaciones baratas en local; Híbrido envía a la nube solo los turnos que lo necesitan, modelos gratuitos primero.", "hue": "prove", "tag": "Idea" },
    { "label": "Construir", "note": "Inicia sesión cuando el trabajo lo merezca: la sincronización, las cuentas conectadas y un proyecto duradero te esperan.", "hue": "build", "tag": "Hacer" }
  ],
  "caption": "Leer y Probar siempre debieron ser gratuitos. Ahora lo son en coste, en registro y en hardware, y Solo local los hace privados por norma, no por esperanza."
}
```

El momento más caro de cualquier proyecto no es la construcción. Es la idea que nunca recibió una primera pregunta porque esa pregunta costaba un registro, una GPU o una conexión que alguien no tenía. Sacar esos costes de la fase de Idea es lo que permite que más ideas lleguen a Probar, y que las que no deberían construirse se descubran antes de que nadie las construya. Las anomalías de ejecución en Insights cierran el otro extremo: las ejecuciones que sí ocurren se miden, y los valores atípicos vuelven a ti.

## Lo que puedes hacer hoy

- **Empieza sin cuenta.** Abre Studio o Rovr y haz tu primera pregunta; responde un modelo en tu dispositivo.
- **Mantenlo en tu máquina, por norma.** Elige **Solo local** y no se envía nada: ni tus prompts, ni una conexión en vivo.
- **Ejecuta un modelo en cualquier portátil.** Sin GPU no hay problema: Bonsai se ejecuta en la CPU en la web, en Rovr y en VS Code.
- **Deja que Híbrido decida la ruta.** Primero local, después la nube gratuita, un aviso cuando cambia, y menos intentos locales desperdiciados cuanto más lo usas.
- **Fija un modelo cuando importa.** **Modelo específico** ejecuta exactamente lo que elegiste, sin sustituciones silenciosas.
- **Detecta las ejecuciones caras.** Insights señala las ejecuciones muy fuera de lo normal en coste, tiempo y fallos de herramientas.

Abre el menú `/`, elige **Model (Modelo)** y decide cómo quieres que se ejecute.

---

**Lecturas relacionadas:** [Ejecuta un modelo en tu propia máquina](/blog/models-that-run-on-your-machine) · [IA local primero en el navegador, bien hecha](/blog/local-first-ai-webgpu-in-the-browser) · [Conoce Rovr](/blog/rovr-your-assistant-in-the-browser) · [Crea antes de registrarte](/blog/create-before-you-sign-up) · [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop)

[Abre Studio](/studio) y pregúntale algo, sin necesidad de cuenta.
