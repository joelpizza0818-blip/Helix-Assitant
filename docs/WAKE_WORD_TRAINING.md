# Training the “Hey Helix” Wake-Word Model

HELIX uses OpenWakeWord and expects an ONNX classifier for the exact phrase `hey helix`. OpenWakeWord does not ship a built-in classifier for that phrase. The project's automated training path is designed for Linux or Google Colab, not native Windows.

## Train in Google Colab

1. Open the [official OpenWakeWord automatic training notebook](https://colab.research.google.com/github/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb).
2. Select **Runtime → Change runtime type → T4 GPU**.
3. Run the notebook's installation and dataset cells. Synthetic generation needs Piper plus background/noise data.
4. In the YAML configuration cell, use:

   ```python
   config["target_phrase"] = ["hey helix"]
   config["model_name"] = "hey_helix"
   config["n_samples"] = 10000
   config["n_samples_val"] = 2000
   config["steps"] = 50000
   ```

5. Run synthetic audio generation, augmentation, and training in order.
6. The ONNX output should be:

   ```text
   my_custom_model/hey_helix.onnx
   ```

   Export may also create `hey_helix.onnx.data`; keep it beside the ONNX file.

7. Download both files:

   ```python
   from google.colab import files
   files.download("my_custom_model/hey_helix.onnx")
   files.download("my_custom_model/hey_helix.onnx.data")
   ```

## Install the model

Place the files at:

```text
services/agent/models/wakeword/hey_helix.onnx
services/agent/models/wakeword/hey_helix.onnx.data
```

The data file is optional only when the exported ONNX is self-contained. Preserve the exact filename. Alternatively set `WAKE_WORD_MODEL_PATH` to the ONNX path in the environment.

## Validate before release

1. Restart HELIX after installing the model.
2. Confirm the agent reports the model as loaded and does not claim readiness when it is missing.
3. Test multiple speakers, distances, microphone positions, noise levels, and similar phrases.
4. Measure false accepts and false rejects before enabling the feature by default.
5. Test RDP/ICA or unavailable-camera degradation separately.
6. Keep model provenance and licensing alongside the artifact.

The synthetic model is general-purpose and is not tuned to one person's voice. Colab training may require substantial temporary storage and GPU time. A conversion failure for an optional TFLite output does not invalidate an already exported ONNX model, but the ONNX runtime must still load successfully.
