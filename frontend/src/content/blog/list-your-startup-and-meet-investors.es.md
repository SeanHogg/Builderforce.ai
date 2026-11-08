Puedes llevar una idea a un lienzo, discutirla hasta convertirla en objetos, construir la cosa, ejecutarla como empresa y leer si funcionó. Después alguien tiene que financiarla, y hasta esta semana la plataforma no tenía una puerta por la que pudiera entrar un inversor.

El puesto de CEO tenía una ronda: la ronda en sí, las data rooms, las lagunas de diligencia, el paquete de captación. Todo eso da por hecho que el inversor ya está en la sala. Nada ponía a una empresa delante de un desconocido, y nada dejaba que el desconocido dijera «me interesa» sin que un fundador lo hubiera encontrado antes. La empresa existía. No podía ser *encontrada*.

## La empresa obtiene una cara pública

```bf-figure
{
  "kind": "flow",
  "title": "De una fila de empresa a la consulta de un inversor",
  "steps": [
    { "label": "Listar", "note": "Investors → Listing. Tres pasos: la empresa, sus números, qué busca. Cada paso se guarda sobre la marcha.", "hue": "run" },
    { "label": "Ser encontrada", "note": "Marketplace → Companies. Etapa, sector, tracción y si estás captando, filtrado como piensa un inversor.", "hue": "reach" },
    { "label": "Recibir respuesta", "note": "Express interest llega a Investors → Interest, junto a todo lo demás entrante, con los estados de triaje propios del CRO.", "hue": "run", "tag": "en tu espacio de trabajo" }
  ],
  "caption": "Una fila de empresa, tres escritores. El listado es una faceta de la empresa que ya diriges, no un perfil que mantienes aparte."
}
```

El listado no es un objeto nuevo. Es la empresa que ya tienes —aquella a la que se adjuntan tus proyectos, para la que se construye el paquete— con una cara pública activada. Eso importa por una razón: los números que lee un inversor son los que declaraste, una sola vez, y el runway que ve se calcula a partir de esos números con la misma fórmula que usa tu puesto de CFO. No hay nada que mantener sincronizado, porque hay una sola cosa.

```bf-figure
{
  "kind": "screen",
  "frame": "Marketplace → Companies",
  "ratio": 1.62,
  "regions": [
    { "label": "Chips de etapa", "note": "De bootstrapped a listo para IPO, más Captando ahora", "x": 4, "y": 6, "w": 92, "h": 9, "hue": "reach" },
    { "label": "Sector · etapa de negocio · orden", "x": 4, "y": 17, "w": 92, "h": 7, "hue": "reach" },
    { "label": "Una startup listada", "note": "Eslogan, etapa, sector, financiación total, MRR, equipo, salud del runway y Express interest", "x": 4, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Una startup listada", "x": 35.5, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Una startup listada", "x": 67, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Para inversores", "note": "Explora empresas que están captando", "x": 4, "y": 79, "w": 44, "h": 16, "hue": "accent" },
    { "label": "Para startups", "note": "Crea tu perfil", "x": 52, "y": 79, "w": 44, "h": 16, "hue": "accent" }
  ],
  "caption": "Los listados de startups son una familia del único escaparate, junto a talento, agentes y activos; no un quinto marketplace."
}
```

## Lo que ve un desconocido, y lo que nunca ve

Un directorio que lo muestra todo es un directorio en el que nadie se lista. Así que la tarjeta muestra aquello en lo que decide un inversor y nada que le haga daño a un fundador publicar:

```bf-figure
{
  "kind": "compare",
  "title": "Dos lectores, una regla",
  "columns": [
    { "title": "Un visitante", "hue": "reach", "items": ["Nombre, eslogan, descripción", "Etapa de financiación, sector, etapa de negocio", "Total captado, ingresos mensuales, tamaño del equipo", "Si la empresa está captando", "SALUD del runway: crítica, vigilar, sana, rentable"] },
    { "title": "Un lector con sesión iniciada", "hue": "run", "items": ["Todo lo que ve un visitante", "Runway en MESES", "El contacto de inversores que el fundador eligió publicar", "Nunca la caja disponible. Nunca el burn."] }
  ],
  "caption": "La regla por niveles vive en una función del servidor. El directorio y la página de perfil pasan por ella, así que ninguno puede filtrar lo que el otro oculta."
}
```

La caja y el burn son los dos números que más le gustaría leer a un competidor. Se quedan en el espacio de trabajo. La tarjeta lleva la banda de salud del runway —suficiente para que un inversor sepa si debe darse prisa— y un lector con sesión iniciada obtiene los meses. Pulsar **Express interest** escribe una fila en el tenant del fundador: la misma fila de deal-flow que triaja la cola del CRO, con el mensaje del inversor, el instrumento que tiene en mente y el plazo. Se notifica al fundador, que la lee en **Investors → Interest** y la marca como *en conversación*, *invirtiendo* o *descartada*. Cuando va en serio, invita al inversor a la empresa —un NDA, todas las data rooms— y el resto de la ronda sigue donde ya estaba.

## Runway, con su procedencia nombrada

BurnRateOS mostraba una sola cifra de runway y no se podía saber si venía de un feed bancario o de un formulario. Finance ahora abre con dos columnas y las etiqueta.

```bf-figure
{
  "kind": "screen",
  "frame": "Finance → Runway",
  "ratio": 1.7,
  "regions": [
    { "label": "OBSERVADO", "note": "Caja, burn neto, MRR y meses: a partir del gasto aprobado, la nómina procesada y los libros conectados, recalculado a diario", "x": 4, "y": 6, "w": 45, "h": 44, "hue": "measure" },
    { "label": "DECLARADO", "note": "Caja disponible, gasto mensual, coste del equipo, ingresos: lo que nos dijiste, editable aquí, con el veredicto al lado", "x": 51, "y": 6, "w": 45, "h": 44, "hue": "run" },
    { "label": "Mes a mes", "note": "Ingresos · gasto · burn neto · caja a fin de mes, para los meses observados", "x": 4, "y": 54, "w": 92, "h": 40, "hue": "measure" }
  ],
  "caption": "Dos procedencias, nunca mezcladas. Un runway calculado a partir de números tecleados lo dice junto a la cifra, no en una nota al pie."
}
```

La aritmética es la misma dondequiera que aparece —la calculadora gratuita de la página de Business Intelligence, el paso de onboarding del fundador, la tarjeta del listado y la vista del CFO— porque se escribe una vez y se prueba una vez. Divide la caja entre el burn *neto*. Una empresa que gasta 100 k$ e ingresa 80 k$ está quemando 20 k$, y la versión de esta fórmula que divide por el gasto bruto informa de una quinta parte del runway real. Ese es el único error de consecuencias posible aquí, y es la razón de que haya una fórmula en lugar de cuatro.

El cashflow se sitúa al lado: entradas, salidas, neto y saldo final, mes a mes, como gráfico y como tabla, para los meses que la plataforma observó y para la proyección con tu burn declarado. Tú eliges qué serie se ve en pantalla, y el pie del gráfico la nombra.

## Dónde encaja en el método

Ejecutar y Alcanzar, y la costura entre ambos.

```bf-figure
{
  "kind": "stack",
  "title": "La empresa, en el arco",
  "bands": [
    { "label": "Idea", "note": "El lienzo en el que se discutió el producto hasta darle forma", "hue": "idea" },
    { "label": "Crear", "note": "Los proyectos que se adjuntan a la empresa", "hue": "make" },
    { "label": "Ejecutar", "note": "Finance → Runway y Cashflow. El número del CFO, con su fuente nombrada.", "hue": "run" },
    { "label": "Medir", "note": "Hechos observados, recalculados a diario, junto a lo que declaraste", "hue": "measure" },
    { "label": "Alcanzar", "note": "Marketplace → Companies. La empresa es encontrada; el interés vuelve a Ejecutar.", "hue": "reach" }
  ],
  "caption": "El listado es una superficie de Alcanzar que escribe en Ejecutar. Una consulta es deal flow entrante, no una notificación."
}
```

Ejecutar lo necesitaba porque una empresa que no puede indicar su runway no puede decir de cuánto tiempo dispone para captar. Alcanzar lo necesitaba porque una empresa que no puede ser encontrada no puede captar en absoluto. El listado cierra el círculo también en sentido contrario: la consulta de un inversor es la primera señal de Medir que produce una ronda —cuántas personas miraron, cuántas preguntaron— y llega al mismo tablero donde se está construyendo aquello por lo que preguntan.

Empieza por la puerta del marketplace, o por la calculadora, o por **Investors → Listing**. Tres pasos después la empresa está listada, su runway está en Finance y el próximo desconocido que la encuentre podrá decírtelo.
