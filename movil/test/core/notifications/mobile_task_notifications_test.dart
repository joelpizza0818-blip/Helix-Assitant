import 'package:flutter_test/flutter_test.dart';
import 'package:helix_mobile/core/notifications/mobile_task_notifications.dart';

void main() {
  test('reply notification preserves the response with a short text smile', () {
    expect(
      MobileTaskNotifications.replyNotificationBody('Done.'),
      'Done.\nHelix sigue al pie del cañón :)',
    );
  });

  test('reply notification bounds long previews', () {
    final body = MobileTaskNotifications.replyNotificationBody('a' * 200);

    expect(body, startsWith('${'a' * 147}...'));
    expect(body, endsWith('Helix sigue al pie del cañón :)'));
    expect(body.length, lessThan(200));
  });
}
