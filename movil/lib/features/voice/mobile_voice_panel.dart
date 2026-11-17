import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'mobile_voice_controller.dart';

class MobileVoicePanel extends StatefulWidget {
  const MobileVoicePanel({
    super.key,
    required this.controller,
    required this.onClose,
  });

  final MobileVoiceController controller;
  final VoidCallback onClose;

  @override
  State<MobileVoicePanel> createState() => _MobileVoicePanelState();
}

class _MobileVoicePanelState extends State<MobileVoicePanel>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animation;
  final TextEditingController _confirmationText = TextEditingController();

  @override
  void initState() {
    super.initState();
    _animation = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 12),
    )..repeat();
  }

  @override
  void dispose() {
    _animation.dispose();
    _confirmationText.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([widget.controller, _animation]),
      builder: (context, _) {
        final controller = widget.controller;
        return Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0, -0.42),
              radius: 1.25,
              colors: [
                Color(0xFF17120B),
                Color(0xFF0C0C0E),
                Color(0xFF070708),
              ],
            ),
          ),
          child: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 22),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _header(),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 238,
                    child: CustomPaint(
                      painter: _NucleusPainter(
                        level: controller.level,
                        phase: _animation.value,
                        state: controller.state,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  _stateLabel(controller),
                  const SizedBox(height: 6),
                  Text(
                    _stateHint(controller),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF9B9DA3),
                      height: 1.4,
                      fontSize: 13,
                    ),
                  ),
                  if (controller.relayAudio) ...[
                    const SizedBox(height: 14),
                    _relayWarning(),
                  ],
                  if (controller.error != null) ...[
                    const SizedBox(height: 14),
                    _errorCard(controller.error!),
                  ],
                  if (controller.confirmation != null) ...[
                    const SizedBox(height: 14),
                    _confirmationCard(controller, controller.confirmation!),
                  ],
                  if (controller.entries.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _conversation(controller),
                  ],
                  const SizedBox(height: 18),
                  _controls(controller),
                  const SizedBox(height: 14),
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.lock_outline_rounded,
                          size: 14, color: Color(0xFF6F7177)),
                      SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          'Audio temporal · sin grabación permanente · Helix no lee código en voz alta',
                          textAlign: TextAlign.center,
                          style:
                              TextStyle(color: Color(0xFF6F7177), fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _header() {
    return Row(
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: const Color(0x22FF8C00),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: const Color(0x55FF8C00)),
          ),
          child: const Icon(Icons.graphic_eq_rounded,
              color: Color(0xFFFFA31A), size: 19),
        ),
        const SizedBox(width: 10),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('HELIX VOICE',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.2,
                    fontSize: 14,
                  )),
              Text('Voz local, mismo agente y mismas herramientas',
                  style: TextStyle(color: Color(0xFF8B8D93), fontSize: 11)),
            ],
          ),
        ),
        IconButton(
          tooltip: 'Volver al chat',
          onPressed: widget.onClose,
          icon: const Icon(Icons.close_rounded,
              color: Color(0xFF9A9CA2), size: 20),
        ),
      ],
    );
  }

  Widget _stateLabel(MobileVoiceController controller) {
    final color = _stateColor(controller.state);
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(color: color.withValues(alpha: 0.65), blurRadius: 10),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text(
          _stateText(controller.state),
          style: TextStyle(
            color: color,
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.4,
          ),
        ),
      ],
    );
  }

  String _stateHint(MobileVoiceController controller) {
    if (!controller.active) {
      if (controller.state == 'CLOSED') {
        return 'La llamada terminó. Puedes iniciar otra cuando quieras.';
      }
      return 'Elige Live para conversar sin pulsar botones, o Normal para grabar una sola intervención.';
    }
    return switch (controller.state) {
      'LISTENING' => controller.mode == MobileVoiceMode.live
          ? 'Te escucho. Habla con naturalidad; puedes interrumpir a Helix.'
          : 'Grabando. Pulsa «Detener y enviar» al terminar.',
      'THINKING' => 'Helix está trabajando. Puedes interrumpir y cambiar la instrucción.',
      'PROCESSING' => 'Te escucho; puedes interrumpir para corregir o continuar.',
      'SPEAKING' => 'Helix responde. Si hablas, se detiene al instante.',
      'AWAITING_CONFIRMATION' =>
        'Necesito una aprobación explícita. El silencio nunca aprueba.',
      'INTERRUPTED' => 'Interrumpido. Vuelvo a escuchar.',
      'MUTED' => 'Micrófono silenciado. No se envía audio.',
      'ERROR' => 'Revisa el error y vuelve a iniciar la sesión.',
      _ => 'Preparando la sesión de voz…',
    };
  }

  Widget _relayWarning() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0x1AFFB300),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0x44FFB300)),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.cloud_outlined, color: Color(0xFFFFC247), size: 18),
          SizedBox(width: 9),
          Expanded(
            child: Text(
              'Estás usando el relay configurado: el audio de voz viaja cifrado a través de ese servidor antes de llegar a tu Desktop. Para audio estrictamente local, usa SSH.',
              style: TextStyle(
                color: Color(0xFFE6C77A),
                fontSize: 11.5,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _errorCard(String message) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0x1AFF5252),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0x55FF6B6B)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline_rounded,
              color: Color(0xFFFF8A80), size: 18),
          const SizedBox(width: 9),
          Expanded(
            child: Text(message,
                style: const TextStyle(
                    color: Color(0xFFFFB4AB), fontSize: 12, height: 1.4)),
          ),
        ],
      ),
    );
  }

  Widget _confirmationCard(
    MobileVoiceController controller,
    VoiceConfirmation confirmation,
  ) {
    final details = [
      if (confirmation.whatWillChange.isNotEmpty) confirmation.whatWillChange,
      if (confirmation.why.isNotEmpty) confirmation.why,
    ].join(' · ');
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0x1AFFD54A),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0x66FFD54A)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.shield_outlined, color: Color(0xFFFFD54A), size: 19),
              SizedBox(width: 8),
              Text('CONFIRMACIÓN REQUERIDA',
                  style: TextStyle(
                    color: Color(0xFFFFE082),
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                    fontSize: 11.5,
                  )),
            ],
          ),
          const SizedBox(height: 10),
          Text(confirmation.action,
              style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 14)),
          if (details.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(details,
                style: const TextStyle(
                    color: Color(0xFFD0D1D5), height: 1.4, fontSize: 12)),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: controller.resolvingConfirmation
                      ? null
                      : controller.rejectConfirmation,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFFF9B9B),
                    side: const BorderSide(color: Color(0x55FF6B6B)),
                  ),
                  child: const Text('Rechazar'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  onPressed: controller.resolvingConfirmation
                      ? null
                      : controller.approveConfirmation,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFFFB300),
                    foregroundColor: const Color(0xFF241800),
                  ),
                  child: const Text('Permitir'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _confirmationText,
            enabled: !controller.resolvingConfirmation,
            textInputAction: TextInputAction.send,
            onSubmitted: (value) {
              if (value.trim().isEmpty) return;
              controller.sendConfirmationText(value);
              _confirmationText.clear();
            },
            style: const TextStyle(color: Colors.white, fontSize: 13),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'O escribe: «sí», «cancela» o describe un cambio',
              hintStyle:
                  const TextStyle(color: Color(0xFF8E8F95), fontSize: 12),
              filled: true,
              fillColor: const Color(0x33000000),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              suffixIcon: IconButton(
                icon: const Icon(Icons.send_rounded,
                    color: Color(0xFFFFD54A), size: 18),
                onPressed: controller.resolvingConfirmation
                    ? null
                    : () {
                        final value = _confirmationText.text.trim();
                        if (value.isEmpty) return;
                        controller.sendConfirmationText(value);
                        _confirmationText.clear();
                      },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _conversation(MobileVoiceController controller) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0x14FFFFFF),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0x18FFFFFF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final entry in controller.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entry.role == 'user' ? 'TÚ' : 'HELIX',
                    style: TextStyle(
                      color: entry.role == 'user'
                          ? const Color(0xFF63D8F2)
                          : const Color(0xFFFFB34D),
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.1,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    entry.text.length > 900
                        ? '${entry.text.substring(0, 900)}…'
                        : entry.text,
                    style: TextStyle(
                      color: const Color(0xFFE4E5E8),
                      fontSize: 12,
                      height: 1.35,
                      fontFamily: entry.hadCode ? 'monospace' : null,
                    ),
                  ),
                  if (entry.hadCode)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text(
                        'El código y los detalles técnicos están en pantalla; no se leen en voz alta.',
                        style:
                            TextStyle(color: Color(0xFF8F9197), fontSize: 10.5),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _controls(MobileVoiceController controller) {
    if (!controller.active) {
      return Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _modeButton(
                  controller,
                  MobileVoiceMode.live,
                  Icons.auto_awesome_rounded,
                  'Live',
                  'Conversación continua',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _modeButton(
                  controller,
                  MobileVoiceMode.normal,
                  Icons.mic_rounded,
                  'Normal',
                  'Grabar una vez',
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: controller.canStart
                ? () => controller.start(controller.mode)
                : null,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFFF8C00),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
            ),
            icon: const Icon(Icons.graphic_eq_rounded, size: 20),
            label: Text(
              controller.state == 'CLOSED'
                  ? 'Iniciar otra conversación'
                  : 'Iniciar Helix Voice',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      );
    }

    return Column(
      children: [
        if (controller.mode == MobileVoiceMode.normal &&
            controller.capturing) ...[
          FilledButton.icon(
            onPressed: controller.stopNormalRecording,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFFFF5252),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
            ),
            icon: const Icon(Icons.stop_rounded, size: 20),
            label: const Text('Detener y enviar',
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
          const SizedBox(height: 10),
        ],
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: controller.toggleMute,
                style: OutlinedButton.styleFrom(
                  foregroundColor: controller.muted
                      ? const Color(0xFFFFB4AB)
                      : const Color(0xFFE0E1E5),
                  side: BorderSide(
                    color: controller.muted
                        ? const Color(0x66FF6B6B)
                        : const Color(0x33FFFFFF),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                icon: Icon(
                  controller.muted ? Icons.mic_off_rounded : Icons.mic_rounded,
                  size: 18,
                ),
                label: Text(controller.muted ? 'Silenciado' : 'Silenciar'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: controller.stop,
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFFFA27A),
                  side: const BorderSide(color: Color(0x44FF8C00)),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                icon: const Icon(Icons.call_end_rounded, size: 18),
                label: const Text('Finalizar'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _modeButton(
    MobileVoiceController controller,
    MobileVoiceMode mode,
    IconData icon,
    String title,
    String subtitle,
  ) {
    final selected = controller.mode == mode;
    return InkWell(
      borderRadius: BorderRadius.circular(13),
      onTap: () => setState(() => controller.mode = mode),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
        decoration: BoxDecoration(
          color: selected ? const Color(0x1FFF8C00) : const Color(0x0FFFFFFF),
          borderRadius: BorderRadius.circular(13),
          border: Border.all(
            color: selected ? const Color(0x88FF8C00) : const Color(0x22FFFFFF),
          ),
        ),
        child: Column(
          children: [
            Icon(icon,
                color: selected
                    ? const Color(0xFFFFA733)
                    : const Color(0xFF8C8E94),
                size: 20),
            const SizedBox(height: 5),
            Text(title,
                style: TextStyle(
                  color: selected ? Colors.white : const Color(0xFFB7B9BF),
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                )),
            Text(subtitle,
                style:
                    const TextStyle(color: Color(0xFF797B81), fontSize: 9.5)),
          ],
        ),
      ),
    );
  }

  String _stateText(String state) => switch (state) {
        'LISTENING' => 'ESCUCHANDO',
        'INITIALIZING' => 'INICIANDO',
        'THINKING' => 'PENSANDO',
        'PROCESSING' => 'TRANSCRIBIENDO',
        'SPEAKING' => 'HABLANDO',
        'AWAITING_CONFIRMATION' => 'CONFIRMACIÓN PENDIENTE',
        'INTERRUPTED' => 'INTERRUMPIDO',
        'MUTED' => 'SILENCIADO',
        'ERROR' => 'ERROR',
        'CLOSED' => 'FINALIZADO',
        _ => 'EN ESPERA',
      };

  Color _stateColor(String state) => switch (state) {
        'LISTENING' => const Color(0xFF57E0C2),
        'THINKING' => const Color(0xFFFFC247),
        'PROCESSING' => const Color(0xFF68D8FF),
        'SPEAKING' => const Color(0xFFFF8C00),
        'AWAITING_CONFIRMATION' => const Color(0xFFFFD54A),
        'INTERRUPTED' => const Color(0xFFFF7AA8),
        'MUTED' => const Color(0xFF9EA1A8),
        'ERROR' => const Color(0xFFFF8A80),
        _ => const Color(0xFFB9BBC1),
      };
}

class _NucleusPainter extends CustomPainter {
  _NucleusPainter({
    required this.level,
    required this.phase,
    required this.state,
  });

  final double level;
  final double phase;
  final String state;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final base = math.min(size.width, size.height) * 0.5;
    final audio = level.clamp(0.0, 1.0);
    final pulse = 0.5 + 0.5 * math.sin(phase * math.pi * 2);
    final coreRadius = base * (0.105 + audio * 0.05 + pulse * 0.006);
    final accent = _accent(state);

    // Warm halo around a bright yellow-white core.
    final glow = Paint()
      ..shader = RadialGradient(
        colors: [
          const Color(0xFFFFF9D6).withValues(alpha: 0.95),
          const Color(0xFFFFC21A).withValues(alpha: 0.38),
          const Color(0xFFFF6A00).withValues(alpha: 0.14),
          Colors.transparent,
        ],
        stops: const [0.0, 0.28, 0.58, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: base * 0.95));
    canvas.drawCircle(center, base * 0.95, glow);

    // Thin 3D wireframe sphere.
    final sphere = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0
      ..color = const Color(0xFFFFD36A).withValues(alpha: 0.35 + audio * 0.25);
    final sphereRadius = base * 0.43;
    canvas.drawCircle(center, sphereRadius, sphere);
    for (var ring = 1; ring <= 3; ring++) {
      final scale = ring / 3.4;
      final rect = Rect.fromCenter(
        center: center,
        width: sphereRadius * 2,
        height: sphereRadius * 2 * scale,
      );
      canvas.drawOval(rect,
          sphere..color = const Color(0xFFFFB300).withValues(alpha: 0.16));
      canvas.save();
      canvas.translate(center.dx, center.dy);
      canvas.rotate(phase * math.pi * 2 * (ring.isEven ? 1 : -1) * 0.18);
      canvas.translate(-center.dx, -center.dy);
      canvas.drawOval(rect, sphere..color = accent.withValues(alpha: 0.20));
      canvas.restore();
    }

    // Orbital ellipses.
    for (var i = 0; i < 3; i++) {
      final angle =
          phase * math.pi * 2 * (i.isEven ? 1 : -1) * 0.42 + i * math.pi / 3;
      canvas.save();
      canvas.translate(center.dx, center.dy);
      canvas.rotate(angle);
      final orbit = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.1
        ..color = (i == 0 ? const Color(0xFF56DCFF) : const Color(0xFFFFB300))
            .withValues(alpha: 0.30 + audio * 0.35);
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset.zero,
          width: base * (1.18 + i * 0.10),
          height: base * (0.31 + i * 0.055),
        ),
        orbit,
      );
      canvas.restore();
    }

    // Cyan and amber particles.
    for (var i = 0; i < 30; i++) {
      final seed =
          i * 2.399963 + phase * math.pi * 2 * (i.isEven ? 0.25 : -0.2);
      final radius = base * (0.20 + (i % 9) * 0.045 + audio * 0.055);
      final point = Offset(
        center.dx + math.cos(seed) * radius,
        center.dy + math.sin(seed * 1.17) * radius * 0.58,
      );
      final particle = Paint()
        ..color =
            (i % 3 == 0 ? const Color(0xFF5BE2FF) : const Color(0xFFFFC04A))
                .withValues(alpha: 0.28 + audio * 0.5);
      canvas.drawCircle(point, 0.9 + (i % 3) * 0.55 + audio, particle);
    }

    // The solid center stays legible even when muted or interrupted.
    final core = Paint()
      ..shader = const RadialGradient(
        colors: [
          Colors.white,
          Color(0xFFFFF3B0),
          Color(0xFFFFB000),
        ],
      ).createShader(Rect.fromCircle(center: center, radius: coreRadius));
    canvas.drawCircle(center, coreRadius, core);
    canvas.drawCircle(
      center,
      coreRadius,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..color = Colors.white.withValues(alpha: 0.55 + audio * 0.35),
    );
  }

  Color _accent(String state) => switch (state) {
        'LISTENING' => const Color(0xFF57E0C2),
        'AWAITING_CONFIRMATION' => const Color(0xFFFFD54A),
        'INTERRUPTED' => const Color(0xFFFF7AA8),
        'MUTED' => const Color(0xFF9EA1A8),
        _ => const Color(0xFF56DCFF),
      };

  @override
  bool shouldRepaint(covariant _NucleusPainter oldDelegate) =>
      oldDelegate.level != level ||
      oldDelegate.phase != phase ||
      oldDelegate.state != state;
}
