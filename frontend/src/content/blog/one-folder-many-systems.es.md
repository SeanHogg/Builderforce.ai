Apuntas una revisión a la carpeta donde guardas tu trabajo. Contiene cinco repositorios y dos copias sueltas de uno de ellos, que alguien hizo para una prueba y nunca borró. Esperas un mapa de cinco sistemas.

Obtuviste un solo sistema. Cada línea llevaba el nombre de lo que apareciera primero, la mayoría terminaba tras una sola estación, y las copias se contaban como código real, de modo que los mismos problemas salían tres veces. En las carpetas más grandes, la mayoría de los archivos nunca se leía, porque la revisión se detenía tras una cifra fija.

Ese es el vacío: **una carpeta grande se leía como un sistema enredado, y las copias sueltas ensuciaban el mapa.**

## Cada sistema es su propio sistema

La revisión ahora mira lo que hay en la carpeta y la divide. Una subcarpeta que es su propio repositorio es un sistema. Una carpeta con un manifiesto de proyecto es un sistema. Dentro de un sistema, sus paquetes de workspace son las apps que lo componen. Una carpeta que ya es un repositorio sigue siendo un solo sistema.

```bf-figure
{
  "kind": "compare",
  "title": "La misma carpeta, antes y después",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Cinco repos y dos copias se leían como un proyecto", "Líneas con el nombre de las copias", "Cada línea terminaba tras una estación", "Problemas contados de nuevo por cada copia", "En carpetas grandes, la mayoría de archivos sin leer"] },
    { "title": "Ahora", "hue": "make", "items": ["Cada repo es su propio sistema", "Líneas agrupadas por sistema, con nombre de sistema y paquete", "Cada línea dice dónde y por qué termina", "Problemas contados solo dentro de un sistema", "Sin tope de archivos: se mapea toda la carpeta"] }
  ],
  "caption": "Nada cambió en tu carpeta. El mapa simplemente dejó de fingir que era una sola cosa."
}
```

Las líneas se agrupan por sistema y se reparten con equidad, para que un sistema grande no expulse a los demás del mapa. La cabecera empieza en el sistema donde estás. Cuando la carpeta tiene más de un sistema, la vista de Sistema muestra un nivel por cada uno.

## Las copias sueltas se encuentran, no se adivinan

Cuando dos sistemas contienen el mismo proyecto y sus archivos coinciden casi por completo, la revisión lo trata como una copia. Te dice qué carpeta parece la copia suelta, normalmente la que no tiene un repositorio detrás, y por qué. Hasta que decidas, la copia sigue en el mapa, marcada como copia, con sus líneas plegadas bajo el original para no duplicar el ruido.

Decides con un clic.

```bf-figure
{
  "kind": "flow",
  "title": "De una carpeta desordenada a un mapa limpio",
  "steps": [
    { "label": "Revisar", "note": "Apúntala a la carpeta. Cada sistema se encuentra y se dibuja por separado.", "hue": "idea" },
    { "label": "Detectar copias", "note": "Un árbol incluido o duplicado se marca como copia, con el motivo.", "hue": "make" },
    { "label": "Excluir", "note": "Un clic añade la carpeta a tu lista de ignorados y lanza una nueva revisión con la estimación y confirmación habituales.", "hue": "run", "tag": "tu decisión" },
    { "label": "Mapa limpio", "note": "Solo queda el código real, agrupado por sistema.", "hue": "measure" }
  ],
  "caption": "La revisión encuentra el problema y ofrece la solución. Nunca cambia tu carpeta a tus espaldas, y nunca tienes que editar un archivo de ignorados a mano."
}
```

**Excluir es una nueva revisión normal.** Pasa por el mismo plan, estimación y confirmación que cualquier otra, así que ves lo que costará antes de gastar nada, y después la copia desaparece del mapa.

## Sin tope, y nada se descarta en silencio

Una carpeta grande se lee entera. El único límite que queda es el tamaño de un archivo, y cada archivo omitido se cuenta y se nombra en el diagnóstico, de modo que un hueco en el mapa se puede leer en vez de sospechar. Un sistema que se quedó a medias lo dice.

Las referencias entre sistemas se muestran como externas, no como un error de capas. Un servicio que llama a otro repositorio ya no se informa como si rompiera su propia arquitectura.

```bf-figure
{
  "kind": "screen",
  "frame": "Revisión de una carpeta con muchos sistemas",
  "ratio": 1.62,
  "regions": [
    { "label": "Sistemas", "note": "Un nivel por sistema cuando la carpeta tiene más de uno", "x": 4, "y": 8, "w": 56, "h": 52, "hue": "make" },
    { "label": "Líneas por sistema", "note": "Agrupadas por sistema, con nombre de sistema y paquete, cada una con su motivo de parada", "x": 64, "y": 8, "w": 32, "h": 52, "hue": "idea" },
    { "label": "Copia encontrada · Excluir de la revisión", "note": "La carpeta suelta, por qué parece una copia, y el botón", "x": 4, "y": 64, "w": 56, "h": 30, "hue": "run" },
    { "label": "Diagnóstico", "note": "Sistemas, copias, archivos omitidos, dónde termina cada línea", "x": 64, "y": 64, "w": 32, "h": 30, "hue": "measure" }
  ],
  "caption": "Así se ve ahora un workspace de muchos repos: los sistemas, la copia y la forma de quitarla en una sola pantalla."
}
```

## Dónde encaja en el método

Este es el paso **Read** (Leer): entender lo que tienes antes de construir. El método va de Read a Prove a Build, y el arco que lo rodea va de Idea a Make, Run y Measure. Un mapa que funde cinco sistemas en uno, o cuenta una copia suelta como código real, da una imagen falsa para decidir, y cada paso posterior hereda el error. Leer cada sistema por sí mismo y apartar las copias hace que la decisión de construir se apoye en lo que realmente hay.

## Qué puedes hacer hoy

- **Revisar un workspace de muchos repos** y ver cada uno como su propio sistema.
- **Leer un monorepo por paquetes**, con las líneas agrupadas bajo el sistema al que pertenecen.
- **Detectar copias sueltas** y quitarlas del mapa con un clic, tras la estimación habitual.
- **Fiarte del tamaño del mapa**, porque ningún archivo se descarta por ser el número varios miles.

---

**Sigue leyendo:** [Watch your codebase review run](/blog/watch-your-codebase-review-run) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)
