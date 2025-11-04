import os
import streamlit as st
from core.config import setup_page, DOCS_DIR
from ui.header import render_header
from ui.sidebar import render_sidebar
from ui.chat import render_chat
from core.retriever import initialize_retriever
from core.llm_manager import create_retrieval_chain

# -------------- PAGE SETUP ------------------
setup_page()

# --- Inject floating model selector near Streamlit header ---
st.markdown("""
    <style>
        /* Ensure container floats above everything */
        .floating-model-selector {
            position: relative;
            width: max-content;
            top: -4.5rem;  /* below Streamlit header */
            left: -2rem;
            z-index: 999999;
            background: var(--background-color);
            color: var(--text-color);
            padding: 4px 8px;
            margin-left: 6px;
            border-radius: 6px;
            border: none;
            box-shadow: 0 1px 4px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85rem;
        }

        .floating-model-selector select {
            background: transparent;
            border: none;
            color: var(--text-color);
            font-size: 0.85rem;
            cursor: pointer;
            outline: none;
        }

        .floating-model-selector select:hover {
            color: #1e90ff;
        }
    </style>

    <div class="floating-model-selector">
        <select id="modelSelect">
            <option value="llama3">LLaMA 3</option>
            <option value="mistral">Mistral</option>
            <option value="gemma">Gemma</option>
            <option value="codellama">CodeLLaMA</option>
        </select>
    </div>

    <script>
        const setUpModelSelect = () => {
            const select = document.getElementById('modelSelect');
            if (!select) return;

            const stored = sessionStorage.getItem('selectedModel');
            select.value = stored || 'llama3';

            select.addEventListener('change', (e) => {
                sessionStorage.setItem('selectedModel', e.target.value);
                window.parent.postMessage(
                    { type: 'model-changed', model: e.target.value },
                    '*'
                );
            });
        };

        // Wait for DOM to be ready even inside Streamlit iframe
        if (document.readyState !== 'loading') setUpModelSelect();
        else document.addEventListener('DOMContentLoaded', setUpModelSelect);
    </script>
""", unsafe_allow_html=True)

# -------------- HEADER & SIDEBAR ------------------
# model_choice = render_header()  # Uncomment if you use a header UI
uploaded_files, selected_model = render_sidebar()

# -------------- RETRIEVER INITIALIZATION ------------------
retriever = st.session_state.get("retriever", None)

# Check if docs folder has existing files
docs_exist = os.path.exists(DOCS_DIR) and any(
    f.lower().endswith((".pdf", ".txt", ".docx"))
    for f in os.listdir(DOCS_DIR)
)

if uploaded_files:
    # User uploaded new files → rebuild retriever
    retriever = initialize_retriever(uploaded_files, model_name=selected_model)
    st.session_state.retriever = retriever

elif not retriever and docs_exist:
    # No uploads this run, but docs exist → build retriever from folder
    retriever = initialize_retriever([], model_name=selected_model)
    st.session_state.retriever = retriever

elif not retriever:
    # No uploads, no retriever, no docs
    st.info("📄 Please upload documents to start chatting.")
    st.stop()

# -------------- LLM CHAIN SETUP ------------------
try:
    retrieval_chain = create_retrieval_chain(selected_model, retriever)
except Exception as e:
    st.error(f"⚠️ Error creating retrieval chain: {e}")
    st.stop()

# -------------- CHAT INTERFACE ------------------
render_chat(retrieval_chain)
