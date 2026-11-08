Un tablero podía cerrar cien tickets en un mes y nada, en ningún sitio, lo decía. El trabajo era real, los tickets estaban Hechos, y el número que responde a "¿qué ganó este tablero?" no existía. Los inversores tenían el mismo problema desde el otro lado: la actualización que leían describía la empresa con frases, mientras la entrega que las justificaba estaba en un tablero que nunca abrirían.

Dos huecos, una raíz. La entrega era un hecho de un ticket y nunca se convertía en un hecho del tablero, ni de la empresa.

## Un tablero gana presupuesto cuando sus tickets llegan a Hecho

Cada ticket que entra en un carril de Hecho gana ahora presupuesto para su tablero, en puntos: los puntos de historia del ticket, o un punto si nadie lo estimó. Ocurre en el único lugar por el que pasa todo movimiento de carril, así que arrastrar una tarjeta, un agente que termina una ejecución y un pull request fusionado pagan igual; y un ticket reabierto y cerrado de nuevo paga una sola vez.

```bf-figure
{
  "kind": "flow",
  "title": "De un ticket cerrado a un número que un tablero puede mostrar",
  "steps": [
    {
      "label": "El ticket llega a Hecho",
      "note": "Por cualquier vía: un arrastre, una ejecución de agente, un pull request fusionado.",
      "hue": "make"
    },
    {
      "label": "El tablero gana puntos",
      "note": "Sus puntos de historia, o uno. Se registra una vez por ticket, así que reabrir nunca paga dos veces.",
      "hue": "run"
    },
    {
      "label": "Hito alcanzado",
      "note": "Se completa una épica o sale una versión, y se suman las ganancias del tablero por ella.",
      "hue": "measure",
      "tag": "hacia el canal de inversores"
    }
  ],
  "caption": "Ganar usa el mismo libro mayor que guarda cualquier otro saldo del producto. No hay una segunda tabla que se desvíe del trabajo que describe."
}
```

El gasto va al lado, no dentro. Lo que cuestan las ejecuciones de un tablero ya se registra por ticket, así que el panel lee esa cifra en lugar de escribir una segunda copia que podría contradecir a la primera.

```bf-figure
{
  "kind": "screen",
  "frame": "Un tablero con su presupuesto abierto",
  "ratio": 1.62,
  "regions": [
    {
      "label": "El tablero",
      "note": "Carriles y tickets, exactamente como antes",
      "x": 4,
      "y": 8,
      "w": 56,
      "h": 74,
      "hue": "make"
    },
    {
      "label": "Presupuesto ganado",
      "note": "Puntos ganados, gasto de ejecuciones, hitos alcanzados, ganancias recientes",
      "x": 63,
      "y": 8,
      "w": 33,
      "h": 74,
      "hue": "run"
    },
    {
      "label": "Barra del tablero",
      "note": "Un botón nuevo, junto a configurar",
      "x": 4,
      "y": 88,
      "w": 92,
      "h": 8,
      "hue": "accent"
    }
  ],
  "caption": "El presupuesto se abre en un panel lateral sobre el tablero, así que los carriles siguen a la vista mientras lo lees."
}
```

## Hitos que llegan a los inversores

Un hito es algo que le ocurrió a un tablero: una épica completada, o una versión asociada a su proyecto que salió. Cada uno lleva ahora los puntos que ganaron sus tickets, y una sola lectura enumera todos los hitos alcanzados desde una fecha, por tablero. La actualización a inversores compone su sección de entrega a partir de ella. Ya no dice "lanzamos" sin un tablero y un número detrás.

## Tus compañeros tienen una página, y las menciones saben con quién hablan

El segundo hueco era más pequeño y más humano. La personalidad de un compañero aparecía en un hover del tablero y en ningún sitio al que se pudiera enlazar. No había página para una persona.

- **Un perfil para cada compañero**, en su propia dirección: nombre, avatar, rol en tu espacio de trabajo, personalidad y un resumen de su trabajo: tickets abiertos, lo que tocó en los últimos treinta días y lo que ha terminado. Lo ven las personas del mismo espacio de trabajo y nadie más.
- **Accesible donde te cruzas con la gente**: el hovercard del tablero y el directorio de miembros enlazan a él.
- **Las menciones llevan la señal.** Escribe `@` y cada persona de la lista muestra una lectura de una línea de su personalidad, como su tipo y su rasgo más marcado. Sale del mismo mapa en caché que usa el hovercard, cargado una sola vez, así que abrir la lista y escribir en ella no añade peticiones.

```bf-figure
{
  "kind": "compare",
  "title": "Elegir a quién dirigir un mensaje",
  "columns": [
    {
      "title": "Antes",
      "hue": "muted",
      "items": [
        "Una lista de nombres",
        "Abrir un tablero para saber cómo trabaja alguien",
        "Ninguna página que enviar a un colega"
      ]
    },
    {
      "title": "Ahora",
      "hue": "make",
      "items": [
        "Nombres con una lectura de personalidad de una línea",
        "Un perfil a un clic del hovercard o del directorio",
        "Resumen de trabajo junto a la personalidad"
      ]
    }
  ],
  "caption": "La personalidad da forma al tono, no a los permisos. Nada cambió sobre quién puede hacer qué."
}
```

```bf-figure
{
  "kind": "devices",
  "title": "La página de perfil en tres anchos",
  "devices": [
    {
      "label": "Escritorio",
      "width": 1280,
      "hue": "make",
      "note": "Cabecera, resumen de trabajo y personalidad en una columna"
    },
    {
      "label": "Tableta",
      "width": 834,
      "hue": "run",
      "note": "Los contadores pasan a filas"
    },
    {
      "label": "Móvil",
      "width": 360,
      "hue": "measure",
      "note": "Todo se apila; nada se desplaza hacia los lados"
    }
  ],
  "caption": "Anchos dibujados a escala."
}
```

## Dónde encaja en el método

Builderforce ordena el trabajo en un arco: Idea, Crear, Ejecutar, Medir. Este cambio toca los tres últimos, y la unión entre ellos es lo importante.

**Crear** es donde vive el tablero y donde se terminan los tickets; ahí es donde un tablero gana ahora. **Ejecutar** es donde el trabajo cuesta dinero, y el panel de presupuesto pone lo que ganó un tablero junto a lo que costaron sus ejecuciones. **Medir** es donde descubres si algo de eso importó, y un hito es la primera medición que sale del tablero: llega a la actualización a inversores con un número detrás. La página de personas también pertenece a Crear. Saber con quién trabajas, y cómo, es parte de crear bien.

Antes, el arco se rompía entre Crear y Medir: el trabajo ocurría y la evidencia se quedaba atrás. Ahora viaja con el trabajo.

---

**Lectura relacionada:** [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [Tu Evermind privado en tu máquina](/blog/your-private-evermind-on-your-machine)

[Abre un tablero](/tasks) y mueve un ticket a Hecho.
