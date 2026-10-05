Medir se abría sobre un tablero en el que nada estaba en producción.

Podías pulsarlo en cualquier momento. El lienzo cambiaba de pestaña, ofrecía Estadísticas y esperaba números de una app que nunca se había desplegado. Con Alcance pasaba lo mismo: un sitio para publicaciones de lanzamiento sin ninguna dirección a la que mandar a nadie. Las fases de la parte superior del lienzo (Idea, Crear, Operar, Medir, Alcance) filtraban qué pestañas veías, y nada más. Nunca miraban lo que había en el tablero. Además, la fase era un único ajuste por navegador: poner un lienzo en Medir ponía todos los demás en Medir también.

Un selector de fases que no sabe si una fase es posible es solo un menú. El método que hay detrás dice más: no se puede medir lo que no está funcionando, y no conviene construir antes de haber escrito la idea. Ahora el lienzo también lo sabe.

## Saber si estás listo, leyendo el tablero

Cada fase lee ahora el tablero en el que está. No usa un ajuste ni una lista que tengas que rellenar. Mira los objetos que el trabajo ya ha dejado:

- **una tarjeta de idea** significa que Idea está hecha;
- **una app**, es decir, las tarjetas de código que funcionan juntas, significa que Crear está hecho;
- **un despliegue con dirección** significa que Operar está hecho;
- **una métrica** significa que Medir está hecho.

En la barra de fases, cada una muestra uno de tres estados: una marca cuando su propio resultado existe, un candado cuando antes necesita una fase anterior, o nada cuando puedes trabajar en ella. Cada lienzo guarda su propia fase. Si no has elegido ninguna, el lienzo se abre en la **primera fase que aún no has completado**, así que un tablero que ya está en producción no te devuelve a Idea.

```bf-figure
{
  "kind": "flow",
  "title": "El arco, leído en un tablero con una idea y una app pero nada desplegado",
  "steps": [
    { "label": "Idea", "note": "Hay una tarjeta de idea en el tablero.", "hue": "idea", "tag": "✓ hecho" },
    { "label": "Crear", "note": "Las tarjetas de código funcionan como una app.", "hue": "make", "tag": "✓ hecho" },
    { "label": "Operar", "note": "Todavía no hay un despliegue con dirección. Aquí se abre el lienzo.", "hue": "run", "tag": "ahora" },
    { "label": "Medir", "note": "Lee lo que hace una app en producción, así que primero necesita Operar.", "hue": "measure", "tag": "necesita Operar" },
    { "label": "Alcance", "note": "Lleva a la gente a algo que está en producción, y recomienda una métrica antes de gastar.", "hue": "reach", "tag": "necesita Operar" }
  ],
  "caption": "No se guarda nada nuevo. El estado sale de las tarjetas que ya están en el tablero: en cuanto aparece un despliegue, el candado de Operar se convierte en una marca, sin recargar."
}
```

## Un candado que nunca cierra

El candado es una indicación, no una barrera. Pulsa Medir en ese tablero y Medir se abre, con todas las vistas funcionando. Lo que cambia es lo que te dice. En la parte superior del lienzo, una tarjeta de ruta nombra lo que falta y el camino más corto para conseguirlo.

```bf-figure
{
  "kind": "screen",
  "frame": "Medir, en un tablero sin nada en producción",
  "ratio": 1.62,
  "regions": [
    { "label": "Barra de fases", "note": "Idea ✓ · Crear ✓ · Operar · Medir (candado) · Alcance (candado)", "x": 4, "y": 4, "w": 56, "h": 9, "hue": "accent" },
    { "label": "Medir · a 1 paso", "note": "Publica la app antes de medirla. Ir a Operar · Que Brain se encargue: desplegarla", "x": 4, "y": 16, "w": 56, "h": 15, "hue": "measure" },
    { "label": "El tablero", "note": "Tarjetas de KPI y de experimento resaltadas, todo lo demás atenuado", "x": 4, "y": 35, "w": 62, "h": 50, "hue": "measure" },
    { "label": "Dónde va la primera métrica", "note": "Todavía no · necesita Operar", "x": 70, "y": 35, "w": 26, "h": 26, "hue": "measure", "style": "ghost" },
    { "label": "Barra de comandos · MEDIR resaltado", "x": 4, "y": 89, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "La tarjeta de ruta ocupa el lugar de una pantalla vacía. «Ir a Operar» cambia de fase, y «Que Brain se encargue» le envía a Brain la petición de despliegue por el mismo camino que los puntos de partida. Pliégala en una etiqueta si necesitas espacio: vuelve la próxima vez que abras el lienzo."
}
```

La tarjeta discontinua de la derecha es un marcador, no una tarjeta. Indica dónde irá el primer objeto de la fase, y nunca se guarda, se sincroniza ni entra en el historial de deshacer. Cuando la fase está lista, ofrece añadir ese objeto o dejar que Brain lo cree. Cuando no lo está, dice qué está esperando la fase.

## El tablero pone la fase en primer plano

El cambio más grande está en cómo se lee el propio tablero. Cada fase tiene los tipos de objeto que le importan. Idea tiene ideas, entrevistas, experimentos, personas y riesgos. Crear tiene especificaciones, páginas, prototipos y código. Operar tiene despliegues, versiones e incidencias. Medir tiene KPI, paneles, gráficos y experimentos. Alcance tiene publicaciones, campañas, audiencias y fichas. Esas tarjetas reciben un borde del color de la fase. Todo lo demás pasa a segundo plano.

```bf-figure
{
  "kind": "compare",
  "title": "El mismo tablero en Medir, con el enfoque de fase desactivado y activado",
  "columns": [
    { "title": "Enfoque de fase desactivado", "hue": "muted", "items": ["Todas las tarjetas a plena intensidad", "El KPI queda entre una especificación, una landing y seis tarjetas de código", "Para encontrar los números hay que leer cada título", "Útil para reorganizar todo el tablero"] },
    { "title": "Enfoque de fase activado", "hue": "measure", "items": ["Tarjetas de KPI, panel y experimento resaltadas", "Especificaciones, páginas y código atenuados, pero se pueden seguir pulsando", "Las líneas entre tarjetas atenuadas también se atenúan", "Una tarjeta seleccionada siempre está a plena intensidad", "¿Todavía sin métrica? Una tarjeta discontinua muestra dónde irá"] }
  ],
  "caption": "El enfoque de fase está activado por defecto y vive en el menú ••• del tablero. Nada se mueve: el tablero que organizaste sigue tal como lo dejaste."
}
```

El resto del lienzo sigue la misma fase. La barra de comandos resalta el grupo de la fase en la que estás. Los puntos de partida empiezan con tres sugerencias para esa fase, como «Definir la métrica clave» en Medir o «Redactar una publicación de lanzamiento» en Alcance, antes del catálogo completo. En la sala, la estación de la fase se ilumina y pasa al principio de la lista. Cuando la fase no está lista, aparece en la sala una estación con un cartel que dice lo que falta: *Necesita una app en producción*.

## Dos lugares nuevos: Operar y Lanzar

Dos fases no tenían un lugar propio.

**Operar** aparece a partir de la fase Operar. Muestra lo que este lienzo tiene en marcha: cada despliegue con su entorno, versión, dirección y fecha; las versiones del tablero; y si la app está en producción. Si has construido una app pero no la has desplegado, Operar lo dice claramente y ofrece que Brain la despliegue.

**Lanzar** aparece en Alcance. Demostrar la idea, publicar el tablero, ponerlo a la venta y contárselo a la gente eran hasta ahora cuatro puertas distintas. Lanzar las reúne en una sola página, en ese orden, porque es el orden en el que deberían ocurrir.

**Estadísticas**, desde Medir, se abre ahora con *Este lienzo*: las métricas definidas en este tablero, primero las que van por detrás de su objetivo, antes que los números fijados desde otros sitios. Si el tablero aún no tiene ninguna métrica, ofrece que Brain defina una.

Una cosa se movió en sentido contrario. **La app empieza ahora en Crear.** En Idea estás comprobando si alguien quiere lo que propones. Un prototipo para eso es una tarjeta de experimento en el tablero, no una app que se construye antes de haber probado la idea.

## Dónde encaja en el método

El método es [Idea to Real](/blog/idea-to-real-the-operating-methodology): Idea, Crear, Operar, Medir y después Alcance. Cada fase tiene ahora algo que el tablero debe contener antes de que la siguiente pueda trabajar, y algo que ella misma deja.

```bf-figure
{
  "kind": "flow",
  "title": "Lo que cada fase deja en el tablero y lo que necesita la siguiente",
  "steps": [
    { "label": "Idea", "note": "Leer la idea y demostrarla barato. Deja una tarjeta de idea. Vistas: Chat, Tablero, Ideas, Sala.", "hue": "idea" },
    { "label": "Crear", "note": "Construir solo lo que la prueba se ha ganado. Necesita una idea y deja una app. Añade App.", "hue": "make" },
    { "label": "Operar", "note": "Ponerlo en un sitio real. Necesita una app y deja un despliegue con dirección. Añade Operar.", "hue": "run" },
    { "label": "Medir", "note": "Calificar el número de la prueba. Necesita algo en producción y deja una métrica. Añade Estadísticas.", "hue": "measure", "tag": "aquí se cierra el ciclo" },
    { "label": "Alcance", "note": "Llevarlo a la gente. Necesita algo en producción y avisa cuando nada se mide. Añade Lanzar.", "hue": "reach" }
  ],
  "caption": "Cada fase conserva todas las vistas de la anterior y añade la suya. Una fase posterior nunca te quita una herramienta."
}
```

**Idea** es donde ocurren [Leer y Demostrar](/blog/read-prove-build-the-inner-loop), y ninguna de las dos cuesta nada. Aquí el lienzo ofrece Ideas y Sala y deja App para más adelante, porque construir es el paso caro y el método quiere que sea una decisión.

**Crear** es Build. Necesita una idea en el tablero; si no la hay, el único paso de la tarjeta de ruta es «Que Brain se encargue: capturarla».

**Operar** es el momento en que un boceto se convierte en algo con dirección. La vista Operar es donde lo miras.

**Medir** es donde se cierra el ciclo. Cada prueba lleva un número que podría detener el proyecto, y ese número se [califica aquí](/blog/grade-the-proof-and-close-the-loop). Por eso Medir necesita algo en producción. Una métrica sobre una app a la que nadie puede llegar no mide nada.

**Alcance** también necesita algo en producción, y además *recomienda* una métrica. Te deja lanzar sin ella, pero te avisa de que llegar a la gente sin medir es gastar a ciegas.

Nada de esto te bloquea. Todas las fases se abren y todas las vistas funcionan. La diferencia es que ahora el lienzo sabe lo que hay en el tablero, así que puede decirte con honestidad qué falta y ofrecerse a dar el siguiente paso.

## Lo que puedes hacer hoy

- **Abrir cualquier lienzo y llegar al siguiente paso que aún no has dado**, no a donde se quedó el último lienzo.
- **Pulsar una fase para la que aún no estás listo** y recibir el camino más corto, con un solo clic para que Brain dé el primer paso.
- **Leer el tablero a través de la fase**: las tarjetas que importan pasan al frente y el resto se atenúa, hasta que desactives el enfoque de fase.
- **Ver lo que está en marcha** en Operar: despliegues, versiones y si la app está en producción, en el mismo tablero donde la construiste.
- **Lanzar desde un solo sitio**: demostrarlo, publicarlo, venderlo y contarlo, en ese orden.

El tablero siempre fue el registro del trabajo. Ahora también te dice en qué fase estás y qué viene después.

---

**Lecturas relacionadas:** [Idea to Real: el método detrás de Builderforce](/blog/idea-to-real-the-operating-methodology) · [La app de tu lienzo ya es un proyecto real](/blog/your-canvas-app-is-a-real-project) · [Califica la prueba y cierra el ciclo](/blog/grade-the-proof-and-close-the-loop)

[Abre un lienzo](/create) y pulsa Medir antes de que haya nada en producción.
