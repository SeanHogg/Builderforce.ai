«Builderforce recuerda, así que gasta menos». Llevamos meses diciéndolo. Hasta hoy tenías que fiarte de nuestra palabra.

La capa de memoria hacía su trabajo. Respondía desde la memoria a las preguntas repetidas y mantenía las conversaciones largas dentro de un contexto ligero. La caché de prompts del proveedor servía la mayor parte de un prompt largo a una décima parte del precio. Nada de eso aparecía en ningún sitio donde pudieras mirarlo. Una pregunta respondida desde la memoria dejaba en la línea de tiempo una nota diciendo que se había omitido el modelo, y nada sobre cuánto valía omitirlo. Un turno con tu propia clave de Claude se registraba como gratuito, porque Builderforce no pagaba nada por él. A ti sí te costaba.

Así que la pregunta «¿cuánto cuesta esto y de verdad ayuda la memoria?» no tenía respuesta en la pantalla donde estabas trabajando. Ahora sí la tiene.

## La cifra encima de cada chat

La franja que hay encima de cada conversación muestra ahora lo que ha costado esa conversación y lo que le ha ahorrado la memoria, junto al estado de sus tickets.

```bf-figure
{
  "kind": "screen",
  "frame": "La franja encima de una conversación",
  "ratio": 3.2,
  "regions": [
    { "label": "Estado de los tickets", "note": "104 tickets · 83 %", "x": 2, "y": 12, "w": 46, "h": 76, "hue": "make" },
    { "label": "$0.42 · 1.2M tok · ≈$0.31 ahorrados", "note": "Haz clic para ver el desglose", "x": 52, "y": 12, "w": 46, "h": 76, "hue": "measure" }
  ],
  "caption": "La cifra llega con el chat que la página ya carga. No necesita una petición propia ni sondeos."
}
```

Haz clic en la cifra para ver adónde ha ido el dinero:

- **Gastado** tiene dos líneas. **Plan de Builderforce** es lo que se ha facturado a tu plan. **Tu clave** es lo que te cobrarían tus propias cuentas de proveedor, a precio de lista. Un turno con tu cuenta conectada de Claude u OpenAI no es gratis solo porque no lo hayamos pagado nosotros.
- **Ahorrado por la memoria** se desglosa por origen, y cada origen es *registrado* o una *estimación*.

## Qué cuenta como ahorro, y cuánta seguridad tenemos

Solo una parte del ahorro se puede medir. Mostramos los dos tipos por separado y nunca sumamos una estimación a una cifra registrada.

```bf-figure
{
  "kind": "compare",
  "title": "Cifras registradas y estimaciones",
  "columns": [
    {
      "title": "Registrado",
      "hue": "measure",
      "items": [
        "Respondido desde la memoria. Cuando un modelo respondió la pregunta por primera vez, guardamos su recuento de tokens junto con la respuesta. Si la pregunta se repite, se ahorra exactamente ese turno.",
        "Petición repetida. El gateway reprodujo una petición idéntica, y la respuesta guardada aún conserva el consumo de la llamada original.",
        "Caché de prompts. Tu proveedor informa de cuántos tokens del prompt sirvió desde la caché, a una décima parte del precio aproximadamente."
      ]
    },
    {
      "title": "Estimado (indicado con ≈)",
      "hue": "idea",
      "items": [
        "Respondido por Evermind. Ningún modelo de pago generó esta respuesta, así que contamos la pregunta y la respuesta a unos cuatro caracteres por token.",
        "Contexto ligero. La compactación dejó los turnos antiguos fuera de cada llamada.",
        "Recuerdos añadidos. El lado del coste: lo que los recuerdos recuperados añadieron a cada prompt. Se resta de la estimación."
      ]
    }
  ],
  "caption": "Las estimaciones pecan de bajas. Un turno real de modelo también envía el prompt del sistema, el historial y las definiciones de herramientas, y nada de eso se cuenta."
}
```

Ese último punto importa. Recordar también cuesta tokens, porque los recuerdos recuperados se añaden al prompt. Restamos ese coste, así que el ahorro que ves es neto. Si en una conversación la memoria no compensa lo que cuesta, la cifra lo dice.

## El panel de trabajo, igual en todas partes

El panel `/` del cuadro de texto es el mismo en todas las superficies: el Brain en la web, el canvas, el panel de VS Code y Rovr en Chrome. Tiene las mismas cuatro pestañas: Modo, Esfuerzo, Modelo y Estado.

```bf-figure
{
  "kind": "devices",
  "title": "Un área de prompt, cuatro lugares",
  "devices": [
    { "label": "Brain en la web", "width": 1280, "height": 800, "note": "Modo · Esfuerzo · Modelo · Estado", "hue": "make" },
    { "label": "Canvas", "width": 1024, "height": 720, "note": "El mismo panel, la misma pestaña Estado", "hue": "make" },
    { "label": "Panel de VS Code", "width": 320, "height": 720, "note": "El mismo panel en una barra lateral estrecha", "hue": "run" },
    { "label": "Panel lateral de Rovr", "width": 360, "height": 720, "note": "El mismo panel en Chrome", "hue": "run" }
  ],
  "caption": "Un único componente compartido. Un ajuste no puede existir en un sitio y faltar en otro."
}
```

**Estado** muestra ahora el gasto y el ahorro en IA de tu espacio de trabajo en los últimos 30 días, junto al plan y sus contadores. También dice claramente cuándo se levantan todos los límites porque eres operador superadmin, en lugar de mostrar «Free» junto a una columna de «Ilimitado». El Evermind del proyecto aparece como los dos hechos distintos que realmente es: si está **aprendiendo** de los chats de este proyecto y si tiene permiso para **responder** en lugar de un modelo de pago.

**Memoria**, en la pestaña Modo, es ahora un ajuste de la propia conversación. Si la desactivas en el editor, también queda desactivada en la web. Desactivarla significa además que se apagan las herramientas de recordar y memorizar del propio agente, no solo la recuperación que ocurre antes de cada respuesta.

## Dónde encaja en el método

De la Idea a lo Real se cierra en **Medir**: cada prueba tiene una cifra que podría detener el proyecto, y esa cifra se comprueba en cuanto el trabajo está en marcha. El coste es una de esas cifras, y se supone que la memoria lo reduce. Un ahorro que nadie puede ver no se puede comprobar. No puedes decidir si dejar la memoria activada en una conversación, si conectar tu propia clave o qué nivel de esfuerzo necesita una tarea sin saber cuánto cuesta cada cosa.

Esto pone esa cifra donde se toma la decisión: en la conversación, mientras trabajas, con las cifras registradas y las estimaciones por separado, para que la comprobación sea honesta.

Y no cuesta nada extra mantenerlo. Los ahorros se escriben en los mismos registros de uso que la plataforma ya guarda. Las cifras llegan con datos que cada superficie ya carga. Añadir el contador no ha añadido ni una sola petición.
