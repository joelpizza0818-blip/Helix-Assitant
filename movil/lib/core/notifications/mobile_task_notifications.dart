import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class MobileTaskNotifications {
  MobileTaskNotifications({FlutterLocalNotificationsPlugin? plugin})
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  static const _channelId = 'helix_task_updates';
  static const _channelName = 'HELIX task updates';
  static const confirmationCategory = 'helix_confirmation';

  final FlutterLocalNotificationsPlugin _plugin;
  void Function(NotificationResponse response)? _responseHandler;
  bool _initialized = false;

  Future<void> initialize(
    void Function(NotificationResponse response) onResponse,
  ) async {
    _responseHandler = onResponse;
    if (_initialized ||
        (defaultTargetPlatform != TargetPlatform.android &&
            defaultTargetPlatform != TargetPlatform.iOS)) {
      return;
    }
    final initialized = await _plugin.initialize(
      settings: InitializationSettings(
        android: const AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
          notificationCategories: [
            DarwinNotificationCategory(
              confirmationCategory,
              actions: [
                DarwinNotificationAction.plain(
                  'allow',
                  'Permitir',
                  options: {DarwinNotificationActionOption.foreground},
                ),
                DarwinNotificationAction.plain(
                  'deny',
                  'Rechazar',
                  options: {DarwinNotificationActionOption.foreground},
                ),
              ],
            ),
          ],
        ),
      ),
      onDidReceiveNotificationResponse: (response) {
        _responseHandler?.call(response);
      },
    );
    if (initialized == false) {
      throw StateError('HELIX task notifications could not be initialized.');
    }
    _initialized = true;
  }

  Future<bool> requestPermission() async {
    if (!_initialized) return false;
    if (defaultTargetPlatform == TargetPlatform.android) {
      return await _plugin
              .resolvePlatformSpecificImplementation<
                  AndroidFlutterLocalNotificationsPlugin>()
              ?.requestNotificationsPermission() ??
          false;
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return await _plugin
              .resolvePlatformSpecificImplementation<
                  IOSFlutterLocalNotificationsPlugin>()
              ?.requestPermissions(alert: true, badge: false, sound: false) ??
          false;
    }
    return false;
  }

  Future<void> showConfirmation({
    required String requestId,
    required String action,
    required String details,
  }) async {
    final notificationId = requestId.hashCode & 0x7fffffff;
    await _plugin.show(
      id: notificationId,
      title: 'HELIX necesita tu permiso',
      body: details.isEmpty ? action : '$action: $details',
      payload: jsonEncode({'type': 'confirmation', 'request_id': requestId}),
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          _channelName,
          channelDescription: 'Permission requests and task results from HELIX',
          importance: Importance.max,
          priority: Priority.high,
          category: AndroidNotificationCategory.status,
          actions: [
            AndroidNotificationAction(
              'allow',
              'Permitir',
              showsUserInterface: true,
            ),
            AndroidNotificationAction(
              'deny',
              'Rechazar',
              showsUserInterface: true,
              cancelNotification: true,
            ),
          ],
        ),
        iOS: DarwinNotificationDetails(
          categoryIdentifier: confirmationCategory,
        ),
      ),
    );
  }

  Future<void> showReply(String text) async {
    await _plugin.show(
      id: DateTime.now().microsecondsSinceEpoch & 0x7fffffff,
      title: 'HELIX respondió',
      body: replyNotificationBody(text),
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          _channelName,
          channelDescription: 'Permission requests and task results from HELIX',
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: DarwinNotificationDetails(),
      ),
    );
  }

  Future<void> showFailure({
    required String category,
    String? provider,
    required String message,
  }) async {
    final isProvider = category == 'provider';
    final providerName = provider?.trim();
    await _plugin.show(
      id: DateTime.now().microsecondsSinceEpoch & 0x7fffffff,
      title: isProvider ? 'Fallo del proveedor' : 'Error interno de HELIX',
      body: message.isNotEmpty
          ? message
          : isProvider && providerName != null && providerName.isNotEmpty
              ? 'El proveedor $providerName no pudo completar la tarea.'
              : isProvider
                  ? 'El proveedor de IA no pudo completar la tarea.'
                  : 'HELIX no pudo completar la tarea.',
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          _channelId,
          _channelName,
          channelDescription: 'Permission requests and task results from HELIX',
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: DarwinNotificationDetails(),
      ),
    );
  }

  Future<void> cancelConfirmation(String requestId) =>
      _plugin.cancel(id: requestId.hashCode & 0x7fffffff);

  static String replyNotificationBody(String text) {
    final preview = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    final clipped =
        preview.length > 150 ? '${preview.substring(0, 147)}...' : preview;
    return '$clipped\nHelix sigue al pie del cañón :)';
  }
}
