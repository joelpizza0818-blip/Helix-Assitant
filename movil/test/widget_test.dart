import 'package:flutter_test/flutter_test.dart';

import 'package:helix_mobile/app/helix_app.dart';

void main() {
  testWidgets('renders the HELIX mobile shell disconnected', (tester) async {
    await tester.pumpWidget(const HelixApp());
    expect(find.text('ELIX'), findsOneWidget);
    expect(find.text('HELIX'), findsNothing);
    expect(find.text('Offline'), findsOneWidget);
    expect(find.text('Conecta tu Desktop HELIX'), findsOneWidget);
  });
}
