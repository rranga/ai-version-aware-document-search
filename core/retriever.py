import os
import streamlit as st
from langchain_community.document_loaders import (
    DirectoryLoader, TextLoader, PyPDFLoader, UnstructuredWordDocumentLoader
)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from core.config import DOCS_DIR
from core.torch_patch import device
from core.cache_manager import (
    load_cached_vectorstore,
    save_vectorstore_to_cache,
    get_all_doc_hashes,
    is_cache_valid
)


def initialize_retriever(uploaded_files, model_name="sentence-transformers/all-MiniLM-L6-v2"):
    """Handles doc loading, splitting, and automatic cache invalidation."""

    if uploaded_files and not isinstance(uploaded_files, list):
        uploaded_files = [uploaded_files]

    if uploaded_files:
        for file in uploaded_files:
            file_path = os.path.join(DOCS_DIR, file.name)
            # ensure docs dir exists
            os.makedirs(os.path.dirname(file_path) or DOCS_DIR, exist_ok=True)
            with open(file_path, "wb") as f:
                f.write(file.read())

    # Load all documents
    loaders = [
        DirectoryLoader(DOCS_DIR, glob="**/*.txt", loader_cls=TextLoader, recursive=True),
        DirectoryLoader(DOCS_DIR, glob="**/*.pdf", loader_cls=PyPDFLoader, recursive=True),
        DirectoryLoader(DOCS_DIR, glob="**/*.docx", loader_cls=UnstructuredWordDocumentLoader, recursive=True),
    ]

    documents = []
    for loader in loaders:
        try:
            documents.extend(loader.load())
        except Exception as e:
            st.warning(f"⚠️ Error loading {loader}: {e}")

    if not documents:
        st.info("📄 Upload or place documents in the './docs' folder to start chatting.")
        st.stop()

    # Compute document hashes for change detection (use dict from get_all_doc_hashes)
    current_hashes = get_all_doc_hashes(DOCS_DIR)
    # pass the raw hashes dict (not wrapped) to is_cache_valid
    cache_valid = is_cache_valid(model_name, current_hashes)

    if cache_valid:
        cached_vectorstore, _ = load_cached_vectorstore(model_name)
        if cached_vectorstore is not None:
            retriever = cached_vectorstore.as_retriever(search_kwargs={"k": 3})
            st.session_state.retriever_ready = True
            return retriever
        # If cached_vectorstore is None, fall through and rebuild

    # Cache invalid -> rebuild
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    texts = splitter.split_documents(documents)

    # Always use a valid embedding model regardless of selected LLM
    embedding_model_name = "sentence-transformers/all-MiniLM-L6-v2"

    with st.spinner("🔍 Indexing documents (cache updated)..."):
        embeddings = HuggingFaceEmbeddings(
            model_name=embedding_model_name,
            model_kwargs={"device": device}
        )
        vectorstore = FAISS.from_documents(texts, embeddings)
        # Save metadata with the expected structure: {"doc_hashes": {...}}
        save_vectorstore_to_cache(model_name, vectorstore, {"doc_hashes": current_hashes})
        retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

    st.session_state.retriever_ready = True
    return retriever
