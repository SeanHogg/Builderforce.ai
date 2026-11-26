La mayoría de las personas que dependen de un software no pueden leerlo. Responsables de producto, fundadores, auditores y nuevas incorporaciones tienen que responder preguntas sobre él: qué tamaño tiene esta parte, qué depende de ella, si es seguro cambiarla. Lo habitual es preguntar al único ingeniero que lo conoce y esperar.

Por eso ahora **la vista de conocimiento muestra el código y una imagen 3D del sistema una al lado de la otra, y moverte en una mueve también la otra.**

## Un lugar, dos vistas

El código está a la izquierda y la imagen a la derecha. Comparten una única ubicación, que va desde el sistema entero, pasando por un componente, una clase y un método, hasta una línea.

```bf-figure
{
  "kind": "screen",
  "frame": "La vista de conocimiento",
  "ratio": 1.62,
  "regions": [
    { "label": "Código", "note": "Clases y métodos, con lentes encima", "x": 3, "y": 8, "w": 44, "h": 78, "hue": "read" },
    { "label": "Imagen 3D", "note": "Formas del mismo sistema, en el mismo lugar", "x": 50, "y": 8, "w": 47, "h": 78, "hue": "make" },
    { "label": "sistema > componente > clase > método > línea", "x": 3, "y": 89, "w": 94, "h": 8, "hue": "accent" }
  ],
  "caption": "Una ubicación, mostrada dos veces. Donde estás en el código es hacia donde mira la imagen, y al revés."
}
```

- **Haz clic en una forma y se abre su código** a la izquierda.
- **Haz clic en una clase o método del código y la imagen se acerca** a ese punto.
- **Acércate a una forma y se abre.** Un componente se convierte en sus clases, una clase en sus métodos y un método en su código. Nunca tienes que saber en qué archivo estás.

Si no sabes leer código, aun así puedes verlo a través de formas: qué es grande, qué está enredado, qué se conecta con qué. Si sabes leerlo, ya no tienes que sostener el mapa en la cabeza.

## Lentes sobre el código

Encima de cada clase y método hay una fila de acciones pequeñas:

- **Entrar** y **salir**, para bajar o subir un nivel.
- **Llamadores**, para ver qué depende de esto.
- **No test · Simulate**, que aparece cuando ninguna prueba cubre esa ruta. Abre el simulador de rutas para que ejecutes la ruta y veas qué ocurre.
- **Restructure**, que aparece en los antipatrones. Un símbolo de advertencia en el margen marca ese mismo código, así que lo encuentras al desplazarte.

## Flow y Sequence en cada nivel

Cada nivel tiene una vista **Flow** y una vista **Sequence**: cómo se mueven los datos y en qué orden se llaman las piezas. Funcionan para el sistema, un componente, una clase y un método. Un solo interruptor cambia cualquiera de ellas entre 3D y Flat, para que elijas la que se lea mejor según la pregunta.

## Antes y Después

Un antipatrón se juzga mejor como imagen que como descripción. Por ejemplo, un módulo todopoderoso que lo ha absorbido todo, o una violación de capas en la que la parte equivocada alcanza a otra.

```bf-figure
{
  "kind": "compare",
  "title": "Vista previa de una reestructuración",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Un archivo grande con varias tareas", "Conexiones que cruzan capas que no deberían cruzar", "Difícil saber dónde caerá un cambio"] },
    { "title": "Después (propuesta)", "hue": "make", "items": ["Módulos nuevos crecen a partir del archivo antiguo", "Las conexiones se redirigen por la capa correcta", "Lo nuevo, lo cambiado y lo eliminado se distinguen por color"] }
  ],
  "caption": "La propuesta es una vista previa. Nada de tu código cambia hasta que la apliques."
}
```

Cambia a **Después** y los módulos nuevos crecen a partir del archivo antiguo mientras las conexiones se redirigen. El color separa lo nuevo, lo cambiado y lo eliminado. Juzgas la forma del cambio antes de leer nada del diff.

También puedes elegir **un commit del historial**. El mapa muestra qué cambió ese commit y el código muestra qué líneas.

Las propuestas son vistas previas. Aplicarlas pasa por el flujo normal de corrección con revisión, de modo que una persona sigue aprobando el cambio y se comprueba como cualquier otro.

## Dónde encaja en el método

Builderforce funciona con **Read, Prove, Build** dentro del arco Idea, Make, Run, Measure. Read y Prove son los pasos baratos, y deciden si vale la pena Build. Esta función pertenece a **Read y Prove, en Idea**.

Hacía falta ahí porque leer código existente es la parte lenta de esa etapa. Si heredas un sistema, o tienes que juzgar un cambio en él, la única vía era un árbol de archivos y una tarde. Ahora lees la forma del sistema en minutos. La vista previa de la reestructuración es una prueba en el mismo sentido: ves qué haría un cambio, con una condición de parada que puedes comprobar (¿elimina de verdad esta propuesta la violación?), antes de gastar esfuerzo de construcción. Lo que decidas construir sigue a [Make](/blog/read-prove-build-the-inner-loop), y un commit que puedes comparar con el historial es cómo Measure muestra después lo que hizo.

---

**Sigue leyendo:** [Read, Prove, Build: el bucle interno](/blog/read-prove-build-the-inner-loop) · [Diseñar, construir, depurar: un espacio de trabajo espacial](/blog/design-build-debug-one-spatial-workspace) · [Construye un mundo 3D en el navegador](/blog/build-a-3d-world-in-the-browser)

[Abre un lienzo](/create), cambia a la vista de conocimiento en un proyecto y haz clic en una forma.
