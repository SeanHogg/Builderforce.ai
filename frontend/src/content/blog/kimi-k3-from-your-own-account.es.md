Pagas Kimi. Kimi K3 es un modelo de código potente con una ventana de contexto de un millón de tokens. Quieres usarlo en el trabajo que tienes delante: para planificar un cambio, escribirlo o ambas cosas.

Hasta ahora eso exigía más configuración de la necesaria. El edge de Kimi rechaza el tráfico de las plataformas en la nube alojadas antes incluso de leer una credencial. Por eso, una suscripción de Kimi conectada a tu espacio de trabajo solo funcionaba mientras un runtime de Builderforce independiente estuviera en línea para reenviar las peticiones. En el editor, Kimi solo aparecía si además habías instalado la CLI de Kimi Code y habías iniciado sesión en ella. En Rovr no aparecía en absoluto.

## Elige Kimi y el inicio de sesión llega a ti

Ahora el orden es el que esperarías. Primero eliges el modelo, y Builderforce solo te pide la cuenta si todavía no tiene una.

```bf-figure
{
  "kind": "flow",
  "title": "El primer turno con Kimi, de principio a fin",
  "steps": [
    { "label": "Elegir", "note": "Elige Kimi K3 en el selector de modelos de VS Code o en Ajustes → Modelo de Rovr.", "hue": "idea" },
    { "label": "Iniciar sesión", "note": "¿Aún no hay una cuenta de Kimi en el espacio de trabajo? Se abre la propia página de inicio de sesión de Kimi con el código ya rellenado. Apruébalo y listo; no hay nada que pegar.", "hue": "make" },
    { "label": "Conservar", "note": "La conexión se guarda en las integraciones de tu espacio de trabajo, así que la app web, el editor y Rovr ven la misma cuenta.", "hue": "make" },
    { "label": "Ejecutar", "note": "Tu equipo guarda un token de corta duración y llama a Kimi directamente. El editor y el navegador son justo el cliente personal para el que está licenciada la suscripción.", "hue": "make", "tag": "en tu equipo" }
  ],
  "caption": "La cuenta pertenece al espacio de trabajo y el token vive en el equipo. Solo Builderforce renueva la conexión, así que un segundo portátil nunca se queda con un inicio de sesión ya retirado."
}
```

Dos detalles hacen que esto aguante en el uso diario.

**El token dura poco a propósito.** Tu equipo solo guarda un token de acceso de quince minutos, nunca la credencial de renovación de larga duración. Kimi cambia esa credencial cada vez que se usa, así que si dos sitios la renuevan, uno de ellos siempre tiene una que ya no sirve. Builderforce la renueva, y cada dispositivo le pide un token nuevo cuando lo necesita. El editor y Rovr reutilizan un token guardado entre reinicios mientras siga siendo válido, así que la mayoría de los turnos no hacen ninguna petición extra.

**K3 lo decides tú, no una suposición.** Kimi K3 viene con algunos planes de Kimi y no con otros. Builderforce no envía en silencio cada turno de Kimi a un modelo que tu plan podría rechazar. Si tu plan incluye K3, abre Ajustes → Trae tus propios modelos → Kimi y sube K3 al primer puesto. El editor, Rovr y las ejecuciones en la nube empezarán con él y, si hace falta, bajarán por tu lista.

```bf-figure
{
  "kind": "compare",
  "title": "Usar tu suscripción de Kimi",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Conectar Kimi en la web", "Instalar y ejecutar un runtime de agente aparte para que reenvíe", "O instalar la CLI de Kimi Code e iniciar sesión en ella para el editor", "Nada en Rovr"] },
    { "title": "Ahora", "hue": "make", "items": ["Elegir Kimi K3 donde estés trabajando", "Aprobar un inicio de sesión cuando el primer turno lo pida", "El editor y Rovr llaman a Kimi por sí mismos", "Una conexión compartida por todo el espacio de trabajo"] }
  ],
  "caption": "Si la CLI de Kimi Code ya tiene la sesión iniciada en tu equipo, el editor sigue usando primero ese inicio de sesión. La conexión del espacio de trabajo es lo que permite que todo lo demás funcione sin ella."
}
```

## Dónde encaja en el método

Casi siempre se trata del acto **Construir**. Construir es el paso caro de [Leer, Demostrar, Construir](/blog/read-prove-build-the-inner-loop), y es donde la capacidad de código del modelo decide cuántas pasadas necesita un cambio. Builderforce ya asigna un papel a cada turno: una ejecución planifica primero y luego entrega el primer cambio de código al mejor modelo de código que tengas conectado. Kimi K3 ahora puede ocupar cualquiera de los dos papeles, o ambos: planificar con algo barato y programar con K3, planificar con K3 y pasar el código a Claude, o dejarlo todo en K3.

También importa para **Leer y Demostrar**. Esos dos pasos no cuestan nada para que la decisión de construir sea una decisión de verdad, y una ventana de un millón de tokens permite leer un repositorio entero de una sola pasada antes de comprometerse con un cambio.

## Qué puedes hacer con esto hoy

- **Elegir Kimi K3 en VS Code** sin instalar nada más. El selector ofrece «Conectar Kimi» y, una vez conectado, te deja elegir qué modelo de Kimi usan los nuevos turnos.
- **Usar Kimi en Rovr**, el asistente del navegador. Ajustes → Modelo muestra tus modelos de Kimi. Si un turno de Kimi no encuentra una cuenta, el chat muestra una tarjeta para conectar en lugar de un error.
- **Conectar una sola vez para todo el espacio de trabajo.** Una cuenta conectada desde el editor aparece en la web y en Rovr, y al revés.
- **Poner K3 en primer lugar** si tu plan lo incluye, y todas las superficies empezarán con él.

---

**Lecturas relacionadas:** [Leer, Demostrar, Construir: el bucle interno](/blog/read-prove-build-the-inner-loop)

Abre el selector de modelos en VS Code, elige **Conectar Kimi** y prueba tu próximo cambio con K3.
