"""
Shared RAG+LLM conversation engine — used by both voice calls and chat widget.
Extracted from CallHandler to enable reuse across session types.
"""
import os
import time
from typing import Optional

import openai
from opentelemetry import trace

from agent import rag
from agent.prompts import build_system_prompt, build_chat_system_prompt, TRANSFER_ANNOUNCEMENT

tracer = trace.get_tracer("va-platform.conversation")


class ConversationEngine:
    """Stateful RAG conversation engine for a single session (call or chat)."""

    def __init__(
        self,
        business_id: str,
        session_id: str,
        session_type: str = "call",  # "call" or "chat"
    ):
        self.business_id = business_id
        self.session_id = session_id
        self.session_type = session_type
        self.conversation_history: list[dict] = []
        self.turn_index = 0
        self.same_question_count = 0
        self.last_question: Optional[str] = None

    def load_history(self, messages: list[dict]) -> None:
        """Load prior conversation history (e.g., from chat_messages table)."""
        self.conversation_history = list(messages)
        self.turn_index = len(messages) // 2  # each turn = user + assistant

    def _should_transfer(self, utterance: str, transfer_phrases: list[str]) -> bool:
        """Transfer if: phrase match, or same question 3x in a row."""
        utt_lower = utterance.lower()
        for phrase in (transfer_phrases or []):
            if phrase.lower() in utt_lower:
                return True

        if utterance == self.last_question:
            self.same_question_count += 1
        else:
            self.same_question_count = 1
            self.last_question = utterance

        return self.same_question_count >= 3

    async def respond(self, db, utterance: str, business: dict) -> tuple[str, dict]:
        """
        Process one utterance and return (answer, usage_info).
        usage_info contains: model, prompt_tokens, completion_tokens, ttft_ms
        """
        with tracer.start_as_current_span("conversation.respond") as span:
            start = time.time()

            # Transfer trigger check
            transfer_phrases = business.get("transfer_trigger_phrases") or []
            if self._should_transfer(utterance, transfer_phrases):
                return TRANSFER_ANNOUNCEMENT, {
                    "model": "",
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "ttft_ms": 0,
                    "transferred": True,
                }

            # Feature flag: reranker
            flag_row = await db.fetchrow(
                "SELECT enabled FROM business_feature_flags WHERE business_id=$1 AND flag='enable_reranker'",
                self.business_id,
            )
            use_reranker = bool(flag_row and flag_row["enabled"])

            # RAG retrieval
            chunks = await rag.retrieve(
                db=db,
                business_id=self.business_id,
                utterance=utterance,
                semantic_weight=float(business.get("rag_semantic_weight", 0.7)),
                use_reranker=use_reranker,
            )

            context_texts = [c["content"] for c in chunks]

            # Build appropriate system prompt based on session type
            if self.session_type == "chat":
                system_prompt = build_chat_system_prompt(
                    business_name=business["name"],
                    persona=business["persona"],
                    context_chunks=context_texts,
                )
            else:
                system_prompt = build_system_prompt(
                    business_name=business["name"],
                    persona=business["persona"],
                    context_chunks=context_texts,
                )

            # Last 5 turns of history (10 messages)
            messages = [{"role": "system", "content": system_prompt}]
            messages += self.conversation_history[-10:]
            messages.append({"role": "user", "content": utterance})

            client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
            model = os.environ.get("LLM_MODEL", "gpt-4o-mini")

            with tracer.start_as_current_span("llm.generate") as llm_span:
                response = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=200,
                    temperature=0.3,
                )
                llm_span.set_attribute("model", model)

            answer = response.choices[0].message.content or ""
            usage = response.usage

            ttft_ms = (time.time() - start) * 1000
            span.set_attribute("ttft_ms", ttft_ms)
            span.set_attribute("session_type", self.session_type)
            if ttft_ms > 800:
                span.set_attribute("ttft_exceeded_target", True)

            # Update conversation history
            self.conversation_history.append({"role": "user", "content": utterance})
            self.conversation_history.append({"role": "assistant", "content": answer})

            prompt_tokens = usage.prompt_tokens if usage else 0
            completion_tokens = usage.completion_tokens if usage else 0

            # Write retrieval audit — route to correct session column
            audit_kwargs = {
                "db": db,
                "turn_index": self.turn_index,
                "utterance": utterance,
                "chunks": chunks,
                "model_used": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            }
            if self.session_type == "chat":
                audit_kwargs["call_log_id"] = None
                audit_kwargs["chat_session_id"] = self.session_id
            else:
                audit_kwargs["call_log_id"] = self.session_id
                audit_kwargs["chat_session_id"] = None

            await rag.write_retrieval_audit(**audit_kwargs)
            self.turn_index += 1

            usage_info = {
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "ttft_ms": ttft_ms,
                "transferred": False,
            }

            return answer, usage_info
