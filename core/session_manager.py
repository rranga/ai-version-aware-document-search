import streamlit as st

def initialize_session():
    """Initialize Streamlit session state variables."""
    if "chat_history" not in st.session_state:
        st.session_state.chat_history = []
    if "is_thinking" not in st.session_state:
        st.session_state.is_thinking = False
    if "retriever_ready" not in st.session_state:
        st.session_state.retriever_ready = False

def clear_chat():
    """Reset chat history and rerun."""
    st.session_state.chat_history = []
    st.session_state.is_thinking = False
    st.rerun()

def append_message(role, message):
    """Append a message to chat history."""
    st.session_state.chat_history.append((role, message))
