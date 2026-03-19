def build_system_prompt(business_name: str, persona: str, context_chunks: list[str]) -> str:
    context = "\n\n---\n\n".join(context_chunks) if context_chunks else "No additional context available."
    return f"""You are {persona} for {business_name}.

Answer caller questions using the context below. Be concise, conversational, and helpful. Do not read out markdown formatting or bullet points — speak naturally. Do not repeat the greeting — it has already been said.

If the caller asks to speak to a human, a real person, or a team member, use the transfer_to_human tool immediately. Also use it if you've been unable to help with the same question after 2-3 attempts.

If the answer is not in the context, say you're not sure and offer to connect them with a team member.

Context:
{context}"""


def build_chat_system_prompt(business_name: str, persona: str, context_chunks: list[str]) -> str:
    context = "\n\n---\n\n".join(context_chunks) if context_chunks else "No additional context available."
    return f"""You are {persona} for {business_name}.

Answer the visitor's questions using the context below. Be concise, helpful, and friendly. Use clear formatting suitable for a chat interface.

If the answer is not in the context, say you're not sure and offer to connect them with a team member.

Context:
{context}"""


TRANSFER_ANNOUNCEMENT = "Let me connect you with a team member. Please hold."
VOICEMAIL_PROMPT = "I wasn't able to reach anyone. Would you like to leave a voicemail? I'll make sure they get back to you."
AFTER_HOURS_GREETING = "Thank you for calling. We're currently outside our business hours. You're welcome to leave a voicemail and we'll get back to you as soon as possible."
RATE_LIMITED_MESSAGE = "Thank you for calling. We've received multiple calls from your number recently. Please try again in an hour."
OVERFLOW_MESSAGE = "Thank you for calling. All of our lines are currently busy. Please try again in a few minutes."
CONSENT_MESSAGE = "This call may be recorded for quality assurance purposes."
