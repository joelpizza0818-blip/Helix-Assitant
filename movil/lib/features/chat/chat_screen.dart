import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../app/helix_mark.dart';
import '../../core/config/mobile_config.dart';
import '../../core/config/mobile_pairing_invitation.dart';
import '../../core/models/protocol_message.dart';
import '../../core/notifications/mobile_task_notifications.dart';
import '../../core/session/helix_session.dart';
import '../../core/session/mobile_connection.dart';
import '../../core/session/mobile_background_connection.dart';
import '../../core/security/secure_pairing_store.dart';
import '../../core/transport/helix_transport.dart';
import 'mobile_subagents_panel.dart';
import 'mobile_skill_mentions.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final _remoteKeyController = TextEditingController();
  bool _showRemoteKeyboard = false;
  final _pairingStore = const SecurePairingStore();
  final _backgroundConnection = const MobileBackgroundConnection();
  final _notifications = MobileTaskNotifications();
  final Map<String, _MobileLink> _links = {};
  String? _selectedSessionId;
  bool _restoring = false;
  bool _hasSavedPairing = false;
  int _tab = 0;
  bool _voiceMode = false;
  bool _hasInputText = false;
  bool _isForeground = true;
  bool _notificationsEnabled = false;
  bool _showingConfirmation = false;
  ActiveSkillMention? _activeSkillMention;

  _MobileLink? get _activeLink => _links[_selectedSessionId];
  List<_Message> get _messages => _activeLink?.messages ?? _emptyMessages;
  List<MobileSkill> get _skills => _activeLink?.skills ?? const [];
  String? get _connectionError => _activeLink?.connectionError;
  set _connectionError(String? value) => _activeLink?.connectionError = value;
  String? get _activeProgress => _activeLink?.activeProgress;
  set _activeProgress(String? value) => _activeLink?.activeProgress = value;
  bool get _connected => _activeLink?.connected ?? false;
  bool get _connecting => _activeLink?.connecting ?? false;

  static final List<_Message> _emptyMessages = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _isForeground =
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    _controller.addListener(() {
      final hasText = _controller.text.trim().isNotEmpty;
      final selection = _controller.selection;
      final mention = findActiveSkillMention(
        _controller.text,
        caretPosition: selection.isValid ? selection.extentOffset : -1,
      );
      if (hasText != _hasInputText ||
          mention?.query != _activeSkillMention?.query ||
          mention?.start != _activeSkillMention?.start) {
        setState(() {
          _hasInputText = hasText;
          _activeSkillMention = mention;
        });
      }
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_restoreSavedConnection());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller.dispose();
    _scrollController.dispose();
    _remoteKeyController.dispose();
    for (final link in _links.values) {
      unawaited(link.dispose());
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      _isForeground = false;
      return;
    }
    if (state == AppLifecycleState.resumed) {
      _isForeground = true;
      unawaited(_restoreSavedConnection());
      unawaited(_presentPendingConfirmations());
    }
  }

  Future<void> _toggleConnection() async {
    if (_connected) {
      final link = _activeLink!;
      link.connected = false;
      link.connecting = false;
      link.activeProgress = null;
      link.activeTaskId = null;
      link.pendingConfirmations.clear();
      link.connectionError = null;
      await _closeSession(link);
      if (!_links.values.any((item) => item.connected)) {
        await _backgroundConnection.stop();
      }
      if (mounted) setState(() {});
      return;
    } else {
      if (_connecting || _restoring) return;
      final link = _activeLink;
      if (link != null) {
        await _connectDraft(_ConnectionDraft(
          link.config,
          link.token,
          sessionId: link.sessionId,
          name: link.name,
          deviceId: link.connection.sourceDeviceId,
        ));
        return;
      }
    }
    await _addConnection();
  }

  Future<void> _addConnection() async {
    if (_connecting || _restoring) return;
    final draft = await showModalBottomSheet<_ConnectionDraft>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF101010),
      builder: (_) => const _ConnectionSheet(),
    );
    if (draft == null || !mounted) return;
    if (_links.containsKey(draft.sessionId)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Esta sesión ya está agregada. Escanea un QR nuevo.'),
      ));
      return;
    }
    await _connectDraft(draft);
  }

  Future<void> _restoreSavedConnection() async {
    if (_restoring || !mounted) return;
    _restoring = true;
    try {
      final pairings = await _pairingStore.loadAll();
      if (pairings.isEmpty) return;
      if (mounted) {
        setState(() {
          _hasSavedPairing = true;
          _selectedSessionId ??= pairings.first.sessionId;
        });
      }
      if (!await _pairingStore.autoConnectEnabled() || !mounted) return;
      for (final pairing in pairings) {
        final existing = _links[pairing.sessionId];
        if (existing?.connected == true || existing?.connecting == true) {
          continue;
        }
        await _connectDraft(_draftFromSaved(pairing));
      }
    } on MissingPluginException {
      return;
    } on Exception catch (error) {
      if (mounted) {
        setState(() {
          _connectionError = 'No se pudo restaurar la sesión guardada: $error';
        });
      }
    } finally {
      _restoring = false;
    }
  }

  _ConnectionDraft _draftFromSaved(SavedMobilePairing saved) {
    final mode = saved.transportMode == 'sshTunnel'
        ? MobileTransportMode.sshTunnel
        : MobileTransportMode.relay;
    return _ConnectionDraft(
      MobileConfig(
        mode: mode,
        desktop: DesktopConfig(
          host: mode == MobileTransportMode.relay
              ? saved.relayWssUrl!
              : saved.sshHost!,
          sshPort: saved.sshPort ?? 22,
          sshUser: saved.sshUser ?? '',
          remoteWsPort: saved.remoteWsPort ?? 8765,
          identityKeyRef: 'memory://mobile-session-key',
          wsTokenRef: 'memory://mobile-session-token',
          identityKeyPem: saved.identityKeyPem,
          hostKeyFingerprint: saved.hostKeyFingerprint,
        ),
        relayWssUrl: saved.relayWssUrl,
      ),
      saved.token,
      sessionId: saved.sessionId,
      name: saved.name,
      deviceId: saved.deviceId,
    );
  }

  Future<void> _connectDraft(_ConnectionDraft draft) async {
    final link = _links[draft.sessionId] ??
        _MobileLink(
          sessionId: draft.sessionId,
          name: draft.name,
          config: draft.config,
          token: draft.token,
          connection: MobileConnection(),
        );
    link.connecting = true;
    link.connectionError = null;
    _links[draft.sessionId] = link;
    _selectedSessionId = draft.sessionId;
    if (mounted) setState(() {});
    final messenger = ScaffoldMessenger.of(context);
    if (draft.config.requiresDeviceApproval) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Aprueba la solicitud de vinculación en HELIX Desktop.'),
        duration: Duration(minutes: 5),
      ));
    }
    try {
      final session = await link.connection.connect(
        draft.config,
        draft.token,
        savedDeviceId: draft.deviceId,
      );
      if (!mounted) {
        await link.dispose();
        return;
      }
      link.token = link.connection.authenticatedToken ?? draft.token;
      final pairing = SavedMobilePairing(
        sessionId: draft.sessionId,
        name: draft.name,
        deviceId: session.sourceDeviceId,
        token: link.token,
        transportMode: draft.config.mode.name,
        relayWssUrl: draft.config.relayWssUrl,
        identityKeyPem: draft.config.desktop.identityKeyPem,
        hostKeyFingerprint: draft.config.desktop.hostKeyFingerprint,
        sshHost: draft.config.mode == MobileTransportMode.sshTunnel
            ? draft.config.desktop.host
            : null,
        sshUser: draft.config.mode == MobileTransportMode.sshTunnel
            ? draft.config.desktop.sshUser
            : null,
        sshPort: draft.config.mode == MobileTransportMode.sshTunnel
            ? draft.config.desktop.sshPort
            : null,
        remoteWsPort: draft.config.mode == MobileTransportMode.sshTunnel
            ? draft.config.desktop.remoteWsPort
            : null,
      );
      await _pairingStore.savePairing(pairing);
      if (!mounted) {
        await link.dispose();
        return;
      }
      messenger.hideCurrentSnackBar();
      link.events =
          session.events.listen((event) => _handleAgentEvent(event, link));
      link.transportStates =
          session.states.listen((state) => _handleTransportState(state, link));
      await _backgroundConnection.start();
      final notificationEnabled = await _prepareTaskNotifications();
      link.connecting = false;
      link.connected = true;
      link.connectionError = null;
      unawaited(_resumeBrowserLive(link));
      if (_selectedSessionId == link.sessionId) {
        _notificationsEnabled = notificationEnabled;
      }
      _hasSavedPairing = true;
      setState(() {});
      unawaited(_loadSkills(session, link));
      if (!notificationEnabled && mounted) {
        messenger.showSnackBar(const SnackBar(
          content: Text(
              'La sesión está conectada, pero las notificaciones de tareas están desactivadas.'),
        ));
      }
    } on Object catch (e) {
      messenger.hideCurrentSnackBar();
      if (!_links.values.any((item) => item.connected)) {
        await _backgroundConnection.stop();
      }
      await link.dispose();
      link.connecting = false;
      link.connected = false;
      if (mounted) {
        setState(() {
          link.connectionError = e is UnsupportedError
              ? 'La conexión móvil requiere la app nativa; la versión web solo permite previsualizar la interfaz.'
              : e.toString().contains('TimeoutException')
                  ? 'Tiempo de espera agotado. Verifica que el relay esté activo.'
                  : e.toString().toLowerCase().contains('rejected')
                      ? 'La vinculación fue rechazada en HELIX Desktop.'
                      : 'No se pudo conectar. Revisa el token y la URL del relay.';
        });
      }
    }
  }

  Future<void> _closeSession(_MobileLink link) async {
    await link.events?.cancel();
    await link.transportStates?.cancel();
    link.events = null;
    link.transportStates = null;
    await link.connection.close();
  }

  void _handleTransportState(TransportState state, _MobileLink link) {
    if (!mounted) return;
    if (state == TransportState.connected) {
      link.connected = true;
      link.connecting = false;
      link.connectionError = null;
      unawaited(_resumeBrowserLive(link));
    } else if (state == TransportState.reconnecting ||
        state == TransportState.connecting) {
      link.connected = false;
      link.connecting = true;
      link.connectionError = 'Reconectando a ${link.name}…';
    } else {
      link.connected = false;
      link.connecting = false;
      link.activeProgress = null;
      link.activeTaskId = null;
      link.connectionError = link.connectionError
                  ?.startsWith('Reconectando a ') ==
              true
          ? 'No se pudo reconectar con ${link.name}. Toca Conectar para volver a intentar.'
          : 'Se perdió la conexión con ${link.name}. Toca Conectar para reintentar.';
      if (!_links.values.any((item) => item.connected)) {
        unawaited(_backgroundConnection.stop());
      }
    }
    setState(() {});
  }

  void _handleAgentEvent(HelixMessage event, _MobileLink link) {
    if (!mounted) return;
    if (event.type == 'skills_response') {
      _receiveSkills(event.payload, link);
      return;
    }
    if (event.type == 'confirmation_request') {
      unawaited(_requestMobileConfirmation(event.payload, link));
      return;
    }
    if (event.type == 'task_update') {
      _updateProgress(event.payload, link);
      return;
    }
    if (event.type == 'desktop_frame') {
      final encoded = event.payload['image_base64'];
      final expectedDeviceId = link.connection.session?.sourceDeviceId;
      final sourceDeviceId = event.payload['source_device_id'];
      if (encoded is! String ||
          encoded.length > 800000 ||
          (expectedDeviceId != null &&
              sourceDeviceId != null &&
              sourceDeviceId != expectedDeviceId)) {
        return;
      }
      try {
        final frame = base64Decode(encoded);
        if (frame.length > 560000) return;
        link.desktopFrame = Uint8List.fromList(frame);
        if (_selectedSessionId == link.sessionId && _tab == 4) {
          setState(() {});
        }
      } catch (error) {
        // ignore malformed frame
      }
      return;
    }
    if (event.type == 'browser_frame') {
      final encoded = event.payload['image_base64'];
      final expectedConversationId =
          'mobile_${link.connection.session?.sourceDeviceId}';
      if (encoded is! String ||
          encoded.length > 800000 ||
          event.payload['mime_type'] != 'image/jpeg' ||
          event.payload['conversation_id'] != expectedConversationId ||
          link.browserLivePaused) {
        return;
      }
      try {
        final frame = base64Decode(encoded);
        if (frame.length > 560000) return;
        link.browserFrame = Uint8List.fromList(frame);
        if (_selectedSessionId == link.sessionId) setState(() {});
      } on FormatException catch (error, stackTrace) {
        FlutterError.reportError(FlutterErrorDetails(
          exception: error,
          stack: stackTrace,
          library: 'HELIX mobile browser live view',
        ));
      }
      return;
    }
    if (event.type == 'confirmation_resolved') {
      final requestId = event.payload['request_id'];
      if (requestId is String) {
        link.pendingConfirmations.remove(requestId);
        setState(() {});
        unawaited(_runNotificationTask(
          () => _notifications.cancelConfirmation(requestId),
          'confirmation cleanup',
        ));
      }
      return;
    }
    final text = event.payload['text'] ??
        event.payload['content'] ??
        event.payload['message'] ??
        (event.type == 'error' ? event.payload['error'] : null);
    if (text is! String || text.isEmpty) return;
    if (event.type == 'error') {
      final category = _failureCategory(event.payload);
      final provider = event.payload['provider'];
      final failureText = category == 'provider'
          ? 'Fallo del proveedor${provider is String && provider.isNotEmpty ? ' ($provider)' : ''}: $text'
          : 'Error interno de HELIX: $text';
      _appendIncomingMessage(failureText, link);
      _notifyFailure(
        category: category,
        provider: provider is String ? provider : null,
        message: text,
      );
      return;
    }
    _appendIncomingMessage(text, link);
    if (event.type == 'agent_message' && event.payload['role'] == 'assistant') {
      _notifyReply(text);
    }
  }

  void _appendIncomingMessage(String text, [_MobileLink? link]) {
    final target = link ?? _activeLink;
    if (target == null) return;
    if (target.messages.isNotEmpty &&
        !target.messages.last.mine &&
        target.messages.last.text == text) {
      return;
    }
    target.messages.add(_Message(text, false));
    target.activeProgress = null;
    target.activeTaskId = null;
    if (_selectedSessionId == target.sessionId) {
      setState(() {});
      _scrollToBottom();
    }
  }

  Future<void> _loadSkills(HelixSession session, _MobileLink link) async {
    try {
      final skills = await session.requestSkills();
      if (session.relaySkillsRequests || !mounted) return;
      link.skills = skills.map(MobileSkill.fromJson).toList();
      if (_selectedSessionId == link.sessionId) setState(() {});
    } on Object catch (error, stackTrace) {
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'HELIX mobile skills',
      ));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('No se pudieron cargar las skills de HELIX Desktop.'),
        ));
      }
    }
  }

  Future<bool> _prepareTaskNotifications() async {
    try {
      await _notifications.initialize(_handleNotificationResponse);
      return await _notifications.requestPermission();
    } on Object catch (error, stackTrace) {
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'HELIX mobile notifications',
      ));
      return false;
    }
  }

  void _receiveSkills(Map<String, dynamic> payload, _MobileLink link) {
    final skills = payload['skills'];
    if (skills is! List) {
      FlutterError.reportError(const FlutterErrorDetails(
        exception: FormatException('HELIX returned an invalid skills list.'),
        library: 'HELIX mobile skills',
      ));
      return;
    }
    try {
      final parsed = skills
          .whereType<Map>()
          .map(
              (skill) => MobileSkill.fromJson(Map<String, dynamic>.from(skill)))
          .toList(growable: false);
      link.skills = parsed;
      if (_selectedSessionId == link.sessionId) setState(() {});
    } on FormatException catch (error, stackTrace) {
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'HELIX mobile skills',
      ));
    }
  }

  Future<void> _requestMobileConfirmation(
    Map<String, dynamic> payload,
    _MobileLink link,
  ) async {
    final requestId = payload['id'];
    if (requestId is! String ||
        !RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          caseSensitive: false,
        ).hasMatch(requestId) ||
        link.pendingConfirmations.containsKey(requestId)) {
      return;
    }
    link.pendingConfirmations[requestId] = Map<String, dynamic>.from(payload);
    if (_selectedSessionId == link.sessionId) {
      setState(() => link.activeProgress = 'Esperando confirmación…');
    }
    if (!_isForeground) {
      if (_notificationsEnabled) {
        await _runNotificationTask(
          () => _notifications.showConfirmation(
            requestId: requestId,
            action: _confirmationAction(payload),
            details: _confirmationDetails(payload),
          ),
          'confirmation notification',
        );
      }
      return;
    }
    await _presentConfirmation(requestId, payload, link);
  }

  String _confirmationAction(Map<String, dynamic> payload) =>
      payload['action'] is String
          ? payload['action'] as String
          : 'Acción solicitada';

  String _confirmationDetails(Map<String, dynamic> payload) {
    final details = payload['what_will_change'] is String
        ? payload['what_will_change'] as String
        : '';
    final reason = payload['why'] is String ? payload['why'] as String : '';
    final combined =
        [details, reason].where((value) => value.isNotEmpty).join(' · ');
    return combined.length > 180
        ? '${combined.substring(0, 177)}...'
        : combined;
  }

  Future<void> _presentPendingConfirmations() async {
    for (final link in _links.values) {
      for (final entry in link.pendingConfirmations.entries.toList()) {
        if (!mounted || !_isForeground) return;
        await _presentConfirmation(entry.key, entry.value, link);
      }
    }
  }

  Future<void> _presentConfirmation(
    String requestId,
    Map<String, dynamic> payload,
    _MobileLink link,
  ) async {
    if (!mounted ||
        !_isForeground ||
        _showingConfirmation ||
        !link.pendingConfirmations.containsKey(requestId)) {
      return;
    }
    _showingConfirmation = true;
    final action = payload['action'] is String
        ? payload['action'] as String
        : 'Acción solicitada';
    final details = payload['what_will_change'] is String
        ? payload['what_will_change'] as String
        : '';
    final reason = payload['why'] is String ? payload['why'] as String : '';
    try {
      final approved = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: const Color(0xFF1D1D1F),
          title: const Text('Permiso requerido'),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(action,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                if (details.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  SelectableText(details.length > 3000
                      ? '${details.substring(0, 3000)}…'
                      : details),
                ],
                if (reason.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(reason,
                      style: const TextStyle(color: Color(0xFFB9BDC2))),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Rechazar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Permitir'),
            ),
          ],
        ),
      );
      if (approved != null) {
        await _resolveConfirmation(requestId, approved, link);
      }
    } finally {
      _showingConfirmation = false;
    }
  }

  Future<void> _resolveConfirmation(
    String requestId,
    bool approved, [
    _MobileLink? target,
  ]) async {
    final link = target ?? _linkForConfirmation(requestId);
    if (link == null || !link.pendingConfirmations.containsKey(requestId)) {
      return;
    }
    try {
      final session = link.connection.session;
      if (session == null) {
        throw StateError('The mobile session is no longer connected.');
      }
      await session.sendConfirmationResponse(
        requestId: requestId,
        approved: approved,
      );
      link.pendingConfirmations.remove(requestId);
      await _runNotificationTask(
        () => _notifications.cancelConfirmation(requestId),
        'confirmation cleanup',
      );
    } on Object catch (error, stackTrace) {
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'HELIX mobile confirmation',
      ));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('No se pudo enviar la respuesta de permiso.'),
        ));
      }
    }
  }

  void _handleNotificationResponse(NotificationResponse response) {
    final rawPayload = response.payload;
    if (rawPayload == null) return;
    try {
      final payload = jsonDecode(rawPayload);
      if (payload is! Map<String, dynamic> ||
          payload['type'] != 'confirmation' ||
          payload['request_id'] is! String) {
        return;
      }
      final requestId = payload['request_id'] as String;
      final link = _linkForConfirmation(requestId);
      if (response.actionId == 'allow') {
        unawaited(_resolveConfirmation(requestId, true, link));
      } else if (response.actionId == 'deny') {
        unawaited(_resolveConfirmation(requestId, false, link));
      } else {
        final pending = link?.pendingConfirmations[requestId];
        if (pending != null && link != null) {
          unawaited(_presentConfirmation(requestId, pending, link));
        }
      }
    } on FormatException catch (error, stackTrace) {
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'HELIX mobile notification',
      ));
    }
  }

  _MobileLink? _linkForConfirmation(String requestId) {
    for (final link in _links.values) {
      if (link.pendingConfirmations.containsKey(requestId)) return link;
    }
    return null;
  }

  String _failureCategory(Map<String, dynamic> payload) {
    if (payload['failure_category'] == 'provider' ||
        (payload['provider'] is String &&
            (payload['provider'] as String).isNotEmpty)) {
      return 'provider';
    }
    return 'internal';
  }

  String _failureMessage(Map<String, dynamic> payload) {
    final category = _failureCategory(payload);
    if (category == 'provider') {
      final provider = payload['failure_provider'] ?? payload['provider'];
      return provider is String && provider.isNotEmpty
          ? 'Fallo del proveedor ($provider): no se pudo completar la tarea.'
          : 'Fallo del proveedor: no se pudo completar la tarea.';
    }
    return 'Error interno de HELIX: no se pudo completar la tarea.';
  }

  void _notifyFailure({
    required String category,
    String? provider,
    required String message,
  }) {
    if (_isForeground || !_notificationsEnabled) return;
    unawaited(_runNotificationTask(
      () => _notifications.showFailure(
        category: category,
        provider: provider,
        message: message,
      ),
      'task failure notification',
    ));
  }

  void _notifyReply(String text) {
    if (_isForeground || !_notificationsEnabled) return;
    unawaited(_runNotificationTask(
      () => _notifications.showReply(text),
      'assistant reply notification',
    ));
  }

  Future<void> _runNotificationTask(
    Future<void> Function() task,
    String operation,
  ) async {
    try {
      await task();
    } on Object catch (error, stackTrace) {
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'HELIX mobile notifications',
        context: ErrorDescription('while handling $operation'),
      ));
    }
  }

  void _updateProgress(Map<String, dynamic> payload, _MobileLink link) {
    final taskId = payload['id'];
    final status = payload['status'];
    if (taskId is! String || status is! String) return;
    if (status == 'completed' || status == 'failed' || status == 'cancelled') {
      final terminal = status == 'completed'
          ? 'Completado'
          : status == 'failed'
              ? 'Ocurrió un error'
              : 'Cancelado';
      link.activeTaskId = taskId;
      link.activeProgress = terminal;
      if (_selectedSessionId == link.sessionId) setState(() {});
      if (status == 'failed') {
        final failure = _failureMessage(payload);
        _appendIncomingMessage(failure, link);
        _notifyFailure(
          category: _failureCategory(payload),
          provider: payload['failure_provider'] is String
              ? payload['failure_provider'] as String
              : null,
          message: failure,
        );
      }
      Future<void>.delayed(const Duration(seconds: 3), () {
        if (!mounted || link.activeTaskId != taskId) return;
        link.activeTaskId = null;
        link.activeProgress = null;
        if (_selectedSessionId == link.sessionId) setState(() {});
      });
      return;
    }
    if (!{'queued', 'running', 'waiting_confirmation', 'retrying'}
        .contains(status)) {
      return;
    }
    final summary = payload['execution_summary'];
    final label =
        summary is Map<String, dynamic> ? summary['progress_label'] : null;
    link.activeTaskId = taskId;
    link.activeProgress = _localizedProgress(label is String ? label : status);
    if (_selectedSessionId == link.sessionId) {
      setState(() {});
      _scrollToBottom();
    }
  }

  String _localizedProgress(String label) {
    final normalized = label.toLowerCase();
    if (normalized.contains('approval') ||
        normalized.contains('confirmation')) {
      return 'Esperando confirmación…';
    }
    if (normalized.contains('search') || normalized.contains('browser')) {
      return 'Buscando…';
    }
    if (normalized.contains('execut')) return 'Ejecutando…';
    if (normalized.contains('think') ||
        normalized.contains('model request') ||
        normalized.contains('running')) {
      return 'Pensando…';
    }
    if (normalized.contains('writing')) return 'Escribiendo…';
    return label == 'queued' ? 'En cola…' : 'Procesando…';
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOutQuad,
        );
      }
    });
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty || !_connected) return;
    setState(() {
      _messages.add(_Message(text, true));
      _controller.clear();
      _hasInputText = false;
      _activeProgress = 'Pensando…';
      if (_activeLink != null) _activeLink!.activeTaskId = null;
    });
    _scrollToBottom();
    _activeLink?.connection.session
        ?.sendUserText(text: text, conversationId: 'mobile-session');
  }

  Future<void> _toggleBrowserLive() async {
    final link = _activeLink;
    final session = link?.connection.session;
    if (link == null || session == null || !session.relaySkillsRequests) return;
    final paused = !link.browserLivePaused;
    try {
      await session.setBrowserLivePaused(paused);
      if (mounted) setState(() => link.browserLivePaused = paused);
    } on Object catch (error, stackTrace) {
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'HELIX mobile browser live view',
      ));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('No se pudo actualizar la transmisión: $error'),
        ));
      }
    }
  }

  Future<void> _resumeBrowserLive(_MobileLink link) async {
    final session = link.connection.session;
    if (session == null || !session.relaySkillsRequests) return;
    try {
      await session.setBrowserLivePaused(false);
      link.browserLivePaused = false;
    } on Object catch (error, stackTrace) {
      FlutterError.reportError(FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'HELIX mobile browser live view',
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      drawer: _buildDrawer(theme),
      appBar: AppBar(
        leading: Builder(
          builder: (context) => IconButton(
              tooltip: 'Abrir menú',
              onPressed: () => Scaffold.of(context).openDrawer(),
              icon: const Icon(Icons.menu_rounded, size: 23)),
        ),
        centerTitle: false,
        titleSpacing: 0,
        title: const HelixMark(size: 22),
        actions: [
          _ConnectionPill(
              connected: _connected,
              connecting: _connecting,
              onTap: _toggleConnection),
          const SizedBox(width: 12),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
                child: _tab == 0
                    ? _buildConversation(theme)
                    : _tab == 1
                        ? _buildDesktopPanel(theme)
                        : _tab == 2
                            ? MobileSubagentsPanel(
                                key: ValueKey(_selectedSessionId),
                                session: _activeLink?.connection.session,
                              )
                            : _tab == 3
                                ? _buildBrowserPanel(theme)
                                : _buildRemoteDesktopPanel(theme)),
            if (_tab != 4) _buildComposer(theme),
          ],
        ),
      ),
    );
  }

  Widget _buildDrawer(ThemeData theme) => Drawer(
        backgroundColor: const Color(0xFF101010),
        child: SafeArea(
            child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        const HelixMark(size: 26),
                        const Spacer(),
                        IconButton(
                            onPressed: () => Navigator.pop(context),
                            icon: const Icon(Icons.close_rounded))
                      ]),
                      const SizedBox(height: 20),
                      _DrawerAction(
                          icon: Icons.add_comment_outlined,
                          label: 'Nueva conversación',
                          onTap: () {
                            Navigator.pop(context);
                            setState(() {
                              _messages.clear();
                              _tab = 0;
                            });
                          }),
                      _DrawerAction(
                          icon: _tab == 0
                              ? Icons.chat_bubble_outline_rounded
                              : Icons.chat_bubble_rounded,
                          label: 'Chat de HELIX',
                          onTap: () {
                            Navigator.pop(context);
                            setState(() => _tab = 0);
                          }),
                      _DrawerAction(
                          icon: Icons.desktop_windows_outlined,
                          label: 'Panel de conexión Desktop',
                          onTap: () {
                            Navigator.pop(context);
                            setState(() => _tab = 1);
                          }),
                      _DrawerAction(
                          icon: Icons.groups_2_outlined,
                          label: 'Panel de subagentes',
                          onTap: () {
                            Navigator.pop(context);
                            setState(() => _tab = 2);
                          }),
                      _DrawerAction(
                          icon: Icons.language_rounded,
                          label: 'Navegador en vivo',
                          onTap: () {
                            Navigator.pop(context);
                            setState(() => _tab = 3);
                          }),
                      _DrawerAction(
                          icon: Icons.settings_remote_rounded,
                          label: 'Control remoto del Desktop',
                          onTap: () {
                            Navigator.pop(context);
                            setState(() => _tab = 4);
                            final link = _activeLink;
                            if (link != null && !link.desktopStreamActive) {
                              unawaited(_toggleDesktopStream(link));
                            }
                          }),
                      _DrawerAction(
                          icon: Icons.add_link_rounded,
                          label: 'Agregar otro Desktop',
                          onTap: () {
                            Navigator.pop(context);
                            unawaited(_addConnection());
                          }),
                      _DrawerAction(
                          icon: _connected
                              ? Icons.link_off_rounded
                              : Icons.link_rounded,
                          label: _connected
                              ? 'Desconectar sesión'
                              : 'Vincular Desktop',
                          onTap: () {
                            Navigator.pop(context);
                            _toggleConnection();
                          }),
                      if (_links.isNotEmpty) ...[
                        const SizedBox(height: 18),
                        const Text('DESKTOPS',
                            style: TextStyle(
                                color: Color(0xFF85898E),
                                fontSize: 11,
                                letterSpacing: 1.2,
                                fontWeight: FontWeight.w700)),
                        const SizedBox(height: 8),
                        Expanded(
                          child: ListView(
                            padding: EdgeInsets.zero,
                            children: _links.values
                                .map((link) => ListTile(
                                      contentPadding: EdgeInsets.zero,
                                      leading: Icon(
                                        link.connected
                                            ? Icons.cloud_done_outlined
                                            : link.connecting
                                                ? Icons.sync_rounded
                                                : Icons.cloud_off_outlined,
                                        color: link.connected
                                            ? const Color(0xFF77D89A)
                                            : const Color(0xFF85898E),
                                      ),
                                      title: Text(
                                        link.name,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      subtitle: Text(link.connected
                                          ? 'Conectado'
                                          : link.connecting
                                              ? 'Reconectando…'
                                              : 'Desconectado'),
                                      selected:
                                          link.sessionId == _selectedSessionId,
                                      onTap: () {
                                        Navigator.pop(context);
                                        setState(() {
                                          _selectedSessionId = link.sessionId;
                                          _tab = 0;
                                        });
                                      },
                                    ))
                                .toList(),
                          ),
                        ),
                      ],
                      const SizedBox(height: 18),
                      const Text('SESIÓN',
                          style: TextStyle(
                              color: Color(0xFF85898E),
                              fontSize: 11,
                              letterSpacing: 1.2,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(height: 10),
                      _InfoCard(
                          icon: Icons.shield_outlined,
                          title: 'Transporte',
                          value: !_connected
                              ? 'Sin sesión'
                              : _activeLink?.config.mode ==
                                      MobileTransportMode.relay
                                  ? 'Relay WSS autenticado'
                                  : 'SSH + WebSocket'),
                      const Spacer(),
                      const Text(
                          'La app móvil depende de HELIX Desktop para ejecutar acciones.',
                          style: TextStyle(
                              color: Color(0xFF85898E),
                              height: 1.4,
                              fontSize: 12)),
                    ]))),
      );

  Widget _buildConversation(ThemeData theme) {
    if (_voiceMode) return _buildVoicePanel(theme);
    if (_messages.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (!_connected) ...[
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                    color: const Color(0x1FEE6018),
                    borderRadius: BorderRadius.circular(16)),
                child: const Center(
                  child: HelixMark(size: 30, showWordmark: false),
                ),
              ),
              const SizedBox(height: 20),
              Text('Conecta tu Desktop HELIX',
                  style: theme.textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.w700),
                  textAlign: TextAlign.center),
              const SizedBox(height: 8),
              const Text(
                  'La app móvil depende de una sesión segura con tu equipo Desktop.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: Color(0xFF85898E), height: 1.45, fontSize: 14)),
              const SizedBox(height: 22),
              OutlinedButton.icon(
                  onPressed: _toggleConnection,
                  icon: const Icon(Icons.link_rounded, size: 18),
                  label: const Text('Configurar conexión')),
            ] else ...[
              const SizedBox(height: 40),
              Text('¿En qué puedo ayudarte?',
                  style: theme.textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.w700, fontSize: 22),
                  textAlign: TextAlign.center),
              const SizedBox(height: 32),
              _buildSuggestionChips(),
            ],
          ]),
        ),
      );
    }
    return ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 12),
        itemCount: _messages.length + (_activeProgress == null ? 0 : 1),
        itemBuilder: (_, i) => i < _messages.length
            ? _Bubble(message: _messages[i])
            : _ProgressLabel(label: _activeProgress!));
  }

  Widget _buildVoicePanel(ThemeData theme) => Center(
      child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
                width: 124,
                height: 124,
                decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0x1FEE6018),
                    border:
                        Border.all(color: const Color(0x66EE6018), width: 1.5)),
                child: Icon(
                    _connected
                        ? Icons.graphic_eq_rounded
                        : Icons.mic_none_rounded,
                    color: const Color(0xFFEE6018),
                    size: 48)),
            const SizedBox(height: 22),
            Text(_connected ? 'Voice listo' : 'Vincula Desktop para usar Voice',
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.w700),
                textAlign: TextAlign.center),
            const SizedBox(height: 8),
            const Text(
                'El audio se procesa en Desktop; el móvil solo controla la sesión.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0xFF85898E), height: 1.45)),
            const SizedBox(height: 22),
            FilledButton.icon(
                onPressed: _connected ? () {} : _toggleConnection,
                icon: Icon(_connected ? Icons.mic_rounded : Icons.link_rounded),
                label: Text(_connected
                    ? 'Mantener pulsado para hablar'
                    : 'Vincular Desktop')),
          ])));

  void _sendPreset(String text) {
    _controller.text = text;
    _send();
  }

  Widget _buildSuggestionChips() => Column(
        children: [
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            _SuggestionTile(
              title: 'Resume mi sesión',
              subtitle: 'continúa desde donde lo dejaste',
              onTap: () => _sendPreset('Resume mi sesión'),
            ),
            const SizedBox(width: 10),
            _SuggestionTile(
              title: 'Lista mis tareas',
              subtitle: 'pendientes en el Desktop',
              onTap: () => _sendPreset('Lista mis tareas'),
            ),
          ]),
          const SizedBox(height: 10),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            _SuggestionTile(
              title: 'Captura la pantalla',
              subtitle: 'toma una foto del escritorio',
              onTap: () => _sendPreset('Toma una captura de pantalla'),
            ),
            const SizedBox(width: 10),
            _SuggestionTile(
              title: 'Estado del sistema',
              subtitle: 'CPU, RAM y procesos activos',
              onTap: () => _sendPreset('Dame el estado del sistema'),
            ),
          ]),
        ],
      );

  Widget _buildDesktopPanel(ThemeData theme) =>
      ListView(padding: const EdgeInsets.all(16), children: [
        Text('Desktop',
            style: theme.textTheme.headlineSmall
                ?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        const Text(
            'La aplicación móvil solo observa y controla la sesión remota.',
            style: TextStyle(color: Color(0xFF85898E))),
        const SizedBox(height: 22),
        _InfoCard(
            icon: Icons.router_rounded,
            title: 'Sesión remota',
            value: _connected ? 'Conectada vía túnel seguro' : 'Sin conexión',
            accent:
                _connected ? const Color(0xFF77D89A) : const Color(0xFF85898E)),
        const _InfoCard(
            icon: Icons.lock_outline_rounded,
            title: 'Transporte',
            value: 'SSH + WebSocket autenticado'),
        const _InfoCard(
            icon: Icons.computer_rounded,
            title: 'Destino',
            value: 'Desktop HELIX · 127.0.0.1:8765'),
        const SizedBox(height: 12),
        FilledButton.icon(
            onPressed: _toggleConnection,
            icon:
                Icon(_connected ? Icons.link_off_rounded : Icons.link_rounded),
            label: Text(_connected ? 'Desconectar' : 'Conectar Desktop')),
      ]);


  Future<void> _toggleDesktopStream(_MobileLink link) async {
    final session = link.connection.session;
    if (session == null) return;
    try {
      if (link.desktopStreamActive) {
        await session.stopDesktopStream();
        link.desktopStreamActive = false;
      } else {
        await session.startDesktopStream(fps: 10);
        link.desktopStreamActive = true;
      }
      setState(() {});
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error con control remoto: $e')),
        );
      }
    }
  }

  void _sendRemoteMouse(String action, Offset localPos, Size renderSize) {
    final session = _activeLink?.connection.session;
    if (session == null || renderSize.width <= 0 || renderSize.height <= 0) return;
    final xRatio = (localPos.dx / renderSize.width).clamp(0.0, 1.0);
    final yRatio = (localPos.dy / renderSize.height).clamp(0.0, 1.0);
    session.sendRemoteMouseEvent(
      action: action,
      xRatio: xRatio,
      yRatio: yRatio,
    );
  }

  void _sendRemoteKey(String key) {
    final session = _activeLink?.connection.session;
    if (session == null) return;
    session.sendRemoteKeyboardInput(key: key);
  }

  void _sendRemoteText(String text) {
    if (text.isEmpty) return;
    final session = _activeLink?.connection.session;
    if (session == null) return;
    session.sendRemoteKeyboardInput(text: text);
    _remoteKeyController.clear();
  }

  Widget _buildRemoteDesktopPanel(ThemeData theme) {
    final link = _activeLink;
    final frame = link?.desktopFrame;
    if (link == null) {
      return const Center(child: Text('Agrega un Desktop para iniciar control remoto.'));
    }

    return Column(
      children: [
        ListTile(
          leading: const Icon(Icons.settings_remote_rounded, color: Color(0xFFEE6018)),
          title: const Text('Control Remoto de Pantalla'),
          subtitle: Text(link.desktopStreamActive
              ? (frame != null ? 'Transmisión activa · Toca para controlar' : 'Iniciando captura...')
              : 'Transmisión detenida'),
          trailing: IconButton(
            tooltip: link.desktopStreamActive ? 'Detener transmisión' : 'Iniciar transmisión',
            icon: Icon(
              link.desktopStreamActive ? Icons.stop_circle_rounded : Icons.play_circle_fill_rounded,
              color: link.desktopStreamActive ? Colors.redAccent : const Color(0xFF77D89A),
              size: 28,
            ),
            onPressed: () => _toggleDesktopStream(link),
          ),
        ),
        Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          color: const Color(0xFF18181A),
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              TextButton.icon(
                icon: const Icon(Icons.keyboard_rounded, size: 16),
                label: Text(_showRemoteKeyboard ? 'Ocultar teclado' : 'Escribir texto'),
                onPressed: () => setState(() => _showRemoteKeyboard = !_showRemoteKeyboard),
              ),
              const SizedBox(width: 4),
              OutlinedButton(
                onPressed: () => _sendRemoteKey('enter'),
                child: const Text('Enter'),
              ),
              const SizedBox(width: 4),
              OutlinedButton(
                onPressed: () => _sendRemoteKey('backspace'),
                child: const Text('Backspace'),
              ),
              const SizedBox(width: 4),
              OutlinedButton(
                onPressed: () => _sendRemoteKey('esc'),
                child: const Text('Esc'),
              ),
              const SizedBox(width: 4),
              OutlinedButton(
                onPressed: () => _sendRemoteKey('tab'),
                child: const Text('Tab'),
              ),
              const SizedBox(width: 4),
              OutlinedButton(
                onPressed: () => _sendRemoteKey('space'),
                child: const Text('Espacio'),
              ),
            ],
          ),
        ),
        if (_showRemoteKeyboard)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            color: const Color(0xFF222226),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _remoteKeyController,
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: 'Escribe aquí para enviar al Desktop…',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    ),
                    onSubmitted: (txt) => _sendRemoteText(txt),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  icon: const Icon(Icons.send_rounded, size: 18),
                  onPressed: () => _sendRemoteText(_remoteKeyController.text),
                ),
              ],
            ),
          ),
        Expanded(
          child: frame == null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.desktop_windows_outlined, size: 54, color: Color(0xFF85898E)),
                      const SizedBox(height: 14),
                      Text(
                        link.desktopStreamActive
                            ? 'Esperando primer fotograma del Desktop…'
                            : 'Inicia la transmisión para ver y controlar\nla pantalla de tu PC desde el móvil.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Color(0xFF85898E)),
                      ),
                      const SizedBox(height: 16),
                      if (!link.desktopStreamActive)
                        ElevatedButton.icon(
                          onPressed: () => _toggleDesktopStream(link),
                          icon: const Icon(Icons.play_arrow_rounded),
                          label: const Text('Iniciar Transmisión'),
                        ),
                    ],
                  ),
                )
              : LayoutBuilder(
                  builder: (context, constraints) {
                    final renderSize = Size(constraints.maxWidth, constraints.maxHeight);
                    return GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTapUp: (details) => _sendRemoteMouse('click', details.localPosition, renderSize),
                      onDoubleTapDown: (details) => _sendRemoteMouse('double_click', details.localPosition, renderSize),
                      onLongPressStart: (details) => _sendRemoteMouse('right_click', details.localPosition, renderSize),
                      onPanUpdate: (details) => _sendRemoteMouse('move', details.localPosition, renderSize),
                      child: InteractiveViewer(
                        minScale: 0.8,
                        maxScale: 3.5,
                        child: Center(
                          child: Image.memory(
                            frame,
                            fit: BoxFit.contain,
                            gaplessPlayback: true,
                          ),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildBrowserPanel(ThemeData theme) {
    final link = _activeLink;
    final frame = link?.browserFrame;
    if (link == null) {
      return const Center(
          child: Text('Agrega un Desktop para ver su navegador.'));
    }
    if (link.connection.session?.relaySkillsRequests != true) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'La vista en vivo requiere vincular el Desktop mediante el QR del relay.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFFB9BDC2)),
          ),
        ),
      );
    }
    return Column(children: [
      ListTile(
        title: const Text('Navegador de HELIX'),
        subtitle: Text(frame == null
            ? 'Esperando actividad del navegador…'
            : 'Vista actualizada al usar el navegador'),
        trailing: IconButton(
          tooltip: link.browserLivePaused ? 'Reanudar video' : 'Pausar video',
          onPressed: _toggleBrowserLive,
          icon: Icon(link.browserLivePaused
              ? Icons.play_arrow_rounded
              : Icons.pause_rounded),
        ),
      ),
      Expanded(
        child: frame == null
            ? Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.language_rounded,
                        size: 44, color: Color(0xFF85898E)),
                    const SizedBox(height: 12),
                    Text(
                      link.browserLivePaused
                          ? 'La transmisión está pausada.'
                          : 'HELIX mostrará aquí la página cuando use el navegador.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Color(0xFF85898E)),
                    ),
                  ],
                ),
              )
            : InteractiveViewer(
                minScale: 0.6,
                maxScale: 4,
                child: Center(child: Image.memory(frame, fit: BoxFit.contain)),
              ),
      ),
    ]);
  }

  Widget _buildComposer(ThemeData theme) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_hasSavedPairing && !_connected && !_connecting)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _toggleConnection,
                  icon: const Icon(Icons.refresh_rounded, size: 17),
                  label: const Text('Reconectar con HELIX Desktop'),
                ),
              ),
            ),
          if (_connected && _activeSkillMention != null)
            _buildSkillSuggestions(),
          if (_connectionError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0x22FF453A),
                  border: Border.all(color: const Color(0x66FF453A)),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(children: [
                  const Icon(Icons.error_outline_rounded,
                      color: Color(0xFFFF6B6B), size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_connectionError!,
                        style: const TextStyle(
                            color: Color(0xFFFF6B6B), fontSize: 12)),
                  ),
                ]),
              ),
            ),
          Container(
            margin: const EdgeInsets.fromLTRB(12, 4, 12, 14),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF1C1C1E),
              borderRadius: BorderRadius.circular(28),
              border: Border.all(
                color: _connected && _hasInputText
                    ? const Color(0xFFEE6018)
                    : const Color(0xFF333336),
                width: 1.2,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                IconButton(
                  tooltip: _connected ? 'Adjuntar' : null,
                  onPressed: _connected
                      ? () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              duration: Duration(seconds: 2),
                              content: Text(
                                  'Atajo rápido: puedes pedir capturas o comandos al Desktop.'),
                            ),
                          );
                        }
                      : null,
                  icon: Icon(
                    Icons.add_rounded,
                    color: _connected
                        ? const Color(0xFF98989E)
                        : const Color(0xFF48484A),
                    size: 22,
                  ),
                  splashRadius: 20,
                  constraints:
                      const BoxConstraints(minWidth: 36, minHeight: 36),
                  padding: EdgeInsets.zero,
                ),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    enabled: _connected,
                    minLines: 1,
                    maxLines: 5,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    style: const TextStyle(fontSize: 15, color: Colors.white),
                    decoration: InputDecoration(
                      hintText: _connected
                          ? 'Pregunta a HELIX...'
                          : 'Conecta tu Desktop para chatear',
                      hintStyle: const TextStyle(
                          color: Color(0xFF68686E), fontSize: 14.5),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      filled: false,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                          vertical: 8, horizontal: 6),
                    ),
                  ),
                ),
                if (!_hasInputText)
                  IconButton(
                    tooltip: _voiceMode ? 'Modo texto' : 'Modo voz',
                    onPressed: () => setState(() => _voiceMode = !_voiceMode),
                    icon: Icon(
                      _voiceMode
                          ? Icons.chat_bubble_outline_rounded
                          : Icons.graphic_eq_rounded,
                      color: _voiceMode
                          ? const Color(0xFFEE6018)
                          : const Color(0xFF8E8E93),
                      size: 20,
                    ),
                    splashRadius: 20,
                    constraints:
                        const BoxConstraints(minWidth: 36, minHeight: 36),
                    padding: EdgeInsets.zero,
                  ),
                const SizedBox(width: 4),
                GestureDetector(
                  onTap: (_connected && _hasInputText) ? _send : null,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: (_connected && _hasInputText)
                          ? const Color(0xFFEE6018)
                          : const Color(0xFF2C2C2E),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.arrow_upward_rounded,
                      color: (_connected && _hasInputText)
                          ? Colors.white
                          : const Color(0xFF555558),
                      size: 19,
                    ),
                  ),
                ),
                const SizedBox(width: 4),
              ],
            ),
          ),
        ],
      );

  Widget _buildSkillSuggestions() {
    final mention = _activeSkillMention;
    if (mention == null) return const SizedBox.shrink();
    final matches = filterMobileSkills(_skills, mention);
    if (matches.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.fromLTRB(14, 0, 14, 6),
      constraints: const BoxConstraints(maxHeight: 190),
      decoration: BoxDecoration(
        color: const Color(0xFF202023),
        border: Border.all(color: const Color(0xFF38383C)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: ListView.separated(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: matches.length,
        separatorBuilder: (_, __) =>
            const Divider(height: 1, color: Color(0xFF333336)),
        itemBuilder: (_, index) {
          final skill = matches[index];
          return ListTile(
            dense: true,
            title: Text('@${skill.name}',
                style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: skill.description.isEmpty
                ? null
                : Text(
                    skill.description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Color(0xFF98989E)),
                  ),
            onTap: () {
              final currentMention = _activeSkillMention;
              if (currentMention == null) return;
              final nextText = replaceActiveSkillMention(
                _controller.text,
                currentMention,
                skill,
              );
              final nextCaret = currentMention.start +
                  '@${skill.name}'.length +
                  (currentMention.end < _controller.text.length &&
                          _controller.text[currentMention.end] == ' '
                      ? 0
                      : 1);
              _controller.value = TextEditingValue(
                text: nextText,
                selection: TextSelection.collapsed(offset: nextCaret),
              );
            },
          );
        },
      ),
    );
  }
}

class _ConnectionDraft {
  const _ConnectionDraft(
    this.config,
    this.token, {
    required this.sessionId,
    required this.name,
    this.deviceId,
  });

  final MobileConfig config;
  final String token;
  final String sessionId;
  final String name;
  final String? deviceId;
}

class _MobileLink {
  _MobileLink({
    required this.sessionId,
    required this.name,
    required this.config,
    required this.token,
    required this.connection,
  });

  final String sessionId;
  final String name;
  final MobileConfig config;
  String token;
  final MobileConnection connection;
  final messages = <_Message>[];
  List<MobileSkill> skills = const [];
  final pendingConfirmations = <String, Map<String, dynamic>>{};
  StreamSubscription<HelixMessage>? events;
  StreamSubscription<TransportState>? transportStates;
  bool connected = false;
  bool connecting = false;
  String? connectionError;
  String? activeProgress;
  String? activeTaskId;
  Uint8List? browserFrame;
  bool browserLivePaused = false;
  Uint8List? desktopFrame;
  bool desktopStreamActive = false;

  Future<void> dispose() async {
    await events?.cancel();
    await transportStates?.cancel();
    await connection.close();
  }
}

class _ConnectionSheet extends StatefulWidget {
  const _ConnectionSheet();

  @override
  State<_ConnectionSheet> createState() => _ConnectionSheetState();
}

class _ConnectionSheetState extends State<_ConnectionSheet> {
  final _host = TextEditingController();
  final _user = TextEditingController();
  final _token = TextEditingController();
  final _key = TextEditingController();
  final _fingerprint = TextEditingController();
  final _sshPort = TextEditingController(text: '22');
  final _remoteWsPort = TextEditingController(text: '8765');
  DateTime? _invitationExpiresAt;
  String? _sessionId;
  String _desktopName = 'HELIX Desktop';
  bool _scanHandled = false;
  // Relay is preferred for production; SSH remains the local fallback.
  MobileTransportMode _mode = MobileTransportMode.relay;
  bool _requiresDeviceApproval = false;

  @override
  void initState() {
    super.initState();
    _restoreSecrets();
  }

  Future<void> _restoreSecrets() async {
    const store = SecurePairingStore();
    final savedPairings = await store.loadAll();
    if (!mounted || savedPairings.isEmpty) return;
    final saved = savedPairings.first;
    _token.text = saved.token;
    _key.text = saved.identityKeyPem ?? '';
    _fingerprint.text = saved.hostKeyFingerprint ?? '';
    if (saved.transportMode == 'sshTunnel') {
      _mode = MobileTransportMode.sshTunnel;
      _host.text = saved.sshHost ?? '';
      _user.text = saved.sshUser ?? '';
      _sshPort.text = (saved.sshPort ?? 22).toString();
      _remoteWsPort.text = (saved.remoteWsPort ?? 8765).toString();
    } else if (saved.relayWssUrl != null) {
      _host.text = saved.relayWssUrl!;
      _mode = MobileTransportMode.relay;
    }
  }

  Future<void> _importInvitation() async {
    final input = TextEditingController();
    final raw = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Pegar invitación Desktop'),
        content: TextField(
          controller: input,
          autofocus: true,
          minLines: 5,
          maxLines: 8,
          decoration:
              const InputDecoration(hintText: '{"host":"192.168.1.20", ...}'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancelar')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, input.text),
              child: const Text('Importar')),
        ],
      ),
    );
    input.dispose();
    if (!mounted || raw == null || raw.trim().isEmpty) return;
    _applyInvitation(raw);
  }

  Future<void> _scanInvitation() async {
    _scanHandled = false;
    final raw = await showDialog<String>(
      context: context,
      builder: (dialogContext) => Dialog(
        child: SizedBox(
          width: 360,
          height: 440,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    const Expanded(child: Text('Escanear QR de HELIX Desktop')),
                    IconButton(
                      onPressed: () => Navigator.pop(dialogContext),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: MobileScanner(
                  onDetect: (capture) {
                    if (_scanHandled || capture.barcodes.isEmpty) return;
                    final value = capture.barcodes.first.rawValue;
                    if (value != null && value.isNotEmpty) {
                      _scanHandled = true;
                      Navigator.pop(dialogContext, value);
                    }
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted || raw == null) return;
    _applyInvitation(raw);
  }

  void _applyInvitation(String raw) {
    try {
      final invitation = MobilePairingInvitation.decode(raw);
      _host.text = invitation.relayWssUrl;
      _token.text = invitation.token;
      final path = Uri.parse(invitation.relayWssUrl).pathSegments;
      final roomId = path.length >= 3 ? path[2] : 'desktop';
      _desktopName = 'HELIX Desktop · ${roomId.substring(roomId.length - 4)}';
      _sessionId = _newMobileSessionId();
      _mode = MobileTransportMode.relay;
      _requiresDeviceApproval = true;
      _invitationExpiresAt = invitation.expiresAt;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text(
                'Invitación importada. Aprueba la vinculación desde Desktop si se solicita.')));
      }
    } on FormatException catch (error) {
      if (mounted) {
        final detail = error.message.toString();
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(detail.isEmpty
              ? 'La invitación no tiene un formato válido.'
              : 'Invitación inválida: $detail'),
        ));
      }
    }
  }

  @override
  void dispose() {
    _host.dispose();
    _user.dispose();
    _token.dispose();
    _key.dispose();
    _fingerprint.dispose();
    _sshPort.dispose();
    _remoteWsPort.dispose();
    super.dispose();
  }

  void _submit() {
    if (_invitationExpiresAt != null &&
        !_invitationExpiresAt!.isAfter(DateTime.now())) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('La invitación expiró. Escanea un QR nuevo en Desktop.'),
      ));
      return;
    }
    if (_host.text.trim().isEmpty ||
        _token.text.trim().isEmpty ||
        (_mode == MobileTransportMode.sshTunnel &&
            (_user.text.trim().isEmpty ||
                _key.text.trim().isEmpty ||
                _fingerprint.text.trim().isEmpty))) {
      return;
    }
    Navigator.of(context).pop(_ConnectionDraft(
      MobileConfig(
        mode: _mode,
        desktop: DesktopConfig(
          host: _host.text.trim(),
          sshPort: int.tryParse(_sshPort.text.trim()) ?? 22,
          sshUser: _user.text.trim(),
          remoteWsPort: int.tryParse(_remoteWsPort.text.trim()) ?? 8765,
          identityKeyRef: 'memory://mobile-session-key',
          wsTokenRef: 'memory://mobile-session-token',
          identityKeyPem: _key.text.trim().isEmpty ? null : _key.text,
          hostKeyFingerprint: _fingerprint.text.trim().isEmpty
              ? null
              : _fingerprint.text.trim(),
        ),
        relayWssUrl:
            _mode == MobileTransportMode.relay ? _host.text.trim() : null,
        requiresDeviceApproval: _requiresDeviceApproval,
        invitationExpiresAt: _invitationExpiresAt,
      ),
      _token.text.trim(),
      sessionId: _sessionId ?? _newMobileSessionId(),
      name: _desktopName,
    ));
  }

  String _newMobileSessionId() {
    final random = Random.secure();
    return List.generate(
      24,
      (_) => 'abcdefghijklmnopqrstuvwxyz0123456789'[random.nextInt(36)],
    ).join();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(
            20, 18, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
        child: ListView(shrinkWrap: true, children: [
          Row(children: [
            const HelixMark(size: 22),
            const Spacer(),
            IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close))
          ]),
          const SizedBox(height: 10),
          const Text('Conectar Desktop',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 5),
          const Text(
              'La app móvil no aloja el agente: abre una sesión autenticada contra tu HELIX Desktop.',
              style: TextStyle(color: Color(0xFF85898E), height: 1.4)),
          const SizedBox(height: 18),
          OutlinedButton.icon(
              onPressed: _scanInvitation,
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Text('Escanear QR de Desktop')),
          TextButton.icon(
              onPressed: _importInvitation,
              icon: const Icon(Icons.content_paste_go_rounded),
              label: const Text('Usar alternativa manual')),
          if (_invitationExpiresAt != null)
            Text(
              'Invitación temporal · expira ${_invitationExpiresAt!.toLocal()}',
              style: const TextStyle(color: Color(0xFF85898E)),
            ),
          const SizedBox(height: 12),
          SegmentedButton<MobileTransportMode>(
            segments: const [
              ButtonSegment(
                  value: MobileTransportMode.sshTunnel,
                  label: Text('SSH seguro'),
                  icon: Icon(Icons.lock_outline_rounded)),
              ButtonSegment(
                  value: MobileTransportMode.relay,
                  label: Text('Relay WSS'),
                  icon: Icon(Icons.cloud_outlined)),
            ],
            selected: {_mode},
            onSelectionChanged: (value) => setState(() => _mode = value.first),
          ),
          const SizedBox(height: 14),
          TextField(
              controller: _host,
              keyboardType: TextInputType.url,
              decoration: InputDecoration(
                  labelText: _mode == MobileTransportMode.sshTunnel
                      ? 'Host del Desktop'
                      : 'URL WSS del relay',
                  prefixIcon: Icon(_mode == MobileTransportMode.sshTunnel
                      ? Icons.computer_rounded
                      : Icons.language_rounded))),
          if (_mode == MobileTransportMode.sshTunnel) ...[
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                  child: TextField(
                      controller: _sshPort,
                      keyboardType: TextInputType.number,
                      decoration:
                          const InputDecoration(labelText: 'Puerto SSH'))),
              const SizedBox(width: 10),
              Expanded(
                  child: TextField(
                      controller: _remoteWsPort,
                      keyboardType: TextInputType.number,
                      decoration:
                          const InputDecoration(labelText: 'Puerto HELIX'))),
            ]),
            const SizedBox(height: 10),
            TextField(
                controller: _user,
                decoration: const InputDecoration(
                    labelText: 'Usuario SSH',
                    prefixIcon: Icon(Icons.person_outline_rounded))),
            const SizedBox(height: 10),
            TextField(
                controller: _key,
                maxLines: 3,
                // PEM keys are multiline; Flutter forbids obscureText on multiline fields.
                obscureText: false,
                decoration: const InputDecoration(
                    labelText: 'Clave privada PEM',
                    helperText:
                        'Se guarda en almacenamiento seguro tras conectar',
                    prefixIcon: Icon(Icons.key_rounded))),
            const SizedBox(height: 10),
            TextField(
                controller: _fingerprint,
                decoration: const InputDecoration(
                    labelText: 'Huella SSH obligatoria',
                    helperText:
                        'Formato OpenSSH SHA256:…; evita aceptar otro host',
                    prefixIcon: Icon(Icons.verified_user_outlined))),
          ],
          const SizedBox(height: 10),
          TextField(
              controller: _token,
              obscureText: true,
              decoration: const InputDecoration(
                  labelText: 'Token del agente HELIX',
                  helperText: 'Usa el token temporal generado en Toolbox',
                  prefixIcon: Icon(Icons.password_rounded))),
          const SizedBox(height: 18),
          FilledButton.icon(
              onPressed: _submit,
              icon: const Icon(Icons.link_rounded),
              label: const Text('Abrir sesión segura')),
        ]),
      );
}

class _Message {
  const _Message(this.text, this.mine);
  final String text;
  final bool mine;
}

class _ProgressLabel extends StatelessWidget {
  const _ProgressLabel({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(left: 36, bottom: 12),
          child: Text(
            label,
            style: const TextStyle(
              color: Color(0xFFEE8A55),
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      );
}

class _DrawerAction extends StatelessWidget {
  const _DrawerAction(
      {required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: const Color(0xFFEE6018)),
      title: Text(label),
      onTap: onTap);
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});
  final _Message message;

  @override
  Widget build(BuildContext context) {
    if (message.mine) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(bottom: 8, left: 60),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: const Color(0xFF1D1A18),
            border: Border.all(color: const Color(0x44EE6018)),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(16),
              topRight: Radius.circular(16),
              bottomLeft: Radius.circular(16),
              bottomRight: Radius.circular(5),
            ),
          ),
          child: Text(message.text,
              style: const TextStyle(
                  fontSize: 15, height: 1.4, color: Colors.white)),
        ),
      );
    }
    return Align(
      alignment: Alignment.centerLeft,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            margin: const EdgeInsets.only(right: 8, top: 2),
            decoration: BoxDecoration(
              color: const Color(0x1FEE6018),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Center(
              child: HelixMark(size: 15, showWordmark: false),
            ),
          ),
          Expanded(
            child: Container(
              margin: const EdgeInsets.only(bottom: 8, right: 40),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                color: const Color(0xFF1D1A18),
                border: Border.all(color: const Color(0xFF2B2D30)),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(5),
                  topRight: Radius.circular(16),
                  bottomLeft: Radius.circular(16),
                  bottomRight: Radius.circular(16),
                ),
              ),
              child: Text(
                message.text,
                style: const TextStyle(
                  fontSize: 15,
                  height: 1.5,
                  color: Color(0xFFF4F5F6),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard(
      {required this.icon,
      required this.title,
      required this.value,
      this.accent = const Color(0xFFB9BDC2)});
  final IconData icon;
  final String title;
  final String value;
  final Color accent;
  @override
  Widget build(BuildContext context) => Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
          color: const Color(0xFF1D1A18),
          border: Border.all(color: const Color(0xFF2B2D30)),
          borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        Icon(icon, color: const Color(0xFFEE6018), size: 22),
        const SizedBox(width: 13),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title,
              style: const TextStyle(color: Color(0xFF85898E), fontSize: 12)),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(color: accent, fontWeight: FontWeight.w600))
        ]))
      ]));
}

class _SuggestionTile extends StatelessWidget {
  const _SuggestionTile(
      {required this.title, required this.subtitle, required this.onTap});
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          width: 155,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF1D1A18),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFF2B2D30)),
          ),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: Colors.white)),
                const SizedBox(height: 3),
                Text(subtitle,
                    style: const TextStyle(
                        fontSize: 12, color: Color(0xFF8E8E93))),
              ]),
        ),
      );
}

class _ConnectionPill extends StatelessWidget {
  const _ConnectionPill(
      {required this.connected, required this.connecting, required this.onTap});
  final bool connected;
  final bool connecting;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
              color: const Color(0xFF151719),
              border: Border.all(color: const Color(0xFF2B2D30)),
              borderRadius: BorderRadius.circular(20)),
          child: Row(children: [
            Icon(Icons.circle,
                size: 9,
                color: connecting
                    ? const Color(0xFFEE6018)
                    : connected
                        ? const Color(0xFF77D89A)
                        : const Color(0xFF666A70)),
            const SizedBox(width: 7),
            Text(
                connecting
                    ? 'Conectando'
                    : connected
                        ? 'Conectado'
                        : 'Offline',
                style:
                    const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))
          ])));
}
