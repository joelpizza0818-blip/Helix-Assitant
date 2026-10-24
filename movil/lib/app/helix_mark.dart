import 'package:flutter/material.dart';

/// Flutter rendition of the same four-pillar pixel H used by Desktop and
/// Landing. Keeping it vector-native makes the mark crisp at every density.
class HelixMark extends StatelessWidget {
  const HelixMark({super.key, this.size = 28, this.showWordmark = true});

  final double size;
  final bool showWordmark;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        CustomPaint(size: Size(size, size * 36 / 32), painter: _HelixMarkPainter()),
        if (showWordmark) ...[
          const SizedBox(width: 5),
          const Text('ELIX', style: TextStyle(color: Color(0xFFF4F5F6), fontSize: 16, fontWeight: FontWeight.w700, letterSpacing: 1.8)),
        ],
      ]);
}

class _HelixMarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 32;
    const colors = [Color(0xFFFFF3B0), Color(0xFFFFD166), Color(0xFFFFB703), Color(0xFFFF9F1C), Color(0xFFFF6B2B), Color(0xFFEE6018), Color(0xFFCC4400)];
    final pixels = <({int x, int y, int w, Color color})>[];
    void pillar(int x, int y, int count) {
      for (var i = 0; i < count; i++) {
        pixels.add((x: x, y: y + i * 4, w: 4, color: colors[(y ~/ 4 + i).clamp(0, colors.length - 1)]));
      }
    }
    pillar(2, 10, 5);
    pillar(9, 2, 8);
    pillar(19, 2, 8);
    pillar(26, 10, 5);
    pixels.add((x: 13, y: 14, w: 6, color: colors[1]));
    pixels.add((x: 13, y: 18, w: 6, color: colors[2]));
    for (final pixel in pixels) {
      canvas.drawRect(Rect.fromLTWH(pixel.x * scale, pixel.y * scale, pixel.w * scale, 4 * scale), Paint()..color = pixel.color);
    }
    canvas.drawRect(Rect.fromLTWH(9 * scale, 2 * scale, 2 * scale, 2 * scale), Paint()..color = Colors.white);
    canvas.drawRect(Rect.fromLTWH(19 * scale, 2 * scale, 2 * scale, 2 * scale), Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
