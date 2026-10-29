class MobileSkill {
  const MobileSkill({required this.name, required this.description});

  final String name;
  final String description;

  factory MobileSkill.fromJson(Map<String, dynamic> json) {
    final name = json['name'];
    final description = json['description'];
    if (name is! String || !RegExp(r'^[A-Za-z0-9_.-]{1,80}$').hasMatch(name)) {
      throw const FormatException('HELIX returned an invalid skill name.');
    }
    if (description is! String) {
      throw const FormatException(
          'HELIX returned an invalid skill description.');
    }
    return MobileSkill(
      name: name,
      description: description.length > 500
          ? description.substring(0, 500)
          : description,
    );
  }
}

class ActiveSkillMention {
  const ActiveSkillMention({
    required this.query,
    required this.start,
    required this.end,
  });

  final String query;
  final int start;
  final int end;
}

ActiveSkillMention? findActiveSkillMention(
  String text, {
  required int caretPosition,
}) {
  if (caretPosition < 0 || caretPosition > text.length) return null;
  final beforeCaret = text.substring(0, caretPosition);
  final match = RegExp(r'(^|\s)@([A-Za-z0-9_.-]*)$').firstMatch(beforeCaret);
  if (match == null) return null;
  final start =
      beforeCaret.length - match.group(0)!.length + match.group(1)!.length;
  return ActiveSkillMention(
    query: match.group(2)!,
    start: start,
    end: caretPosition,
  );
}

List<MobileSkill> filterMobileSkills(
  List<MobileSkill> skills,
  ActiveSkillMention mention,
) {
  final query = mention.query.toLowerCase();
  return skills
      .where((skill) => skill.name.toLowerCase().contains(query))
      .toList(growable: false);
}

String replaceActiveSkillMention(
  String text,
  ActiveSkillMention mention,
  MobileSkill skill,
) {
  final suffix = text.substring(mention.end);
  final token = '@${skill.name}';
  final spacing = suffix.startsWith(' ') ? '' : ' ';
  return '${text.substring(0, mention.start)}$token$spacing$suffix';
}
