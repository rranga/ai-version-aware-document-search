import streamlit as st
from core.session_manager import clear_chat

def render_sidebar():
    # Initialize session state only for new_chat_clicked
    if "new_chat_clicked" not in st.session_state:
        st.session_state.new_chat_clicked = False

    st.markdown("""
        <style>
        /* 🌗 ChatGPT-style New Chat button */
        .chatgpt-new-chat {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 10px;
            width: 100%;
            padding: 0.6rem 0.9rem;
            margin-top: 0.4rem;
            border-radius: 10px;
            font-size: 0.95rem;
            font-weight: 500;
            color: inherit;
            background-color: transparent;
            cursor: pointer;
            border: none;
            transition: background-color 0.2s ease-in-out, transform 0.1s ease-in-out;
        }

        @media (prefers-color-scheme: light) {
            .chatgpt-new-chat:hover { background-color: #ececec; }
        }
        @media (prefers-color-scheme: dark) {
            .chatgpt-new-chat:hover { background-color: #2a2b32; }
        }

        .chatgpt-new-chat:active {
            transform: scale(0.98);
        }

        .chatgpt-new-chat svg {
            stroke: currentColor;
        }

        /* Sidebar title */
        div[data-testid="stSidebar"] h3 {
            margin-bottom: 0.6rem;
            padding-left: 0.2rem;
        }

        /* 🌈 ChatGPT-style select box (mimics theme colors) */
        .chatgpt-selectbox {
            appearance: none;
            width: 100%;
            padding: 0.6rem 0.9rem;
            border-radius: 10px;
            border: 1px solid rgba(128, 128, 128, 0.3);
            background-color: transparent;
            color: inherit;
            font-size: 0.95rem;
            cursor: pointer;
            transition: background-color 0.2s ease, border-color 0.2s ease;
        }

        @media (prefers-color-scheme: light) {
            .chatgpt-selectbox:hover { background-color: #ececec; }
        }
        @media (prefers-color-scheme: dark) {
            .chatgpt-selectbox:hover { background-color: #2a2b32; }
        }

        .chatgpt-selectbox:focus {
            outline: none;
            border-color: rgba(0, 122, 255, 0.5);
            box-shadow: 0 0 0 1px rgba(0, 122, 255, 0.4);
        }

        /* 📂 ChatGPT-style expander (upload docs) */
        div[data-testid="stExpander"] {
            border-radius: 10px !important;
            margin-top: 1rem !important;
            border: 1px solid rgba(128, 128, 128, 0.3);
            transition: background-color 0.2s ease, border-color 0.2s ease;
        }

        @media (prefers-color-scheme: light) {
            div[data-testid="stExpander"]:hover { background-color: #f3f3f3; }
        }
        @media (prefers-color-scheme: dark) {
            div[data-testid="stExpander"]:hover { background-color: #2a2b32; }
        }

        div[data-testid="stExpander"] div[role="button"] {
            font-weight: 500 !important;
            font-size: 0.95rem !important;
            padding: 0.6rem 0.9rem !important;
        }

        div[data-testid="stFileUploader"] {
            padding: 0.5rem 0.9rem !important;
        }
        </style>
    """, unsafe_allow_html=True)

    with st.sidebar:
        st.markdown("### 🌍 Aavanam Thedal")

        # 🆕 New Chat Button
        button_html = """
            <form action="#" method="get">
                <button class="chatgpt-new-chat" name="new_chat_btn" type="submit">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                    New Chat
                </button>
            </form>
        """
        st.markdown(button_html, unsafe_allow_html=True)

        # ✅ Handle new chat button click
        query_params = st.query_params
        if "new_chat_btn" in query_params and not st.session_state.new_chat_clicked:
            st.session_state.new_chat_clicked = True
            clear_chat()

        # 📂 Upload Section (ChatGPT-style expander)
        with st.expander("📂 Upload Documents"):
            uploaded_files = st.file_uploader(
                "Upload .pdf, .docx, or .txt files",
                accept_multiple_files=True,
                type=["pdf", "docx", "txt"]
            )

        # ⚙️ Model selection (no manual st.session_state overwrite)
        st.markdown("#### ⚙️ Model Selection")
        model_choice = st.selectbox(
            "Model",
            ["llama3", "mistral", "gemma", "codellama"],
            index=1,  # default to mistral
            key="selected_model",  # Streamlit manages it automatically
            label_visibility="collapsed",
        )

        st.markdown("💡 All models run locally via Ollama — no API key needed.")

    return uploaded_files, model_choice
