Un agente toma un ticket, descubre que aquí un cambio de esquema necesita una declaración en un módulo, una migración escrita a mano y dos guardas ejecutadas en un orden concreto, consigue que se fusione y termina.

Mañana, otro agente toma el siguiente ticket de esquema y vuelve a descubrirlo todo desde cero.

Esa es la forma del problema que resuelve esta versión. No es que "el agente no fuera lo bastante listo": lo fue, dos veces. El problema era que todo lo que descubría vivía en una transcripción que nadie lee, y en el producto no existía ningún objeto para "un procedimiento que aquí funcionó".

## Una habilidad es un procedimiento, y ahora un agente puede escribirla

Las habilidades ya existían: cincuenta y cuatro incluidas en el entorno de ejecución, más un marketplace. Todas las vías de escritura pasaban por una persona. Así que los únicos procedimientos que los agentes podían seguir eran los que un humano se había sentado a escribir.

Ahora un agente puede proponer uno. El listón es deliberadamente alto —un resultado verificado, es decir, trabajo fusionado o una ejecución evaluada que realmente produjo algo— y la invitación lo dice sin rodeos, porque un paso de reflexión que se dispara en cada ejecución produce un catálogo de disparates dichos con total aplomo.

```bf-figure
{
  "kind": "flow",
  "title": "Cómo un procedimiento se convierte en algo que siguen todos los agentes",
  "steps": [
    { "label": "Ejecutar", "note": "Un agente hace el trabajo y llega a un resultado verificado: fusionado, o confirmado con sus comprobaciones superadas.", "hue": "make" },
    { "label": "Reflexionar", "note": "Antes de terminar, destila la parte repetible: los pasos, los comandos exactos y cómo saber que funcionó.", "hue": "idea" },
    { "label": "Revisar", "note": "La propuesta llega como borrador, junto con la ejecución que la escribió y la evidencia que aportó. Todavía no ha cambiado el prompt de nadie.", "hue": "accent", "tag": "decide una persona" },
    { "label": "Seguir", "note": "Una vez aprobada, todos los agentes del espacio de trabajo la llevan consigo desde su siguiente ejecución.", "hue": "make" }
  ],
  "caption": "Tres filtros, y el del medio es una persona. Un agente que pudiera publicar una habilidad directamente sería un agente que reescribe lo que se les dice a todos los demás agentes, por su propia cuenta, desde dentro de una sola ejecución."
}
```

Lo que revisas es el procedimiento completo, no un resumen: el cuerpo, la ejecución que lo propuso y lo que esa ejecución aportó como prueba. Aprobarlo es el momento en que pasa a ser vinculante, así que es el momento en que puedes leerlo.

## Otras tres puertas que estaban cerradas

La misma tanda de trabajo abrió tres cosas que ya estaban construidas y eran inaccesibles.

**Trae tu propio servidor de herramientas.** En el código había un cliente completo de Model Context Protocol —OAuth de tres pasos, consentimiento por herramienta, secretos cifrados y un relé para que la credencial nunca toque un navegador— sin que nada en el producto lo llamara. Un tenant solo podía registrar un servidor externo llamando a la API a mano. Ahora hay un panel en Configuración › Integraciones y un comando en la extensión de VS Code, y ambos usan las mismas rutas.

**Gobernanza en el editor.** Los paquetes de políticas se aplicaban en las ejecuciones en la nube y en las autoalojadas. El editor tenía el código para aplicarlas, pero nunca recibía ningún control, así que una regla que bloqueaba una herramienta en la nube la permitía en silencio en VS Code. Ahora las dos superficies del editor resuelven los mismos controles compilados al inicio de cada ejecución, y se niegan a empezar un turno si no pueden leer la política.

**Reorientar una ejecución autoalojada.** Una indicación de seguimiento enviada a una ejecución on-premise en curso se aceptaba, se guardaba y se perdía: se entregaba a una sesión de chat en la que el motor actual ya no se ejecuta. Ahora llega a la ejecución en vivo y se aplica como su siguiente turno.

```bf-figure
{
  "kind": "compare",
  "title": "Construido frente a accesible",
  "columns": [
    { "title": "Antes", "hue": "idea", "items": ["Un cliente MCP sin nadie que lo llamara", "Fontanería de políticas en el editor, sin controles", "Indicaciones aceptadas y perdidas", "Ejecuciones visibles solo en nuestra línea de tiempo"] },
    { "title": "Ahora", "hue": "make", "items": ["Registra un servidor desde la configuración o desde el editor", "El mismo control se aplica en las tres modalidades", "Una indicación llega como el siguiente turno de la ejecución", "Spans en el colector que ya utilizas"] }
  ],
  "caption": "Cuatro capacidades que existían en el código y no existían para nadie que lo usara. La distancia entre esos dos estados es toda la historia de esta versión."
}
```

## Medir si algo de esto funcionó

También cambiaron dos cosas en la forma de ver lo que hacen los agentes.

Las ejecuciones ahora se exportan a tu propio colector de OpenTelemetry, así que el trabajo de los agentes queda junto al resto de tu sistema y no solo en el nuestro, con el estado de esa exportación mostrado al lado, porque un colector que ha empezado a rechazar spans debería decirlo en lugar de descartarlos en silencio.

Y la calidad de los agentes ahora es una serie, no una anécdota. Todas las señales de calidad existentes puntuaban el tráfico que llegara, así que una variación de un mes a otro podía deberse a los agentes o a los tickets de ese mes. Un benchmark es un conjunto fijo de casos, puntuado de la misma forma cada día y representado como puntuación y cobertura de expectativas a lo largo del tiempo.

## Dónde encaja en el método

El arco de la idea a lo real recorre Idea → Crear → Operar → Medir, y cada paso del método plantea una pregunta: **Leer** lo que ya es cierto, **Demostrarlo** de forma barata y después **Crear**.

Todo lo anterior cae en el extremo final de ese ciclo: la mitad que los equipos se saltan sistemáticamente.

**Leer** ha ganado una memoria que de verdad encuentra cosas. La recuperación en la ruta de la nube era una coincidencia de palabras clave o, peor aún, una reordenación por embeddings de diez filas elegidas por algo que no era la pregunta; un recuerdo relevante fuera de esa ventana era inalcanzable. Ahora es una búsqueda semántica real combinada con la rama de palabras clave, con la misma clasificación que siempre ha usado el almacén autoalojado. Una ejecución que lee lo que aprendieron las anteriores es el primer paso del método funcionando tal como se describe.

**Medir** ha ganado dos. El benchmark es lo que convierte "¿están mejorando los agentes?" en una pregunta con respuesta, y la exportación es lo que permite que esa respuesta viva donde tu equipo ya mira.

Y el ciclo de habilidades es el arco cerrándose sobre sí mismo. Una ejecución que produjo una prueba evaluada ha completado una pasada entera de Idea → Crear → Operar → Medir. Destilarla en un procedimiento que sigue la siguiente ejecución es lo que convierte un ciclo en una espiral: la siguiente lectura parte de lo que estableció la última medición, en lugar de partir de cero.

Esa fue siempre la promesa. Ahora es algo que el producto hace.
