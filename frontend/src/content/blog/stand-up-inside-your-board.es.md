Cada mañana, un equipo abandona aquello de lo que va a hablar para poder hablar de ello.

El tablero está en una pantalla. La reunión diaria, en otra —una sala de reuniones, una mesa redonda, una cuadrícula de caras—, y alguien comparte pantalla para que todos vean el tablero que acaban de dejar. Quince minutos después, todos vuelven a donde ya estaban.

No es un problema de videoconferencia. Es un problema de forma: la ceremonia cuyo único tema es el trabajo que tienes delante era la única que no tenía un sitio sobre ese trabajo.

## La sala

Ahora hay una quinta forma de leer un tablero, junto a la conversación, el grafo, el espacio 3D y la app: **la sala**.

```bf-figure
{
  "kind": "screen",
  "frame": "Un tablero, leído como sala",
  "ratio": 1.62,
  "regions": [
    { "label": "El círculo", "note": "Todos los de la sesión, de pie alrededor de una mesa. Tu propio cuerpo se dibuja junto al de los demás.", "x": 4, "y": 8, "w": 66, "h": 62, "hue": "make" },
    { "label": "La pared", "note": "Los objetos más recientes de la sesión, con la imagen real que produjo cada uno", "x": 12, "y": 12, "w": 50, "h": 22, "hue": "idea" },
    { "label": "Quién está aquí", "note": "Iluminado para quienes están en la sala, atenuado para quienes están en el tablero", "x": 73, "y": 8, "w": 23, "h": 74, "hue": "accent" },
    { "label": "Selector de superficie", "x": 4, "y": 88, "w": 30, "h": 8, "hue": "accent" },
    { "label": "N de M presentes", "x": 38, "y": 88, "w": 32, "h": 8, "hue": "accent" }
  ],
  "caption": "Con alcance de tablero, como las superficies de app y de estadísticas: el tema de la sala es la sesión entera, así que no hay ninguna tarjeta desde la que entrar, y pulsarla sin nada seleccionado tiene respuesta."
}
```

Pulsa Sala y el tablero se convierte en un lugar. Tu equipo está de pie, en círculo, alrededor de una mesa. Detrás, en la pared, están los propios objetos de la sesión: no iconos que los representan, sino la vista previa real que produjo cada uno. Haz clic en uno y se selecciona la tarjeta a la que corresponde.

## Todo el mundo tiene silla

La decisión de diseño que más importó tuvo que ver con la ausencia.

Una sala en la que la gente solo aparece cuando se mueve es una sala en la que no puedes distinguir entre "no se ha unido nadie" y "nadie ha hablado todavía". Por eso la sala sienta a **todos los participantes** y marca quién está de verdad: un cuerpo iluminado con una placa de nombre brillante para quien está en la sala ahora mismo, y uno atenuado para el compañero que está en el tablero, pero no dentro de ella.

```bf-figure
{
  "kind": "compare",
  "title": "Dos respuestas a \"quién está aquí\"",
  "columns": [
    {
      "title": "Una sala con su propia lista de miembros",
      "hue": "bad",
      "items": [
        "La sala lleva su propio registro de quién se ha unido",
        "Un portátil cerrado deja ese registro activo",
        "La lista y la sala pueden no coincidir",
        "La asistencia se convierte en algo que hay que cuadrar"
      ]
    },
    {
      "title": "Un registro de presencia, dos lecturas",
      "hue": "good",
      "items": [
        "La sala no tiene ninguna lista de miembros propia",
        "Un puntero y un cuerpo viajan en el mismo mensaje del relé",
        "Al salir, tu cuerpo desaparece de inmediato",
        "El tablero y la sala no pueden discrepar"
      ]
    }
  ],
  "caption": "Un cursor en el tablero y un cuerpo en la sala son la misma pregunta —dónde está esta persona ahora mismo— formulada por dos superficies. Por eso comparten un canal en lugar de que cada una se invente el suyo."
}
```

Esa elección es la razón por la que la sala no necesitó ninguna tabla nueva, ninguna membresía nueva ni ningún registro nuevo. Lee la lista de participantes que la sesión ya tiene y la presencia en vivo que el tablero ya transmite.

Hay un matiz que conviene mencionar, porque es justo lo contrario de cómo se comporta un cursor. Un puntero quieto es un puntero obsoleto, así que el tablero lo olvida al cabo de medio minuto. Pero estar quieto es precisamente en lo que *consiste* una reunión diaria, así que tu presencia en la sala se reafirma con un latido discreto, y en cuanto te vas, tu cuerpo se va contigo.

## Imágenes en las paredes

El mismo cambio dio a los espacios 3D algo que nunca habían tenido: una cara sobre la que poner algo.

Un objeto del escenario podía decir de qué color era y nada más, y por eso nunca se le podía *poner* nada encima. Ahora cualquier objeto con una cara plana admite una imagen —la foto de una pizarra, un diagrama, un render— que queda colgada a escala real, legible tanto a la sombra como al sol.

```bf-figure
{
  "kind": "flow",
  "title": "Una forma de pintar una cara, tres sitios donde aparece",
  "steps": [
    { "label": "Añadir", "note": "Pega la URL de una imagen en una pared, una plataforma o una zona de meta del espacio 3D", "hue": "make" },
    { "label": "Colgar", "note": "La pared de la sala usa la misma primitiva para los propios objetos de la sesión, y carga y falla exactamente igual", "hue": "make" },
    { "label": "Degradar con elegancia", "note": "Una imagen que no carga recupera el color propio del objeto, en lugar de dejar un cuadrado negro o una superficie en blanco", "hue": "run", "tag": "las URL escritas a mano se rompen" }
  ],
  "caption": "Una imagen en la pared de un mundo y una tarjeta en la pared de la sala las dibuja un único componente, así que no pueden verse distintas, cargar de forma distinta ni fallar de forma distinta."
}
```

Y una sala en la que no puedes entrar es peor que una vista plana: donde WebGL no arranca, la misma sesión se abre como un círculo legible de nombres en lugar de negarse.

## Dónde encaja en el método

La sala es la primera superficie cuyo tema son las **personas** y no los objetos, y eso la sitúa de forma peculiar en el arco: se gana el sitio de maneras distintas en cada etapa, y no es inútil en ninguna.

Está disponible desde **Idea** en adelante, lo que rompe deliberadamente con cómo se restringe Estadísticas. Estadísticas no aparece hasta Medir porque un panel sin nada fijado no puede mostrarle nada a nadie. Una sala con una persona dentro es una sala con una persona dentro: correcta, legible y exactamente lo que parece un taller diez segundos antes de que llegue la segunda. Restringir una *reunión* según la etapa en la que dice estar un tablero sería una regla con la forma equivocada: dos personas que quieren hablar de una idea son precisamente el motivo de la sala, no un argumento en su contra.

Donde más cambia:

- **Idea**: el taller. Alejarse de una pared y ver cómo se agrupan las cosas es un acto espacial que el software aplanó; aquí es donde vuelve.
- **Crear**: la reunión diaria, y la única etapa en la que la sala es toda la respuesta. Nadie quiere escribir código desde dentro de una sala. Lo que sí quiere todo el mundo son quince minutos con todas las caras a la vista y el trabajo del sprint en la pared, detrás.
- **Medir**: la retrospectiva, que es la ceremonia *más* espacial que existe: una pared, una línea de tiempo y gente de pie en el punto exacto donde todo se torció.

Leer → Demostrar → Crear dice que los dos actos que deciden si merece la pena hacer el caro son gratis. Una reunión diaria es uno de ellos. No cuesta nada, cambia lo que se construye, y nunca debería haber hecho falta salir del tablero para tenerla.

Pulsa **Sala**.
