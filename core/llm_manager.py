from langchain_community.llms import Ollama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough

def create_retrieval_chain(model_choice, retriever):
    llm = Ollama(model=model_choice, temperature=0.2)

    prompt = ChatPromptTemplate.from_template("""
    You are a helpful AI assistant.
    Use the document context to answer the user's question clearly and concisely.

    If the context does not provide enough information, reply briefly and politely.

    Examples:
    - "I'm sorry, I don’t have that information."
    - "I’m sorry, the documents do not provide more details."
    - "I’m sorry, I don’t find relevant information in the documents."

    ---
    Context:
    {context}

    Question:
    {question}

    Answer:
    """)

    def format_docs(docs):
        return "\n\n".join(doc.page_content for doc in docs)

    retrieval_chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
    )
    return retrieval_chain
