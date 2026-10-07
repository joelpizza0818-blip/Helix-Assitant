# Entrenar el modelo «Hey Helix»

El proyecto está configurado para OpenWakeWord y espera un clasificador ONNX para la frase exacta `hey helix`. OpenWakeWord no incluye un modelo preentrenado para esa frase. La herramienta de entrenamiento automático indicada por el proyecto OpenWakeWord está diseñada para ejecutarse en Linux, así que se puede usar Google Colab con una runtime GPU.

## Entrenamiento en Google Colab

1. Abre el [notebook oficial de entrenamiento automático de OpenWakeWord en Google Colab](https://colab.research.google.com/github/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb).
2. En Colab, selecciona **Runtime > Change runtime type > T4 GPU**. Ejecuta las celdas de instalación y descarga de datos del notebook. La generación sintética necesita el modelo Piper y los datos de fondo/ruido.
3. En la celda que modifica la configuración YAML, usa estos valores:

   ```python
   config["target_phrase"] = ["hey helix"]
   config["model_name"] = "hey_helix"
   config["n_samples"] = 10000
   config["n_samples_val"] = 2000
   config["steps"] = 50000
   ```

4. Ejecuta en orden las celdas de generación de audio sintético, aumento de datos y entrenamiento. El modelo ONNX debería quedar en:

   ```text
   my_custom_model/hey_helix.onnx
   ```

   La exportación ONNX también puede crear `hey_helix.onnx.data`, un archivo de pesos externos que debe mantenerse junto al ONNX. El notebook puede terminar con un error al convertir a TFLite si falta `onnx_tf`; eso no invalida el ONNX ya exportado.

5. Descarga ambos archivos desde Colab:

   ```python
   from google.colab import files
   files.download("my_custom_model/hey_helix.onnx")
   files.download("my_custom_model/hey_helix.onnx.data")
   ```

6. En el equipo de HELIX, coloca ambos archivos en:

   ```text
   services/agent/models/wakeword/hey_helix.onnx
   ```

   Si se generó `hey_helix.onnx.data`, colócalo en la misma carpeta y conserva su nombre exacto. Alternativamente, cambia `WAKE_WORD_MODEL_PATH` en `.env` a la ruta del ONNX. El agente ya resuelve las rutas relativas desde `services/agent`.

## Validación

Reinicia HELIX después de colocar el archivo. Si no existe o no se puede cargar, el agente registra un error explícito y no activa el micrófono como si el modelo estuviera listo. Antes de depender del detector, prueba varios tonos de voz, distancias y condiciones de ruido, y comprueba que no se active con frases parecidas.

El entrenamiento sintético crea un modelo general para la frase; no lo ajusta a la voz de una persona concreta. El notebook y sus datasets pueden requerir una sesión de Colab con GPU y bastante espacio temporal.
