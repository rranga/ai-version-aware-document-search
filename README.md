# 🌍 Aavanam Thedal — Intelligent Document Search App

**Aavanam Thedal** is a **Streamlit + LangChain** based intelligent document search and chat application.  
It allows users to upload PDFs, Word, or text documents, automatically index them using embeddings, and interactively query them using a **local LLM (via Ollama)**.

Built with a **modular architecture** for scalability and maintainability — separating UI, core logic, and caching layers.

---

## 🧩 Features

- 📂 Upload or drag-and-drop documents (`.pdf`, `.docx`, `.txt`)
- 🧠 Automatic document chunking, embedding & FAISS vector storage
- 💬 Ask natural language questions and get contextual answers
- 🚀 Works entirely **offline** (no API keys required)
- ⚡ Smart caching with **automatic invalidation** on document changes
- 🧱 Modular structure for **clean and extensible architecture**

---

## 📁 Project Structure

```
aavanam-thedal/
│
├── app.py                     # Main Streamlit entry point
│
├── core/                      # Core backend logic
│   ├── cache_manager.py       # Handles FAISS / embeddings caching
│   ├── config.py              # Global configuration (paths, constants)
│   ├── llm_manager.py         # LLM (Ollama / HuggingFace) setup
│   ├── retriever.py           # Document loading, splitting & retrieval
│   ├── session_manager.py     # Streamlit session & state management
│   ├── torch_patch.py         # Fix for PyTorch meta tensor issue
│   └── __init__.py
│
├── ui/                        # User Interface components
│   ├── chat.py                # Chat input & display logic
│   ├── header.py              # Top sticky header with model selector
│   ├── sidebar.py             # Sidebar (upload, new chat, tips)
│   ├── styles.py              # Global CSS and layout settings
│   └── __init__.py
│
├── docs/                      # User-uploaded or default documents
├── cache/                     # Cached FAISS embeddings and metadata
├── requirements.txt           # Project dependencies
└── README.md                  # Project documentation
```

---

## ⚙️ Installation Guide

### 🐍 1. Check Python Version

Ensure you have **Python 3.10+** installed:

```bash
python --version
```

---

### 📦 2. Clone the Repository

```bash
git clone https://github.com/<your-repo>/aavanam-thedal.git
cd aavanam-thedal
```

---

### 🧰 3. Create a Virtual Environment

```bash
python -m venv venv
```

---

### 🔑 4. Activate the Virtual Environment

**On Windows:**
```bash
venv\Scripts\activate
```

**On macOS / Linux:**
```bash
source venv/bin/activate
```

---

### ⚙️ 5. Install Dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

---

### 🚀 6. Run the Application

```bash
streamlit run app.py
```

Then open the local URL displayed in your terminal:

```
Local URL: http://localhost:8501
```

---

## 🧠 Caching & Automatic Invalidation

- The app automatically **caches vector embeddings** for faster document queries.
- Whenever you **upload or modify files** in the `docs/` folder, the cache is **automatically invalidated** and reindexed.
- You can manually clear cache anytime by deleting the `/cache` directory.

---

## 🧩 LLM Models via Ollama

This app runs with **local LLMs** using [Ollama](https://ollama.ai/).  
Ensure that **Ollama** is installed and running before launching the app.

You can pull models like:

```bash
ollama pull llama3
ollama pull mistral
ollama pull gemma
```

Once pulled, select your preferred model from the **dropdown** in the app’s header.

---

## 💻 Development Notes

- Modify **`core/config.py`** to customize:
  - Document directories
  - Embedding model settings
  - Chunk size and overlap configuration
- Add new UI components or layouts under the `ui/` folder.
- For deployment:
  - Use **Streamlit Cloud** for quick hosting.
  - Or deploy locally / on Docker for full control.

---

## 🧠 Example Use Cases

- 🏢 Company knowledge base search  
- 📚 Academic paper Q&A  
- ⚖️ Legal document analysis  
- 🧾 Personal digital document assistant  

---

## 🪪 License

Licensed under the **MIT License** — free to use, modify, and distribute.

---

## 👨‍💻 Author

**Rangaprasad Rekkamalli**  
_Aavanam Thedal — Document Intelligence Search_

---

### ⚡ Quick Start Summary

```bash
# 1. Clone the project
git clone https://github.com/<your-repo>/aavanam-thedal.git
cd aavanam-thedal

# 2. Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate      # (Windows)
# OR
source venv/bin/activate     # (macOS / Linux)

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the app
streamlit run app.py
```

---

✅ _Now you’re ready to explore your documents with **Aavanam Thedal**!_
