from services.agent.voice.confirmation_intents import (
    ConfirmationDecision,
    parse_confirmation_intent,
)


def decision(text):
    return parse_confirmation_intent(text).decision


def test_explicit_approvals_are_recognized_in_english_and_spanish():
    for text in (
        "yes",
        "Yes, please.",
        "go ahead",
        "do it",
        "I approve",
        "sí",
        "claro",
        "adelante",
        "hazlo",
        "vale, adelante",
        "de acuerdo, hazlo",
        "That sounds good",
        "That sounds fine to me",
        "I'd be happy with that",
        "Works for me",
        "I'm comfortable with that",
        "me parece bien",
        "me parece estupendo",
        "por mí está bien",
    ):
        assert decision(text) is ConfirmationDecision.APPROVE, text


def test_explicit_rejections_are_recognized():
    for text in (
        "no",
        "nope",
        "cancel",
        "stop",
        "don't do it",
        "no lo hagas",
        "cancela",
        "mejor no",
        "detente",
        "I'd rather not",
        "That doesn't work for me",
        "Doesn't work for me",
        "I'd prefer not",
        "No me parece bien",
        "prefiero que no",
        "no estoy de acuerdo",
    ):
        assert decision(text) is ConfirmationDecision.REJECT, text


def test_bare_acknowledgements_are_ambiguous_not_approval():
    for text in ("ok", "okay", "vale", "perfecto", "esta bien", "dale"):
        assert decision(text) is ConfirmationDecision.AMBIGUOUS, text


def test_hedges_questions_and_silence_never_approve():
    for text in (
        "",
        "maybe",
        "quizás",
        "no sé",
        "no estoy seguro",
        "what will change?",
        "¿qué va a cambiar?",
        "why do you need that?",
        "si quieres",
    ):
        assert decision(text) is not ConfirmationDecision.APPROVE, text


def test_make_sure_is_not_treated_as_sure():
    assert decision("make sure the folder exists") is ConfirmationDecision.NONE


def test_modification_extracts_instructions():
    intent = parse_confirmation_intent("change the folder to Documents")
    assert intent.decision is ConfirmationDecision.MODIFY
    assert "Documents" in intent.instructions

    spanish = parse_confirmation_intent("mejor cambia la carpeta a Documentos")
    assert spanish.decision is ConfirmationDecision.MODIFY
    assert "Documentos" in spanish.instructions


def test_wait_is_a_deferral_not_an_approval():
    intent = parse_confirmation_intent("wait")
    assert intent.decision is ConfirmationDecision.AMBIGUOUS
    assert "let me know" in intent.message.lower()


def test_ambiguous_replies_get_natural_guidance_without_fixed_words():
    english = parse_confirmation_intent("maybe")
    spanish = parse_confirmation_intent("quizás")
    assert english.decision is ConfirmationDecision.AMBIGUOUS
    assert "comfortable" in english.message.lower()
    assert "yes or no" not in english.message.lower()
    assert spanish.decision is ConfirmationDecision.AMBIGUOUS
    assert "te parece bien" in spanish.message.lower()


def test_conflicting_reply_is_ambiguous():
    assert decision("yes, but no") is ConfirmationDecision.AMBIGUOUS
    assert decision("no, do it") is ConfirmationDecision.AMBIGUOUS


def test_unrelated_text_is_not_a_confirmation():
    assert decision("What is the weather today?") is ConfirmationDecision.NONE
    assert decision("Open the browser and search for cats") is ConfirmationDecision.NONE
