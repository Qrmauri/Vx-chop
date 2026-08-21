# VX-CHOP

Sampler y slicer de audio creado con React y Vite. Permite cargar un sample desde el navegador, seleccionar cortes sobre su waveform, reproducirlos con pads y exportar una mezcla en formato WAV.

## Funciones

- Carga local de archivos de audio mediante drag and drop o selector de archivos.
- Visualizacion del waveform del primer canal del audio.
- Creacion de cortes arrastrando sobre el waveform.
- Redimensionado de los limites de cada corte.
- Renombrado, seleccion, eliminacion y reproduccion individual de cortes.
- Pads interactivos para disparar los cortes con el raton o el teclado.
- Secuencia de reproduccion con `Reproducir todo`.
- Control de pitch de `-12` a `+12` semitonos.
- Zoom de la vista del waveform y enfoque sobre el corte seleccionado.
- Deteccion aproximada de nota, frecuencia y desviacion en cents.
- Analizador de espectro en tiempo real (barras de frecuencia) de lo que se esta reproduciendo.
- Barra de duracion/playhead estilo Serato Sample: muestra tiempo actual, tiempo total y una linea que recorre el waveform mientras suena un corte.
- Exportacion de los cortes en el orden de la lista como archivo `vxchop-export.wav`.

## Tecnologias

- React
- Vite
- JavaScript (JSX)
- Web Audio API
- Canvas API

## Requisitos

- Node.js y npm.
- Un navegador moderno con soporte para Web Audio API y Canvas.

## Instalacion

Desde esta carpeta:

```bash
npm install
```

## Desarrollo

Inicia el servidor de desarrollo con:

```bash
npm run dev
```

Vite mostrara en la terminal la URL local, normalmente `http://localhost:5173`.

## Produccion

Genera la version optimizada:

```bash
npm run build
```

Para previsualizar la compilacion:

```bash
npm run preview
```

## Publicacion compartida

El repositorio incluye un workflow para publicar VX-CHOP en GitHub Pages. Despues de subir los cambios a `main`:

1. En GitHub, abre `Settings > Pages`.
2. En `Build and deployment`, selecciona `GitHub Actions` como fuente.
3. Espera a que termine el workflow `Deploy VX-CHOP`.

La URL sera `https://mqrbeats-tech.github.io/pagina-personal/`. Cada persona podra abrir la app y cargar su propio sample; el audio y los cortes se procesan localmente y no se comparten entre usuarios.

## Uso rapido

1. Carga un archivo `WAV`, `MP3` u `OGG`.
2. Arrastra sobre el waveform para crear un chop de al menos `0.03` segundos.
3. Ajusta los limites arrastrando los bordes del corte.
4. Reproduce el corte desde la lista o desde su pad.
5. Cambia el pitch si lo necesitas.
6. Ordena los cortes en la lista y pulsa `Exportar WAV`.

## Atajos de teclado

Los cortes se asignan en este orden:

```text
1 2 3 4
Q W E R
A S D F
Z X C V
```

Cada tecla dispara el corte correspondiente cuando no se esta escribiendo en un campo de texto.

## Notas

- El audio se procesa en el navegador; no se sube a un servidor.
- El formato exportado es WAV PCM de 16 bits.
- La deteccion de nota es aproximada y puede no producir resultados en sonidos percusivos, silenciosos o con mucho ruido.
- Los samples de mas de 10 minutos muestran una advertencia y simplifican la visualizacion para conservar fluidez.
- No hay una suite de tests configurada actualmente en el proyecto.
