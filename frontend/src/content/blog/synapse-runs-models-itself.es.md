Synapse ahora ejecuta los modelos por sí mismo. Ya no hace falta Ollama.

Hasta este cambio, los modelos locales en Synapse significaban instalar el runtime de otro, esperar que estuviera en el PATH y conformarte con los tipos de GGUF que ese runtime aceptara. Era un producto que no controlábamos, en la ruta crítica de un producto que sí controlamos.

```bf-figure
{
  "kind": "flow",
  "title": "De la instalación a un modelo en el editor",
  "steps": [
    { "label": "Synapse", "note": "La app de escritorio arranca y supervisa bfi serve. Sin instalar Ollama.", "hue": "idea" },
    { "label": "bfi", "note": "El motor nativo carga GGUF, incluidos PQ2_0 y PTQ1_0 de PrismML.", "hue": "make" },
    { "label": "desktop.json", "note": "Synapse escribe ~/.builderforce/desktop.json con el endpoint de modelos.", "hue": "run" },
    { "label": "VS Code", "note": "La extensión de BuilderForce descubre el provider id synapse y lista esos modelos.", "hue": "run" }
  ],
  "caption": "Un solo runtime en la máquina. El editor lo encuentra. Ollama no está en el camino."
}
```

## Por qué sustituimos Ollama

Tres costes, todos pagados por quien intenta ejecutar un modelo en su propia máquina.

**Un paso de instalación fuera de nuestro control.** Si faltaba Ollama, la vista de Modelos te enviaba a la página de descargas de otro. Synapse no podía iniciar la inferencia local hasta que ese otro producto estuviera presente y en buen estado.

**Los formatos que más queremos no se ejecutaban en él.** Ternary Bonsai 2 27B de PrismML se distribuye como GGUF `PQ2_0` / `PTQ1_0`: bloques ternarios de 2 bits y ~1,75 bits. El llama.cpp estándar, que Ollama incorpora, rechaza ambos tipos. Solo un fork los ejecutaba. Un producto de modelos locales que no puede cargar los pesos que nos importan no es un producto de modelos locales.

**El dimensionado era una conjetura.** Las estimaciones de memoria salían de una tabla fija de bits por peso. No sabía nada de los formatos ternarios, del coste de KV de la atención híbrida ni de la sobrecarga real del runtime. `bfi fit` estima a partir del GGUF que realmente cargamos.

## La historia de los 2 bits

`bfi` es un motor en Rust puro en [builderforce-inference](https://github.com/SeanHogg/builderforce-inference). Lee GGUF v2/v3, incluidos `PQ2_0` (tipo 142) y `PTQ1_0` (tipo 143) de PrismML. Esos son los formatos de 2 bits / ternarios con los que Bonsai 2 27B realmente se distribuye, no Q2_0 ni TQ1_0, que no pueden representar sin pérdida un checkpoint de grupo 128.

Synapse supervisa `bfi serve` como proceso hijo: comprobaciones de salud, backoff, reinicio. Si el motor muere, Synapse sigue funcionando. El sidecar de CPU se incluye con la app. También puedes instalar la CLI tú mismo:

```sh
cargo install --git https://github.com/SeanHogg/builderforce-inference bfi
```

Los binarios firmados de GitHub Release aún no se han publicado. Eso depende de los secretos de firma del propietario, no de este cambio.

## VS Code lo encuentra en la máquina

La extensión de BuilderForce para VS Code no adivina un puerto. Lee `~/.builderforce/desktop.json` (Windows: `%USERPROFILE%\.builderforce\desktop.json`; se puede sobrescribir con `BUILDERFORCE_DESKTOP_DISCOVERY`):

```json
{
  "models": {
    "endpoint": "http://127.0.0.1:…",
    "provider": "synapse"
  }
}
```

El id del proveedor local es `synapse`, nunca `bfi`. El catálogo y la instalación pasan por Synapse (`GET /v1/synapse/catalog`, `POST /api/pull`). Si Synapse no se está ejecutando, el grupo no se muestra. Un proveedor Ollama existente sigue funcionando contra cualquier servidor compatible con Ollama, incluido un `bfi serve` independiente.

## Lo que no afirmamos

El sidecar de CPU se incluye. Ese es el cambio.

**No** hemos afirmado el 70 % en GPU de los tok/s de llama-bench en Metal o NVIDIA. Los kernels de CubeCL compilan; la medición de go/no-go no se ha realizado.

**No** hemos afirmado la identidad greedy en vivo de Bonsai 27B frente al fork de llama.cpp de PrismML. Las pruebas de ajuste a 32K / 36 GiB pasan en CPU; la comparación en vivo necesita pesos que no ejecutamos en CI.

Eso sigue en el ROADMAP. Esta entrada es el cambio, no la meta.
