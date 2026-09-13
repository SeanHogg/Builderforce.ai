Una conversación con un equipo de agentes plantea dos preguntas en cada turno. **¿Con quién estoy hablando?** Y **¿quién me responde?**

La primera tiene un control desde hace tiempo. «Para» en el compositor, o una @-mención, envía un mensaje a un agente invitado o a un compañero en lugar de al Brain. La segunda solo existía en la web. Allí, «Actuando como» permitía que el Brain respondiera como el constructor de sitios web, el programador móvil o el maestro de Evermind, o como uno de los agentes asignados a tu espacio de trabajo. En VS Code, donde ocurre la mayor parte de la construcción, siempre te tocaba el asistente predeterminado.

Esa brecha está cerrada.

## Actuando como, en tu editor

El compositor del editor ahora tiene los mismos dos controles que la web, uno junto al otro.

```bf-figure
{
  "kind": "screen",
  "frame": "El compositor del chat en VS Code",
  "ratio": 2.2,
  "regions": [
    { "label": "Tu mensaje", "note": "Se escribe como antes; una @-mención sigue dirigiéndolo", "x": 3, "y": 8, "w": 94, "h": 46, "hue": "muted" },
    { "label": "Actuando como", "note": "Brain predeterminado · una persona · un agente asignado", "x": 3, "y": 62, "w": 30, "h": 30, "hue": "idea" },
    { "label": "Para", "note": "El Brain · un agente invitado · un compañero", "x": 36, "y": 62, "w": 26, "h": 30, "hue": "make" },
    { "label": "+ · / · Enviar", "x": 65, "y": 62, "w": 32, "h": 30, "hue": "accent" }
  ],
  "caption": "Los mismos dos selectores que muestra el compositor web, así que ambas superficies ofrecen las mismas opciones y las nombran igual."
}
```

«Actuando como» ofrece tres tipos de respuesta:

- **El Brain predeterminado**: tu asistente de programación, basado en el espacio de trabajo que tienes abierto.
- **Una persona**: Sitio web, Móvil, Web + Móvil, Evermind, Ajuste fino o Voz. Son las personas con las que trabaja el constructor web, así que la persona Móvil escribe React Native con zonas táctiles de 44 puntos y áreas seguras, y la persona Evermind enseña en lugar de entrenar.
- **Un agente asignado al Brain**: cualquiera de ellos. El Brain responde con el rol y la voz de ese agente, y usa el modelo propio del agente salvo que hayas fijado un modelo en el menú `/`.

## La persona se coloca sobre tu espacio de trabajo

Hay algo que funciona distinto en el editor, a propósito. En la web, una persona *es* la instrucción del Brain, porque no hay nada más que describir. En el editor, el Brain ya sabe cosas reales: qué carpeta está abierta, qué archivo estás mirando, qué herramientas pueden tocar tu repositorio. Una persona de Sitio web que promete «la vista previa está en vivo» no debe sobrescribir nada de eso.

Por eso, en VS Code la persona se añade encima.

```bf-figure
{
  "kind": "compare",
  "title": "Lo que cambia una persona, y lo que deja igual",
  "columns": [
    { "title": "En la web", "hue": "muted", "items": ["La persona es toda la instrucción", "Su mundo es el constructor del navegador: vista previa, publicación, el servidor de desarrollo", "Elige Móvil y construye para el simulador de dispositivos"] },
    { "title": "En tu editor", "hue": "make", "items": ["La persona se suma a lo que el editor ya sabe", "Tu carpeta abierta, tu archivo y tu repositorio siguen siendo su mundo", "Elige Móvil y construye React Native, en tus archivos"] }
  ],
  "caption": "Una persona cambia cómo construye el Brain. Nunca cambia dónde cree el Brain que vive tu código."
}
```

## Una pregunta a todo el tablero muestra a quién se hizo

Pregúntale algo a un lienzo sin @-mencionar a nadie y responde cada agente del tablero. Las respuestas siempre llevaron su autor. La pregunta no: abierta en la página del chat, parecía dirigida a nadie en particular.

```bf-figure
{
  "kind": "flow",
  "title": "Una pregunta para todo el tablero",
  "steps": [
    { "label": "Preguntar", "note": "Sin @-mención, así que la pregunta va a cada agente del lienzo", "hue": "idea" },
    { "label": "Dirigida", "note": "La pregunta registra, por su nombre, a cada agente que la recibió", "hue": "make" },
    { "label": "Respondida", "note": "Cada agente responde como sí mismo; el Brain se mantiene al margen", "hue": "make", "tag": "web y editor" }
  ],
  "caption": "Una pregunta con tres destinatarios ahora muestra a los tres, y responderla es cosa suya: el Brain nunca la toma, aunque uno de ellos no responda."
}
```

## Dónde encaja en el método

[Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop) es un ciclo sobre *quién hace el trabajo*, no solo sobre cuál es el trabajo. Leer un mercado es un trabajo distinto de probar un precio, y ambos son distintos de construir la pantalla que lo vende. Hasta ahora el editor te dejaba elegir a quién preguntabas. No te dejaba elegir quién respondía, así que cada acto del ciclo pasaba por el mismo generalista.

Elegir quién responde importa sobre todo en **Make**, la etapa del [arco](/blog/idea-to-real-the-operating-methodology) en la que Construir es el acto caro. Ahí la diferencia entre «un asistente» y «el programador móvil» aparece como retrabajo: zonas táctiles que nunca tuvieron 44 puntos, un diseño que daba por hecho un hover. Elegir la persona antes de escribir la primera línea sale más barato que corregirla después. Antes en el arco, hacer que el Brain actúe como el agente que asignaste a la estrategia permite que Leer y Probar vengan del rol al que igualmente habrías preguntado.

## Qué puedes hacer hoy

- **Ejecutar un turno como especialista, en tu editor** —Sitio web, Móvil, Web + Móvil, Evermind, Ajuste fino o Voz— sin salir de tus archivos.
- **Responder como uno de tus agentes**, con el modelo propio de ese agente, desde el mismo compositor en el que ya escribes.
- **Enviar un mensaje a un compañero o a un agente invitado** con el mismo control «Para» en la web y en VS Code.
- **Ver a todos los que recibieron una pregunta** cuando preguntas a todo el tablero a la vez.

---

**Lecturas relacionadas:** [Chat de equipo multiparte](/blog/multi-party-team-chat-humans-and-agents) · [Personas psicométricas para agentes](/blog/ai-agent-personality-psychometric-personas) · [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop)

[Abre Brain Storm](/brainstorm) y elige quién responde.
