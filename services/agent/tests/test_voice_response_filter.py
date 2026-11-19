from services.agent.voice.response_filter import (
    COMMAND,
    DIFF,
    IncrementalSpeechFilter,
    LOG,
    PATH,
    SQL,
    contains_code,
    filter_for_speech,
)


def test_fenced_code_is_never_spoken_and_is_announced():
    result = filter_for_speech(
        "I fixed it.\n\n```python\nprint('secret')\n```\n\nTry again."
    )
    assert result.text == "The generated code is on screen. I fixed it. Try again."
    assert result.had_code is True


def test_inline_command_is_replaced_without_reading_arguments():
    result = filter_for_speech("Run `npm install --save-exact` and restart.")
    assert "npm" not in result.text
    assert "install" not in result.text
    assert result.text == "Run the command and restart."


def test_inline_code_is_never_spoken():
    result = filter_for_speech("The value `secret_token` is required.")
    assert "secret_token" not in result.text
    assert result.text == "The value is required."


def test_sql_is_removed():
    result = filter_for_speech("SELECT email, password FROM users WHERE id = 1;")
    assert "SELECT" not in result.text.upper()
    assert "users" not in result.text
    assert result.text == "The query is on screen."
    assert SQL in result.kinds


def test_shell_commands_are_removed():
    result = filter_for_speech("Run this:\n$ rm -rf /tmp/data\nThen check the log.")
    assert "rm -rf" not in result.text
    assert result.text.startswith("The command and its output are on screen.")
    assert COMMAND in result.kinds


def test_stack_trace_and_logs_are_removed():
    result = filter_for_speech(
        "The task failed.\n"
        "Traceback (most recent call last):\n"
        '  File "agent.py", line 42, in run\n'
        "2026-01-01 10:00:00 ERROR boom\n"
        "Please retry."
    )
    assert "Traceback" not in result.text
    assert "agent.py" not in result.text
    assert "ERROR" not in result.text
    assert LOG in result.kinds
    assert "The task failed." in result.text
    assert "Please retry." in result.text


def test_diff_and_patch_are_removed():
    result = filter_for_speech(
        "I applied the change.\n"
        "diff --git a/main.py b/main.py\n"
        "--- a/main.py\n"
        "+++ b/main.py\n"
        "@@ -1 +1 @@\n"
        "-old\n"
        "+new\n"
        "Done."
    )
    assert "diff --git" not in result.text
    assert "-old" not in result.text
    assert result.text.startswith("The changes are on screen.")
    assert DIFF in result.kinds


def test_file_paths_are_replaced():
    result = filter_for_speech("I edited services/agent/main.py and restarted the app.")
    assert "services/agent/main.py" not in result.text
    assert result.text == "I edited the file and restarted the app."
    assert PATH in result.kinds


def test_pure_code_response_gets_a_safe_spoken_fallback():
    result = filter_for_speech("```sql\nDROP TABLE users;\n```")
    assert "DROP" not in result.text
    assert "users" not in result.text
    assert result.text == "The query is on screen."


def test_normal_prose_is_preserved():
    text = "Your alarm is set for seven thirty. Is there anything else?"
    result = filter_for_speech(text)
    assert result.text == text
    assert result.had_code is False


def test_incremental_speech_filter_releases_prose_but_never_partial_code():
    speech_filter = IncrementalSpeechFilter()

    assert speech_filter.feed("Ready. ") == ["Ready."]
    assert speech_filter.feed("Use this: ```python\nprint('secret')\n```\nDone. ") == [
        "Use this:",
        "Done.",
    ]
    assert all("secret" not in text for text in speech_filter.finish())


def test_incremental_speech_filter_holds_unclosed_code_fences():
    speech_filter = IncrementalSpeechFilter()

    assert speech_filter.feed("Do not say ```python\nprint('secret'). ") == []
    assert speech_filter.finish() == []


def test_long_speech_is_truncated_at_a_natural_boundary():
    text = " ".join(["This is a complete sentence."] * 80)
    result = filter_for_speech(text, max_chars=200)
    assert len(result.text) <= 260
    assert result.truncated is True
    assert result.text.endswith("The rest is on screen.")


def test_contains_code_detects_machine_content():
    assert contains_code("```python\nprint(1)\n```")
    assert contains_code("Run `npm test`.")
    assert not contains_code("A normal spoken sentence.")
