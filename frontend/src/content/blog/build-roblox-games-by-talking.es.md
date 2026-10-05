Un chico de trece años con una idea para un juego de Roblox tiene dos problemas, y solo uno de ellos es Luau.

El primero es el lenguaje. Los juegos de Roblox son scripts Lua que se comunican a través de la frontera entre cliente y servidor, y el camino desde "quiero un obby donde las plataformas desaparezcan" hasta unos `RemoteEvent` que funcionen es largo. Las herramientas de IA para Roblox existen para acortarlo, y en general lo consiguen.

El segundo problema es todo lo que rodea a la IA. Las herramientas actuales piden a un creador joven que descargue una app, instale un plugin de Studio, arranque un servidor local, conecte una herramienta de sincronización y mantenga las cuatro cosas funcionando: entre treinta minutos y una hora antes de la primera instrucción. Después cobran cada intento, incluidos los que fallan, y meten lo que escribió el modelo directamente en un juego al que jugarán otros niños.

**Spawn** resuelve el segundo problema, para que el primero quede resuelto.

## Una sola cosa que instalar, y a hablar

```bf-figure
{
  "kind": "flow",
  "title": "De la instalación al juego",
  "steps": [
    { "label": "Instala Spawn", "note": "Inicia sesión una vez en el navegador. Spawn escribe su propio plugin de Roblox Studio. No hace falta visitar la Creator Store ni arrancar servidores.", "hue": "idea" },
    { "label": "Di qué construir", "note": "Spawn lee el lugar que tienes abierto (el Explorador y los scripts) para que lo nuevo encaje con lo que ya hay.", "hue": "make" },
    { "label": "Pulsa Play", "note": "Los errores de la prueba vuelven a Spawn, y con un clic le pides que los arregle.", "hue": "run", "tag": "en Studio" }
  ],
  "caption": "La app es el puente. Se instala una sola cosa, se abre Studio y se empieza a escribir."
}
```

La app Spawn funciona junto a Roblox Studio. Al arrancar, escribe el plugin de Spawn en la carpeta de plugins de Studio con una clave privada que solo esa app conoce. Cuando abres Studio, el plugin encuentra la app en el mismo ordenador y se conecta. No hay proyecto Rojo que configurar, ni puertos que abrir, ni nada accesible desde fuera del equipo.

```bf-figure
{
  "kind": "screen",
  "frame": "Spawn junto a Roblox Studio",
  "ratio": 1.62,
  "regions": [
    { "label": "La conversación", "note": "Dilo con tus palabras; ideas para empezar: obby, tycoon, simulador, carreras, defensa de torres", "x": 4, "y": 10, "w": 40, "h": 70, "hue": "idea" },
    { "label": "Conexión con Studio y tokens", "x": 4, "y": 2, "w": 40, "h": 6, "hue": "accent" },
    { "label": "Roblox Studio", "note": "La creación llega como piezas y scripts reales, un paso de deshacer por creación", "x": 48, "y": 2, "w": 48, "h": 78, "hue": "make" },
    { "label": "Arregla los errores de mi prueba", "x": 4, "y": 84, "w": 92, "h": 10, "hue": "run" }
  ],
  "caption": "Cada creación es algo que ves en el visor y lees en el Explorador, y luego conservas o deshaces."
}
```

## Qué es exactamente una creación

Spawn nunca escribe dentro de Studio. Cada creación vuelve como una lista corta de operaciones: *crea este script*, *pon esta pieza aquí con estas propiedades*, *quita aquello*. El plugin aplica la lista entera dentro de un único paso de deshacer de Studio. Si no te gusta una creación, Ctrl+Z la retira entera de una vez.

Antes de que una operación llegue a tu juego pasa por un filtro de seguridad, y ese filtro es estricto con lo que más importa en los juegos que los chicos hacen para otros chicos:

- **Sin puertas traseras.** Se rechazan los scripts que llaman a internet (`HttpService`), ejecutan código oculto (`loadstring`, `getfenv`) o cargan código por id de recurso (`require(12345)`). Son justo los trucos que usan los "modelos gratuitos" para tomar el control de juegos de Roblox.
- **Nada que no puedas ver.** Spawn construye con piezas, colores, materiales, luces, partículas e interfaz. Nunca incorpora por id una imagen, un sonido o una malla que no hayas visto.
- **Apropiado para 13+.** El constructor sigue las Normas de la Comunidad de Roblox. Si pides algo que cruza la línea, Spawn te lo dice con amabilidad y propone una versión que sí está bien. Esa respuesta no cuesta nada.

## Solo pagas por las creaciones que funcionan

```bf-figure
{
  "kind": "compare",
  "title": "A dónde va el dinero",
  "columns": [
    { "title": "Herramienta de IA típica para Roblox", "hue": "muted", "items": ["Configuración larga antes de la primera instrucción", "Se cobra cada intento, incluso los fallidos", "Lo que escribe el modelo va directo al juego", "Sin límite de edad"] },
    { "title": "Spawn", "hue": "make", "items": ["Instala su propio plugin de Studio", "Las creaciones fallidas o rechazadas son gratis", "Cada operación pasa un filtro de seguridad", "13+ con una sola verificación de edad"] }
  ],
  "caption": "Una creación cobra los tokens que realmente usó, y solo cuando cambió tu juego."
}
```

Cada jugador nuevo tiene **una semana gratis**: siete días y 50.000 tokens, unas cuatro creaciones, sin tarjeta. El jugador añade el correo de un adulto, que recibe un enlace para mantener Spawn sin necesitar la contraseña del jugador. Después de la semana, la membresía de Spawn cuesta **1,99 $ al mes**. Construir funciona con tokens, que se compran en paquetes de **10, 20, 50 o 100 $**, y los paquetes grandes traen tokens extra. Una creación típica usa unos doce mil tokens, así que un paquete de 10 $ da para unas ochenta creaciones. El saldo siempre se ve en la app. Si una creación falla, no se puede leer o se rechazaron todos sus cambios, el saldo no se toca.

Las compras se hacen en la web mediante el pago de Stripe, nunca dentro de la app. Es a propósito: quien paga, a menudo una madre o un padre, decide cada recarga.

## Dónde encaja en el método

Todos los productos de Builderforce siguen el mismo arco: **Idea → Hacer → Ejecutar → Medir**, con [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop) como bucle interno. Spawn es ese arco a la medida de un primer juego.

**Hacer** es la creación: entra una frase, salen piezas y scripts, en el lugar que ya tienes abierto. **Ejecutar** es el botón Play de Studio, y es el paso en el que la mayoría de las herramientas de IA te dejan solo. Spawn escucha la salida de la prueba, así que un script que falla en la línea 40 se convierte en un botón "Arreglarlos" en lugar de un misterio. **Medir** es lo que mejor hace un creador joven: jugar, notar qué es aburrido y pedir lo siguiente. El bucle de *idea* a *algo sobre lo que puedo saltar* dura un minuto, y cada vuelta enseña qué hace el Luau, porque los scripts están ordenados y bien nombrados para poder leerlos.

## Empieza

1. Ve a [spawn.builderforce.ai](/spawn) y crea tu cuenta (pregunta a tu madre o padre).
2. Empieza tu semana gratis (pide a un adulto su correo). Después, únete por 1,99 $ al mes y consigue un paquete de tokens.
3. Descarga la app Spawn, inicia sesión, abre Roblox Studio y escribe lo que quieres construir.

*Spawn está hecho por Builderforce.ai y no está afiliado ni respaldado por Roblox Corporation.*
