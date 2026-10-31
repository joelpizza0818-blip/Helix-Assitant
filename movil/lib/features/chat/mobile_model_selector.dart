import 'package:flutter/material.dart';

enum ModelTier { free, local, cloud }

class MobileModelInfo {
  final String id;
  final String name;
  final String description;
  final String provider;
  final ModelTier tier;
  final String badge;
  final String? note;

  const MobileModelInfo({
    required this.id,
    required this.name,
    required this.description,
    required this.provider,
    required this.tier,
    required this.badge,
    this.note,
  });
}

const List<MobileModelInfo> kMobileModelCatalog = [
  // ── 0-Cost Open-Weight Cloud ─────────────────────────────────────────
  MobileModelInfo(
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B Free',
    description: 'Meta AI · 70B de pesos abiertos a 0 coste',
    provider: 'free',
    tier: ModelTier.free,
    badge: '0-Cost Cloud',
    note: 'Requiere OPENROUTER_API_KEY en Desktop',
  ),
  MobileModelInfo(
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 Free',
    description: 'DeepSeek · Razonamiento profundo a 0 coste',
    provider: 'free',
    tier: ModelTier.free,
    badge: '0-Cost Cloud',
    note: 'Requiere OPENROUTER_API_KEY en Desktop',
  ),
  MobileModelInfo(
    id: 'deepseek/deepseek-chat:free',
    name: 'DeepSeek V3 Free',
    description: 'DeepSeek · Modelo general 671B a 0 coste',
    provider: 'free',
    tier: ModelTier.free,
    badge: '0-Cost Cloud',
    note: 'Requiere OPENROUTER_API_KEY en Desktop',
  ),
  MobileModelInfo(
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen 2.5 Coder 32B Free',
    description: 'Alibaba Qwen · Especialista en código a 0 coste',
    provider: 'free',
    tier: ModelTier.free,
    badge: '0-Cost Cloud',
    note: 'Requiere OPENROUTER_API_KEY en Desktop',
  ),
  MobileModelInfo(
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B Free',
    description: 'Meta AI · Ultra rápido para órdenes directas y control OS',
    provider: 'free',
    tier: ModelTier.free,
    badge: '0-Cost Cloud',
    note: 'Requiere OPENROUTER_API_KEY en Desktop',
  ),
  MobileModelInfo(
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash Free',
    description: 'Google · Multimodal ágil y 1M contexto a 0 coste',
    provider: 'free',
    tier: ModelTier.free,
    badge: '0-Cost Cloud',
    note: 'Requiere OPENROUTER_API_KEY en Desktop',
  ),

  // ── Local PC (Ollama & Llama Server) ─────────────────────────────────
  MobileModelInfo(
    id: 'llama-server/active-model',
    name: 'Llama Server (GGUF)',
    description: 'llama.cpp portable · En :8080 (0-Install, Cero Servicios)',
    provider: 'llama_server',
    tier: ModelTier.local,
    badge: 'Local GGUF',
  ),
  MobileModelInfo(
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B Local',
    description: 'Meta AI · 100% privado en tu PC (~2.0 GB)',
    provider: 'ollama',
    tier: ModelTier.local,
    badge: 'Local PC',
  ),
  MobileModelInfo(
    id: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder 7B Local',
    description: 'Alibaba Qwen · Especialista en código (~4.7 GB)',
    provider: 'ollama',
    tier: ModelTier.local,
    badge: 'Local PC',
  ),
  MobileModelInfo(
    id: 'qwen2.5-coder:1.5b',
    name: 'Qwen 2.5 Coder 1.5B Local',
    description: 'Alibaba Qwen · Código y shell local (~1.0 GB)',
    provider: 'ollama',
    tier: ModelTier.local,
    badge: 'Local PC',
  ),
  MobileModelInfo(
    id: 'deepseek-r1:7b',
    name: 'DeepSeek R1 7B Local',
    description: 'DeepSeek · Razonamiento local (~4.7 GB)',
    provider: 'ollama',
    tier: ModelTier.local,
    badge: 'Local PC',
  ),
  MobileModelInfo(
    id: 'deepseek-r1:1.5b',
    name: 'DeepSeek R1 1.5B Local',
    description: 'DeepSeek · Razonamiento local (~1.1 GB)',
    provider: 'ollama',
    tier: ModelTier.local,
    badge: 'Local PC',
  ),

  // ── Cloud Pro (BYOK) ─────────────────────────────────────────────────
  MobileModelInfo(
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    description: 'Anthropic · Razonamiento híbrido y control OS',
    provider: 'anthropic',
    tier: ModelTier.cloud,
    badge: 'Hybrid',
  ),
  MobileModelInfo(
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    description: 'Anthropic · Razonamiento y visión superior',
    provider: 'anthropic',
    tier: ModelTier.cloud,
    badge: 'BYOK',
  ),
  MobileModelInfo(
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    description: 'Anthropic · Rápido y económico con alta precisión',
    provider: 'anthropic',
    tier: ModelTier.cloud,
    badge: 'BYOK',
  ),
  MobileModelInfo(
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI · Multimodal avanzado',
    provider: 'openai',
    tier: ModelTier.cloud,
    badge: 'BYOK',
  ),

  MobileModelInfo(
    id: 'o3-mini',
    name: 'o3 Mini',
    description: 'OpenAI · Razonamiento STEM y código avanzado',
    provider: 'openai',
    tier: ModelTier.cloud,
    badge: 'Reasoning',
  ),
  MobileModelInfo(
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    description: 'Google AI Studio · Multimodal veloz 1M contexto',
    provider: 'google',
    tier: ModelTier.cloud,
    badge: 'BYOK',
  ),
  MobileModelInfo(
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Groq)',
    description: 'Groq Cloud · Ultra-rápido ~300 T/s (LPU)',
    provider: 'groq',
    tier: ModelTier.cloud,
    badge: 'Groq',
  ),
  MobileModelInfo(
    id: 'deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1 70B (Groq)',
    description: 'Groq Cloud · Razonamiento matemático y código',
    provider: 'groq',
    tier: ModelTier.cloud,
    badge: 'Groq',
  ),
  MobileModelInfo(
    id: 'openrouter/auto',
    name: 'OpenRouter Auto',
    description: 'OpenRouter · Enrutador inteligente al mejor modelo',
    provider: 'openrouter',
    tier: ModelTier.cloud,
    badge: 'OpenRouter',
  ),
];

Future<MobileModelInfo?> showMobileModelSelector(
  BuildContext context, {
  required String currentModelId,
}) =>
    showModalBottomSheet<MobileModelInfo>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF141416),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _ModelSelectorSheet(currentModelId: currentModelId),
    );

class _ModelSelectorSheet extends StatelessWidget {
  final String currentModelId;

  const _ModelSelectorSheet({required this.currentModelId});

  @override
  Widget build(BuildContext context) {
    final freeModels =
        kMobileModelCatalog.where((m) => m.tier == ModelTier.free).toList();
    final localModels =
        kMobileModelCatalog.where((m) => m.tier == ModelTier.local).toList();
    final cloudModels =
        kMobileModelCatalog.where((m) => m.tier == ModelTier.cloud).toList();

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.82,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: const Color(0xFF38383C),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  const Icon(Icons.tune_rounded,
                      color: Color(0xFFEE6018), size: 20),
                  const SizedBox(width: 8),
                  const Text(
                    'Seleccionar Modelo de IA',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close_rounded,
                        color: Color(0xFF8E8E93), size: 20),
                    onPressed: () => Navigator.pop(context),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Expanded(
                child: ListView(
                  children: [
                    _buildSectionHeader(
                      icon: Icons.bolt_rounded,
                      iconColor: const Color(0xFF77D89A),
                      title: 'Open Weight Cloud (0-Cost · OpenRouter)',
                    ),
                    ...freeModels.map((m) => _buildModelTile(context, m)),
                    const SizedBox(height: 12),
                    _buildSectionHeader(
                      icon: Icons.computer_rounded,
                      iconColor: const Color(0xFF64B4F6),
                      title: 'Modelos Locales (Tu PC · Ollama)',
                    ),
                    ...localModels.map((m) => _buildModelTile(context, m)),
                    const SizedBox(height: 12),
                    _buildSectionHeader(
                      icon: Icons.cloud_queue_rounded,
                      iconColor: const Color(0xFFFF914D),
                      title: 'Modelos Nube Pro (Tu API Key · BYOK)',
                    ),
                    ...cloudModels.map((m) => _buildModelTile(context, m)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSectionHeader({
    required IconData icon,
    required Color iconColor,
    required String title,
  }) =>
      Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 6),
        child: Row(
          children: [
            Icon(icon, size: 14, color: iconColor),
            const SizedBox(width: 6),
            Text(
              title,
              style: TextStyle(
                color: iconColor,
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.3,
              ),
            ),
          ],
        ),
      );

  Widget _buildModelTile(BuildContext context, MobileModelInfo model) {
    final isSelected = currentModelId == model.id;

    Color badgeBg;
    Color badgeText;
    switch (model.tier) {
      case ModelTier.free:
        badgeBg = const Color(0x2277D89A);
        badgeText = const Color(0xFF77D89A);
        break;
      case ModelTier.local:
        badgeBg = const Color(0x2264B4F6);
        badgeText = const Color(0xFF64B4F6);
        break;
      case ModelTier.cloud:
        badgeBg = const Color(0x22FF914D);
        badgeText = const Color(0xFFFF914D);
        break;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        color: isSelected
            ? const Color(0xFF24201D)
            : const Color(0xFF1C1C1E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isSelected
              ? const Color(0xFFEE6018)
              : const Color(0xFF2C2C2E),
          width: isSelected ? 1.4 : 1.0,
        ),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
        title: Row(
          children: [
            Text(
              model.name,
              style: TextStyle(
                color: isSelected ? const Color(0xFFFF914D) : Colors.white,
                fontSize: 14,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: badgeBg,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                model.badge,
                style: TextStyle(
                  color: badgeText,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text(
            model.description,
            style: const TextStyle(
              color: Color(0xFF8E8E93),
              fontSize: 12,
            ),
          ),
        ),
        trailing: isSelected
            ? const Icon(Icons.check_circle_rounded,
                color: Color(0xFFEE6018), size: 20)
            : null,
        onTap: () => Navigator.pop(context, model),
      ),
    );
  }
}
