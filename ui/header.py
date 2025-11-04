import streamlit as st

def render_header():
    st.markdown("""
    <style>
    #sticky-header {
        position: sticky; top: 0; z-index: 999;
        display: flex; justify-content: space-between; align-items: center;
        padding-bottom: 8px;
    }
    </style>
    """, unsafe_allow_html=True)

    with st.container():
        st.markdown('<div id="sticky-header">', unsafe_allow_html=True)
        col1, col2 = st.columns([5, 1])
        with col1:
            st.markdown("### 🌍 Aavanam Thedal")
        with col2:
            model_choice = st.selectbox(
                "Model",
                ["llama3", "mistral", "gemma", "codellama"],
                index=0,
                label_visibility="collapsed"
            )
        st.markdown("</div>", unsafe_allow_html=True)
    return model_choice
