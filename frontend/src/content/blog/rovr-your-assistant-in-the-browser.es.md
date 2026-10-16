La mayor parte de una jornada de trabajo no ocurre en un editor ni en un lienzo. Ocurre en pestañas del navegador: la nota de gastos, el portal del proveedor, la reserva, las doce páginas que repasas para tomar una decisión, el formulario que rellenas por cuarta vez este mes.

El agente de Builderforce podía escribir código en VS Code y construir en un tablero. En el navegador no podía hacer nada. Copiabas texto de una página, lo pegabas en un chat, leías la respuesta y volvías a hacer los clics tú mismo. El asistente sabía muchísimo y no podía mover un dedo donde de verdad estaba el trabajo.

Ese es el hueco que cierra Rovr.

## Qué es Rovr

Rovr es el asistente propio de Builderforce para el navegador: una extensión de Chrome que se abre en un panel lateral junto a la página en la que estás. Le dices lo que necesitas. Lee la página, encuentra los campos y botones adecuados, rellena lo que haga falta, se mueve entre pestañas y completa la tarea paso a paso, contándote lo que hace sobre la marcha.

```bf-figure
{
  "kind": "screen",
  "frame": "Chrome con Rovr abierto junto a la página",
  "ratio": 1.6,
  "regions": [
    { "label": "La página en la que trabajas", "note": "Rovr la lee y actúa en ella, solo en los sitios que permitiste", "x": 3, "y": 8, "w": 62, "h": 86, "hue": "run" },
    { "label": "Conversación", "note": "Tú preguntas; Rovr responde y actúa", "x": 68, "y": 8, "w": 29, "h": 44, "hue": "idea" },
    { "label": "Tarjeta de confirmación", "note": "Enviar, comprar, mandar, contraseña: tú dices que sí", "x": 68, "y": 55, "w": 29, "h": 16, "hue": "accent" },
    { "label": "Acciones · Tareas · Playbooks", "x": 68, "y": 74, "w": 29, "h": 20, "hue": "measure" }
  ],
  "caption": "Un panel junto a la página, no encima de ella. La conversación, el registro de lo que hizo Rovr y las tareas que surgieron están en el mismo sitio."
}
```

Tres cosas lo distinguen de una ventana de chat que casualmente está al lado de un navegador.

**Registra cada acción.** Cada página que lee, cada clic, cada campo que rellena y cada paso que rechazaste queda anotado en un registro de acciones: qué hizo, en qué página y cómo salió. Puedes repasarlo cuando quieras, y viaja con el chat: el registro que ves en el navegador es el mismo que ve tu equipo en Builderforce.

**Puedes decirle cómo hacer las cosas.** Los playbooks son instrucciones con tus propias palabras: *cuando diga «registra mis gastos», abre el sitio de gastos, añade cada recibo de mi bandeja de entrada y detente antes de enviar.* Cuando una petición coincide, Rovr sigue tus pasos en lugar de improvisar. Se sincronizan con tu perfil de Chrome, así que te acompañan a cualquier navegador en el que inicies sesión.

**Pregunta antes de cualquier cosa importante.** Rovr solo trabaja en los sitios que has permitido y, la primera vez que necesita uno nuevo, te lo pregunta. Todo lo que envía un formulario, compra algo, manda o publica un mensaje, elimina algo o toca una contraseña o un número de tarjeta espera a que digas que sí en el panel. El contenido de las páginas se trata como información, nunca como instrucciones: una página web que le dice a Rovr que te ignore es solo una página web diciendo algo raro.

## Privado por defecto, en línea cuando ayuda

Rovr ejecuta su modelo primero en tu propio ordenador. Si tienes Synapse, Ollama o FreeToken en marcha, tus peticiones van allí: sin cuenta, sin contador, sin que nada salga de tu equipo. Cuando un paso necesita más de lo que puede dar tu modelo local —una tarea larga con muchas herramientas, por ejemplo—, Rovr pasa ese paso a los modelos en la nube de Builderforce, de forma invisible, antes de que hayas visto una sola palabra de la respuesta.

```bf-figure
{
  "kind": "flow",
  "title": "Dónde se ejecuta un paso de Rovr",
  "steps": [
    { "label": "En este dispositivo", "note": "Un modelo local capaz responde primero. Privado, gratuito y disponible sin conexión.", "hue": "run", "tag": "primero" },
    { "label": "Nube de Builderforce", "note": "Si nada local encaja, o el modelo local falla antes de responder, el paso pasa a la nube.", "hue": "make" },
    { "label": "Tu espacio de trabajo", "note": "El chat, cada acción registrada y las tareas que generó se sincronizan con Builderforce cuando estás en línea.", "hue": "measure", "tag": "más tarde también vale" }
  ],
  "caption": "La decisión se toma paso a paso: una tarea puede resolver sus pasos sencillos en tu equipo y enviar a la nube solo los pesados."
}
```

Y funciona sin conexión. Empieza un chat en un tren sin cobertura y seguirá con tu modelo local; la conversación, sus acciones y sus tareas se guardan en tu dispositivo y quedan en cola. Cuando vuelve la conexión, se sincronizan con tu espacio de trabajo en orden, cada una exactamente una vez.

## Tareas que llegan donde tu equipo puede verlas

Cuando le pides a Rovr que recuerde algo —*hablar con el casero el viernes*, *renovar el dominio antes de que caduque*— o una tarea genera trabajo pendiente, añade una tarea al chat. Elige un proyecto en Ajustes y cada tarea se crea en ese proyecto, enlazada a la conversación que la originó, para que quien la recoja vea exactamente de dónde viene.

```bf-figure
{
  "kind": "compare",
  "title": "Un agente de navegador en la nube de otro, y Rovr",
  "columns": [
    { "title": "Un agente de navegador remoto", "hue": "muted", "items": ["Funciona en un navegador en el servidor de otro", "Tus páginas y tus sesiones viajan hasta allí", "Se detiene cuando no tienes conexión", "Lo que hizo vive en su propio historial"] },
    { "title": "Rovr", "hue": "run", "items": ["Funciona en tu propio Chrome, con tus propias sesiones", "Primero en tu equipo; la nube solo cuando hace falta", "Sigue trabajando sin conexión y sincroniza después", "Cada acción registrada, sincronizada con tu chat, tareas en tus proyectos"] }
  ],
  "caption": "Rovr actúa en el navegador en el que ya has iniciado sesión, en los sitios que permites. Nada de tus sesiones sale del equipo."
}
```

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco, **Idea → Hacer → Ejecutar → Medir**, con el mismo bucle interno en cada acto: [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop). Rovr lleva ese bucle a la pestaña en la que ya estás.

- **Idea** empieza donde notas algo. Pregúntale a Rovr por la página que tienes delante y la pregunta se convierte en un chat, con la página como prueba.
- **Leer** es lo primero que hace Rovr en cada tarea: mira la página antes de tocarla y nunca adivina un botón que no ha visto.
- **Probar** es la tarjeta de confirmación. Antes de cualquier cosa con consecuencias, ves lo que Rovr está a punto de hacer y por qué pregunta.
- **Ejecutar** es la tarea en sí, realizada paso a paso, primero en tu equipo.
- **Medir** son el registro de acciones y las tareas. Lo que pasó queda escrito y sincronizado, así que la siguiente ejecución —tuya o de un compañero— parte de lo que hizo esta.

## Qué puedes hacer con él hoy

- **Completar una tarea en un sitio sin hacer tú los clics**: rellenar un formulario, reunir cifras de tres páginas, encontrar el ajuste escondido a cuatro menús de profundidad.
- **Escribir una vez cómo quieres que se hagan las cosas**, como playbook, y que Rovr lo siga siempre.
- **Seguir trabajando sin conexión** con un modelo que se ejecuta en tu propio ordenador, y dejar que el chat se sincronice cuando vuelvas a estar en línea.
- **Convertir una conversación en trabajo con seguimiento**: las tareas que crea Rovr llegan a tu proyecto, enlazadas al chat que las creó.
- **Ver exactamente qué pasó**: cada acción, en cada página, en orden, en el navegador y en Builderforce.

Añade Rovr a Chrome, inicia sesión con tu cuenta de Builderforce (o no, y trabaja por completo en tu propio equipo), permite un sitio y pregunta.

---

**Lecturas relacionadas:** [IA local con WebGPU en el navegador](/blog/local-first-ai-webgpu-in-the-browser) · [Código abierto en Builderforce](/blog/open-source-at-builderforce) · [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop)
