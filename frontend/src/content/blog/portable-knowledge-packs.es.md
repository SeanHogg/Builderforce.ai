Una revisión de conocimiento consigue algo que cuesta mucho ganar: un grafo de lo que un código significa de verdad, con sus sistemas, hechos, relaciones y las decisiones de criterio que hay detrás. Hasta ahora, esa comprensión vivía en un solo sitio y respondía para una sola herramienta. Volver a revisar la misma carpeta en un segundo host significaba pagar todo el coste otra vez, y dos hosts podían no estar de acuerdo.

Esa es la brecha que se ha cerrado: **la comprensión que tu revisión demostró quedaba atrapada en el host que la ejecutó.** Ahora se empaqueta y viaja.

## Un paquete portátil, no un montón de archivos

La unidad es el paquete de conocimiento portátil: un `.bfpack` en disco. Lleva los hechos revisados, los hallazgos y el criterio, y es agnóstico respecto al modelo por diseño: no incluye embeddings, así que cada consumidor vuelve a derivar los vectores a partir del texto de las tarjetas mediante hash. Lo que hace que un paquete sea fiable viaja con él como procedencia: quién lo revisó, con qué modelo juez, bajo qué política y cuándo.

```bf-figure
{
  "kind": "flow",
  "title": "Entra una revisión, sale un paquete",
  "steps": [
    { "label": "Revisa una carpeta", "note": "La revisión construye un grafo de sistemas, hechos y relaciones, con el criterio registrado.", "hue": "make" },
    { "label": "Crea el paquete", "note": "Un comando convierte el grafo revisado en un .bfpack portátil, con la procedencia incluida.", "hue": "run" },
    { "label": "Cualquier agente recupera", "note": "La única costura PackRegistry → recuperación sirve al chat, a Synapse, a la web y al turno de Evermind del Canvas.", "hue": "measure" }
  ],
  "caption": "Una revisión, un paquete, todos los consumidores: sin una segunda ruta de recuperación."
}
```

## Una costura, todos los consumidores

Hay exactamente una forma de recuperar información de un paquete: la costura `PackRegistry` → `PackRetrievalPort`. El chat de VS Code, el paquete de contexto, Synapse, `knowledge.ask` en la web y el turno de Evermind del Canvas pasan todos por ella. Un nuevo consumidor añade una implementación del registro, nunca una segunda fusión ni una segunda ruta de recuperación, así que «qué conocimiento vio el modelo» siempre tiene una sola respuesta.

Sube un paquete a un proyecto y se convierte allí en una raíz de conocimiento: sus hechos se suman a los del proyecto y alimentan su Evermind, y al quitarlo solo se quita lo que aportó.

## Por qué importa

- **Paga una vez, úsalo en todas partes.** Lo caro es la revisión. Empaquetar significa que la pagas una vez y esa comprensión sirve a todos los hosts y a todos los modelos.
- **La confianza se transporta, no se afirma.** La procedencia se registra al empaquetar y se muestra al elegir —«Revisado por … con …»—, de modo que la credibilidad de un paquete es un hecho, no una afirmación.
- **Una sola respuesta a qué sabía el modelo.** Una única costura de recuperación hace que el contexto detrás de una respuesta sea reproducible.

## Dónde encaja en el método

Esto es **Make** acumulándose en **Measure**: la revisión es la inversión, el paquete es el retorno y la recuperación es la forma en que el resto de la plataforma lo aprovecha.

## Qué puedes hacer con ello hoy

Revisa una carpeta, crea un paquete y observa cómo el mismo conocimiento revisado responde en el chat, en Synapse y en el Canvas. Sube un paquete a un proyecto y verás cómo sus hechos se suman al Evermind del proyecto.
