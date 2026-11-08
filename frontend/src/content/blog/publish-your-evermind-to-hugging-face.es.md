Le enseñaste a un Evermind tu código, el tono de tu soporte, tu estilo de la casa. Pasó su comprobación de preparación. Responde en el espacio de trabajo. Y entonces alguien de fuera del espacio de trabajo pide probarlo.

Hasta hoy, la respuesta honesta era un archivo zip. El panel de exportación construía el repositorio completo de Hugging Face —pesos en safetensors, un grafo ONNX, un contenedor GGUF, la configuración, el tokenizador y una model card— y te lo entregaba como descarga. Llevarlo al Hub era cosa tuya: descomprimirlo, instalar las herramientas de línea de comandos, iniciar sesión, crear el repositorio, subir los archivos grandes de la forma correcta y esperar que la model card sobreviviera al viaje. Eso es un pequeño proyecto de software entre un modelo terminado y las personas que podrían usarlo.

## Publicar, no descargar

Elige **Repositorio de Hugging Face** en el panel de exportación y se abre una segunda sección debajo: **Publicar en Hugging Face**. Nombra el repositorio como `owner/name`, pega un token de Hugging Face con permiso de escritura, elige si el repositorio empieza como privado y publica.

```bf-figure
{
  "kind": "flow",
  "title": "Qué ocurre cuando pulsas Publicar",
  "steps": [
    { "label": "Exportar", "note": "El servidor construye el mismo paquete de repositorio que te da la descarga: safetensors, ONNX, GGUF, configuración, tokenizador y model card.", "hue": "make" },
    { "label": "Descomprimir", "note": "Tu navegador abre el paquete en los archivos de los que se compone un repositorio del Hub.", "hue": "run" },
    { "label": "Subir", "note": "El repositorio se crea si no existe, y cada archivo se sube con los pesos grandes tratados como espera el Hub.", "hue": "reach", "tag": "tu token, tu repo" }
  ],
  "caption": "La exportación en sí no cambia. Lo nuevo es el último salto: ya no necesita una terminal, un inicio de sesión ni un segundo conjunto de herramientas."
}
```

El enlace al nuevo repositorio aparece en cuanto termina la subida. Cualquiera con quien lo compartas puede cargar el modelo con las herramientas que ya usa.

```bf-figure
{
  "kind": "screen",
  "frame": "El panel de exportación con Hugging Face elegido",
  "ratio": 1.4,
  "regions": [
    { "label": "Modelo publicado", "note": "Cualquier Evermind que el espacio de trabajo haya publicado", "x": 5, "y": 6, "w": 90, "h": 12, "hue": "make" },
    { "label": "Formato: repositorio de Hugging Face", "x": 5, "y": 21, "w": 90, "h": 12, "hue": "make" },
    { "label": "Exportar y descargar", "note": "Sigue ahí, para una copia sin conexión", "x": 5, "y": 36, "w": 40, "h": 9, "hue": "muted" },
    { "label": "Publicar en Hugging Face", "note": "Repositorio · tu token · privado o público", "x": 5, "y": 49, "w": 90, "h": 45, "hue": "reach" }
  ],
  "caption": "Publicar está debajo de la descarga en lugar de reemplazarla. El mismo paquete sirve para ambas, así que lo que publicas es exactamente lo que habrías descargado."
}
```

## Tu token sigue siendo tuyo

El token va de la página directamente a Hugging Face. Builderforce nunca lo recibe, nunca lo almacena y nunca lo necesita. El repositorio pertenece a tu cuenta de Hugging Face, no a la nuestra, y puedes revocar el token en cuanto termines. Por eso tampoco requiere configuración de nuestro lado: no hay ninguna integración que conectar ni ninguna clave que entregar.

## Dónde encaja en el método

El arco va de Idea → Crear → Ejecutar → Medir, y luego **Alcanzar**: poner lo que hiciste delante de las personas a las que va dirigido. Un modelo que solo responde dentro del espacio de trabajo que lo entrenó ha sido medido por quienes lo construyeron, no por nadie que pudiera quererlo. Alcanzar es la etapa en la que eso cambia, y hasta ahora empezaba con un trabajo manual de empaquetado.

```bf-figure
{
  "kind": "compare",
  "title": "De un modelo terminado a uno que otros pueden cargar",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Exportar y descargar un zip", "Descomprimirlo", "Instalar las herramientas de línea de comandos del Hub", "Iniciar sesión", "Crear el repositorio", "Subir los pesos como archivos grandes", "Comprobar que la model card llegó"] },
    { "title": "Ahora", "hue": "reach", "items": ["Elegir repositorio de Hugging Face", "Nombrar el repositorio", "Pegar tu token", "Publicar"] }
  ],
  "caption": "Los pasos que desaparecieron no eran decisiones. Eran empaquetado, y el empaquetado es donde un modelo terminado se queda sin compartir."
}
```

## Lo que puedes hacer hoy

- **Compartir un Evermind entrenado públicamente** bajo tu propia cuenta de Hugging Face, con su model card, en un solo paso.
- **Empezar en privado** y abrir el repositorio al mundo cuando estés listo.
- **Publicar una nueva versión** en el mismo repositorio después de enseñarle más al modelo. Publicar de nuevo añade un nuevo commit al repositorio.
- **Conservar la copia sin conexión**: la descarga sigue a un clic de distancia, construida a partir del mismo paquete.

---

**Lecturas relacionadas:** [Construye y entrena un Evermind en el Creation Canvas](/blog/build-and-train-evermind-on-the-creation-canvas) · [Evermind, el modelo que se actualiza solo](/blog/evermind-self-updating-model) · [Dentro de la arquitectura de Evermind](/blog/inside-evermind-architecture)

Abre el LLM Studio, exporta un modelo publicado y elige **Repositorio de Hugging Face**.
