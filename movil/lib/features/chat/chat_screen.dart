import 'dart:async';
import 'dart:convert';

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
import 'mobile_skill_mentions.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final _messages = <_Message>[];
  final _connection = MobileConnection();
  final _pairingStore = const SecurePairingStore();
  final _backgroundConnection = const MobileBackgroundConnection();
  final _notifications = MobileTaskNotifications();
  StreamSubscription<HelixMessage>? _events;
  StreamSubscription<TransportState>? _transportStates;
  bool _connected = false;
  bool _connecting = false;
  bool _restoring = false;
  bool _hasSavedPairing = false;
  bool _needsForegroundReconnect = false;
  int _tab = 0;
  bool _voiceMode = false;
  bool _hasInputText = false;
  bool _isForeground = true;
  bool _notificationsEnabled = false;
  bool _showingConfirmation = false;
  ActiveSkillMention? _activeSkillMention;
  List<MobileSkill> _skills = const [];
  String? _connectionError;
  String? _activeProgress;
  String? _activeTaskId;
  final Map<String, Map<String, dynamic>> _pendingConfirmations = {};

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
    _transportStates?.cancel();
    _controller.dispose();
    _scrollController.dispose();
    _events?.cancel();
    unawaited(_connection.close());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      _isForeground = false;
      _needsForegroundReconnect = true;
      return;
    }
    if (state == AppLifecycleState.resumed) {
      _isForeground = true;
      if (_needsForegroundReconnect &&
          defaultTargetPlatform == TargetPlatform.iOS &&
          _connected) {
        _needsForegroundReconnect = false;
        setState(() {
          _connected = false;
          _connectionError = 'Restableciendo la conexión…';
        });
        unawaited(
          _closeSession().then((_) => _restoreSavedConnection()),
        );
        return;
      }
      _needsForegroundReconnect = false;
      unawaited(_restoreSavedConnection());
      unawaited(_presentPendingConfirmations());
    }
  }

  Future<void> _toggleConnection() async {
    if (_connected) {
      await _pairingStore.setAutoConnectEnabled(false);
      if (mounted) {
        setState(() {
          _connected = false;
          _activeProgress = null;
          _activeTaskId = null;
          _pendingConfirmations.clear();
          _notificationsEnabled = false;
          _connectionError = null;
        });
      }
      await _backgroundConnection.stop();
      await _closeSession();
      return;
    }
    if (_connecting || _restoring) return;
    final savedPairing = await _pairingStore.load();
    if (!mounted) return;
    if (savedPairing != null) {
      setState(() => _hasSavedPairing = true);
      await _pairingStore.setAutoConnectEnabled(true);
      if (!mounted) return;
      await _connectDraft(_draftFromSaved(savedPairing));
      return;
    }
    final draft = await showModalBottomSheet<_ConnectionDraft>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF101010),
      builder: (_) => const _ConnectionSheet(),
    );
    if (draft == null || !mounted) return;
    await _connectDraft(draft);
  }

  Future<void> _restoreSavedConnection() async {
    if (_connected || _connecting || _restoring || !mounted) return;
    _restoring = true;
    try {
      final savedPairing = await _pairingStore.load();
      if (savedPairing == null) return;
      if (mounted) setState(() => _hasSavedPairing = true);
      if (!await _pairingStore.autoConnectEnabled() || !mounted) return;
      await _connectDraft(_draftFromSaved(savedPairing));
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
    );
  }

  Future<void> _connectDraft(_ConnectionDraft draft) async {
    setState(() => _connecting = true);
    final messenger = ScaffoldMessenger.of(context);
    if (draft.config.requiresDeviceApproval) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Aprueba la solicitud de vinculación en HELIX Desktop.'),
        duration: Duration(minutes: 5),
      ));
    }
    try {
      final session = await _connection.connect(draft.config, draft.token);
      if (!mounted) {
        await _connection.close();
        return;
      }
      await _pairingStore.save(
        token: _connection.authenticatedToken ?? draft.token,
        relayWssUrl: draft.config.relayWssUrl,
        identityKeyPem: draft.config.desktop.identityKeyPem,
        hostKeyFingerprint: draft.config.desktop.hostKeyFingerprint,
        transportMode: draft.config.mode.name,
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
      if (!mounted) {
        await _connection.close();
        return;
      }
      messenger.hideCurrentSnackBar();
      _events = session.events.listen(_handleAgentEvent);
      _transportStates = session.states.listen(_handleTransportState);
      await _backgroundConnection.start();
      final notificationEnabled = await _prepareTaskNotifications();
      setState(() {
        _connecting = false;
        _connected = true;
        _hasSavedPairing = true;
        _notificationsEnabled = notificationEnabled;
        _connectionError = null;
      });
      unawaited(_loadSkills(session));
      if (!notificationEnabled && mounted) {
        messenger.showSnackBar(const SnackBar(
          content: Text(
              'La sesión está conectada, pero las notificaciones de tareas están desactivadas.'),
        ));
      }
    } on Object catch (e) {
      messenger.hideCurrentSnackBar();
      await _backgroundConnection.stop();
      await _connection.close();
      if (mounted) {
        setState(() {
          _connecting = false;
          _connectionError = e is UnsupportedError
              ? 'La conexión móvil requiere la app nativa; la versión web solo permite previsualizar la interfaz.'
              : e.toString().contains('TimeoutException')
                  ? 'Tiempo de espera agotado. Verifica que el relay esté activo.'
                  : e.toString().toLowerCase().contains('rejected')
                      ? 'La vinculación fue rechazada en HELIX Desktop.'
                      : 'No se pudo conectar. Revisa el token y la URL del relay.';
        });
        Future.delayed(const Duration(seconds: 6), () {
          if (mounted) setState(() => _connectionError = null);
        });
      }
    }
  }

  Future<void> _closeSession() async {
    await _events?.cancel();
    await _transportStates?.cancel();
    _events = null;
    _transportStates = null;
    await _connection.close();
  }

  void _handleTransportState(TransportState state) {
    if ((state != TransportState.failed &&
            state != TransportState.disconnected) ||
        !_connected) {
      return;
    }
    setState(() {
      _connected = false;
      _activeProgress = null;
      _activeTaskId = null;
      _connectionError = 'Se perdió la conexión. Puedes reconectarte.';
    });
    unawaited(_backgroundConnection.stop());
    unawaited(_closeSession().then((_) => _restoreSavedConnection()));
  }

  void _handleAgentEvent(HelixMessage event) {
    if (!mounted) return;
    if (event.type == 'skills_response') {
      _receiveSkills(event.payload);
      return;
    }
    if (event.type == 'confirmation_request') {
      unawaited(_requestMobileConfirmation(event.payload));
      return;
    }
    if (event.type == 'task_update') {
      _updateProgress(event.payload);
      return;
    }
    if (event.type == 'confirmation_resolved') {
      final requestId = event.payload['request_id'];
      if (requestId is String) {
        setState(() {
          _pendingConfirmations.remove(requestId);
        });
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
      _appendIncomingMessage(failureText);
      _notifyFailure(
        category: category,
        provider: provider is String ? provider : null,
        message: text,
      );
      return;
    }
    _appendIncomingMessage(text);
    if (event.type == 'agent_message' && event.payload['role'] == 'assistant') {
      _notifyReply(text);
    }
  }

  void _appendIncomingMessage(String text) {
    if (_messages.isNotEmpty &&
        !_messages.last.mine &&
        _messages.last.text == text) {
      return;
    }
    setState(() {
      _messages.add(_Message(text, false));
      _activeProgress = null;
      _activeTaskId = null;
    });
    _scrollToBottom();
  }

  Future<void> _loadSkills(HelixSession session) async {
    try {
      final skills = await session.requestSkills();
      if (session.relaySkillsRequests || !mounted) return;
      setState(() => _skills = skills.map(MobileSkill.fromJson).toList());
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

  void _receiveSkills(Map<String, dynamic> payload) {
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
      setState(() => _skills = parsed);
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
  ) async {
    final requestId = payload['id'];
    if (requestId is! String ||
        !RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          caseSensitive: false,
        ).hasMatch(requestId) ||
        _pendingConfirmations.containsKey(requestId)) {
      return;
    }
    _pendingConfirmations[requestId] = Map<String, dynamic>.from(payload);
    setState(() => _activeProgress = 'Esperando confirmación…');
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
    await _presentConfirmation(requestId, payload);
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
    for (final entry in _pendingConfirmations.entries.toList()) {
      if (!mounted || !_isForeground) return;
      await _presentConfirmation(entry.key, entry.value);
    }
  }

  Future<void> _presentConfirmation(
    String requestId,
    Map<String, dynamic> payload,
  ) async {
    if (!mounted ||
        !_isForeground ||
        _showingConfirmation ||
        !_pendingConfirmations.containsKey(requestId)) {
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
        await _resolveConfirmation(requestId, approved);
      }
    } finally {
      _showingConfirmation = false;
    }
  }

  Future<void> _resolveConfirmation(String requestId, bool approved) async {
    if (!_pendingConfirmations.containsKey(requestId)) return;
    try {
      final session = _connection.session;
      if (session == null) {
        throw StateError('The mobile session is no longer connected.');
      }
      await session.sendConfirmationResponse(
        requestId: requestId,
        approved: approved,
      );
      _pendingConfirmations.remove(requestId);
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
      if (response.actionId == 'allow') {
        unawaited(_resolveConfirmation(requestId, true));
      } else if (response.actionId == 'deny') {
        unawaited(_resolveConfirmation(requestId, false));
      } else {
        final pending = _pendingConfirmations[requestId];
        if (pending != null) {
          unawaited(_presentConfirmation(requestId, pending));
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

  void _updateProgress(Map<String, dynamic> payload) {
    final taskId = payload['id'];
    final status = payload['status'];
    if (taskId is! String || status is! String) return;
    if (status == 'completed' || status == 'failed' || status == 'cancelled') {
      final terminal = status == 'completed'
          ? 'Completado'
          : status == 'failed'
              ? 'Ocurrió un error'
              : 'Cancelado';
      setState(() {
        _activeTaskId = taskId;
        _activeProgress = terminal;
      });
      if (status == 'failed') {
        final failure = _failureMessage(payload);
        _appendIncomingMessage(failure);
        _notifyFailure(
          category: _failureCategory(payload),
          provider: payload['failure_provider'] is String
              ? payload['failure_provider'] as String
              : null,
          message: failure,
        );
      }
      Future<void>.delayed(const Duration(seconds: 3), () {
        if (!mounted || _activeTaskId != taskId) return;
        setState(() {
          _activeTaskId = null;
          _activeProgress = null;
        });
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
    setState(() {
      _activeTaskId = taskId;
      _activeProgress = _localizedProgress(
        label is String ? label : status,
      );
    });
    _scrollToBottom();
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
      _activeTaskId = null;
    });
    _scrollToBottom();
    _connection.session
        ?.sendUserText(text: text, conversationId: 'mobile-session');
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
                    : _buildDesktopPanel(theme)),
            _buildComposer(theme),
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
                          value: _connected ? 'SSH + WebSocket' : 'Sin sesión'),
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
  const _ConnectionDraft(this.config, this.token);
  final MobileConfig config;
  final String token;
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
    final saved = await store.load();
    if (!mounted) return;
    if (saved == null) return;
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
    ));
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
