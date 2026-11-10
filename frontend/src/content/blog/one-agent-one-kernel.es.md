Empieza una conversación con un agente en VS Code, retómala a mitad de hilo en el navegador, y el agente que te responde allí tiene las mismas herramientas, sigue las mismas reglas y salvaguardas, y su trabajo pasa por la misma verificación. Un arreglo que recibes en un sitio es un arreglo en todos.

Eso solo funciona si lo que te responde es lo mismo en todas partes. Durante mucho tiempo no lo fue: el editor, la aplicación web, Rovr y los canales on-prem tenían cada uno su propio bucle de ejecución, su propio cableado de herramientas y, en un mal día, cuatro respuestas distintas a la misma pregunta.

Ahora **la superficie cambia, pero el agente no.** Un único núcleo de ejecución atiende cada conversación, en cada host.

## Un bucle, no cuatro

Ahora hay un único bucle de agente. Los antiguos bucles de ejecución por superficie ya no existen —eliminados, no obsoletos—, así que no hay un segundo motor escondido detrás de un flag esperando a desviarse. Ese bucle es el único camino que puede seguir un turno, tanto si empieza en el panel de chat del editor, en el canvas web, en Rovr dentro del navegador o en un canal como Slack.

```bf-figure
{
  "kind": "flow",
  "title": "Un bucle detrás de cada superficie",
  "steps": [
    { "label": "Tu conversación", "note": "VS Code, web, Rovr o un canal: la superficie es una vista, no un motor.", "hue": "make" },
    { "label": "El único núcleo", "note": "Un solo bucle de ejecución y una sola política de herramientas ejecutan cada turno.", "hue": "run" },
    { "label": "Las mismas comprobaciones", "note": "Las mismas herramientas, las mismas salvaguardas, la misma verificación, uses la superficie que uses.", "hue": "measure" }
  ],
  "caption": "La superficie muestra la conversación; el núcleo la lleva."
}
```

## Por qué importa

- **Una conversación es portátil.** Empieza en el escritorio y continúa en el navegador: el estado, la memoria y el acceso a herramientas del agente te acompañan, porque nunca estuvieron atados a una superficie.
- **Un arreglo es un arreglo.** Refuerza la política de herramientas una vez y todos los hosts la heredan. Ya no queda la clase de error «funciona en el editor pero no en la web».
- **Una sola cosa que verificar.** Un único oráculo de conformidad reproduce el escenario de referencia contra el único motor, así que «¿el agente es correcto?» tiene una respuesta, no cuatro.

## Dónde encaja en el método

Esta es la etapa **Make** convertida en algo fiable: el agente que construye es el mismo allí donde lo encuentres. La fiabilidad que puedes llevar de una superficie a otra es lo que permite que el resto del arco —Run, Measure— se apoye en ella.

## Qué puedes hacer con ello hoy

Abre la misma conversación en dos superficies y comprueba que coinciden. Mueve una conversación del editor al navegador a mitad de hilo. El núcleo es la constante; la superficie es donde estés tú.
