import 'package:flutter/material.dart';

import '../../core/session/helix_session.dart';

class MobileSubagentsPanel extends StatefulWidget {
  const MobileSubagentsPanel({
    required this.session,
    super.key,
  });

  final HelixSession? session;

  @override
  State<MobileSubagentsPanel> createState() => _MobileSubagentsPanelState();
}

class _MobileSubagentsPanelState extends State<MobileSubagentsPanel> {
  late Future<_SubagentSnapshot> _snapshot;

  @override
  void initState() {
    super.initState();
    _snapshot = _load();
  }

  @override
  void didUpdateWidget(covariant MobileSubagentsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session != widget.session) _snapshot = _load();
  }

  Future<_SubagentSnapshot> _load() async {
    final session = widget.session;
    if (session == null) {
      throw StateError('Conecta un Desktop para ver sus subagentes.');
    }
    final values = await Future.wait([
      session.requestSubagents('list_profiles'),
      session.requestSubagents('get_status'),
    ]);
    return _SubagentSnapshot(
      _records(values[0]['items']),
      _records(values[1]['items']),
    );
  }

  List<Map<String, dynamic>> _records(Object? value) {
    if (value is! List) return const [];
    return value
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
  }

  Future<void> _refresh() async {
    setState(() => _snapshot = _load());
    await _snapshot;
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<_SubagentSnapshot>(
        future: _snapshot,
        builder: (context, result) {
          if (result.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.groups_outlined,
                        size: 38, color: Color(0xFFEE6018)),
                    const SizedBox(height: 12),
                    Text(
                      result.error.toString(),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Color(0xFFB9BDC2)),
                    ),
                    const SizedBox(height: 14),
                    OutlinedButton.icon(
                      onPressed: _refresh,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Reintentar'),
                    ),
                  ],
                ),
              ),
            );
          }
          if (!result.hasData) {
            return const Center(
              child: CircularProgressIndicator(color: Color(0xFFEE6018)),
            );
          }
          final snapshot = result.data!;
          return RefreshIndicator(
            onRefresh: _refresh,
            color: const Color(0xFFEE6018),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(children: [
                  const Expanded(
                    child: Text(
                      'Subagentes',
                      style:
                          TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Actualizar estado',
                    onPressed: _refresh,
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                ]),
                const Text(
                  'Perfiles, actividad y chat directo del Desktop seleccionado.',
                  style: TextStyle(color: Color(0xFF85898E)),
                ),
                const SizedBox(height: 16),
                if (snapshot.profiles.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 32),
                    child: Text(
                      'Este Desktop no devolvió perfiles de subagentes.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Color(0xFF85898E)),
                    ),
                  ),
                for (final profile in snapshot.profiles)
                  _ProfileCard(
                    profile: profile,
                    statuses: snapshot.statuses,
                    onChat: () => _openChat(profile),
                  ),
                const SizedBox(height: 12),
                const Text(
                  'Desliza hacia abajo para actualizar el progreso.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Color(0xFF777B80), fontSize: 12),
                ),
              ],
            ),
          );
        },
      );

  Future<void> _openChat(Map<String, dynamic> profile) async {
    final session = widget.session;
    final id = profile['profile_id'];
    if (session == null || id is! String) return;
    await showDialog<void>(
      context: context,
      builder: (_) => _SubagentChatDialog(
        session: session,
        profileId: id,
        name: profile['name'] is String ? profile['name'] as String : id,
      ),
    );
  }
}

class _SubagentSnapshot {
  const _SubagentSnapshot(this.profiles, this.statuses);

  final List<Map<String, dynamic>> profiles;
  final List<Map<String, dynamic>> statuses;
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({
    required this.profile,
    required this.statuses,
    required this.onChat,
  });

  final Map<String, dynamic> profile;
  final List<Map<String, dynamic>> statuses;
  final VoidCallback onChat;

  @override
  Widget build(BuildContext context) {
    final id = profile['profile_id'];
    Map<String, dynamic>? status;
    for (final item in statuses) {
      if (item['profile_id'] == id &&
          item['status'] is String &&
          !{'completed', 'failed', 'cancelled'}.contains(item['status'])) {
        status = item;
        break;
      }
    }
    final colorValue = profile['color'];
    final color = colorValue is String &&
            RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(colorValue)
        ? Color(int.parse(colorValue.substring(1), radix: 16) | 0xFF000000)
        : const Color(0xFFEE6018);
    final name =
        profile['name'] is String ? profile['name'] as String : 'Subagente';
    final role = profile['role'] is String ? profile['role'] as String : '';
    final description = profile['description'] is String
        ? profile['description'] as String
        : '';
    final progress = status?['current_action'];
    return Card(
      color: const Color(0xFF1D1A18),
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            CircleAvatar(
              radius: 7,
              backgroundColor: color,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(name,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
            IconButton(
              tooltip: 'Chat con $name',
              onPressed: onChat,
              icon: const Icon(Icons.chat_bubble_outline_rounded),
            ),
          ]),
          Text(role,
              style: const TextStyle(color: Color(0xFFEE6018), fontSize: 12)),
          if (description.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(description, style: const TextStyle(color: Color(0xFFB9BDC2))),
          ],
          if (status != null) ...[
            const SizedBox(height: 10),
            Row(children: [
              const Icon(Icons.sync_rounded,
                  size: 15, color: Color(0xFF77D89A)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  progress is String ? progress : 'En ejecución',
                  style:
                      const TextStyle(color: Color(0xFF77D89A), fontSize: 12),
                ),
              ),
              if (status['progress'] is num)
                Text(
                  '${(status['progress'] as num).round()}%',
                  style:
                      const TextStyle(color: Color(0xFF85898E), fontSize: 12),
                ),
            ]),
          ],
        ]),
      ),
    );
  }
}

class _SubagentChatDialog extends StatefulWidget {
  const _SubagentChatDialog({
    required this.session,
    required this.profileId,
    required this.name,
  });

  final HelixSession session;
  final String profileId;
  final String name;

  @override
  State<_SubagentChatDialog> createState() => _SubagentChatDialogState();
}

class _SubagentChatDialogState extends State<_SubagentChatDialog> {
  final _input = TextEditingController();
  final _messages = <(String, bool)>[];
  bool _sending = false;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() {
      _messages.add((text, true));
      _input.clear();
      _sending = true;
    });
    try {
      final result = await widget.session.requestSubagents(
        'chat',
        profileId: widget.profileId,
        message: text,
      );
      final response = result['response'];
      if (response is! String) {
        throw const FormatException(
            'HELIX devolvió una respuesta de subagente inválida.');
      }
      if (mounted) setState(() => _messages.add((response, false)));
    } on Object catch (error) {
      if (mounted) setState(() => _messages.add((error.toString(), false)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        backgroundColor: const Color(0xFF1D1A18),
        title: Text('Chat · ${widget.name}'),
        content: SizedBox(
          width: 420,
          height: 420,
          child: Column(children: [
            Expanded(
              child: ListView.builder(
                itemCount: _messages.length + (_sending ? 1 : 0),
                itemBuilder: (_, index) {
                  if (index == _messages.length) {
                    return const Padding(
                      padding: EdgeInsets.all(8),
                      child: LinearProgressIndicator(color: Color(0xFFEE6018)),
                    );
                  }
                  final (text, mine) = _messages[index];
                  return Align(
                    alignment:
                        mine ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: mine
                            ? const Color(0xFF55301F)
                            : const Color(0xFF29292D),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: SelectableText(text),
                    ),
                  );
                },
              ),
            ),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  enabled: !_sending,
                  minLines: 1,
                  maxLines: 3,
                  decoration:
                      const InputDecoration(hintText: 'Escribe al subagente'),
                  onSubmitted: (_) => _send(),
                ),
              ),
              IconButton(
                onPressed: _sending ? null : _send,
                icon: const Icon(Icons.send_rounded, color: Color(0xFFEE6018)),
              ),
            ]),
          ]),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cerrar'),
          ),
        ],
      );
}
