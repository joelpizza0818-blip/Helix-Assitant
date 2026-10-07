from typing import List, Dict

try:
    from services.agent.ai.base_provider import ChatMessage
except ImportError:
    pass

class ContextManager:
    def __init__(self, max_tokens: int = 100000):
        self.max_tokens = max_tokens
        self._conversations: Dict[str, List['ChatMessage']] = {}

    def add_message(self, conversation_id: str, message: 'ChatMessage'):
        if conversation_id not in self._conversations:
            self._conversations[conversation_id] = []
        self._conversations[conversation_id].append(message)

    def get_messages(self, conversation_id: str) -> List['ChatMessage']:
        return self._conversations.get(conversation_id, [])

    def get_system_prompt(self, role: str, skills: List[str] = None) -> str:
        prompt = f"You are an AI agent fulfilling the role of: {role}.\n"
        if skills:
            prompt += f"You have the following skills: {', '.join(skills)}.\n"
        prompt += "Use your tools to accomplish tasks efficiently."
        return prompt

    async def compress_if_needed(self, conversation_id: str, provider_fn):
        messages = self.get_messages(conversation_id)
        if len(messages) > 50:
            sys_msg = ChatMessage(role="system", content="Summarize the conversation so far.")
            summary_resp = await provider_fn([sys_msg] + messages[:-20])
            summary_msg = ChatMessage(role="system", content=f"Conversation summary: {summary_resp.content}")
            self._conversations[conversation_id] = [summary_msg] + messages[-20:]

    def clear(self, conversation_id: str):
        if conversation_id in self._conversations:
            self._conversations[conversation_id] = []

    def fork(self, conversation_id: str, new_id: str):
        if conversation_id in self._conversations:
            self._conversations[new_id] = list(self._conversations[conversation_id])
