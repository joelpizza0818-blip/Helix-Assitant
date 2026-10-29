import 'package:flutter_test/flutter_test.dart';
import 'package:helix_mobile/features/chat/mobile_skill_mentions.dart';

void main() {
  test('finds an @ skill query at the caret and filters case-insensitively',
      () {
    const text = 'Please use @Res';
    final mention = findActiveSkillMention(
      text,
      caretPosition: text.length,
    );

    expect(mention, isNotNull);
    expect(mention!.query, 'Res');
    expect(
      filterMobileSkills(
        const [
          MobileSkill(name: 'research', description: 'Research a topic'),
          MobileSkill(name: 'browser', description: 'Browse the web'),
        ],
        mention,
      ).map((skill) => skill.name),
      ['research'],
    );
  });

  test('replaces the mention and leaves a separating space', () {
    const text = 'Try @rese now';
    final mention = findActiveSkillMention(
      text,
      caretPosition: 9,
    )!;

    expect(
      replaceActiveSkillMention(
        text,
        mention,
        const MobileSkill(name: 'research', description: ''),
      ),
      'Try @research now',
    );
  });

  test('does not match an @ token embedded in a word', () {
    expect(
      findActiveSkillMention('email@research', caretPosition: 14),
      isNull,
    );
  });
}
