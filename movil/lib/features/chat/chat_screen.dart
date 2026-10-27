import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../../app/helix_mark.dart';
import '../../core/config/mobile_config.dart';
import '../../core/models/protocol_message.dart';
import '../../core/session/mobile_connection.dart';
import '../../core/security/secure_pairing_store.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final _messages = <_Message>[];
  final _connection = MobileConnection();
  final _pairingStore = const SecurePairingStore();
  StreamSubscription<HelixMessage>? _events;
  bool _connected = false;
  bool _connecting = false;
  int _tab = 0;
  bool _voiceMode = false;
  bool _hasInputText = false;
  String? _connectionError;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() {
      final hasText = _controller.text.trim().isNotEmpty;
      if (hasText != _hasInputText) {
        setState(() => _hasInputText = hasText);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    _events?.cancel();
    _connection.close();
    super.dispose();
  }

  Future<void> _toggleConnection() async {
    if (_connected) {
      _events?.cancel();
      await _connection.close();
      if (mounted) setState(() => _connected = false);
      return;
    }
    final draft = await showModalBottomSheet<_ConnectionDraft>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF101010),
      builder: (_) => const _ConnectionSheet(),
    );
    if (draft == null || !mounted) return;
    setState(() => _connecting = true);
    if (!mounted) return;
    try {
      final session = await _connection.connect(draft.config, draft.token);
      await _pairingStore.save(
        token: draft.token,
        identityKeyPem: draft.config.desktop.identityKeyPem,
        hostKeyFingerprint: draft.config.desktop.hostKeyFingerprint,
      );
      _events = session.events.listen((event) {
        final text = event.payload['text'] ??
            event.payload['content'] ??
            event.payload['message'];
        if (!mounted || text is! String || text.isEmpty) return;
        setState(() => _messages.add(_Message(text, false)));
        _scrollToBottom();
      });
      setState(() {
        _connecting = false;
        _connected = true;
      });
    } on Object catch (e) {
      await _connection.close();
      if (mounted) {
        setState(() {
          _connecting = false;
          _connectionError = e is UnsupportedError
              ? 'La conexión móvil requiere la app nativa; la versión web solo permite previsualizar la interfaz.'
              : e.toString().contains('TimeoutException')
                  ? 'Tiempo de espera agotado. Verifica que el relay esté activo.'
                  : 'No se pudo conectar. Revisa el token y la URL del relay.';
        });
        Future.delayed(const Duration(seconds: 6), () {
          if (mounted) setState(() => _connectionError = null);
        });
      }
    }
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
        centerTitle: true,
        titleSpacing: 0,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const HelixMark(size: 22),
            const SizedBox(width: 8),
            Text(
              'HELIX',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                letterSpacing: 1.5,
                fontSize: 16,
              ),
            ),
          ],
        ),
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
                        const SizedBox(width: 10),
                        Text('HELIX',
                            style: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w800, letterSpacing: 2)),
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
                          icon: _connected ? Icons.link_off_rounded : Icons.link_rounded,
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
                child: const Icon(Icons.bolt_rounded,
                    color: Color(0xFFEE6018), size: 30),
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
                  style: TextStyle(color: Color(0xFF85898E), height: 1.45, fontSize: 14)),
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
        itemCount: _messages.length,
        itemBuilder: (_, i) => _Bubble(message: _messages[i]));
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
          if (_connectionError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0x22FF453A),
                  border: Border.all(color: const Color(0x66FF453A)),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(children: [
                  const Icon(Icons.error_outline_rounded, color: Color(0xFFFF6B6B), size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_connectionError!,
                        style: const TextStyle(color: Color(0xFFFF6B6B), fontSize: 12)),
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
                              content: Text('Atajo rápido: puedes pedir capturas o comandos al Desktop.'),
                            ),
                          );
                        }
                      : null,
                  icon: Icon(
                    Icons.add_rounded,
                    color: _connected ? const Color(0xFF98989E) : const Color(0xFF48484A),
                    size: 22,
                  ),
                  splashRadius: 20,
                  constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
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
                      hintText: _connected ? 'Pregunta a HELIX...' : 'Conecta tu Desktop para chatear',
                      hintStyle: const TextStyle(color: Color(0xFF68686E), fontSize: 14.5),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      filled: false,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
                    ),
                  ),
                ),
                if (!_hasInputText)
                  IconButton(
                    tooltip: _voiceMode ? 'Modo texto' : 'Modo voz',
                    onPressed: () => setState(() => _voiceMode = !_voiceMode),
                    icon: Icon(
                      _voiceMode ? Icons.chat_bubble_outline_rounded : Icons.graphic_eq_rounded,
                      color: _voiceMode ? const Color(0xFFEE6018) : const Color(0xFF8E8E93),
                      size: 20,
                    ),
                    splashRadius: 20,
                    constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
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
  // Relay is preferred for production; SSH remains the local fallback.
  MobileTransportMode _mode = MobileTransportMode.relay;

  @override
  void initState() {
    super.initState();
    _restoreSecrets();
  }

  Future<void> _restoreSecrets() async {
    const store = SecurePairingStore();
    final values = await Future.wait<String?>([
      store.token(),
      store.identityKeyPem(),
      store.hostKeyFingerprint(),
    ]);
    if (!mounted) return;
    if (values[0] != null) _token.text = values[0]!;
    if (values[1] != null) _key.text = values[1]!;
    if (values[2] != null) _fingerprint.text = values[2]!;
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
    try {
      final value = jsonDecode(raw);
      if (value is! Map<String, dynamic> ||
          value['host'] is! String ||
          value['token'] is! String) {
        throw const FormatException('Formato de invitación inválido');
      }
      _host.text = value['host'] as String;
      _token.text = value['token'] as String;
      // Desktop invitations currently describe the SSH fallback. A relay URL,
      // when provisioned, is imported as the preferred transport instead.
      final relay = value['relayWssUrl'];
      if (relay is String && relay.isNotEmpty) {
        _mode = MobileTransportMode.relay;
        _host.text = relay;
      } else {
        _mode = MobileTransportMode.sshTunnel;
      }
      if (value['sshPort'] is int) {
        _sshPort.text = '${value['sshPort']}';
      }
      if (value['remoteWsPort'] is int) {
        _remoteWsPort.text = '${value['remoteWsPort']}';
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text(
                'Invitación importada. Completa usuario, clave y huella SSH.')));
      }
    } on Object catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('La invitación no tiene un formato válido.')));
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
              onPressed: _importInvitation,
              icon: const Icon(Icons.content_paste_go_rounded),
              label: const Text('Pegar invitación de Toolbox')),
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
            color: const Color(0xFF2C2C2E),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(message.text,
              style: const TextStyle(fontSize: 15, height: 1.4, color: Colors.white)),
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
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Icon(Icons.bolt_rounded, color: Color(0xFFEE6018), size: 16),
          ),
          Expanded(
            child: Container(
              margin: const EdgeInsets.only(bottom: 8, right: 40),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              child: Text(message.text,
                  style: const TextStyle(fontSize: 15, height: 1.45, color: Colors.white)),
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
          color: const Color(0xFF121416),
          border: Border.all(color: const Color(0xFF292C2F)),
          borderRadius: BorderRadius.circular(6)),
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
            color: const Color(0xFF1C1C1E),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFF3A3A3C)),
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
