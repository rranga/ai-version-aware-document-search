import os
import streamlit as st

DOCS_DIR = "./docs"

def setup_page():
    """Set Streamlit page configuration and ensure docs folder exists."""
    st.set_page_config(page_title="Aavanam Thedal", page_icon="🔍", layout="wide")
    os.makedirs(DOCS_DIR, exist_ok=True)
