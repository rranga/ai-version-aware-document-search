import re
import streamlit as st
from core.session_manager import append_message, initialize_session


def clean_input(text: str) -> str:
    """Remove HTML tags and leading/trailing spaces from user input."""
    if not text:
        return ""
    # Remove HTML tags such as <div>, <br>, <p>, etc.
    cleaned = re.sub(r"<.*?>", "", text)
    # Replace multiple spaces/newlines with single space
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def render_chat(retrieval_chain):
    initialize_session()

    # Get user input and sanitize it
    raw_input = st.chat_input("Search from your documents", key="chat_input_main")
    user_input = clean_input(raw_input)

    if user_input:
        append_message("user", user_input)
        st.session_state.is_thinking = True
        st.rerun()

    # Render chat history
    for role, message in st.session_state.chat_history:
        align = "flex-end" if role == "user" else "flex-start"
        st.markdown(
            f"""
            <div style="display: flex; justify-content: {align}; margin: 5px 0;">
                <div style="
                    background: inherit;
                    color: inherit;
                    padding: 10px 15px;
                    border-radius: 15px;
                    word-wrap: break-word;
                    max-width: 70%;
                    box-shadow: 0 0 2px #dedede;
                    text-align: left;">
                    {message}
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    # Thinking spinner and response generation
    if st.session_state.is_thinking:
        with st.spinner("🤔 Thinking..."):
            try:
                last_user_message = st.session_state.chat_history[-1][1]
                response = retrieval_chain.invoke(last_user_message)
                bot_reply = response if isinstance(response, str) else str(response)
            except Exception as e:
                bot_reply = f"Error: {str(e)}"

        append_message("assistant", bot_reply)
        st.session_state.is_thinking = False
        st.rerun()
