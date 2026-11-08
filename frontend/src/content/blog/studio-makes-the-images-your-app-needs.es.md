> **Actualización, 4 de octubre de 2026:** ahora ves cada imagen y cada clip de vídeo *antes* de que entre en tu app. El panel Media muestra lo que hizo el agente y espera a que elijas **Usarla**, **Reintentar** o **Descartar**. Mira «Lo ves primero» más abajo.

Pides una landing page para una panadería de barrio. La maquetación es correcta, el texto es correcto y la sección del menú funciona. El hero es una caja gris con "1200 × 600" en el centro.

O es peor: el agente no quiso dejar un hueco, así que escribió de memoria un enlace a una foto de stock. Quizá cargue hoy. Luego deja de hacerlo, y lo primero que ve cualquiera en tu sitio es un icono de imagen rota.

Hasta ahora, cada app que construía Studio tenía este hueco. El agente podía escribir código pero no podía hacer una imagen, así que la parte más visible de un primer borrador siempre era la menos terminada.

## El agente hace la imagen

El agente de Studio ahora tiene una herramienta de imágenes. Cuando la página necesita una imagen hero, una ilustración, una foto de producto o un fondo, el agente describe la imagen que quiere y recibe una. Esa descripción abarca el sujeto, el estilo, la paleta y la composición. También elige la forma: cuadrada, apaisada para un banner o vertical para una pantalla de teléfono. Luego coloca la imagen donde corresponde: en un `<img>`, en un fondo CSS o en la etiqueta de vista previa social.

```bf-figure
{
  "kind": "flow",
  "title": "De \"necesita una imagen hero\" a una imagen en la página",
  "steps": [
    { "label": "El agente la describe", "note": "\"Fachada de panadería cálida al amanecer, luz suave, banner apaisado.\"", "hue": "idea" },
    { "label": "Se crea la imagen", "note": "Generada para ajustarse a la descripción, con la forma que necesita la maquetación.", "hue": "make" },
    { "label": "Guardada en tu espacio de trabajo", "note": "Se guarda una vez, con un enlace permanente: nada caduca y nada apunta al servidor de otro.", "hue": "make", "tag": "enlace permanente" },
    { "label": "Escrita en el código", "note": "El enlace va a la etiqueta img o a la hoja de estilos, y la vista previa lo muestra.", "hue": "run" }
  ],
  "caption": "El agente usa la herramienta por su cuenta siempre que una maquetación necesita una imagen; también puedes pedir una por su nombre."
}
```

La imagen se guarda en tu espacio de trabajo antes de que el agente la use. Nunca recibes un enlace al archivo temporal de un proveedor, que puede desaparecer en una hora, ni un blob incrustado que infla tus archivos fuente. La vista previa muestra la imagen de inmediato y se queda ahí después de publicar.

## Qué cambia en un primer borrador

```bf-figure
{
  "kind": "compare",
  "title": "La landing page de la panadería, primer borrador",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Cajas grises de relleno con tamaños en píxeles", "Enlaces a fotos de stock adivinados de memoria, algunos rotos", "Comentarios \"Sustituye por tu imagen\" en el código", "Un borrador que parece inacabado, así que nadie juzga la maquetación"] },
    { "title": "Ahora", "hue": "make", "items": ["Una imagen hero que encaja con el brief", "Fotos de producto en la sección del menú, con un estilo coherente", "Enlaces permanentes en el código, guardados en tu espacio de trabajo", "Un borrador que parece el definitivo"] }
  ],
  "caption": "Mismo prompt, misma maquetación. La diferencia es si la página se puede juzgar tal como se verá de verdad."
}
```

Cambiar una imagen funciona como cambiar cualquier otra cosa en Studio. Di "haz que el hero sea una toma al anochecer con las luces encendidas" y el agente hace una imagen nueva y cambia el enlace. El turno se guarda como una versión, así que la imagen anterior queda a una restauración de distancia.

## Lo ves primero

Una imagen es una decisión de gusto, y el agente no debería tomarla solo. Ahora, cuando el agente genera una imagen o un clip de vídeo, no lo escribe en la página de inmediato. El **panel Media** se desliza junto a tu app con la nueva imagen, y el agente espera tu respuesta.

```bf-figure
{
  "kind": "screen",
  "frame": "Studio con el panel Media abierto",
  "ratio": 1.62,
  "regions": [
    { "label": "Brain", "note": "El agente pidió una imagen hero y está esperándote", "x": 2, "y": 8, "w": 24, "h": 86, "hue": "idea" },
    { "label": "Tu app", "note": "Sin cambios hasta que decidas", "x": 28, "y": 8, "w": 44, "h": 86, "hue": "run" },
    { "label": "Usarla · Reintentar · Descartar", "note": "La nueva imagen a tamaño completo, con su prompt para editar", "x": 74, "y": 8, "w": 24, "h": 44, "hue": "make" },
    { "label": "Media de este proyecto", "note": "Todo lo generado hasta ahora, para reutilizar o copiar", "x": 74, "y": 56, "w": 24, "h": 38, "hue": "accent" }
  ],
  "caption": "El agente solo escribe el enlace en tu código después de que elijas Usarla. Reintentar vuelve a renderizar con el prompt tal como lo editaste, sin otro viaje de ida y vuelta por el chat."
}
```

- **Usarla:** el agente la pone en la app y el panel la marca como en uso.
- **Reintentar:** edita el prompt si quieres y una versión nueva ocupa su lugar.
- **Descartar:** no entra nada en la app y el agente te pregunta qué prefieres en su lugar.

También puedes generar tú mismo desde el panel, imágenes o clips de vídeo, en horizontal, cuadrado o vertical. Todo lo que se hace para el proyecto se queda en su biblioteca de media. Haz clic en **Usar en la app** en cualquier elemento y el chat recibe una petición ya preparada; tú solo dices dónde va.

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco —**Idea → Crear → Ejecutar → Medir**— y cada acto pasa por el mismo ciclo interior: [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop).

Las imágenes pertenecen al acto de **Crear**, y importan más en **Probar**. Pruebas un borrador enseñándoselo a alguien: un cofundador, un cliente, el dueño de la panadería. La gente reacciona a cómo se ve una página antes de reaccionar a cómo funciona. Una maquetación llena de marcadores de posición les pide que imaginen la página terminada, y la mayoría acaba juzgando las cajas. Con imágenes reales, un primer borrador recibe las reacciones que necesitas oír.

También mantiene **Construir** en un solo lugar. Antes, terminar una página significaba salir de Studio para buscar, descargar, subir y pegar enlaces. Ahora las imágenes salen de la misma conversación que el código y se guardan donde la app siempre puede alcanzarlas.

## Qué puedes hacer con esto hoy

- **Ver cada imagen y clip antes que tu app**: úsalo, reintenta o descártalo en el panel Media.
- **Pedir una página y recibir sus imágenes**: arte hero, ilustraciones, fotos de producto y fondos, hechos para encajar en la maquetación.
- **Cambiar una imagen describiendo el cambio**, y restaurar la anterior desde Versiones si te gustaba más.
- **Publicar sin arreglar enlaces de imagen**: cada imagen generada se guarda en tu espacio de trabajo con un enlace permanente.

Las imágenes generadas consumen tus créditos diarios de imagen, la misma asignación que las imágenes hechas en el lienzo.
