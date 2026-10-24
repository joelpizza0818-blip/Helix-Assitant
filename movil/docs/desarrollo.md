# Desarrollo

## Requisitos

- Flutter estable y Dart compatible con `pubspec.yaml`.
- Android Studio/SDK para Android, Xcode para iOS, y los toolchains de cada destino.
- Un HELIX Desktop de desarrollo y una red privada para pruebas SSH.

## Comandos

```bash
flutter pub get
flutter analyze
flutter test
flutter run -d <device>
```

Si se genera una aplicación Flutter completa, mantener los directorios `android/`, `ios/`, `macos/`, `windows/`, `linux/` y `web/` dentro de `movil/`; no repartirlos en `apps/` hasta tomar una decisión de workspace.

## Política de cambios

- Primero actualizar el contrato o decisión en `docs/`.
- Después implementar modelos/transportes.
- Finalmente conectar la UI.
- Cada transporte debe tener dobles de prueba y una prueba real separada.
- No declarar soporte de plataforma hasta probar build, arranque, reconexión y cierre en esa plataforma.
