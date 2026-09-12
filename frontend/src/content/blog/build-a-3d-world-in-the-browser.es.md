El Lienzo de Creación tiene desde hace tiempo una vista 3D. Era una lectura del tablero plano: tus tarjetas, dispuestas en el espacio, agradables de sobrevolar; una vista más que un lugar. Nada vivía en ella. No podías dejar una caja en el suelo.

Un **mundo** es la otra cosa: un objeto con su propia cámara, sus propios objetos de escena y física real, que se abre igual que un sitio web se abre en una vista previa del sitio o un juego en una superficie de juego.

## Qué significa realmente crear un mundo

```bf-figure
{
  "kind": "flow",
  "title": "De una escena vacía a algo que puedes recorrer",
  "steps": [
    { "label": "Colocar", "note": "Suelta objetos en la escena y muévelos. Cada uno es un objeto de tu tablero, con el mismo panel de ajustes que cualquier otro objeto.", "hue": "make" },
    { "label": "Encuadrar", "note": "Mueve la cámara. Lo que fijes es lo que verá otra persona al abrir el mundo.", "hue": "make" },
    { "label": "Recorrer", "note": "Toma el control de un personaje y muévete por la escena con peso real, gravedad real y colisiones reales.", "hue": "make", "tag": "física" }
  ],
  "caption": "Construido sobre Three.js con un motor de física Rapier: colisionadores de verdad, no su ilusión, así que una pared te detiene y una rampa te frena."
}
```

```bf-figure
{
  "kind": "screen",
  "frame": "Un mundo abierto en el lienzo",
  "ratio": 1.62,
  "regions": [
    { "label": "La escena", "note": "Objetos con colisionadores, una cámara que mueves, un cuerpo que el suelo sostiene", "x": 4, "y": 8, "w": 60, "h": 72, "hue": "make" },
    { "label": "Objetos de escena", "note": "Cada uno, un objeto de tu tablero", "x": 67, "y": 8, "w": 29, "h": 34, "hue": "idea" },
    { "label": "Ajustes", "note": "El mismo panel que cualquier otro objeto", "x": 67, "y": 46, "w": 29, "h": 34, "hue": "accent" },
    { "label": "Jugar · cámara · compartir", "x": 4, "y": 86, "w": 92, "h": 9, "hue": "accent" }
  ],
  "caption": "Un mundo es un objeto como cualquier otro, y por eso hereda los ajustes, la compartición y la barra de comandos en lugar de ser un editor aparte pegado a un lado."
}
```

La distinción que importa son los **colisionadores**. Muchísimas herramientas 3D para navegador te dan una escena que puedes orbitar. Muy pocas te dan un cuerpo al que la escena ofrece resistencia. En cuanto hay un personaje con masa, un suelo que lo sostiene y paredes que no le dejan pasar, lo que estás creando deja de ser un diagrama de un espacio y pasa a ser un espacio, y las preguntas cambian de «¿se ve bien?» a «¿se puede ir de aquí a allí?».

## Los juegos creados aquí ya se pueden jugar

Entre «pide un juego» y «juega a un juego» había dos fallos, y no tenían relación entre sí, por eso arreglar uno nunca parecía ayudar.

**El primero era la creación.** Pedir un juego de Roblox producía un documento de diseño de cuatro mil palabras —pilares, clases, un plan de monetización, una hoja de ruta a doce meses— y nada jugable. La mitad de publicación estaba construida y la mitad de creación nunca se había conectado: una herramienta creaba el objeto, otra producía los artefactos y nada los unía. El camino hacia una versión jugable era un botón del inspector que solo aparecía cuando ya existía una versión. Así que el botón que habría creado un juego necesitaba un juego.

**El segundo era el reconocimiento.** Un lugar `.rbxlx` es XML. Todo lo que contenía un juego se preguntaba «¿esto es HTML?» para decidir qué entorno de ejecución usar, y trataba el «no» como *aquí no hay ningún juego*. Así que un lugar de Roblox generado, descargable y con el título correcto seguía en el tablero mientras la superficie de juego que había debajo decía **«Aún no hay juego.»**

```bf-figure
{
  "kind": "compare",
  "title": "Dos preguntas que se habían fundido en una",
  "columns": [
    { "title": "¿Qué entorno de ejecución usa esto?", "hue": "make", "items": ["HTML → el entorno web", "Un lugar de Roblox → decodificarlo y recorrerlo", "Un mundo → el entorno de escena"] },
    { "title": "¿Existe este juego?", "hue": "measure", "items": ["¿Hay algún artefacto?", "Lo responde el artefacto, no su formato", "Un archivo real ahora responde que sí"] }
  ],
  "caption": "Una pregunta con dos sombreros es la forma más común de un error que no tiene sentido visto desde fuera."
}
```

Ahora un lugar de Roblox se puede jugar en el navegador; no fingiendo ejecutar Luau, que es un motor con autoridad en el servidor que ninguna página web es, sino leyendo el mundo a partir del archivo y recorriéndolo en el mismo entorno de Three.js y Rapier que el lienzo ya tiene. Las piezas se convierten en objetos de escena a una escala derivada de la altura del personaje, de modo que un lugar construido en studs llega al tamaño con el que se diseñó.

Y uno más, notificado desde una superficie de juego en directo: un bucle de reaparición por peligro que dejaba al personaje clavado en el punto de aparición, con las flechas del teclado muertas y el marcador mostrando `0/3 collected, 2076 hits`. Cada contacto con un peligro reconstruía el gestor de colisiones, que volvía a registrar el colisionador, que volvía a disparar el solapamiento que reconstruía el gestor. El personaje no es que no pudiera moverse: lo teletransportaban de vuelta en cada fotograma. Ahora se mueve.

## Por qué una herramienta de construcción tiene un motor 3D

Porque «hacerlo real» no siempre significa una página web.

Las [ocho formas de hacer real una idea](/blog/eight-ways-to-make-an-idea-real) van desde un vídeo demo de 90 segundos hasta un sistema en producción, y la prueba adecuada para una idea espacial —un escenario de formación, un plano por el que alguien tiene que moverse, un bucle de juego que o se siente bien o no— casi nunca es una captura de pantalla con flechas. Una escena que se puede recorrer es una prueba realmente barata de algo sobre lo que, de otro modo, es imposible discutir en un documento.

El mismo tablero contiene las notas de diseño, el código, los tickets y el mundo. Ese es todo el argumento: no que un lienzo pueda hacer 3D, sino que el 3D está junto a todo lo demás que decide si la cosa llega a hacerse.

---

**Lecturas relacionadas:** [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [Cuarenta y ocho objetos vivos, un Lienzo de Creación](/blog/forty-eight-live-objects-one-creation-canvas) · [Diseña, construye, depura: un espacio de trabajo espacial](/blog/design-build-debug-one-spatial-workspace)

[Abre un lienzo](/create) y pide un mundo con una rampa y una puerta cerrada con llave.
